// SPDX-License-Identifier: AGPL-3.0-or-later
// Host da versão web: tudo dentro do navegador, sem servidor. As faixas importadas ficam
// guardadas no IndexedDB do navegador (o áudio nunca sai do computador), a decodificação usa o
// decodificador do navegador no lugar do ffmpeg, e salvar ou exportar vira download.
import {
  SAMPLE_RATE,
  type ExportResult,
  type HostApi,
  type LibraryEntry,
  type Playlist,
  type TrackAnalysis,
  type UserEdits,
} from '../host/api.ts'

interface StoredTrack {
  hash: string
  name: string
  title: string
  artist: string
  durationSeconds: number
  analysis: TrackAnalysis | null
  edits: UserEdits
  importedAt: number
  file: Blob
}

const DB_NAME = 'djmixer'
const TRACKS = 'tracks'
const PEAKS = 'peaks'
const STRETCHED = 'stretched'
const PLAYLISTS = 'playlists'

let database: Promise<IDBDatabase> | undefined

function db(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    // Versão 2: playlists.
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      for (const store of [TRACKS, PEAKS, STRETCHED, PLAYLISTS]) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível'))
  })
  return database
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const tx = (await db()).transaction(store, mode)
  const request = action(tx.objectStore(store))
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(request.result as T)
    tx.onerror = () => reject(tx.error ?? new Error('erro no IndexedDB'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB cancelado (espaço cheio?)'))
  })
}

const get = <T>(store: string, key: string) =>
  run<T | undefined>(store, 'readonly', (s) => s.get(key))
const put = (store: string, key: string, value: unknown) =>
  run<unknown>(store, 'readwrite', (s) => s.put(value, key))
const remove = (store: string, key: string) =>
  run<unknown>(store, 'readwrite', (s) => s.delete(key))

function toEntry(track: StoredTrack): LibraryEntry {
  return {
    hash: track.hash,
    path: track.name,
    title: track.title,
    artist: track.artist,
    durationSeconds: track.durationSeconds,
    analysis: track.analysis,
    edits: track.edits,
    missing: false,
  }
}

/** Abre o seletor de arquivos do navegador; resolve com [] se o usuário cancelar. */
function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

function download(data: BlobPart[], name: string, type: string): void {
  const url = URL.createObjectURL(new Blob(data, { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Decodifica para PCM float estéreo intercalado a 44,1 kHz, o mesmo formato do ffmpeg. */
async function decode(blob: Blob): Promise<Float32Array<ArrayBuffer>> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: SAMPLE_RATE })
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
  } catch {
    throw new Error('o navegador não decodifica este formato (use MP3, WAV, FLAC ou AAC)')
  }
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const out = new Float32Array(buffer.length * 2)
  for (let i = 0; i < buffer.length; i++) {
    out[2 * i] = left[i] ?? 0
    out[2 * i + 1] = right[i] ?? 0
  }
  return out
}

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.aif,.aiff'

export function createBrowserHost(): HostApi {
  // Arquivos escolhidos no seletor, até o importFiles guardá-los.
  const picked = new Map<string, File>()
  const exports = new Map<string, { name: string; parts: Uint8Array[]; bytes: number }>()
  let pickCount = 0

  const storeFile = async (file: File, expectedHash?: string): Promise<LibraryEntry> => {
    const hash = await sha256(file)
    if (expectedHash && hash !== expectedHash) {
      throw new Error('Este arquivo tem conteúdo diferente da faixa do projeto.')
    }
    const existing = await get<StoredTrack>(TRACKS, hash)
    if (existing) return toEntry(existing)
    const pcm = await decode(file)
    const track: StoredTrack = {
      hash,
      name: file.name,
      title: file.name.replace(/\.[^.]+$/, ''),
      artist: '',
      durationSeconds: pcm.length / 2 / SAMPLE_RATE,
      analysis: null,
      edits: { grid: null, cues: [] },
      importedAt: Date.now(),
      file,
    }
    await put(TRACKS, hash, track)
    return toEntry(track)
  }

  const update = async (hash: string, patch: Partial<StoredTrack>) => {
    const track = await get<StoredTrack>(TRACKS, hash)
    if (track) await put(TRACKS, hash, { ...track, ...patch })
  }

  return {
    kind: 'browser',

    async pickAudioFiles() {
      const files = await pickFiles(AUDIO_ACCEPT, true)
      return files.map((file) => {
        const key = `${++pickCount}:${file.name}`
        picked.set(key, file)
        return key
      })
    },

    async importFiles(paths) {
      // Pede ao navegador para não apagar as faixas guardadas quando faltar espaço.
      void navigator.storage?.persist?.()
      const entries: LibraryEntry[] = []
      const errors: string[] = []
      for (const path of paths) {
        const file = picked.get(path)
        picked.delete(path)
        if (!file) continue
        try {
          entries.push(await storeFile(file))
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return { entries, errors }
    },

    async listLibrary() {
      const tracks = await run<StoredTrack[]>(TRACKS, 'readonly', (s) => s.getAll())
      return tracks.sort((a, b) => a.importedAt - b.importedAt).map(toEntry)
    },

    async removeFromLibrary(hash) {
      await remove(TRACKS, hash)
      await remove(PEAKS, hash)
      const playlists = await run<Playlist[]>(PLAYLISTS, 'readonly', (s) => s.getAll())
      for (const playlist of playlists) {
        if (!playlist.hashes.includes(hash)) continue
        await put(PLAYLISTS, playlist.id, {
          ...playlist,
          hashes: playlist.hashes.filter((h) => h !== hash),
        })
      }
    },

    async getAudioInfo(hash) {
      const track = await get<StoredTrack>(TRACKS, hash)
      if (!track) return null
      const extension = track.name.split('.').pop()?.toLowerCase() ?? '?'
      const lossless = ['wav', 'flac', 'aif', 'aiff'].includes(extension)
      // Sem ffprobe: o bitrate sai do tamanho e da duração, e o resto o navegador não informa.
      return {
        container: extension,
        codec: extension,
        bitrateKbps: track.durationSeconds
          ? Math.round((track.file.size * 8) / track.durationSeconds / 1000)
          : null,
        sampleRate: null,
        bitDepth: null,
        channels: null,
        bytes: track.file.size,
        lossless,
        estimated: true,
      }
    },

    async listPlaylists() {
      const playlists = await run<(Playlist & { createdAt?: number })[]>(
        PLAYLISTS,
        'readonly',
        (s) => s.getAll(),
      )
      return playlists
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .map(({ id, name, hashes }) => ({ id, name, hashes }))
    },

    async savePlaylist(playlist) {
      const existing = await get<{ createdAt?: number }>(PLAYLISTS, playlist.id)
      await put(PLAYLISTS, playlist.id, {
        ...playlist,
        createdAt: existing?.createdAt ?? Date.now(),
      })
    },

    deletePlaylist: (id) => remove(PLAYLISTS, id).then(() => undefined),

    async saveAnalysis(hash, analysis, peaks) {
      await update(hash, { analysis })
      await put(PEAKS, hash, peaks)
    },

    saveEdits: (hash, edits) => update(hash, { edits }),

    async getPeaks(hash) {
      return (await get<Uint8Array>(PEAKS, hash)) ?? null
    },

    async resolveTracks(tracks) {
      return Promise.all(
        tracks.map(async ({ hash }) => {
          const track = await get<StoredTrack>(TRACKS, hash)
          return track ? toEntry(track) : null
        }),
      )
    },

    async locateTrack(hash) {
      const [file] = await pickFiles(AUDIO_ACCEPT, false)
      return file ? storeFile(file, hash) : null
    },

    mediaUrl: (kind, key) => `browser:${kind}/${key}`,

    async readMedia(kind, key) {
      if (kind === 'stretched') {
        const data = await get<Uint8Array>(STRETCHED, key)
        return data ? (data.slice().buffer as ArrayBuffer) : null
      }
      const track = await get<StoredTrack>(TRACKS, key)
      return track ? (await decode(track.file)).buffer : null
    },

    async saveStretched(key, data) {
      // O cache é só para acelerar; sem espaço, a faixa é esticada de novo da próxima vez.
      await put(STRETCHED, key, data).catch(() => undefined)
    },

    async openProject() {
      const [file] = await pickFiles('.djmix,.json,application/json', false)
      return file ? { path: file.name, json: await file.text() } : null
    },

    async saveProject(_path, json, suggestedName) {
      const name = `${suggestedName || 'set'}.djmix`
      download([json], name, 'application/json')
      return name
    },

    async exportBegin(suggestedName) {
      const id = crypto.randomUUID()
      const name = `${suggestedName || 'set'}.wav`
      exports.set(id, { name, parts: [], bytes: 0 })
      return { id, wavPath: name }
    },

    async exportChunk(id, pcm) {
      const job = exports.get(id)
      if (!job) throw new Error('export não iniciado')
      job.parts.push(pcm)
      job.bytes += pcm.byteLength
    },

    async exportEnd(id, header, tracklist): Promise<ExportResult> {
      const job = exports.get(id)
      if (!job) throw new Error('export não iniciado')
      exports.delete(id)
      download([header, ...job.parts] as BlobPart[], job.name, 'audio/wav')
      const tracklistPath = job.name.replace(/\.wav$/, '.txt')
      download([tracklist], tracklistPath, 'text/plain')
      return { wavPath: job.name, tracklistPath, bytes: job.bytes + header.byteLength }
    },

    async exportAbort(id) {
      exports.delete(id)
    },
  }
}
