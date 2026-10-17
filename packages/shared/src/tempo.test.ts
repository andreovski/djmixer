// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { beatsToSeconds, secondsToBeats, stretchRatio } from './tempo.ts'

describe('tempo', () => {
  it('converte 16 compassos de 4/4 a 124 BPM em segundos', () => {
    expect(beatsToSeconds(64, 124)).toBeCloseTo(30.9677, 4)
  })

  it('ida e volta entre beats e segundos', () => {
    expect(secondsToBeats(beatsToSeconds(37.5, 128), 128)).toBeCloseTo(37.5, 10)
  })

  it('calcula o fator de stretch de 124 para 128 BPM', () => {
    expect(stretchRatio(124, 128)).toBeCloseTo(1.0323, 4)
  })

  it('rejeita BPM inválido', () => {
    expect(() => beatsToSeconds(4, 0)).toThrow(RangeError)
    expect(() => stretchRatio(Number.NaN, 120)).toThrow(RangeError)
  })
})
