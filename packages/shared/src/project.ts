// SPDX-License-Identifier: AGPL-3.0-or-later
// Criação, validação, migração e contas do projeto: duração de grupos, linha do tempo do set e
// tracklist. Nada aqui toca áudio.
import {
  SCHEMA_VERSION,
  type Beat,
  type Channel,
  type Group,
  type LaneKind,
  type Project,
  type Track,
} from './model.ts'
import { beatsToSeconds } from './tempo.ts'

export class ProjectFormatError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'ProjectFormatError'
  }
}

export function createProject(name = 'Novo projeto'): Project {
  return { schemaVersion: SCHEMA_VERSION, name, tracks: [], groups: [] }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

/** Lê o JSON de um projeto, migrando versões antigas e validando a estrutura. */
export function parseProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    throw new ProjectFormatError('$', `JSON inválido (${String(error)})`)
  }
  return validateProject(migrateProject(raw))
}

/**
 * Leva um projeto de qualquer versão conhecida até SCHEMA_VERSION. A v1 é a primeira; cada
 * versão nova acrescenta aqui um passo `vN -> vN+1`.
 */
export function migrateProject(raw: unknown): unknown {
  const version = isObject(raw) ? raw.schemaVersion : undefined
  if (version === SCHEMA_VERSION) return raw
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      '$.schemaVersion',
      `o projeto é da versão ${version}, mais nova que esta (${SCHEMA_VERSION}); atualize o app`,
    )
  }
  throw new ProjectFormatError('$.schemaVersion', `versão desconhecida: ${String(version)}`)
}

const LANE_KINDS: LaneKind[] = [
  'volume',
  'eq.low',
  'eq.mid',
  'eq.high',
  'filter',
  'fx.send',
  'loop',
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Confere tipos e referências (canais apontam para faixas existentes, transições para canais). */
export function validateProject(raw: unknown): Project {
  const check = (ok: boolean, path: string, message: string) => {
    if (!ok) throw new ProjectFormatError(path, message)
  }
  const obj = (value: unknown, path: string) => {
    check(isObject(value), path, 'deveria ser um objeto')
    return value as Record<string, unknown>
  }
  const arr = (value: unknown, path: string) => {
    check(Array.isArray(value), path, 'deveria ser uma lista')
    return value as unknown[]
  }
  const str = (value: unknown, path: string) => {
    check(typeof value === 'string', path, 'deveria ser um texto')
    return value as string
  }
  const num = (value: unknown, path: string, min = -Infinity) => {
    check(
      typeof value === 'number' && Number.isFinite(value) && value >= min,
      path,
      `deveria ser um número >= ${min}`,
    )
    return value as number
  }

  const p = obj(raw, '$')
  str(p.name, '$.name')
  const trackIds = new Set<string>()
  arr(p.tracks, '$.tracks').forEach((value, i) => {
    const path = `$.tracks[${i}]`
    const t = obj(value, path)
    trackIds.add(str(t.id, `${path}.id`))
    str(t.path, `${path}.path`)
    str(t.hash, `${path}.hash`)
    str(t.title, `${path}.title`)
    str(t.artist, `${path}.artist`)
    num(t.durationSeconds, `${path}.durationSeconds`, 0)
    const grid = obj(t.grid, `${path}.grid`)
    num(grid.bpm, `${path}.grid.bpm`, 1)
    num(grid.firstBeatSeconds, `${path}.grid.firstBeatSeconds`, 0)
    check(t.key === null || isObject(t.key), `${path}.key`, 'deveria ser um objeto ou null')
    arr(t.cues, `${path}.cues`).forEach((cue, j) => {
      const c = obj(cue, `${path}.cues[${j}]`)
      str(c.id, `${path}.cues[${j}].id`)
      num(c.beat, `${path}.cues[${j}].beat`)
      str(c.label, `${path}.cues[${j}].label`)
    })
    check(
      typeof t.gridEditedByUser === 'boolean',
      `${path}.gridEditedByUser`,
      'deveria ser true ou false',
    )
  })
  arr(p.groups, '$.groups').forEach((value, i) => {
    const path = `$.groups[${i}]`
    const g = obj(value, path)
    str(g.id, `${path}.id`)
    str(g.name, `${path}.name`)
    num(g.bpm, `${path}.bpm`, 1)
    check(typeof g.keyLock === 'boolean', `${path}.keyLock`, 'deveria ser true ou false')
    check(
      g.eq === 'isolator' || g.eq === 'shelving',
      `${path}.eq`,
      'deveria ser isolator ou shelving',
    )
    const channelIds = new Set<string>()
    arr(g.channels, `${path}.channels`).forEach((channel, j) => {
      const cp = `${path}.channels[${j}]`
      const c = obj(channel, cp)
      channelIds.add(str(c.id, `${cp}.id`))
      check(trackIds.has(str(c.trackId, `${cp}.trackId`)), `${cp}.trackId`, 'faixa inexistente')
      const clip = obj(c.clip, `${cp}.clip`)
      const inBeat = num(clip.inBeat, `${cp}.clip.inBeat`)
      num(clip.outBeat, `${cp}.clip.outBeat`, inBeat)
      num(clip.startBeat, `${cp}.clip.startBeat`)
      arr(c.lanes, `${cp}.lanes`).forEach((lane, k) => {
        const lp = `${cp}.lanes[${k}]`
        const l = obj(lane, lp)
        check(LANE_KINDS.includes(l.kind as LaneKind), `${lp}.kind`, 'tipo de lane desconhecido')
        arr(l.points, `${lp}.points`).forEach((point, m) => {
          const pt = obj(point, `${lp}.points[${m}]`)
          num(pt.beat, `${lp}.points[${m}].beat`)
          num(pt.value, `${lp}.points[${m}].value`)
          check(
            ['linear', 'exp', 'hold', 's-curve'].includes(pt.curve as string),
            `${lp}.points[${m}].curve`,
            'curva desconhecida',
          )
        })
      })
    })
    arr(g.transitions, `${path}.transitions`).forEach((transition, j) => {
      const tp = `${path}.transitions[${j}]`
      const t = obj(transition, tp)
      str(t.id, `${tp}.id`)
      check(
        channelIds.has(str(t.fromChannelId, `${tp}.fromChannelId`)),
        `${tp}.fromChannelId`,
        'canal inexistente',
      )
      check(
        channelIds.has(str(t.toChannelId, `${tp}.toChannelId`)),
        `${tp}.toChannelId`,
        'canal inexistente',
      )
      num(t.startBeat, `${tp}.startBeat`)
      num(t.lengthBeats, `${tp}.lengthBeats`, 0)
      str(t.preset, `${tp}.preset`)
    })
  })
  return raw as Project
}

/** Batida do grupo em que o clip para de tocar. */
export function channelEndBeat(channel: Channel): Beat {
  return channel.clip.startBeat + channel.clip.outBeat - channel.clip.inBeat
}

/** Fim do grupo: a última batida em que algum canal ainda toca (0 se vazio). */
export function groupEndBeat(group: Group): Beat {
  return group.channels.reduce((end, channel) => Math.max(end, channelEndBeat(channel)), 0)
}

export function groupDurationSeconds(group: Group): number {
  return beatsToSeconds(groupEndBeat(group), group.bpm)
}

export interface SetSegment {
  group: Group
  startSeconds: number
  durationSeconds: number
}

/** Os grupos em sequência: cada um começa quando o anterior termina. */
export function setTimeline(project: Project): SetSegment[] {
  let start = 0
  return project.groups.map((group) => {
    const segment = { group, startSeconds: start, durationSeconds: groupDurationSeconds(group) }
    start += segment.durationSeconds
    return segment
  })
}

export interface TracklistEntry {
  seconds: number
  track: Track
}

/**
 * Uma entrada por faixa, no momento em que ela entra no set. Uma faixa que continua de um grupo
 * para o seguinte não se repete.
 */
export function tracklist(project: Project): TracklistEntry[] {
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const entries: TracklistEntry[] = []
  let previous: string | undefined
  for (const segment of setTimeline(project)) {
    const channels = [...segment.group.channels].sort((a, b) => a.clip.startBeat - b.clip.startBeat)
    for (const channel of channels) {
      const track = tracks.get(channel.trackId)
      if (!track || track.id === previous) continue
      entries.push({
        seconds: segment.startSeconds + beatsToSeconds(channel.clip.startBeat, segment.group.bpm),
        track,
      })
      previous = track.id
    }
  }
  return entries
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function tracklistText(project: Project): string {
  return tracklist(project)
    .map(({ seconds, track }) => {
      const name = track.artist ? `${track.artist} - ${track.title}` : track.title
      return `${formatTimestamp(seconds)} ${name}`
    })
    .join('\n')
    .concat('\n')
}
