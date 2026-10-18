// SPDX-License-Identifier: AGPL-3.0-or-later
// Áudio da interface: um AudioContext a 44,1 kHz, o carregamento das faixas (decodificadas pelo
// host, esticadas para o BPM do grupo com key lock e guardadas em cache) e o motor.
import {
  createEngine,
  createMaster,
  pcm24,
  renderGroup,
  scheduleMetronome,
  wavHeader,
  type Engine,
  type PlaybackRequest,
  type PreparedTrack,
  type TrackLoader,
} from '@djmixer/engine'
import {
  beatsToSeconds,
  stretchRatio,
  tracklistText,
  type Beat,
  type Group,
  type Project,
  type Track,
} from '@djmixer/shared'
import { SAMPLE_RATE, type ExportResult } from '../host/api.ts'
import { host } from './host.ts'
import { useApp } from './store.ts'
import type { StretchRequest, StretchResponse } from './workers/stretch.worker.ts'

let context: AudioContext | undefined

export function audioContext(): AudioContext {
  context ??= new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' })
  return context
}

/** Cache pequeno: cada faixa decodificada ocupa ~100 MB por 5 minutos. */
class Lru<V> {
  private readonly items = new Map<string, Promise<V>>()
  private readonly limit: number
  constructor(limit: number) {
    this.limit = limit
  }
  get(key: string, make: () => Promise<V>): Promise<V> {
    const hit = this.items.get(key)
    if (hit) {
      this.items.delete(key)
      this.items.set(key, hit)
      return hit
    }
    const value = make()
    this.items.set(key, value)
    value.catch(() => this.items.delete(key))
    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined) break
      this.items.delete(oldest)
    }
    return value
  }
}

const decoded = new Lru<AudioBuffer>(8)
const stretched = new Lru<AudioBuffer>(8)

async function fetchPcm(kind: 'decoded' | 'stretched', key: string): Promise<Float32Array | null> {
  if (host.readMedia) {
    const data = await host.readMedia(kind, key)
    return data ? new Float32Array(data) : null
  }
  const response = await fetch(host.mediaUrl(kind, key))
  if (response.status === 404) return null
  if (!response.ok) throw new Error((await response.text()) || `erro ${response.status}`)
  return new Float32Array(await response.arrayBuffer())
}

function toBuffer(interleaved: Float32Array): AudioBuffer {
  const frames = Math.max(1, interleaved.length / 2)
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate: SAMPLE_RATE })
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  for (let i = 0; i < interleaved.length / 2; i++) {
    left[i] = interleaved[2 * i] ?? 0
    right[i] = interleaved[2 * i + 1] ?? 0
  }
  return buffer
}

function interleave(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const out = new Float32Array(buffer.length * 2)
  for (let i = 0; i < buffer.length; i++) {
    out[2 * i] = left[i] ?? 0
    out[2 * i + 1] = right[i] ?? 0
  }
  return out
}

/** PCM decodificado pelo host (o ffmpeg roda na primeira vez e fica em cache no disco). */
export async function decodedPcm(hash: string): Promise<Float32Array> {
  const pcm = await fetchPcm('decoded', hash)
  if (!pcm) throw new Error('faixa não está na biblioteca')
  return pcm
}

export function decodedBuffer(hash: string): Promise<AudioBuffer> {
  return decoded.get(hash, async () => toBuffer(await decodedPcm(hash)))
}

let stretchWorker: Worker | undefined
let stretchSeq = 0
const stretchJobs = new Map<number, (response: StretchResponse) => void>()

function stretchInWorker(buffer: AudioBuffer, timeRatio: number): Promise<AudioBuffer> {
  if (!stretchWorker) {
    stretchWorker = new Worker(new URL('./workers/stretch.worker.ts', import.meta.url), {
      type: 'module',
    })
    stretchWorker.onmessage = (event: MessageEvent<StretchResponse>) => {
      stretchJobs.get(event.data.id)?.(event.data)
      stretchJobs.delete(event.data.id)
    }
  }
  const worker = stretchWorker
  const id = ++stretchSeq
  return new Promise((resolve, reject) => {
    stretchJobs.set(id, (response) => {
      if (!response.ok) return reject(new Error(`time-stretch: ${response.error}`))
      const out = new AudioBuffer({
        numberOfChannels: 2,
        length: Math.max(1, response.left.length),
        sampleRate: SAMPLE_RATE,
      })
      out.copyToChannel(response.left as Float32Array<ArrayBuffer>, 0)
      out.copyToChannel(response.right as Float32Array<ArrayBuffer>, 1)
      resolve(out)
    })
    // Cópias: o buffer original continua no cache para outros grupos.
    const request: StretchRequest = {
      id,
      left: buffer.getChannelData(0).slice(),
      right: buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0).slice(),
      timeRatio,
    }
    worker.postMessage(request, [request.left.buffer, request.right.buffer])
  })
}

/** Abaixo disso a diferença de BPM é inaudível e a faixa toca sem stretch. */
const SAME_TEMPO = 1e-4

/**
 * Áudio de uma faixa para um grupo. Com key lock, estica com o Rubber Band R3 uma vez por
 * combinação de faixa e BPM e guarda o resultado no disco; sem key lock, entrega o original e
 * o motor ajusta a velocidade (varispeed).
 */
export const loadTrack: TrackLoader = async (track: Track, group: Group) => {
  const buffer = await decodedBuffer(track.hash)
  const ratio = stretchRatio(track.grid.bpm, group.bpm)
  if (!group.keyLock || Math.abs(ratio - 1) < SAME_TEMPO) return { buffer, grid: track.grid }
  const timeRatio = track.grid.bpm / group.bpm
  const key = `${track.hash}_${track.grid.bpm.toFixed(4)}_${group.bpm.toFixed(4)}`
  const out = await stretched.get(key, async () => {
    const cached = await fetchPcm('stretched', key)
    if (cached) return toBuffer(cached)
    useApp.getState().set({ loading: true })
    const result = await stretchInWorker(buffer, timeRatio)
    void host
      .saveStretched(key, new Uint8Array(interleave(result).buffer))
      .catch((error: unknown) => console.warn('cache de stretch não salvo', error))
    return result
  })
  const prepared: PreparedTrack = {
    buffer: out,
    grid: { bpm: group.bpm, firstBeatSeconds: track.grid.firstBeatSeconds * timeRatio },
  }
  return prepared
}

let engine: Engine | undefined

function getEngine(): Engine {
  engine ??= createEngine({
    ctx: audioContext(),
    getProject: () => useApp.getState().project,
    load: loadTrack,
    onEnded: () => useApp.getState().set({ playing: null }),
    onError: (error) =>
      useApp.getState().set({
        playing: null,
        loading: false,
        notice: { kind: 'error', text: errorText(error) },
      }),
  })
  return engine
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function play(request: PlaybackRequest): Promise<void> {
  const { set } = useApp.getState()
  stopPreview()
  const kind = request.kind
  set({ playing: kind, loading: true })
  try {
    await getEngine().play(request)
    if (useApp.getState().playing === kind) set({ loading: false })
  } catch (error) {
    set({ playing: null, loading: false, notice: { kind: 'error', text: errorText(error) } })
  }
}

export function stop(): void {
  engine?.stop()
  stopPreview()
  useApp.getState().set({ playing: null, loading: false })
}

export function playbackPosition(): { groupId: string; beat: Beat } | null {
  return engine?.playing ? engine.position() : null
}

// Prévia do editor de beatgrid: a faixa original a partir de um ponto, com metrônomo na grade.
let preview: { stop(): void; startAt: number; fromSeconds: number } | undefined

export async function startPreview(
  track: Pick<Track, 'hash' | 'grid'>,
  fromSeconds: number,
  metronome: boolean,
): Promise<void> {
  stop()
  const ctx = audioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const buffer = await decodedBuffer(track.hash)
  const master = createMaster(ctx, ctx.destination)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(master.input)
  const startAt = ctx.currentTime + 0.05
  source.start(startAt, Math.max(0, fromSeconds))
  const nodes: AudioScheduledSourceNode[] = [source]
  if (metronome) {
    // Primeira batida da grade depois do ponto de partida, no relógio do contexto.
    const { bpm, firstBeatSeconds } = track.grid
    const firstBeat = Math.ceil(((fromSeconds - firstBeatSeconds) * bpm) / 60)
    const beatSeconds = firstBeatSeconds + beatsToSeconds(firstBeat, bpm)
    nodes.push(
      ...scheduleMetronome(ctx, {
        bpm,
        startAt: startAt + beatSeconds - fromSeconds,
        fromBeat: firstBeat,
        beats: Math.ceil(((buffer.duration - beatSeconds) * bpm) / 60),
        output: master.input,
      }),
    )
  }
  preview = {
    startAt,
    fromSeconds,
    stop: () => {
      for (const node of nodes) {
        try {
          node.stop()
        } catch {
          // Já parado.
        }
      }
      master.output.disconnect()
    },
  }
}

export function stopPreview(): void {
  preview?.stop()
  preview = undefined
}

/** Segundo da faixa tocando na prévia, ou null. */
export function previewSeconds(): number | null {
  if (!preview) return null
  return preview.fromSeconds + (audioContext().currentTime - preview.startAt)
}

/** Quantos frames por envio ao host durante o export (10 s). */
const EXPORT_CHUNK_FRAMES = SAMPLE_RATE * 10

/**
 * Renderiza o set grupo a grupo (OfflineAudioContext, mesmo grafo da reprodução) e grava um WAV
 * de 24 bits em partes, mais a tracklist em texto ao lado.
 */
export async function exportSet(
  project: Project,
  onProgress: (label: string, fraction: number) => void,
): Promise<ExportResult | null> {
  if (!project.groups.some((group) => group.channels.length > 0)) {
    throw new Error('O set está vazio: adicione faixas a um grupo antes de exportar.')
  }
  const target = await host.exportBegin(project.name || 'set')
  if (!target) return null
  let bytes = 0
  try {
    for (const [index, group] of project.groups.entries()) {
      if (group.channels.length === 0) continue
      const label = `Grupo ${index + 1} de ${project.groups.length}: ${group.name}`
      onProgress(`${label} (preparando faixas)`, index / project.groups.length)
      const rendered = await renderGroup(project, group, loadTrack, {
        sampleRate: SAMPLE_RATE,
        createContext: (channels, length, sampleRate) =>
          new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate }),
      })
      const left = rendered.getChannelData(0)
      const right = rendered.getChannelData(1)
      for (let start = 0; start < rendered.length; start += EXPORT_CHUNK_FRAMES) {
        const end = Math.min(rendered.length, start + EXPORT_CHUNK_FRAMES)
        const chunk = pcm24([left.subarray(start, end), right.subarray(start, end)])
        await host.exportChunk(target.id, chunk)
        bytes += chunk.byteLength
        onProgress(label, (index + end / rendered.length) / project.groups.length)
      }
    }
    return await host.exportEnd(
      target.id,
      wavHeader(SAMPLE_RATE, 2, 24, bytes),
      tracklistText(project),
    )
  } catch (error) {
    await host.exportAbort(target.id)
    throw error
  }
}
