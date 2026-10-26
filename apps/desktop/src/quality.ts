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

/** Mensagem depois do download: quantas vieram no arquivo original e quantas no stream. */
export function downloadSummary(total: number, originals: number, loggedIn: boolean): string {
  const streams = total - originals
  if (streams === 0) return `${total} faixa(s) baixada(s) no arquivo original do artista.`
  const hint = loggedIn
    ? 'o artista não liberou download, então veio o stream do SoundCloud.'
    : 'veio o stream do SoundCloud; escolha seu navegador em "Login do SoundCloud" para tentar o arquivo original.'
  return originals
    ? `${total} faixa(s) baixada(s): ${originals} no original e ${streams} no stream (${hint})`
    : `${total} faixa(s) baixada(s): ${hint}`
}
