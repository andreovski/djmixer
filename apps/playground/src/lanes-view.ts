// SPDX-License-Identifier: AGPL-3.0-or-later
import { laneValueAt, NEUTRAL } from '@djmixer/engine'
import type { Lane, LaneKind } from '@djmixer/shared'

const COLORS: Partial<Record<LaneKind, string>> = {
  volume: '#3b82f6',
  'eq.low': '#ef4444',
  'eq.mid': '#f59e0b',
  'eq.high': '#10b981',
  filter: '#a855f7',
}

/** Desenha as lanes entre dois beats, com uma linha por compasso. */
export function drawLanes(
  canvas: HTMLCanvasElement,
  lanes: Lane[],
  from: number,
  to: number,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  const x = (beat: number) => ((beat - from) / (to - from)) * width
  const y = (value: number) => height - 4 - value * (height - 8)
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)'
  for (let bar = Math.ceil(from / 4) * 4; bar <= to; bar += 4) {
    ctx.beginPath()
    ctx.moveTo(x(bar), 0)
    ctx.lineTo(x(bar), height)
    ctx.stroke()
  }
  for (const lane of lanes) {
    const points = [...lane.points].sort((a, b) => a.beat - b.beat)
    ctx.strokeStyle = COLORS[lane.kind] ?? 'gray'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let px = 0; px <= width; px++) {
      const beat = from + (px / width) * (to - from)
      const value = laneValueAt(points, beat, NEUTRAL[lane.kind])
      if (px === 0) ctx.moveTo(px, y(value))
      else ctx.lineTo(px, y(value))
    }
    ctx.stroke()
  }
}

export const LEGEND = Object.entries(COLORS)
