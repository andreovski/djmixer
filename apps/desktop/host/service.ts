// SPDX-License-Identifier: AGPL-3.0-or-later
// Implementação do host sem nada do Electron: o processo principal e o servidor de
// desenvolvimento a embrulham, cada um com seus diálogos e seu transporte.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { open, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ExportResult, ExportTarget, HostApi, LibraryEntry } from './api.ts'
import { Library } from './library.ts'
import { audioInfo, decodeToCache, extractCover, hashFile, probe } from './media.ts'
import { coverSidecar, downloadAudio, downloadThumbnail } from './url-import.ts'

export interface Dialogs {
  pickAudioFiles(): Promise<string[]>
  pickProjectToOpen(): Promise<string | null>
  pickProjectToSave(suggestedName: string): Promise<string | null>
  pickExportPath(suggestedName: string): Promise<string | null>
  locateTrack(entry: LibraryEntry | null): Promise<string | null>
  /** Mostra o arquivo no Finder (ou no gerenciador de arquivos do sistema). */
  reveal(path: string): Promise<void>
}

export type HostService = Omit<
  HostApi,
  'kind' | 'mediaUrl' | 'importFromUrl' | 'getCover' | 'getAudioInfo' | 'revealTrack'
> & {
  revealTrack: NonNullable<HostApi['revealTrack']>
  getAudioInfo: NonNullable<HostApi['getAudioInfo']>
  importFromUrl: NonNullable<HostApi['importFromUrl']>
  getCover: NonNullable<HostApi['getCover']>
  /** Caminho do arquivo a servir para `mediaUrl`, decodificando se preciso; null se não existe. */
  mediaFile(kind: string, key: string): Promise<string | null>
  close(): void
}

export const PROJECT_EXTENSION = 'djmix'

const SAFE_KEY = /^[A-Za-z0-9._-]{1,200}$/

export function createHostService(dataDir: string, dialogs: Dialogs): HostService {
  const decodedDir = join(dataDir, 'cache', 'decoded')
  const stretchedDir = join(dataDir, 'cache', 'stretched')
  const downloadsDir = join(dataDir, 'downloads')
  const coversDir = join(dataDir, 'cache', 'covers')
  for (const dir of [decodedDir, stretchedDir, downloadsDir, coversDir])
    mkdirSync(dir, { recursive: true })
  const library = new Library(join(dataDir, 'library.sqlite'))
  const exports = new Map<string, { handle: FileHandle; path: string; bytes: number }>()

  const register = async (
    path: string,
    knownHash?: string,
    sourceUrl?: string,
  ): Promise<LibraryEntry> => {
    const hash = knownHash ?? (await hashFile(path))
    const existing = library.get(hash)
    if (existing) {
      if (existing.path !== path) library.setPath(hash, path)
      return { ...existing, path, missing: false }
    }
    return library.upsert({ hash, path, ...(await probe(path)), ...(sourceUrl && { sourceUrl }) })
  }

  return {
    pickAudioFiles: () => dialogs.pickAudioFiles(),

    async importFiles(paths) {
      const entries: LibraryEntry[] = []
      const errors: string[] = []
      for (const path of paths) {
        try {
          entries.push(await register(path))
        } catch (error) {
          errors.push(
            `${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      return { entries, errors }
    },

    async importFromUrl(url) {
      const entries: LibraryEntry[] = []
      const errors: string[] = []
      for (const file of await downloadAudio(url.trim(), downloadsDir)) {
        try {
          entries.push(await register(file.path, undefined, file.pageUrl))
        } catch (error) {
          errors.push(`${file.pageUrl}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (entries.length === 0 && errors.length === 0) {
        errors.push('nenhum áudio encontrado nesse endereço')
      }
      return { entries, errors }
    },

    listLibrary: async () => library.list(),
    async removeFromLibrary(hash) {
      const entry = library.get(hash)
      library.remove(hash)
      if (!SAFE_KEY.test(hash)) return
      const files = [
        join(decodedDir, `${hash}.f32`),
        join(coversDir, `${hash}.jpg`),
        join(coversDir, `${hash}.nocover`),
      ]
      // Só apaga o áudio que o próprio app baixou, dentro da pasta de downloads.
      if (entry?.sourceUrl && dirname(entry.path) === downloadsDir) {
        files.push(entry.path, coverSidecar(entry.path))
      }
      await Promise.all(files.map((file) => rm(file, { force: true })))
    },

    async revealTrack(hash) {
      const entry = library.get(hash)
      if (!entry) throw new Error('faixa não está na biblioteca')
      if (entry.missing) throw new Error(`arquivo não encontrado: ${entry.path}`)
      await dialogs.reveal(entry.path)
    },
    saveAnalysis: async (hash, analysis, peaks) => library.saveAnalysis(hash, analysis, peaks),
    saveEdits: async (hash, edits) => library.saveEdits(hash, edits),
    getPeaks: async (hash) => library.peaks(hash),

    async getCover(hash) {
      if (!SAFE_KEY.test(hash)) return null
      const file = join(coversDir, `${hash}.jpg`)
      // Faixa sem capa: um arquivo vazio evita procurar de novo a cada abertura. (O nome mudou de
      // .none para .nocover quando o app passou a buscar a capa de faixas baixadas antes dela.)
      const none = join(coversDir, `${hash}.nocover`)
      if (!existsSync(file)) {
        const entry = library.get(hash)
        if (!entry || entry.missing || existsSync(none)) return null
        const sidecar = coverSidecar(entry.path)
        // Baixada antes de o "Importar de URL" trazer a capa: busca só a capa na página.
        if (entry.sourceUrl && !existsSync(sidecar)) {
          await downloadThumbnail(entry.sourceUrl, entry.path).catch(() => undefined)
        }
        if (!(await extractCover([sidecar, entry.path], file))) {
          writeFileSync(none, '')
          return null
        }
      }
      return new Uint8Array(await readFile(file))
    },

    async getAudioInfo(hash) {
      const entry = library.get(hash)
      return entry && !entry.missing ? audioInfo(entry.path) : null
    },

    listPlaylists: async () => library.playlists(),
    savePlaylist: async (playlist) => library.savePlaylist(playlist),
    deletePlaylist: async (id) => library.deletePlaylist(id),

    async resolveTracks(tracks) {
      return Promise.all(
        tracks.map(async ({ hash, path }) => {
          const entry = library.get(hash)
          if (entry && !entry.missing) return entry
          if (existsSync(path)) {
            try {
              if ((await hashFile(path)) === hash) return await register(path, hash)
            } catch {
              // Sem acesso ao arquivo: trata como não encontrado.
            }
          }
          return null
        }),
      )
    },

    async locateTrack(hash) {
      const path = await dialogs.locateTrack(library.get(hash))
      if (!path) return null
      if ((await hashFile(path)) !== hash) {
        throw new Error('Este arquivo tem conteúdo diferente da faixa do projeto.')
      }
      return register(path, hash)
    },

    async mediaFile(kind, key) {
      if (!SAFE_KEY.test(key)) return null
      if (kind === 'stretched') {
        const file = join(stretchedDir, `${key}.f32`)
        return existsSync(file) ? file : null
      }
      if (kind !== 'decoded') return null
      const entry = library.get(key)
      if (!entry) return null
      if (entry.missing) throw new Error(`arquivo não encontrado: ${entry.path}`)
      return decodeToCache(entry.path, key, decodedDir)
    },

    async saveStretched(key, data) {
      if (!SAFE_KEY.test(key)) throw new Error('chave inválida')
      const file = join(stretchedDir, `${key}.f32`)
      await writeFile(`${file}.tmp`, data)
      await rename(`${file}.tmp`, file)
    },

    async openProject() {
      const path = await dialogs.pickProjectToOpen()
      return path ? { path, json: await readFile(path, 'utf8') } : null
    },

    async saveProject(path, json, suggestedName) {
      let target = path ?? (await dialogs.pickProjectToSave(suggestedName))
      if (!target) return null
      if (!extname(target)) target = `${target}.${PROJECT_EXTENSION}`
      await writeFile(`${target}.tmp`, json)
      await rename(`${target}.tmp`, target)
      return target
    },

    async exportBegin(suggestedName): Promise<ExportTarget | null> {
      let path = await dialogs.pickExportPath(suggestedName)
      if (!path) return null
      if (extname(path).toLowerCase() !== '.wav') path = `${path}.wav`
      const handle = await open(path, 'w')
      // Espaço do cabeçalho, regravado no fim com os tamanhos certos.
      await handle.write(new Uint8Array(44))
      const id = randomUUID()
      exports.set(id, { handle, path, bytes: 0 })
      return { id, wavPath: path }
    },

    async exportChunk(id, pcm) {
      const job = exports.get(id)
      if (!job) throw new Error('export não iniciado')
      await job.handle.write(pcm)
      job.bytes += pcm.byteLength
    },

    async exportEnd(id, header, tracklist): Promise<ExportResult> {
      const job = exports.get(id)
      if (!job) throw new Error('export não iniciado')
      exports.delete(id)
      await job.handle.write(header, 0, header.byteLength, 0)
      await job.handle.close()
      const tracklistPath = job.path.replace(/\.wav$/i, '.txt')
      await writeFile(tracklistPath, tracklist)
      return { wavPath: job.path, tracklistPath, bytes: job.bytes + header.byteLength }
    },

    async exportAbort(id) {
      const job = exports.get(id)
      if (!job) return
      exports.delete(id)
      await job.handle.close()
      await rm(job.path, { force: true })
    },

    close: () => library.close(),
  }
}
