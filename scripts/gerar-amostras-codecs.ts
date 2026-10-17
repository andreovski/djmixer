// SPDX-License-Identifier: AGPL-3.0-or-later
// Gera 0,5 s de silêncio seguido de um tom de 440 Hz, 5 s no total, em cada formato que o app
// precisa abrir, para a sondagem do spike 4 conferir a decodificação em cada shell. O silêncio
// inicial mostra se o decodificador descarta o atraso do codificador (senão o áudio todo, e o
// beatgrid, chega atrasado).
// Precisa do ffmpeg no PATH.
// Uso: pnpm fixtures:codecs
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(import.meta.dirname, '..', 'apps', 'playground', 'public', 'codecs')

/** Nome do arquivo e argumentos de codificação do ffmpeg. */
const FORMATS: [string, string[]][] = [
  ['tom.wav', ['-c:a', 'pcm_s16le']],
  ['tom.aiff', ['-c:a', 'pcm_s16be']],
  ['tom.mp3', ['-c:a', 'libmp3lame', '-b:a', '320k']],
  ['tom-aac.m4a', ['-c:a', 'aac', '-b:a', '256k']],
  ['tom-alac.m4a', ['-c:a', 'alac']],
  ['tom.flac', ['-c:a', 'flac']],
  ['tom.ogg', ['-c:a', 'libvorbis', '-q:a', '6']],
  ['tom.opus', ['-c:a', 'libopus', '-b:a', '160k']],
]

mkdirSync(OUT_DIR, { recursive: true })
// Um formato que o ffmpeg local não sabe codificar só fica de fora; a sondagem o marca como pulado.
const missing: string[] = []
for (const [name, codec] of FORMATS) {
  const file = join(OUT_DIR, name)
  try {
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'aevalsrc=if(gte(t\\,0.5)\\,0.5*sin(2*PI*440*(t-0.5))\\,0):s=44100:d=5',
        '-ac',
        '2',
        ...codec,
        file,
      ],
      { stdio: 'inherit' },
    )
    console.log(`gerado ${file}`)
  } catch {
    missing.push(name)
    console.warn(`não foi possível gerar ${name} com este ffmpeg`)
  }
}
if (missing.length === FORMATS.length) process.exit(1)
