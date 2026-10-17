// SPDX-License-Identifier: AGPL-3.0-or-later
// Roda a análise do spike 5 fora da thread da página, que senão trava por vários segundos.
import { analyze, type Analysis, type AnalyzeOptions } from '@djmixer/analysis'

export interface AnalysisRequest {
  samples: Float32Array
  options: AnalyzeOptions
}

export type AnalysisResponse = { ok: true; result: Analysis } | { ok: false; error: string }

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  let response: AnalysisResponse
  try {
    response = { ok: true, result: analyze(event.data.samples, event.data.options) }
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
