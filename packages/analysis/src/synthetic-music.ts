// SPDX-License-Identifier: AGPL-3.0-or-later
// Faixas sintéticas mais próximas de música eletrônica do que as do motor: bumbo 4/4, chimbal
// no contratempo, baixo e acordes numa tonalidade conhecida, com intro opcional sem bumbo.
// Servem de gabarito para medir BPM, beatgrid e tonalidade (spike 5).

export type Scale = 'major' | 'minor'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export type NoteName = (typeof NOTE_NAMES)[number]

export interface MusicSpec {
  bpm: number
  key: NoteName
  scale: Scale
  /** Duração em batidas, contando a intro. */
  beats: number
  /** Silêncio antes da primeira batida, em segundos. */
  leadInSeconds?: number
  /** Batidas iniciais só com acordes, sem bumbo nem chimbal. */
  introBeats?: number
  seed?: number
}

/** Graus da progressão, em semitons acima da tônica, e se o acorde é menor. */
const PROGRESSIONS: Record<Scale, [number, boolean][]> = {
  // i, VI, VII, i (Am, F, G, Am em lá menor).
  minor: [
    [0, true],
    [8, false],
    [10, false],
    [0, true],
  ],
  // I, V, vi, IV (C, G, Am, F em dó maior).
  major: [
    [0, false],
    [7, false],
    [9, true],
    [5, false],
  ],
}

const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function renderMusic(spec: MusicSpec, sampleRate: number): Float32Array<ArrayBuffer> {
  const random = mulberry32(spec.seed ?? 1)
  const beatSeconds = 60 / spec.bpm
  const lead = spec.leadInSeconds ?? 0
  const intro = spec.introBeats ?? 0
  const out = new Float32Array(Math.ceil((lead + spec.beats * beatSeconds) * sampleRate))
  const tonic = 48 + NOTE_NAMES.indexOf(spec.key) // de C3 a B3
  const at = (beat: number) => Math.round((lead + beat * beatSeconds) * sampleRate)

  const add = (start: number, length: number, sample: (t: number, i: number) => number) => {
    for (let i = 0; i < length && start + i < out.length; i++) {
      out[start + i] = (out[start + i] ?? 0) + sample(i / sampleRate, i)
    }
  }

  for (let bar = 0; bar * 4 < spec.beats; bar++) {
    const [degree, minor] = PROGRESSIONS[spec.scale][bar % 4] ?? [0, false]
    const root = tonic + degree
    const chord = [root, root + (minor ? 3 : 4), root + 7]
    const barStart = at(bar * 4)
    const barLength = at(bar * 4 + 4) - barStart

    // Acordes: três notas com quatro harmônicos, envelope suave em cada compasso.
    add(barStart, barLength, (t) => {
      const env = Math.min(1, t / 0.05) * Math.min(1, (barLength / sampleRate - t) / 0.05)
      let sum = 0
      for (const note of chord) {
        const hz = midiHz(note)
        for (let h = 1; h <= 4; h++) sum += Math.sin(2 * Math.PI * hz * h * t) / h
      }
      return 0.04 * env * sum
    })

    for (let beat = bar * 4; beat < Math.min(spec.beats, bar * 4 + 4); beat++) {
      if (beat < intro) continue
      const start = at(beat)
      // Bumbo.
      add(start, Math.round(sampleRate * 0.15), (t) => {
        const phase = 2 * Math.PI * (50 * t + (100 / 40) * (1 - Math.exp(-t * 40)))
        return 0.7 * Math.sin(phase) * Math.exp(-t * 25)
      })
      const off = at(beat + 0.5)
      // Baixo no contratempo, na fundamental do acorde, duas oitavas abaixo.
      const bassHz = midiHz(root - 24)
      add(off, Math.round(sampleRate * beatSeconds * 0.45), (t) => {
        const env = Math.min(1, t / 0.005) * Math.exp(-t * 6)
        return (
          0.25 *
          env *
          (Math.sin(2 * Math.PI * bassHz * t) + 0.3 * Math.sin(4 * Math.PI * bassHz * t))
        )
      })
      // Chimbal: ruído com derivada (passa-altas) e decaimento rápido.
      let previous = 0
      add(off, Math.round(sampleRate * 0.04), (t) => {
        const noise = random() * 2 - 1
        const high = noise - previous
        previous = noise
        return 0.08 * high * Math.exp(-t * 90)
      })
    }
  }
  return out
}
