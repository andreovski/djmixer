// SPDX-License-Identifier: AGPL-3.0-or-later
// Avaliação do spike 5: BPM, primeira batida e tonalidade em faixas sintéticas com gabarito,
// com os dois detectores de batida do Essentia. Uso: pnpm avaliar:analise
import { analyze, ANALYSIS_SAMPLE_RATE } from '../packages/analysis/src/analyze.ts'
import { renderMusic, type MusicSpec } from '../packages/analysis/src/synthetic-music.ts'

const CASES: MusicSpec[] = [
  { bpm: 120, key: 'A', scale: 'minor', beats: 256, seed: 1 },
  { bpm: 124, key: 'F', scale: 'minor', beats: 256, leadInSeconds: 0.37, seed: 2 },
  { bpm: 126, key: 'C', scale: 'major', beats: 256, leadInSeconds: 1.1, introBeats: 32, seed: 3 },
  { bpm: 128, key: 'G', scale: 'minor', beats: 256, leadInSeconds: 0.05, seed: 4 },
  { bpm: 122.5, key: 'D', scale: 'major', beats: 256, leadInSeconds: 0.21, seed: 5 },
  { bpm: 132, key: 'E', scale: 'minor', beats: 256, introBeats: 16, seed: 6 },
  { bpm: 138, key: 'B', scale: 'minor', beats: 256, leadInSeconds: 0.6, seed: 7 },
  { bpm: 174, key: 'F#', scale: 'minor', beats: 384, leadInSeconds: 0.12, seed: 8 },
  { bpm: 100, key: 'A#', scale: 'major', beats: 192, seed: 9 },
  { bpm: 126.37, key: 'C#', scale: 'minor', beats: 256, leadInSeconds: 0.3, seed: 10 },
]

const name = (key: string, scale: string) => `${key}${scale === 'minor' ? 'm' : ''}`

console.log('| Faixa | Detector | BPM | Primeira batida | Tonalidade | Tempo por minuto |')
console.log('| --- | --- | --- | --- | --- | --- |')
for (const spec of CASES) {
  const samples = renderMusic(spec, ANALYSIS_SAMPLE_RATE)
  const minutes = samples.length / ANALYSIS_SAMPLE_RATE / 60
  for (const beatMethod of ['multifeature', 'degara'] as const) {
    const result = analyze(samples, { beatMethod })
    const period = 60 / spec.bpm
    let error = (result.firstBeatSeconds - (spec.leadInSeconds ?? 0)) / period
    error = (error - Math.round(error)) * period * 1000
    console.log(
      [
        `${spec.bpm} BPM, ${name(spec.key, spec.scale)}${spec.introBeats ? `, intro de ${spec.introBeats} batidas` : ''}`,
        beatMethod,
        `${result.bpm}${result.bpm === spec.bpm ? ' ✓' : ' ✗'}`,
        `${error >= 0 ? '+' : ''}${error.toFixed(1)} ms`,
        `${name(result.key, result.scale)} (${result.camelot})${result.key === spec.key && result.scale === spec.scale ? ' ✓' : ' ✗'}`,
        `${(result.elapsedSeconds / minutes).toFixed(1)} s`,
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    )
  }
}
