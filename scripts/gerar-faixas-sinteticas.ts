// SPDX-License-Identifier: AGPL-3.0-or-later
// Gera faixas sintéticas em fixtures/synthetic/ (ver fixtures/README.md).
// Uso: pnpm fixtures:synthetic
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeWav } from '../packages/engine/src/wav.ts'
import { renderSynthetic, type SyntheticSpec } from '../packages/engine/src/synthetic.ts'

const SAMPLE_RATE = 44100
const OUT_DIR = join(import.meta.dirname, '..', 'fixtures', 'synthetic')

const SPECS: SyntheticSpec[] = [
  { bpm: 124, toneHz: 440, beats: 128 },
  { bpm: 128, toneHz: 660, beats: 128 },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const spec of SPECS) {
  const mono = renderSynthetic(spec, SAMPLE_RATE)
  const file = join(OUT_DIR, `sintetica-${spec.bpm}bpm.wav`)
  writeFileSync(file, encodeWav([mono, mono], SAMPLE_RATE))
  console.log(`gerado ${file}`)
}
