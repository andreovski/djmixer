// SPDX-License-Identifier: AGPL-3.0-or-later
// Critérios do spike 2: EQ neutro não colore o som, cortar o grave remove o bumbo
// e a automação não produz degraus (estalos ou zipper).
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import type { Lane } from '@djmixer/shared'
import type { EqMode } from './channel-strip.ts'
import { scheduleGroup } from './group-player.ts'

const SAMPLE_RATE = 44100
const BPM = 120 // 1 beat = 0,5 s

async function renderSine(
  hz: number,
  beats: number,
  options: { eq?: EqMode; lanes?: Lane[] } = {},
): Promise<{ input: Float32Array; output: Float32Array }> {
  const frames = Math.round((beats * 60 * SAMPLE_RATE) / BPM)
  const ctx = new OfflineAudioContext(1, frames, SAMPLE_RATE)
  const audio = ctx as unknown as BaseAudioContext
  const input = new Float32Array(frames)
  for (let i = 0; i < frames; i++) input[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)
  const buffer = audio.createBuffer(1, frames, SAMPLE_RATE)
  buffer.copyToChannel(input, 0)
  scheduleGroup(
    audio,
    [
      {
        buffer,
        grid: { bpm: BPM, firstBeatSeconds: 0 },
        clip: { inBeat: 0, outBeat: beats, startBeat: 0 },
        ...options,
      },
    ],
    { bpm: BPM, startAt: 0 },
  )
  const rendered = await ctx.startRendering()
  return { input, output: rendered.getChannelData(0) }
}

/** RMS da segunda metade, depois que os filtros assentaram. */
function rmsTail(samples: Float32Array): number {
  const start = Math.floor(samples.length / 2)
  let sum = 0
  for (let i = start; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2
  return Math.sqrt(sum / (samples.length - start))
}

const db = (ratio: number) => 20 * Math.log10(ratio)

/** Maior segunda diferença do sinal: um degrau de ganho aparece como um pico aqui. */
function maxSecondDifference(samples: Float32Array, from = 2): number {
  let max = 0
  for (let i = from; i < samples.length; i++) {
    const d = (samples[i] ?? 0) - 2 * (samples[i - 1] ?? 0) + (samples[i - 2] ?? 0)
    max = Math.max(max, Math.abs(d))
  }
  return max
}

describe('channel strip', () => {
  for (const eq of ['shelving', 'isolator'] as const) {
    it(`EQ ${eq} neutro fica a menos de 1 dB do original`, async () => {
      for (const hz of [60, 200, 1000, 2500, 8000]) {
        const { input, output } = await renderSine(hz, 2, { eq })
        expect(Math.abs(db(rmsTail(output) / rmsTail(input))), `${hz} Hz`).toBeLessThan(1)
      }
    })
  }

  it('os dois EQs cortam o grave do bumbo (60 Hz) em mais de 35 dB; o isolador em mais de 40', async () => {
    const lanes: Lane[] = [{ kind: 'eq.low', points: [{ beat: 0, value: 0, curve: 'hold' }] }]
    const iso = await renderSine(60, 2, { eq: 'isolator', lanes })
    const shelf = await renderSine(60, 2, { eq: 'shelving', lanes })
    const isoDb = db(rmsTail(iso.output) / rmsTail(iso.input))
    const shelfDb = db(rmsTail(shelf.output) / rmsTail(shelf.input))
    expect(isoDb).toBeLessThan(-40)
    expect(shelfDb).toBeLessThan(-35)
  })

  it('fade de volume e varredura de filtro não criam degraus', async () => {
    const hz = 440
    const baseline = maxSecondDifference((await renderSine(hz, 4)).input)
    const lanes: Lane[] = [
      {
        kind: 'volume',
        points: [
          { beat: 1, value: 1, curve: 'linear' },
          { beat: 2, value: 0.2, curve: 's-curve' },
          { beat: 3, value: 1, curve: 'linear' },
        ],
      },
      {
        kind: 'filter',
        points: [
          { beat: 0, value: 0.5, curve: 'linear' },
          { beat: 2, value: 0.15, curve: 'linear' },
          { beat: 4, value: 0.9, curve: 'linear' },
        ],
      },
    ]
    const { output } = await renderSine(hz, 4, { lanes })
    // Um degrau de ganho passa de 10 vezes a referência (ver o próximo teste); a varredura do
    // filtro muda a fase e fica um pouco acima de 1 vez. Ignora o primeiro milissegundo (ataque da senoide no início do arquivo).
    expect(maxSecondDifference(output, 64)).toBeLessThan(baseline * 3)
  })

  it('um salto numa lane hold vira uma rampa curta, sem estalo', async () => {
    const hz = 440
    const baseline = maxSecondDifference((await renderSine(hz, 2)).input)
    const lanes: Lane[] = [
      {
        kind: 'volume',
        points: [
          { beat: 0, value: 0.3, curve: 'hold' },
          { beat: 1, value: 1, curve: 'hold' },
        ],
      },
    ]
    const { output } = await renderSine(hz, 2, { lanes })
    expect(maxSecondDifference(output, 64)).toBeLessThan(baseline * 3)
  })

  it('a métrica de degraus detecta um salto instantâneo de ganho', async () => {
    const frames = SAMPLE_RATE
    const ctx = new OfflineAudioContext(1, frames, SAMPLE_RATE)
    const audio = ctx as unknown as BaseAudioContext
    const osc = audio.createOscillator()
    osc.frequency.value = 440
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.15, 0)
    gain.gain.setValueAtTime(0.5, 0.5)
    osc.connect(gain).connect(audio.destination)
    osc.start(0)
    const output = (await ctx.startRendering()).getChannelData(0)
    const baseline = 0.5 * (2 * Math.PI * (440 / SAMPLE_RATE)) ** 2
    expect(maxSecondDifference(output, 64)).toBeGreaterThan(baseline * 10)
  })
})
