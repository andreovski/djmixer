// SPDX-License-Identifier: AGPL-3.0-or-later
// Spike 1 da fase 0: duas faixas com BPMs diferentes tocando em fase pelo relógio do AudioContext.
import {
  detectOnsets,
  encodeWav,
  measureDrift,
  renderSynthetic,
  scheduleGroup,
  scheduleMetronome,
  type ChannelInput,
  type ScheduledGroup,
} from '@djmixer/engine'
import { beatsToSeconds } from '@djmixer/shared'

interface TrackForm {
  root: HTMLFieldSetElement
  buffer: AudioBuffer | null
  synthetic: { bpm: number; toneHz: number; leadInSeconds: number }
}

const ctx = new AudioContext()
const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Elemento ausente: ${selector}`)
  return el
}
const log = $<HTMLPreElement>('#log')
const tracks: [TrackForm, TrackForm] = [
  { root: $('#track-a'), buffer: null, synthetic: { bpm: 124, toneHz: 440, leadInSeconds: 0 } },
  { root: $('#track-b'), buffer: null, synthetic: { bpm: 128, toneHz: 660, leadInSeconds: 0.37 } },
]

const field = (track: TrackForm, name: string) =>
  track.root.querySelector<HTMLInputElement>(`[data-field="${name}"]`)
const numberField = (track: TrackForm, name: string) => Number(field(track, name)?.value)
const numberInput = (selector: string) => Number($<HTMLInputElement>(selector).value)

for (const track of tracks) {
  field(track, 'file')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    const status = track.root.querySelector('[data-field="status"]')
    if (!file || !status) return
    status.textContent = 'decodificando…'
    try {
      track.buffer = await ctx.decodeAudioData(await file.arrayBuffer())
      status.textContent = `${file.name} (${track.buffer.duration.toFixed(1)} s)`
    } catch (error) {
      track.buffer = null
      status.textContent = `não foi possível decodificar: ${String(error)}`
    }
  })
}

function bufferFor(target: BaseAudioContext, track: TrackForm): AudioBuffer {
  if (track.buffer) return track.buffer
  const samples = renderSynthetic({ ...track.synthetic, beats: 256 }, target.sampleRate)
  const buffer = target.createBuffer(1, samples.length, target.sampleRate)
  buffer.copyToChannel(samples, 0)
  return buffer
}

function readGroup() {
  const bpm = numberInput('#group-bpm')
  const entryBeat = numberInput('#entry-beat')
  const transitionBeats = numberInput('#bars') * 4
  return { bpm, entryBeat, transitionBeats, endBeat: entryBeat + transitionBeats }
}

function channels(
  target: BaseAudioContext,
  outputs: [AudioNode?, AudioNode?] = [],
): ChannelInput[] {
  const group = readGroup()
  const [a, b] = tracks
  const aIn = numberField(a, 'inBeat')
  const bIn = numberField(b, 'inBeat')
  const channel = (track: TrackForm, inBeat: number, startBeat: number, output?: AudioNode) => ({
    buffer: bufferFor(target, track),
    grid: { bpm: numberField(track, 'bpm'), firstBeatSeconds: numberField(track, 'firstBeat') },
    clip: { inBeat, outBeat: inBeat + group.endBeat - startBeat, startBeat },
    ...(output ? { output } : {}),
  })
  return [channel(a, aIn, 0, outputs[0]), channel(b, bIn, group.entryBeat, outputs[1])]
}

let playing: { group: ScheduledGroup; clicks: AudioScheduledSourceNode[] } | null = null

function stop() {
  playing?.group.stop()
  playing?.clicks.forEach((node) => node.stop())
  playing = null
}

$('#play').addEventListener('click', async () => {
  stop()
  await ctx.resume()
  const group = readGroup()
  const fromBeat = numberInput('#from-beat')
  const startAt = ctx.currentTime + 0.1
  const scheduled = scheduleGroup(ctx, channels(ctx), { bpm: group.bpm, startAt, fromBeat })
  const clicks = $<HTMLInputElement>('#metronome').checked
    ? scheduleMetronome(ctx, { bpm: group.bpm, startAt, fromBeat, beats: group.endBeat - fromBeat })
    : []
  playing = { group: scheduled, clicks }
  log.textContent = `Tocando do beat ${fromBeat} ao ${group.endBeat} (${scheduled.durationSeconds.toFixed(1)} s).`
})

$('#stop').addEventListener('click', stop)

$('#render').addEventListener('click', async () => {
  const group = readGroup()
  const seconds = beatsToSeconds(group.endBeat, group.bpm)
  const offline = new OfflineAudioContext(2, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate)
  // A no canal esquerdo e B no direito, para medir cada faixa separadamente.
  const merger = offline.createChannelMerger(2)
  merger.connect(offline.destination)
  const left = offline.createGain()
  left.connect(merger, 0, 0)
  const right = offline.createGain()
  right.connect(merger, 0, 1)
  scheduleGroup(offline, channels(offline, [left, right]), { bpm: group.bpm, startAt: 0 })

  log.textContent = 'Renderizando…'
  const started = performance.now()
  const rendered = await offline.startRendering()
  const elapsed = (performance.now() - started) / 1000

  const entry = beatsToSeconds(group.entryBeat, group.bpm)
  const a = detectOnsets(rendered.getChannelData(0), rendered.sampleRate, 0.4).filter(
    (t) => t >= entry - 0.01,
  )
  const b = detectOnsets(rendered.getChannelData(1), rendered.sampleRate, 0.4)
  const drift = measureDrift(a, b)
  const synthetic = tracks.every((track) => !track.buffer)

  const wav = encodeWav(
    [rendered.getChannelData(0), rendered.getChannelData(1)],
    rendered.sampleRate,
  )
  const link = $<HTMLAnchorElement>('#download')
  URL.revokeObjectURL(link.href)
  link.href = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }))
  link.hidden = false

  log.textContent = [
    `Render de ${seconds.toFixed(1)} s em ${elapsed.toFixed(2)} s.`,
    `Batidas pareadas na transição: ${drift.matched} de ${group.transitionBeats}.`,
    `Desvio máximo: ${(drift.maxSeconds * 1000).toFixed(3)} ms; médio: ${(drift.meanSeconds * 1000).toFixed(3)} ms.`,
    synthetic
      ? 'Faixas sintéticas: a medição é confiável.'
      : 'Com música real a detecção por limiar não é confiável; ouça o WAV (A à esquerda, B à direita).',
  ].join('\n')
})
