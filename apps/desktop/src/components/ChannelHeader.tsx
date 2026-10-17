// SPDX-License-Identifier: AGPL-3.0-or-later
// Cabeçalho de um canal na linha do tempo: faixa, ajuste de tempo, tom e a lane mostrada.
import {
  EDITABLE_LANES,
  stretchRatio,
  type Channel,
  type EditableLaneKind,
  type Group,
  type Track,
} from '@djmixer/shared'
import { LANE_LABELS, removeChannel, STRETCH_WARNING } from '../editing.ts'
import { updateGroup, useApp } from '../store.ts'
import { ROW_H } from './layout.ts'

interface Props {
  group: Group
  channel: Channel
  track: Track | undefined
  color: string
  lane: EditableLaneKind
}

export function ChannelHeader({ group, channel, track, color, lane }: Props) {
  const selected = useApp((s) => s.channelId === channel.id)
  const missing = useApp((s) => (track ? s.missing.includes(track.hash) : false))
  const set = useApp((s) => s.set)
  const edit = useApp((s) => s.edit)
  const laneByChannel = useApp((s) => s.laneByChannel)

  const ratio = track ? stretchRatio(track.grid.bpm, group.bpm) : 1
  const percent = (ratio - 1) * 100
  const warn = Math.abs(ratio - 1) > STRETCH_WARNING

  return (
    <div
      className={`channel-header${selected ? ' selected' : ''}`}
      style={{ height: ROW_H, borderLeftColor: color }}
      onClick={() => set({ channelId: channel.id })}
    >
      <div className="channel-title" title={track?.path}>
        {track ? track.title : 'Faixa ausente'}
      </div>
      <div className="channel-sub">{track?.artist || ' '}</div>
      <div className="channel-meta">
        {track && (
          <>
            <span title="BPM da faixa">{track.grid.bpm.toFixed(2)}</span>
            <span
              className={warn ? 'warn' : ''}
              title={group.keyLock ? 'Time-stretch com key lock' : 'Varispeed (o tom muda)'}
            >
              {percent >= 0 ? '+' : ''}
              {percent.toFixed(1)}%
            </span>
            {track.key && <span className="key">{track.key.camelot}</span>}
            {missing && <span className="warn">não encontrada</span>}
          </>
        )}
      </div>
      <div className="channel-actions">
        <select
          aria-label="Lane"
          value={lane}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            set({
              laneByChannel: { ...laneByChannel, [channel.id]: e.target.value as EditableLaneKind },
            })
          }
        >
          {EDITABLE_LANES.map((kind) => (
            <option key={kind} value={kind}>
              {LANE_LABELS[kind]}
            </option>
          ))}
        </select>
        {track && (
          <button
            title="Editar beatgrid e cues"
            onClick={(e) => (e.stopPropagation(), set({ gridEditor: track.hash }))}
          >
            Grade
          </button>
        )}
        <button
          title="Tirar a faixa do grupo"
          onClick={(e) => {
            e.stopPropagation()
            edit((p) => updateGroup(p, group.id, (g) => removeChannel(g, channel.id)))
            set({ channelId: null })
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
