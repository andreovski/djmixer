// SPDX-License-Identifier: AGPL-3.0-or-later
// Schema v1 do projeto (docs/escopo.md, "Modelo de dados"). Todo tempo de mix é medido em beats;
// segundos só aparecem no beatgrid de cada faixa, que liga o arquivo de áudio às batidas.
// Mudanças incompatíveis sobem SCHEMA_VERSION e ganham uma migração em project.ts.

export const SCHEMA_VERSION = 1

export type Beat = number

export type NoteName = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B'
export type Scale = 'major' | 'minor'

export interface MusicalKey {
  note: NoteName
  scale: Scale
  /** Notação Camelot, como 8A. */
  camelot: string
}

/** Grade de BPM constante: a batida 0 cai em `firstBeatSeconds` do arquivo. */
export interface Beatgrid {
  bpm: number
  firstBeatSeconds: number
}

export interface Cue {
  id: string
  /** Batida da faixa (na grade da própria faixa). */
  beat: Beat
  label: string
}

export interface Track {
  id: string
  /** Caminho absoluto no momento em que foi importada; o hash acha o arquivo se ele mudar de lugar. */
  path: string
  /** SHA-256 do conteúdo do arquivo. */
  hash: string
  title: string
  artist: string
  durationSeconds: number
  grid: Beatgrid
  key: MusicalKey | null
  cues: Cue[]
  /** O usuário corrigiu a grade; uma nova análise não a sobrescreve. */
  gridEditedByUser: boolean
}

export type LaneKind = 'volume' | 'eq.low' | 'eq.mid' | 'eq.high' | 'filter' | 'fx.send' | 'loop'

/** Lanes editáveis na fase 1; `fx.send` e `loop` ficam para a fase 2. */
export const EDITABLE_LANES = ['volume', 'eq.low', 'eq.mid', 'eq.high', 'filter'] as const
export type EditableLaneKind = (typeof EDITABLE_LANES)[number]

export type Curve = 'linear' | 'exp' | 'hold' | 's-curve'

export interface Point {
  /** Batida do grupo. */
  beat: Beat
  /** De 0 a 1; o neutro de cada lane está em `NEUTRAL` do motor. */
  value: number
  /** Forma do trecho que começa neste ponto. */
  curve: Curve
}

export interface Lane {
  kind: LaneKind
  points: Point[]
}

export interface Clip {
  /** Trecho da faixa, em batidas da grade da faixa. */
  inBeat: Beat
  outBeat: Beat
  /** Batida do grupo em que `inBeat` toca. */
  startBeat: Beat
}

export type EqMode = 'isolator' | 'shelving'

export interface Channel {
  id: string
  trackId: string
  clip: Clip
  lanes: Lane[]
}

export type PresetName = 'fade' | 'blend' | 'bass-swap' | 'slam' | 'none'

/** Janela de transição entre dois canais; o preset só gerou pontos nas lanes. */
export interface Transition {
  id: string
  fromChannelId: string
  toChannelId: string
  startBeat: Beat
  lengthBeats: Beat
  preset: PresetName
}

export interface Group {
  id: string
  name: string
  /** BPM do grupo; as faixas são esticadas para ele. Rampas de tempo ficam para depois. */
  bpm: number
  /** Key lock (time-stretch Rubber Band) ou varispeed (o tom acompanha o BPM). */
  keyLock: boolean
  eq: EqMode
  channels: Channel[]
  transitions: Transition[]
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION
  name: string
  tracks: Track[]
  /** A ordem da lista é a ordem do set; cada grupo começa quando o anterior termina. */
  groups: Group[]
}
