// SPDX-License-Identifier: AGPL-3.0-or-later
// Critério do spike 1: num render offline, as batidas de duas faixas com BPMs diferentes
// coincidem ao longo de uma transição de 16 compassos, com desvio abaixo de 1 ms.
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import { beatsToSeconds } from '@djmixer/shared'
import { scheduleGroup } from './group-player.ts'
import { detectOnsets, measureDrift } from './measure.ts'
import { renderSynthetic, type SyntheticSpec } from './synthetic.ts'

const SAMPLE_RATE = 44100
const GROUP_BPM = 126
const ENTRY_BEAT = 64
const TOTAL_BEATS = 128

function bufferFor(ctx: BaseAudioContext, spec: SyntheticSpec): AudioBuffer {
  const samples = renderSynthetic(spec, SAMPLE_RATE)
  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE)
  buffer.copyToChannel(samples, 0)
  return buffer
}

describe('scheduleGroup', () => {
  it('mantém duas faixas em fase durante 16 compassos', async () => {
    const seconds = beatsToSeconds(TOTAL_BEATS, GROUP_BPM)
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE)
    const audio = ctx as unknown as BaseAudioContext
    // Faixa A no canal esquerdo, faixa B no direito, para medir cada uma separadamente.
    const merger = audio.createChannelMerger(2)
    merger.connect(audio.destination)
    const left = audio.createGain()
    left.connect(merger, 0, 0)
    const right = audio.createGain()
    right.connect(merger, 0, 1)

    scheduleGroup(
      audio,
      [
        {
          buffer: bufferFor(audio, { bpm: 124, toneHz: 440, beats: 160 }),
          grid: { bpm: 124, firstBeatSeconds: 0 },
          clip: { inBeat: 0, outBeat: TOTAL_BEATS, startBeat: 0 },
          output: left,
        },
        {
          buffer: bufferFor(audio, { bpm: 128, toneHz: 660, beats: 96, leadInSeconds: 0.37 }),
          grid: { bpm: 128, firstBeatSeconds: 0.37 },
          clip: { inBeat: 0, outBeat: TOTAL_BEATS - ENTRY_BEAT, startBeat: ENTRY_BEAT },
          output: right,
        },
      ],
      { bpm: GROUP_BPM, startAt: 0 },
    )
    const rendered = await ctx.startRendering()

    const entry = beatsToSeconds(ENTRY_BEAT, GROUP_BPM)
    const a = detectOnsets(rendered.getChannelData(0), SAMPLE_RATE, 0.4).filter(
      (t) => t >= entry - 0.01,
    )
    const b = detectOnsets(rendered.getChannelData(1), SAMPLE_RATE, 0.4)
    const drift = measureDrift(a, b)

    expect(b[0]).toBeCloseTo(entry, 2)
    expect(drift.matched).toBe(TOTAL_BEATS - ENTRY_BEAT)
    expect(drift.maxSeconds).toBeLessThan(0.001)
  }, 60_000)
})
