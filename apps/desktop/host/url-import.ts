// SPDX-License-Identifier: AGPL-3.0-or-later
// "Importar de URL": baixa o áudio de uma página (faixa ou playlist do SoundCloud, por exemplo)
// com o yt-dlp (do sistema ou instalado pelo app, ver host/ytdlp.ts), para uso pessoal (docs/decisoes/0013). O yt-dlp recusa conteúdo com
// DRM, então serviços como Spotify e as faixas Go+ do SoundCloud ficam de fora.
import { dirname, isAbsolute } from 'node:path'
import { COOKIE_BROWSERS, type SoundCloudResult, type UrlImportOptions } from './api.ts'
import { findTool, run, runResult } from './media.ts'

export interface DownloadedFile {
  path: string
  /** Página da faixa (numa playlist, a de cada faixa, não a da playlist). */
  pageUrl: string
  /** Veio o arquivo que o artista enviou (download liberado), não o stream. */
  original: boolean
}

export function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export interface DownloadResult {
  files: DownloadedFile[]
  /** Itens que não vieram (numa playlist, as outras faixas continuam), já explicados. */
  errors: string[]
}

/** Erro de um item, como o yt-dlp o imprime: "ERROR: [soundcloud] 123: motivo". */
interface ItemError {
  id: string | null
  message: string
}

const DRM = /DRM protected/i
const ONLY_PREVIEW = /Requested format is not available/i

/**
 * Baixa o melhor áudio disponível para `dir`, com título e artista gravados no arquivo (o ffprobe
 * os lê na importação). Um arquivo já baixado não é baixado de novo. Faixas protegidas por DRM
 * ficam de fora (docs/decisoes/0013): com login, o SoundCloud às vezes só oferece à conta a versão
 * com DRM, e aí a faixa é tentada de novo sem login, onde pode existir o stream aberto.
 */
export async function downloadAudio(
  url: string,
  dir: string,
  /** Caminho do yt-dlp, instalado se preciso (ver host/ytdlp.ts). */
  ytDlp: () => Promise<string>,
  options: UrlImportOptions = {},
): Promise<DownloadResult> {
  if (!isHttpUrl(url)) throw new Error('Cole um endereço que comece com https://')
  const browser = options.browser ?? null
  if (browser && !(COOKIE_BROWSERS as readonly string[]).includes(browser)) {
    throw new Error(`navegador desconhecido: ${browser}`)
  }
  const ytDlpPath = await ytDlp()
  const ffmpeg = findTool('ffmpeg')
  const attempt = (target: string, withLogin: boolean) =>
    runResult(
      'yt-dlp',
      [
        '--no-progress',
        '--no-warnings',
        '--yes-playlist',
        // Numa playlist, uma faixa que falha não impede as outras.
        '--ignore-errors',
        // O yt-dlp já prefere o original do artista (formato "download") quando existe; sem login,
        // o SoundCloud costuma negá-lo e sobra o melhor stream. Prévias de 30 s não servem.
        '--format',
        AUDIO_FORMAT,
        ...(withLogin && browser ? ['--cookies-from-browser', browser] : []),
        '--embed-metadata',
        // A capa fica ao lado do áudio, com o mesmo nome e extensão .jpg (ver coverSidecar).
        '--write-thumbnail',
        '--convert-thumbnails',
        'jpg',
        // Sem um caminho, o yt-dlp procura só no PATH, que apps abertos pelo Finder não herdam.
        ...(isAbsolute(ffmpeg) ? ['--ffmpeg-location', dirname(ffmpeg)] : []),
        '--output',
        `${dir}/%(extractor)s-%(id)s.%(ext)s`,
        // --print sozinho só simula; --no-simulate faz baixar e imprimir.
        '--no-simulate',
        '--print',
        'after_move:%(.{filepath,webpage_url,format_id})j',
        '--',
        target,
      ],
      ytDlpPath,
    )

  const first = await attempt(url, true)
  const files = parseFiles(first.out, url)
  let failures = itemErrors(first.err)
  if (browser) {
    // Com login, a faixa só veio com DRM: tenta sem login, pelo endereço da API.
    const retried: ItemError[] = []
    for (const failure of failures) {
      if (!failure.id || !DRM.test(failure.message) || !/^\d+$/.test(failure.id)) {
        retried.push(failure)
        continue
      }
      const again = await attempt(`https://api.soundcloud.com/tracks/${failure.id}`, false)
      const got = parseFiles(again.out, url)
      files.push(...got)
      if (got.length === 0) {
        const [error] = itemErrors(again.err)
        retried.push(
          error && ONLY_PREVIEW.test(error.message) ? { ...failure, message: 'DRM' } : failure,
        )
      }
    }
    failures = retried
  }
  const errors = failures.map(explain)
  if (files.length === 0) {
    if (errors.length) throw new Error(errors.join('; '))
    if (first.code !== 0)
      throw new Error(`yt-dlp saiu com código ${first.code}: ${first.err.trim().slice(-2000)}`)
  }
  return { files, errors }
}

function parseFiles(out: string, url: string): DownloadedFile[] {
  return out
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      const info = JSON.parse(line) as {
        filepath?: string
        webpage_url?: string
        format_id?: string
      }
      if (!info.filepath) throw new Error('o yt-dlp não informou o arquivo baixado')
      return {
        path: info.filepath,
        pageUrl: info.webpage_url ?? url,
        original: info.format_id === 'download',
      }
    })
}

function itemErrors(err: string): ItemError[] {
  return err
    .split('\n')
    .filter((line) => line.startsWith('ERROR:'))
    .map((line) => {
      const match = /^ERROR: (?:\[[^\]]+\] )?(?:([\w-]+): )?(.*)$/.exec(line.trim())
      return { id: match?.[1] ?? null, message: match?.[2] ?? line }
    })
}

/** Mensagem para o usuário, com o motivo de cada falha conhecida. */
function explain({ id, message }: ItemError): string {
  const which = id ? `faixa ${id}` : 'faixa'
  if (DRM.test(message) || message === 'DRM') {
    return `${which}: só existe protegida por DRM (exclusiva do SoundCloud Go+), e o app não baixa conteúdo com DRM. Para usá-la, compre o arquivo (Beatport, Bandcamp) e importe.`
  }
  if (ONLY_PREVIEW.test(message)) {
    return `${which}: o SoundCloud só oferece uma prévia de 30 s (faixa exclusiva do Go+), que o app não importa.`
  }
  return `${which}: ${message}`
}

/** Formato que o "Importar de URL" escolhe: o melhor áudio, nunca a prévia de 30 s. */
const AUDIO_FORMAT = 'bestaudio[format_id!*=preview]/best[format_id!*=preview]'

/** Quantos resultados a busca confere (cada um custa algumas chamadas ao SoundCloud). */
export const SEARCH_LIMIT = 15

/**
 * Busca no SoundCloud (`scsearch` do yt-dlp) sem login. O yt-dlp resolve os formatos de cada
 * resultado sem baixar: faixas só com DRM ou só com prévia dão erro na escolha do formato e, com
 * --ignore-errors, ficam de fora da lista.
 */
export async function searchSoundCloud(
  query: string,
  ytDlp: () => Promise<string>,
  limit = SEARCH_LIMIT,
): Promise<SoundCloudResult[]> {
  const text = query.replace(/\s+/g, ' ').trim()
  if (!text) return []
  const { code, out, err } = await runResult(
    'yt-dlp',
    [
      '--no-warnings',
      '--ignore-errors',
      // Só confere os streams abertos mais comuns (cada formato é uma chamada a mais por faixa).
      '--extractor-args',
      'soundcloud:formats=hls_aac,http_mp3,hls_mp3',
      '--format',
      AUDIO_FORMAT,
      // --print sem --no-simulate: escolhe o formato e imprime, sem baixar nada.
      '--print',
      '%(.{id,title,uploader,duration,webpage_url,thumbnail,abr})j',
      '--',
      `scsearch${limit}:${text}`,
    ],
    await ytDlp(),
  )
  const results = out
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      const info = JSON.parse(line) as {
        id?: string | number
        title?: string
        uploader?: string
        duration?: number
        webpage_url?: string
        thumbnail?: string
        abr?: number
      }
      return {
        id: String(info.id ?? ''),
        title: info.title ?? '',
        artist: info.uploader ?? '',
        durationSeconds: typeof info.duration === 'number' ? info.duration : null,
        url: info.webpage_url ?? '',
        thumbnail: info.thumbnail && /^https:\/\//.test(info.thumbnail) ? info.thumbnail : null,
        kbps: typeof info.abr === 'number' ? Math.round(info.abr) : null,
      }
    })
    .filter((result) => isHttpUrl(result.url))
  // Sem resultado e com erro que não é de uma faixa (rede, yt-dlp quebrado): mostra o erro.
  if (results.length === 0 && code !== 0 && !itemErrors(err).some((e) => e.id)) {
    throw new Error(`yt-dlp saiu com código ${code}: ${err.trim().slice(-2000)}`)
  }
  return results
}

/** Caminho da capa que o yt-dlp grava ao lado de um áudio baixado. */
export function coverSidecar(audioPath: string): string {
  return audioPath.replace(/\.[^./\\]+$/, '') + '.jpg'
}

/** Baixa só a capa da página, para o lugar de coverSidecar(audioPath). */
export async function downloadThumbnail(
  pageUrl: string,
  audioPath: string,
  ytDlp: () => Promise<string>,
): Promise<void> {
  if (!isHttpUrl(pageUrl)) return
  const ytDlpPath = await ytDlp()
  const ffmpeg = findTool('ffmpeg')
  await run(
    'yt-dlp',
    [
      '--no-warnings',
      '--no-playlist',
      '--skip-download',
      '--write-thumbnail',
      '--convert-thumbnails',
      'jpg',
      ...(isAbsolute(ffmpeg) ? ['--ffmpeg-location', dirname(ffmpeg)] : []),
      '--output',
      `${coverSidecar(audioPath).replace(/\.jpg$/, '')}.%(ext)s`,
      '--',
      pageUrl,
    ],
    ytDlpPath,
  )
}
