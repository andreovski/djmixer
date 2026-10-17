// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  // Caminhos relativos para o build abrir dentro dos shells do spike 4 (app:// e tauri://).
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        probe: resolve(import.meta.dirname, 'probe.html'),
      },
    },
  },
})
