// SPDX-License-Identifier: AGPL-3.0-or-later
// Barra de cima: arquivo do projeto, desfazer e o transporte (tocar grupo, ensaiar a transição
// em loop, tocar o set, parar), com a posição atual.
import { formatTimestamp, setTimeline } from '@djmixer/shared'
import { useEffect, useState } from 'react'
import { exportProject, newProject, openProject, saveProject } from '../actions.ts'
import { play, playbackPosition, stop } from '../audio.ts'
import { formatBarBeat } from '../editing.ts'
import { currentGroup, useApp } from '../store.ts'

export function TopBar() {
  const name = useApp((s) => s.project.name)
  const dirty = useApp((s) => s.dirty)
  const path = useApp((s) => s.projectPath)
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const edit = useApp((s) => s.edit)
  const exporting = useApp((s) => s.exporting)

  return (
    <header className="topbar">
      <div className="brand">djmixer</div>
      <input
        className="project-name"
        aria-label="Nome do projeto"
        value={name}
        onChange={(e) => edit((p) => ({ ...p, name: e.target.value }), 'project-name')}
        title={path ?? 'Projeto não salvo'}
      />
      {dirty && (
        <span className="dirty" title="Alterações não salvas">
          ●
        </span>
      )}
      <div className="buttons">
        <button onClick={newProject}>Novo</button>
        <button onClick={() => void openProject()}>Abrir</button>
        <button onClick={() => void saveProject()}>Salvar</button>
        <button onClick={() => void saveProject(true)}>Salvar como</button>
        <button onClick={() => void exportProject()} disabled={exporting !== null}>
          Exportar WAV
        </button>
        <span className="sep" />
        <button
          onClick={() => useApp.getState().undo()}
          disabled={!canUndo}
          title="Desfazer (Ctrl/⌘+Z)"
        >
          ↶
        </button>
        <button
          onClick={() => useApp.getState().redo()}
          disabled={!canRedo}
          title="Refazer (Ctrl/⌘+Shift+Z)"
        >
          ↷
        </button>
      </div>
      <Transport />
    </header>
  )
}

export function playGroupFromCursor(): void {
  const state = useApp.getState()
  const group = currentGroup(state)
  if (group) void play({ kind: 'group', groupId: group.id, fromBeat: state.cursorBeat })
}

export function loopTransition(): void {
  const state = useApp.getState()
  const group = currentGroup(state)
  const transition = group?.transitions.find((t) => t.id === state.transitionId)
  if (!group || !transition) {
    state.notify('error', 'Selecione uma transição para ensaiar.')
    return
  }
  void play({
    kind: 'loop',
    groupId: group.id,
    startBeat: transition.startBeat,
    endBeat: transition.startBeat + transition.lengthBeats,
  })
}

function Transport() {
  const playing = useApp((s) => s.playing)
  const loading = useApp((s) => s.loading)
  const hasTransition = useApp((s) => s.transitionId !== null)
  const groupIndex = useApp((s) => s.project.groups.findIndex((g) => g.id === s.groupId))
  const [position, setPosition] = useState('—')

  useEffect(() => {
    if (!playing) {
      setPosition('—')
      return
    }
    const timer = setInterval(() => {
      const at = playbackPosition()
      if (!at) return
      const { project } = useApp.getState()
      const segment = setTimeline(project).find((s) => s.group.id === at.groupId)
      if (!segment) return
      const seconds = segment.startSeconds + (at.beat * 60) / segment.group.bpm
      setPosition(`${segment.group.name} · ${formatBarBeat(at.beat)} · ${formatTimestamp(seconds)}`)
    }, 100)
    return () => clearInterval(timer)
  }, [playing])

  return (
    <div className="transport">
      <button
        className={playing === 'group' ? 'on' : ''}
        onClick={playGroupFromCursor}
        title="Tocar o grupo a partir do cursor (Espaço)"
      >
        ▶ Grupo
      </button>
      <button
        className={playing === 'loop' ? 'on' : ''}
        onClick={loopTransition}
        disabled={!hasTransition}
        title="Ensaiar só a transição selecionada, em loop (L)"
      >
        ⟳ Transição
      </button>
      <button
        className={playing === 'set' ? 'on' : ''}
        onClick={() => void play({ kind: 'set', groupIndex: Math.max(0, groupIndex) })}
        title="Tocar o set na ordem dos grupos, a partir do grupo selecionado"
      >
        ▶ Set
      </button>
      <button onClick={stop} disabled={!playing} title="Parar (Espaço)">
        ■
      </button>
      <span className="position" data-testid="position">
        {loading ? 'preparando áudio…' : position}
      </span>
    </div>
  )
}
