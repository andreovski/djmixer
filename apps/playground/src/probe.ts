// SPDX-License-Identifier: AGPL-3.0-or-later
// Sondagem do spike 4: roda as peças do motor (relógio, AudioWorklet, render offline, automação,
// WASM e decodificação) no navegador ou shell em que a página abrir e mede cada uma.
import rubberbandWasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url'
import {
  createRubberBandStretcher,
  detectOnsets,
  estimateFrequency,
  measureDrift,
  renderSynthetic,
  scheduleGroup,
  toneToNoiseDb,
  type ChannelInput,
} from '@djmixer/engine'
import { beatsToSeconds } from '@djmixer/shared'

export interface ProbeResult {
  id: string
  label: string
  status: 'ok' | 'falha' | 'pulado'
  detail: string
  metrics?: Record<string, number | string | boolean | null>
}

export interface ProbeReport {
  shell: string
  userAgent: string
  startedAt: string
  results: ProbeResult[]
}

interface ShellBridge {
  name: string
  report(json: string): Promise<void>
}

declare global {
  interface Window {
    /** Exposto pelo preload do Electron. */
    probeShell?: ShellBridge
    /** Exposto pelo Tauri com `withGlobalTauri`. */
    __TAURI__?: { core: { invoke(cmd: string, args?: object): Promise<unknown> } }
    __probeReport?: ProbeReport
  }
}

const SAMPLE_RATE = 44100

const timeout = <T>(promise: Promise<T>, ms: number, what: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what}: sem resposta em ${ms} ms`)), ms),
    ),
  ])

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function monoBuffer(ctx: BaseAudioContext, samples: Float32Array<ArrayBuffer>): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
  buffer.copyToChannel(samples, 0)
  return buffer
}

function sine(hz: number, seconds: number, sampleRate = SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return out
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += (samples[i] ?? 0) ** 2
  return Math.sqrt(sum / Math.max(1, to - from))
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits))

/** Relógio do AudioContext em tempo real: ele precisa andar junto com o relógio da página. */
async function realtimeClock(): Promise<ProbeResult> {
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  try {
    const initialState = ctx.state
    const created = performance.now()
    await timeout(ctx.resume(), 3000, 'resume()').catch(() => undefined)
    // O dispositivo de saída leva um tempo para começar a pedir áudio, e nesse intervalo o
    // relógio fica parado. Isso é latência de partida, não velocidade do relógio: medimos à parte.
    while (ctx.currentTime === 0 && performance.now() - created < 3000) await sleep(5)
    const startupMs = performance.now() - created
    await sleep(500)
    const t0 = ctx.currentTime
    const p0 = performance.now()
    await sleep(5000)
    const advance = ctx.currentTime - t0
    const wall = (performance.now() - p0) / 1000
    const ratio = advance / wall
    const metrics = {
      sampleRate: ctx.sampleRate,
      initialState,
      state: ctx.state,
      baseLatencyMs: ctx.baseLatency === undefined ? null : round(ctx.baseLatency * 1000, 1),
      outputLatencyMs:
        'outputLatency' in ctx && typeof ctx.outputLatency === 'number'
          ? round(ctx.outputLatency * 1000, 1)
          : null,
      clockRatio: round(ratio, 4),
      startupMs: round(startupMs, 0),
    }
    const ok = ctx.state === 'running' && Math.abs(ratio - 1) < 0.01
    return {
      id: 'relogio',
      label: 'Relógio do AudioContext em tempo real',
      status: ok ? 'ok' : 'falha',
      detail: ok
        ? `Rodando a ${ctx.sampleRate} Hz; o relógio andou ${advance.toFixed(3)} s em ${wall.toFixed(3)} s; começou a andar em ${startupMs.toFixed(0)} ms.`
        : `Estado ${ctx.state}; o relógio andou ${advance.toFixed(3)} s em ${wall.toFixed(3)} s; começou a andar em ${startupMs.toFixed(0)} ms.`,
      metrics,
    }
  } finally {
    await ctx.close().catch(() => undefined)
  }
}

/** AudioWorklet carregado de um módulo e usado num render offline. */
async function audioWorklet(): Promise<ProbeResult> {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE)
  if (!('audioWorklet' in ctx)) {
    return {
      id: 'worklet',
      label: 'AudioWorklet',
      status: 'falha',
      detail: 'O contexto não tem audioWorklet.',
    }
  }
  await ctx.audioWorklet.addModule(new URL('probe-worklet.js', document.baseURI).href)
  const source = ctx.createConstantSource()
  const node = new AudioWorkletNode(ctx, 'half-gain')
  source.connect(node).connect(ctx.destination)
  source.start()
  const out = (await ctx.startRendering()).getChannelData(0)
  const level = out[out.length / 2] ?? 0
  const ok = Math.abs(level - 0.5) < 1e-6
  return {
    id: 'worklet',
    label: 'AudioWorklet',
    status: ok ? 'ok' : 'falha',
    detail: ok ? 'O processador rodou no render offline.' : `Saída ${level} em vez de 0,5.`,
    metrics: { level },
  }
}

/** O critério do spike 1, agora no shell: duas faixas em fase num render offline. */
async function offlineSync(): Promise<ProbeResult> {
  const bpm = 126
  const entryBeat = 64
  const totalBeats = 128
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(beatsToSeconds(totalBeats, bpm) * SAMPLE_RATE),
    SAMPLE_RATE,
  )
  const merger = ctx.createChannelMerger(2)
  merger.connect(ctx.destination)
  const left = ctx.createGain()
  left.connect(merger, 0, 0)
  const right = ctx.createGain()
  right.connect(merger, 0, 1)
  scheduleGroup(
    ctx,
    [
      {
        buffer: monoBuffer(
          ctx,
          renderSynthetic({ bpm: 124, toneHz: 440, beats: 160 }, SAMPLE_RATE),
        ),
        grid: { bpm: 124, firstBeatSeconds: 0 },
        clip: { inBeat: 0, outBeat: totalBeats, startBeat: 0 },
        output: left,
      },
      {
        buffer: monoBuffer(
          ctx,
          renderSynthetic({ bpm: 128, toneHz: 660, beats: 96, leadInSeconds: 0.37 }, SAMPLE_RATE),
        ),
        grid: { bpm: 128, firstBeatSeconds: 0.37 },
        clip: { inBeat: 0, outBeat: totalBeats - entryBeat, startBeat: entryBeat },
        output: right,
      },
    ],
    { bpm, startAt: 0 },
  )
  const rendered = await ctx.startRendering()
  const entry = beatsToSeconds(entryBeat, bpm)
  const a = detectOnsets(rendered.getChannelData(0), SAMPLE_RATE, 0.4).filter(
    (t) => t >= entry - 0.01,
  )
  const b = detectOnsets(rendered.getChannelData(1), SAMPLE_RATE, 0.4)
  const drift = measureDrift(a, b)
  const ok = drift.matched === totalBeats - entryBeat && drift.maxSeconds < 0.001
  return {
    id: 'sincronia',
    label: 'Sincronia de duas faixas (render offline)',
    status: ok ? 'ok' : 'falha',
    detail: `${drift.matched} de ${totalBeats - entryBeat} batidas pareadas; desvio máximo ${(drift.maxSeconds * 1000).toFixed(3)} ms.`,
    metrics: { matched: drift.matched, maxDriftMs: round(drift.maxSeconds * 1000) },
  }
}

/** Corte de graves do isolador por automação, e o tempo de render de 2 min com lanes. */
async function automation(): Promise<ProbeResult> {
  const bpm = 120
  const beats = 240
  const seconds = beatsToSeconds(beats, bpm)
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE)
  // Um seno de 60 Hz com o grave aberto na primeira metade e cortado na segunda.
  const low: ChannelInput = {
    buffer: monoBuffer(ctx, sine(60, seconds + 1)),
    grid: { bpm, firstBeatSeconds: 0 },
    clip: { inBeat: 0, outBeat: beats, startBeat: 0 },
    eq: 'isolator',
    lanes: [
      {
        kind: 'eq.low',
        points: [
          { beat: 0, value: 0.5, curve: 'hold' },
          { beat: beats / 2, value: 0, curve: 'hold' },
        ],
      },
    ],
  }
  // Uma segunda faixa com fade, para o render ter o custo de duas faixas automatizadas.
  const other: ChannelInput = {
    buffer: monoBuffer(ctx, renderSynthetic({ bpm, toneHz: 660, beats }, SAMPLE_RATE)),
    grid: { bpm, firstBeatSeconds: 0 },
    clip: { inBeat: 0, outBeat: beats, startBeat: 0 },
    eq: 'isolator',
    lanes: [
      {
        kind: 'volume',
        points: [
          { beat: 0, value: 0, curve: 'linear' },
          { beat: beats, value: 1, curve: 'linear' },
        ],
      },
      {
        kind: 'filter',
        points: [
          { beat: 0, value: 0.5, curve: 'linear' },
          { beat: beats, value: 0.9, curve: 'linear' },
        ],
      },
    ],
  }
  // Só a primeira faixa vai para a medição; a outra é renderizada num canal separado.
  const merger = ctx.createChannelMerger(2)
  merger.connect(ctx.destination)
  const left = ctx.createGain()
  left.connect(merger, 0, 0)
  const right = ctx.createGain()
  right.connect(merger, 0, 1)
  scheduleGroup(
    ctx,
    [
      { ...low, output: left },
      { ...other, output: right },
    ],
    {
      bpm,
      startAt: 0,
    },
  )
  const started = performance.now()
  const rendered = await ctx.startRendering()
  const renderSeconds = (performance.now() - started) / 1000
  const out = rendered.getChannelData(0)
  const half = Math.floor(out.length / 2)
  const open = rms(out, SAMPLE_RATE, half - SAMPLE_RATE)
  const killed = rms(out, half + SAMPLE_RATE, out.length - SAMPLE_RATE)
  const killDb = 20 * Math.log10(Math.max(killed, 1e-9) / open)
  const ok = killDb < -40
  return {
    id: 'automacao',
    label: 'Automação de EQ (isolador) e tempo de render',
    status: ok ? 'ok' : 'falha',
    detail: `Corte de ${killDb.toFixed(1)} dB em 60 Hz; ${seconds.toFixed(0)} s com duas faixas automatizadas renderizados em ${renderSeconds.toFixed(2)} s.`,
    metrics: {
      killDb: round(killDb, 1),
      renderSeconds: round(renderSeconds, 2),
      realtimeFactor: round(seconds / renderSeconds, 1),
    },
  }
}

/** Rubber Band R3 em WASM: tom, pureza e velocidade. */
async function wasmStretch(): Promise<ProbeResult> {
  const module = await WebAssembly.compileStreaming(fetch(rubberbandWasmUrl))
  const stretcher = await createRubberBandStretcher(module, 'r3')
  const input = sine(440, 20)
  const ratio = 128 / 124
  const started = performance.now()
  const [out] = stretcher.stretch([input], SAMPLE_RATE, ratio)
  const elapsed = (performance.now() - started) / 1000
  if (!out) throw new Error('O stretch não devolveu canais')
  const middle = out.subarray(SAMPLE_RATE, out.length - SAMPLE_RATE)
  const hz = estimateFrequency(middle, SAMPLE_RATE)
  const purity = toneToNoiseDb(middle, SAMPLE_RATE, 440)
  const perMinute = (elapsed / 20) * 60
  const ok = Math.abs(hz - 440) < 0.5 && purity > 60
  return {
    id: 'wasm',
    label: 'Time-stretch Rubber Band R3 (WASM)',
    status: ok ? 'ok' : 'falha',
    detail: `Tom ${hz.toFixed(2)} Hz, pureza ${purity.toFixed(0)} dB, ${perMinute.toFixed(1)} s por minuto de áudio.`,
    metrics: {
      hz: round(hz, 2),
      purityDb: round(purity, 1),
      secondsPerMinute: round(perMinute, 1),
    },
  }
}

const CODECS: [string, string][] = [
  ['WAV', 'tom.wav'],
  ['AIFF', 'tom.aiff'],
  ['MP3', 'tom.mp3'],
  ['AAC (M4A)', 'tom-aac.m4a'],
  ['ALAC (M4A)', 'tom-alac.m4a'],
  ['FLAC', 'tom.flac'],
  ['Ogg Vorbis', 'tom.ogg'],
  ['Opus', 'tom.opus'],
]

/** decodeAudioData com cada formato que um DJ costuma ter na biblioteca. */
async function decode(label: string, file: string): Promise<ProbeResult> {
  const id = `decodificar-${file}`
  const response = await fetch(new URL(`codecs/${file}`, document.baseURI).href).catch(() => null)
  // O Tauri responde a um arquivo ausente com a página inicial, por isso o tipo também conta.
  if (!response?.ok || response.headers.get('content-type')?.includes('text/html')) {
    return {
      id,
      label: `Decodificar ${label}`,
      status: 'pulado',
      detail: 'Arquivo de teste ausente; rode pnpm fixtures:codecs.',
    }
  }
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE)
  try {
    const buffer = await timeout(
      ctx.decodeAudioData(await response.arrayBuffer()),
      10_000,
      'decodeAudioData',
    )
    const samples = buffer.getChannelData(0)
    const sr = buffer.sampleRate
    const hz = estimateFrequency(samples.subarray(sr, 4 * sr), sr)
    // O tom começa em 0,5 s; um decodificador que não descarta o atraso do codificador o entrega
    // depois disso, e o beatgrid inteiro da faixa ficaria deslocado.
    const first = samples.findIndex((x) => Math.abs(x) > 0.05)
    const offsetMs = first < 0 ? NaN : (first / sr - 0.5) * 1000
    const ok =
      Math.abs(buffer.duration - 5) < 0.1 && Math.abs(hz - 440) < 1 && Math.abs(offsetMs) < 2
    return {
      id,
      label: `Decodificar ${label}`,
      status: ok ? 'ok' : 'falha',
      detail: `${buffer.duration.toFixed(3)} s, ${hz.toFixed(1)} Hz, início ${offsetMs >= 0 ? '+' : ''}${offsetMs.toFixed(1)} ms.`,
      metrics: { duration: round(buffer.duration), hz: round(hz, 1), offsetMs: round(offsetMs, 1) },
    }
  } catch (error) {
    return {
      id,
      label: `Decodificar ${label}`,
      status: 'falha',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

const CHECKS: [string, string, () => Promise<ProbeResult>][] = [
  ['relogio', 'Relógio do AudioContext em tempo real', realtimeClock],
  ['worklet', 'AudioWorklet', audioWorklet],
  ['sincronia', 'Sincronia de duas faixas (render offline)', offlineSync],
  ['automacao', 'Automação de EQ (isolador) e tempo de render', automation],
  ['wasm', 'Time-stretch Rubber Band R3 (WASM)', wasmStretch],
  ...CODECS.map(([label, file]): [string, string, () => Promise<ProbeResult>] => [
    `decodificar-${file}`,
    `Decodificar ${label}`,
    () => decode(label, file),
  ]),
]

function shellName(): string {
  if (window.probeShell) return window.probeShell.name
  if (window.__TAURI__) return 'tauri'
  return 'navegador'
}

export async function runProbe(onResult: (result: ProbeResult) => void): Promise<ProbeReport> {
  const report: ProbeReport = {
    shell: shellName(),
    userAgent: navigator.userAgent,
    startedAt: new Date().toISOString(),
    results: [],
  }
  for (const [id, label, check] of CHECKS) {
    let result: ProbeResult
    try {
      result = await timeout(check(), 120_000, label)
    } catch (error) {
      result = {
        id,
        label,
        status: 'falha',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
    report.results.push(result)
    onResult(result)
  }
  window.__probeReport = report
  return report
}

/** Entrega o relatório ao shell, que grava o JSON e fecha a janela nas execuções automáticas. */
export async function sendToShell(report: ProbeReport): Promise<boolean> {
  const json = JSON.stringify(report, null, 2)
  if (window.probeShell) {
    await window.probeShell.report(json)
    return true
  }
  if (window.__TAURI__) {
    await window.__TAURI__.core.invoke('report', { json })
    return true
  }
  return false
}
