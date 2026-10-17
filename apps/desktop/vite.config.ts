// SPDX-License-Identifier: AGPL-3.0-or-later
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Caminhos relativos: no Electron a interface é servida por app://djmixer/.
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 4000 },
})
