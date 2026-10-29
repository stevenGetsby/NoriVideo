'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Maximize2, Pause, Play, Volume2, VolumeX } from '@/components/ui/icons'
import { attachMediaPlayer, recallPlayback, rememberPlayback } from '../media-playback'

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
  onLoadedData,
  onError,
}: {
  src: string
  poster?: string
  fit?: 'contain' | 'cover'
  onExpand?: () => void
  onLoadedData?: () => void
  onError?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const resume = useRef(recallPlayback(src))
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  const remember = (video: HTMLVideoElement, playingNow = !video.paused && !video.ended) => rememberPlayback(src, video.currentTime, playingNow)

  useEffect(() => {
    const video = videoRef.current
    return video ? attachMediaPlayer(src, video) : undefined
  }, [src])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused || video.ended) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }

  return (
    <div className={`nori-canvas-video${playing ? ' is-playing' : ''}${fit === 'cover' ? ' is-cover' : ''}`}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        draggable={false}
        onPlay={(event) => { setPlaying(true); remember(event.currentTarget) }}
        onPause={(event) => { setPlaying(false); remember(event.currentTarget, false) }}
        onEnded={() => { setPlaying(false); rememberPlayback(src, 0, false); setTime(0) }}
        onTimeUpdate={(event) => { setTime(event.currentTarget.currentTime); remember(event.currentTarget) }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          setDuration(video.duration)
          const start = resume.current
          resume.current = undefined
          // A card that remounts (reload, reference preview) picks up the last watched spot.
          if (start && start.time > 0 && (!video.duration || start.time < video.duration - 0.05)) {
            video.currentTime = start.time
            setTime(start.time)
          }
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onLoadedData={onLoadedData}
        onError={onError}
      />
      <button
        type="button"
        className="nori-canvas-video-toggle nodrag"
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停' : '播放'}
        onClick={(event) => { event.stopPropagation(); toggle() }}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <div className="nori-canvas-video-bar nodrag nowheel" onClick={(event) => event.stopPropagation()}>
        <span>{formatTime(time)} / {formatTime(duration)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(time, duration || 0)}
          aria-label="播放进度"
          style={{ '--nori-video-progress': `${progress}%` } as CSSProperties}
          onChange={(event) => {
            const video = videoRef.current
            const next = Number(event.target.value)
            if (!video || !Number.isFinite(next)) return
            video.currentTime = next
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
