// SPDX-License-Identifier: AGPL-3.0-or-later
// "Importar de URL" com um yt-dlp de mentira: faixas só com DRM, prévias e playlists com falhas.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadAudio, searchSoundCloud } from './url-import.ts'

const dir = mkdtempSync(join(tmpdir(), 'djmixer-url-'))
const fake = join(dir, 'yt-dlp')
// Com login, as faixas 98 e 99 só vêm com DRM; sem login, a 99 tem o stream aberto e a 98 só a
// prévia (que o --format recusa). A playlist tem uma faixa boa e uma só com DRM.
writeFileSync(
  fake,
  `#!/bin/sh
case "$*" in *"format_id!*=preview"*) ;; *) echo "ERROR: sem filtro de prévia" >&2; exit 2 ;; esac
login=no
case "$*" in *--cookies-from-browser*) login=yes ;; esac
for target; do :; done
ok() { printf '{"filepath": "${dir}/%s.m4a", "webpage_url": "https://soundcloud.com/a/%s", "format_id": "hls_aac_160k"}\\n' "$1" "$1"; }
case "$login:$target" in
  *:scsearch15:rede) echo "ERROR: [soundcloud:search] Unable to download webpage: offline" >&2; exit 1 ;;
  *:scsearch15:*)
    echo '{"id": 1, "title": "Aberta", "uploader": "DJ", "duration": 300.5, "webpage_url": "https://soundcloud.com/dj/aberta", "thumbnail": "https://i1.sndcdn.com/a.jpg", "abr": 160}'
    echo "ERROR: [soundcloud] 2: This video is DRM protected" >&2
    echo '{"id": 3, "title": "Sem capa", "uploader": "DJ", "webpage_url": "https://soundcloud.com/dj/sem-capa", "thumbnail": "http://x/a.jpg"}'
    exit 1 ;;
  yes:*drm-only) echo "ERROR: [soundcloud] 99: This video is DRM protected" >&2; exit 1 ;;
  yes:*preview-only) echo "ERROR: [soundcloud] 98: This video is DRM protected" >&2; exit 1 ;;
  no:*/tracks/99) ok 99 ;;
  no:*/tracks/98) echo "ERROR: [soundcloud] 98: Requested format is not available. Use --list-formats" >&2; exit 1 ;;
  *:*playlist) ok 1; echo "ERROR: [soundcloud] 97: This video is DRM protected" >&2; exit 1 ;;
  *) ok 2 ;;
esac
`,
)
chmodSync(fake, 0o755)
const ytDlp = async () => fake

describe.skipIf(process.platform === 'win32')('downloadAudio', () => {
  it('tenta sem login a faixa que, com login, só veio com DRM', async () => {
    const result = await downloadAudio('https://soundcloud.com/a/drm-only', dir, ytDlp, {
      browser: 'chrome',
    })
    expect(result.errors).toEqual([])
    expect(result.files.map((f) => f.pageUrl)).toEqual(['https://soundcloud.com/a/99'])
  })

  it('explica quando a faixa só existe com DRM', async () => {
    await expect(
      downloadAudio('https://soundcloud.com/a/preview-only', dir, ytDlp, { browser: 'chrome' }),
    ).rejects.toThrow(/faixa 98: só existe protegida por DRM/)
  })

  it('numa playlist, baixa as faixas boas e lista as que ficaram de fora', async () => {
    const result = await downloadAudio('https://soundcloud.com/a/sets/playlist', dir, ytDlp)
    expect(result.files).toHaveLength(1)
    expect(result.errors).toEqual([expect.stringMatching(/^faixa 97: só existe protegida por DRM/)])
  })
})

describe.skipIf(process.platform === 'win32')('searchSoundCloud', () => {
  it('lista só as faixas que dá para baixar', async () => {
    expect(await searchSoundCloud('  techno   minimal ', ytDlp)).toEqual([
      {
        id: '1',
        title: 'Aberta',
        artist: 'DJ',
        durationSeconds: 300.5,
        url: 'https://soundcloud.com/dj/aberta',
        thumbnail: 'https://i1.sndcdn.com/a.jpg',
        kbps: 160,
      },
      {
        id: '3',
        title: 'Sem capa',
        artist: 'DJ',
        durationSeconds: null,
        url: 'https://soundcloud.com/dj/sem-capa',
        thumbnail: null,
        kbps: null,
      },
    ])
    expect(await searchSoundCloud('   ', ytDlp)).toEqual([])
  })

  it('mostra o erro quando a busca em si falha', async () => {
    await expect(searchSoundCloud('rede', ytDlp)).rejects.toThrow('Unable to download webpage')
  })
})
