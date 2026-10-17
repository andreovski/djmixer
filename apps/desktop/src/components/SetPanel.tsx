// SPDX-License-Identifier: AGPL-3.0-or-later
// O set: grupos na ordem em que tocam, com início e duração; criar, renomear, reordenar, remover.
import { formatTimestamp, setTimeline } from '@djmixer/shared'
import { createGroup, moveGroup, pruneTracks } from '../editing.ts'
import { useApp } from '../store.ts'

export function SetPanel() {
  const project = useApp((s) => s.project)
  const groupId = useApp((s) => s.groupId)
  const edit = useApp((s) => s.edit)
  const set = useApp((s) => s.set)
  const timeline = setTimeline(project)
  const total = timeline.reduce((sum, segment) => sum + segment.durationSeconds, 0)

  const add = () => {
    const current = project.groups.find((g) => g.id === groupId)
    const [next, group] = createGroup(project, `Grupo ${project.groups.length + 1}`, current?.bpm)
    edit(() => next)
    set({ groupId: group.id, channelId: null, transitionId: null, cursorBeat: 0 })
  }

  const remove = (id: string) => {
    const group = project.groups.find((g) => g.id === id)
    if (group && group.channels.length > 0 && !window.confirm(`Remover "${group.name}" do set?`))
      return
    edit((p) => pruneTracks({ ...p, groups: p.groups.filter((g) => g.id !== id) }))
    const rest = project.groups.filter((g) => g.id !== id)
    set({ groupId: rest[0]?.id ?? null, channelId: null, transitionId: null })
  }

  return (
    <nav className="set-panel" aria-label="Grupos do set">
      <span className="set-title">Set</span>
      {timeline.map(({ group, startSeconds, durationSeconds }, index) => (
        <div
          key={group.id}
          data-testid="group-tab"
          className={`group-tab${group.id === groupId ? ' selected' : ''}`}
          onClick={() =>
            set({ groupId: group.id, channelId: null, transitionId: null, cursorBeat: 0 })
          }
        >
          <span className="group-index">{index + 1}</span>
          <span className="group-name">{group.name}</span>
          <span className="muted">
            {formatTimestamp(startSeconds)} · {formatTimestamp(durationSeconds)}
          </span>
          {group.id === groupId && (
            <span className="group-tab-actions">
              <button
                title="Mover para antes"
                onClick={(e) => (e.stopPropagation(), edit((p) => moveGroup(p, group.id, -1)))}
              >
                ←
              </button>
              <button
                title="Mover para depois"
                onClick={(e) => (e.stopPropagation(), edit((p) => moveGroup(p, group.id, 1)))}
              >
                →
              </button>
              <button
                title="Remover grupo"
                onClick={(e) => (e.stopPropagation(), remove(group.id))}
              >
                ✕
              </button>
            </span>
          )}
        </div>
      ))}
      <button onClick={add} data-testid="add-group">
        + Grupo
      </button>
      <span className="muted set-total">Total {formatTimestamp(total)}</span>
    </nav>
  )
}
