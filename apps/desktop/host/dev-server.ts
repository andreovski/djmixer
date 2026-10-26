// SPDX-License-Identifier: AGPL-3.0-or-later
// Servidor de desenvolvimento: a interface num navegador comum, com o mesmo host do Electron
// (host/service.ts) atrás de HTTP. Serve para desenvolver sem abrir o Electron e para os testes
// de interface. Os diálogos nativos viram respostas enfileiradas pela página (POST /dev/dialog).
// Uso: pnpm --filter @djmixer/desktop dev:web  (DJMIXER_DATA_DIR muda a pasta de dados)
import { createReadStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decodeRpc, encodeRpc } from './rpc.ts'
import { createHostService, type Dialogs } from './service.ts'

const PORT = Number(process.env.PORT ?? 5180)
const DATA_DIR = process.env.DJMIXER_DATA_DIR ?? join(homedir(), '.djmixer-dev')
mkdirSync(DATA_DIR, { recursive: true })

const answers: unknown[] = []
const next = <T>(fallback: T): T => (answers.length ? (answers.shift() as T) : fallback)
const dialogs: Dialogs = {
  pickAudioFiles: async () => next<string[]>([]),
  pickProjectToOpen: async () => next<string | null>(null),
  pickProjectToSave: async () => next<string | null>(null),
  pickExportPath: async () => next<string | null>(null),
  locateTrack: async () => next<string | null>(null),
}
const service = createHostService(DATA_DIR, dialogs)
service.prepareTools()

const body = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return new Uint8Array(Buffer.concat(chunks))
}

const { createServer: createVite } = await import('vite')
const vite = await createVite({
  root: join(import.meta.dirname, '..'),
  server: { middlewareMode: true },
  appType: 'spa',
})

createHttpServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  try {
    if (request.method === 'POST' && url.pathname === '/dev/dialog') {
      answers.push(JSON.parse(new TextDecoder().decode(await body(request))))
      response.end()
      return
    }
    const api = /^\/api\/(\w+)$/.exec(url.pathname)
    if (request.method === 'POST' && api) {
      const method = api[1] as keyof typeof service
      const fn = service[method] as unknown
      if (
        typeof fn !== 'function' ||
        method === 'close' ||
        method === 'mediaFile' ||
        method === 'prepareTools'
      ) {
        response.writeHead(404).end()
        return
      }
      const args = decodeRpc(await body(request)) as unknown[]
      let result: unknown
      try {
        result = { ok: await (fn as (...a: unknown[]) => Promise<unknown>)(...args) }
      } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) }
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(encodeRpc(result))
      return
    }
    const media = /^\/media\/(decoded|stretched)\/([^/]+)$/.exec(url.pathname)
    if (media) {
      const file = await service.mediaFile(
        media[1] as string,
        decodeURIComponent(media[2] as string),
      )
      if (!file) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      createReadStream(file).pipe(response)
      return
    }
    vite.middlewares(request, response)
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : String(error))
  }
}).listen(PORT, () => {
  console.log(`djmixer (navegador) em http://localhost:${PORT}  dados: ${DATA_DIR}`)
})
