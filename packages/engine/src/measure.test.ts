// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { detectOnsets, measureDrift } from './measure.ts'
import { renderSynthetic } from './synthetic.ts'

describe('detectOnsets', () => {
  it('encontra o bumbo de cada batida de uma faixa sintética', () => {
    const samples = renderSynthetic({ bpm: 120, toneHz: 440, beats: 8, leadInSeconds: 0.25 }, 8000)
    const onsets = detectOnsets(samples, 8000, 0.4)
    expect(onsets).toHaveLength(8)
    onsets.forEach((t, beat) => expect(t).toBeCloseTo(0.25 + beat * 0.5, 2))
  })
})

describe('measureDrift', () => {
  it('pareia ataques próximos e ignora os sem par', () => {
    const report = measureDrift([0, 1, 2, 3], [0.001, 1.002, 2, 9])
    expect(report.matched).toBe(3)
    expect(report.maxSeconds).toBeCloseTo(0.002)
    expect(report.meanSeconds).toBeCloseTo(0.001)
  })
})
