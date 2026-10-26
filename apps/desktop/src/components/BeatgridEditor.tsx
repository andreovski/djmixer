// SPDX-License-Identifier: AGPL-3.0-or-later
// Editor de beatgrid e cues de uma faixa. A grade é de BPM constante: ajusta-se o BPM e a
// primeira batida (arrastando a waveform, com os botões de ajuste fino ou marcando no cursor) e
// confere-se de ouvido com o metrônomo. A correção vale para a biblioteca e para o projeto e
// nunca é sobrescrita por uma nova análise.
import { newId, type Beatgrid, type Cue } from '@djmixer/shared'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { saveGridEdit } from '../actions.ts'
import { errorText, previewSeconds, startPreview, stopPreview } from '../audio.ts'
import { formatBpm, MAX_BPM, MIN_BPM, parseBpm, roundBpm, stepBpm } from '../bpm.ts'
import { entryGrid } from '../editing.ts'
import { TOUCH_QUERY, useMedia } from '../responsive.ts'
import { useApp } from '../store.ts'
import { drawWaveform } from '../waveform.ts'

const HEIGHT = 240
const OVERVIEW_H = 44

export function BeatgridEditor({ hash }: { hash: string }) {
  const entry = useApp((s) => s.library[hash])
  const peaks = useApp((s) => s.peaks[hash])
  const set = useApp((s) => s.set)
  const notify = useApp((s) => s.notify)
  const initial = entry ? entryGrid(entry) : null

  const [grid, setGrid] = useState<Beatgrid>(initial ?? { bpm: 120, firstBeatSeconds: 0 })
  const [cues, setCues] = useState<Cue[]>(entry?.edits.cues ?? [])
  const [cursor, setCursor] = useState(initial?.firstBeatSeconds ?? 0)
  const [start, setStart] = useState(Math.max(0, (initial?.firstBeatSeconds ?? 0) - 1))
  const [secondsPerPixel, setSpp] = useState(0.004)
  const [metronome, setMetronome] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [width, setWidth] = useState(900)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overviewRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; first: number; moved: boolean } | null>(null)
  // Dois dedos: aproxima/afasta e rola a waveform (o equivalente ao Ctrl/⌘+roda).
  const touches = useRef(new Map<number, number>())
  const pinch = useRef<{ distance: number; spp: number; anchor: number } | null>(null)
  const touch = useMedia(TOUCH_QUERY)
  const duration = entry?.durationSeconds ?? 0
  const beatSeconds = 60 / grid.bpm

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setWidth(Math.max(300, wrap.clientWidth)))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => stopPreview(), [])

  // Waveform com a grade por cima.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#15171c'
    ctx.fillRect(0, 0, width, HEIGHT)
    if (peaks) {
      drawWaveform(ctx, peaks, {
        startSeconds: start,
        secondsPerPixel,
        x: 0,
        y: 20,
        width,
        height: HEIGHT - 28,
      })
    }
    const end = start + width * secondsPerPixel
    const firstVisible = Math.floor((start - grid.firstBeatSeconds) / beatSeconds)
    ctx.font = '11px system-ui, sans-serif'
    for (let beat = firstVisible; grid.firstBeatSeconds + beat * beatSeconds <= end; beat++) {
      const x =
        Math.round((grid.firstBeatSeconds + beat * beatSeconds - start) / secondsPerPixel) + 0.5
      const downbeat = ((beat % 4) + 4) % 4 === 0
      if (!downbeat && beatSeconds / secondsPerPixel < 6) continue
      ctx.strokeStyle =
        beat === 0 ? '#ff5c7a' : downbeat ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.28)'
      ctx.beginPath()
      ctx.moveTo(x, 16)
      ctx.lineTo(x, HEIGHT)
      ctx.stroke()
      if (downbeat && (beatSeconds * 4) / secondsPerPixel > 24) {
        ctx.fillStyle = '#c7cdd9'
        ctx.fillText(String(Math.floor(beat / 4) + 1), x + 3, 12)
      }
    }
    for (const cue of cues) {
      const x = (grid.firstBeatSeconds + cue.beat * beatSeconds - start) / secondsPerPixel
      ctx.fillStyle = '#4fd1c5'
      ctx.fillRect(x - 1, 16, 2, HEIGHT - 16)
      ctx.fillText(cue.label, x + 4, 28)
    }
    const cx = (cursor - start) / secondsPerPixel
    ctx.strokeStyle = '#ffd166'
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, HEIGHT)
    ctx.stroke()
  }, [peaks, grid, cues, cursor, start, secondsPerPixel, width, beatSeconds])

  // Visão geral da faixa inteira, para navegar.
  useEffect(() => {
    const canvas = overviewRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !duration) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = OVERVIEW_H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#101216'
    ctx.fillRect(0, 0, width, OVERVIEW_H)
    if (peaks)
      drawWaveform(ctx, peaks, {
        startSeconds: 0,
        secondsPerPixel: duration / width,
        x: 0,
        y: 2,
        width,
        height: OVERVIEW_H - 4,
      })
    ctx.strokeStyle = '#ffd166'
    ctx.strokeRect(
      (start / duration) * width,
      0.5,
      ((width * secondsPerPixel) / duration) * width,
      OVERVIEW_H - 1,
    )
  }, [peaks, duration, start, secondsPerPixel, width])

  // Cabeça da prévia.
  useEffect(() => {
    if (!previewing) return
    let frame = 0
    const tick = () => {
      const seconds = previewSeconds()
      if (seconds !== null) {
        setCursor(seconds)
        const end = start + width * secondsPerPixel
        if (seconds > end || seconds < start) setStart(seconds - width * secondsPerPixel * 0.1)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [previewing, start, width, secondsPerPixel])

  if (!entry) return null

  const shiftFirstBeat = (seconds: number) => {
    setGrid((g) => {
      let first = g.firstBeatSeconds + seconds
      // A primeira batida fica dentro do arquivo; passar do começo pula uma batida.
      while (first < 0) first += 60 / g.bpm
      return { ...g, firstBeatSeconds: Math.round(first * 100000) / 100000 }
    })
  }
  const setBpm = (bpm: number) => {
    if (bpm >= MIN_BPM && bpm <= MAX_BPM) setGrid((g) => ({ ...g, bpm: roundBpm(bpm) }))
  }

  const pinchSpan = () => {
    const [a, b] = [...touches.current.values()]
    return a === undefined || b === undefined
      ? null
      : { distance: Math.max(1, Math.abs(a - b)), mid: (a + b) / 2 }
  }
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.pointerType === 'touch') {
      const left = event.currentTarget.getBoundingClientRect().left
      touches.current.set(event.pointerId, event.clientX - left)
      const span = touches.current.size >= 2 ? pinchSpan() : null
      if (span) {
        // O primeiro dedo pode já ter arrastado a grade: volta para onde estava.
        const first = drag.current?.first
        if (drag.current?.moved && first !== undefined)
          setGrid((g) => ({ ...g, firstBeatSeconds: first }))
        drag.current = null
        pinch.current = {
          distance: span.distance,
          spp: secondsPerPixel,
          anchor: start + span.mid * secondsPerPixel,
        }
        return
      }
    }
    drag.current = { x: event.clientX, first: grid.firstBeatSeconds, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (touches.current.has(event.pointerId)) {
      const left = event.currentTarget.getBoundingClientRect().left
      touches.current.set(event.pointerId, event.clientX - left)
      const span = pinchSpan()
      if (pinch.current && span) {
        const spp = Math.min(
          0.2,
          Math.max(0.0002, pinch.current.spp * (pinch.current.distance / span.distance)),
        )
        setSpp(spp)
        setStart(pinch.current.anchor - span.mid * spp)
        return
      }
    }
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.x
    if (Math.abs(dx) > (event.pointerType === 'touch' ? 8 : 3)) current.moved = true
    if (current.moved) {
      let first = current.first + dx * secondsPerPixel
      while (first < 0) first += beatSeconds
      setGrid((g) => ({ ...g, firstBeatSeconds: first }))
    }
  }
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (touches.current.delete(event.pointerId) && pinch.current) {
      if (touches.current.size < 2) pinch.current = null
      return
    }
    const current = drag.current
    drag.current = null
    if (current && !current.moved) {
      const rect = event.currentTarget.getBoundingClientRect()
      setCursor(Math.max(0, start + (event.clientX - rect.left) * secondsPerPixel))
    }
  }
  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    if (event.ctrlKey || event.metaKey) {
      const anchor = start + x * secondsPerPixel
      const spp = Math.min(
        0.2,
        Math.max(0.0002, secondsPerPixel * (event.deltaY < 0 ? 1 / 1.2 : 1.2)),
      )
      setSpp(spp)
      setStart(anchor - x * spp)
      return
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    setStart((s) => Math.max(-1, s + delta * secondsPerPixel))
  }

  // A batida mais próxima do cursor passa a cair exatamente nele.
  const beatAtCursor = () => {
    const beats = (cursor - grid.firstBeatSeconds) / beatSeconds
    shiftFirstBeat((beats - Math.round(beats)) * beatSeconds)
  }
  // O cursor vira o "1" do compasso 1: a grade começa nele.
  const downbeatAtCursor = () => {
    let first = cursor
    while (first - beatSeconds * 4 >= 0) first -= beatSeconds * 4
    setGrid((g) => ({ ...g, firstBeatSeconds: Math.round(first * 100000) / 100000 }))
  }
  const addCue = () => {
    const beat = Math.round((cursor - grid.firstBeatSeconds) / beatSeconds)
    setCues((list) =>
      [...list, { id: newId('cue'), beat, label: `Cue ${list.length + 1}` }].sort(
        (a, b) => a.beat - b.beat,
      ),
    )
  }
  const togglePreview = async () => {
    if (previewing) {
      stopPreview()
      setPreviewing(false)
      return
    }
    try {
      await startPreview({ hash, grid }, cursor, metronome)
      setPreviewing(true)
    } catch (error) {
      notify('error', errorText(error))
    }
  }
  const close = () => {
    stopPreview()
    set({ gridEditor: null })
  }
  const save = async (reset = false) => {
    try {
      await saveGridEdit(hash, reset ? null : grid, cues)
      close()
    } catch (error) {
      notify('error', errorText(error))
    }
  }
  const zoom = (factor: number) => {
    const center = start + (width / 2) * secondsPerPixel
    const spp = Math.min(0.2, Math.max(0.0002, secondsPerPixel * factor))
    setSpp(spp)
    setStart(center - (width / 2) * spp)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-label="Editor de beatgrid">
      <div className="modal beatgrid-editor">
        <div className="panel-title">
          <span>
            Beatgrid · {entry.title}
            {entry.artist && <span className="muted"> · {entry.artist}</span>}
          </span>
          <button onClick={close}>Fechar</button>
        </div>
        {!peaks && <p className="muted">A waveform aparece quando a análise terminar.</p>}
        <div ref={wrapRef} className="grid-canvas">
          <canvas
            ref={canvasRef}
            style={{ width, height: HEIGHT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
          <canvas
            ref={overviewRef}
            style={{ width, height: OVERVIEW_H }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const seconds = ((e.clientX - rect.left) / width) * duration
              setStart(seconds - (width * secondsPerPixel) / 2)
              setCursor(seconds)
            }}
          />
        </div>
        <p className="hint">
          {touch
            ? 'Arraste a waveform para mover a grade · toque posiciona o cursor · dois dedos aproximam e rolam · toque na visão geral para navegar'
            : 'Arraste a waveform para mover a grade · clique posiciona o cursor · Ctrl/⌘+roda aproxima'}
        </p>
        <div className="grid-controls">
          <BpmField bpm={grid.bpm} onChange={setBpm} />
          <button onClick={() => setBpm(stepBpm(grid.bpm, -1))} title="Diminui 1 BPM">
            −1
          </button>
          <button onClick={() => setBpm(stepBpm(grid.bpm, 1))} title="Aumenta 1 BPM">
            +1
          </button>
          <button onClick={() => setBpm(grid.bpm / 2)}>÷2</button>
          <button onClick={() => setBpm(grid.bpm * 2)}>×2</button>
          <label>
            Primeira batida (ms)
            <input
              type="number"
              step={1}
              value={Math.round(grid.firstBeatSeconds * 1000)}
              onChange={(e) =>
                setGrid((g) => ({
                  ...g,
                  firstBeatSeconds: Math.max(0, Number(e.target.value) / 1000),
                }))
              }
            />
          </label>
          <button onClick={() => shiftFirstBeat(-0.01)}>−10 ms</button>
          <button onClick={() => shiftFirstBeat(-0.001)}>−1 ms</button>
          <button onClick={() => shiftFirstBeat(0.001)}>+1 ms</button>
          <button onClick={() => shiftFirstBeat(0.01)}>+10 ms</button>
        </div>
        <div className="grid-controls">
          <button className="primary" onClick={() => void togglePreview()}>
            {previewing ? '■ Parar' : '▶ Ouvir do cursor'}
          </button>
          <label>
            <input
              type="checkbox"
              checked={metronome}
              onChange={(e) => setMetronome(e.target.checked)}
            />
            Metrônomo
          </label>
          <button
            onClick={beatAtCursor}
            title="Desloca a grade para a batida mais próxima cair no cursor"
          >
            Batida no cursor
          </button>
          <button onClick={downbeatAtCursor} title="O cursor passa a ser o 1 de um compasso">
            Compasso começa no cursor
          </button>
          <button onClick={() => zoom(1 / 1.5)}>+ zoom</button>
          <button onClick={() => zoom(1.5)}>− zoom</button>
          <span className="muted">cursor {cursor.toFixed(3)} s</span>
        </div>
        <div className="cues">
          <div className="panel-label">
            Cues <button onClick={addCue}>+ Cue no cursor</button>
          </div>
          {cues.length === 0 && <span className="muted">Nenhuma cue.</span>}
          {cues.map((cue) => (
            <div key={cue.id} className="cue">
              <input
                value={cue.label}
                onChange={(e) =>
                  setCues((list) =>
                    list.map((c) => (c.id === cue.id ? { ...c, label: e.target.value } : c)),
                  )
                }
              />
              <span className="muted">
                compasso {Math.floor(cue.beat / 4) + 1}.{(((cue.beat % 4) + 4) % 4) + 1}
              </span>
              <button
                onClick={() => {
                  const seconds = grid.firstBeatSeconds + cue.beat * beatSeconds
                  setCursor(seconds)
                  setStart(seconds - (width * secondsPerPixel) / 4)
                }}
              >
                Ir
              </button>
              <button onClick={() => setCues((list) => list.filter((c) => c.id !== cue.id))}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          {entry.analysis && (
            <span className="muted">
              Análise: {entry.analysis.grid.bpm.toFixed(2)} BPM, primeira batida em{' '}
              {(entry.analysis.grid.firstBeatSeconds * 1000).toFixed(0)} ms, confiança{' '}
              {Math.round(entry.analysis.confidence * 100)}%
            </span>
          )}
          <span className="spacer" />
          {entry.edits.grid && <button onClick={() => void save(true)}>Voltar à análise</button>}
          <button onClick={close}>Cancelar</button>
          <button className="primary" onClick={() => void save()} data-testid="grid-save">
            Salvar grade
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Campo de texto do BPM. Enquanto se digita, o texto fica como está (apagar tudo ou passar por
 * "1" e "12" a caminho de "128" não volta o valor) e a grade só muda quando o número é válido.
 * Ao sair do campo, um texto inválido volta para o BPM atual. Enter confirma, Esc desfaz, e as
 * setas mudam 1 BPM (Shift: 0,1; Alt/Option: 0,01).
 */
function BpmField({ bpm, onChange }: { bpm: number; onChange: (bpm: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const atFocus = useRef(bpm)
  const editing = draft !== null
  const invalid = editing && parseBpm(draft) === null

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      onChange(atFocus.current)
      setDraft(null)
      event.currentTarget.blur()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const size = event.shiftKey ? 0.1 : event.altKey ? 0.01 : 1
      const next = stepBpm(parseBpm(draft ?? '') ?? bpm, event.key === 'ArrowUp' ? size : -size)
      onChange(next)
      setDraft(formatBpm(next))
    }
  }

  return (
    <label>
      BPM
      <input
        type="text"
        inputMode="decimal"
        className="bpm-field"
        value={draft ?? formatBpm(bpm)}
        aria-invalid={invalid}
        title={`Entre ${MIN_BPM} e ${MAX_BPM}. Setas: ±1 (Shift ±0,1, Alt ±0,01)`}
        data-testid="grid-bpm"
        onFocus={(e) => {
          atFocus.current = bpm
          setDraft(formatBpm(bpm))
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          const next = parseBpm(e.target.value)
          if (next !== null) onChange(next)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}
