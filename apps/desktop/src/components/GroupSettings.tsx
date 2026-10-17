// SPDX-License-Identifier: AGPL-3.0-or-later
// Ajustes do grupo: nome, BPM (as faixas são esticadas para ele), key lock e tipo de EQ.
import type { EqMode, Group } from '@djmixer/shared'
import { updateGroup, useApp } from '../store.ts'

export function GroupSettings({ group }: { group: Group }) {
  const edit = useApp((s) => s.edit)
  const change = (patch: Partial<Group>, coalesce?: string) =>
    edit((p) => updateGroup(p, group.id, (g) => ({ ...g, ...patch })), coalesce)

  return (
    <div className="group-settings">
      <label>
        Nome
        <input
          value={group.name}
          onChange={(e) => change({ name: e.target.value }, `name-${group.id}`)}
        />
      </label>
      <label>
        BPM
        <input
          type="number"
          min={60}
          max={200}
          step={0.01}
          value={group.bpm}
          data-testid="group-bpm"
          onChange={(e) => {
            const bpm = Number(e.target.value)
            if (bpm >= 40 && bpm <= 250) change({ bpm }, `bpm-${group.id}`)
          }}
        />
      </label>
      <label title="Com key lock o tom fica igual (time-stretch Rubber Band); sem ele, muda com a velocidade">
        <input
          type="checkbox"
          checked={group.keyLock}
          onChange={(e) => change({ keyLock: e.target.checked })}
        />
        Key lock
      </label>
      <label title="Isolador corta a banda inteira, como mixers de DJ; shelving é um EQ de estúdio">
        EQ
        <select value={group.eq} onChange={(e) => change({ eq: e.target.value as EqMode })}>
          <option value="isolator">isolador</option>
          <option value="shelving">shelving</option>
        </select>
      </label>
    </div>
  )
}
