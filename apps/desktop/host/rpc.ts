// SPDX-License-Identifier: AGPL-3.0-or-later
// Codificação das chamadas do host pelo HTTP do servidor de desenvolvimento: JSON com os
// Uint8Array tirados para fora, em binário, para não inflar buffers de áudio em base64.
// Formato: [tamanho do JSON (u32)][JSON][tamanho (u32)][bytes]...

export function encodeRpc(value: unknown): Uint8Array<ArrayBuffer> {
  const blobs: Uint8Array[] = []
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Uint8Array) {
      blobs.push(item)
      return { $bin: blobs.length - 1 }
    }
    return item
  })
  const text = new TextEncoder().encode(json ?? 'null')
  const size = 4 + text.byteLength + blobs.reduce((sum, blob) => sum + 4 + blob.byteLength, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let offset = 0
  const put = (bytes: Uint8Array) => {
    view.setUint32(offset, bytes.byteLength, true)
    out.set(bytes, offset + 4)
    offset += 4 + bytes.byteLength
  }
  put(text)
  blobs.forEach(put)
  return out
}

export function decodeRpc(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const take = () => {
    const length = view.getUint32(offset, true)
    const slice = bytes.slice(offset + 4, offset + 4 + length)
    offset += 4 + length
    return slice
  }
  const text = new TextDecoder().decode(take())
  const blobs: Uint8Array[] = []
  while (offset < bytes.byteLength) blobs.push(take())
  return JSON.parse(text, (_key, item: unknown) =>
    item && typeof item === 'object' && '$bin' in item
      ? blobs[(item as { $bin: number }).$bin]
      : item,
  )
}
