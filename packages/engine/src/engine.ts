// SPDX-License-Identifier: AGPL-3.0-or-later
// Interface do motor usada pelo app: toca um grupo, ensaia uma transição em loop, toca o set na
// ordem dos grupos e renderiza offline. O motor não sabe de onde vem o áudio: o app entrega cada
// faixa já decodificada (e esticada para o BPM do grupo, com key lock) por um `TrackLoader`.
import {
  beatsToSeconds,
  groupEndBeat,
  secondsToBeats,
  type Beat,
  type Group,
  type Project,
  type Track,
} from '@djmixer/shared'
import { scheduleGroup, type ChannelInput, type ScheduledGroup } from './group-player.ts'
import type { BeatGrid } from './schedule.ts'

/** Áudio de uma faixa pronto para um grupo, com o beatgrid do buffer entregue. */
export interface PreparedTrack {
  buffer: AudioBuffer
  grid: BeatGrid
}

/**
 * Entrega o áudio de uma faixa para um grupo. Com key lock, o buffer já vem esticado para o BPM
 * do grupo; sem key lock, vem o original e o motor ajusta o `playbackRate` (varispeed).
 * O app guarda o cache; o motor pode pedir a mesma faixa várias vezes.
 */
export type TrackLoader = (track: Track, group: Group) => Promise<PreparedTrack>

/** O que tocar. */
export type PlaybackRequest =
  | { kind: 'group'; groupId: string; fromBeat?: Beat }
  | { kind: 'loop'; groupId: string; startBeat: Beat; endBeat: Beat }
  | { kind: 'set'; groupIndex?: number; fromBeat?: Beat }

/** Trecho contínuo de um grupo, em batidas do grupo. */
export interface Segment {
  groupId: string
  fromBeat: Beat
  untilBeat: Beat
}

export interface PlaybackPosition {
  groupId: string
  beat: Beat
}

/**
 * Sequência de trechos de um pedido. O loop é infinito; o set percorre os grupos a partir de
 * `groupIndex`. O projeto é lido de novo a cada trecho, então edições valem na volta seguinte.
 */
export function* playbackSegments(
  getProject: () => Project,
  request: PlaybackRequest,
): Generator<Segment> {
  const findGroup = (id: string) => getProject().groups.find((group) => group.id === id)
  switch (request.kind) {
    case 'group': {
      const group = findGroup(request.groupId)
      if (group) {
        yield { groupId: group.id, fromBeat: request.fromBeat ?? 0, untilBeat: groupEndBeat(group) }
      }
      return
    }
    case 'loop': {
      if (request.endBeat <= request.startBeat) return
      while (findGroup(request.groupId)) {
        yield { groupId: request.groupId, fromBeat: request.startBeat, untilBeat: request.endBeat }
      }
      return
    }
    case 'set': {
      let fromBeat = request.fromBeat ?? 0
      for (let i = request.groupIndex ?? 0; i < getProject().groups.length; i++) {
        const group = getProject().groups[i]
        if (!group) return
        const untilBeat = groupEndBeat(group)
        if (untilBeat > fromBeat) yield { groupId: group.id, fromBeat, untilBeat }
        fromBeat = 0
      }
    }
  }
}

/** Monta os canais de um grupo para `scheduleGroup`, com o áudio já carregado por faixa. */
export function groupChannels(
  group: Group,
  prepared: Map<string, PreparedTrack>,
  output: AudioNode,
): ChannelInput[] {
  return group.channels.flatMap((channel) => {
    const track = prepared.get(channel.trackId)
    if (!track || channel.clip.outBeat <= channel.clip.inBeat) return []
    return [
      {
        buffer: track.buffer,
        grid: track.grid,
        clip: channel.clip,
        lanes: channel.lanes,
        eq: group.eq,
        output,
      },
    ]
  })
}

/** Carrega todas as faixas usadas num grupo. */
export async function prepareGroup(
  project: Project,
  group: Group,
  load: TrackLoader,
): Promise<Map<string, PreparedTrack>> {
  const ids = [...new Set(group.channels.map((channel) => channel.trackId))]
  const entries = await Promise.all(
    ids.map(async (id) => {
      const track = project.tracks.find((candidate) => candidate.id === id)
      return track ? ([id, await load(track, group)] as const) : undefined
    }),
  )
  return new Map(entries.filter((entry) => entry !== undefined))
}

export interface Master {
  input: AudioNode
  output: AudioNode
}

/**
 * Saída do mix: um compressor rápido logo abaixo de 0 dBFS e uma saturação suave que segura o
 * que o compressor deixar passar, para que dois canais cheios numa transição não estourem.
 * É uma proteção, não a normalização de loudness da fase 2.
 */
export function createMaster(ctx: BaseAudioContext, destination: AudioNode): Master {
  const input = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.2
  const clip = ctx.createWaveShaper()
  clip.curve = SOFT_CLIP
  input.connect(limiter).connect(clip).connect(destination)
  return { input, output: clip }
}

/** Linear até 0,8; acima disso, curva tanh que nunca passa de 1. */
const SOFT_CLIP = (() => {
  const curve = new Float32Array(4097)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    const magnitude = Math.abs(x)
    const y = magnitude < 0.8 ? magnitude : 0.8 + 0.2 * Math.tanh((magnitude - 0.8) / 0.2)
    curve[i] = Math.sign(x) * y
  }
  return curve
})()

export interface EngineOptions {
  ctx: AudioContext
  getProject: () => Project
  load: TrackLoader
  /** Quanto antes do fim de um trecho o seguinte é agendado. */
  lookaheadSeconds?: number
  onEnded?: () => void
  onError?: (error: unknown) => void
}

export interface Engine {
  play(request: PlaybackRequest): Promise<void>
  stop(): void
  /** Onde está tocando agora, ou null se parado ou ainda carregando. */
  position(): PlaybackPosition | null
  readonly playing: boolean
}

interface Scheduled {
  segment: Segment
  bpm: number
  startAt: number
  endAt: number
  handle: ScheduledGroup
}

export function createEngine(options: EngineOptions): Engine {
  const { ctx, getProject, load } = options
  const lookahead = options.lookaheadSeconds ?? 4
  const master = createMaster(ctx, ctx.destination)
  let session = 0
  let playing = false
  let timer: ReturnType<typeof setInterval> | undefined
  let scheduled: Scheduled[] = []

  const groupOf = (id: string) => getProject().groups.find((group) => group.id === id)

  const stop = () => {
    session++
    playing = false
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    for (const item of scheduled) item.handle.stop()
    scheduled = []
  }

  return {
    get playing() {
      return playing
    },
    stop,
    position() {
      const now = ctx.currentTime
      const current = scheduled.find((item) => item.startAt <= now && now < item.endAt)
      if (!current) return null
      return {
        groupId: current.segment.groupId,
        beat: current.segment.fromBeat + secondsToBeats(now - current.startAt, current.bpm),
      }
    },
    async play(request) {
      stop()
      const id = session
      playing = true
      if (ctx.state === 'suspended') await ctx.resume()
      const segments = playbackSegments(getProject, request)
      let next = segments.next()
      let nextStart = 0
      let busy = false

      const prefetch = (segment: Segment | undefined) => {
        const group = segment && groupOf(segment.groupId)
        if (group) prepareGroup(getProject(), group, load).catch(() => undefined)
      }

      const scheduleNext = async () => {
        if (next.done) return
        const segment = next.value
        const group = groupOf(segment.groupId)
        next = segments.next()
        if (!group) return
        const prepared = await prepareGroup(getProject(), group, load)
        if (id !== session) return
        // Se carregar atrasou, o trecho começa assim que der, sem tentar alcançar o relógio.
        const startAt = Math.max(nextStart, ctx.currentTime + 0.05)
        const handle = scheduleGroup(ctx, groupChannels(group, prepared, master.input), {
          bpm: group.bpm,
          startAt,
          fromBeat: segment.fromBeat,
          untilBeat: segment.untilBeat,
        })
        const endAt = startAt + beatsToSeconds(segment.untilBeat - segment.fromBeat, group.bpm)
        scheduled.push({ segment, bpm: group.bpm, startAt, endAt, handle })
        nextStart = endAt
        if (!next.done && next.value.groupId !== segment.groupId) prefetch(next.value)
      }

      const tick = async () => {
        if (busy || id !== session) return
        busy = true
        try {
          const now = ctx.currentTime
          scheduled = scheduled.filter((item) => item.endAt > now - 1)
          if (!next.done && nextStart - now < lookahead) await scheduleNext()
          else if (next.done && now >= nextStart) {
            stop()
            options.onEnded?.()
          }
        } catch (error) {
          stop()
          options.onError?.(error)
        } finally {
          busy = false
        }
      }

      try {
        await scheduleNext()
      } catch (error) {
        stop()
        throw error
      }
      if (id !== session) return
      timer = setInterval(() => void tick(), 100)
    },
  }
}

export interface RenderOptions {
  sampleRate?: number
  fromBeat?: Beat
  untilBeat?: Beat
  /**
   * Cria o OfflineAudioContext. No navegador é `new OfflineAudioContext(...)`; nos testes vem do
   * node-web-audio-api.
   */
  createContext: (
    channels: number,
    length: number,
    sampleRate: number,
  ) => BaseAudioContext & { startRendering(): Promise<AudioBuffer> }
}

/** Renderiza um grupo offline em estéreo, com o mesmo grafo da reprodução em tempo real. */
export async function renderGroup(
  project: Project,
  group: Group,
  load: TrackLoader,
  options: RenderOptions,
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100
  const fromBeat = options.fromBeat ?? 0
  const untilBeat = options.untilBeat ?? groupEndBeat(group)
  const length = Math.max(
    1,
    Math.round(beatsToSeconds(untilBeat - fromBeat, group.bpm) * sampleRate),
  )
  const prepared = await prepareGroup(project, group, load)
  const ctx = options.createContext(2, length, sampleRate)
  const master = createMaster(ctx, ctx.destination)
  scheduleGroup(ctx, groupChannels(group, prepared, master.input), {
    bpm: group.bpm,
    startAt: 0,
    fromBeat,
    untilBeat,
  })
  return ctx.startRendering()
}
