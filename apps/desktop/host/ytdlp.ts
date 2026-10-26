// SPDX-License-Identifier: AGPL-3.0-or-later
// yt-dlp do "Importar de URL" (docs/decisoes/0013). Se não houver um no sistema, o app baixa o
// executável oficial (standalone, sem precisar de Python) dos releases do GitHub para
// `<dados do app>/bin/`, confere o SHA-256 contra o SHA2-256SUMS do mesmo release e procura
// versão nova no máximo uma vez por dia. Não distribuímos o yt-dlp: ele é baixado na máquina.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { YtDlpStatus } from './api.ts'
import { findSystemTool } from './media.ts'

const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Nome do executável standalone no release do yt-dlp, ou null se não há um para a máquina. */
export function ytDlpAsset(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'darwin') return 'yt-dlp_macos' // universal: Intel e Apple Silicon
  if (platform === 'win32') {
    if (arch === 'x64') return 'yt-dlp.exe'
    if (arch === 'ia32') return 'yt-dlp_x86.exe'
    if (arch === 'arm64') return 'yt-dlp_arm64.exe'
    return null
  }
  if (platform === 'linux') {
    if (arch === 'x64') return 'yt-dlp_linux'
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64'
  }
  return null
}

/** Acha o hash de `asset` num arquivo no formato do `sha256sum`. */
export function checksumFor(sums: string, asset: string): string | null {
  for (const line of sums.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(line.trim())
    if (match && match[2] === asset) return (match[1] as string).toLowerCase()
  }
  return null
}

export interface YtDlpOptions {
  /** Pasta onde o app guarda o executável baixado (`<dados do app>/bin`). */
  binDir: string
  platform?: NodeJS.Platform
  arch?: string
  fetch?: typeof fetch
  now?: () => number
  /** yt-dlp já instalado no sistema (PATH, Homebrew), ou null. */
  findSystem?: () => string | null
}

interface Installed {
  asset: string
  sha256: string
  checkedAt: number
}

export interface YtDlp {
  /** Caminho do yt-dlp a usar, instalando ou atualizando se preciso. Chamadas simultâneas esperam a mesma instalação. */
  ensure(): Promise<string>
  status(): YtDlpStatus
}

export function createYtDlp(options: YtDlpOptions): YtDlp {
  const {
    binDir,
    platform = process.platform,
    arch = process.arch,
    fetch: get = fetch,
    now = Date.now,
    findSystem = () => findSystemTool('yt-dlp'),
  } = options
  const asset = ytDlpAsset(platform, arch)
  const exe = join(binDir, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  const metaFile = join(binDir, 'yt-dlp.json')
  let current: YtDlpStatus = { state: 'checking' }
  let pending: Promise<string> | null = null

  const download = async (url: string): Promise<Uint8Array> => {
    const response = await get(url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`${url} respondeu ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  const readMeta = async (): Promise<Installed | null> => {
    try {
      return JSON.parse(await readFile(metaFile, 'utf8')) as Installed
    } catch {
      return null
    }
  }

  const install = async (): Promise<string> => {
    if (!asset) {
      throw new Error(
        `não há yt-dlp pronto para ${platform}/${arch}; instale-o no sistema ou defina DJMIXER_YTDLP.`,
      )
    }
    const meta = await readMeta()
    const installed = existsSync(exe) && meta?.asset === asset ? meta : null
    if (installed && now() - installed.checkedAt < CHECK_INTERVAL_MS) return exe

    let expected: string
    try {
      const sums = new TextDecoder().decode(await download(`${RELEASES}/SHA2-256SUMS`))
      const hash = checksumFor(sums, asset)
      if (!hash) throw new Error(`${asset} não está no SHA2-256SUMS do release`)
      expected = hash
    } catch (error) {
      // Sem internet: segue com o que já está instalado e tenta de novo na próxima abertura.
      if (installed) return exe
      throw error
    }
    if (installed?.sha256 !== expected) {
      current = { state: 'installing' }
      const data = await download(`${RELEASES}/${asset}`)
      const actual = createHash('sha256').update(data).digest('hex')
      if (actual !== expected) {
        throw new Error(
          `o download do yt-dlp veio corrompido (SHA-256 ${actual}, esperado ${expected})`,
        )
      }
      await mkdir(binDir, { recursive: true })
      const temp = `${exe}.${process.pid}.tmp`
      try {
        await writeFile(temp, data)
        await chmod(temp, 0o755)
        await rename(temp, exe)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    }
    await writeFile(metaFile, JSON.stringify({ asset, sha256: expected, checkedAt: now() }))
    return exe
  }

  const resolve = async (): Promise<string> => {
    const env = process.env.DJMIXER_YTDLP
    if (env) {
      current = { state: 'ready', path: env, source: 'env' }
      return env
    }
    const system = findSystem()
    if (system) {
      current = { state: 'ready', path: system, source: 'system' }
      return system
    }
    try {
      const path = await install()
      current = { state: 'ready', path, source: 'app' }
      return path
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      current = { state: 'error', error: `Não foi possível instalar o yt-dlp: ${message}` }
      throw new Error(current.error, { cause: error })
    }
  }

  return {
    ensure() {
      pending ??= resolve().finally(() => (pending = null))
      return pending
    },
    status: () => current,
  }
}
