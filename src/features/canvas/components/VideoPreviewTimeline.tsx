'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Film, Music2, VolumeX } from '@/components/ui/icons'
import Diamond from '@/components/ui/icons/ph/diamond'
import type { CanvasVideoKeyframe } from '../types'
import { SampleCancelledError, type VideoFrameSampler } from '../video-frame-sampler'
import {
  previewAudioIsSilent, previewAudioPeaks, previewClock, previewFilmstripTiles, previewFrameIndex, previewFrameStart,
  previewLastFrameTime, previewRulerTicks, previewTimecode, snapPreviewTime,
} from '../video-preview-timeline'

const INSET = 12
const HOVER_CARD_WIDTH = 216
const SNAP_PX = 8
const DRAG_THRESHOLD_PX = 3

type ZoomAnchor = { time: number; offset: number }

function wavePath(peaks: number[]) {
  if (!peaks.length) return ''
  const last = Math.max(1, peaks.length - 1)
  const top = peaks.map((peak, index) => `${(index / last * 1000).toFixed(1)},${(50 - peak * 47).toFixed(1)}`)
  const bottom = peaks.map((peak, index) => `${(index / last * 1000).toFixed(1)},${(50 + peak * 47).toFixed(1)}`).reverse()
  return `M${top.join('L')}L${bottom.join('L')}Z`
}

function nearestThumb(keys: number[], thumbs: Record<number, string>, frame: number) {
  if (thumbs[frame]) return thumbs[frame]
  if (!keys.length) return ''
  let low = 0
  let high = keys.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (keys[middle] < frame) low = middle + 1
    else high = middle
  }
  const before = keys[Math.max(0, low - 1)]
  const after = keys[low]
  return thumbs[Math.abs(before - frame) <= Math.abs(after - frame) ? before : after]
}

export function VideoPreviewTimeline({
  src, title, duration, fps, currentTime, playing, aspect, zoom, keyframes, selectedKeyframeId, readOnly, snapping, hoverPreview, muted, sampler,
  onViewportWidth, onZoom, onSeek, onSelectKeyframe, onMoveKeyframe, onToggleMute,
}: {
  src: string
  title: string
  duration: number
  fps: number
  currentTime: number
  playing: boolean
  aspect: number
  zoom: number
  keyframes: CanvasVideoKeyframe[]
  selectedKeyframeId: string | null
  readOnly: boolean
  snapping: boolean
  hoverPreview: boolean
  muted: boolean
  sampler: VideoFrameSampler | null
  onViewportWidth: (width: number) => void
  onZoom: (zoom: number) => void
  onSeek: (seconds: number) => void
  onSelectKeyframe: (id: string | null) => void
  onMoveKeyframe: (id: string, seconds: number) => void
  onToggleMute: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const filmRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [filmHeight, setFilmHeight] = useState(56)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)
  const [hoverImage, setHoverImage] = useState<{ frame: number; url: string } | null>(null)
  const [markerDrag, setMarkerDrag] = useState<{ id: string; time: number } | null>(null)
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [filmUnavailable, setFilmUnavailable] = useState(false)
  const [waveform, setWaveform] = useState<number[]>([])
  const [waveformState, setWaveformState] = useState<'loading' | 'ready' | 'empty'>('loading')
  const scrubRef = useRef(false)
  const markerRef = useRef<{ id: string; startX: number; moved: boolean } | null>(null)
  const hoverCacheRef = useRef(new Map<number, string>())
  const hoverFrameRef = useRef(-1)
  const anchorRef = useRef<ZoomAnchor | null>(null)
  const geometryRef = useRef({ pps: 0 })
  const scrollFrameRef = useRef(0)
  const latest = useRef({ zoom, duration, currentTime })
  latest.current = { zoom, duration, currentTime }

  const trackWidth = Math.max(1, (viewportWidth - INSET * 2) * zoom)
  const pps = duration > 0 ? trackWidth / duration : 0
  const lastFrame = previewLastFrameTime(duration, fps)
  const xOf = useCallback((time: number) => INSET + time * pps, [pps])
  const tileWidth = Math.max(32, Math.min(180, filmHeight * (aspect || 16 / 9)))
  const tiles = useMemo(() => previewFilmstripTiles(duration, trackWidth, tileWidth), [duration, tileWidth, trackWidth])
  const visibleStart = scrollLeft - INSET - viewportWidth * 0.5
  const visibleEnd = scrollLeft + viewportWidth * 1.5
  const visibleTiles = useMemo(() => tiles.filter((tile) => tile.left + tile.width >= visibleStart && tile.left <= visibleEnd), [tiles, visibleEnd, visibleStart])
  const thumbKeys = useMemo(() => Object.keys(thumbs).map(Number).sort((a, b) => a - b), [thumbs])
  const ticks = useMemo(() => previewRulerTicks(duration, pps, fps).filter((tick) => {
    const x = INSET + tick.time * pps
    return x >= scrollLeft - 80 && x <= scrollLeft + viewportWidth + 80
  }), [duration, fps, pps, scrollLeft, viewportWidth])
  const path = useMemo(() => wavePath(waveform), [waveform])
  const silent = waveformState === 'ready' && previewAudioIsSilent(waveform)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => {
      setViewportWidth(viewport.clientWidth)
      onViewportWidth(viewport.clientWidth)
      if (filmRef.current) setFilmHeight(filmRef.current.clientHeight || 56)
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [onViewportWidth])

  useEffect(() => {
    setThumbs({})
    setFilmUnavailable(false)
    hoverCacheRef.current.clear()
    hoverFrameRef.current = -1
    setHoverImage(null)
  }, [sampler])

  useEffect(() => {
    if (!sampler || filmUnavailable || !visibleTiles.length) return
    sampler.cancel('film')
    const center = scrollLeft + viewportWidth / 2
    const width = Math.min(320, Math.round(tileWidth * 2))
    const height = Math.max(1, Math.round(width / (aspect || 16 / 9)))
    const missing = visibleTiles
      .map((tile) => ({ frame: previewFrameIndex(tile.time, fps), time: tile.time, distance: Math.abs(tile.left + tile.width / 2 - center) }))
      .filter((tile, index, list) => !thumbs[tile.frame] && list.findIndex((item) => item.frame === tile.frame) === index)
      .sort((a, b) => a.distance - b.distance)
    for (const tile of missing) {
      sampler.image(previewFrameStart(tile.frame, fps) + 0.001, width, height, { priority: 1, tag: 'film' })
        .then((url) => setThumbs((current) => ({ ...current, [tile.frame]: url })))
        .catch((error) => { if (!(error instanceof SampleCancelledError)) setFilmUnavailable(true) })
    }
    // Thumbnails are intentionally excluded: each arrival would otherwise cancel and requeue the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, filmUnavailable, fps, sampler, tileWidth, visibleTiles])

  useEffect(() => {
    let cancelled = false
    let closed = false
    let context: AudioContext | undefined
    const close = async () => {
      if (closed) return
      closed = true
      await context?.close().catch(() => {})
    }
    setWaveform([])
    setWaveformState('loading')
    fetch(src)
      .then((response) => {
        if (!response.ok) throw Error('audio unavailable')
        return response.arrayBuffer()
      })
      .then((buffer) => {
        if (cancelled) throw Error('cancelled')
        const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Context) throw Error('audio unavailable')
        context = new Context()
        return context.decodeAudioData(buffer).then((audio) => {
          const peaks = previewAudioPeaks(audio, Math.max(300, Math.min(4000, Math.round(audio.duration * 60))))
          return close().then(() => peaks)
        }).catch(async (error) => {
          await close()
          throw error
        })
      })
      .then((peaks) => {
        if (cancelled) return
        setWaveform(peaks)
        setWaveformState('ready')
      })
      .catch(() => { if (!cancelled) setWaveformState('empty') })
    return () => { cancelled = true; void close() }
  }, [src])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const previous = geometryRef.current.pps
    geometryRef.current.pps = pps
    if (!viewport || !previous || previous === pps) return
    const time = latest.current.currentTime
    const playheadX = INSET + time * previous - viewport.scrollLeft
    const anchor = anchorRef.current ?? { time, offset: playheadX >= 0 && playheadX <= viewport.clientWidth ? playheadX : viewport.clientWidth / 2 }
    anchorRef.current = null
    viewport.scrollLeft = Math.max(0, INSET + anchor.time * pps - anchor.offset)
    setScrollLeft(viewport.scrollLeft)
  }, [pps])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || scrubRef.current || !pps) return
    const x = INSET + currentTime * pps
    if (x < viewport.scrollLeft + 8 || x > viewport.scrollLeft + viewport.clientWidth - 40) {
      viewport.scrollLeft = Math.max(0, playing ? x - 40 : x - viewport.clientWidth / 2)
    }
  }, [currentTime, playing, pps])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => {
      const { zoom: currentZoom, duration: total } = latest.current
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        if (!total) return
        const rect = viewport.getBoundingClientRect()
        const offset = event.clientX - rect.left
        const scale = geometryRef.current.pps || 1
        anchorRef.current = { time: Math.max(0, Math.min(total, (offset + viewport.scrollLeft - INSET) / scale)), offset }
        onZoom(currentZoom * Math.exp(-event.deltaY * 0.0022))
        return
      }
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && viewport.scrollWidth > viewport.clientWidth) {
        event.preventDefault()
        viewport.scrollLeft += event.deltaY
      }
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [onZoom])

  const timeAt = (clientX: number) => {
    const viewport = viewportRef.current
    if (!viewport || !pps) return 0
    const rect = viewport.getBoundingClientRect()
    return Math.max(0, Math.min(duration, (clientX - rect.left + viewport.scrollLeft - INSET) / pps))
  }

  const settle = (time: number, targets: number[]) => {
    const snapped = snapping && pps ? snapPreviewTime(time, targets, SNAP_PX / pps) : time
    return Math.min(lastFrame, previewFrameStart(Math.round(snapped * fps), fps))
  }

  const keyframeTimes = keyframes.map((keyframe) => keyframe.time)
  const scrubTo = (clientX: number) => onSeek(settle(timeAt(clientX), [...keyframeTimes, 0, lastFrame]))

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !duration) return
    event.preventDefault()
    scrubRef.current = true
    setScrubbing(true)
    setHover(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelectKeyframe(null)
    scrubTo(event.clientX)
  }

  const onViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubRef.current) {
      scrubTo(event.clientX)
      return
    }
    if (!hoverPreview || markerRef.current || !duration || event.pointerType === 'touch') return
    const time = timeAt(event.clientX)
    setHover({ x: INSET + time * pps, time })
    const frame = previewFrameIndex(time, fps)
    const cached = hoverCacheRef.current.get(frame)
    if (cached) {
      setHoverImage({ frame, url: cached })
      return
    }
    if (!sampler || hoverFrameRef.current === frame) return
    hoverFrameRef.current = frame
    const width = 224
    sampler.image(previewFrameStart(frame, fps) + 0.001, width, Math.round(width / (aspect || 16 / 9)), { priority: 3, tag: 'hover', latestOnly: true })
      .then((url) => {
        const cache = hoverCacheRef.current
        cache.set(frame, url)
        if (cache.size > 80) cache.delete(cache.keys().next().value as number)
        if (hoverFrameRef.current === frame) setHoverImage({ frame, url })
      })
      .catch(() => {})
  }

  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    scrubRef.current = false
    setScrubbing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const markerPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, keyframe: CanvasVideoKeyframe) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    markerRef.current = { id: keyframe.id, startX: event.clientX, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    setHover(null)
  }

  const markerPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = markerRef.current
    if (!drag || readOnly) return
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    const others = keyframes.filter((keyframe) => keyframe.id !== drag.id).map((keyframe) => keyframe.time)
    setMarkerDrag({ id: drag.id, time: settle(timeAt(event.clientX), [...others, currentTime, 0, lastFrame]) })
  }

  const markerPointerUp = (event: ReactPointerEvent<HTMLButtonElement>, keyframe: CanvasVideoKeyframe) => {
    const drag = markerRef.current
    markerRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag?.moved && markerDrag && !readOnly) {
      onMoveKeyframe(keyframe.id, markerDrag.time)
      onSelectKeyframe(keyframe.id)
      onSeek(markerDrag.time)
    } else {
      onSelectKeyframe(keyframe.id)
      onSeek(keyframe.time)
    }
    setMarkerDrag(null)
  }

  const playheadX = xOf(Math.min(duration, currentTime))
  const viewportOffset = viewportRef.current?.offsetLeft ?? 0
  const hoverLeft = hover ? Math.max(8, Math.min(viewportOffset + viewportWidth - HOVER_CARD_WIDTH - 8, viewportOffset + hover.x - scrollLeft - HOVER_CARD_WIDTH / 2)) : 0
  const hoverFrame = hover ? previewFrameIndex(hover.time, fps) : -1

  return <div className={`nori-video-timeline-body${scrubbing ? ' is-scrubbing' : ''}`}>
    <aside className="nori-video-timeline-heads">
      <div className="nori-video-timeline-head is-ruler"><span>{Math.round(fps * 100) / 100} fps</span></div>
      <div className="nori-video-timeline-head is-video"><Film /><span>主轨</span></div>
      <div className="nori-video-timeline-head is-audio">
        <button type="button" className={muted ? 'is-active' : ''} aria-label={muted ? '开启原声' : '关闭原声'} title={muted ? '开启原声' : '关闭原声'} aria-pressed={muted} onClick={onToggleMute}>{muted ? <VolumeX /> : <Music2 />}</button>
        <span>原声</span>
      </div>
      <div className="nori-video-timeline-head is-keyframes"><Diamond /><span>{keyframes.length}</span></div>
    </aside>
    <div
      ref={viewportRef}
      className="nori-video-timeline-viewport"
      onScroll={(event) => {
        const target = event.currentTarget
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = requestAnimationFrame(() => setScrollLeft(target.scrollLeft))
      }}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onPointerLeave={() => { if (!scrubRef.current) { setHover(null); hoverFrameRef.current = -1 } }}
    >
      <div className="nori-video-timeline-content" style={{ width: trackWidth + INSET * 2 }}>
        <div className="nori-video-timeline-ruler">
          {ticks.map((tick) => <span key={tick.time} className={tick.major ? 'is-major' : ''} style={{ left: xOf(tick.time) }}>{tick.label ? <time>{tick.label}</time> : null}</span>)}
        </div>
        <div ref={filmRef} className={`nori-video-timeline-clip${filmUnavailable ? ' is-unavailable' : ''}`} style={{ left: INSET, width: trackWidth }}>
          {visibleTiles.map((tile) => {
            const frame = previewFrameIndex(tile.time, fps)
            const image = nearestThumb(thumbKeys, thumbs, frame)
            return <i key={tile.left} className={`nori-video-timeline-tile${thumbs[frame] ? ' is-ready' : ''}`} style={{ left: tile.left, width: tile.width, backgroundImage: image ? `url(${JSON.stringify(image)})` : undefined }} />
          })}
          <span className="nori-video-timeline-clip-label"><Film /><b>{title}</b><small>{previewClock(duration)}</small></span>
          {keyframes.filter((keyframe) => keyframe.kind === 'shot').map((keyframe) => <i key={keyframe.id} className="nori-video-timeline-cut" style={{ left: keyframe.time * pps }} />)}
        </div>
        <div className={`nori-video-timeline-wave is-${silent ? 'silent' : waveformState}${muted ? ' is-muted' : ''}`} style={{ left: INSET, width: trackWidth }}>
          {waveformState === 'ready' && !silent
            // eslint-disable-next-line no-restricted-syntax -- This SVG is an audio waveform chart, not an interface icon.
            ? <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
            : <span>{waveformState === 'loading' ? '正在分析原声…' : silent ? '静音片段' : '此视频没有可显示的音轨'}</span>}
        </div>
        <div className="nori-video-timeline-keyframes">
          {keyframes.map((keyframe, index) => {
            const time = markerDrag?.id === keyframe.id ? markerDrag.time : keyframe.time
            const label = keyframe.kind === 'shot' ? '镜头切换' : '关键帧'
            return <button
              type="button"
              key={keyframe.id}
              className={`is-${keyframe.kind}${selectedKeyframeId === keyframe.id ? ' is-selected' : ''}${markerDrag?.id === keyframe.id ? ' is-dragging' : ''}`}
              style={{ left: xOf(time) }}
              aria-label={`查看关键帧 ${index + 1}`}
              title={`${label} ${index + 1} · ${previewTimecode(time, fps)}${readOnly ? '' : ' · 拖动可调整位置'}`}
              onPointerDown={(event) => markerPointerDown(event, keyframe)}
              onPointerMove={markerPointerMove}
              onPointerUp={(event) => markerPointerUp(event, keyframe)}
              onPointerCancel={() => { markerRef.current = null; setMarkerDrag(null) }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelectKeyframe(keyframe.id); onSeek(keyframe.time) } }}
            ><Diamond /></button>
          })}
          {!keyframes.length ? <span className="nori-video-timeline-empty">按 K 或点击「关键帧」在播放头处添加标记</span> : null}
        </div>
        {hover && !scrubbing ? <i className="nori-video-timeline-ghost" style={{ left: hover.x }} /> : null}
        <div className={`nori-video-timeline-playhead${playing ? ' is-playing' : ''}`} style={{ left: playheadX }}><b /><i /></div>
      </div>
    </div>
    {hover && hoverPreview && !scrubbing ? <figure className="nori-video-timeline-hover" style={{ left: hoverLeft }} aria-hidden="true">
      <div style={{ aspectRatio: String(aspect || 16 / 9), backgroundImage: hoverImage ? `url(${JSON.stringify(hoverImage.url)})` : undefined }} className={hoverImage?.frame === hoverFrame ? 'is-ready' : ''} />
      <figcaption>{previewTimecode(hover.time, fps)}<small>第 {hoverFrame + 1} 帧</small></figcaption>
    </figure> : null}
  </div>
}
