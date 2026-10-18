// SPDX-License-Identifier: AGPL-3.0-or-later
// Waveform colorida por frequência. Os picos guardam, a cada 10 ms, a amplitude máxima e a
// energia de três bandas (graves até 200 Hz, médios, agudos acima de 2,5 kHz), cada valor num
// byte. A cor mistura vermelho (grave), verde (médio) e azul (agudo), como nos softwares de DJ.

export const PEAKS_PER_SECOND = 100
export const BYTES_PER_PEAK = 4

export function computePeaks(mono: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const hop = sampleRate / PEAKS_PER_SECOND
  const count = Math.ceil(mono.length / hop)
  const raw = new Float32Array(count * BYTES_PER_PEAK)
  // Filtros de um polo: bastam para colorir e são rápidos numa faixa inteira.
  const lowCoef = 1 - Math.exp((-2 * Math.PI * 200) / sampleRate)
  const highCoef = 1 - Math.exp((-2 * Math.PI * 2500) / sampleRate)
  let low = 0
  let belowHigh = 0
  for (let bin = 0; bin < count; bin++) {
    const start = Math.round(bin * hop)
    const end = Math.min(mono.length, Math.round((bin + 1) * hop))
    let peak = 0
    let lowSum = 0
    let midSum = 0
    let highSum = 0
    for (let i = start; i < end; i++) {
      const x = mono[i] ?? 0
      low += lowCoef * (x - low)
      belowHigh += highCoef * (x - belowHigh)
      const high = x - belowHigh
      const mid = belowHigh - low
      peak = Math.max(peak, Math.abs(x))
      lowSum += low * low
      midSum += mid * mid
      highSum += high * high
    }
    const n = Math.max(1, end - start)
    raw.set([peak, Math.sqrt(lowSum / n), Math.sqrt(midSum / n), Math.sqrt(highSum / n)], bin * 4)
  }
  // Normaliza cada coluna pelo máximo da faixa, para faixas baixas também aparecerem.
  const max = [1e-9, 1e-9, 1e-9, 1e-9]
  raw.forEach((value, i) => (max[i % 4] = Math.max(max[i % 4] ?? 0, value)))
  const bandMax = Math.max(max[1] ?? 0, max[2] ?? 0, max[3] ?? 0)
  return Uint8Array.from(raw, (value, i) =>
    Math.round((255 * value) / (i % 4 === 0 ? (max[0] ?? 1) : bandMax)),
  )
}

export function peakCount(peaks: Uint8Array): number {
  return Math.floor(peaks.length / BYTES_PER_PEAK)
}

export interface WaveformView {
  /** Segundo do arquivo no pixel 0 e segundos por pixel. */
  startSeconds: number
  secondsPerPixel: number
  /** Retângulo de destino no canvas. */
  x: number
  y: number
  width: number
  height: number
}

/** Desenha a waveform espelhada, uma coluna por pixel. */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: Uint8Array,
  view: WaveformView,
  alpha = 1,
): void {
  const count = peakCount(peaks)
  const middle = view.y + view.height / 2
  for (let px = 0; px < view.width; px++) {
    const from = Math.floor((view.startSeconds + px * view.secondsPerPixel) * PEAKS_PER_SECOND)
    const to = Math.max(
      from + 1,
      Math.floor((view.startSeconds + (px + 1) * view.secondsPerPixel) * PEAKS_PER_SECOND),
    )
    if (to <= 0 || from >= count) continue
    let peak = 0
    let low = 0
    let mid = 0
    let high = 0
    for (let bin = Math.max(0, from); bin < Math.min(count, to); bin++) {
      const at = bin * BYTES_PER_PEAK
      peak = Math.max(peak, peaks[at] ?? 0)
      low = Math.max(low, peaks[at + 1] ?? 0)
      mid = Math.max(mid, peaks[at + 2] ?? 0)
      high = Math.max(high, peaks[at + 3] ?? 0)
    }
    const total = Math.max(1, low + mid + high)
    const r = Math.round(60 + 195 * (low / total))
    const g = Math.round(60 + 195 * (mid / total))
    const b = Math.round(60 + 195 * (high / total))
    const h = (peak / 255) * (view.height / 2)
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
    ctx.fillRect(view.x + px, middle - h, 1, Math.max(1, h * 2))
  }
}
