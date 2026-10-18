// SPDX-License-Identifier: AGPL-3.0-or-later
// Estado da interface (zustand). O projeto é imutável: cada edição troca o objeto e guarda o
// anterior no histórico de desfazer. Edições contínuas (arrastar um ponto) usam a mesma chave
// `coalesce` e viram um passo só.
import {
  createProject,
  type EditableLaneKind,
  type Group,
  type Project,
  type Track,
} from '@djmixer/shared'
import { create } from 'zustand'
import type { LibraryEntry } from '../host/api.ts'

export type AnalysisStatus = 'pending' | 'analyzing' | 'done' | 'error'
export type Snap = 'bar' | 'beat' | 'off'
export type Tool = 'clips' | 'automation'
export type PlaybackKind = 'group' | 'loop' | 'set'
/** Aba visível em tela compacta (celular, tablet em retrato). */
export type Pane = 'library' | 'set'

export interface Notice {
  kind: 'info' | 'error'
  text: string
}

export interface ExportProgress {
  label: string
  /** De 0 a 1. */
  fraction: number
}

export interface AppState {
  project: Project
  projectPath: string | null
  dirty: boolean
  past: Project[]
  future: Project[]
  lastCoalesce: string | null

  library: Record<string, LibraryEntry>
  analysis: Record<string, { status: AnalysisStatus; error?: string }>
  peaks: Record<string, Uint8Array>
  /** Faixas do projeto aberto que não foram achadas no disco (por hash). */
  missing: string[]

  groupId: string | null
  channelId: string | null
  transitionId: string | null
  /** Lane mostrada em cada canal. */
  laneByChannel: Record<string, EditableLaneKind>
  tool: Tool
  snap: Snap
  /** Batida do grupo onde "tocar o grupo" começa. */
  cursorBeat: number
  /** Faixa aberta no editor de beatgrid (hash). */
  gridEditor: string | null
  pane: Pane

  playing: PlaybackKind | null
  loading: boolean
  exporting: ExportProgress | null
  notice: Notice | null

  edit(recipe: (project: Project) => Project, coalesce?: string): void
  undo(): void
  redo(): void
  setProject(project: Project, path: string | null): void
  set(partial: Partial<AppState>): void
  notify(kind: Notice['kind'], text: string): void
}

const HISTORY_LIMIT = 200

export const useApp = create<AppState>((set, get) => ({
  project: createProject(),
  projectPath: null,
  dirty: false,
  past: [],
  future: [],
  lastCoalesce: null,

  library: {},
  analysis: {},
  peaks: {},
  missing: [],

  groupId: null,
  channelId: null,
  transitionId: null,
  laneByChannel: {},
  tool: 'clips',
  snap: 'bar',
  cursorBeat: 0,
  gridEditor: null,
  pane: 'library',

  playing: null,
  loading: false,
  exporting: null,
  notice: null,

  edit(recipe, coalesce) {
    const { project, past, lastCoalesce } = get()
    const next = recipe(project)
    if (next === project) return
    const merge = coalesce !== undefined && coalesce === lastCoalesce
    set({
      project: next,
      past: merge ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      lastCoalesce: coalesce ?? null,
    })
  },
  undo() {
    const { past, project, future } = get()
    const previous = past[past.length - 1]
    if (!previous) return
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future],
      dirty: true,
      lastCoalesce: null,
    })
    fixSelection()
  },
  redo() {
    const { past, project, future } = get()
    const next = future[0]
    if (!next) return
    set({
      project: next,
      past: [...past, project],
      future: future.slice(1),
      dirty: true,
      lastCoalesce: null,
    })
    fixSelection()
  },
  setProject(project, path) {
    set({
      project,
      projectPath: path,
      dirty: false,
      past: [],
      future: [],
      lastCoalesce: null,
      groupId: project.groups[0]?.id ?? null,
      channelId: null,
      transitionId: null,
      cursorBeat: 0,
    })
  },
  set(partial) {
    set(partial)
  },
  notify(kind, text) {
    set({ notice: { kind, text } })
  },
}))

/** Depois de desfazer, a seleção pode apontar para algo que não existe mais. */
function fixSelection() {
  const { project, groupId, channelId, transitionId, set } = useApp.getState()
  const group = project.groups.find((candidate) => candidate.id === groupId) ?? project.groups[0]
  set({
    groupId: group?.id ?? null,
    channelId: group?.channels.some((c) => c.id === channelId) ? channelId : null,
    transitionId: group?.transitions.some((t) => t.id === transitionId) ? transitionId : null,
  })
}

export function currentGroup(state: AppState): Group | undefined {
  return state.project.groups.find((group) => group.id === state.groupId)
}

export function trackById(project: Project, id: string): Track | undefined {
  return project.tracks.find((track) => track.id === id)
}

/** Troca um grupo do projeto por outro (mesmo id). */
export function replaceGroup(project: Project, group: Group): Project {
  return {
    ...project,
    groups: project.groups.map((candidate) => (candidate.id === group.id ? group : candidate)),
  }
}

export function updateGroup(
  project: Project,
  groupId: string,
  recipe: (group: Group) => Group,
): Project {
  const group = project.groups.find((candidate) => candidate.id === groupId)
  return group ? replaceGroup(project, recipe(group)) : project
}
