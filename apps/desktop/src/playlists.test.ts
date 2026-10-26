// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../host/api.ts'
import { libraryTree, moveTrack, uniqueName } from './playlists.ts'

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
  d: entry('d', 'Delta'),
}

const playlists = [
  { id: 'p', name: 'Pico', hashes: ['c', 'sumiu'] },
  { id: 'w', name: 'Abertura', hashes: ['a', 'b'] },
]

describe('playlists como pastas', () => {
  it('move a faixa para uma pasta, tirando das outras, ou a deixa solta', () => {
    const moved = moveTrack(playlists, 'a', 'p')
    expect(moved.map((p) => p.hashes)).toEqual([['c', 'sumiu', 'a'], ['b']])
    expect(moveTrack(moved, 'a', null).map((p) => p.hashes)).toEqual([['c', 'sumiu'], ['b']])
    const same = moveTrack(playlists, 'c', 'p')
    expect(same[0]).toBe(playlists[0])
    expect(same[1]).toBe(playlists[1])
  })

  it('escolhe um nome que não repete', () => {
    const lists = [
      { id: '1', name: 'Playlist', hashes: [] },
      { id: '2', name: 'playlist 2', hashes: [] },
    ]
    expect(uniqueName(lists, 'Playlist')).toBe('Playlist 3')
    expect(uniqueName(lists, 'Pico')).toBe('Pico')
  })

  it('mostra pastas por nome e as faixas soltas por título', () => {
    const tree = libraryTree(library, playlists, '')
    expect(tree.folders.map((f) => [f.playlist.name, f.entries.map((e) => e.title)])).toEqual([
      ['Abertura', ['Alfa', 'Zeta']],
      ['Pico', ['Meio']],
    ])
    expect(tree.loose.map((e) => e.title)).toEqual(['Delta'])
  })

  it('filtra dentro das pastas e esconde as que ficam vazias', () => {
    const tree = libraryTree(library, playlists, 'kölsch')
    expect(tree.folders.map((f) => [f.playlist.name, f.entries.map((e) => e.hash)])).toEqual([
      ['Abertura', ['a']],
      ['Pico', ['c']],
    ])
    expect(tree.loose).toEqual([])
    const byName = libraryTree(library, playlists, 'abert')
    expect(byName.folders.map((f) => f.entries.length)).toEqual([2])
  })

  it('uma faixa que ficou em duas playlists aparece só na primeira por nome', () => {
    const tree = libraryTree(library, [...playlists, { id: 'x', name: 'Zz', hashes: ['a'] }], '')
    expect(tree.folders.find((f) => f.playlist.id === 'x')?.entries).toEqual([])
  })
})
