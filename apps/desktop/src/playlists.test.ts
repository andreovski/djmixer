// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../host/api.ts'
import { addTrack, removeTrack, uniqueName, visibleEntries } from './playlists.ts'

const entry = (hash: string, title: string, artist = ''): LibraryEntry => ({
  hash,
  path: `/m/${hash}.mp3`,
  title,
  artist,
  durationSeconds: 60,
  analysis: null,
  edits: { grid: null, cues: [] },
  missing: false,
})

const library = {
  a: entry('a', 'Zeta', 'Kölsch'),
  b: entry('b', 'Alfa', 'Solomun'),
  c: entry('c', 'Meio', 'Kölsch'),
}

describe('playlists', () => {
  it('acrescenta sem repetir e tira faixas', () => {
    const p = { id: '1', name: 'Warm up', hashes: ['a'] }
    expect(addTrack(p, 'a')).toBe(p)
    expect(addTrack(p, 'b').hashes).toEqual(['a', 'b'])
    expect(removeTrack(addTrack(p, 'b'), 'a').hashes).toEqual(['b'])
  })

  it('escolhe um nome que não repete', () => {
    const lists = [
      { id: '1', name: 'Playlist', hashes: [] },
      { id: '2', name: 'playlist 2', hashes: [] },
    ]
    expect(uniqueName(lists, 'Playlist')).toBe('Playlist 3')
    expect(uniqueName(lists, 'Pico')).toBe('Pico')
  })

  it('mostra a biblioteca por título ou a playlist na ordem dela, com filtro', () => {
    expect(visibleEntries(library, null, '').map((e) => e.title)).toEqual(['Alfa', 'Meio', 'Zeta'])
    const p = { id: '1', name: 'P', hashes: ['a', 'sumiu', 'c'] }
    expect(visibleEntries(library, p, '').map((e) => e.hash)).toEqual(['a', 'c'])
    expect(visibleEntries(library, p, 'meio').map((e) => e.hash)).toEqual(['c'])
    expect(visibleEntries(library, null, 'kölsch').map((e) => e.hash)).toEqual(['c', 'a'])
  })
})
