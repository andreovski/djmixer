// SPDX-License-Identifier: AGPL-3.0-or-later
// Transição selecionada: janela em batidas, preset (que só gera pontos nas lanes) e ensaio em
// loop. Também cria transições novas entre dois canais.
import { PRESETS, type Group, type PresetName, type Transition } from '@djmixer/shared'
import { useState } from 'react'
import { addTransition, applyTransition, formatBarBeat } from '../editing.ts'
import { updateGroup, useApp } from '../store.ts'
import { loopTransition } from './TopBar.tsx'

const LENGTHS = [4, 8, 16, 32, 64]

export function TransitionPanel({ group }: { group: Group }) {
  const transitionId = useApp((s) => s.transitionId)
  const channelId = useApp((s) => s.channelId)
  const project = useApp((s) => s.project)
  const edit = useApp((s) => s.edit)
  const set = useApp((s) => s.set)
  const transition = group.transitions.find((t) => t.id === transitionId)
  const title = (id: string) => {
    const channel = group.channels.find((c) => c.id === id)
    return project.tracks.find((t) => t.id === channel?.trackId)?.title ?? '?'
  }

  const update = (patch: Partial<Transition>) => {
    if (!transition) return
    edit((p) =>
      updateGroup(p, group.id, (g) => applyTransition(g, { ...transition, ...patch }, transition)),
    )
  }

  return (
    <section className="inspector">
      <div className="transition-list">
        <span className="panel-label">Transições</span>
        {group.transitions.length === 0 && <span className="muted">nenhuma</span>}
        {group.transitions.map((t) => (
          <button
            key={t.id}
            className={t.id === transitionId ? 'on' : ''}
            onClick={() => set({ transitionId: t.id, cursorBeat: Math.max(0, t.startBeat - 8) })}
          >
            {title(t.fromChannelId)} → {title(t.toChannelId)}
          </button>
        ))}
        {channelId && <NewTransition group={group} fromId={channelId} />}
      </div>
      {transition && (
        <div className="transition-detail" data-testid="transition">
          <label>
            Início
            <input
              type="number"
              step={4}
              value={transition.startBeat}
              onChange={(e) => update({ startBeat: Math.max(0, Number(e.target.value)) })}
            />
            <span className="muted">compasso {formatBarBeat(transition.startBeat)}</span>
          </label>
          <label>
            Duração
            <select
              value={transition.lengthBeats}
              onChange={(e) => update({ lengthBeats: Number(e.target.value) })}
            >
              {[...new Set([...LENGTHS, transition.lengthBeats])]
                .sort((a, b) => a - b)
                .map((beats) => (
                  <option key={beats} value={beats}>
                    {beats / 4} compassos
                  </option>
                ))}
            </select>
          </label>
          <div className="presets" role="group" aria-label="Preset">
            {(Object.keys(PRESETS) as PresetName[]).map((name) => (
              <button
                key={name}
                className={transition.preset === name ? 'on' : ''}
                onClick={() => update({ preset: name })}
                title="Gera os pontos nas lanes dos dois canais dentro da janela; depois é só editar"
              >
                {PRESETS[name]}
              </button>
            ))}
          </div>
          <button className="primary" onClick={loopTransition}>
            ⟳ Ensaiar em loop
          </button>
          <button
            onClick={() => {
              edit((p) =>
                updateGroup(p, group.id, (g) => ({
                  ...g,
                  transitions: g.transitions.filter((t) => t.id !== transition.id),
                })),
              )
              set({ transitionId: null })
            }}
            title="Remove a janela; os pontos das lanes continuam"
          >
            Remover
          </button>
        </div>
      )}
    </section>
  )
}

function NewTransition({ group, fromId }: { group: Group; fromId: string }) {
  const edit = useApp((s) => s.edit)
  const set = useApp((s) => s.set)
  const project = useApp((s) => s.project)
  const others = group.channels.filter((c) => c.id !== fromId)
  const [toId, setToId] = useState('')
  if (others.length === 0) return null
  const create = () => {
    const target = toId || others[0]?.id
    if (!target) return
    const [next, transition] = addTransition(group, fromId, target)
    edit((p) => updateGroup(p, group.id, () => next))
    set({ transitionId: transition.id })
  }
  return (
    <span className="new-transition">
      <select value={toId} onChange={(e) => setToId(e.target.value)} aria-label="Canal que entra">
        {others.map((c) => (
          <option key={c.id} value={c.id}>
            {project.tracks.find((t) => t.id === c.trackId)?.title ?? c.id}
          </option>
        ))}
      </select>
      <button onClick={create}>+ Transição do canal selecionado</button>
    </span>
  )
}
