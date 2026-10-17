// SPDX-License-Identifier: AGPL-3.0-or-later
import { beatsToSeconds, stretchRatio, type Beat } from '@djmixer/shared'

/** Beatgrid de BPM constante: a batida 0 da faixa cai em `firstBeatSeconds` do arquivo. */
export interface BeatGrid {
  bpm: number
  firstBeatSeconds: number
}

/** Trecho da faixa (em beats da faixa) e onde ele começa no grupo (em beats do grupo). */
export interface ClipPlacement {
  inBeat: Beat
  outBeat: Beat
  startBeat: Beat
}

/** Parâmetros prontos para `AudioBufferSourceNode`, em segundos do relógio do AudioContext. */
export interface ScheduledClip {
  when: number
  offset: number
  stopAt: number
  playbackRate: number
}

/**
 * Converte um clip em beats para o agendamento no relógio do AudioContext.
 * `fromBeat` e `untilBeat` recortam o trecho do grupo que vai tocar (tocar do meio, ensaiar só a
 * transição); clips fora desse trecho devolvem null.
 *
 * O casamento de BPM usa `playbackRate`, que vale 1 quando a faixa já chega esticada para o BPM
 * do grupo (key lock) e muda o tom quando não (varispeed).
 */
export function scheduleClip(
  clip: ClipPlacement,
  grid: BeatGrid,
  groupBpm: number,
  contextStart: number,
  fromBeat: Beat = 0,
  untilBeat: Beat = Infinity,
): ScheduledClip | null {
  if (clip.outBeat <= clip.inBeat) {
    throw new RangeError(`Clip vazio: inBeat ${clip.inBeat}, outBeat ${clip.outBeat}`)
  }
  const endBeat = Math.min(untilBeat, clip.startBeat + (clip.outBeat - clip.inBeat))
  if (endBeat <= fromBeat || clip.startBeat >= endBeat) return null

  const skipped = Math.max(0, fromBeat - clip.startBeat)
  const playbackRate = stretchRatio(grid.bpm, groupBpm)
  let when = contextStart + beatsToSeconds(clip.startBeat + skipped - fromBeat, groupBpm)
  let offset = grid.firstBeatSeconds + beatsToSeconds(clip.inBeat + skipped, grid.bpm)
  if (offset < 0) {
    // O trecho começa antes do início do arquivo: espera o arquivo começar.
    when += -offset / playbackRate
    offset = 0
  }
  return {
    when,
    offset,
    stopAt: contextStart + beatsToSeconds(endBeat - fromBeat, groupBpm),
    playbackRate,
  }
}
