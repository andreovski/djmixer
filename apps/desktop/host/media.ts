// SPDX-License-Identifier: AGPL-3.0-or-later
// Arquivos de áudio: hash do conteúdo, metadados (ffprobe) e decodificação (ffmpeg) para PCM
// float estéreo a 44,1 kHz, guardada em cache pelo hash. O ffmpeg vem do PATH ou de
// DJMIXER_FFMPEG; embuti-lo no app fica para o primeiro release (docs/decisoes/0010).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { CHANNELS, SAMPLE_RATE } from './api.ts'

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'aif', 'aiff', 'ogg', 'opus']

// Apps abertos pelo Finder não herdam o PATH do terminal; o Homebrew instala nestes lugares.
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function findTool(name: 'ffmpeg' | 'ffprobe'): string {
  const override = process.env.DJMIXER_FFMPEG
  if (override) {
    return name === 'ffmpeg'
      ? override
      : join(dirname(override), basename(override).replace('ffmpeg', 'ffprobe'))
  }
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const dirs = [
    ...(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':'),
    ...EXTRA_DIRS,
  ]
  for (const dir of dirs) {
    if (dir && existsSync(join(dir, exe))) return join(dir, exe)
  }
  return exe
}

function run(tool: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(findTool(tool), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (err = (err + chunk.toString()).slice(-2000)))
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(
              `${tool} não encontrado. Instale o ffmpeg (brew install ffmpeg) ou defina DJMIXER_FFMPEG.`,
            )
          : error,
      ),
    )
    child.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${tool} saiu com código ${code}: ${err.trim()}`)),
    )
  })
}

export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export interface ProbeResult {
  title: string
  artist: string
  durationSeconds: number
}

export async function probe(path: string): Promise<ProbeResult> {
  const json = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ])
  const data = JSON.parse(json) as {
    format?: { duration?: string; tags?: Record<string, string> }
    streams?: { codec_type?: string }[]
  }
  if (!data.streams?.some((stream) => stream.codec_type === 'audio')) {
    throw new Error('o arquivo não tem áudio')
  }
  const tags = Object.fromEntries(
    Object.entries(data.format?.tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const fallback = basename(path, extname(path))
  return {
    title: tags.title?.trim() || fallback,
    artist: tags.artist?.trim() || tags.album_artist?.trim() || '',
    durationSeconds: Number(data.format?.duration ?? 0) || 0,
  }
}

const pending = new Map<string, Promise<string>>()

/**
 * Decodifica para `<dir>/<hash>.f32` (float 32 bits little-endian, estéreo intercalado,
 * 44,1 kHz). Chamadas simultâneas para o mesmo hash compartilham o mesmo processo.
 */
export function decodeToCache(source: string, hash: string, dir: string): Promise<string> {
  const target = join(dir, `${hash}.f32`)
  if (existsSync(target)) return Promise.resolve(target)
  const running = pending.get(target)
  if (running) return running
  const temp = `${target}.${process.pid}.tmp`
  const job = run('ffmpeg', [
    '-v',
    'error',
    '-nostdin',
    '-y',
    '-i',
    source,
    '-vn',
    '-ac',
    String(CHANNELS),
    '-ar',
    String(SAMPLE_RATE),
    '-f',
    'f32le',
    temp,
  ])
    .then(() => rename(temp, target))
    .then(() => target)
    .catch(async (error: unknown) => {
      await rm(temp, { force: true })
      throw error
    })
    .finally(() => pending.delete(target))
  pending.set(target, job)
  return job
}
