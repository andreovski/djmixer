// SPDX-License-Identifier: AGPL-3.0-or-later
// Análise de BPM, beatgrid e tonalidade com Essentia.js (AGPL-3.0, WASM). Só os algoritmos
// clássicos; os modelos de ML do Essentia são CC BY-NC-ND e não entram.
// Os builds ES funcionam igual no Node e no bundle do Vite; o ponto de entrada CommonJS do
// pacote (UMD) chega vazio ao navegador.
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import { ANALYSIS_SAMPLE_RATE } from './constants.ts'
import { NOTE_NAMES, type NoteName, type Scale } from './synthetic-music.ts'

export { ANALYSIS_SAMPLE_RATE }

export type KeyProfile = 'bgate' | 'edma' | 'krumhansl' | 'temperley' | 'shaath'

export interface Beatgrid {
  bpm: number
  /** BPM ajustado às batidas, antes de arredondar. */
  rawBpm: number
  /** Primeira batida da grade a partir do início do arquivo, em segundos (sempre >= 0). */
  firstBeatSeconds: number
  /** Batidas usadas no ajuste e total de batidas detectadas. */
  inliers: number
  detected: number
}

export interface Analysis extends Beatgrid {
  /** Confiança do detector `multifeature` (de 0 a 5,32); o `degara` sempre devolve 0. */
  confidence: number
  beats: number[]
  key: NoteName
  scale: Scale
  keyStrength: number
  camelot: string
  /** Tempo gasto na análise, em segundos. */
  elapsedSeconds: number
}

interface EssentiaVector {
  delete?(): void
}
interface EssentiaInstance {
  version: string
  arrayToVector(array: Float32Array): EssentiaVector
  vectorToArray(vector: EssentiaVector): Float32Array
  RhythmExtractor2013(
    signal: EssentiaVector,
    maxTempo?: number,
    method?: string,
    minTempo?: number,
  ): { bpm: number; confidence: number; ticks: EssentiaVector }
  KeyExtractor(
    audio: EssentiaVector,
    averageDetuningCorrection?: boolean,
    frameSize?: number,
    hopSize?: number,
    hpcpSize?: number,
    maxFrequency?: number,
    maximumSpectralPeaks?: number,
    minFrequency?: number,
    pcpThreshold?: number,
    profileType?: string,
  ): { key: string; scale: string; strength: number }
}

let essentia: EssentiaInstance | undefined

export function getEssentia(): EssentiaInstance {
  if (!essentia) {
    essentia = new (Essentia as unknown as new (wasm: unknown) => EssentiaInstance)(EssentiaWASM)
  }
  return essentia
}

/** O Essentia escreve bemóis em algumas tonalidades; o modelo usa sustenidos. */
const ENHARMONIC: Record<string, NoteName> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }

export function normalizeKey(name: string): NoteName {
  const key = ENHARMONIC[name] ?? name
  if (!(NOTE_NAMES as readonly string[]).includes(key))
    throw new Error(`Tonalidade desconhecida: ${name}`)
  return key as NoteName
}

/** Notação Camelot: 8A é lá menor, 8B é dó maior; vizinhos na roda combinam. */
export function camelot(key: NoteName, scale: Scale): string {
  const pitch = NOTE_NAMES.indexOf(key)
  // Dó maior e lá menor são o 8; cada quinta acima soma 1.
  const reference = scale === 'major' ? 0 : 9
  const fifths = ((((pitch - reference) * 7) % 12) + 12) % 12
  return `${((fifths + 7) % 12) + 1}${scale === 'major' ? 'B' : 'A'}`
}

/**
 * Ajusta uma grade de BPM constante às batidas detectadas: regressão linear das batidas contra o
 * índice, descartando as que caem fora da grade, e arredondamento do BPM quando ele está a menos
 * de 0,02 de um inteiro ou de meio (o normal em música eletrônica).
 */
export function fitBeatgrid(beats: number[]): Beatgrid {
  if (beats.length < 8) throw new Error('Batidas insuficientes para ajustar uma grade')
  const diffs = beats.slice(1).map((b, i) => b - (beats[i] ?? 0))
  const sorted = [...diffs].sort((a, b) => a - b)
  let period = sorted[Math.floor(sorted.length / 2)] ?? 0.5

  // Começa pelo trecho mais longo de batidas regulares: numa intro sem bumbo o detector costuma
  // marcar batidas soltas, que puxariam a grade para fora.
  let best = { start: 0, end: 0 }
  let runStart = 0
  diffs.forEach((diff, i) => {
    if (Math.abs(diff - period) > 0.08 * period) runStart = i + 1
    else if (i + 1 - runStart > best.end - best.start) best = { start: runStart, end: i + 1 }
  })
  let inliers = beats.slice(best.start, best.end + 1).map((b, i) => ({ b, n: i }))
  let offset = beats[best.start] ?? 0

  for (let pass = 0; pass < 3; pass++) {
    const count = inliers.length
    const meanN = inliers.reduce((sum, x) => sum + x.n, 0) / count
    const meanB = inliers.reduce((sum, x) => sum + x.b, 0) / count
    let num = 0
    let den = 0
    for (const { b, n } of inliers) {
      num += (n - meanN) * (b - meanB)
      den += (n - meanN) ** 2
    }
    period = num / den
    offset = meanB - period * meanN
    inliers = beats
      .map((b) => ({ b, n: Math.round((b - offset) / period) }))
      .filter(({ b, n }) => Math.abs(b - offset - n * period) < 0.1 * period)
  }

  const rawBpm = 60 / period
  const bpm = snapBpm(rawBpm)
  const finalPeriod = 60 / bpm
  // Com o período final, a fase é a média dos resíduos das batidas que ficaram na grade.
  const phase =
    inliers.reduce((sum, { b, n }) => sum + (b - n * finalPeriod), 0) / Math.max(1, inliers.length)
  return {
    bpm,
    rawBpm,
    firstBeatSeconds: wrap(phase, finalPeriod),
    inliers: inliers.length,
    detected: beats.length,
  }
}

/** Arredonda para o inteiro ou o meio mais próximo quando está a menos de 0,02 dele. */
export function snapBpm(rawBpm: number): number {
  const snapped = [Math.round(rawBpm), Math.round(rawBpm * 2) / 2].find(
    (candidate) => Math.abs(candidate - rawBpm) < 0.02,
  )
  return snapped ?? Math.round(rawBpm * 100) / 100
}

const wrap = (time: number, period: number) => time - Math.floor(time / period) * period

/**
 * Pico de amplitude a cada 1 ms. Em música eletrônica o bumbo é o transiente mais forte da faixa,
 * mais alto que o baixo e o chimbal do contratempo.
 */
export function peakEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  // Quadros de exatamente 1 ms: 44100 / 1000 não é inteiro, então cada quadro começa em
  // floor(f * sampleRate / 1000) para o índice continuar valendo milissegundos na faixa inteira.
  const envelope = new Float32Array(Math.floor((samples.length * 1000) / sampleRate))
  for (let f = 0; f < envelope.length; f++) {
    let peak = 0
    const end = Math.floor(((f + 1) * sampleRate) / 1000)
    for (let i = Math.floor((f * sampleRate) / 1000); i < end; i++) {
      peak = Math.max(peak, Math.abs(samples[i] ?? 0))
    }
    envelope[f] = peak
  }
  return envelope
}

/**
 * Atraso entre o começo do bumbo e o ponto em que o envelope chega à metade do pico, medido nas
 * faixas sintéticas.
 */
const KICK_DETECTOR_DELAY = 0

/**
 * Detectores de batida genéricos às vezes travam no contratempo (chimbal e baixo fortes) e marcam
 * a batida alguns milissegundos antes do ataque. Em música eletrônica o bumbo cai na batida, então
 * a fase da grade é escolhida e refinada pelo ataque do bumbo.
 */
export function alignToKick(grid: Beatgrid, samples: Float32Array, sampleRate: number): Beatgrid {
  const envelope = peakEnvelope(samples, sampleRate)
  const period = 60 / grid.bpm
  const at = (t: number) => Math.min(envelope.length - 1, Math.max(0, Math.round(t * 1000)))
  const range = (from: number, to: number) => envelope.subarray(at(from), at(to) + 1)
  const beatsFrom = (phase: number) => {
    const times: number[] = []
    for (let t = phase; t < envelope.length / 1000 - 0.1; t += period) times.push(t)
    return times
  }
  // Quanto o pico sobe ao redor de cada batida: forte na batida do bumbo, fraco no contratempo.
  const rise = (t: number) => Math.max(...range(t, t + 0.05)) - Math.min(...range(t - 0.03, t))
  const score = (phase: number) => beatsFrom(phase).reduce((sum, t) => sum + rise(t), 0)
  const half = wrap(grid.firstBeatSeconds + period / 2, period)
  const phase = score(half) > score(grid.firstBeatSeconds) ? half : grid.firstBeatSeconds

  // Refina a grade pelos ataques do bumbo (o ponto em que o sinal chega à metade do pico de cada
  // batida), que têm precisão de 1 ms; as batidas do Essentia vêm em passos de 11,6 ms.
  let strongest = 0
  const attacks = beatsFrom(phase).map((t, n) => {
    let peak = at(t - 0.04)
    for (let f = peak; f <= at(t + 0.06); f++) {
      if ((envelope[f] ?? 0) > (envelope[peak] ?? 0)) peak = f
    }
    const level = envelope[peak] ?? 0
    let f = peak
    while (f > at(t - 0.05) && (envelope[f - 1] ?? 0) > level / 2) f--
    strongest = Math.max(strongest, level)
    return { n, level, time: f / 1000 - KICK_DETECTOR_DELAY }
  })
  const kicks = attacks.filter((attack) => attack.level > 0.3 * strongest)
  if (kicks.length < 16) return { ...grid, firstBeatSeconds: phase }
  const meanN = kicks.reduce((sum, k) => sum + k.n, 0) / kicks.length
  const meanT = kicks.reduce((sum, k) => sum + k.time, 0) / kicks.length
  let num = 0
  let den = 0
  for (const k of kicks) {
    num += (k.n - meanN) * (k.time - meanT)
    den += (k.n - meanN) ** 2
  }
  const rawBpm = 60 / (num / den)
  const bpm = snapBpm(rawBpm)
  const finalPeriod = 60 / bpm
  const offsets = kicks.map((k) => k.time - k.n * finalPeriod).sort((x, y) => x - y)
  const offset = offsets[Math.floor(offsets.length / 2)] ?? phase
  return { ...grid, bpm, rawBpm, firstBeatSeconds: wrap(offset, finalPeriod) }
}

export interface AnalyzeOptions {
  /**
   * `multifeature` é o detector mais robusto do Essentia; `degara` é uns 7 vezes mais rápido, mas
   * erra mais o BPM fora da faixa de house e techno (spike 5).
   */
  beatMethod?: 'multifeature' | 'degara'
  keyProfile?: KeyProfile
  minBpm?: number
  maxBpm?: number
}

/** Analisa um sinal mono a 44,1 kHz. */
export function analyze(samples: Float32Array, options: AnalyzeOptions = {}): Analysis {
  const e = getEssentia()
  const started = performance.now()
  const signal = e.arrayToVector(samples)
  try {
    const rhythm = e.RhythmExtractor2013(
      signal,
      options.maxBpm ?? 180,
      options.beatMethod ?? 'multifeature',
      options.minBpm ?? 80,
    )
    const beats = Array.from(e.vectorToArray(rhythm.ticks))
    rhythm.ticks.delete?.()
    const key = e.KeyExtractor(
      signal,
      true,
      4096,
      4096,
      12,
      3500,
      60,
      25,
      0.2,
      options.keyProfile ?? 'edma',
    )
    const grid = alignToKick(fitBeatgrid(beats), samples, ANALYSIS_SAMPLE_RATE)
    const note = normalizeKey(key.key)
    const scale: Scale = key.scale === 'minor' ? 'minor' : 'major'
    return {
      ...grid,
      confidence: rhythm.confidence,
      beats,
      key: note,
      scale,
      keyStrength: key.strength,
      camelot: camelot(note, scale),
      elapsedSeconds: (performance.now() - started) / 1000,
    }
  } finally {
    signal.delete?.()
  }
}
