// SPDX-License-Identifier: AGPL-3.0-or-later
// Gera faixas sintéticas em fixtures/synthetic/ para testes de áudio sem problema de direitos:
// um bumbo em cada batida e um tom fixo no contratempo, com BPM e primeira batida conhecidos.
// Uso: pnpm fixtures:synthetic
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SAMPLE_RATE = 44100
const BEATS = 128 // 32 compassos de 4/4
const OUT_DIR = join(import.meta.dirname, '..', 'fixtures', 'synthetic')

interface Spec {
  bpm: number
  toneHz: number
}

const SPECS: Spec[] = [
  { bpm: 124, toneHz: 440 },
  { bpm: 128, toneHz: 660 },
]

function render({ bpm, toneHz }: Spec): Float32Array {
  const samplesPerBeat = (SAMPLE_RATE * 60) / bpm
  const out = new Float32Array(Math.ceil(samplesPerBeat * BEATS))
  for (let beat = 0; beat < BEATS; beat++) {
    const start = Math.round(beat * samplesPerBeat)
    addKick(out, start)
    addTone(out, Math.round(start + samplesPerBeat / 2), toneHz, samplesPerBeat / 4)
  }
  return out
}

function addKick(out: Float32Array, start: number): void {
  const length = Math.round(SAMPLE_RATE * 0.15)
  let phase = 0
  for (let i = 0; i < length && start + i < out.length; i++) {
    const t = i / SAMPLE_RATE
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t * 40))) / SAMPLE_RATE
    out[start + i] = (out[start + i] ?? 0) + 0.8 * Math.sin(phase) * Math.exp(-t * 25)
  }
}

function addTone(out: Float32Array, start: number, hz: number, length: number): void {
  for (let i = 0; i < length && start + i < out.length; i++) {
    const envelope = Math.min(1, i / 200, (length - i) / 200)
    out[start + i] =
      (out[start + i] ?? 0) + 0.2 * envelope * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)
  }
}

function toWav(mono: Float32Array): Buffer {
  const channels = 2
  const dataSize = mono.length * channels * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * channels * 2, 28)
  buf.writeUInt16LE(channels * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  let offset = 44
  for (const sample of mono) {
    const value = Math.round(Math.max(-1, Math.min(1, sample)) * 32767)
    buf.writeInt16LE(value, offset)
    buf.writeInt16LE(value, offset + 2)
    offset += 4
  }
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })
for (const spec of SPECS) {
  const file = join(OUT_DIR, `sintetica-${spec.bpm}bpm.wav`)
  writeFileSync(file, toWav(render(spec)))
  console.log(`gerado ${file}`)
}
