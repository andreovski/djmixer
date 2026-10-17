// SPDX-License-Identifier: AGPL-3.0-or-later
// Faixas sintéticas para testes de áudio sem problema de direitos: um bumbo em cada batida
// e um tom fixo no contratempo, com BPM e primeira batida exatos.

export interface SyntheticSpec {
  bpm: number
  toneHz: number
  beats: number
  /** Silêncio antes da primeira batida, em segundos. */
  leadInSeconds?: number
}

export function renderSynthetic(
  spec: SyntheticSpec,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  const samplesPerBeat = (sampleRate * 60) / spec.bpm
  const leadIn = Math.round((spec.leadInSeconds ?? 0) * sampleRate)
  const out = new Float32Array(leadIn + Math.ceil(samplesPerBeat * spec.beats))
  for (let beat = 0; beat < spec.beats; beat++) {
    const start = leadIn + Math.round(beat * samplesPerBeat)
    addKick(out, start, sampleRate)
    addTone(
      out,
      Math.round(start + samplesPerBeat / 2),
      spec.toneHz,
      samplesPerBeat / 4,
      sampleRate,
    )
  }
  return out
}

function addKick(out: Float32Array, start: number, sampleRate: number): void {
  const length = Math.round(sampleRate * 0.15)
  let phase = 0
  for (let i = 0; i < length && start + i < out.length; i++) {
    const t = i / sampleRate
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t * 40))) / sampleRate
    out[start + i] = (out[start + i] ?? 0) + 0.8 * Math.sin(phase) * Math.exp(-t * 25)
  }
}

function addTone(
  out: Float32Array,
  start: number,
  hz: number,
  length: number,
  sampleRate: number,
): void {
  for (let i = 0; i < length && start + i < out.length; i++) {
    const envelope = Math.min(1, i / 200, (length - i) / 200)
    out[start + i] =
      (out[start + i] ?? 0) + 0.2 * envelope * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  }
}
