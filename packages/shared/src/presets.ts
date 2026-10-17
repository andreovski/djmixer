// SPDX-License-Identifier: AGPL-3.0-or-later
// Presets de transição. Um preset só gera pontos nas lanes dos dois canais; depois de aplicado,
// os pontos são editáveis e o app não guarda nenhuma lógica escondida (docs/escopo.md).
import type { Beat, Channel, Curve, Lane, LaneKind, Point, PresetName } from './model.ts'

export const PRESETS: Record<PresetName, string> = {
  fade: 'Fade',
  blend: 'Blend',
  'bass-swap': 'Bass swap',
  slam: 'Slam',
  none: 'Sem transição (corte)',
}

const p = (beat: Beat, value: number, curve: Curve = 'linear'): Point => ({ beat, value, curve })

/** Pontos de A (sai) e B (entra) para uma janela de `length` batidas a partir de `start`. */
export function presetLanes(
  name: PresetName,
  start: Beat,
  length: Beat,
): [Partial<Record<LaneKind, Point[]>>, Partial<Record<LaneKind, Point[]>>] {
  const at = (fraction: number) => start + length * fraction
  switch (name) {
    case 'none':
      // Corte seco no fim da janela.
      return [
        { volume: [p(at(1), 1, 'hold'), p(at(1), 0)] },
        { volume: [p(at(0), 0, 'hold'), p(at(1), 1)] },
      ]
    case 'fade':
      return [
        { volume: [p(at(0), 1, 's-curve'), p(at(1), 0)] },
        { volume: [p(at(0), 0, 's-curve'), p(at(1), 1)] },
      ]
    case 'blend':
      return [
        {
          'eq.low': [p(at(0), 0.5, 'hold'), p(at(0.75), 0)],
          volume: [p(at(0.75), 1, 's-curve'), p(at(1), 0)],
        },
        {
          volume: [p(at(0), 0, 's-curve'), p(at(0.5), 1)],
          'eq.low': [p(at(0), 0, 'hold'), p(at(0.75), 0.5)],
        },
      ]
    case 'bass-swap':
      return [
        {
          'eq.low': [p(at(0), 0.5, 'hold'), p(at(0.5), 0)],
          volume: [p(at(0.5), 1, 's-curve'), p(at(1), 0)],
        },
        {
          volume: [p(at(0), 0, 's-curve'), p(at(0.25), 1)],
          'eq.low': [p(at(0), 0, 'hold'), p(at(0.5), 0.5)],
        },
      ]
    case 'slam':
      // A sobe o passa-altas e sai de uma vez no fim; B entra cheio, sem fade.
      return [
        {
          filter: [p(at(0), 0.5, 'exp'), p(at(1), 0.9)],
          volume: [p(at(1), 1, 'hold'), p(at(1), 0)],
        },
        { volume: [p(at(0), 0, 'hold'), p(at(1), 1)] },
      ]
  }
}

/**
 * Troca, nas lanes do canal, os pontos dentro de [start, end] pelos pontos gerados, mantendo o
 * que está fora da janela.
 */
export function mergeLanes(
  lanes: Lane[],
  generated: Partial<Record<LaneKind, Point[]>>,
  start: Beat,
  end: Beat,
): Lane[] {
  const result = lanes.map((lane) => ({ ...lane, points: [...lane.points] }))
  for (const [kind, points] of Object.entries(generated) as [LaneKind, Point[]][]) {
    let lane = result.find((candidate) => candidate.kind === kind)
    if (!lane) {
      lane = { kind, points: [] }
      result.push(lane)
    }
    lane.points = [
      ...lane.points.filter((point) => point.beat < start || point.beat > end),
      ...points,
    ].sort((a, b) => a.beat - b.beat)
  }
  return result
}

/** Aplica o preset aos dois canais e devolve as cópias atualizadas. */
export function applyPreset(
  name: PresetName,
  from: Channel,
  to: Channel,
  start: Beat,
  length: Beat,
): [Channel, Channel] {
  const [a, b] = presetLanes(name, start, length)
  // Limpa na janela as lanes que o preset controla em qualquer dos dois canais, para um preset
  // anterior não deixar sobras (um Blend seguido de Fade não pode manter o corte de grave).
  const touched = new Set<LaneKind>([
    ...(Object.keys(a) as LaneKind[]),
    ...(Object.keys(b) as LaneKind[]),
    'volume',
    'eq.low',
    'filter',
  ])
  const clear = (generated: Partial<Record<LaneKind, Point[]>>) => {
    const full: Partial<Record<LaneKind, Point[]>> = {}
    for (const kind of touched) full[kind] = generated[kind] ?? []
    return full
  }
  return [
    { ...from, lanes: mergeLanes(from.lanes, clear(a), start, start + length) },
    { ...to, lanes: mergeLanes(to.lanes, clear(b), start, start + length) },
  ]
}
