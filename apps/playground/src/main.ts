// SPDX-License-Identifier: AGPL-3.0-or-later
// Spikes 1 a 3 da fase 0: duas faixas com BPMs diferentes tocando em fase pelo relógio do
// AudioContext, com automação de volume, EQ e filtro e time-stretch com key lock.
import rubberbandWasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url'
import {
  createRubberBandStretcher,
  createSoundTouchStretcher,
  detectOnsets,
  encodeWav,
  measureDrift,
  renderSynthetic,
  scheduleGroup,
  scheduleMetronome,
  stretchToBpm,
  type BeatGrid,
  type ChannelInput,
  type EqMode,
  type ScheduledGroup,
  type Stretcher,
} from '@djmixer/engine'
import { ANALYSIS_SAMPLE_RATE } from '@djmixer/analysis/constants'
import { beatsToSeconds, type Lane } from '@djmixer/shared'
import type { AnalysisRequest, AnalysisResponse } from './analysis-worker.ts'
import { drawLanes, LEGEND } from './lanes-view.ts'
import { TRANSITIONS, transitionLanes, type TransitionName } from './transitions.ts'

interface TrackForm {
  root: HTMLFieldSetElement
  buffer: AudioBuffer | null
  synthetic: { bpm: number; toneHz: number; leadInSeconds: number }
  syntheticBuffer?: AudioBuffer
  /** Versões esticadas já calculadas, por motor, BPM de origem e BPM do grupo. */
  stretched: Map<string, PreparedTrack>
}

interface PreparedTrack {
  buffer: AudioBuffer
  grid: BeatGrid
}

type StretchChoice = 'varispeed' | 'soundtouch' | 'rubberband-r3' | 'rubberband-r2'

const ctx = new AudioContext()
const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Elemento ausente: ${selector}`)
  return el
}
const log = $<HTMLPreElement>('#log')
const tracks: [TrackForm, TrackForm] = [
  {
    root: $('#track-a'),
    buffer: null,
    synthetic: { bpm: 124, toneHz: 440, leadInSeconds: 0 },
    stretched: new Map(),
  },
  {
    root: $('#track-b'),
    buffer: null,
    synthetic: { bpm: 128, toneHz: 660, leadInSeconds: 0.37 },
    stretched: new Map(),
  },
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
    track.stretched.clear()
    try {
      track.buffer = await ctx.decodeAudioData(await file.arrayBuffer())
      status.textContent = `${file.name} (${track.buffer.duration.toFixed(1)} s)`
    } catch (error) {
      track.buffer = null
      status.textContent = `não foi possível decodificar: ${String(error)}`
    }
  })
}

/** Converte para mono a 44,1 kHz, que é o que o detector de batidas do Essentia aceita. */
async function toAnalysisRate(buffer: AudioBuffer): Promise<Float32Array> {
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE),
    ANALYSIS_SAMPLE_RATE,
  )
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

function runAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve) => {
    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      resolve(event.data)
      worker.terminate()
    }
    worker.onerror = (event) => {
      resolve({ ok: false, error: event.message })
      worker.terminate()
    }
    worker.postMessage(request, [request.samples.buffer])
  })
}

for (const track of tracks) {
  const button = track.root.querySelector<HTMLButtonElement>('[data-field="analyze"]')
  button?.addEventListener('click', async () => {
    const status = track.root.querySelector('[data-field="status"]')
    if (!status) return
    button.disabled = true
    status.textContent = 'analisando…'
    const started = performance.now()
    const beatMethod = $<HTMLSelectElement>('#beat-method').value as 'multifeature' | 'degara'
    const response = await runAnalysis({
      samples: await toAnalysisRate(sourceBuffer(track)),
      options: { beatMethod },
    })
    button.disabled = false
    if (!response.ok) {
      status.textContent = `a análise falhou: ${response.error}`
      return
    }
    const { result } = response
    const bpmField = field(track, 'bpm')
    const firstBeatField = field(track, 'firstBeat')
    if (bpmField) bpmField.value = String(result.bpm)
    if (firstBeatField) firstBeatField.value = result.firstBeatSeconds.toFixed(3)
    track.stretched.clear()
    const seconds = (performance.now() - started) / 1000
    status.textContent = `${result.bpm} BPM, primeira batida em ${result.firstBeatSeconds.toFixed(3)} s, ${result.key}${result.scale === 'minor' ? 'm' : ''} (${result.camelot}). Analisado em ${seconds.toFixed(1)} s.`
  })
}

function sourceBuffer(track: TrackForm): AudioBuffer {
  if (track.buffer) return track.buffer
  if (!track.syntheticBuffer) {
    const samples = renderSynthetic({ ...track.synthetic, beats: 256 }, ctx.sampleRate)
    track.syntheticBuffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    track.syntheticBuffer.copyToChannel(samples, 0)
  }
  return track.syntheticBuffer
}

const stretchers = new Map<StretchChoice, Promise<Stretcher>>()
function stretcherFor(choice: Exclude<StretchChoice, 'varispeed'>): Promise<Stretcher> {
  let stretcher = stretchers.get(choice)
  if (!stretcher) {
    stretcher =
      choice === 'soundtouch'
        ? Promise.resolve(createSoundTouchStretcher())
        : WebAssembly.compileStreaming(fetch(rubberbandWasmUrl)).then((module) =>
            createRubberBandStretcher(module, choice === 'rubberband-r2' ? 'r2' : 'r3'),
          )
    stretchers.set(choice, stretcher)
  }
  return stretcher
}

/**
 * Prepara as duas faixas para o BPM do grupo. Com `varispeed` o motor casa o BPM mudando a
 * velocidade (o tom muda junto); nos outros modos a faixa é esticada uma vez e fica em cache.
 */
async function prepareTracks(): Promise<{ prepared: PreparedTrack[]; notes: string[] }> {
  const choice = $<HTMLSelectElement>('#stretch').value as StretchChoice
  const groupBpm = numberInput('#group-bpm')
  const notes: string[] = []
  const prepared: PreparedTrack[] = []
  for (const [index, track] of tracks.entries()) {
    const grid = {
      bpm: numberField(track, 'bpm'),
      firstBeatSeconds: numberField(track, 'firstBeat'),
    }
    const buffer = sourceBuffer(track)
    if (choice === 'varispeed') {
      prepared.push({ buffer, grid })
      continue
    }
    const key = `${choice}|${grid.bpm}|${grid.firstBeatSeconds}|${groupBpm}`
    let result = track.stretched.get(key)
    if (!result) {
      log.textContent = `Esticando a faixa ${index === 0 ? 'A' : 'B'} com ${choice}…`
      await new Promise((resolve) => setTimeout(resolve, 20))
      const stretcher = await stretcherFor(choice)
      const started = performance.now()
      result = stretchToBpm(ctx, buffer, grid, groupBpm, stretcher)
      const seconds = (performance.now() - started) / 1000
      const perMinute = (seconds / buffer.duration) * 60
      notes.push(
        `Faixa ${index === 0 ? 'A' : 'B'}: ${buffer.duration.toFixed(0)} s de áudio esticados em ${seconds.toFixed(1)} s (${perMinute.toFixed(1)} s por minuto).`,
      )
      track.stretched.set(key, result)
    }
    prepared.push(result)
  }
  return { prepared, notes }
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
  prepared: PreparedTrack[],
  outputs: [AudioNode?, AudioNode?] = [],
  withLanes = true,
): ChannelInput[] {
  const group = readGroup()
  const [a, b] = tracks
  const channel = (
    index: number,
    inBeat: number,
    startBeat: number,
    lanes: Lane[],
    output?: AudioNode,
  ): ChannelInput => {
    const track = prepared[index]
    if (!track) throw new Error(`Faixa ${index} não preparada`)
    return {
      buffer: track.buffer,
      grid: track.grid,
      eq: group.eq,
      lanes,
      clip: { inBeat, outBeat: inBeat + group.endBeat - startBeat, startBeat },
      ...(output ? { output } : {}),
    }
  }
  return [
    channel(0, numberField(a, 'inBeat'), 0, withLanes ? group.lanes[0] : [], outputs[0]),
    channel(
      1,
      numberField(b, 'inBeat'),
      group.entryBeat,
      withLanes ? group.lanes[1] : [],
      outputs[1],
    ),
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
  const { prepared, notes } = await prepareTracks()
  const group = readGroup()
  const fromBeat = numberInput('#from-beat')
  const startAt = ctx.currentTime + 0.1
  const scheduled = scheduleGroup(ctx, channels(prepared), { bpm: group.bpm, startAt, fromBeat })
  const clicks = $<HTMLInputElement>('#metronome').checked
    ? scheduleMetronome(ctx, { bpm: group.bpm, startAt, fromBeat, beats: group.endBeat - fromBeat })
    : []
  playing = { group: scheduled, clicks }
  log.textContent = [
    `Tocando do beat ${fromBeat} ao ${group.endBeat} (${scheduled.durationSeconds.toFixed(1)} s).`,
    ...notes,
  ].join('\n')
})

$('#stop').addEventListener('click', stop)

/** Render offline do grupo inteiro. `split` põe A no canal esquerdo e B no direito, sem automação. */
async function renderGroup(prepared: PreparedTrack[], split: boolean): Promise<AudioBuffer> {
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
  scheduleGroup(offline, channels(prepared, outputs, !split), { bpm: group.bpm, startAt: 0 })
  return offline.startRendering()
}

$('#render').addEventListener('click', async () => {
  const group = readGroup()
  const { prepared, notes } = await prepareTracks()
  log.textContent = 'Renderizando…'
  const started = performance.now()
  const mix = await renderGroup(prepared, false)
  const elapsed = (performance.now() - started) / 1000

  // A medição de sincronia usa um segundo render sem automação, com cada faixa num canal.
  const measured = await renderGroup(prepared, true)
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
    ...notes,
  ].join('\n')
})
