// SPDX-License-Identifier: AGPL-3.0-or-later
// Shell Electron mínimo do spike 4: serve o build do playground por app:// e abre a sondagem.
// O relatório vai para PROBE_OUT (ou para a saída padrão) e a janela fecha em seguida.
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const DIST = join(import.meta.dirname, '..', '..', 'apps', 'playground', 'dist')
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

ipcMain.handle('report', async (_event, json) => {
  if (process.env.PROBE_OUT) await writeFile(process.env.PROBE_OUT, json)
  else console.log(json)
  if (!process.env.PROBE_KEEP_OPEN) app.quit()
})

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const path = normalize(decodeURIComponent(new URL(request.url).pathname))
    try {
      const body = await readFile(join(DIST, path))
      const type = TYPES[extname(path)] ?? 'application/octet-stream'
      return new Response(body, { headers: { 'content-type': type } })
    } catch {
      return new Response('não encontrado', { status: 404 })
    }
  })
  const window = new BrowserWindow({
    width: 960,
    height: 800,
    title: 'djmixer: sondagem (Electron)',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  window.loadURL('app://playground/probe.html?auto=1')
})
