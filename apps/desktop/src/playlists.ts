// SPDX-License-Identifier: AGPL-3.0-or-later
// Playlists da biblioteca, que funcionam como pastas: cada faixa fica em no máximo uma, e as que
// não estão em nenhuma aparecem soltas. Funções puras usadas pelas ações e pela lista.
import type { LibraryEntry, Playlist } from '../host/api.ts'

/**
 * Põe a faixa na pasta `targetId` (null: solta) e a tira das outras. Devolve a lista de
 * playlists; só as que mudaram são objetos novos.
 */
export function moveTrack(
  playlists: Playlist[],
  hash: string,
  targetId: string | null,
): Playlist[] {
  return playlists.map((playlist) => {
    const has = playlist.hashes.includes(hash)
    if (playlist.id === targetId) {
      return has ? playlist : { ...playlist, hashes: [...playlist.hashes, hash] }
    }
    return has ? { ...playlist, hashes: playlist.hashes.filter((h) => h !== hash) } : playlist
  })
}

/** Nome livre que não repete outro: "Playlist", "Playlist 2", ... */
export function uniqueName(playlists: Playlist[], base: string): string {
  const names = new Set(playlists.map((p) => p.name.toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  let n = 2
  while (names.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}

export interface Folder {
  playlist: Playlist
  entries: LibraryEntry[]
}

export interface LibraryTree {
  folders: Folder[]
  /** Faixas fora de qualquer playlist, por título. */
  loose: LibraryEntry[]
}

const byTitle = (a: LibraryEntry, b: LibraryEntry) => a.title.localeCompare(b.title)

/**
 * A biblioteca como no Finder: pastas (em ordem de nome, com as faixas por título) e as faixas
 * soltas. Com filtro, cada pasta mostra só as faixas que combinam (todas, se o nome da pasta
 * combina) e some se não sobrar nada.
 */
export function libraryTree(
  library: Record<string, LibraryEntry>,
  playlists: Playlist[],
  filter: string,
): LibraryTree {
  const text = filter.trim().toLowerCase()
  const matches = (entry: LibraryEntry) =>
    !text || `${entry.title} ${entry.artist}`.toLowerCase().includes(text)
  const inFolder = new Set<string>()
  const folders: Folder[] = []
  for (const playlist of [...playlists].sort((a, b) => a.name.localeCompare(b.name))) {
    const all = playlist.hashes
      .filter((hash) => !inFolder.has(hash))
      .map((hash) => library[hash])
      .filter((e): e is LibraryEntry => !!e)
    for (const entry of all) inFolder.add(entry.hash)
    const nameMatches = !!text && playlist.name.toLowerCase().includes(text)
    const entries = (nameMatches ? all : all.filter(matches)).sort(byTitle)
    if (!text || nameMatches || entries.length) folders.push({ playlist, entries })
  }
  const loose = Object.values(library)
    .filter((entry) => !inFolder.has(entry.hash) && matches(entry))
    .sort(byTitle)
  return { folders, loose }
}
