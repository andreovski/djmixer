// SPDX-License-Identifier: AGPL-3.0-or-later
// Transições feitas à mão para o spike 2. Os presets de verdade (que geram pontos editáveis)
// são da fase 1; aqui só servem para ouvir a automação.
import type { Lane, Point } from '@djmixer/shared'

export type TransitionName = 'none' | 'fade' | 'blend' | 'bass-swap' | 'filter-out'

export const TRANSITIONS: Record<TransitionName, string> = {
  none: 'Sem automação',
  fade: 'Fade',
  blend: 'Blend',
  'bass-swap': 'Bass swap',
  'filter-out': 'Filter out',
}

const p = (beat: number, value: number, curve: Point['curve'] = 'linear'): Point => ({
  beat,
  value,
  curve,
})

/** Lanes de A (sai) e B (entra) para uma transição de `length` beats a partir de `entry`. */
export function transitionLanes(
  name: TransitionName,
  entry: number,
  length: number,
): [Lane[], Lane[]] {
  const at = (fraction: number) => entry + length * fraction
  switch (name) {
    case 'none':
      return [[], []]
    case 'fade':
      return [
        [{ kind: 'volume', points: [p(at(0), 1), p(at(1), 0)] }],
        [{ kind: 'volume', points: [p(at(0), 0), p(at(1), 1)] }],
      ]
    case 'blend':
      return [
        [
          { kind: 'eq.low', points: [p(at(0), 0.5, 'hold'), p(at(0.75), 0)] },
          { kind: 'volume', points: [p(at(0.75), 1, 's-curve'), p(at(1), 0)] },
        ],
        [
          { kind: 'volume', points: [p(at(0), 0, 's-curve'), p(at(0.5), 1)] },
          { kind: 'eq.low', points: [p(at(0), 0, 'hold'), p(at(0.75), 0.5)] },
        ],
      ]
    case 'bass-swap':
      return [
        [
          { kind: 'eq.low', points: [p(at(0), 0.5, 'hold'), p(at(0.5), 0)] },
          { kind: 'volume', points: [p(at(0.5), 1), p(at(1), 0)] },
        ],
        [{ kind: 'eq.low', points: [p(at(0), 0, 'hold'), p(at(0.5), 0.5)] }],
      ]
    case 'filter-out':
      return [
        [
          { kind: 'filter', points: [p(at(0), 0.5, 'exp'), p(at(1), 0.08)] },
          { kind: 'volume', points: [p(at(0.75), 1), p(at(1), 0)] },
        ],
        [
          { kind: 'volume', points: [p(at(0), 0), p(at(0.25), 1)] },
          { kind: 'filter', points: [p(at(0), 0.85), p(at(0.5), 0.5)] },
        ],
      ]
  }
}
