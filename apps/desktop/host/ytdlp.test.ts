// SPDX-License-Identifier: AGPL-3.0-or-later
// Instalação do yt-dlp pelo app: escolha do executável, conferência do SHA-256, atualização
// diária e uso do que já está instalado quando não há internet. O GitHub é um fetch de mentira.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { checksumFor, createYtDlp, ytDlpAsset } from './ytdlp.ts'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

function fakeGitHub(files: Record<string, string>) {
  const requests: string[] = []
  const fetch = (async (url: string) => {
    requests.push(url)
    const name = url.split('/').pop() ?? ''
    const body = files[name]
    return body === undefined
      ? new Response('não encontrado', { status: 404 })
      : new Response(body, { status: 200 })
  }) as typeof globalThis.fetch
  return { fetch, requests }
}

const release = (binary: string, declared = sha(binary)) => ({
  'SHA2-256SUMS': `${sha('outro')}  yt-dlp.exe\n${declared}  yt-dlp_macos\n`,
  'yt-dlp_macos': binary,
})

describe('yt-dlp instalado pelo app', () => {
  beforeEach(() => {
    delete process.env.DJMIXER_YTDLP
  })

  it('escolhe o executável oficial de cada sistema', () => {
    expect(ytDlpAsset('darwin', 'arm64')).toBe('yt-dlp_macos')
    expect(ytDlpAsset('darwin', 'x64')).toBe('yt-dlp_macos')
    expect(ytDlpAsset('win32', 'x64')).toBe('yt-dlp.exe')
    expect(ytDlpAsset('win32', 'arm64')).toBe('yt-dlp_arm64.exe')
    expect(ytDlpAsset('linux', 'arm64')).toBe('yt-dlp_linux_aarch64')
    expect(ytDlpAsset('freebsd', 'x64')).toBeNull()
    expect(checksumFor(`${sha('a')} *yt-dlp.exe\n`, 'yt-dlp.exe')).toBe(sha('a'))
    expect(checksumFor(`${sha('a')}  yt-dlp.exe\n`, 'yt-dlp')).toBeNull()
  })

  it('usa o do sistema quando existe e não baixa nada', async () => {
    const github = fakeGitHub({})
    const ytDlp = createYtDlp({
      binDir: mkdtempSync(join(tmpdir(), 'djmixer-ytdlp-')),
      fetch: github.fetch,
      findSystem: () => '/opt/homebrew/bin/yt-dlp',
    })
    expect(await ytDlp.ensure()).toBe('/opt/homebrew/bin/yt-dlp')
    expect(ytDlp.status()).toMatchObject({ state: 'ready', source: 'system' })
    expect(github.requests).toEqual([])
  })

  it('baixa, confere o hash e só procura versão nova depois de um dia', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'djmixer-ytdlp-'))
    let now = 1_000_000
    let files = release('binário v1')
    const github = fakeGitHub(files)
    const options = {
      binDir,
      platform: 'darwin' as const,
      arch: 'arm64',
      fetch: (url: string | URL | Request) => fakeGitHub(files).fetch(url),
      now: () => now,
      findSystem: () => null,
    }
    const ytDlp = createYtDlp({ ...options, fetch: github.fetch })
    const path = await ytDlp.ensure()
    expect(path).toBe(join(binDir, 'yt-dlp'))
    expect(readFileSync(path, 'utf8')).toBe('binário v1')
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o111).toBeTruthy()
    expect(ytDlp.status()).toMatchObject({ state: 'ready', source: 'app' })

    // Mesmo dia: nem consulta o GitHub.
    await ytDlp.ensure()
    expect(github.requests).toHaveLength(2)

    // Dia seguinte, versão nova no release: troca o executável.
    now += 25 * 60 * 60 * 1000
    files = release('binário v2')
    await createYtDlp(options).ensure()
    expect(readFileSync(path, 'utf8')).toBe('binário v2')
  })

  it('recusa download com hash errado e não deixa arquivo pela metade', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'djmixer-ytdlp-'))
    const ytDlp = createYtDlp({
      binDir,
      platform: 'darwin',
      arch: 'arm64',
      fetch: fakeGitHub(release('binário adulterado', sha('binário v1'))).fetch,
      findSystem: () => null,
    })
    await expect(ytDlp.ensure()).rejects.toThrow('corrompido')
    expect(ytDlp.status()).toMatchObject({ state: 'error' })
    expect(existsSync(join(binDir, 'yt-dlp'))).toBe(false)
  })

  it('sem internet, segue com o que já foi instalado', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'djmixer-ytdlp-'))
    let now = 0
    const base = { binDir, platform: 'win32' as const, arch: 'x64', now: () => now }
    const files = { 'SHA2-256SUMS': `${sha('exe')}  yt-dlp.exe\n`, 'yt-dlp.exe': 'exe' }
    await createYtDlp({ ...base, fetch: fakeGitHub(files).fetch, findSystem: () => null }).ensure()

    now += 2 * 24 * 60 * 60 * 1000
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const path = await createYtDlp({ ...base, fetch: offline, findSystem: () => null }).ensure()
    expect(path).toBe(join(binDir, 'yt-dlp.exe'))

    const empty = mkdtempSync(join(tmpdir(), 'djmixer-ytdlp-'))
    await expect(
      createYtDlp({ ...base, binDir: empty, fetch: offline, findSystem: () => null }).ensure(),
    ).rejects.toThrow('Não foi possível instalar o yt-dlp')
  })
})
