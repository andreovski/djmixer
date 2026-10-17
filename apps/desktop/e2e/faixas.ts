// SPDX-License-Identifier: AGPL-3.0-or-later
// Duas faixas sintéticas (bumbo, baixo e acordes numa tonalidade conhecida) para os testes de
// ponta a ponta, gravadas como WAV numa pasta temporária. Nenhum áudio entra no repositório.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMusic, type MusicSpec } from '../../../packages/analysis/src/synthetic-music.ts'
import { encodeWav } from '../../../packages/engine/src/wav.ts'

export const FAIXAS: (MusicSpec & { file: string })[] = [
  {
    file: 'faixa-a-124.wav',
    bpm: 124,
    key: 'A',
    scale: 'minor',
    beats: 160,
    leadInSeconds: 0.2,
    seed: 1,
  },
  {
    file: 'faixa-b-127.wav',
    bpm: 127,
    key: 'C',
    scale: 'major',
    beats: 160,
    leadInSeconds: 0.35,
    seed: 2,
  },
]

export function gerarFaixas(dir: string): string[] {
  mkdirSync(dir, { recursive: true })
  return FAIXAS.map((spec) => {
    const mono = renderMusic(spec, 44100)
    const path = join(dir, spec.file)
    writeFileSync(path, encodeWav([mono, mono], 44100))
    return path
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const path of gerarFaixas(process.argv[2] ?? 'faixas-teste')) console.log(path)
}
