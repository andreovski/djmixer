// SPDX-License-Identifier: AGPL-3.0-or-later
// Biblioteca: importar arquivos locais ou de uma URL (yt-dlp, só no app desktop), ver BPM, tom (Camelot) e estado da análise, e mandar uma
// faixa para o grupo selecionado.
import { useMemo, useState, type FormEvent } from 'react'
import type { LibraryEntry } from '../../host/api.ts'
import {
  addToGroup,
  importFromUrl,
  importTracks,
  reanalyze,
  removeFromLibrary,
} from '../actions.ts'
import { host } from '../host.ts'
import { entryGrid } from '../editing.ts'
import { COMPACT_QUERY, matches, TOUCH_QUERY, useMedia } from '../responsive.ts'
import { useApp } from '../store.ts'
import { formatTimestamp } from '@djmixer/shared'

export function LibraryPanel() {
  const library = useApp((s) => s.library)
  const analysis = useApp((s) => s.analysis)
  const set = useApp((s) => s.set)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const touch = useMedia(TOUCH_QUERY)

  // Em tela compacta o set fica em outra aba: depois de adicionar, mostra o grupo.
  const add = (hash: string) => {
    const before = useApp.getState().project
    addToGroup(hash)
    if (useApp.getState().project !== before && matches(COMPACT_QUERY)) set({ pane: 'set' })
  }

  const entries = useMemo(() => {
    const text = filter.trim().toLowerCase()
    return Object.values(library)
      .filter((entry) => !text || `${entry.title} ${entry.artist}`.toLowerCase().includes(text))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [library, filter])

  const submitUrl = async (event: FormEvent) => {
    event.preventDefault()
    if (!url.trim() || downloading) return
    setDownloading(true)
    const ok = await importFromUrl(url.trim())
    setDownloading(false)
    if (ok) {
      setUrl('')
      setUrlOpen(false)
    }
  }

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
        <div className="panel-buttons">
          {host.importFromUrl && (
            <button onClick={() => setUrlOpen(!urlOpen)} aria-expanded={urlOpen}>
              De URL…
            </button>
          )}
          <button className="primary" onClick={() => void importTracks()}>
            Importar…
          </button>
        </div>
      </div>
      {urlOpen && (
        <form className="url-import" onSubmit={(event) => void submitUrl(event)}>
          <input
            id="import-url"
            type="url"
            placeholder="https://soundcloud.com/artista/faixa"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={downloading}
            autoFocus
          />
          <button type="submit" className="primary" disabled={downloading || !url.trim()}>
            {downloading ? 'Baixando…' : 'Baixar'}
          </button>
        </form>
      )}
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
              onDoubleClick={() => add(entry.hash)}
              title={
                touch
                  ? 'Toque para selecionar; use Adicionar ao grupo'
                  : 'Dois cliques: adicionar ao grupo selecionado'
              }
            >
              <div className="li-main">
                <div className="li-title">{entry.title}</div>
                <div className="li-sub">
                  {entry.sourceUrl && (
                    <span
                      className="li-source"
                      title={`Baixada de ${entry.sourceUrl}; não entra no export`}
                    >
                      URL
                    </span>
                  )}
                  {entry.artist || '—'}
                </div>
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
          <button onClick={() => add(selected)}>Adicionar ao grupo</button>
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
