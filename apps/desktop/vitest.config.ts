// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config'

// Só a lógica pura da interface (src/*.test.ts) e o host (host/*.test.ts) rodam no Vitest; a
// interface inteira é testada no Electron (e2e/).
export default defineConfig({
  test: {
    name: 'desktop',
    include: ['src/**/*.test.ts', 'host/**/*.test.ts'],
    environment: 'node',
  },
})
