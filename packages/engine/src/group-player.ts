// SPDX-License-Identifier: AGPL-3.0-or-later
import { beatsToSeconds, type Beat } from '@djmixer/shared'
import { scheduleClip, type BeatGrid, type ClipPlacement } from './schedule.ts'

export interface ChannelInput {
  buffer: AudioBuffer
  grid: BeatGrid
  clip: ClipPlacement
  gain?: number
  /** Destino do canal; o padrão é a saída do contexto. */
  output?: AudioNode
}

export interface GroupOptions {
  bpm: number
  /** Momento, no relógio do contexto, em que `fromBeat` toca. */
  startAt: number
  fromBeat?: Beat
}

export interface ScheduledGroup {
  /** Duração do trecho agendado, em segundos. */
  durationSeconds: number
  stop(): void
}

/** Agenda todos os canais de um grupo no relógio do contexto (tempo real ou offline). */
export function scheduleGroup(
  ctx: BaseAudioContext,
  channels: ChannelInput[],
  options: GroupOptions,
): ScheduledGroup {
  const fromBeat = options.fromBeat ?? 0
  const sources: AudioBufferSourceNode[] = []
  let endBeat = fromBeat

  for (const channel of channels) {
    const plan = scheduleClip(channel.clip, channel.grid, options.bpm, options.startAt, fromBeat)
    if (!plan) continue
    const source = ctx.createBufferSource()
    source.buffer = channel.buffer
    source.playbackRate.value = plan.playbackRate
    const gain = ctx.createGain()
    gain.gain.value = channel.gain ?? 1
    source.connect(gain).connect(channel.output ?? ctx.destination)
    source.start(plan.when, plan.offset)
    source.stop(plan.stopAt)
    sources.push(source)
    endBeat = Math.max(endBeat, channel.clip.startBeat + channel.clip.outBeat - channel.clip.inBeat)
  }

  return {
    durationSeconds: beatsToSeconds(endBeat - fromBeat, options.bpm),
    stop() {
      for (const source of sources) {
        try {
          source.stop()
        } catch {
          // Já parado.
        }
      }
    },
  }
}

/** Agenda um clique curto em cada batida do grupo, para conferir o alinhamento de ouvido. */
export function scheduleMetronome(
  ctx: BaseAudioContext,
  options: GroupOptions & { beats: number; output?: AudioNode },
): AudioScheduledSourceNode[] {
  const fromBeat = options.fromBeat ?? 0
  const nodes: AudioScheduledSourceNode[] = []
  for (let beat = Math.ceil(fromBeat); beat < fromBeat + options.beats; beat++) {
    const when = options.startAt + beatsToSeconds(beat - fromBeat, options.bpm)
    const osc = ctx.createOscillator()
    osc.frequency.value = beat % 4 === 0 ? 1760 : 1320
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.3, when)
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.03)
    osc.connect(env).connect(options.output ?? ctx.destination)
    osc.start(when)
    osc.stop(when + 0.04)
    nodes.push(osc)
  }
  return nodes
}
