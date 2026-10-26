// SPDX-License-Identifier: AGPL-3.0-or-later
// Playlists da biblioteca: funções puras usadas pelas ações e pela lista de faixas.
import type { LibraryEntry, Playlist } from '../host/api.ts'

/** Acrescenta a faixa no fim; se ela já está na playlist, devolve a mesma playlist. */
export function addTrack(playlist: Playlist, hash: string): Playlist {
  return playlist.hashes.includes(hash)
    ? playlist
    : { ...playlist, hashes: [...playlist.hashes, hash] }
}

export function removeTrack(playlist: Playlist, hash: string): Playlist {
  return { ...playlist, hashes: playlist.hashes.filter((h) => h !== hash) }
}

/** Nome livre que não repete outro: "Playlist", "Playlist 2", ... */
export function uniqueName(playlists: Playlist[], base: string): string {
  const names = new Set(playlists.map((p) => p.name.toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  let n = 2
  while (names.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}

/**
 * Faixas mostradas na biblioteca: todas em ordem de título ou, com uma playlist escolhida, as dela
 * na ordem da playlist. O filtro procura em título e artista.
 */
export function visibleEntries(
  library: Record<string, LibraryEntry>,
  playlist: Playlist | null,
  filter: string,
): LibraryEntry[] {
  const text = filter.trim().toLowerCase()
  const entries = playlist
    ? playlist.hashes.map((hash) => library[hash]).filter((e): e is LibraryEntry => !!e)
    : Object.values(library).sort((a, b) => a.title.localeCompare(b.title))
  return entries.filter(
    (entry) => !text || `${entry.title} ${entry.artist}`.toLowerCase().includes(text),
  )
}
