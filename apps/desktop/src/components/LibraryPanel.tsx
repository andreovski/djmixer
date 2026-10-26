// SPDX-License-Identifier: AGPL-3.0-or-later
// Biblioteca: importar arquivos locais ou de uma URL (yt-dlp, só no app desktop), organizar em
// playlists, ver capa, BPM, tom (Camelot) e estado da análise, e mandar uma faixa para o grupo
// selecionado.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { LibraryEntry } from '../../host/api.ts'
import {
  addToGroup,
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  importFromUrl,
  importTracks,
  loadCover,
  reanalyze,
  removeFromLibrary,
  removeFromPlaylist,
  renamePlaylist,
} from '../actions.ts'
import { host } from '../host.ts'
import { entryGrid } from '../editing.ts'
import { visibleEntries } from '../playlists.ts'
import { COMPACT_QUERY, matches, TOUCH_QUERY, useMedia } from '../responsive.ts'
import { useApp } from '../store.ts'
import { formatTimestamp } from '@djmixer/shared'

/** Valor do seletor "Adicionar à playlist" que cria uma playlist nova com a faixa. */
const NEW_PLAYLIST = '__nova__'

function Cover({ entry }: { entry: LibraryEntry }) {
  const url = useApp((s) => s.covers[entry.hash])
  useEffect(() => {
    if (!entry.missing) loadCover(entry.hash)
  }, [entry.hash, entry.missing])
  return url ? (
    <img className="li-cover" src={url} alt="" loading="lazy" />
  ) : (
    <div className="li-cover li-cover-empty" aria-hidden="true">
      {entry.title.trim().charAt(0).toUpperCase()}
    </div>
  )
}

export function LibraryPanel() {
  const library = useApp((s) => s.library)
  const analysis = useApp((s) => s.analysis)
  const playlists = useApp((s) => s.playlists)
  const playlistId = useApp((s) => s.playlistId)
  const set = useApp((s) => s.set)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  // Campo de nome aberto para criar ou renomear playlist.
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const touch = useMedia(TOUCH_QUERY)

  const playlist = playlists.find((p) => p.id === playlistId) ?? null

  // Em tela compacta o set fica em outra aba: depois de adicionar, mostra o grupo.
  const add = (hash: string) => {
    const before = useApp.getState().project
    addToGroup(hash)
    if (useApp.getState().project !== before && matches(COMPACT_QUERY)) set({ pane: 'set' })
  }

  const entries = useMemo(
    () => visibleEntries(library, playlist, filter),
    [library, playlist, filter],
  )

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

  const choosePlaylist = (id: string) => {
    set({ playlistId: id || null })
    setNaming(null)
    setConfirmDelete(false)
  }

  const startNaming = (mode: 'new' | 'rename') => {
    setNaming(mode)
    setName(mode === 'rename' ? (playlist?.name ?? '') : '')
    setConfirmDelete(false)
  }

  const submitName = async (event: FormEvent) => {
    event.preventDefault()
    if (naming === 'rename' && playlist) await renamePlaylist(playlist.id, name)
    else await createPlaylist(name)
    setNaming(null)
  }

  const onAddToPlaylist = (value: string) => {
    if (!selected || !value) return
    if (value === NEW_PLAYLIST) void createPlaylist('Playlist', [selected])
    else void addToPlaylist(value, selected)
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

  const total = Object.keys(library).length

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
        <form className="inline-form" onSubmit={(event) => void submitUrl(event)}>
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
      <div className="playlist-bar">
        <select
          id="library-playlist"
          aria-label="Playlist"
          value={playlistId ?? ''}
          onChange={(e) => choosePlaylist(e.target.value)}
        >
          <option value="">Todas as faixas ({total})</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.hashes.filter((hash) => library[hash]).length})
            </option>
          ))}
        </select>
        <button onClick={() => startNaming('new')} title="Criar uma playlist">
          + Playlist
        </button>
        {playlist && (
          <>
            <button onClick={() => startNaming('rename')}>Renomear</button>
            <button
              className={confirmDelete ? 'danger' : undefined}
              onClick={() =>
                confirmDelete ? void deletePlaylist(playlist.id) : setConfirmDelete(true)
              }
              title="As faixas continuam na biblioteca"
            >
              {confirmDelete ? 'Confirmar' : 'Apagar'}
            </button>
          </>
        )}
      </div>
      {naming && (
        <form className="inline-form" onSubmit={(event) => void submitName(event)}>
          <input
            id="playlist-name"
            placeholder={naming === 'new' ? 'Nome da playlist' : 'Novo nome'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
            autoFocus
          />
          <button type="submit" className="primary" disabled={naming === 'rename' && !name.trim()}>
            {naming === 'new' ? 'Criar' : 'Salvar'}
          </button>
          <button type="button" onClick={() => setNaming(null)}>
            Cancelar
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
          <p className="empty">
            {playlist
              ? 'Playlist vazia. Selecione uma faixa em "Todas as faixas" e use Adicionar à playlist.'
              : 'Importe MP3, WAV, FLAC ou AAC do seu computador para começar.'}
          </p>
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
              <Cover entry={entry} />
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
          <select
            id="add-to-playlist"
            aria-label="Adicionar à playlist"
            value=""
            onChange={(e) => onAddToPlaylist(e.target.value)}
          >
            <option value="">Adicionar à playlist…</option>
            {playlists
              .filter((p) => p.id !== playlistId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            <option value={NEW_PLAYLIST}>Nova playlist com esta faixa</option>
          </select>
          {playlist && (
            <button onClick={() => void removeFromPlaylist(playlist.id, selected)}>
              Tirar da playlist
            </button>
          )}
          <button onClick={() => reanalyze(selected)}>Analisar de novo</button>
          <button onClick={() => void removeFromLibrary(selected).then(() => setSelected(null))}>
            Remover
          </button>
        </div>
      )}
    </aside>
  )
}
