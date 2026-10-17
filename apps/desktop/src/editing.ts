// SPDX-License-Identifier: AGPL-3.0-or-later
// Operações de edição do projeto, puras (recebem e devolvem objetos novos), usadas pela interface.
import {
  applyPreset,
  EDITABLE_LANES,
  mergeLanes,
  channelEndBeat,
  groupEndBeat,
  newId,
  secondsToBeats,
  type Beat,
  type Beatgrid,
  type Channel,
  type Cue,
  type Curve,
  type EditableLaneKind,
  type Group,
  type MusicalKey,
  type Point,
  type PresetName,
  type Project,
  type Track,
  type Transition,
} from '@djmixer/shared'
import type { LibraryEntry } from '../host/api.ts'

export const DEFAULT_TRANSITION_BEATS = 32
export const DEFAULT_PRESET: PresetName = 'blend'
/** Acima deste ajuste de tempo o app avisa que a qualidade pode cair (testado até 8% no spike 3). */
export const STRETCH_WARNING = 0.08

export const LANE_LABELS: Record<EditableLaneKind, string> = {
  volume: 'Volume',
  'eq.low': 'EQ grave',
  'eq.mid': 'EQ médio',
  'eq.high': 'EQ agudo',
  filter: 'Filtro',
}

export const CURVES: Curve[] = ['linear', 's-curve', 'exp', 'hold']
export const CURVE_LABELS: Record<Curve, string> = {
  linear: 'linear',
  's-curve': 'curva S',
  exp: 'exponencial',
  hold: 'degrau',
}

export function trackIdFor(hash: string): string {
  return `t_${hash.slice(0, 16)}`
}

/** Beatgrid em uso: a correção do usuário, senão a análise. */
export function entryGrid(entry: LibraryEntry): Beatgrid | null {
  return entry.edits.grid ?? entry.analysis?.grid ?? null
}

export function trackFromEntry(entry: LibraryEntry): Track | null {
  const grid = entryGrid(entry)
  if (!grid) return null
  return {
    id: trackIdFor(entry.hash),
    path: entry.path,
    hash: entry.hash,
    title: entry.title,
    artist: entry.artist,
    durationSeconds: entry.durationSeconds,
    grid: { ...grid },
    key: (entry.analysis?.key as MusicalKey | null | undefined) ?? null,
    cues: entry.edits.cues.map((cue) => ({ ...cue })),
    gridEditedByUser: entry.edits.grid !== null,
  }
}

/** Quantas batidas a faixa tem da primeira batida até o fim do arquivo. */
export function trackBeats(track: Pick<Track, 'grid' | 'durationSeconds'>): Beat {
  return secondsToBeats(track.durationSeconds - track.grid.firstBeatSeconds, track.grid.bpm)
}

export function snapBeat(beat: Beat, snap: 'bar' | 'beat' | 'off'): Beat {
  if (snap === 'bar') return Math.round(beat / 4) * 4
  if (snap === 'beat') return Math.round(beat)
  return Math.round(beat * 100) / 100
}

export function createGroup(project: Project, name: string, bpm = 124): [Project, Group] {
  const group: Group = {
    id: newId('g'),
    name,
    bpm,
    keyLock: true,
    eq: 'isolator',
    channels: [],
    transitions: [],
  }
  return [{ ...project, groups: [...project.groups, group] }, group]
}

/** Garante a faixa no projeto, com a grade e as cues da biblioteca. */
export function ensureTrack(project: Project, entry: LibraryEntry): [Project, Track] {
  const existing = project.tracks.find((track) => track.hash === entry.hash)
  if (existing) return [project, existing]
  const track = trackFromEntry(entry)
  if (!track) throw new Error(`"${entry.title}" ainda não foi analisada.`)
  return [{ ...project, tracks: [...project.tracks, track] }, track]
}

/**
 * Põe a faixa num canal novo no fim do grupo. Ela entra `DEFAULT_TRANSITION_BEATS` antes do fim
 * do último canal, com uma transição Blend já gerada; num grupo vazio, começa na batida 0 e o
 * BPM do grupo passa a ser o da faixa.
 */
export function addTrackToGroup(
  project: Project,
  groupId: string,
  entry: LibraryEntry,
): { project: Project; channelId: string; transitionId: string | null } {
  const [withTrack, track] = ensureTrack(project, entry)
  const group = withTrack.groups.find((candidate) => candidate.id === groupId)
  if (!group) throw new Error('grupo inexistente')
  const beats = Math.max(4, Math.floor(trackBeats(track) / 4) * 4)
  const last = [...group.channels].sort((a, b) => channelEndBeat(b) - channelEndBeat(a))[0]
  const overlap = last
    ? Math.min(DEFAULT_TRANSITION_BEATS, beats, last.clip.outBeat - last.clip.inBeat)
    : 0
  const startBeat = last ? Math.max(0, snapBeat(channelEndBeat(last) - overlap, 'bar')) : 0
  let channel: Channel = {
    id: newId('c'),
    trackId: track.id,
    clip: { inBeat: continueFrom(withTrack, group, track.id, beats), outBeat: beats, startBeat },
    lanes: [],
  }
  let next: Group = {
    ...group,
    bpm: group.channels.length === 0 ? Math.round(track.grid.bpm * 100) / 100 : group.bpm,
    channels: [...group.channels, channel],
  }
  let transitionId: string | null = null
  if (last && overlap > 0) {
    const transition: Transition = {
      id: newId('tr'),
      fromChannelId: last.id,
      toChannelId: channel.id,
      startBeat,
      lengthBeats: channelEndBeat(last) - startBeat,
      preset: DEFAULT_PRESET,
    }
    next = applyTransition({ ...next, transitions: [...next.transitions, transition] }, transition)
    channel = next.channels.find((candidate) => candidate.id === channel.id) ?? channel
    transitionId = transition.id
  }
  return {
    project: { ...withTrack, groups: withTrack.groups.map((g) => (g.id === groupId ? next : g)) },
    channelId: channel.id,
    transitionId,
  }
}

/**
 * Num grupo vazio, uma faixa que fechava o grupo anterior continua de onde parou lá, para o set
 * não repetir o trecho. Se não sobrar pelo menos um compasso, começa do início.
 */
function continueFrom(project: Project, group: Group, trackId: string, beats: Beat): Beat {
  if (group.channels.length > 0) return 0
  const index = project.groups.findIndex((candidate) => candidate.id === group.id)
  const previous = project.groups[index - 1]
  const last = previous?.channels.reduce<Channel | undefined>(
    (best, channel) => (!best || channelEndBeat(channel) > channelEndBeat(best) ? channel : best),
    undefined,
  )
  if (!last || last.trackId !== trackId || last.clip.outBeat > beats - 4) return 0
  return last.clip.outBeat
}

/**
 * Gera de novo as lanes dos dois canais da transição a partir do preset dela. Com `previous`
 * (a mesma transição antes de mudar a janela), limpa antes os pontos da janela antiga.
 */
export function applyTransition(
  group: Group,
  transition: Transition,
  previous?: Transition,
): Group {
  if (previous) group = clearWindow(group, previous)
  const from = group.channels.find((channel) => channel.id === transition.fromChannelId)
  const to = group.channels.find((channel) => channel.id === transition.toChannelId)
  if (!from || !to) return group
  const [a, b] = applyPreset(
    transition.preset,
    from,
    to,
    transition.startBeat,
    transition.lengthBeats,
  )
  return {
    ...group,
    channels: group.channels.map((channel) =>
      channel.id === a.id ? a : channel.id === b.id ? b : channel,
    ),
    transitions: group.transitions.map((candidate) =>
      candidate.id === transition.id ? transition : candidate,
    ),
  }
}

function clearWindow(group: Group, transition: Transition): Group {
  const end = transition.startBeat + transition.lengthBeats
  const empty = Object.fromEntries(EDITABLE_LANES.map((kind) => [kind, []]))
  return {
    ...group,
    channels: group.channels.map((channel) =>
      channel.id === transition.fromChannelId || channel.id === transition.toChannelId
        ? { ...channel, lanes: mergeLanes(channel.lanes, empty, transition.startBeat, end) }
        : channel,
    ),
  }
}

export function addTransition(
  group: Group,
  fromChannelId: string,
  toChannelId: string,
): [Group, Transition] {
  const from = group.channels.find((channel) => channel.id === fromChannelId)
  const to = group.channels.find((channel) => channel.id === toChannelId)
  if (!from || !to) throw new Error('canal inexistente')
  const overlapStart = Math.max(from.clip.startBeat, to.clip.startBeat)
  const overlapEnd = Math.min(channelEndBeat(from), channelEndBeat(to))
  const length = overlapEnd > overlapStart ? overlapEnd - overlapStart : DEFAULT_TRANSITION_BEATS
  const transition: Transition = {
    id: newId('tr'),
    fromChannelId,
    toChannelId,
    startBeat: overlapEnd > overlapStart ? overlapStart : to.clip.startBeat,
    lengthBeats: length,
    preset: DEFAULT_PRESET,
  }
  return [
    applyTransition({ ...group, transitions: [...group.transitions, transition] }, transition),
    transition,
  ]
}

export function removeChannel(group: Group, channelId: string): Group {
  return {
    ...group,
    channels: group.channels.filter((channel) => channel.id !== channelId),
    transitions: group.transitions.filter(
      (transition) =>
        transition.fromChannelId !== channelId && transition.toChannelId !== channelId,
    ),
  }
}

export function updateChannel(
  group: Group,
  channelId: string,
  recipe: (channel: Channel) => Channel,
): Group {
  return {
    ...group,
    channels: group.channels.map((channel) =>
      channel.id === channelId ? recipe(channel) : channel,
    ),
  }
}

/** Move o clip inteiro, levando junto a automação dele. */
export function moveClip(group: Group, channelId: string, startBeat: Beat): Group {
  return updateChannel(group, channelId, (channel) => {
    const delta = startBeat - channel.clip.startBeat
    if (delta === 0) return channel
    return {
      ...channel,
      clip: { ...channel.clip, startBeat },
      lanes: channel.lanes.map((lane) => ({
        ...lane,
        points: lane.points.map((point) => ({ ...point, beat: point.beat + delta })),
      })),
    }
  })
}

/**
 * Apara o começo ou o fim do clip numa batida do grupo. Aparar o começo mantém o resto do
 * clip no lugar (muda `inBeat` e `startBeat` juntos).
 */
export function trimClip(
  group: Group,
  channelId: string,
  edge: 'start' | 'end',
  groupBeat: Beat,
  maxOutBeat: Beat,
): Group {
  return updateChannel(group, channelId, (channel) => {
    const { inBeat, outBeat, startBeat } = channel.clip
    if (edge === 'end') {
      const out = Math.min(maxOutBeat, Math.max(inBeat + 1, groupBeat - startBeat + inBeat))
      return { ...channel, clip: { ...channel.clip, outBeat: out } }
    }
    const delta = Math.min(outBeat - inBeat - 1, groupBeat - startBeat)
    return { ...channel, clip: { inBeat: inBeat + delta, outBeat, startBeat: startBeat + delta } }
  })
}

export function lanePoints(channel: Channel, kind: EditableLaneKind): Point[] {
  return channel.lanes.find((lane) => lane.kind === kind)?.points ?? []
}

export function setLanePoints(channel: Channel, kind: EditableLaneKind, points: Point[]): Channel {
  const sorted = [...points].sort((a, b) => a.beat - b.beat)
  const exists = channel.lanes.some((lane) => lane.kind === kind)
  return {
    ...channel,
    lanes: exists
      ? channel.lanes.map((lane) => (lane.kind === kind ? { ...lane, points: sorted } : lane))
      : [...channel.lanes, { kind, points: sorted }],
  }
}

export function nextCurve(curve: Curve): Curve {
  return CURVES[(CURVES.indexOf(curve) + 1) % CURVES.length] ?? 'linear'
}

/** Aplica uma correção de beatgrid e cues a todas as faixas do projeto com esse hash. */
export function applyGridEdit(
  project: Project,
  hash: string,
  grid: Beatgrid,
  cues: Cue[],
  editedByUser: boolean,
): Project {
  if (!project.tracks.some((track) => track.hash === hash)) return project
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.hash === hash ? { ...track, grid, cues, gridEditedByUser: editedByUser } : track,
    ),
  }
}

/** Grupos: renomear, mover na ordem do set e remover. */
export function moveGroup(project: Project, groupId: string, delta: -1 | 1): Project {
  const index = project.groups.findIndex((group) => group.id === groupId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= project.groups.length) return project
  const groups = [...project.groups]
  const [group] = groups.splice(index, 1)
  if (group) groups.splice(target, 0, group)
  return { ...project, groups }
}

/** Faixas que nenhum grupo usa mais saem do projeto (continuam na biblioteca). */
export function pruneTracks(project: Project): Project {
  const used = new Set(project.groups.flatMap((g) => g.channels.map((c) => c.trackId)))
  const tracks = project.tracks.filter((track) => used.has(track.id))
  return tracks.length === project.tracks.length ? project : { ...project, tracks }
}

export function groupLengthBeats(group: Group): Beat {
  return groupEndBeat(group)
}

/** Formata uma batida do grupo como compasso.batida, começando em 1.1. */
export function formatBarBeat(beat: Beat): string {
  const whole = Math.floor(beat + 1e-6)
  return `${Math.floor(whole / 4) + 1}.${(whole % 4) + 1}`
}
