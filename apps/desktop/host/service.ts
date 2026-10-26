// SPDX-License-Identifier: AGPL-3.0-or-later
// Implementação do host sem nada do Electron: o processo principal e o servidor de
// desenvolvimento a embrulham, cada um com seus diálogos e seu transporte.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import {
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ExportResult, ExportTarget, HostApi, LibraryEntry, YtDlpStatus } from './api.ts'
import { Library } from './library.ts'
import {
  AUDIO_EXTENSIONS,
  audioInfo,
  decodeToCache,
  extractCover,
  hashFile,
  probe,
} from './media.ts'
import { coverSidecar, downloadAudio, downloadThumbnail } from './url-import.ts'
import { createYtDlp } from './ytdlp.ts'

export interface Dialogs {
  pickAudioFiles(): Promise<string[]>
  pickProjectToOpen(): Promise<string | null>
  pickProjectToSave(suggestedName: string): Promise<string | null>
  pickExportPath(suggestedName: string): Promise<string | null>
  locateTrack(entry: LibraryEntry | null): Promise<string | null>
  /** Mostra o arquivo no Finder (ou no gerenciador de arquivos do sistema). */
  reveal(path: string): Promise<void>
  /** Pede um aplicativo (no macOS, um .app); null se cancelou. */
  pickApplication(): Promise<string | null>
  /** Ícone do aplicativo em PNG; null se o shell não sabe ler. */
  appIcon(path: string): Promise<Uint8Array | null>
}

export type HostService = Omit<
  HostApi,
  | 'kind'
  | 'mediaUrl'
  | 'importFromUrl'
  | 'getCover'
  | 'getAudioInfo'
  | 'revealTrack'
  | 'ytDlpStatus'
  | 'pickEditor'
  | 'editorIcon'
  | 'openInEditor'
  | 'checkEdited'
> & {
  pickEditor: NonNullable<HostApi['pickEditor']>
  editorIcon: NonNullable<HostApi['editorIcon']>
  openInEditor: NonNullable<HostApi['openInEditor']>
  checkEdited: NonNullable<HostApi['checkEdited']>
  revealTrack: NonNullable<HostApi['revealTrack']>
  getAudioInfo: NonNullable<HostApi['getAudioInfo']>
  importFromUrl: NonNullable<HostApi['importFromUrl']>
  getCover: NonNullable<HostApi['getCover']>
  /** Caminho do arquivo a servir para `mediaUrl`, decodificando se preciso; null se não existe. */
  mediaFile(kind: string, key: string): Promise<string | null>
  /**
   * Confere se o yt-dlp existe e, se não, baixa o oficial para a pasta de dados. Roda em segundo
   * plano na abertura do app; o "Importar de URL" espera por ele.
   */
  prepareTools(): void
  ytDlpStatus(): Promise<YtDlpStatus>
  close(): void
}

export const PROJECT_EXTENSION = 'djmix'

/** Abre `path` no aplicativo `app`: no macOS com `open -a`, nos outros executando o programa. */
function openWith(app: string, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mac = process.platform === 'darwin'
    const child = mac
      ? spawn('open', ['-a', app, path], { stdio: ['ignore', 'ignore', 'pipe'] })
      : spawn(app, [path], { stdio: 'ignore', detached: true })
    let err = ''
    child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString()))
    child.on('error', (error) =>
      reject(new Error(`não foi possível abrir ${app}: ${error.message}`)),
    )
    if (mac) {
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(err.trim() || `não foi possível abrir ${app}`)),
      )
    } else {
      child.on('spawn', () => {
        child.unref()
        resolve()
      })
    }
  })
}

const SAFE_KEY = /^[A-Za-z0-9._-]{1,200}$/

export function createHostService(dataDir: string, dialogs: Dialogs): HostService {
  const decodedDir = join(dataDir, 'cache', 'decoded')
  const stretchedDir = join(dataDir, 'cache', 'stretched')
  const downloadsDir = join(dataDir, 'downloads')
  const coversDir = join(dataDir, 'cache', 'covers')
  for (const dir of [decodedDir, stretchedDir, downloadsDir, coversDir])
    mkdirSync(dir, { recursive: true })
  const library = new Library(join(dataDir, 'library.sqlite'))
  const ytDlp = createYtDlp({ binDir: join(dataDir, 'bin') })
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

    async importFromUrl(url, options) {
      const entries: LibraryEntry[] = []
      const errors: string[] = []
      const originals: string[] = []
      const files = await downloadAudio(url.trim(), downloadsDir, () => ytDlp.ensure(), options)
      for (const file of files) {
        try {
          const entry = await register(file.path, undefined, file.pageUrl)
          entries.push(entry)
          if (file.original) originals.push(entry.hash)
        } catch (error) {
          errors.push(`${file.pageUrl}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (entries.length === 0 && errors.length === 0) {
        errors.push('nenhum áudio encontrado nesse endereço')
      }
      return { entries, errors, originals }
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

    pickEditor: () => dialogs.pickApplication(),
    editorIcon: (editor) => dialogs.appIcon(editor),

    async openInEditor(hash, editor) {
      const entry = library.get(hash)
      if (!entry) throw new Error('faixa não está na biblioteca')
      if (entry.missing) throw new Error(`arquivo não encontrado: ${entry.path}`)
      const since = Date.now()
      await openWith(editor, entry.path)
      return since
    },

    async checkEdited(hash, since) {
      const entry = library.get(hash)
      if (!entry || !SAFE_KEY.test(hash)) return null
      const dir = dirname(entry.path)
      const stem = basename(entry.path, extname(entry.path))
      // O próprio arquivo regravado, ou um irmão "nome….wav" do "Salvar como".
      const names = await readdir(dir).catch(() => [] as string[])
      const candidates: { path: string; mtime: number }[] = []
      const known = new Set(library.list().map((other) => other.path))
      for (const name of names) {
        const path = join(dir, name)
        const ext = extname(name).slice(1).toLowerCase()
        if (!name.startsWith(stem) || !AUDIO_EXTENSIONS.includes(ext)) continue
        if (path !== entry.path && known.has(path)) continue
        const info = await stat(path).catch(() => null)
        if (info?.isFile() && info.mtimeMs > since) candidates.push({ path, mtime: info.mtimeMs })
      }
      candidates.sort((a, b) => b.mtime - a.mtime)
      for (const candidate of candidates) {
        const newHash = await hashFile(candidate.path).catch(() => null)
        if (!newHash || newHash === hash) continue
        const { durationSeconds } = await probe(candidate.path)
        library.replace(hash, { hash: newHash, path: candidate.path, durationSeconds })
        // A capa vai junto; o áudio decodificado do arquivo antigo não serve mais.
        const cover = join(coversDir, `${hash}.jpg`)
        if (existsSync(cover)) await rename(cover, join(coversDir, `${newHash}.jpg`))
        await rm(join(coversDir, `${hash}.nocover`), { force: true })
        await rm(join(decodedDir, `${hash}.f32`), { force: true })
        if (candidate.path !== entry.path && entry.sourceUrl && dir === downloadsDir) {
          // A versão baixada fica sem uso: apaga, levando a capa para o nome do novo arquivo.
          const sidecar = coverSidecar(entry.path)
          const newSidecar = coverSidecar(candidate.path)
          if (existsSync(sidecar) && !existsSync(newSidecar)) await rename(sidecar, newSidecar)
          await rm(entry.path, { force: true })
          await rm(sidecar, { force: true })
        }
        return library.get(newHash)
      }
      return null
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
          await downloadThumbnail(entry.sourceUrl, entry.path, () => ytDlp.ensure()).catch(
            () => undefined,
          )
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
          const entry = library.get(hash) ?? library.replacement(hash)
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

    prepareTools() {
      ytDlp.ensure().catch((error: unknown) => console.warn(String(error)))
    },
    ytDlpStatus: async () => ytDlp.status(),

    close: () => library.close(),
  }
}
