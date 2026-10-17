// SPDX-License-Identifier: AGPL-3.0-or-later
// Rascunho do modelo de dados de docs/escopo.md. Todo tempo é medido em beats.
// O schema v1 é congelado na ponte para a fase 1; até lá estes tipos podem mudar.

export const SCHEMA_VERSION = 1

export type Beat = number

export interface Track {
  id: string
  path: string
  hash: string
  bpm: number
  key: string
  beatgrid: Beat[]
  cues: Beat[]
}

export type LaneKind = 'volume' | 'eq.low' | 'eq.mid' | 'eq.high' | 'filter' | 'fx.send' | 'loop'

export type Curve = 'linear' | 'exp' | 'hold' | 's-curve'

export interface Point {
  beat: Beat
  value: number
  curve: Curve
}

export interface Lane {
  kind: LaneKind
  points: Point[]
}

export interface Clip {
  trackId: string
  inBeat: Beat
  outBeat: Beat
  startBeat: Beat
  stretch: number
}

export interface Channel {
  id: string
  clip: Clip
  lanes: Lane[]
}

export interface TempoMap {
  bpm: number
}

export interface Group {
  id: string
  name: string
  tempo: TempoMap
  channels: Channel[]
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION
  library: Track[]
  groups: Group[]
}
