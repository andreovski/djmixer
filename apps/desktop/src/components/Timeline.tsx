// SPDX-License-Identifier: AGPL-3.0-or-later
// Linha do tempo do grupo, medida em compassos: um canal por linha com o clip (waveform da
// faixa) e a automação da lane escolhida por cima. Na ferramenta "Clips" arrasta e apara clips;
// em "Automação" cria, arrasta e apaga pontos. Tudo encaixa no snap escolhido.
import { laneValueAt, NEUTRAL } from '@djmixer/engine'
import {
  channelEndBeat,
  type Channel,
  type EditableLaneKind,
  type Group,
  type Point,
  type Track,
} from '@djmixer/shared'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { playbackPosition } from '../audio.ts'
import {
  lanePoints,
  moveClip,
  nextCurve,
  setLanePoints,
  snapBeat,
  trackBeats,
  trimClip,
  updateChannel,
} from '../editing.ts'
import { TOUCH_QUERY, useMedia } from '../responsive.ts'
import { useApp, updateGroup } from '../store.ts'
import { drawWaveform } from '../waveform.ts'
import { ChannelHeader } from './ChannelHeader.tsx'
import { ROW_H, RULER_H } from './layout.ts'

const EDGE_PX = 7
const EDGE_PX_TOUCH = 18
const POINT_R = 5
/** Quanto o dedo anda antes de virar arraste (abaixo disso é toque). */
const TOUCH_SLOP_PX = 8
const DOUBLE_TAP_MS = 350
const LONG_PRESS_MS = 550
const COLORS = ['#3d7bd9', '#d9873d', '#3dbf86', '#b55dd9', '#d94d6a', '#c2b43a']

interface Drag {
  kind: 'move' | 'trim-start' | 'trim-end' | 'point' | 'pan'
  channelId: string
  originX: number
  originY: number
  originBeat: number
  originStart: number
  laneKind?: EditableLaneKind
  pointIndex?: number
  points?: Point[]
  key: string
  originScroll?: number
  originScrollTop?: number
  originClientY?: number
  touch?: boolean
  /** Passou do limiar de arraste. */
  moved?: boolean
  /** Já gravou alguma edição com a chave `key`. */
  edited?: boolean
}

interface Pinch {
  distance: number
  zoom: number
  anchorBeat: number
  midY: number
}

export function Timeline({ group }: { group: Group }) {
  const project = useApp((s) => s.project)
  const peaks = useApp((s) => s.peaks)
  const tool = useApp((s) => s.tool)
  const snap = useApp((s) => s.snap)
  const channelId = useApp((s) => s.channelId)
  const transitionId = useApp((s) => s.transitionId)
  const laneByChannel = useApp((s) => s.laneByChannel)
  const cursorBeat = useApp((s) => s.cursorBeat)
  const playing = useApp((s) => s.playing)
  const set = useApp((s) => s.set)
  const edit = useApp((s) => s.edit)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(800)
  const [pxPerBeat, setPxPerBeat] = useState(5)
  const [scrollBeat, setScrollBeat] = useState(-4)
  const drag = useRef<Drag | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<Pinch | null>(null)
  const longPress = useRef<number | null>(null)
  const lastTap = useRef<{ key: string; time: number } | null>(null)
  const lastPointer = useRef('mouse')
  const touch = useMedia(TOUCH_QUERY)
  const height = RULER_H + Math.max(1, group.channels.length) * ROW_H

  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const xOf = useCallback(
    (beat: number) => (beat - scrollBeat) * pxPerBeat,
    [scrollBeat, pxPerBeat],
  )
  const beatOf = useCallback((x: number) => scrollBeat + x / pxPerBeat, [scrollBeat, pxPerBeat])
  const laneOf = (channel: Channel): EditableLaneKind => laneByChannel[channel.id] ?? 'volume'

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setWidth(Math.max(200, wrap.clientWidth)))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  // Desenho principal: régua, grade, transições, clips e automação.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#1b1e25'
    ctx.fillRect(0, 0, width, height)

    // Grade: linha a cada compasso, mais forte a cada 4 compassos (frase de 16 batidas).
    const firstBar = Math.floor(scrollBeat / 4)
    const lastBar = Math.ceil(beatOf(width) / 4)
    const barStep = pxPerBeat * 4 < 12 ? 4 : 1
    ctx.font = '11px system-ui, sans-serif'
    for (let bar = firstBar; bar <= lastBar; bar++) {
      if (bar % barStep !== 0) continue
      const x = Math.round(xOf(bar * 4)) + 0.5
      const phrase = bar % 4 === 0
      ctx.strokeStyle = phrase ? '#3a404d' : '#2a2f39'
      ctx.beginPath()
      ctx.moveTo(x, RULER_H - (phrase ? 14 : 6))
      ctx.lineTo(x, height)
      ctx.stroke()
      if (phrase || pxPerBeat * 4 >= 40) {
        ctx.fillStyle = '#8b93a5'
        ctx.fillText(String(bar + 1), x + 3, 13)
      }
    }
    if (pxPerBeat >= 14) {
      ctx.strokeStyle = '#22262f'
      for (let beat = Math.floor(scrollBeat); beat <= beatOf(width); beat++) {
        if (beat % 4 === 0) continue
        const x = Math.round(xOf(beat)) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, RULER_H)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
    }

    // Janelas de transição: faixa na régua e sombra nas linhas.
    for (const transition of group.transitions) {
      const x0 = xOf(transition.startBeat)
      const x1 = xOf(transition.startBeat + transition.lengthBeats)
      const selected = transition.id === transitionId
      ctx.fillStyle = selected ? 'rgba(255, 196, 0, 0.13)' : 'rgba(255, 196, 0, 0.06)'
      ctx.fillRect(x0, RULER_H, x1 - x0, height - RULER_H)
      ctx.fillStyle = selected ? '#e0aa1f' : '#7d6a2e'
      ctx.fillRect(x0, RULER_H - 12, x1 - x0, 10)
      ctx.fillStyle = '#15171c'
      ctx.fillText(transition.preset, x0 + 4, RULER_H - 3)
    }

    group.channels.forEach((channel, row) => {
      const track = tracks.get(channel.trackId)
      const top = RULER_H + row * ROW_H
      const color = COLORS[row % COLORS.length] ?? '#3d7bd9'
      if (channel.id === channelId) {
        ctx.fillStyle = 'rgba(255,255,255,0.035)'
        ctx.fillRect(0, top, width, ROW_H)
      }
      ctx.strokeStyle = '#2a2f39'
      ctx.beginPath()
      ctx.moveTo(0, top + ROW_H - 0.5)
      ctx.lineTo(width, top + ROW_H - 0.5)
      ctx.stroke()

      const x0 = xOf(channel.clip.startBeat)
      const x1 = xOf(channelEndBeat(channel))
      ctx.fillStyle = `${color}33`
      ctx.fillRect(x0, top + 4, x1 - x0, ROW_H - 8)
      ctx.strokeStyle = channel.id === channelId ? '#ffffff' : color
      ctx.strokeRect(x0 + 0.5, top + 4.5, x1 - x0 - 1, ROW_H - 9)
      const trackPeaks = track && peaks[track.hash]
      if (track && trackPeaks) {
        // Batida do grupo -> segundo do arquivo é linear dentro do clip.
        const visible0 = Math.max(0, x0)
        const visible1 = Math.min(width, x1)
        const beatSeconds = 60 / track.grid.bpm
        const fileSecondsAt = (x: number) =>
          track.grid.firstBeatSeconds +
          (channel.clip.inBeat + beatOf(x) - channel.clip.startBeat) * beatSeconds
        ctx.save()
        ctx.beginPath()
        ctx.rect(visible0, top + 4, visible1 - visible0, ROW_H - 8)
        ctx.clip()
        drawWaveform(
          ctx,
          trackPeaks,
          {
            startSeconds: fileSecondsAt(visible0),
            secondsPerPixel: beatSeconds / pxPerBeat,
            x: visible0,
            y: top + 8,
            width: Math.max(0, Math.ceil(visible1 - visible0)),
            height: ROW_H - 16,
          },
          tool === 'automation' ? 0.45 : 0.9,
        )
        ctx.restore()
      }
      ctx.fillStyle = '#e6e9ef'
      ctx.fillText(track ? track.title : 'faixa ausente', Math.max(x0, 0) + 6, top + 18)

      // Automação da lane escolhida, com os pontos.
      const kind = laneOf(channel)
      const points = lanePoints(channel, kind)
      const yOf = (value: number) => top + 6 + (1 - value) * (ROW_H - 12)
      ctx.strokeStyle = tool === 'automation' ? '#ffd166' : 'rgba(255, 209, 102, 0.5)'
      ctx.lineWidth = tool === 'automation' ? 2 : 1
      ctx.beginPath()
      for (let x = 0; x <= width; x += 2) {
        const y = yOf(laneValueAt(points, beatOf(x), NEUTRAL[kind]))
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.lineWidth = 1
      if (tool === 'automation') {
        for (const point of points) {
          ctx.fillStyle = point.curve === 'hold' ? '#ff8c42' : '#ffd166'
          ctx.beginPath()
          ctx.arc(xOf(point.beat), yOf(point.value), POINT_R, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    })

    if (group.channels.length === 0) {
      ctx.fillStyle = '#8b93a5'
      ctx.font = '13px system-ui, sans-serif'
      ctx.fillText(
        touch
          ? 'Grupo vazio: toque numa faixa da biblioteca e use “Adicionar ao grupo”.'
          : 'Grupo vazio: dê dois cliques numa faixa da biblioteca para adicioná-la aqui.',
        16,
        RULER_H + 50,
      )
    }

    // Cursor de início da reprodução.
    const cx = Math.round(xOf(cursorBeat)) + 0.5
    ctx.strokeStyle = '#4fd1c5'
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, height)
    ctx.stroke()
  }, [
    group,
    project.tracks,
    peaks,
    width,
    height,
    pxPerBeat,
    scrollBeat,
    tool,
    channelId,
    transitionId,
    laneByChannel,
    cursorBeat,
    touch,
  ])

  // Cabeça de reprodução em outra camada, redesenhada a cada quadro.
  useEffect(() => {
    const overlay = overlayRef.current
    const ctx = overlay?.getContext('2d')
    if (!overlay || !ctx) return
    const dpr = window.devicePixelRatio || 1
    overlay.width = width * dpr
    overlay.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let frame = 0
    const tick = () => {
      ctx.clearRect(0, 0, width, height)
      const position = playbackPosition()
      if (position && position.groupId === group.id) {
        const x = xOf(position.beat)
        if (x > width - 40 || x < 0) setScrollBeat(position.beat - 8)
        ctx.strokeStyle = '#ff5c7a'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      frame = requestAnimationFrame(tick)
    }
    if (playing) frame = requestAnimationFrame(tick)
    else ctx.clearRect(0, 0, width, height)
    return () => cancelAnimationFrame(frame)
  }, [playing, width, height, xOf, group.id])

  const rowAt = (y: number) => Math.floor((y - RULER_H) / ROW_H)

  /** Contêiner que rola a linha do tempo na vertical (muda entre desktop e tela compacta). */
  const scroller = () => {
    let node = wrapRef.current?.parentElement ?? null
    while (node) {
      const overflow = getComputedStyle(node).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight)
        return node
      node = node.parentElement
    }
    return null
  }

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  const deletePoint = (
    channel: Channel,
    kind: EditableLaneKind,
    points: Point[],
    index: number,
  ) => {
    const next = points.filter((_, i) => i !== index)
    edit((p) =>
      updateGroup(p, group.id, (g) =>
        updateChannel(g, channel.id, (c) => setLanePoints(c, kind, next)),
      ),
    )
  }

  const cyclePointCurve = (
    channel: Channel,
    kind: EditableLaneKind,
    points: Point[],
    index: number,
  ) => {
    const next = points.map((point, i) =>
      i === index ? { ...point, curve: nextCurve(point.curve) } : point,
    )
    edit((p) =>
      updateGroup(p, group.id, (g) =>
        updateChannel(g, channel.id, (c) => setLanePoints(c, kind, next)),
      ),
    )
  }

  const cancelLongPress = () => {
    if (longPress.current !== null) window.clearTimeout(longPress.current)
    longPress.current = null
  }

  /** Dois dedos: aproxima/afasta em torno do meio dos dedos e rola junto com eles. */
  const startPinch = () => {
    const [a, b] = [...touches.current.values()]
    if (!a || !b) return
    cancelLongPress()
    // O primeiro dedo pode ter criado ou arrastado algo antes do segundo encostar: desfaz.
    if (drag.current?.edited && useApp.getState().lastCoalesce === drag.current.key)
      useApp.getState().undo()
    drag.current = null
    const midX = (a.x + b.x) / 2
    pinch.current = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: pxPerBeat,
      anchorBeat: beatOf(midX),
      midY: (a.y + b.y) / 2,
    }
  }

  const movePinch = () => {
    const current = pinch.current
    const [a, b] = [...touches.current.values()]
    if (!current || !a || !b) return
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    const zoom = Math.min(80, Math.max(0.5, current.zoom * (distance / current.distance)))
    setPxPerBeat(zoom)
    setScrollBeat(current.anchorBeat - midX / zoom)
    const box = scroller()
    if (box) box.scrollTop -= midY - current.midY
    current.midY = midY
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button === 2) return
    const isTouch = event.pointerType === 'touch'
    lastPointer.current = event.pointerType
    const { x, y } = localPoint(event)
    if (isTouch) {
      touches.current.set(event.pointerId, { x, y: event.clientY })
      event.currentTarget.setPointerCapture(event.pointerId)
      if (touches.current.size >= 2) {
        startPinch()
        return
      }
    }
    const beat = beatOf(x)
    const key = `${Date.now()}`
    const base = { originX: x, originY: y, originBeat: beat, originStart: 0, key }
    const startPan = () => {
      drag.current = {
        ...base,
        kind: 'pan',
        channelId: '',
        originScroll: scrollBeat,
        originClientY: event.clientY,
        ...(isTouch ? { originScrollTop: scroller()?.scrollTop ?? 0 } : {}),
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (event.altKey || event.button === 1) {
      startPan()
      return
    }
    if (y < RULER_H) {
      const hit = group.transitions.find(
        (t) => y >= RULER_H - 12 && beat >= t.startBeat && beat <= t.startBeat + t.lengthBeats,
      )
      if (hit) set({ transitionId: hit.id })
      else set({ cursorBeat: Math.max(0, snapBeat(beat, snap === 'off' ? 'off' : 'beat')) })
      return
    }
    const channel = group.channels[rowAt(y)]
    if (!channel) {
      if (isTouch) startPan()
      return
    }
    set({ channelId: channel.id })
    const top = RULER_H + rowAt(y) * ROW_H
    event.currentTarget.setPointerCapture(event.pointerId)
    // Com o dedo os alvos são maiores e o arraste só começa depois de alguns pixels.
    const reach = isTouch ? POINT_R + 12 : POINT_R + 3
    const edgePx = isTouch ? EDGE_PX_TOUCH : EDGE_PX

    if (tool === 'automation') {
      const kind = laneOf(channel)
      const points = lanePoints(channel, kind)
      const valueAt = (py: number) => Math.min(1, Math.max(0, 1 - (py - top - 6) / (ROW_H - 12)))
      const yOf = (value: number) => top + 6 + (1 - value) * (ROW_H - 12)
      let index = points.findIndex(
        (point) => Math.hypot(xOf(point.beat) - x, yOf(point.value) - y) <= reach,
      )
      let next = points
      let edited = false
      if (index >= 0 && isTouch) {
        // Toque duplo no mesmo ponto apaga; segurar parado troca a curva.
        const tapKey = `${channel.id}:${kind}:${index}`
        const now = Date.now()
        if (lastTap.current?.key === tapKey && now - lastTap.current.time < DOUBLE_TAP_MS) {
          lastTap.current = null
          deletePoint(channel, kind, points, index)
          return
        }
        lastTap.current = { key: tapKey, time: now }
        const hitIndex = index
        longPress.current = window.setTimeout(() => {
          longPress.current = null
          if (!drag.current || drag.current.moved) return
          drag.current = null
          lastTap.current = null
          cyclePointCurve(channel, kind, points, hitIndex)
          navigator.vibrate?.(10)
        }, LONG_PRESS_MS)
      }
      if (index < 0) {
        const point: Point = { beat: snapBeat(beat, snap), value: valueAt(y), curve: 'linear' }
        next = [...points, point].sort((a, b) => a.beat - b.beat)
        index = next.indexOf(point)
        edited = true
        edit(
          (p) =>
            updateGroup(p, group.id, (g) =>
              updateChannel(g, channel.id, (c) => setLanePoints(c, kind, next)),
            ),
          key,
        )
      }
      drag.current = {
        ...base,
        kind: 'point',
        channelId: channel.id,
        laneKind: kind,
        pointIndex: index,
        points: next,
        edited,
        touch: isTouch,
      }
      return
    }

    const x0 = xOf(channel.clip.startBeat)
    const x1 = xOf(channelEndBeat(channel))
    const kind: Drag['kind'] =
      Math.abs(x - x0) <= edgePx ? 'trim-start' : Math.abs(x - x1) <= edgePx ? 'trim-end' : 'move'
    if (kind === 'move' && (x < x0 || x > x1)) {
      // Com o dedo, arrastar o fundo rola a linha do tempo (no mouse é Alt+arrastar).
      if (isTouch) startPan()
      return
    }
    drag.current = {
      ...base,
      kind,
      channelId: channel.id,
      originStart: channel.clip.startBeat,
      touch: isTouch,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localPoint(event)
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x, y: event.clientY })
      if (pinch.current) {
        movePinch()
        return
      }
    }
    const current = drag.current
    if (!current) {
      if (event.pointerType !== 'mouse') return
      // Cursor de acordo com o que está embaixo do mouse.
      const channel = group.channels[rowAt(y)]
      let cursor = 'default'
      if (y >= RULER_H && channel && tool === 'clips') {
        const x0 = xOf(channel.clip.startBeat)
        const x1 = xOf(channelEndBeat(channel))
        if (Math.abs(x - x0) <= EDGE_PX || Math.abs(x - x1) <= EDGE_PX) cursor = 'ew-resize'
        else if (x > x0 && x < x1) cursor = 'grab'
      } else if (y >= RULER_H && tool === 'automation') cursor = 'crosshair'
      event.currentTarget.style.cursor = cursor
      return
    }
    if (!current.moved) {
      const slop = current.touch ? TOUCH_SLOP_PX : 0
      if (Math.hypot(x - current.originX, y - current.originY) <= slop) return
      current.moved = true
      cancelLongPress()
      lastTap.current = null
    }
    if (current.kind === 'pan') {
      setScrollBeat((current.originScroll ?? 0) - (x - current.originX) / pxPerBeat)
      const box = current.originScrollTop !== undefined ? scroller() : null
      if (box && current.originScrollTop !== undefined)
        box.scrollTop = current.originScrollTop - (event.clientY - (current.originClientY ?? 0))
      return
    }
    current.edited = true
    const beat = beatOf(x)
    const channel = group.channels.find((candidate) => candidate.id === current.channelId)
    if (!channel) return
    if (
      current.kind === 'point' &&
      current.laneKind &&
      current.points &&
      current.pointIndex !== undefined
    ) {
      const row = group.channels.indexOf(channel)
      const top = RULER_H + row * ROW_H
      const value = Math.min(1, Math.max(0, 1 - (y - top - 6) / (ROW_H - 12)))
      const original = current.points[current.pointIndex]
      if (!original) return
      const moved = { ...original, beat: snapBeat(beat, snap), value }
      const next = current.points.map((point, i) => (i === current.pointIndex ? moved : point))
      const kind = current.laneKind
      edit(
        (p) =>
          updateGroup(p, group.id, (g) =>
            updateChannel(g, channel.id, (c) => setLanePoints(c, kind, next)),
          ),
        current.key,
      )
      return
    }
    const track = project.tracks.find((candidate) => candidate.id === channel.trackId)
    if (current.kind === 'move') {
      const start = Math.max(0, snapBeat(current.originStart + beat - current.originBeat, snap))
      edit((p) => updateGroup(p, group.id, (g) => moveClip(g, channel.id, start)), current.key)
    } else {
      const maxOut = track ? Math.floor(trackBeats(track)) : channel.clip.outBeat
      const edge = current.kind === 'trim-start' ? 'start' : 'end'
      edit(
        (p) =>
          updateGroup(p, group.id, (g) =>
            trimClip(g, channel.id, edge, snapBeat(beat, snap), maxOut),
          ),
        current.key,
      )
    }
  }

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    cancelLongPress()
    if (touches.current.delete(event.pointerId) && pinch.current) {
      // Tirar um dos dois dedos encerra o gesto; o que sobrou não começa outro arraste.
      if (touches.current.size < 2) pinch.current = null
      return
    }
    drag.current = null
  }

  /** Dois cliques num ponto apaga; botão direito troca a curva do trecho que começa nele. */
  const pointAt = (event: {
    clientX: number
    clientY: number
    currentTarget: HTMLCanvasElement
  }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const row = rowAt(y)
    const channel = group.channels[row]
    if (!channel || tool !== 'automation') return null
    const kind = laneOf(channel)
    const top = RULER_H + row * ROW_H
    const points = lanePoints(channel, kind)
    const index = points.findIndex(
      (point) =>
        Math.hypot(xOf(point.beat) - x, top + 6 + (1 - point.value) * (ROW_H - 12) - y) <=
        POINT_R + 3,
    )
    return index < 0 ? null : { channel, kind, points, index }
  }

  // No toque esses dois gestos já foram tratados no pointerdown (toque duplo e segurar).
  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (lastPointer.current === 'touch') return
    const hit = pointAt(event)
    if (hit) deletePoint(hit.channel, hit.kind, hit.points, hit.index)
  }

  const onContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (lastPointer.current === 'touch') {
      event.preventDefault()
      return
    }
    const hit = pointAt(event)
    if (!hit) return
    event.preventDefault()
    cyclePointCurve(hit.channel, hit.kind, hit.points, hit.index)
  }

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    if (event.ctrlKey || event.metaKey) {
      const anchor = beatOf(x)
      const zoom = Math.min(80, Math.max(0.5, pxPerBeat * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
      setPxPerBeat(zoom)
      setScrollBeat(anchor - x / zoom)
      return
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    setScrollBeat((s) => Math.max(-16, s + delta / pxPerBeat))
  }

  const zoomBy = (factor: number) => {
    const center = beatOf(width / 2)
    const zoom = Math.min(80, Math.max(0.5, pxPerBeat * factor))
    setPxPerBeat(zoom)
    setScrollBeat(center - width / 2 / zoom)
  }

  const fit = () => {
    const end = Math.max(16, ...group.channels.map(channelEndBeat))
    const zoom = Math.min(80, Math.max(0.5, (width - 20) / (end + 8)))
    setPxPerBeat(zoom)
    setScrollBeat(-4)
  }

  return (
    <div className="timeline">
      <div className="timeline-tools">
        <div className="segmented" role="group" aria-label="Ferramenta">
          <button
            className={tool === 'clips' ? 'on' : ''}
            onClick={() => set({ tool: 'clips' })}
            title="Arrastar e aparar clips (C)"
          >
            Clips
          </button>
          <button
            className={tool === 'automation' ? 'on' : ''}
            onClick={() => set({ tool: 'automation' })}
            title="Editar pontos de automação (A)"
          >
            Automação
          </button>
        </div>
        <label>
          Snap
          <select value={snap} onChange={(e) => set({ snap: e.target.value as typeof snap })}>
            <option value="bar">compasso</option>
            <option value="beat">batida</option>
            <option value="off">livre</option>
          </select>
        </label>
        <button onClick={() => zoomBy(1 / 1.5)} title="Afastar">
          −
        </button>
        <button onClick={() => zoomBy(1.5)} title="Aproximar">
          +
        </button>
        <button onClick={fit} title="Mostrar o grupo inteiro">
          Ajustar
        </button>
        <span className="hint">
          {touch
            ? tool === 'automation'
              ? 'Toque cria ponto · arraste move · toque duplo apaga · segure para trocar a curva · dois dedos rolam e aproximam'
              : 'Arraste o clip para mover · bordas aparam · toque na régua posiciona o cursor · arraste o fundo ou use dois dedos para rolar e aproximar'
            : tool === 'automation'
              ? 'Clique cria ponto · arraste move · dois cliques apaga · botão direito troca a curva'
              : 'Arraste o clip para mover · bordas aparam · clique na régua posiciona o cursor · Alt+arrastar rola'}
        </span>
      </div>
      <div className="timeline-body">
        <div className="timeline-headers" style={{ paddingTop: RULER_H }}>
          {group.channels.map((channel, row) => (
            <ChannelHeader
              key={channel.id}
              group={group}
              channel={channel}
              track={tracks.get(channel.trackId) as Track | undefined}
              color={COLORS[row % COLORS.length] ?? '#3d7bd9'}
              lane={laneOf(channel)}
            />
          ))}
        </div>
        <div className="timeline-canvas" ref={wrapRef} style={{ height }}>
          <canvas
            ref={canvasRef}
            data-testid="timeline"
            style={{ width, height }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onWheel={onWheel}
          />
          <canvas ref={overlayRef} className="overlay" style={{ width, height }} />
        </div>
      </div>
    </div>
  )
}
