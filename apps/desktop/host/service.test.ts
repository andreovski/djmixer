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
while [ "$1" != "--output" ]; do shift; done
target=$(echo "$2" | sed 's/%(extractor)s-%(id)s.%(ext)s/soundcloud-42.wav/')
cp '${source}' "$target"
echo "[download] Destination: $target"
printf '{"filepath": "%s", "webpage_url": "https://soundcloud.com/a/b"}\n' "$target"
`,
      )
      chmodSync(fake, 0o755)
      process.env.DJMIXER_YTDLP = fake
      try {
        const { entries, errors } = await service.importFromUrl('https://soundcloud.com/a/b')
        expect(errors).toEqual([])
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
      } finally {
        delete process.env.DJMIXER_YTDLP
      }
    },
  )
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
    expect(existsSync(join(dir, 'dados', 'cache', 'covers', `${entries[0]?.hash}.none`))).toBe(true)
    expect([...(cover ?? new Uint8Array()).subarray(0, 2)]).toEqual([0xff, 0xd8])
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
