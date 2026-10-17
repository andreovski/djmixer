// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { scheduleClip } from './schedule.ts'

const grid = { bpm: 128, firstBeatSeconds: 0.5 }

describe('scheduleClip', () => {
  it('agenda o clip no início do grupo', () => {
    const plan = scheduleClip({ inBeat: 0, outBeat: 64, startBeat: 0 }, grid, 128, 10)
    expect(plan).toEqual({ when: 10, offset: 0.5, stopAt: 40, playbackRate: 1 })
  })

  it('converte a entrada no grupo pelo BPM do grupo e o trecho da faixa pelo BPM da faixa', () => {
    const plan = scheduleClip({ inBeat: 32, outBeat: 96, startBeat: 64 }, grid, 120, 0)
    expect(plan?.when).toBeCloseTo(32)
    expect(plan?.offset).toBeCloseTo(0.5 + 15)
    expect(plan?.stopAt).toBeCloseTo(64)
    expect(plan?.playbackRate).toBeCloseTo(120 / 128)
  })

  it('começa no meio do clip quando o grupo toca a partir de fromBeat', () => {
    const plan = scheduleClip({ inBeat: 0, outBeat: 64, startBeat: 16 }, grid, 128, 2, 48)
    expect(plan?.when).toBeCloseTo(2)
    expect(plan?.offset).toBeCloseTo(0.5 + 15)
    expect(plan?.stopAt).toBeCloseTo(2 + 15)
  })

  it('ignora clips que terminaram antes de fromBeat', () => {
    expect(scheduleClip({ inBeat: 0, outBeat: 16, startBeat: 0 }, grid, 128, 0, 16)).toBeNull()
  })

  it('espera o arquivo começar quando o trecho começa antes dele', () => {
    const plan = scheduleClip({ inBeat: -2, outBeat: 8, startBeat: 0 }, grid, 64, 0)
    // -2 beats a 128 BPM = -0.9375 s; o arquivo começa 0.4375 s de faixa depois, a meia velocidade.
    expect(plan?.offset).toBe(0)
    expect(plan?.when).toBeCloseTo(0.875)
  })

  it('rejeita clip vazio', () => {
    expect(() => scheduleClip({ inBeat: 4, outBeat: 4, startBeat: 0 }, grid, 128, 0)).toThrow(
      RangeError,
    )
  })
})
