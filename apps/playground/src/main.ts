// SPDX-License-Identifier: AGPL-3.0-or-later
// Spikes 1 e 2 da fase 0: duas faixas com BPMs diferentes tocando em fase pelo relógio do
// AudioContext, com automação de volume, EQ e filtro na transição.
import {
  detectOnsets,
  encodeWav,
  measureDrift,
  renderSynthetic,
  scheduleGroup,
  scheduleMetronome,
  type ChannelInput,
  type EqMode,
  type ScheduledGroup,
} from '@djmixer/engine'
import { beatsToSeconds, type Lane } from '@djmixer/shared'
import { drawLanes, LEGEND } from './lanes-view.ts'
import { TRANSITIONS, transitionLanes, type TransitionName } from './transitions.ts'

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

const transitionSelect = $<HTMLSelectElement>('#transition')
for (const [value, label] of Object.entries(TRANSITIONS)) {
  transitionSelect.add(new Option(label, value, value === 'bass-swap', value === 'bass-swap'))
}
for (const [kind, color] of LEGEND) {
  const swatch = document.createElement('span')
  swatch.textContent = `■ ${kind} `
  swatch.style.color = color
  $('#legend').append(swatch)
}

function readGroup() {
  const bpm = numberInput('#group-bpm')
  const entryBeat = numberInput('#entry-beat')
  const transitionBeats = numberInput('#bars') * 4
  const transition = transitionSelect.value as TransitionName
  const eq = $<HTMLSelectElement>('#eq').value as EqMode
  const lanes = transitionLanes(transition, entryBeat, transitionBeats)
  return { bpm, entryBeat, transitionBeats, endBeat: entryBeat + transitionBeats, eq, lanes }
}

function redraw() {
  const group = readGroup()
  const from = group.entryBeat - 8
  const to = group.endBeat + 4
  drawLanes($<HTMLCanvasElement>('#lanes-a'), group.lanes[0], from, to)
  drawLanes($<HTMLCanvasElement>('#lanes-b'), group.lanes[1], from, to)
}
document.querySelectorAll('input, select').forEach((el) => el.addEventListener('change', redraw))
redraw()

function channels(
  target: BaseAudioContext,
  outputs: [AudioNode?, AudioNode?] = [],
  withLanes = true,
): ChannelInput[] {
  const group = readGroup()
  const [a, b] = tracks
  const aIn = numberField(a, 'inBeat')
  const bIn = numberField(b, 'inBeat')
  const channel = (
    track: TrackForm,
    inBeat: number,
    startBeat: number,
    lanes: Lane[],
    output?: AudioNode,
  ) => ({
    buffer: bufferFor(target, track),
    eq: group.eq,
    lanes,
    grid: { bpm: numberField(track, 'bpm'), firstBeatSeconds: numberField(track, 'firstBeat') },
    clip: { inBeat, outBeat: inBeat + group.endBeat - startBeat, startBeat },
    ...(output ? { output } : {}),
  })
  return [
    channel(a, aIn, 0, withLanes ? group.lanes[0] : [], outputs[0]),
    channel(b, bIn, group.entryBeat, withLanes ? group.lanes[1] : [], outputs[1]),
  ]
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

/** Render offline do grupo inteiro. `split` põe A no canal esquerdo e B no direito, sem automação. */
async function renderGroup(split: boolean): Promise<AudioBuffer> {
  const group = readGroup()
  const seconds = beatsToSeconds(group.endBeat, group.bpm)
  const offline = new OfflineAudioContext(2, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate)
  let outputs: [AudioNode?, AudioNode?] = []
  if (split) {
    const merger = offline.createChannelMerger(2)
    merger.connect(offline.destination)
    const left = offline.createGain()
    left.connect(merger, 0, 0)
    const right = offline.createGain()
    right.connect(merger, 0, 1)
    outputs = [left, right]
  }
  scheduleGroup(offline, channels(offline, outputs, !split), { bpm: group.bpm, startAt: 0 })
  return offline.startRendering()
}

$('#render').addEventListener('click', async () => {
  const group = readGroup()
  log.textContent = 'Renderizando…'
  const started = performance.now()
  const mix = await renderGroup(false)
  const elapsed = (performance.now() - started) / 1000

  // A medição de sincronia usa um segundo render sem automação, com cada faixa num canal.
  const measured = await renderGroup(true)
  const entry = beatsToSeconds(group.entryBeat, group.bpm)
  const a = detectOnsets(measured.getChannelData(0), measured.sampleRate, 0.4).filter(
    (t) => t >= entry - 0.01,
  )
  const b = detectOnsets(measured.getChannelData(1), measured.sampleRate, 0.4)
  const drift = measureDrift(a, b)
  const synthetic = tracks.every((track) => !track.buffer)

  const wav = encodeWav([mix.getChannelData(0), mix.getChannelData(1)], mix.sampleRate)
  const link = $<HTMLAnchorElement>('#download')
  URL.revokeObjectURL(link.href)
  link.href = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }))
  link.hidden = false

  log.textContent = [
    `Mix de ${mix.duration.toFixed(1)} s renderizado em ${elapsed.toFixed(2)} s, com a transição ${TRANSITIONS[transitionSelect.value as TransitionName]}.`,
    `Sincronia: ${drift.matched} de ${group.transitionBeats} batidas pareadas; desvio máximo ${(drift.maxSeconds * 1000).toFixed(3)} ms, médio ${(drift.meanSeconds * 1000).toFixed(3)} ms.`,
    synthetic
      ? 'Faixas sintéticas: a medição de sincronia é confiável.'
      : 'Com música real a detecção por limiar não é confiável; vale o que você ouve no WAV.',
  ].join('\n')
})
