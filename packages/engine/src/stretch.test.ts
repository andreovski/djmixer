// SPDX-License-Identifier: AGPL-3.0-or-later
// Spike 3: time-stretch offline com key lock. Mede tom, pureza e alinhamento das batidas.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { OfflineAudioContext } from 'node-web-audio-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { beatsToSeconds } from '@djmixer/shared'
import { scheduleGroup } from './group-player.ts'
import { detectOnsets, measureDrift } from './measure.ts'
import {
  createRubberBandStretcher,
  createSoundTouchStretcher,
  stretchToBpm,
  type Stretcher,
} from './stretch.ts'
import { estimateFrequency, toneToNoiseDb } from './stretch-quality.ts'
import { renderSynthetic } from './synthetic.ts'

const SR = 44100
const sine = new Float32Array(SR * 3).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR))
let rubberband: Stretcher

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const wasm = readFileSync(require.resolve('rubberband-wasm/dist/rubberband.wasm'))
  rubberband = await createRubberBandStretcher(await WebAssembly.compile(wasm))
})

describe.each([
  ['rubberband-r3', () => rubberband, 60],
  ['soundtouch', createSoundTouchStretcher, 30],
] as const)('%s', (_, make, minToneToNoiseDb) => {
  it.each([0.96, 1.04])('mantém o tom e a duração com fator %f', (ratio) => {
    const [out] = make().stretch([sine, sine], SR, ratio)
    expect(out?.length).toBe(Math.round(sine.length * ratio))
    const middle = (out ?? new Float32Array(0)).subarray(SR / 2, SR * 2)
    expect(estimateFrequency(middle, SR)).toBeCloseTo(440, 0)
    expect(toneToNoiseDb(middle, SR, 440)).toBeGreaterThan(minToneToNoiseDb)
  })
})

describe('rubberband-r3', () => {
  it('mantém as batidas no lugar, com atraso constante de até 2,5 ms', () => {
    const drums = renderSynthetic({ bpm: 124, toneHz: 440, beats: 32, leadInSeconds: 0.37 }, SR)
    const ratio = 124 / 128
    const [out] = rubberband.stretch([drums, drums], SR, ratio)
    const onsets = detectOnsets(out ?? new Float32Array(0), SR, 0.4)
    const errors = onsets.map((t, beat) => t - (0.37 + (beat * 60) / 124) * ratio)
    expect(onsets).toHaveLength(32)
    expect(Math.min(...errors)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...errors)).toBeLessThan(0.0025)
  }, 60_000)

  it('duas faixas esticadas para o BPM do grupo ficam em fase', async () => {
    const groupBpm = 126
    const beats = 32
    const seconds = beatsToSeconds(beats, groupBpm)
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR)
    const audio = ctx as unknown as BaseAudioContext
    const merger = audio.createChannelMerger(2)
    merger.connect(audio.destination)
    const outputs = [audio.createGain(), audio.createGain()]
    outputs.forEach((node, i) => node.connect(merger, 0, i))

    const tracks = [
      { bpm: 124, toneHz: 440, leadInSeconds: 0 },
      { bpm: 128, toneHz: 660, leadInSeconds: 0.37 },
    ].map((spec, i) => {
      const samples = renderSynthetic({ ...spec, beats: beats + 4 }, SR)
      const buffer = audio.createBuffer(1, samples.length, SR)
      buffer.copyToChannel(samples, 0)
      const grid = { bpm: spec.bpm, firstBeatSeconds: spec.leadInSeconds }
      return { ...stretchToBpm(audio, buffer, grid, groupBpm, rubberband), output: outputs[i] }
    })
    expect(tracks.every((t) => t.grid.bpm === groupBpm)).toBe(true)

    scheduleGroup(
      audio,
      tracks.map((t) => ({
        buffer: t.buffer,
        grid: t.grid,
        clip: { inBeat: 0, outBeat: beats, startBeat: 0 },
        ...(t.output ? { output: t.output } : {}),
      })),
      { bpm: groupBpm, startAt: 0 },
    )
    const rendered = await ctx.startRendering()
    const a = detectOnsets(rendered.getChannelData(0), SR, 0.4)
    const b = detectOnsets(rendered.getChannelData(1), SR, 0.4)
    const drift = measureDrift(a, b)
    expect(drift.matched).toBe(beats)
    // O stretch muda um pouco a forma do ataque, e a detecção por limiar enxerga isso como
    // ~1 ms de desvio. Fica bem abaixo do que se ouve como batida dobrada (flam, ~5 ms ou mais).
    expect(drift.maxSeconds).toBeLessThan(0.002)
  }, 120_000)
})
