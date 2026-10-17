// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { Channel, Group, Project, Track } from './model.ts'
import {
  createProject,
  formatTimestamp,
  groupEndBeat,
  parseProject,
  ProjectFormatError,
  serializeProject,
  setTimeline,
  tracklistText,
} from './project.ts'
import { applyPreset } from './presets.ts'

const track = (id: string, title: string): Track => ({
  id,
  path: `/musicas/${title}.mp3`,
  hash: id.repeat(8),
  title,
  artist: 'Artista',
  durationSeconds: 400,
  grid: { bpm: 124, firstBeatSeconds: 0.1 },
  key: { note: 'A', scale: 'minor', camelot: '8A' },
  cues: [],
  gridEditedByUser: false,
})

const channel = (id: string, trackId: string, startBeat: number, beats: number): Channel => ({
  id,
  trackId,
  clip: { inBeat: 0, outBeat: beats, startBeat },
  lanes: [],
})

function sample(): Project {
  const project = createProject('Set de teste')
  project.tracks = [track('t1', 'Um'), track('t2', 'Dois'), track('t3', 'Três')]
  const group = (id: string, bpm: number, channels: Channel[]): Group => ({
    id,
    name: id,
    bpm,
    keyLock: true,
    eq: 'isolator',
    channels,
    transitions: [],
  })
  project.groups = [
    group('g1', 120, [channel('c1', 't1', 0, 128), channel('c2', 't2', 96, 160)]),
    group('g2', 125, [channel('c3', 't2', 0, 64), channel('c4', 't3', 32, 128)]),
  ]
  return project
}

describe('projeto', () => {
  it('salva e abre de volta sem perder nada', () => {
    const project = sample()
    expect(parseProject(serializeProject(project))).toEqual(project)
  })

  it('aponta o caminho do erro', () => {
    const project = sample() as unknown as { groups: { channels: { trackId: string }[] }[] }
    const first = project.groups[0]?.channels[0]
    if (first) first.trackId = 'nao-existe'
    expect(() => parseProject(JSON.stringify(project))).toThrow(
      new ProjectFormatError('$.groups[0].channels[0].trackId', 'faixa inexistente'),
    )
  })

  it('recusa versões mais novas', () => {
    expect(() => parseProject(JSON.stringify({ ...sample(), schemaVersion: 2 }))).toThrow(
      /mais nova/,
    )
  })

  it('encadeia os grupos e monta a tracklist', () => {
    const project = sample()
    const [g1, g2] = project.groups
    if (!g1 || !g2) throw new Error('grupos')
    expect(groupEndBeat(g1)).toBe(256)
    const timeline = setTimeline(project)
    expect(timeline[0]?.durationSeconds).toBeCloseTo(128)
    expect(timeline[1]?.startSeconds).toBeCloseTo(128)
    // Dois continua no segundo grupo e não se repete; Três entra 32 batidas a 125 BPM depois.
    expect(tracklistText(project)).toBe(
      '0:00 Artista - Um\n0:48 Artista - Dois\n2:23 Artista - Três\n',
    )
  })

  it('formata horas', () => {
    expect(formatTimestamp(3725)).toBe('1:02:05')
  })
})

describe('presets', () => {
  it('gera pontos só na janela e preserva o resto', () => {
    const a = channel('a', 't1', 0, 128)
    a.lanes = [
      {
        kind: 'volume',
        points: [
          { beat: 10, value: 0.8, curve: 'linear' },
          { beat: 70, value: 0.2, curve: 'linear' },
        ],
      },
    ]
    const b = channel('b', 't2', 64, 128)
    const [from, to] = applyPreset('blend', a, b, 64, 32)
    const volume = from.lanes.find((lane) => lane.kind === 'volume')?.points ?? []
    expect(volume.map((point) => point.beat)).toEqual([10, 88, 96])
    expect(to.lanes.find((lane) => lane.kind === 'eq.low')?.points).toEqual([
      { beat: 64, value: 0, curve: 'hold' },
      { beat: 88, value: 0.5, curve: 'linear' },
    ])
  })

  it('um preset novo limpa as lanes do anterior na janela', () => {
    const [a, b] = applyPreset(
      'blend',
      channel('a', 't1', 0, 128),
      channel('b', 't2', 64, 128),
      64,
      32,
    )
    const [from] = applyPreset('fade', a, b, 64, 32)
    expect(from.lanes.find((lane) => lane.kind === 'eq.low')?.points).toEqual([])
  })
})
