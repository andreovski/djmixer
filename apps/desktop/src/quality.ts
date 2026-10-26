// SPDX-License-Identifier: AGPL-3.0-or-later
// Texto da qualidade de uma faixa (formato, bitrate, taxa, canais, tamanho) para a biblioteca.
import type { AudioInfo } from '../host/api.ts'

const CODECS: Record<string, string> = {
  mp3: 'MP3',
  aac: 'AAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'ALAC',
  wav: 'WAV',
  aif: 'AIFF',
  aiff: 'AIFF',
  m4a: 'M4A',
  ogg: 'OGG',
}

function codecName(codec: string): string {
  if (codec.startsWith('pcm_')) return 'PCM (WAV/AIFF)'
  return CODECS[codec] ?? codec.toUpperCase()
}

const decimal = (value: number, digits: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Partes da linha de qualidade, na ordem em que aparecem. */
export function describeAudio(info: AudioInfo): string[] {
  const parts = [codecName(info.codec)]
  if (info.bitrateKbps) parts.push(`${info.estimated ? '~' : ''}${info.bitrateKbps} kbps`)
  if (info.sampleRate) parts.push(`${decimal(info.sampleRate / 1000, 1)} kHz`)
  if (info.bitDepth) parts.push(`${info.bitDepth} bits`)
  if (info.channels) {
    parts.push(
      info.channels === 1 ? 'mono' : info.channels === 2 ? 'estéreo' : `${info.channels} canais`,
    )
  }
  parts.push(`${decimal(info.bytes / 1024 / 1024, 1)} MB`)
  return parts
}
