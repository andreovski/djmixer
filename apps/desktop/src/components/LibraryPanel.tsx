// SPDX-License-Identifier: AGPL-3.0-or-later
// Biblioteca como um Finder: playlists são pastas (cada faixa fica em no máximo uma) e as faixas
// sem pasta aparecem soltas embaixo. Importar arquivos locais ou de uma URL (yt-dlp, só no app
// desktop), ver capa, BPM, tom (Camelot), qualidade do arquivo e estado da análise, e mandar uma
// faixa para o grupo selecionado.
import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import {
  COOKIE_BROWSERS,
  type AudioInfo,
  type CookieBrowser,
  type LibraryEntry,
  type SoundCloudResult,
} from '../../host/api.ts'
import {
  addToGroup,
  chooseEditor,
  createPlaylist,
  editorName,
  deletePlaylist,
  importFromUrl,
  importTracks,
  loadCover,
  moveToPlaylist,
  openInEditor,
  reanalyze,
  removeFromLibrary,
  renamePlaylist,
  revealTrack,
  searchSoundCloud,
} from '../actions.ts'
import { host } from '../host.ts'
import { entryGrid } from '../editing.ts'
import { libraryTree } from '../playlists.ts'
import { describeAudio } from '../quality.ts'
import { COMPACT_QUERY, matches, TOUCH_QUERY, useMedia } from '../responsive.ts'
import { useApp } from '../store.ts'
import { formatTimestamp } from '@djmixer/shared'

/** Valores especiais do seletor "Mover para". */
const LOOSE = '__solta__'
const NEW_PLAYLIST = '__nova__'
/** Tipo do dado arrastado: o hash da faixa. */
const DRAG_TYPE = 'application/x-djmixer-track'

const BROWSER_NAMES: Record<CookieBrowser, string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  brave: 'Brave',
  edge: 'Edge',
  chromium: 'Chromium',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
}
const BROWSER_KEY = 'djmixer.soundcloudBrowser'

function savedBrowser(): CookieBrowser | null {
  try {
    const value = localStorage.getItem(BROWSER_KEY)
    return (COOKIE_BROWSERS as readonly string[]).includes(value ?? '')
      ? (value as CookieBrowser)
      : null
  } catch {
    return null
  }
}

type Selection = { kind: 'track'; hash: string } | { kind: 'folder'; id: string } | null

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

/** Qualidade do arquivo da faixa selecionada, pedida ao host quando a seleção muda. */
function Quality({ entry }: { entry: LibraryEntry }) {
  const [info, setInfo] = useState<AudioInfo | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    setInfo(undefined)
    if (!host.getAudioInfo || entry.missing) {
      setInfo(null)
      return
    }
    host
      .getAudioInfo(entry.hash)
      .then((result) => current && setInfo(result))
      .catch(() => current && setInfo(null))
    return () => {
      current = false
    }
  }, [entry.hash, entry.missing])
  return (
    <div className="track-quality" data-testid="track-quality">
      <div className="tq-title">{entry.title}</div>
      {info === undefined && <span className="muted">lendo o arquivo…</span>}
      {info === null && <span className="muted">qualidade indisponível</span>}
      {info && (
        <div className="tq-line">
          <span className={`tq-tag ${info.lossless ? 'lossless' : 'lossy'}`}>
            {info.lossless ? 'sem perdas' : 'com perdas'}
          </span>
          {describeAudio(info).join(' · ')}
        </div>
      )}
      {entry.sourceUrl && (
        <div className="tq-source" title={entry.sourceUrl}>
          Baixada de {entry.sourceUrl}
        </div>
      )}
    </div>
  )
}

export function LibraryPanel() {
  const library = useApp((s) => s.library)
  const analysis = useApp((s) => s.analysis)
  const playlists = useApp((s) => s.playlists)
  const set = useApp((s) => s.set)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Selection>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  // Busca do SoundCloud: resultados (null: nenhuma busca ainda) e faixa baixando (url).
  const [results, setResults] = useState<SoundCloudResult[] | null>(null)
  const [scSearching, setScSearching] = useState(false)
  const [fetching, setFetching] = useState<string | null>(null)
  // Navegador com o login do SoundCloud, lembrado entre aberturas do app.
  const [browser, setBrowser] = useState<CookieBrowser | null>(savedBrowser)
  // Campo de nome aberto para criar ou renomear pasta.
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Pasta (id) ou raiz ('') sob a faixa arrastada.
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const touch = useMedia(TOUCH_QUERY)
  const replaced = useApp((s) => s.replaced)

  // A faixa selecionada foi trocada pela versão editada: a seleção segue o novo hash.
  useEffect(() => {
    if (replaced) {
      setSelected((current) =>
        current?.kind === 'track' && current.hash === replaced.from
          ? { kind: 'track', hash: replaced.to }
          : current,
      )
    }
  }, [replaced])

  const tree = useMemo(() => libraryTree(library, playlists, filter), [library, playlists, filter])
  const searching = filter.trim() !== ''
  const track = selected?.kind === 'track' ? library[selected.hash] : undefined
  const folder =
    selected?.kind === 'folder' ? playlists.find((p) => p.id === selected.id) : undefined
  const folderOf = (hash: string) => playlists.find((p) => p.hashes.includes(hash))?.id ?? LOOSE

  // Em tela compacta o set fica em outra aba: depois de adicionar, mostra o grupo.
  const add = (hash: string) => {
    const before = useApp.getState().project
    addToGroup(hash)
    if (useApp.getState().project !== before && matches(COMPACT_QUERY)) set({ pane: 'set' })
  }

  const select = (next: Selection) => {
    setSelected(next)
    setConfirmDelete(false)
    setNaming(null)
  }

  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }

  // O campo aceita um link (baixa direto) ou um texto (busca no SoundCloud).
  const submitUrl = async (event: FormEvent) => {
    event.preventDefault()
    const text = url.trim()
    if (!text || downloading || scSearching) return
    if (/^https?:\/\//i.test(text)) {
      setDownloading(true)
      const ok = await importFromUrl(text, browser)
      setDownloading(false)
      if (ok) {
        setUrl('')
        setUrlOpen(false)
      }
      return
    }
    setScSearching(true)
    setResults(await searchSoundCloud(text))
    setScSearching(false)
  }

  const fetchResult = async (result: SoundCloudResult) => {
    if (fetching) return
    setFetching(result.url)
    await importFromUrl(result.url, browser)
    setFetching(null)
  }

  const inLibrary = useMemo(
    () => new Set(Object.values(library).map((entry) => entry.sourceUrl)),
    [library],
  )

  const startNaming = (mode: 'new' | 'rename') => {
    setNaming(mode)
    setName(mode === 'rename' ? (folder?.name ?? '') : '')
    setConfirmDelete(false)
  }

  const submitName = async (event: FormEvent) => {
    event.preventDefault()
    if (naming === 'rename' && folder) await renamePlaylist(folder.id, name)
    else {
      const id = await createPlaylist(name)
      setOpen(new Set(open).add(id))
      select({ kind: 'folder', id })
    }
    setNaming(null)
  }

  const move = async (hash: string, value: string) => {
    if (!value) return
    if (value === NEW_PLAYLIST) {
      const id = await createPlaylist('Playlist', [hash])
      setOpen(new Set(open).add(id))
    } else {
      await moveToPlaylist(hash, value === LOOSE ? null : value)
      if (value !== LOOSE) setOpen(new Set(open).add(value))
    }
  }

  // Arrastar uma faixa para uma pasta (ou para fora delas) a move.
  const dropProps = (target: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(target)
    },
    onDragLeave: () => setDropTarget((current) => (current === target ? null : current)),
    onDrop: (event: DragEvent) => {
      const hash = event.dataTransfer.getData(DRAG_TYPE)
      setDropTarget(null)
      if (!hash) return
      event.preventDefault()
      event.stopPropagation()
      void move(hash, target || LOOSE)
    },
  })

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

  const trackRow = (entry: LibraryEntry, nested: boolean) => {
    const grid = entryGrid(entry)
    const isSelected = selected?.kind === 'track' && selected.hash === entry.hash
    return (
      <div
        key={entry.hash}
        role="listitem"
        data-testid="library-item"
        className={`library-item${nested ? ' nested' : ''}${isSelected ? ' selected' : ''}`}
        onClick={() => select({ kind: 'track', hash: entry.hash })}
        onDoubleClick={() => add(entry.hash)}
        draggable={!touch}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, entry.hash)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => setDropTarget(null)}
        title={
          touch
            ? 'Toque para selecionar; use Adicionar ao grupo'
            : 'Dois cliques: adicionar ao grupo selecionado. Arraste para uma pasta para mover.'
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
  }

  const empty = Object.keys(library).length === 0 && playlists.length === 0

  return (
    <aside className="library">
      <div className="panel-title">
        <span>Biblioteca</span>
        <div className="panel-buttons">
          {host.importFromUrl && (
            <button onClick={() => setUrlOpen(!urlOpen)} aria-expanded={urlOpen}>
              SoundCloud…
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
            type="search"
            placeholder="Buscar no SoundCloud ou colar um link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={downloading || scSearching}
            autoFocus
          />
          <button
            type="submit"
            className="primary"
            disabled={downloading || scSearching || !url.trim()}
          >
            {downloading
              ? 'Baixando…'
              : scSearching
                ? 'Buscando…'
                : /^https?:\/\//i.test(url.trim())
                  ? 'Baixar'
                  : 'Buscar'}
          </button>
          <label className="url-login" htmlFor="soundcloud-browser">
            Login do SoundCloud
            <select
              id="soundcloud-browser"
              value={browser ?? ''}
              disabled={downloading}
              onChange={(e) => {
                const value = (e.target.value || null) as CookieBrowser | null
                setBrowser(value)
                try {
                  if (value) localStorage.setItem(BROWSER_KEY, value)
                  else localStorage.removeItem(BROWSER_KEY)
                } catch {
                  // Sem armazenamento: vale só até fechar o app.
                }
              }}
              title="Com o login, o SoundCloud entrega o arquivo original quando o artista libera download"
            >
              <option value="">sem login</option>
              {COOKIE_BROWSERS.map((name) => (
                <option key={name} value={name}>
                  {BROWSER_NAMES[name]}
                </option>
              ))}
            </select>
          </label>
        </form>
      )}
      {urlOpen && scSearching && (
        <p className="empty">Buscando e conferindo quais faixas dá para baixar…</p>
      )}
      {urlOpen && !scSearching && results && (
        <div className="sc-results" aria-label="Resultados do SoundCloud">
          {results.length === 0 && (
            <p className="empty">
              Nada que dê para baixar (faixas com DRM ou só prévia ficam de fora).
            </p>
          )}
          {results.map((result) => {
            const have = inLibrary.has(result.url)
            return (
              <div key={result.id} className="sc-result" data-testid="sc-result">
                {result.thumbnail ? (
                  <img className="li-cover" src={result.thumbnail} alt="" loading="lazy" />
                ) : (
                  <span className="li-cover li-cover-empty" aria-hidden="true" />
                )}
                <span className="sc-text">
                  <span className="sc-title" title={result.title}>
                    {result.title}
                  </span>
                  <span className="muted">
                    {[
                      result.artist,
                      result.durationSeconds !== null && formatTimestamp(result.durationSeconds),
                      result.kbps && `${result.kbps} kbps`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <button
                  onClick={() => void fetchResult(result)}
                  disabled={have || fetching !== null}
                  title={have ? 'Já está na biblioteca' : 'Baixar para a biblioteca'}
                >
                  {have ? 'Na biblioteca' : fetching === result.url ? 'Baixando…' : 'Baixar'}
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="inline-form">
        <input
          id="library-filter"
          placeholder="Buscar em toda a biblioteca"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button onClick={() => startNaming('new')} title="Criar uma pasta de playlist">
          + Playlist
        </button>
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
      <div
        className={`library-list${dropTarget === '' ? ' drop' : ''}`}
        role="list"
        {...dropProps('')}
      >
        {empty && (
          <p className="empty">Importe MP3, WAV, FLAC ou AAC do seu computador para começar.</p>
        )}
        {searching && tree.folders.length === 0 && tree.loose.length === 0 && !empty && (
          <p className="empty">Nada encontrado.</p>
        )}
        {tree.folders.map(({ playlist, entries }) => {
          const expanded = searching || open.has(playlist.id)
          const isSelected = selected?.kind === 'folder' && selected.id === playlist.id
          return (
            <div key={playlist.id} role="group" aria-label={playlist.name}>
              <div
                role="listitem"
                data-testid="library-folder"
                aria-expanded={expanded}
                className={`library-folder${isSelected ? ' selected' : ''}${dropTarget === playlist.id ? ' drop' : ''}`}
                onClick={() => {
                  select({ kind: 'folder', id: playlist.id })
                  if (!searching) toggle(playlist.id)
                }}
                {...dropProps(playlist.id)}
              >
                <span className="lf-caret" aria-hidden="true">
                  {expanded ? '▾' : '▸'}
                </span>
                <span className="lf-icon" aria-hidden="true" />
                <span className="lf-name">{playlist.name}</span>
                <span className="muted">{entries.length}</span>
              </div>
              {expanded && entries.map((entry) => trackRow(entry, true))}
              {expanded && entries.length === 0 && (
                <p className="empty nested">
                  {touch ? 'Pasta vazia: use Mover para…' : 'Pasta vazia: arraste faixas para cá.'}
                </p>
              )}
            </div>
          )
        })}
        {tree.loose.map((entry) => trackRow(entry, false))}
      </div>
      {track && selected?.kind === 'track' && (
        <div className="library-actions">
          <Quality entry={track} />
          <button onClick={() => add(selected.hash)}>Adicionar ao grupo</button>
          <button onClick={() => set({ gridEditor: selected.hash })} disabled={!entryGrid(track)}>
            Beatgrid e cues
          </button>
          <select
            id="move-to-playlist"
            aria-label="Mover para playlist"
            value=""
            onChange={(e) => void move(selected.hash, e.target.value)}
          >
            <option value="">Mover para…</option>
            {[...playlists]
              .sort((a, b) => a.name.localeCompare(b.name))
              .filter((p) => p.id !== folderOf(selected.hash))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            {folderOf(selected.hash) !== LOOSE && <option value={LOOSE}>Fora das playlists</option>}
            <option value={NEW_PLAYLIST}>Nova playlist com esta faixa</option>
          </select>
          {host.revealTrack && (
            <button onClick={() => void revealTrack(selected.hash)}>Mostrar no Finder</button>
          )}
          {host.openInEditor && <EditorButton hash={selected.hash} />}
          <button onClick={() => reanalyze(selected.hash)}>Analisar de novo</button>
          <button
            onClick={() => void removeFromLibrary(selected.hash).then(() => select(null))}
            title={
              track.sourceUrl
                ? 'Tira da biblioteca e apaga o arquivo baixado'
                : 'Tira da biblioteca; o arquivo continua no seu computador'
            }
          >
            Remover
          </button>
        </div>
      )}
      {folder && (
        <div className="library-actions">
          <span className="la-label">Playlist “{folder.name}”</span>
          <button onClick={() => startNaming('rename')}>Renomear</button>
          <button
            className={confirmDelete ? 'danger' : undefined}
            onClick={() =>
              confirmDelete
                ? void deletePlaylist(folder.id).then(() => select(null))
                : setConfirmDelete(true)
            }
            title="As faixas continuam na biblioteca, fora das playlists"
          >
            {confirmDelete ? 'Confirmar: apagar' : 'Apagar playlist'}
          </button>
        </div>
      )}
    </aside>
  )
}

/**
 * Abre a faixa no editor externo (iZotope RX, por exemplo), mostrando o ícone do próprio app. O
 * botão direito troca o editor.
 */
function EditorButton({ hash }: { hash: string }) {
  const editor = useApp((s) => s.editorApp)
  const icon = useApp((s) => s.editorIcon)
  const name = editor ? editorName(editor) : null
  const tip = name
    ? `Abrir no ${name} (botão direito: trocar o editor)`
    : 'Abrir num editor de áudio (iZotope RX, por exemplo)'
  return (
    <button
      className="editor-button"
      title={tip}
      aria-label={tip}
      onClick={() => void openInEditor(hash)}
      onContextMenu={(event) => {
        event.preventDefault()
        void chooseEditor()
      }}
    >
      {icon ? (
        <img src={icon} alt="" />
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2 10h2M6 6v8M9 3v14M12 7v6M15 5v10M18 9v2" />
        </svg>
      )}
    </button>
  )
}
