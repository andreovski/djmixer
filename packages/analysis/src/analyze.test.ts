// SPDX-License-Identifier: AGPL-3.0-or-later
// Critérios do spike 5 em faixas sintéticas com gabarito: BPM exato, primeira batida a menos de
// 2 ms e tonalidade certa. A avaliação completa (10 faixas, dois detectores) está em
// scripts/avaliar-analise.ts.
import { describe, expect, it } from 'vitest'
import {
  alignToKick,
  analyze,
  ANALYSIS_SAMPLE_RATE,
  camelot,
  fitBeatgrid,
  normalizeKey,
} from './analyze.ts'
import { renderMusic, type MusicSpec } from './synthetic-music.ts'

/** Distância da primeira batida analisada até a verdadeira, módulo uma batida, em segundos. */
function phaseError(firstBeat: number, spec: MusicSpec): number {
  const period = 60 / spec.bpm
  const error = (firstBeat - (spec.leadInSeconds ?? 0)) / period
  return (error - Math.round(error)) * period
}

describe('camelot', () => {
  it('segue a roda: 8A lá menor, 8B dó maior, uma quinta acima soma 1', () => {
    expect(camelot('A', 'minor')).toBe('8A')
    expect(camelot('C', 'major')).toBe('8B')
    expect(camelot('E', 'minor')).toBe('9A')
    expect(camelot('G', 'major')).toBe('9B')
    expect(camelot('D', 'minor')).toBe('7A')
    expect(camelot('F', 'major')).toBe('7B')
    expect(camelot('G#', 'minor')).toBe('1A')
    expect(camelot('B', 'major')).toBe('1B')
  })

  it('aceita os bemóis que o Essentia devolve', () => {
    expect(normalizeKey('Eb')).toBe('D#')
    expect(normalizeKey('F#')).toBe('F#')
  })
})

describe('fitBeatgrid', () => {
  it('ignora batidas soltas e arredonda o BPM', () => {
    const period = 60 / 128
    const beats = Array.from({ length: 200 }, (_, i) => 0.3 + i * period + (i % 2 ? 0.003 : -0.003))
    // Uma intro com batidas fora da grade e uma batida perdida no meio.
    const noisy = [0.05, 0.11, ...beats.filter((_, i) => i !== 80)]
    const grid = fitBeatgrid(noisy)
    expect(grid.bpm).toBe(128)
    expect(Math.abs(grid.firstBeatSeconds - 0.3)).toBeLessThan(0.001)
  })
})

describe('alignToKick', () => {
  it('troca uma grade travada no contratempo pela batida do bumbo', () => {
    const spec: MusicSpec = { bpm: 125, key: 'A', scale: 'minor', beats: 64, leadInSeconds: 0.2 }
    const samples = renderMusic(spec, ANALYSIS_SAMPLE_RATE)
    const period = 60 / spec.bpm
    const offbeat = {
      bpm: 125,
      rawBpm: 125,
      firstBeatSeconds: 0.2 + period / 2 - 0.015,
      inliers: 64,
      detected: 64,
    }
    const grid = alignToKick(offbeat, samples, ANALYSIS_SAMPLE_RATE)
    expect(Math.abs(phaseError(grid.firstBeatSeconds, spec))).toBeLessThan(0.002)
  })
})

describe('analyze', () => {
  const cases: MusicSpec[] = [
    { bpm: 124, key: 'F', scale: 'minor', beats: 128, leadInSeconds: 0.37, seed: 2 },
    { bpm: 126, key: 'C', scale: 'major', beats: 128, leadInSeconds: 1.1, introBeats: 32, seed: 3 },
    { bpm: 122.5, key: 'D', scale: 'major', beats: 128, leadInSeconds: 0.21, seed: 5 },
    { bpm: 132, key: 'E', scale: 'minor', beats: 128, introBeats: 16, seed: 6 },
  ]
  for (const spec of cases) {
    it(`acerta ${spec.bpm} BPM, a primeira batida e ${spec.key} ${spec.scale}`, () => {
      const result = analyze(renderMusic(spec, ANALYSIS_SAMPLE_RATE))
      expect(result.bpm).toBe(spec.bpm)
      expect(Math.abs(phaseError(result.firstBeatSeconds, spec))).toBeLessThan(0.002)
      expect(result.key).toBe(spec.key)
      expect(result.scale).toBe(spec.scale)
    }, 60_000)
  }
})
