// SPDX-License-Identifier: AGPL-3.0-or-later
// "Importar de URL": baixa o áudio de uma página (faixa ou playlist do SoundCloud, por exemplo)
// com o yt-dlp (do sistema ou instalado pelo app, ver host/ytdlp.ts), para uso pessoal (docs/decisoes/0013). O yt-dlp recusa conteúdo com
// DRM, então serviços como Spotify e as faixas Go+ do SoundCloud ficam de fora.
import { dirname, isAbsolute } from 'node:path'
import { COOKIE_BROWSERS, type UrlImportOptions } from './api.ts'
import { findTool, run } from './media.ts'

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

/**
 * Baixa o melhor áudio disponível para `dir`, com título e artista gravados no arquivo (o ffprobe
 * os lê na importação). Um arquivo já baixado não é baixado de novo.
 */
export async function downloadAudio(
  url: string,
  dir: string,
  /** Caminho do yt-dlp, instalado se preciso (ver host/ytdlp.ts). */
  ytDlp: () => Promise<string>,
  options: UrlImportOptions = {},
): Promise<DownloadedFile[]> {
  if (!isHttpUrl(url)) throw new Error('Cole um endereço que comece com https://')
  const browser = options.browser ?? null
  if (browser && !(COOKIE_BROWSERS as readonly string[]).includes(browser)) {
    throw new Error(`navegador desconhecido: ${browser}`)
  }
  const ytDlpPath = await ytDlp()
  const ffmpeg = findTool('ffmpeg')
  const out = await run(
    'yt-dlp',
    [
      '--no-progress',
      '--no-warnings',
      '--yes-playlist',
      // O yt-dlp já prefere o original do artista (formato "download") quando existe; sem login,
      // o SoundCloud costuma negá-lo e sobra o melhor stream.
      '--format',
      'bestaudio/best',
      ...(browser ? ['--cookies-from-browser', browser] : []),
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
      url,
    ],
    ytDlpPath,
  )
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
