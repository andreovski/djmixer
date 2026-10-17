// SPDX-License-Identifier: AGPL-3.0-or-later

/** Codifica canais em PCM de 16 bits (WAV). Todos os canais precisam ter o mesmo tamanho. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length
  const frames = channels[0]?.length ?? 0
  const dataSize = frames * count * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, count, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * count * 2, true)
  view.setUint16(32, count * 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0))
      view.setInt16(offset, Math.round(sample * 32767), true)
      offset += 2
    }
  }
  return bytes
}

/**
 * Cabeçalho de 44 bytes de um WAV PCM. No export em partes, o arquivo começa com o cabeçalho de
 * tamanho 0 e, no fim, os tamanhos são regravados com o total de bytes de áudio.
 */
export function wavHeader(
  sampleRate: number,
  channels: number,
  bitsPerSample: 16 | 24,
  dataBytes: number,
): Uint8Array {
  const bytes = new Uint8Array(44)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  const blockAlign = (channels * bitsPerSample) / 8
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  return bytes
}

/** Intercala os canais em PCM de 24 bits little-endian, sem cabeçalho. */
export function pcm24(channels: Float32Array[]): Uint8Array {
  const frames = channels[0]?.length ?? 0
  const out = new Uint8Array(frames * channels.length * 3)
  let offset = 0
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0))
      const value = Math.round(sample * 8388607)
      out[offset] = value & 0xff
      out[offset + 1] = (value >> 8) & 0xff
      out[offset + 2] = (value >> 16) & 0xff
      offset += 3
    }
  }
  return out
}
