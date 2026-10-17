// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { Point } from '@djmixer/shared'
import { laneValueAt, sampleLane } from './lanes.ts'

const ramp = (curve: Point['curve']): Point[] => [
  { beat: 0, value: 0, curve },
  { beat: 4, value: 1, curve: 'linear' },
]

describe('laneValueAt', () => {
  it('usa o valor neutro sem pontos e os extremos fora deles', () => {
    expect(laneValueAt([], 2, 0.5)).toBe(0.5)
    expect(laneValueAt(ramp('linear'), -1, 0.5)).toBe(0)
    expect(laneValueAt(ramp('linear'), 9, 0.5)).toBe(1)
  })

  it('aplica a curva do ponto da esquerda', () => {
    expect(laneValueAt(ramp('linear'), 1, 0)).toBeCloseTo(0.25)
    expect(laneValueAt(ramp('exp'), 2, 0)).toBeCloseTo(0.25)
    expect(laneValueAt(ramp('s-curve'), 2, 0)).toBeCloseTo(0.5)
    expect(laneValueAt(ramp('s-curve'), 1, 0)).toBeLessThan(0.25)
    expect(laneValueAt(ramp('hold'), 3.99, 0)).toBe(0)
    expect(laneValueAt(ramp('hold'), 4, 0)).toBe(1)
  })
})

describe('sampleLane', () => {
  it('amostra o trecho pedido já convertido pelo map', () => {
    const curve = sampleLane(ramp('linear'), 0, 0, 4, 5, (v) => v * 10)
    expect(Array.from(curve)).toEqual([0, 2.5, 5, 7.5, 10])
  })
})
