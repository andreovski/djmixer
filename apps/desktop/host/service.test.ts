// SPDX-License-Identifier: AGPL-3.0-or-later
// Host sem Electron: importar, decodificar com ffmpeg, achar faixa movida pelo hash, salvar
// projeto e escrever o WAV em partes. Pula o que depende do ffmpeg se ele não estiver instalado.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { encodeWav, wavHeader } from '../../../packages/engine/src/wav.ts'
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
})

describe('host', () => {
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
