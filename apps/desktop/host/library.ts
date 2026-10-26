// SPDX-License-Identifier: AGPL-3.0-or-later
// Biblioteca de faixas em SQLite (node:sqlite): metadados, análise, correções do usuário e picos
// da waveform. É a mesma para todos os projetos; o projeto guarda só caminho e hash.
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { LibraryEntry, Playlist, TrackAnalysis, UserEdits } from './api.ts'

interface Row {
  hash: string
  path: string
  title: string
  artist: string
  duration: number
  analysis: string | null
  edits: string | null
  source_url: string | null
}

export interface NewTrack {
  hash: string
  path: string
  title: string
  artist: string
  durationSeconds: number
  sourceUrl?: string
}

const COLUMNS = 'hash, path, title, artist, duration, analysis, edits, source_url'

export class Library {
  private readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tracks (
        hash TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration REAL NOT NULL,
        analysis TEXT,
        edits TEXT,
        peaks BLOB,
        imported_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hashes TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- Faixas trocadas pela versão editada num editor externo (ver docs/decisoes/0017): projetos
      -- antigos guardam o hash anterior e o acham por aqui.
      CREATE TABLE IF NOT EXISTS replaced (
        old_hash TEXT PRIMARY KEY,
        new_hash TEXT NOT NULL
      );
    `)
    // Bibliotecas criadas antes do "Importar de URL" não têm a coluna da origem.
    const columns = this.db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'source_url')) {
      this.db.exec('ALTER TABLE tracks ADD COLUMN source_url TEXT')
    }
  }

  close(): void {
    this.db.close()
  }

  /** Registra a faixa ou, se o hash já existe, só atualiza o caminho. */
  upsert(track: NewTrack): LibraryEntry {
    this.db
      .prepare(
        `INSERT INTO tracks (hash, path, title, artist, duration, source_url, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hash) DO UPDATE SET path = excluded.path`,
      )
      .run(
        track.hash,
        track.path,
        track.title,
        track.artist,
        track.durationSeconds,
        track.sourceUrl ?? null,
        Date.now(),
      )
    return this.get(track.hash) as LibraryEntry
  }

  get(hash: string): LibraryEntry | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM tracks WHERE hash = ?`).get(hash) as
      Row | undefined
    return row ? toEntry(row) : null
  }

  list(): LibraryEntry[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM tracks ORDER BY imported_at, title`)
      .all() as unknown as Row[]
    return rows.map(toEntry)
  }

  /** Tira a faixa da biblioteca e de todas as playlists. */
  remove(hash: string): void {
    this.db.prepare('DELETE FROM tracks WHERE hash = ?').run(hash)
    for (const playlist of this.playlists()) {
      if (playlist.hashes.includes(hash)) {
        this.savePlaylist({ ...playlist, hashes: playlist.hashes.filter((h) => h !== hash) })
      }
    }
  }

  playlists(): Playlist[] {
    const rows = this.db
      .prepare('SELECT id, name, hashes FROM playlists ORDER BY created_at, name')
      .all() as unknown as { id: string; name: string; hashes: string }[]
    return rows.map((row) => ({ ...row, hashes: JSON.parse(row.hashes) as string[] }))
  }

  savePlaylist(playlist: Playlist): void {
    this.db
      .prepare(
        `INSERT INTO playlists (id, name, hashes, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, hashes = excluded.hashes`,
      )
      .run(playlist.id, playlist.name, JSON.stringify(playlist.hashes), Date.now())
  }

  deletePlaylist(id: string): void {
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
  }

  /**
   * Troca a faixa pela versão editada: o novo arquivo herda título, artista, análise, correções,
   * picos, origem e playlists da anterior, que sai da biblioteca.
   */
  replace(oldHash: string, track: Pick<NewTrack, 'hash' | 'path' | 'durationSeconds'>): void {
    if (oldHash === track.hash) return
    this.db.exec('BEGIN')
    try {
      if (this.get(track.hash)) {
        this.setPath(track.hash, track.path)
      } else {
        this.db
          .prepare(
            `INSERT INTO tracks (hash, path, title, artist, duration, analysis, edits, peaks,
               source_url, imported_at)
             SELECT ?, ?, title, artist, ?, analysis, edits, peaks, source_url, imported_at
             FROM tracks WHERE hash = ?`,
          )
          .run(track.hash, track.path, track.durationSeconds, oldHash)
      }
      this.db.prepare('DELETE FROM tracks WHERE hash = ?').run(oldHash)
      for (const playlist of this.playlists()) {
        if (!playlist.hashes.includes(oldHash)) continue
        const hashes = playlist.hashes.map((h) => (h === oldHash ? track.hash : h))
        this.savePlaylist({ ...playlist, hashes: [...new Set(hashes)] })
      }
      this.db
        .prepare('UPDATE replaced SET new_hash = ? WHERE new_hash = ?')
        .run(track.hash, oldHash)
      this.db
        .prepare('INSERT OR REPLACE INTO replaced (old_hash, new_hash) VALUES (?, ?)')
        .run(oldHash, track.hash)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Faixa que substituiu a de `hash` (ver `replace`), ou null. */
  replacement(hash: string): LibraryEntry | null {
    const row = this.db.prepare('SELECT new_hash FROM replaced WHERE old_hash = ?').get(hash) as
      { new_hash: string } | undefined
    return row ? this.get(row.new_hash) : null
  }

  setPath(hash: string, path: string): void {
    this.db.prepare('UPDATE tracks SET path = ? WHERE hash = ?').run(path, hash)
  }

  saveAnalysis(hash: string, analysis: TrackAnalysis, peaks: Uint8Array): void {
    this.db
      .prepare('UPDATE tracks SET analysis = ?, peaks = ? WHERE hash = ?')
      .run(JSON.stringify(analysis), peaks, hash)
  }

  saveEdits(hash: string, edits: UserEdits): void {
    this.db.prepare('UPDATE tracks SET edits = ? WHERE hash = ?').run(JSON.stringify(edits), hash)
  }

  peaks(hash: string): Uint8Array | null {
    const row = this.db.prepare('SELECT peaks FROM tracks WHERE hash = ?').get(hash) as
      { peaks: Uint8Array | null } | undefined
    return row?.peaks ? new Uint8Array(row.peaks) : null
  }
}

function toEntry(row: Row): LibraryEntry {
  return {
    hash: row.hash,
    path: row.path,
    title: row.title,
    artist: row.artist,
    durationSeconds: row.duration,
    analysis: row.analysis ? (JSON.parse(row.analysis) as TrackAnalysis) : null,
    edits: row.edits ? (JSON.parse(row.edits) as UserEdits) : { grid: null, cues: [] },
    missing: !existsSync(row.path),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
  }
}
