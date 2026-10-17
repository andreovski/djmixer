// SPDX-License-Identifier: AGPL-3.0-or-later
// Time-stretch com key lock, aplicado offline: a faixa é esticada uma vez para o BPM do grupo e
// tocada com playbackRate 1. Duas implementações para comparar no spike 3.
import { Stretch } from '@soundtouchjs/core'
import { RubberBandInterface, RubberBandOption } from 'rubberband-wasm'
import type { BeatGrid } from './schedule.ts'

export type StretchEngineName = 'rubberband-r3' | 'rubberband-r2' | 'soundtouch'

export interface Stretcher {
  name: StretchEngineName
  /**
   * Estica os canais por `timeRatio` (duração de saída / duração de entrada) sem mudar o tom.
   * A saída começa alinhada à entrada e tem `round(frames * timeRatio)` amostras.
   */
  stretch(channels: Float32Array[], sampleRate: number, timeRatio: number): Float32Array[]
}

/**
 * Rubber Band (GPL) compilado para WASM, em modo offline. `r3` é o motor de maior qualidade
 * (EngineFiner); `r2` é o motor clássico, bem mais rápido.
 */
export async function createRubberBandStretcher(
  module: WebAssembly.Module,
  engine: 'r3' | 'r2' = 'r3',
): Promise<Stretcher> {
  const rb = await RubberBandInterface.initialize(module)
  return {
    name: `rubberband-${engine}`,
    stretch(channels, sampleRate, timeRatio) {
      const frames = channels[0]?.length ?? 0
      const outFrames = Math.round(frames * timeRatio)
      const options =
        RubberBandOption.RubberBandOptionProcessOffline |
        (engine === 'r3'
          ? RubberBandOption.RubberBandOptionEngineFiner
          : RubberBandOption.RubberBandOptionEngineFaster) |
        RubberBandOption.RubberBandOptionPitchHighQuality |
        RubberBandOption.RubberBandOptionChannelsTogether
      const state = rb.rubberband_new(sampleRate, channels.length, options, timeRatio, 1)
      rb.rubberband_set_expected_input_duration(state, frames)
      const block = rb.rubberband_get_samples_required(state) || 1024
      rb.rubberband_set_max_process_size(state, block)

      const pointers = rb.malloc(channels.length * 4)
      const buffers = channels.map((_, i) => {
        const ptr = rb.malloc(block * 4)
        rb.memWritePtr(pointers + i * 4, ptr)
        return ptr
      })
      const feed = (run: (count: number, final: number) => void) => {
        for (let read = 0; read < frames; read += block) {
          const count = Math.min(block, frames - read)
          channels.forEach((channel, i) =>
            rb.memWrite(buffers[i] as number, channel.subarray(read, read + count)),
          )
          run(count, read + count >= frames ? 1 : 0)
        }
      }

      feed((count, final) => rb.rubberband_study(state, pointers, count, final))
      const output = channels.map(() => new Float32Array(outFrames))
      let written = 0
      const drain = () => {
        for (;;) {
          const available = rb.rubberband_available(state)
          if (available < 1) return
          const received = rb.rubberband_retrieve(state, pointers, Math.min(block, available))
          channels.forEach((_, i) => {
            const data = rb.memReadF32(buffers[i] as number, received)
            const room = Math.max(0, outFrames - written)
            output[i]?.set(data.subarray(0, Math.min(received, room)), written)
          })
          written += received
        }
      }
      feed((count, final) => {
        rb.rubberband_process(state, pointers, count, final)
        drain()
      })
      drain()

      buffers.forEach((ptr) => rb.free(ptr))
      rb.free(pointers)
      rb.rubberband_delete(state)
      return output
    },
  }
}

/** WSOLA do SoundTouch (MPL-2.0, TypeScript puro). Muito mais rápido, mas desloca as batidas em alguns ms. */
export function createSoundTouchStretcher(): Stretcher {
  return {
    name: 'soundtouch',
    stretch(channels, sampleRate, timeRatio) {
      const frames = channels[0]?.length ?? 0
      const outFrames = Math.round(frames * timeRatio)
      const left = channels[0] ?? new Float32Array(0)
      const right = channels[1] ?? left
      const stretch = new Stretch({ sampleRate, createBuffers: true })
      stretch.tempo = 1 / timeRatio
      const input = stretch.inputBuffer
      const output = stretch.outputBuffer
      if (!input || !output) throw new Error('SoundTouch sem buffers')
      const interleaved = new Float32Array(frames * 2)
      for (let i = 0; i < frames; i++) {
        interleaved[2 * i] = left[i] ?? 0
        interleaved[2 * i + 1] = right[i] ?? 0
      }
      // Silêncio no fim empurra as últimas amostras para fora do WSOLA.
      const tail = new Float32Array(sampleRate * 2)
      const result = new Float32Array(outFrames * 2)
      let written = 0
      const block = 4096
      const pull = () => {
        const available = output.frameCount
        const count = Math.min(available, outFrames - written)
        if (count > 0) {
          output.extract(result.subarray(written * 2), 0, count)
          written += count
        }
        output.clear()
      }
      for (let read = 0; read < frames; read += block) {
        const count = Math.min(block, frames - read)
        input.putSamples(interleaved, read, count)
        stretch.process()
        pull()
      }
      input.putSamples(tail, 0, sampleRate)
      stretch.process()
      pull()

      const out = channels.map(() => new Float32Array(outFrames))
      for (let i = 0; i < outFrames; i++) {
        if (out[0]) out[0][i] = result[2 * i] ?? 0
        if (out[1]) out[1][i] = result[2 * i + 1] ?? 0
      }
      return out
    },
  }
}

/** Estica um AudioBuffer para tocar a `toBpm` e devolve o beatgrid correspondente. */
export function stretchToBpm(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  grid: BeatGrid,
  toBpm: number,
  stretcher: Stretcher,
): { buffer: AudioBuffer; grid: BeatGrid } {
  const timeRatio = grid.bpm / toBpm
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  )
  const stretched = stretcher.stretch(channels, buffer.sampleRate, timeRatio)
  const out = ctx.createBuffer(stretched.length, stretched[0]?.length ?? 1, buffer.sampleRate)
  stretched.forEach((data, i) => out.copyToChannel(data as Float32Array<ArrayBuffer>, i))
  return {
    buffer: out,
    grid: { bpm: toBpm, firstBeatSeconds: grid.firstBeatSeconds * timeRatio },
  }
}
