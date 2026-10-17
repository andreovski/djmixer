// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Beat, Lane, LaneKind, Point } from '@djmixer/shared'

/** Valor neutro de cada lane: volume no máximo, EQ em 0 dB, filtro desligado. */
export const NEUTRAL: Record<LaneKind, number> = {
  volume: 1,
  'eq.low': 0.5,
  'eq.mid': 0.5,
  'eq.high': 0.5,
  filter: 0.5,
  'fx.send': 0,
  loop: 0,
}

/**
 * Valor da lane num beat. Antes do primeiro ponto vale o primeiro; depois do último, o último.
 * Entre dois pontos, a curva do ponto da esquerda define a forma do trecho.
 */
export function laneValueAt(points: Point[], beat: Beat, neutral: number): number {
  const first = points[0]
  if (!first) return neutral
  if (beat <= first.beat) return first.value
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Point
    const b = points[i + 1] as Point
    if (beat < b.beat) {
      const t = (beat - a.beat) / (b.beat - a.beat)
      return a.value + (b.value - a.value) * shape(a.curve, t)
    }
  }
  return (points[points.length - 1] as Point).value
}

function shape(curve: Point['curve'], t: number): number {
  switch (curve) {
    case 'linear':
      return t
    case 'exp':
      return t * t
    case 's-curve':
      return (1 - Math.cos(Math.PI * t)) / 2
    case 'hold':
      return 0
  }
}

/** Ordena os pontos e devolve a lane do tipo pedido, ou nenhuma. */
export function findLane(lanes: Lane[] | undefined, kind: LaneKind): Point[] | undefined {
  const lane = lanes?.find((candidate) => candidate.kind === kind)
  return lane && [...lane.points].sort((a, b) => a.beat - b.beat)
}

/**
 * Amostra uma lane entre dois beats, já convertida pelo `map` do parâmetro de destino,
 * para `AudioParam.setValueCurveAtTime`. A densidade alta evita degraus audíveis (zipper).
 */
export function sampleLane(
  points: Point[] | undefined,
  neutral: number,
  fromBeat: Beat,
  toBeat: Beat,
  steps: number,
  map: (value: number) => number,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(Math.max(2, steps))
  const span = toBeat - fromBeat
  for (let i = 0; i < curve.length; i++) {
    const beat = fromBeat + (span * i) / (curve.length - 1)
    curve[i] = map(points ? laneValueAt(points, beat, neutral) : neutral)
  }
  return curve
}
