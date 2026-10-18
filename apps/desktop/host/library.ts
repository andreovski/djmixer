// SPDX-License-Identifier: AGPL-3.0-or-later
// Biblioteca de faixas em SQLite (node:sqlite): metadados, análise, correções do usuário e picos
// da waveform. É a mesma para todos os projetos; o projeto guarda só caminho e hash.
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { LibraryEntry, TrackAnalysis, UserEdits } from './api.ts'

interface Row {
  hash: string
  path: string
  title: string
  artist: string
  duration: number
  analysis: string | null
  edits: string | null
}

export interface NewTrack {
  hash: string
  path: string
  title: string
  artist: string
  durationSeconds: number
}

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
    `)
  }

  close(): void {
    this.db.close()
  }

  /** Registra a faixa ou, se o hash já existe, só atualiza o caminho. */
  upsert(track: NewTrack): LibraryEntry {
    this.db
      .prepare(
        `INSERT INTO tracks (hash, path, title, artist, duration, imported_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(hash) DO UPDATE SET path = excluded.path`,
      )
      .run(track.hash, track.path, track.title, track.artist, track.durationSeconds, Date.now())
    return this.get(track.hash) as LibraryEntry
  }

  get(hash: string): LibraryEntry | null {
    const row = this.db
      .prepare(
        'SELECT hash, path, title, artist, duration, analysis, edits FROM tracks WHERE hash = ?',
      )
      .get(hash) as Row | undefined
    return row ? toEntry(row) : null
  }

  list(): LibraryEntry[] {
    const rows = this.db
      .prepare(
        'SELECT hash, path, title, artist, duration, analysis, edits FROM tracks ORDER BY imported_at, title',
      )
      .all() as unknown as Row[]
    return rows.map(toEntry)
  }

  remove(hash: string): void {
    this.db.prepare('DELETE FROM tracks WHERE hash = ?').run(hash)
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
  }
}
