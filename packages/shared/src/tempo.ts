// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Beat } from './model.ts'

/** Converte beats em segundos com BPM constante. Único ponto de conversão do projeto. */
export function beatsToSeconds(beats: Beat, bpm: number): number {
  assertBpm(bpm)
  return (beats * 60) / bpm
}

export function secondsToBeats(seconds: number, bpm: number): Beat {
  assertBpm(bpm)
  return (seconds * bpm) / 60
}

/** Fator de time-stretch para levar uma faixa de `fromBpm` a `toBpm` (1 = sem ajuste). */
export function stretchRatio(fromBpm: number, toBpm: number): number {
  assertBpm(fromBpm)
  assertBpm(toBpm)
  return toBpm / fromBpm
}

function assertBpm(bpm: number): void {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`BPM inválido: ${bpm}`)
  }
}
