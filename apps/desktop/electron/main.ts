// SPDX-License-Identifier: AGPL-3.0-or-later
// Processo principal do Electron: abre a janela, serve a interface e o áudio por app:// e liga
// os diálogos nativos ao host (host/service.ts). Toda a lógica de arquivos fica no host.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { extname, join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AUDIO_EXTENSIONS } from '../host/media.ts'
import {
  createHostService,
  PROJECT_EXTENSION,
  type Dialogs,
  type HostService,
} from '../host/service.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const RENDERER = join(ROOT, 'dist')
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' data:",
].join('; ')
// O worker de análise roda o Essentia.js, cujo código gerado pelo Emscripten (embind) monta
// funções a partir de texto. Só ele ganha 'unsafe-eval'; a página continua sem.
const WORKER_CSP = CSP.replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'unsafe-eval'")

/** Métodos do host que a interface pode chamar (ver host/api.ts). */
const METHODS = [
  'pickAudioFiles',
  'importFiles',
  'importFromUrl',
  'ytDlpStatus',
  'listLibrary',
  'revealTrack',
  'removeFromLibrary',
  'saveAnalysis',
  'saveEdits',
  'getPeaks',
  'getCover',
  'getAudioInfo',
  'listPlaylists',
  'savePlaylist',
  'deletePlaylist',
  'resolveTracks',
  'locateTrack',
  'saveStretched',
  'openProject',
  'saveProject',
  'exportBegin',
  'exportChunk',
  'exportEnd',
  'exportAbort',
] as const

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

if (process.env.DJMIXER_USER_DATA) app.setPath('userData', process.env.DJMIXER_USER_DATA)

let window: BrowserWindow | null = null
const showOpen = (options: Electron.OpenDialogOptions) =>
  window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
const showSave = (options: Electron.SaveDialogOptions) =>
  window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)

const dialogs: Dialogs = {
  async pickAudioFiles() {
    const result = await showOpen({
      title: 'Importar faixas',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Áudio', extensions: AUDIO_EXTENSIONS }],
    })
    return result.canceled ? [] : result.filePaths
  },
  async pickProjectToOpen() {
    const result = await showOpen({
      title: 'Abrir projeto',
      properties: ['openFile'],
      filters: [{ name: 'Projeto djmixer', extensions: [PROJECT_EXTENSION, 'json'] }],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  async pickProjectToSave(suggestedName) {
    const result = await showSave({
      title: 'Salvar projeto',
      defaultPath: `${suggestedName}.${PROJECT_EXTENSION}`,
      filters: [{ name: 'Projeto djmixer', extensions: [PROJECT_EXTENSION] }],
    })
    return result.canceled ? null : (result.filePath ?? null)
  },
  async pickExportPath(suggestedName) {
    const result = await showSave({
      title: 'Exportar set',
      defaultPath: `${suggestedName}.wav`,
      filters: [{ name: 'WAV', extensions: ['wav'] }],
    })
    return result.canceled ? null : (result.filePath ?? null)
  },
  async locateTrack(entry) {
    const result = await showOpen({
      title: entry ? `Onde está "${entry.title}"?` : 'Localizar faixa',
      properties: ['openFile'],
      filters: [{ name: 'Áudio', extensions: AUDIO_EXTENSIONS }],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  async reveal(path) {
    shell.showItemInFolder(path)
  },
}

app.whenReady().then(() => {
  const service: HostService = createHostService(app.getPath('userData'), dialogs)
  // Na abertura: confere se há yt-dlp e, se não, baixa o oficial em segundo plano.
  service.prepareTools()

  ipcMain.handle('host', (_event, method: string, ...args: unknown[]) => {
    if (!(METHODS as readonly string[]).includes(method))
      throw new Error(`método desconhecido: ${method}`)
    const fn = service[method as (typeof METHODS)[number]] as (...a: unknown[]) => Promise<unknown>
    return fn(...args)
  })

  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const path = normalize(decodeURIComponent(url.pathname))
    const media = /^[/\\]media[/\\](decoded|stretched)[/\\]([^/\\]+)$/.exec(path)
    try {
      if (media) {
        const file = await service.mediaFile(media[1] as string, media[2] as string)
        if (!file) return new Response('não encontrado', { status: 404 })
        const response = await net.fetch(pathToFileURL(file).toString())
        return new Response(response.body, {
          headers: { 'content-type': 'application/octet-stream' },
        })
      }
      const file = join(RENDERER, path === '/' || path === '\\' ? 'index.html' : path)
      if (!file.startsWith(RENDERER)) return new Response('proibido', { status: 403 })
      const response = await net.fetch(pathToFileURL(file).toString())
      if (!response.ok) return new Response('não encontrado', { status: 404 })
      return new Response(response.body, {
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'content-security-policy': /analysis\.worker-[\w-]+\.js$/.test(file) ? WORKER_CSP : CSP,
        },
      })
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 500 })
    }
  })

  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'djmixer',
    backgroundColor: '#15171c',
    webPreferences: {
      preload: join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  window.on('closed', () => (window = null))
  void window.loadURL('app://djmixer/index.html')

  app.on('window-all-closed', () => {
    service.close()
    app.quit()
  })
})
