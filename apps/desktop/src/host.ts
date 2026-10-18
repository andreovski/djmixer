// SPDX-License-Identifier: AGPL-3.0-or-later
// Acesso ao host: no Electron vem do preload (window.djmixer); na versão web (build com
// VITE_DJMIXER_HOST=browser) roda inteiro no navegador; senão, fala com o servidor de
// desenvolvimento (host/dev-server.ts) por HTTP.
import type { HostApi } from '../host/api.ts'
import { decodeRpc, encodeRpc } from '../host/rpc.ts'
import { createBrowserHost } from './browser-host.ts'

declare global {
  interface Window {
    djmixer?: HostApi
    /** Respostas dos diálogos no navegador, usadas pelos testes antes do `prompt`. */
    djmixerDialogs?: unknown[]
  }
}

const DIALOG_PROMPTS: Partial<Record<keyof HostApi, string>> = {
  pickAudioFiles: 'Caminhos dos arquivos de áudio, separados por ";"',
  openProject: 'Caminho do projeto para abrir',
  saveProject: 'Caminho para salvar o projeto',
  exportBegin: 'Caminho do WAV a exportar',
  locateTrack: 'Novo caminho da faixa',
}

function createWebHost(): HostApi {
  const call = async (method: string, args: unknown[]) => {
    const response = await fetch(`/api/${method}`, { method: 'POST', body: encodeRpc(args) })
    if (!response.ok) throw new Error(`host: ${response.status} ${method}`)
    const result = decodeRpc(new Uint8Array(await response.arrayBuffer())) as {
      ok?: unknown
      error?: string
    }
    if (result.error !== undefined) throw new Error(result.error)
    return result.ok
  }
  // Os diálogos nativos viram uma resposta enfileirada no servidor antes da chamada.
  const answerDialog = async (method: keyof HostApi, args: unknown[]) => {
    if (method === 'saveProject' && args[0]) return
    const prompt = DIALOG_PROMPTS[method]
    if (!prompt) return
    let answer: unknown
    if (window.djmixerDialogs?.length) answer = window.djmixerDialogs.shift()
    else {
      const text = window.prompt(prompt)
      answer =
        method === 'pickAudioFiles'
          ? (text ?? '')
              .split(';')
              .map((path) => path.trim())
              .filter(Boolean)
          : text || null
    }
    await fetch('/dev/dialog', { method: 'POST', body: JSON.stringify(answer) })
  }
  return new Proxy({} as HostApi, {
    get(_target, property: string) {
      if (property === 'kind') return 'web'
      if (property === 'mediaUrl') {
        return (kind: string, key: string) => `/media/${kind}/${encodeURIComponent(key)}`
      }
      if (property === 'then') return undefined
      return async (...args: unknown[]) => {
        await answerDialog(property as keyof HostApi, args)
        return call(property, args)
      }
    },
  })
}

export const host: HostApi =
  window.djmixer ??
  (import.meta.env.VITE_DJMIXER_HOST === 'browser' ? createBrowserHost() : createWebHost())
