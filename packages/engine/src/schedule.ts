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
 * `fromBeat` permite tocar o grupo a partir do meio; clips que já terminaram devolvem null.
 *
 * Na fase 0 o casamento de BPM usa `playbackRate` (muda o tom). O spike 3 troca isso por
 * time-stretch com key lock aplicado offline, mantendo o mesmo agendamento.
 */
export function scheduleClip(
  clip: ClipPlacement,
  grid: BeatGrid,
  groupBpm: number,
  contextStart: number,
  fromBeat: Beat = 0,
): ScheduledClip | null {
  if (clip.outBeat <= clip.inBeat) {
    throw new RangeError(`Clip vazio: inBeat ${clip.inBeat}, outBeat ${clip.outBeat}`)
  }
  const endBeat = clip.startBeat + (clip.outBeat - clip.inBeat)
  if (endBeat <= fromBeat) return null

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
