// SPDX-License-Identifier: AGPL-3.0-or-later
// Time-stretch com key lock (Rubber Band R3, decisão 0007) fora da thread da interface.
import { createRubberBandStretcher, type Stretcher } from '@djmixer/engine'
import rubberbandWasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url'

export interface StretchRequest {
  id: number
  left: Float32Array
  right: Float32Array
  timeRatio: number
}

export type StretchResponse =
  | { id: number; ok: true; left: Float32Array; right: Float32Array }
  | { id: number; ok: false; error: string }

let stretcher: Promise<Stretcher> | undefined

self.onmessage = async (event: MessageEvent<StretchRequest>) => {
  const { id, left, right, timeRatio } = event.data
  try {
    stretcher ??= WebAssembly.compileStreaming(fetch(rubberbandWasmUrl)).then((module) =>
      createRubberBandStretcher(module, 'r3'),
    )
    const [l, r] = (await stretcher).stretch([left, right], 44100, timeRatio)
    if (!l || !r) throw new Error('stretch sem saída')
    const response: StretchResponse = { id, ok: true, left: l, right: r }
    self.postMessage(response, { transfer: [l.buffer, r.buffer] })
  } catch (error) {
    const response: StretchResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
