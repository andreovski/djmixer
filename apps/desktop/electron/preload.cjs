// SPDX-License-Identifier: AGPL-3.0-or-later
// Expõe o host (host/api.ts) para a interface como window.djmixer.
const { contextBridge, ipcRenderer } = require('electron')

const METHODS = [
  'pickAudioFiles',
  'importFiles',
  'importFromUrl',
  'ytDlpStatus',
  'listLibrary',
  'removeFromLibrary',
  'saveAnalysis',
  'saveEdits',
  'getPeaks',
  'resolveTracks',
  'locateTrack',
  'saveStretched',
  'openProject',
  'saveProject',
  'exportBegin',
  'exportChunk',
  'exportEnd',
  'exportAbort',
]

const api = {
  kind: 'electron',
  mediaUrl: (kind, key) => `app://djmixer/media/${kind}/${encodeURIComponent(key)}`,
}
for (const method of METHODS) {
  api[method] = async (...args) => {
    try {
      return await ipcRenderer.invoke('host', method, ...args)
    } catch (error) {
      // O Electron prefixa a mensagem com "Error invoking remote method"; a interface mostra só o motivo.
      throw new Error(
        String(error?.message ?? error).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          '',
        ),
        { cause: error },
      )
    }
  }
}
contextBridge.exposeInMainWorld('djmixer', api)
