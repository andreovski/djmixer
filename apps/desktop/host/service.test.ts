// SPDX-License-Identifier: AGPL-3.0-or-later
// Host sem Electron: importar, decodificar com ffmpeg, achar faixa movida pelo hash, salvar
// projeto e escrever o WAV em partes. Pula o que depende do ffmpeg se ele não estiver instalado.
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { encodeWav, wavHeader } from '../../../packages/engine/src/wav.ts'
import { DatabaseSync } from 'node:sqlite'
import { Library } from './library.ts'
import { createHostService, type Dialogs } from './service.ts'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const dir = mkdtempSync(join(tmpdir(), 'djmixer-host-'))
const answers: unknown[] = []
const dialogs: Dialogs = {
  pickAudioFiles: async () => answers.shift() as string[],
  pickProjectToOpen: async () => answers.shift() as string,
  pickProjectToSave: async () => answers.shift() as string,
  pickExportPath: async () => answers.shift() as string,
  locateTrack: async () => answers.shift() as string,
  reveal: async (path) => void answers.push(`revelado:${path}`),
  pickApplication: async () => answers.shift() as string,
  appIcon: async () => null,
}
const service = createHostService(join(dir, 'dados'), dialogs)
afterAll(() => service.close())

function tone(path: string, seconds: number) {
  const samples = Float32Array.from({ length: 44100 * seconds }, (_, i) => 0.5 * Math.sin(i / 10))
  writeFileSync(path, encodeWav([samples, samples], 44100))
}

describe.skipIf(!hasFfmpeg)('host com ffmpeg', () => {
  it('importa, decodifica e acha a faixa movida pelo hash', async () => {
    const path = join(dir, 'tom.wav')
    tone(path, 2)
    const { entries, errors } = await service.importFiles([path, join(dir, 'nao-existe.mp3')])
    expect(errors).toHaveLength(1)
    const [entry] = entries
    expect(entry).toMatchObject({ title: 'tom', missing: false })
    expect(entry?.durationSeconds).toBeCloseTo(2, 1)

    const decoded = await service.mediaFile('decoded', entry?.hash ?? '')
    expect(statSync(decoded ?? '').size).toBe(44100 * 2 * 2 * 4)

    const moved = join(dir, 'movida.wav')
    renameSync(path, moved)
    expect((await service.listLibrary())[0]?.missing).toBe(true)
    const [resolved] = await service.resolveTracks([{ hash: entry?.hash ?? '', path: moved }])
    expect(resolved?.path).toBe(moved)
  })

  // O yt-dlp de mentira é um script sh, que o Windows não roda.
  it.skipIf(process.platform === 'win32')(
    'importa de URL pelo yt-dlp e guarda a página de origem',
    async () => {
      // yt-dlp de mentira: copia um WAV para o destino e imprime o JSON pedido em --print.
      const source = join(dir, 'baixada.wav')
      tone(source, 1)
      const fake = join(dir, 'yt-dlp')
      writeFileSync(
        fake,
        `#!/bin/sh
# Com login (--cookies-from-browser), finge que veio o original do artista.
format=hls_aac_160k
case "$*" in *"--cookies-from-browser safari"*) format=download ;; esac
while [ "$1" != "--output" ]; do shift; done
target=$(echo "$2" | sed 's/%(extractor)s-%(id)s.%(ext)s/soundcloud-42.wav/')
cp '${source}' "$target"
echo "[download] Destination: $target"
printf '{"filepath": "%s", "webpage_url": "https://soundcloud.com/a/b", "format_id": "%s"}\n' "$target" "$format"
`,
      )
      chmodSync(fake, 0o755)
      process.env.DJMIXER_YTDLP = fake
      try {
        const { entries, errors, originals } = await service.importFromUrl(
          'https://soundcloud.com/a/b',
        )
        expect(errors).toEqual([])
        expect(originals).toEqual([])
        const withLogin = await service.importFromUrl('https://soundcloud.com/a/b', {
          browser: 'safari',
        })
        expect(withLogin.originals).toEqual([entries[0]?.hash])
        await expect(
          service.importFromUrl('https://soundcloud.com/a/b', {
            browser: 'netscape' as 'safari',
          }),
        ).rejects.toThrow('navegador desconhecido')
        expect(entries[0]).toMatchObject({
          title: 'soundcloud-42',
          sourceUrl: 'https://soundcloud.com/a/b',
        })
        const listed = (await service.listLibrary()).find((e) => e.hash === entries[0]?.hash)
        expect(listed?.sourceUrl).toBe('https://soundcloud.com/a/b')
        await expect(service.importFromUrl('soundcloud.com/a/b')).rejects.toThrow('https://')
        // Capa baixada ao lado do áudio (coverSidecar).
        const sidecar = join(dir, 'dados', 'downloads', 'soundcloud-42.jpg')
        spawnSync('ffmpeg', [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=red:s=300x200',
          '-frames:v',
          '1',
          '-y',
          sidecar,
        ])
        const cover = await service.getCover(entries[0]?.hash ?? '')
        expect([...(cover ?? new Uint8Array()).subarray(0, 2)]).toEqual([0xff, 0xd8])

        await service.revealTrack(entries[0]?.hash ?? '')
        expect(answers.pop()).toBe(`revelado:${entries[0]?.path}`)
        // Remover apaga o áudio baixado e a capa, mas não arquivos do usuário.
        await service.removeFromLibrary(entries[0]?.hash ?? '')
        expect(existsSync(entries[0]?.path ?? '')).toBe(false)
        expect(existsSync(sidecar)).toBe(false)
        expect(existsSync(source)).toBe(true)
      } finally {
        delete process.env.DJMIXER_YTDLP
      }
    },
  )
})

describe.skipIf(!hasFfmpeg || process.platform === 'win32')('editor externo', () => {
  it('abre no editor e troca a faixa pela versão salva, mantendo análise e playlists', async () => {
    const path = join(dir, 'editar.wav')
    tone(path, 5)
    const [entry] = (await service.importFiles([path])).entries
    const hash = entry?.hash ?? ''
    const analysis = {
      grid: { bpm: 124, firstBeatSeconds: 0.1 },
      key: null,
      confidence: 1,
      analyzedAt: 1,
    }
    await service.saveAnalysis(hash, analysis, new Uint8Array([1, 2, 3]))
    await service.saveEdits(hash, { grid: null, cues: [{ id: 'c', beat: 4, label: 'drop' }] })
    await service.savePlaylist({ id: 'rx', name: 'RX', hashes: [hash] })

    // Editor de mentira: anota o arquivo que recebeu.
    const marker = join(dir, 'editor-abriu.txt')
    const editor = join(dir, 'editor')
    writeFileSync(editor, `#!/bin/sh\necho "$1" > '${marker}'\n`)
    chmodSync(editor, 0o755)
    const since = await service.openInEditor(hash, editor)
    for (let i = 0; i < 50 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 20))
    expect(readFileSync(marker, 'utf8').trim()).toBe(path)
    expect(await service.checkEdited(hash, since)).toBeNull()

    // "Salvar como" ao lado, com outro nome.
    const savedAs = join(dir, 'editar (RX).wav')
    tone(savedAs, 6)
    const edited = await service.checkEdited(hash, since)
    expect(edited).toMatchObject({ path: savedAs, title: 'editar', analysis })
    expect(edited?.hash).not.toBe(hash)
    expect(edited?.edits.cues).toHaveLength(1)
    expect(await service.getPeaks(edited?.hash ?? '')).toEqual(new Uint8Array([1, 2, 3]))
    expect((await service.listPlaylists()).find((p) => p.id === 'rx')?.hashes).toEqual([
      edited?.hash,
    ])
    expect((await service.listLibrary()).some((e) => e.hash === hash)).toBe(false)
    // Um projeto antigo, com o hash anterior, acha a versão nova.
    const [resolved] = await service.resolveTracks([{ hash, path }])
    expect(resolved?.hash).toBe(edited?.hash)

    // Salvar por cima do mesmo arquivo também troca.
    const again = Date.now() - 1
    tone(savedAs, 7)
    const overwritten = await service.checkEdited(edited?.hash ?? '', again)
    expect(overwritten?.path).toBe(savedAs)
    expect(overwritten?.hash).not.toBe(edited?.hash)
    const [chained] = await service.resolveTracks([{ hash, path }])
    expect(chained?.hash).toBe(overwritten?.hash)
    await service.deletePlaylist('rx')
  })
})

describe.skipIf(!hasFfmpeg)('capas', () => {
  it('extrai a capa embutida e lembra das faixas sem capa', async () => {
    const plain = join(dir, 'sem-capa.wav')
    tone(plain, 3)
    const art = join(dir, 'capa.png')
    spawnSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=blue:s=500x500',
      '-frames:v',
      '1',
      '-y',
      art,
    ])
    const withArt = join(dir, 'com-capa.mp3')
    spawnSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      plain,
      '-i',
      art,
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:v',
      'png',
      '-disposition:v',
      'attached_pic',
      '-y',
      withArt,
    ])
    const { entries } = await service.importFiles([plain, withArt])
    const [noCover, cover] = await Promise.all(entries.map((e) => service.getCover(e.hash)))
    expect(noCover).toBeNull()
    expect(existsSync(join(dir, 'dados', 'cache', 'covers', `${entries[0]?.hash}.nocover`))).toBe(
      true,
    )
    expect([...(cover ?? new Uint8Array()).subarray(0, 2)]).toEqual([0xff, 0xd8])
  })
})

describe.skipIf(!hasFfmpeg || process.platform === 'win32')('capa de download antigo', () => {
  it('busca só a capa na página quando o download não trouxe', async () => {
    // yt-dlp de mentira: com --skip-download, grava uma imagem no --output pedido.
    const fake = join(dir, 'yt-dlp-capa')
    writeFileSync(
      fake,
      `#!/bin/sh
case "$*" in *--skip-download*) ;; *) exit 1 ;; esac
while [ "$1" != "--output" ]; do shift; done
target=$(echo "$2" | sed 's/%(ext)s/jpg/')
ffmpeg -v error -f lavfi -i color=green:s=200x200 -frames:v 1 -y "$target"
`,
    )
    chmodSync(fake, 0o755)
    const audio = join(dir, 'dados', 'downloads', 'soundcloud-7.wav')
    tone(audio, 4)
    const library = new Library(join(dir, 'dados', 'library.sqlite'))
    const { hashFile, probe } = await import('./media.ts')
    const hash = await hashFile(audio)
    library.upsert({
      hash,
      path: audio,
      ...(await probe(audio)),
      sourceUrl: 'https://soundcloud.com/x/y',
    })
    library.close()
    process.env.DJMIXER_YTDLP = fake
    try {
      const cover = await service.getCover(hash)
      expect([...(cover ?? new Uint8Array()).subarray(0, 2)]).toEqual([0xff, 0xd8])
    } finally {
      delete process.env.DJMIXER_YTDLP
    }
  })
})

describe('host', () => {
  it('guarda playlists e tira delas a faixa removida da biblioteca', async () => {
    await service.savePlaylist({ id: 'p1', name: 'Warm up', hashes: ['h1', 'h2'] })
    await service.savePlaylist({ id: 'p2', name: 'Pico', hashes: ['h2'] })
    await service.savePlaylist({ id: 'p1', name: 'Abertura', hashes: ['h1', 'h2'] })
    await service.removeFromLibrary('h2')
    expect(await service.listPlaylists()).toEqual([
      { id: 'p1', name: 'Abertura', hashes: ['h1'] },
      { id: 'p2', name: 'Pico', hashes: [] },
    ])
    await service.deletePlaylist('p2')
    expect((await service.listPlaylists()).map((p) => p.id)).toEqual(['p1'])
  })

  it('não procura capa com chave inválida', async () => {
    expect(await service.getCover('../x')).toBeNull()
  })

  it('acrescenta a coluna da origem numa biblioteca antiga', () => {
    const file = join(dir, 'antiga.sqlite')
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE tracks (hash TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL,
      artist TEXT NOT NULL, duration REAL NOT NULL, analysis TEXT, edits TEXT, peaks BLOB,
      imported_at INTEGER NOT NULL);
      INSERT INTO tracks VALUES ('h', '/x.mp3', 'X', '', 1, NULL, NULL, NULL, 0);`)
    old.close()
    const library = new Library(file)
    expect(library.get('h')?.sourceUrl).toBeUndefined()
    library.close()
  })

  it('recusa chaves de mídia com caminho', async () => {
    expect(await service.mediaFile('stretched', '../../etc/passwd')).toBeNull()
  })

  it('salva o projeto com extensão e grava o WAV em partes', async () => {
    answers.push(join(dir, 'set'))
    const saved = await service.saveProject(null, '{}', 'set')
    expect(saved).toBe(join(dir, 'set.djmix'))

    answers.push(join(dir, 'set'))
    const target = await service.exportBegin('set')
    if (!target) throw new Error('export')
    await service.exportChunk(target.id, new Uint8Array(600).fill(1))
    await service.exportChunk(target.id, new Uint8Array(600).fill(2))
    const result = await service.exportEnd(target.id, wavHeader(44100, 2, 24, 1200), '0:00 A\n')
    const bytes = readFileSync(result.wavPath)
    expect(bytes.length).toBe(1244)
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.readUInt32LE(40)).toBe(1200)
    expect(readFileSync(result.tracklistPath, 'utf8')).toBe('0:00 A\n')
  })
})
