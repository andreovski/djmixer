// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from '@playwright/test'

// Testes de ponta a ponta no Electron de verdade (e2e/app.e2e.ts). Precisam do build
// (pnpm --filter @djmixer/desktop build), do binário do Electron e do ffmpeg no PATH.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 300_000,
  workers: 1,
  // No CI as falhas também viram anotações do GitHub.
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
})
