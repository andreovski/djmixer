// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LaneKind } from '@djmixer/shared'

/**
 * `shelving`: biquads lowshelf, peaking e highshelf, com piso de -40 dB.
 * `isolator`: divide o sinal em três bandas com crossovers Linkwitz-Riley de 4ª ordem
 * (200 Hz e 2,5 kHz) e controla o ganho de cada uma, como o EQ de um mixer de DJ. Corta mais
 * longe dos crossovers e menos perto deles (medições em docs/decisoes/0006).
 */
export type EqMode = 'shelving' | 'isolator'

export interface ParamTarget {
  param: AudioParam
  /** Converte o valor da lane (0 a 1) no valor do parâmetro. */
  map: (value: number) => number
}

export interface ChannelStrip {
  input: AudioNode
  output: AudioNode
  targets: Partial<Record<LaneKind, ParamTarget[]>>
}

export const LOW_CROSSOVER_HZ = 200
export const HIGH_CROSSOVER_HZ = 2500
const SHELF_FLOOR_DB = -40
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2)

/** EQ: 0 zera a banda, 0,5 é 0 dB e 1 é +6 dB. Devolve o ganho linear. */
export function eqGain(value: number): number {
  const v = clamp01(value)
  if (v <= 0.5) return (v / 0.5) ** 2
  return 10 ** (((v - 0.5) * 12) / 20)
}

/** Volume: posição do fader ao quadrado, uma lei próxima da percepção. */
export function volumeGain(value: number): number {
  return clamp01(value) ** 2
}

/** Filtro bipolar de um botão: abaixo de 0,5 fecha um passa-baixa até 100 Hz; acima abre um passa-alta até 8 kHz. */
export function lowpassHz(value: number): number {
  const v = clamp01(value)
  return v >= 0.5 ? 20000 : 20000 * (100 / 20000) ** ((0.5 - v) / 0.5)
}

export function highpassHz(value: number): number {
  const v = clamp01(value)
  return v <= 0.5 ? 10 : 10 * (8000 / 10) ** ((v - 0.5) / 0.5)
}

export function createChannelStrip(ctx: BaseAudioContext, mode: EqMode): ChannelStrip {
  const input = ctx.createGain()
  const eqOut = ctx.createGain()
  const targets: ChannelStrip['targets'] = {}

  if (mode === 'shelving') {
    const low = biquad(ctx, 'lowshelf', LOW_CROSSOVER_HZ)
    const mid = biquad(ctx, 'peaking', 1000)
    mid.Q.value = 0.7
    const high = biquad(ctx, 'highshelf', HIGH_CROSSOVER_HZ)
    input.connect(low).connect(mid).connect(high).connect(eqOut)
    const db = (value: number) => Math.max(SHELF_FLOOR_DB, 20 * Math.log10(eqGain(value) || 1e-6))
    targets['eq.low'] = [{ param: low.gain, map: db }]
    targets['eq.mid'] = [{ param: mid.gain, map: db }]
    targets['eq.high'] = [{ param: high.gain, map: db }]
  } else {
    // Árvore de crossovers: separa o grave em 200 Hz e divide o resto em 2,5 kHz. O grave passa
    // por um passa-tudo equivalente ao segundo crossover, para as três bandas somarem plano.
    const chain = (from: AudioNode, ...filters: BiquadFilterNode[]) =>
      filters.reduce<AudioNode>((node, filter) => node.connect(filter), from)
    const lr4 = (type: BiquadFilterType, hz: number) => [
      biquad(ctx, type, hz),
      biquad(ctx, type, hz),
    ]
    const lowSplit = chain(input, ...lr4('lowpass', LOW_CROSSOVER_HZ))
    const lowAllpass = ctx.createGain()
    chain(lowSplit, ...lr4('lowpass', HIGH_CROSSOVER_HZ)).connect(lowAllpass)
    chain(lowSplit, ...lr4('highpass', HIGH_CROSSOVER_HZ)).connect(lowAllpass)
    const rest = chain(input, ...lr4('highpass', LOW_CROSSOVER_HZ))
    const low = ctx.createGain()
    const mid = ctx.createGain()
    const high = ctx.createGain()
    lowAllpass.connect(low).connect(eqOut)
    chain(rest, ...lr4('lowpass', HIGH_CROSSOVER_HZ))
      .connect(mid)
      .connect(eqOut)
    chain(rest, ...lr4('highpass', HIGH_CROSSOVER_HZ))
      .connect(high)
      .connect(eqOut)
    targets['eq.low'] = [{ param: low.gain, map: eqGain }]
    targets['eq.mid'] = [{ param: mid.gain, map: eqGain }]
    targets['eq.high'] = [{ param: high.gain, map: eqGain }]
  }

  const lowpass = biquad(ctx, 'lowpass', 20000)
  const highpass = biquad(ctx, 'highpass', 10)
  const volume = ctx.createGain()
  eqOut.connect(lowpass).connect(highpass).connect(volume)
  targets.filter = [
    { param: lowpass.frequency, map: lowpassHz },
    { param: highpass.frequency, map: highpassHz },
  ]
  targets.volume = [{ param: volume.gain, map: volumeGain }]

  return { input, output: volume, targets }
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, hz: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = hz
  // Em lowpass e highpass o Q do Web Audio é em dB: -3,01 dB equivale ao Q linear 0,707 (Butterworth).
  if (type === 'lowpass' || type === 'highpass') filter.Q.value = BUTTERWORTH_Q_DB
  return filter
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
