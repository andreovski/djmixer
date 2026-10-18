// SPDX-License-Identifier: AGPL-3.0-or-later
import { beatsToSeconds, type Beat, type Lane, type LaneKind } from '@djmixer/shared'
import { createChannelStrip, type EqMode } from './channel-strip.ts'
import { findLane, NEUTRAL, sampleLane } from './lanes.ts'
import { scheduleClip, type BeatGrid, type ClipPlacement } from './schedule.ts'

/** Pontos de automação por segundo enviados ao AudioParam. */
const CONTROL_RATE = 200

export interface ChannelInput {
  buffer: AudioBuffer
  grid: BeatGrid
  clip: ClipPlacement
  /** Automação em beats do grupo. Lanes ausentes ficam no valor neutro. */
  lanes?: Lane[]
  eq?: EqMode
  /** Destino do canal; o padrão é a saída do contexto. */
  output?: AudioNode
}

export interface GroupOptions {
  bpm: number
  /** Momento, no relógio do contexto, em que `fromBeat` toca. */
  startAt: number
  fromBeat?: Beat
  /** Batida do grupo em que tudo para; o padrão é o fim do último clip. */
  untilBeat?: Beat
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
  const untilBeat = options.untilBeat ?? Infinity
  const sources: AudioBufferSourceNode[] = []
  const strips: AudioNode[] = []
  let endBeat = fromBeat

  for (const channel of channels) {
    const plan = scheduleClip(
      channel.clip,
      channel.grid,
      options.bpm,
      options.startAt,
      fromBeat,
      untilBeat,
    )
    if (!plan) continue
    const source = ctx.createBufferSource()
    source.buffer = channel.buffer
    source.playbackRate.value = plan.playbackRate
    const strip = createChannelStrip(ctx, channel.eq ?? 'isolator')
    source.connect(strip.input)
    strip.output.connect(channel.output ?? ctx.destination)

    // A curva cobre o trecho audível do clip, do momento em que ele começa a soar até parar.
    const clipEnd = Math.min(
      untilBeat,
      channel.clip.startBeat + channel.clip.outBeat - channel.clip.inBeat,
    )
    const curveFrom = Math.max(fromBeat, channel.clip.startBeat)
    const curveStart = options.startAt + beatsToSeconds(curveFrom - fromBeat, options.bpm)
    const duration = plan.stopAt - curveStart
    const steps = Math.ceil(duration * CONTROL_RATE) + 1
    for (const [kind, targets] of Object.entries(strip.targets) as [
      LaneKind,
      typeof strip.targets.volume,
    ][]) {
      const points = findLane(channel.lanes, kind)
      for (const target of targets ?? []) {
        const curve = sampleLane(points, NEUTRAL[kind], curveFrom, clipEnd, steps, target.map)
        target.param.setValueAtTime(curve[0] ?? 0, 0)
        target.param.setValueCurveAtTime(curve, curveStart, duration)
      }
    }

    source.start(plan.when, plan.offset)
    source.stop(plan.stopAt)
    sources.push(source)
    strips.push(strip.output)
    endBeat = Math.max(endBeat, clipEnd)
  }
  if (Number.isFinite(untilBeat)) endBeat = Math.max(endBeat, untilBeat)

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
      for (const output of strips) output.disconnect()
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
