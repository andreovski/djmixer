// SPDX-License-Identifier: AGPL-3.0-or-later
// Ações da interface que falam com o host: biblioteca e análise, abrir e salvar projeto, export.
import {
  createProject,
  parseProject,
  serializeProject,
  type Beatgrid,
  type Cue,
} from '@djmixer/shared'
import type { CookieBrowser, LibraryEntry, Playlist, UserEdits } from '../host/api.ts'
import { decodedPcm, errorText, exportSet, stop } from './audio.ts'
import {
  addTrackToGroup,
  applyGridEdit,
  createGroup,
  pruneTracks,
  urlTracksInSet,
} from './editing.ts'
import { host } from './host.ts'
import { moveTrack, uniqueName } from './playlists.ts'
import { downloadSummary } from './quality.ts'
import { currentGroup, useApp } from './store.ts'
import type { AnalysisRequest, AnalysisResponse } from './workers/analysis.worker.ts'

const state = () => useApp.getState()

function putEntries(entries: LibraryEntry[]) {
  const library = { ...state().library }
  for (const entry of entries) library[entry.hash] = entry
  state().set({ library })
}

export async function loadLibrary(): Promise<void> {
  void loadPlaylists()
  try {
    const entries = await host.listLibrary()
    putEntries(entries)
    const analysis = { ...state().analysis }
    for (const entry of entries) {
      analysis[entry.hash] = { status: entry.analysis ? 'done' : 'pending' }
    }
    state().set({ analysis })
    for (const entry of entries) if (entry.analysis && !entry.missing) void loadPeaks(entry.hash)
    queueAnalysis(entries.filter((entry) => !entry.analysis && !entry.missing))
  } catch (error) {
    state().notify('error', `Biblioteca: ${errorText(error)}`)
  }
}

async function loadPeaks(hash: string) {
  const peaks = await host.getPeaks(hash)
  if (peaks) state().set({ peaks: { ...state().peaks, [hash]: peaks } })
}

export async function importTracks(): Promise<void> {
  const paths = await host.pickAudioFiles()
  if (paths.length === 0) return
  state().notify('info', `Importando ${paths.length} arquivo(s)...`)
  const { entries, errors } = await host.importFiles(paths)
  putEntries(entries)
  if (errors.length) state().notify('error', `Não importados: ${errors.join('; ')}`)
  else state().set({ notice: null })
  queueAnalysis(entries.filter((entry) => !entry.analysis))
  for (const entry of entries) if (entry.analysis) void loadPeaks(entry.hash)
}

/** Baixa com o yt-dlp do host (ver host/url-import.ts). Devolve se importou alguma faixa. */
export async function importFromUrl(url: string, browser: CookieBrowser | null): Promise<boolean> {
  if (!host.importFromUrl) return false
  try {
    // Na primeira vez o host ainda pode estar baixando o yt-dlp (ver host/ytdlp.ts).
    const tool = await host.ytDlpStatus?.()
    const installing = tool?.state === 'installing' || tool?.state === 'checking'
    state().notify(
      'info',
      installing ? `Instalando o yt-dlp e baixando ${url}...` : `Baixando ${url}...`,
    )
    const { entries, errors, originals } = await host.importFromUrl(url, { browser })
    putEntries(entries)
    if (errors.length) state().notify('error', `Não importados: ${errors.join('; ')}`)
    else state().notify('info', downloadSummary(entries.length, originals.length, browser !== null))
    queueAnalysis(entries.filter((entry) => !entry.analysis))
    for (const entry of entries) if (entry.analysis) void loadPeaks(entry.hash)
    return entries.length > 0
  } catch (error) {
    state().notify('error', `Download falhou: ${errorText(error)}`)
    return false
  }
}

// A análise roda uma faixa por vez num worker (Essentia ocupa bastante memória).
const queue: string[] = []
let worker: Worker | undefined
let running = false

function setStatus(
  hash: string,
  status: 'pending' | 'analyzing' | 'done' | 'error',
  error?: string,
) {
  state().set({
    analysis: {
      ...state().analysis,
      [hash]: error === undefined ? { status } : { status, error },
    },
  })
}

export function queueAnalysis(entries: LibraryEntry[]): void {
  for (const entry of entries) {
    if (queue.includes(entry.hash)) continue
    queue.push(entry.hash)
    setStatus(entry.hash, 'pending')
  }
  void drainQueue()
}

async function drainQueue() {
  if (running) return
  running = true
  try {
    for (let hash = queue.shift(); hash !== undefined; hash = queue.shift()) {
      setStatus(hash, 'analyzing')
      try {
        await analyzeOne(hash)
        setStatus(hash, 'done')
      } catch (error) {
        setStatus(hash, 'error', errorText(error))
      }
    }
  } finally {
    running = false
  }
}

async function analyzeOne(hash: string) {
  const interleaved = await decodedPcm(hash)
  worker ??= new Worker(new URL('./workers/analysis.worker.ts', import.meta.url), {
    type: 'module',
  })
  const current = worker
  const response = await new Promise<AnalysisResponse>((resolve, reject) => {
    current.onmessage = (event: MessageEvent<AnalysisResponse>) => resolve(event.data)
    current.onerror = (event) => reject(new Error(event.message || 'falha no worker de análise'))
    const request: AnalysisRequest = { interleaved }
    current.postMessage(request, [interleaved.buffer])
  })
  if (!response.ok) throw new Error(response.error)
  await host.saveAnalysis(hash, response.analysis, response.peaks)
  const entry = state().library[hash]
  if (entry) putEntries([{ ...entry, analysis: response.analysis }])
  state().set({ peaks: { ...state().peaks, [hash]: response.peaks } })
}

export function reanalyze(hash: string): void {
  const entry = state().library[hash]
  if (entry) queueAnalysis([entry])
}

export async function removeFromLibrary(hash: string): Promise<void> {
  if (state().project.tracks.some((track) => track.hash === hash)) {
    state().notify('error', 'A faixa está em uso no projeto; tire-a dos grupos antes.')
    return
  }
  await host.removeFromLibrary(hash)
  const library = Object.fromEntries(
    Object.entries(state().library).filter(([candidate]) => candidate !== hash),
  )
  // O host já tirou a faixa das playlists guardadas.
  const playlists = moveTrack(state().playlists, hash, null)
  state().set({ library, playlists })
}

export async function revealTrack(hash: string): Promise<void> {
  try {
    await host.revealTrack?.(hash)
  } catch (error) {
    state().notify('error', `Não foi possível mostrar o arquivo: ${errorText(error)}`)
  }
}

// Capas: pedidas ao host uma vez por faixa e guardadas como URL blob.
const coverRequests = new Set<string>()

export function loadCover(hash: string): void {
  if (!host.getCover || coverRequests.has(hash)) return
  coverRequests.add(hash)
  host
    .getCover(hash)
    .then((bytes) => {
      const url = bytes
        ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
        : null
      state().set({ covers: { ...state().covers, [hash]: url } })
    })
    .catch(() => state().set({ covers: { ...state().covers, [hash]: null } }))
}

export async function loadPlaylists(): Promise<void> {
  try {
    state().set({ playlists: await host.listPlaylists() })
  } catch (error) {
    state().notify('error', `Playlists: ${errorText(error)}`)
  }
}

async function storePlaylists(next: Playlist[]): Promise<void> {
  const before = new Map(state().playlists.map((p) => [p.id, p]))
  state().set({ playlists: next })
  try {
    for (const playlist of next) {
      if (before.get(playlist.id) !== playlist) await host.savePlaylist(playlist)
    }
  } catch (error) {
    state().notify('error', `Não foi possível salvar a playlist: ${errorText(error)}`)
  }
}

/** Cria a playlist (pasta), já com as faixas dadas, tiradas das outras. Devolve o id. */
export async function createPlaylist(name: string, hashes: string[] = []): Promise<string> {
  const playlist = {
    id: crypto.randomUUID(),
    name: uniqueName(state().playlists, name.trim() || 'Playlist'),
    hashes: [],
  }
  let next = [...state().playlists, playlist]
  for (const hash of hashes) next = moveTrack(next, hash, playlist.id)
  await storePlaylists(next)
  return playlist.id
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  const others = state().playlists.filter((p) => p.id !== id)
  if (!name.trim()) return
  const renamed = uniqueName(others, name.trim())
  await storePlaylists(state().playlists.map((p) => (p.id === id ? { ...p, name: renamed } : p)))
}

/** Apaga a pasta; as faixas dela ficam soltas na biblioteca. */
export async function deletePlaylist(id: string): Promise<void> {
  state().set({ playlists: state().playlists.filter((p) => p.id !== id) })
  try {
    await host.deletePlaylist(id)
  } catch (error) {
    state().notify('error', `Não foi possível apagar a playlist: ${errorText(error)}`)
  }
}

/** Move a faixa para a pasta (null: deixa solta). */
export async function moveToPlaylist(hash: string, id: string | null): Promise<void> {
  await storePlaylists(moveTrack(state().playlists, hash, id))
}

/** Põe a faixa no grupo selecionado (criando um grupo se não houver nenhum). */
export function addToGroup(hash: string): void {
  const entry = state().library[hash]
  if (!entry) return
  if (!entry.analysis && !entry.edits.grid) {
    state().notify('error', `"${entry.title}" ainda está sendo analisada.`)
    return
  }
  try {
    let groupId = state().groupId
    let project = state().project
    if (!groupId || !project.groups.some((group) => group.id === groupId)) {
      const [next, group] = createGroup(project, `Grupo ${project.groups.length + 1}`)
      project = next
      groupId = group.id
    }
    const result = addTrackToGroup(project, groupId, entry)
    state().edit(() => result.project)
    state().set({
      groupId,
      channelId: result.channelId,
      transitionId: result.transitionId ?? state().transitionId,
    })
  } catch (error) {
    state().notify('error', errorText(error))
  }
}

/** Salva a correção do beatgrid e as cues na biblioteca e nas faixas do projeto. */
export async function saveGridEdit(
  hash: string,
  grid: Beatgrid | null,
  cues: Cue[],
): Promise<void> {
  const entry = state().library[hash]
  if (!entry) return
  const edits: UserEdits = { grid, cues }
  await host.saveEdits(hash, edits)
  putEntries([{ ...entry, edits }])
  const effective = grid ?? entry.analysis?.grid
  if (effective) {
    state().edit((project) => applyGridEdit(project, hash, { ...effective }, cues, grid !== null))
  }
}

export function newProject(): void {
  if (!confirmDiscard()) return
  stop()
  state().setProject(createProject(), null)
}

function confirmDiscard(): boolean {
  return !state().dirty || window.confirm('Descartar as alterações não salvas do projeto?')
}

export async function openProject(): Promise<void> {
  if (!confirmDiscard()) return
  try {
    const file = await host.openProject()
    if (!file) return
    const project = parseProject(file.json)
    stop()
    // Acha as faixas pelo hash se mudaram de lugar e atualiza os caminhos.
    const resolved = await host.resolveTracks(
      project.tracks.map((track) => ({ hash: track.hash, path: track.path })),
    )
    const missing: string[] = []
    project.tracks = project.tracks.map((track, i) => {
      const entry = resolved[i]
      if (!entry) {
        missing.push(track.hash)
        return track
      }
      return { ...track, path: entry.path }
    })
    putEntries(resolved.filter((entry) => entry !== null))
    for (const entry of resolved) if (entry) void loadPeaks(entry.hash)
    state().setProject(project, file.path)
    state().set({
      missing,
      notice: missing.length
        ? { kind: 'error', text: `${missing.length} faixa(s) do projeto não foram encontradas.` }
        : null,
    })
  } catch (error) {
    state().notify('error', `Não foi possível abrir: ${errorText(error)}`)
  }
}

export async function locateTrack(hash: string): Promise<void> {
  try {
    const entry = await host.locateTrack(hash)
    if (!entry) return
    putEntries([entry])
    void loadPeaks(hash)
    const missing = state().missing.filter((candidate) => candidate !== hash)
    state().edit((project) => ({
      ...project,
      tracks: project.tracks.map((track) =>
        track.hash === hash ? { ...track, path: entry.path } : track,
      ),
    }))
    state().set({ missing, notice: missing.length ? state().notice : null })
  } catch (error) {
    state().notify('error', errorText(error))
  }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const { project, projectPath } = state()
  try {
    const clean = pruneTracks(project)
    const path = await host.saveProject(
      saveAs ? null : projectPath,
      serializeProject(clean),
      project.name || 'set',
    )
    if (!path) return false
    state().set({ projectPath: path, dirty: false })
    state().notify(
      'info',
      host.kind === 'browser' ? `Projeto baixado como ${path}` : `Projeto salvo em ${path}`,
    )
    return true
  } catch (error) {
    state().notify('error', `Não foi possível salvar: ${errorText(error)}`)
    return false
  }
}

export async function exportProject(): Promise<void> {
  const blocked = urlTracksInSet(state().project, state().library)
  if (blocked.length) {
    state().notify(
      'error',
      `Este set não pode ser exportado: tem faixas baixadas de URL, que ficam só dentro do app (${blocked.join(', ')}).`,
    )
    return
  }
  stop()
  try {
    const result = await exportSet(state().project, (label, fraction) =>
      state().set({ exporting: { label, fraction } }),
    )
    state().set({ exporting: null })
    if (result) {
      const mb = (result.bytes / 1024 / 1024).toFixed(1)
      state().notify(
        'info',
        `Set exportado: ${result.wavPath} (${mb} MB) e ${result.tracklistPath}`,
      )
    }
  } catch (error) {
    state().set({ exporting: null })
    state().notify('error', `Export falhou: ${errorText(error)}`)
  }
}

export function selectedGroupId(): string | null {
  return currentGroup(state())?.id ?? null
}
