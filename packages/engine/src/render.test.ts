// SPDX-License-Identifier: AGPL-3.0-or-later
// Teste de render offline (ponte para a fase 1): renderiza um projeto com uma transição Blend
// entre duas faixas sintéticas e compara métricas do áudio com uma referência guardada no
// repositório. A referência é JSON, não áudio. Para regravar depois de uma mudança intencional:
// ATUALIZAR_REFERENCIA=1 pnpm test
import { readFileSync, writeFileSync } from 'node:fs'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  beatsToSeconds,
  createProject,
  type Channel,
  type Project,
  type Track,
} from '@djmixer/shared'
import { createMaster, playbackSegments, renderGroup, type TrackLoader } from './engine.ts'
import { detectOnsets, measureDrift } from './measure.ts'
import { renderSynthetic } from './synthetic.ts'

const SR = 44100
const REFERENCE = new URL('./__referencia__/render-blend.json', import.meta.url)

interface Reference {
  /** RMS em dBFS de cada compasso do canal esquerdo. */
  barRmsDb: number[]
  peak: number
}

function makeProject(): Project {
  const track = (id: string, bpm: number, leadIn: number): Track => ({
    id,
    path: `/sintetico/${id}.wav`,
    hash: id,
    title: id,
    artist: 'Sintético',
    durationSeconds: 0,
    grid: { bpm, firstBeatSeconds: leadIn },
    key: null,
    cues: [],
    gridEditedByUser: false,
  })
  const channel = (id: string, trackId: string, startBeat: number, beats: number): Channel => ({
    id,
    trackId,
    clip: { inBeat: 0, outBeat: beats, startBeat },
    lanes: [],
  })
  const [a, b] = applyPreset(
    'blend',
    channel('a', 'grave', 0, 96),
    channel('b', 'agudo', 64, 64),
    64,
    32,
  )
  const project = createProject('Render de referência')
  project.tracks = [track('grave', 124, 0), track('agudo', 128, 0.25)]
  project.groups = [
    {
      id: 'g',
      name: 'Grupo',
      bpm: 126,
      keyLock: false,
      eq: 'isolator',
      channels: [a, b],
      transitions: [
        {
          id: 't',
          fromChannelId: 'a',
          toChannelId: 'b',
          startBeat: 64,
          lengthBeats: 32,
          preset: 'blend',
        },
      ],
    },
  ]
  return project
}

const sources: Record<string, { toneHz: number; beats: number }> = {
  grave: { toneHz: 110, beats: 112 },
  agudo: { toneHz: 880, beats: 80 },
}

// Varispeed: o buffer original e o beatgrid da faixa; o motor ajusta o playbackRate.
const load: TrackLoader = async (track) => {
  const spec = sources[track.id]
  if (!spec) throw new Error(track.id)
  const samples = renderSynthetic(
    { bpm: track.grid.bpm, leadInSeconds: track.grid.firstBeatSeconds, ...spec },
    SR,
  )
  const ctx = new OfflineAudioContext(1, 1, SR) as unknown as BaseAudioContext
  const buffer = ctx.createBuffer(1, samples.length, SR)
  buffer.copyToChannel(samples, 0)
  return { buffer, grid: track.grid }
}

const createContext = (channels: number, length: number, sampleRate: number) =>
  new OfflineAudioContext(channels, length, sampleRate) as unknown as BaseAudioContext & {
    startRendering(): Promise<AudioBuffer>
  }

function metrics(buffer: AudioBuffer, bpm: number): Reference {
  const data = buffer.getChannelData(0)
  const bar = Math.round(beatsToSeconds(4, bpm) * SR)
  const barRmsDb: number[] = []
  let peak = 0
  for (let start = 0; start + bar <= data.length; start += bar) {
    let sum = 0
    for (let i = start; i < start + bar; i++) {
      const v = data[i] ?? 0
      sum += v * v
      peak = Math.max(peak, Math.abs(v))
    }
    barRmsDb.push(Math.round(10 * Math.log10(sum / bar + 1e-12) * 10) / 10)
  }
  return { barRmsDb, peak: Math.round(peak * 1000) / 1000 }
}

describe('render offline', () => {
  it('reproduz a transição Blend de referência', async () => {
    const project = makeProject()
    const group = project.groups[0]
    if (!group) throw new Error('grupo')
    const rendered = await renderGroup(project, group, load, { createContext })
    expect(rendered.length).toBe(Math.round(beatsToSeconds(128, 126) * SR))

    const measured = metrics(rendered, group.bpm)
    if (process.env.ATUALIZAR_REFERENCIA) {
      writeFileSync(REFERENCE, `${JSON.stringify(measured, null, 2)}\n`)
    }
    const reference = JSON.parse(readFileSync(REFERENCE, 'utf8')) as Reference
    expect(measured.barRmsDb).toHaveLength(reference.barRmsDb.length)
    measured.barRmsDb.forEach((db, i) =>
      expect(Math.abs(db - (reference.barRmsDb[i] ?? 0))).toBeLessThan(0.5),
    )
    expect(measured.peak).toBeLessThanOrEqual(1)
    expect(Math.abs(measured.peak - reference.peak)).toBeLessThan(0.02)

    // As batidas dos dois canais seguem a grade do grupo durante toda a transição.
    const onsets = detectOnsets(rendered.getChannelData(0), SR, 0.2)
    const grid = Array.from({ length: 128 }, (_, beat) => beatsToSeconds(beat, 126))
    // O detector por limiar acha o ataque alguns ms depois da batida; o que importa é o atraso
    // ficar estável em todas as batidas, antes, durante e depois da transição. Varia um pouco
    // porque o volume dos bumbos muda na transição e o limiar é cruzado em outro ponto.
    expect(measureDrift(grid, onsets).matched).toBe(128)
    const delays = grid.map((beat) => {
      const after = onsets.find((t) => t >= beat - 0.001) ?? Infinity
      return after - beat
    })
    expect(Math.max(...delays) - Math.min(...delays)).toBeLessThan(0.004)
  }, 60_000)

  it('o limitador segura dois canais cheios abaixo de 0 dBFS', async () => {
    const ctx = createContext(1, SR, SR)
    const master = createMaster(ctx, ctx.destination)
    for (const hz of [100, 150]) {
      const osc = ctx.createOscillator()
      osc.frequency.value = hz
      osc.connect(master.input)
      osc.start()
    }
    const out = (await ctx.startRendering()).getChannelData(0).subarray(SR / 2)
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1)
  })
})

describe('segmentos de reprodução', () => {
  it('o set percorre os grupos e o loop repete a janela', () => {
    const project = makeProject()
    const second = structuredClone(project.groups[0])
    if (!second) throw new Error('grupo')
    second.id = 'g2'
    project.groups.push(second)
    const set = [...playbackSegments(() => project, { kind: 'set', fromBeat: 100 })]
    expect(set).toEqual([
      { groupId: 'g', fromBeat: 100, untilBeat: 128 },
      { groupId: 'g2', fromBeat: 0, untilBeat: 128 },
    ])
    const loop = playbackSegments(() => project, {
      kind: 'loop',
      groupId: 'g',
      startBeat: 64,
      endBeat: 96,
    })
    expect([loop.next().value, loop.next().value]).toEqual([
      { groupId: 'g', fromBeat: 64, untilBeat: 96 },
      { groupId: 'g', fromBeat: 64, untilBeat: 96 },
    ])
  })
})
