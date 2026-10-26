// SPDX-License-Identifier: AGPL-3.0-or-later
// Arquivos de áudio: hash do conteúdo, metadados (ffprobe) e decodificação (ffmpeg) para PCM
// float estéreo a 44,1 kHz, guardada em cache pelo hash. O ffmpeg vem do PATH ou de
// DJMIXER_FFMPEG; embuti-lo no app fica para o primeiro release (docs/decisoes/0010).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { CHANNELS, SAMPLE_RATE, type AudioInfo } from './api.ts'

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'aif', 'aiff', 'ogg', 'opus']

// Apps abertos pelo Finder não herdam o PATH do terminal; o Homebrew instala nestes lugares.
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

type Tool = 'ffmpeg' | 'ffprobe' | 'yt-dlp'

export function findTool(name: Tool): string {
  if (name === 'yt-dlp' && process.env.DJMIXER_YTDLP) return process.env.DJMIXER_YTDLP
  const override = name === 'yt-dlp' ? undefined : process.env.DJMIXER_FFMPEG
  if (override) {
    return name === 'ffmpeg'
      ? override
      : join(dirname(override), basename(override).replace('ffmpeg', 'ffprobe'))
  }
  return findSystemTool(name) ?? (process.platform === 'win32' ? `${name}.exe` : name)
}

/** Procura a ferramenta no PATH e nas pastas do Homebrew; null se não está instalada. */
export function findSystemTool(name: Tool): string | null {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const dirs = [
    ...(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':'),
    ...EXTRA_DIRS,
  ]
  for (const dir of dirs) {
    if (dir && existsSync(join(dir, exe))) return join(dir, exe)
  }
  return null
}

const INSTALL_HINT: Record<Tool, string> = {
  ffmpeg: 'Instale o ffmpeg (brew install ffmpeg) ou defina DJMIXER_FFMPEG.',
  ffprobe: 'Instale o ffmpeg (brew install ffmpeg) ou defina DJMIXER_FFMPEG.',
  'yt-dlp': 'O app instala o yt-dlp sozinho quando há internet; ou defina DJMIXER_YTDLP.',
}

/** Roda a ferramenta; `command` troca o executável achado por `findTool`. */
export function run(tool: Tool, args: string[], command = findTool(tool)): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (err = (err + chunk.toString()).slice(-2000)))
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(`${tool} não encontrado. ${INSTALL_HINT[tool]}`)
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

export const COVER_SIZE = 160

// Extrair capas é rápido, mas uma biblioteca grande pede todas de uma vez ao abrir.
const COVER_JOBS = 2
let coverJobs = 0
const coverQueue: (() => void)[] = []

async function withCoverSlot<T>(job: () => Promise<T>): Promise<T> {
  if (coverJobs >= COVER_JOBS) await new Promise<void>((resolve) => coverQueue.push(resolve))
  coverJobs++
  try {
    return await job()
  } finally {
    coverJobs--
    coverQueue.shift()?.()
  }
}

/**
 * Grava em `target` um JPEG quadrado de COVER_SIZE px a partir da primeira fonte com imagem: uma
 * imagem solta (a capa baixada pelo yt-dlp) ou a capa embutida num arquivo de áudio. Devolve
 * false se nenhuma fonte tem imagem.
 */
export function extractCover(sources: string[], target: string): Promise<boolean> {
  return withCoverSlot(async () => {
    for (const source of sources) {
      if (!existsSync(source)) continue
      const temp = `${target}.${process.pid}.tmp`
      try {
        await run('ffmpeg', [
          '-v',
          'error',
          '-nostdin',
          '-y',
          '-i',
          source,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          `scale=${COVER_SIZE}:${COVER_SIZE}:force_original_aspect_ratio=increase,crop=${COVER_SIZE}:${COVER_SIZE}`,
          '-f',
          'image2',
          '-c:v',
          'mjpeg',
          temp,
        ])
        await rename(temp, target)
        return true
      } catch {
        // Sem imagem nesta fonte: tenta a próxima.
        await rm(temp, { force: true })
      }
    }
    return false
  })
}

const LOSSLESS = /^(flac|alac|wavpack|ape|tta|pcm_.*)$/

export async function audioInfo(path: string): Promise<AudioInfo> {
  const json = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-select_streams',
    'a:0',
    path,
  ])
  const data = JSON.parse(json) as {
    format?: { format_name?: string; bit_rate?: string }
    streams?: {
      codec_name?: string
      bit_rate?: string
      sample_rate?: string
      channels?: number
      bits_per_raw_sample?: string
      bits_per_sample?: number
    }[]
  }
  const stream = data.streams?.[0] ?? {}
  const number = (value: string | number | undefined) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const codec = stream.codec_name ?? '?'
  const lossless = LOSSLESS.test(codec)
  const bitrate = number(stream.bit_rate) ?? number(data.format?.bit_rate)
  return {
    container: data.format?.format_name ?? '?',
    codec,
    bitrateKbps: bitrate ? Math.round(bitrate / 1000) : null,
    sampleRate: number(stream.sample_rate),
    bitDepth: lossless
      ? (number(stream.bits_per_raw_sample) ?? number(stream.bits_per_sample))
      : null,
    channels: stream.channels ?? null,
    bytes: (await stat(path)).size,
    lossless,
  }
}
