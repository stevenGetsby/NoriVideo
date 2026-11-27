'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Maximize2, Pause, Play, Volume2, VolumeX } from '@/components/ui/icons'
import { attachMediaPlayer, pauseOtherMedia, recallPlayback, rememberPlayback } from '../media-playback'

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

// Native <video controls> must be nodrag, which made the whole card undraggable.
// The surface stays a drag target; only the play button and hover bar are nodrag.
export function CanvasNodeVideo({
  src,
  poster,
  fit = 'contain',
  onExpand,
  autoPlay = false,
  onLoadedData,
  onError,
  onOffscreenPause,
  onPlayingChange,
}: {
  src: string
  poster?: string
  fit?: 'contain' | 'cover'
  onExpand?: () => void
  autoPlay?: boolean
  onLoadedData?: () => void
  onError?: () => void
  onOffscreenPause?: () => void
  onPlayingChange?: (playing: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const displaySecondRef = useRef(0)
  const onOffscreenPauseRef = useRef(onOffscreenPause)
  onOffscreenPauseRef.current = onOffscreenPause
  const onPlayingChangeRef = useRef(onPlayingChange)
  onPlayingChangeRef.current = onPlayingChange
  const resume = useRef(recallPlayback(src))
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  const remember = (video: HTMLVideoElement, playingNow = !video.paused && !video.ended) => rememberPlayback(src, video.currentTime, playingNow)
  const paintRange = (currentTime: number, totalDuration: number) => {
    const input = rangeRef.current
    if (!input) return
    const clamped = totalDuration > 0 ? Math.min(currentTime, totalDuration) : 0
    const pct = totalDuration > 0 ? Math.min(100, (clamped / totalDuration) * 100) : 0
    input.value = String(clamped)
    input.style.setProperty('--nori-video-progress', `${pct}%`)
  }

  useEffect(() => {
    const video = videoRef.current
    // Regenerated videos swap src in place (stable node id), so re-recall the new file's watched spot.
    resume.current = recallPlayback(src)
    return video ? attachMediaPlayer(src, video) : undefined
  }, [src])

  useEffect(() => {
    const video = videoRef.current
    if (autoPlay && video) void video.play().catch(() => setPlaying(false))
  }, [autoPlay])

  useEffect(() => {
    onPlayingChangeRef.current?.(playing)
  }, [playing])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry || entry.isIntersecting) return
      const video = videoRef.current
      if (video && !video.paused) {
        video.pause()
        rememberPlayback(src, video.currentTime, false)
      }
      onOffscreenPauseRef.current?.()
    }, { threshold: 0 })
    observer.observe(container)
    return () => observer.disconnect()
  }, [src])

  useEffect(() => {
    if (!playing) return
    const video = videoRef.current
    if (!video) return
    let frame = 0
    let lastTime = -1
    const update = () => {
      const currentTime = video.currentTime
      if (currentTime !== lastTime) {
        lastTime = currentTime
        const total = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
        paintRange(currentTime, total)
        const wholeSecond = Math.floor(currentTime)
        if (wholeSecond !== displaySecondRef.current) {
          displaySecondRef.current = wholeSecond
          setTime(currentTime)
          rememberPlayback(src, currentTime, !video.paused && !video.ended)
        }
      }
      if (!video.paused && !video.ended) frame = window.requestAnimationFrame(update)
    }
    update()
    return () => window.cancelAnimationFrame(frame)
  }, [playing, src])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused || video.ended) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }

  return (
    <div ref={containerRef} className={`nori-canvas-video${playing ? ' is-playing' : ''}${fit === 'cover' ? ' is-cover' : ''}`}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        draggable={false}
        onPlay={(event) => { setPlaying(true); remember(event.currentTarget); pauseOtherMedia(src) }}
        onPause={(event) => {
          const video = event.currentTarget
          setPlaying(false)
          displaySecondRef.current = Math.floor(video.currentTime)
          setTime(video.currentTime)
          paintRange(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0)
          remember(video, false)
        }}
        onEnded={() => { setPlaying(false); displaySecondRef.current = 0; rememberPlayback(src, 0, false); setTime(0); paintRange(0, duration) }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          const currentTime = video.currentTime
          const wholeSecond = Math.floor(currentTime)
          if (video.paused || wholeSecond !== displaySecondRef.current) {
            displaySecondRef.current = wholeSecond
            setTime(currentTime)
            paintRange(currentTime, Number.isFinite(video.duration) ? video.duration : 0)
            remember(video)
          }
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          setDuration(video.duration)
          const start = resume.current
          resume.current = undefined
          // A card that remounts (reload, reference preview) picks up the last watched spot.
          if (start && start.time > 0 && (!video.duration || start.time < video.duration - 0.05)) {
            video.currentTime = start.time
            displaySecondRef.current = Math.floor(start.time)
            setTime(start.time)
            paintRange(start.time, video.duration)
          }
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onLoadedData={onLoadedData}
        onError={onError}
      />
      <button
        type="button"
        className="nori-canvas-video-toggle nori-force-dark nodrag"
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停' : '播放'}
        onClick={(event) => { event.stopPropagation(); toggle() }}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <div className="nori-canvas-video-bar nori-force-dark nodrag nowheel" onClick={(event) => event.stopPropagation()}>
        <span>{formatTime(time)} / {formatTime(duration)}</span>
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          defaultValue={Math.min(time, duration || 0)}
          aria-label="播放进度"
          style={{ '--nori-video-progress': `${progress}%` } as CSSProperties}
          onChange={(event) => {
            const video = videoRef.current
            const next = Number(event.target.value)
            if (!video || !Number.isFinite(next)) return
            video.currentTime = next
            displaySecondRef.current = Math.floor(next)
            paintRange(next, duration)
            setTime(next)
          }}
        />
        <button
          type="button"
          aria-label={muted ? '取消静音' : '静音'}
          title={muted ? '取消静音' : '静音'}
          onClick={() => {
            const video = videoRef.current
            if (!video) return
            video.muted = !muted
            setMuted(!muted)
          }}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
        {onExpand ? <button type="button" aria-label="放大预览" title="放大预览" onClick={onExpand}><Maximize2 /></button> : null}
      </div>
    </div>
  )
}
