// SPDX-License-Identifier: AGPL-3.0-or-later
// Análise de uma faixa fora da thread da interface: BPM, primeira batida e tonalidade
// (Essentia.js, decisão 0009) e os picos da waveform.
import { analyze } from '@djmixer/analysis'
import type { TrackAnalysis } from '../../host/api.ts'
import { computePeaks } from '../waveform.ts'

export interface AnalysisRequest {
  /** PCM estéreo intercalado a 44,1 kHz. */
  interleaved: Float32Array
}

export type AnalysisResponse =
  { ok: true; analysis: TrackAnalysis; peaks: Uint8Array } | { ok: false; error: string }

/** Confiança máxima do detector multifeature do Essentia. */
const MAX_CONFIDENCE = 5.32

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  let response: AnalysisResponse
  try {
    const { interleaved } = event.data
    const mono = new Float32Array(interleaved.length / 2)
    for (let i = 0; i < mono.length; i++) {
      mono[i] = ((interleaved[2 * i] ?? 0) + (interleaved[2 * i + 1] ?? 0)) / 2
    }
    const peaks = computePeaks(mono, 44100)
    const result = analyze(mono)
    response = {
      ok: true,
      analysis: {
        grid: { bpm: result.bpm, firstBeatSeconds: result.firstBeatSeconds },
        key: { note: result.key, scale: result.scale, camelot: result.camelot },
        confidence: Math.min(1, result.confidence / MAX_CONFIDENCE),
        analyzedAt: Date.now(),
      },
      peaks,
    }
    self.postMessage(response, { transfer: [peaks.buffer] })
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) }
    self.postMessage(response)
  }
}
