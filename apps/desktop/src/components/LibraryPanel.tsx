// SPDX-License-Identifier: AGPL-3.0-or-later
// Biblioteca: importar arquivos locais, ver BPM, tom (Camelot) e estado da análise, e mandar uma
// faixa para o grupo selecionado.
import { useMemo, useState } from 'react'
import type { LibraryEntry } from '../../host/api.ts'
import { addToGroup, importTracks, reanalyze, removeFromLibrary } from '../actions.ts'
import { entryGrid } from '../editing.ts'
import { useApp } from '../store.ts'
import { formatTimestamp } from '@djmixer/shared'

export function LibraryPanel() {
  const library = useApp((s) => s.library)
  const analysis = useApp((s) => s.analysis)
  const set = useApp((s) => s.set)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const entries = useMemo(() => {
    const text = filter.trim().toLowerCase()
    return Object.values(library)
      .filter((entry) => !text || `${entry.title} ${entry.artist}`.toLowerCase().includes(text))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [library, filter])

  const status = (entry: LibraryEntry) => {
    const info = analysis[entry.hash]
    if (entry.missing) return <span className="warn">arquivo sumiu</span>
    if (info?.status === 'analyzing') return <span className="muted">analisando…</span>
    if (info?.status === 'pending') return <span className="muted">na fila</span>
    if (info?.status === 'error')
      return (
        <span className="warn" title={info.error}>
          erro
        </span>
      )
    return null
  }

  return (
    <aside className="library">
      <div className="panel-title">
        <span>Biblioteca</span>
        <button className="primary" onClick={() => void importTracks()}>
          Importar…
        </button>
      </div>
      <input
        className="filter"
        placeholder="Filtrar por título ou artista"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="library-list" role="list">
        {entries.length === 0 && (
          <p className="empty">Importe MP3, WAV, FLAC ou AAC do seu computador para começar.</p>
        )}
        {entries.map((entry) => {
          const grid = entryGrid(entry)
          return (
            <div
              key={entry.hash}
              role="listitem"
              data-testid="library-item"
              className={`library-item${selected === entry.hash ? ' selected' : ''}`}
              onClick={() => setSelected(entry.hash)}
              onDoubleClick={() => addToGroup(entry.hash)}
              title="Dois cliques: adicionar ao grupo selecionado"
            >
              <div className="li-main">
                <div className="li-title">{entry.title}</div>
                <div className="li-sub">{entry.artist || '—'}</div>
              </div>
              <div className="li-meta">
                <span className="bpm" data-testid="bpm">
                  {grid ? grid.bpm.toFixed(1) : '—'}
                  {entry.edits.grid && <sup title="Grade corrigida à mão">✎</sup>}
                </span>
                <span className="key">{entry.analysis?.key?.camelot ?? ''}</span>
                <span className="muted">{formatTimestamp(entry.durationSeconds)}</span>
                {status(entry)}
              </div>
            </div>
          )
        })}
      </div>
      {selected && library[selected] && (
        <div className="library-actions">
          <button onClick={() => addToGroup(selected)}>Adicionar ao grupo</button>
          <button
            onClick={() => set({ gridEditor: selected })}
            disabled={!entryGrid(library[selected])}
          >
            Beatgrid e cues
          </button>
          <button onClick={() => reanalyze(selected)}>Analisar de novo</button>
          <button onClick={() => void removeFromLibrary(selected).then(() => setSelected(null))}>
            Remover
          </button>
        </div>
      )}
    </aside>
  )
}
