// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from 'react'
import { loadLibrary, locateTrack, saveProject } from '../actions.ts'
import { stop } from '../audio.ts'
import { host } from '../host.ts'
import { currentGroup, useApp } from '../store.ts'
import { BeatgridEditor } from './BeatgridEditor.tsx'
import { GroupSettings } from './GroupSettings.tsx'
import { LibraryPanel } from './LibraryPanel.tsx'
import { SetPanel } from './SetPanel.tsx'
import { Timeline } from './Timeline.tsx'
import { loopTransition, playGroupFromCursor, TopBar } from './TopBar.tsx'
import { TransitionPanel } from './TransitionPanel.tsx'

export function App() {
  const group = useApp(currentGroup)
  const gridEditor = useApp((s) => s.gridEditor)

  useEffect(() => {
    void loadLibrary()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, select, textarea')) return
      const state = useApp.getState()
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        state.redo()
      } else if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveProject(event.shiftKey)
      } else if (state.gridEditor) {
        return
      } else if (event.key === ' ') {
        event.preventDefault()
        if (state.playing) stop()
        else playGroupFromCursor()
      } else if (event.key.toLowerCase() === 'l') {
        loopTransition()
      } else if (event.key.toLowerCase() === 'a') {
        state.set({ tool: 'automation' })
      } else if (event.key.toLowerCase() === 'c') {
        state.set({ tool: 'clips' })
      }
    }
    window.addEventListener('keydown', onKey)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (useApp.getState().dirty && host.kind !== 'web') event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])

  return (
    <div className="app">
      <TopBar />
      <MissingTracks />
      <div className="layout">
        <LibraryPanel />
        <main className="workspace">
          <SetPanel />
          {group ? (
            <>
              <GroupSettings group={group} />
              <div className="timeline-scroll">
                <Timeline group={group} />
              </div>
              <TransitionPanel group={group} />
            </>
          ) : (
            <div className="empty-state">
              <h2>Monte o set em grupos de transições</h2>
              <p>
                Importe faixas na biblioteca e dê dois cliques nelas para criar o primeiro grupo.
                Cada faixa nova entra 8 compassos antes do fim da anterior, com uma transição Blend
                pronta para editar.
              </p>
            </div>
          )}
        </main>
      </div>
      <StatusBar />
      <ExportOverlay />
      {gridEditor && <BeatgridEditor key={gridEditor} hash={gridEditor} />}
    </div>
  )
}

function MissingTracks() {
  const missing = useApp((s) => s.missing)
  const tracks = useApp((s) => s.project.tracks)
  if (missing.length === 0) return null
  return (
    <div className="missing-bar">
      Faixas não encontradas:
      {missing.map((hash) => {
        const track = tracks.find((t) => t.hash === hash)
        return (
          <button key={hash} onClick={() => void locateTrack(hash)} title={track?.path}>
            Localizar “{track?.title ?? hash.slice(0, 8)}”
          </button>
        )
      })}
    </div>
  )
}

function StatusBar() {
  const notice = useApp((s) => s.notice)
  const set = useApp((s) => s.set)
  return (
    <footer className={`statusbar ${notice?.kind ?? ''}`} data-testid="notice">
      <span>
        {notice?.text ??
          (host.kind === 'browser'
            ? 'Versão web: as faixas importadas ficam guardadas só neste navegador, e o áudio não sai do seu computador.'
            : 'Pronto.')}
      </span>
      {notice && <button onClick={() => set({ notice: null })}>✕</button>}
    </footer>
  )
}

function ExportOverlay() {
  const exporting = useApp((s) => s.exporting)
  if (!exporting) return null
  return (
    <div className="modal-backdrop">
      <div className="modal export-progress">
        <h3>Exportando o set</h3>
        <p>{exporting.label}</p>
        <progress value={exporting.fraction} max={1} />
      </div>
    </div>
  )
}
