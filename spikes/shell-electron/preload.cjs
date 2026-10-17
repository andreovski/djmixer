// SPDX-License-Identifier: AGPL-3.0-or-later
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('probeShell', {
  name: `electron ${process.versions.electron}`,
  report: (json) => ipcRenderer.invoke('report', json),
})
