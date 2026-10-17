// SPDX-License-Identifier: AGPL-3.0-or-later
// Página de testes da fase 0: o motor roda aqui, no navegador, antes de existir o app desktop.
import { beatsToSeconds } from '@djmixer/shared'

const app = document.querySelector<HTMLElement>('#app')
if (app) {
  const seconds = beatsToSeconds(64, 124).toFixed(2)
  app.textContent = `djmixer playground: 16 compassos a 124 BPM duram ${seconds} s.`
}
