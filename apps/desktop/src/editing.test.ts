// SPDX-License-Identifier: AGPL-3.0-or-later
import { channelEndBeat, createProject, type Project } from '@djmixer/shared'
import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../host/api.ts'
import {
  addTrackToGroup,
  applyTransition,
  createGroup,
  lanePoints,
  moveClip,
  snapBeat,
  trimClip,
} from './editing.ts'

const entry = (hash: string, bpm: number, seconds: number): LibraryEntry => ({
  hash,
  path: `/m/${hash}.mp3`,
  title: hash,
  artist: '',
  durationSeconds: seconds,
  analysis: {
    grid: { bpm, firstBeatSeconds: 0.5 },
    key: { note: 'A', scale: 'minor', camelot: '8A' },
    confidence: 1,
    analyzedAt: 0,
  },
  edits: { grid: null, cues: [] },
  missing: false,
})

function twoTracks(): { project: Project; groupId: string } {
  const [project, group] = createGroup(createProject(), 'G')
  // 120 BPM: 2 batidas por segundo; 60,5 s dão 120 batidas depois da primeira.
  let p = addTrackToGroup(project, group.id, entry('aaaa', 120, 60.5)).project
  p = addTrackToGroup(p, group.id, entry('bbbb', 126, 90)).project
  return { project: p, groupId: group.id }
}

describe('montagem do grupo', () => {
  it('a segunda faixa entra 8 compassos antes do fim da primeira, com Blend', () => {
    const { project } = twoTracks()
    const group = project.groups[0]
    if (!group) throw new Error('grupo')
    expect(group.bpm).toBe(120)
    const [a, b] = group.channels
    expect(a?.clip).toEqual({ inBeat: 0, outBeat: 120, startBeat: 0 })
    expect(b?.clip.startBeat).toBe(88)
    expect(group.transitions[0]).toMatchObject({ startBeat: 88, lengthBeats: 32, preset: 'blend' })
    expect(lanePoints(a ?? b!, 'eq.low').length).toBeGreaterThan(0)
  })

  it('mover o clip leva a automação junto', () => {
    const { project } = twoTracks()
    const group = project.groups[0]!
    const b = group.channels[1]!
    const moved = moveClip(group, b.id, 96).channels[1]!
    expect(moved.clip.startBeat).toBe(96)
    expect(lanePoints(moved, 'volume')[0]?.beat).toBe((lanePoints(b, 'volume')[0]?.beat ?? 0) + 8)
  })

  it('aparar o começo mantém o resto no lugar', () => {
    const { project } = twoTracks()
    const group = project.groups[0]!
    const b = group.channels[1]!
    const trimmed = trimClip(group, b.id, 'start', 104, 999).channels[1]!
    expect(trimmed.clip.startBeat).toBe(104)
    expect(trimmed.clip.inBeat).toBe(16)
    expect(channelEndBeat(trimmed)).toBe(channelEndBeat(b))
  })

  it('mudar a janela limpa os pontos da janela antiga', () => {
    const { project } = twoTracks()
    const group = project.groups[0]!
    const transition = group.transitions[0]!
    const next = applyTransition(
      group,
      { ...transition, startBeat: 72, lengthBeats: 16 },
      transition,
    )
    const beats = lanePoints(next.channels[0]!, 'eq.low').map((p) => p.beat)
    expect(beats.every((beat) => beat >= 72 && beat <= 88)).toBe(true)
  })

  it('no grupo seguinte, a faixa que fechava o anterior continua de onde parou', () => {
    const [project, group] = createGroup(createProject(), 'G1')
    let p = addTrackToGroup(project, group.id, entry('aaaa', 120, 200)).project
    const g1 = p.groups[0]!
    p = {
      ...p,
      groups: [
        {
          ...g1,
          channels: [{ ...g1.channels[0]!, clip: { inBeat: 0, outBeat: 64, startBeat: 0 } }],
        },
      ],
    }
    const [p2, g2] = createGroup(p, 'G2')
    const result = addTrackToGroup(p2, g2.id, entry('aaaa', 120, 200))
    expect(result.project.groups[1]?.channels[0]?.clip.inBeat).toBe(64)
  })

  it('snap', () => {
    expect(snapBeat(5.4, 'bar')).toBe(4)
    expect(snapBeat(5.6, 'beat')).toBe(6)
    expect(snapBeat(5.555, 'off')).toBe(5.56)
  })
})
