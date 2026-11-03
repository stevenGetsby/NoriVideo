'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Camera, ChevronLeft, ChevronRight, Eye, ImageIcon, ListVideo, LoaderCircle, Maximize2, Minimize2, Minus, Pause, Play, Plus, Sparkles, Trash2, Volume2, VolumeX, X } from '@/components/ui/icons'
import { createIcon } from '@/components/ui/icons/ph/createIcon'
import Diamond from '@/components/ui/icons/ph/diamond'
import Repeat from '@/components/ui/icons/ph/arrows-clockwise'
import FitWidth from '@/components/ui/icons/ph/arrows-in-simple'
import type { CanvasVideoKeyframe } from '../types'
import { attachMediaPlayer, handOffMediaPlayback, rememberPlayback, syncMediaPlayers } from '../media-playback'
import { captureVideoFrame } from '../video-frame-capture'
import { SampleCancelledError, VideoFrameSampler } from '../video-frame-sampler'
import { detectVideoFps } from '../video-fps'
import {
  adjacentPreviewKeyframe, detectPreviewShotBoundaries, mergePreviewKeyframes, normalizePreviewKeyframes, PREVIEW_FPS, previewFrameCount,
  previewFrameDifference, previewFrameIndex, previewFrameStart, previewLastFrameTime, previewMaxZoom, previewSeekTime, previewSliderFromZoom,
  previewTimecode, previewZoomFromSlider, safePreviewFps,
} from '../video-preview-timeline'
import { VideoPreviewTimeline } from './VideoPreviewTimeline'

const Magnet = createIcon('Magnet', 'M48,48H96V128A32,32,0,0,0,160,128V48h48v80a80,80,0,0,1-160,0ZM64,64V96H80V64Zm112,0V96h16V64Z')
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

function ratioLabel(width: number, height: number) {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
  const divisor = gcd(width, height) || 1
  return width / divisor <= 32 ? `${width / divisor}:${height / divisor}` : `${(width / height).toFixed(2)}:1`
}

function editableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'))
}

export function VideoPreviewWorkspace({ src, poster, title, readOnly, fpsHint, keyframes: storedKeyframes, onKeyframesChange, onCaptureFrame, onMessage }: {
  src: string
  poster?: string
  title: string
  readOnly: boolean
  fpsHint?: unknown
  keyframes?: unknown
  onKeyframesChange?: (keyframes: CanvasVideoKeyframe[]) => void
  onCaptureFrame?: (file: File) => Promise<void>
  onMessage: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null)
  const [detectedFps, setDetectedFps] = useState<number | null>(null)
  const [rate, setRate] = useState(1)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [loop, setLoop] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [zoom, setZoomState] = useState(1)
  const [timelineWidth, setTimelineWidth] = useState(900)
  const [snapping, setSnapping] = useState(true)
  const [hoverPreview, setHoverPreview] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 1000)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'current' | 'batch' | null>(null)
  const [detectProgress, setDetectProgress] = useState<number | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())
  const [keyThumbs, setKeyThumbs] = useState<Record<number, string>>({})
  const [sampler, setSampler] = useState<VideoFrameSampler | null>(null)
  const persisted = useMemo(() => normalizePreviewKeyframes(storedKeyframes), [storedKeyframes])
  const [keyframes, setKeyframes] = useState(persisted)
  const keyframesRef = useRef(keyframes)
  keyframesRef.current = keyframes
  const detectionRef = useRef<{ cancelled: boolean; sampler: VideoFrameSampler } | null>(null)
  const requestedThumbsRef = useRef(new Set<number>())

  const hintedFps = Number(fpsHint) > 0 ? safePreviewFps(fpsHint) : null
  const fps = detectedFps ?? hintedFps ?? PREVIEW_FPS
  const fpsSource = detectedFps ? '实测' : hintedFps ? '生成参数' : '默认'
  const aspect = videoSize ? videoSize.width / videoSize.height : 16 / 9
  const lastFrame = previewLastFrameTime(duration, fps)
  const currentFrame = previewFrameIndex(currentTime, fps)
  const activeKeyframe = keyframes.find((keyframe) => previewFrameIndex(keyframe.time + 1e-4, fps) === currentFrame) || null
  const maxZoom = previewMaxZoom(duration, timelineWidth, fps)
  const maxZoomRef = useRef(maxZoom)
  maxZoomRef.current = maxZoom
  const canSave = Boolean(onCaptureFrame) && !readOnly

  useEffect(() => setKeyframes(persisted), [persisted])

  const commitKeyframes = useCallback((next: CanvasVideoKeyframe[]) => {
    const normalized = normalizePreviewKeyframes(next)
    keyframesRef.current = normalized
    setKeyframes(normalized)
    if (!readOnly) onKeyframesChange?.(normalized)
  }, [onKeyframesChange, readOnly])

  useEffect(() => {
    const instance = new VideoFrameSampler(src)
    setSampler(instance)
    requestedThumbsRef.current.clear()
    setKeyThumbs({})
    return () => { instance.dispose(); setSampler(null) }
  }, [src])

  useEffect(() => {
    const controller = new AbortController()
    setDetectedFps(null)
    void detectVideoFps(src, controller.signal).then((value) => { if (!controller.signal.aborted && value) setDetectedFps(value) })
    return () => controller.abort()
  }, [src])

  useEffect(() => () => {
    if (!detectionRef.current) return
    detectionRef.current.cancelled = true
    detectionRef.current.sampler.dispose()
  }, [])

  // Opening the preview takes over the card's playback: the card pauses and the enlarged
  // player continues from the same second instead of replaying from the start.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const start = handOffMediaPlayback(src, video)
    const detach = attachMediaPlayer(src, video)
    const apply = () => {
      const resumable = start && start.time > 0 && (!video.duration || start.time < video.duration - 0.05)
      if (resumable) {
        video.currentTime = start.time
        if (start.playing) void video.play().catch(() => {})
        return
      }
      void video.play().catch(() => {})
    }
    if (video.readyState >= 1) apply()
    else video.addEventListener('loadedmetadata', apply, { once: true })
    return () => {
      video.removeEventListener('loadedmetadata', apply)
      if (video.currentTime > 0) rememberPlayback(src, video.currentTime, false)
      detach()
      syncMediaPlayers(src, { keep: video, resume: Boolean(start?.playing) })
    }
  }, [src])

  useEffect(() => {
    const change = () => setFullscreen(Boolean(stageRef.current) && document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])

  useEffect(() => {
    if (!sampler) return
    const width = 160
    const height = Math.max(1, Math.round(width / aspect))
    for (const keyframe of keyframes) {
      const frame = previewFrameIndex(keyframe.time + 1e-4, fps)
      if (requestedThumbsRef.current.has(frame)) continue
      requestedThumbsRef.current.add(frame)
      sampler.image(previewFrameStart(frame, fps) + 0.001, width, height, { priority: 2, tag: 'keyframes' })
        .then((url) => setKeyThumbs((current) => ({ ...current, [frame]: url })))
        .catch(() => requestedThumbsRef.current.delete(frame))
    }
  }, [aspect, fps, keyframes, sampler])

  const setZoom = useCallback((value: number) => {
    setZoomState(Math.max(1, Math.min(maxZoomRef.current, Number.isFinite(value) ? value : 1)))
  }, [])

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(time)) return
    const next = Math.max(0, Math.min(video.duration || duration || time, time))
    video.currentTime = next
    setCurrentTime(next)
  }, [duration])

  const seekFrameTime = (time: number) => seek(previewSeekTime(Math.min(lastFrame, Math.max(0, time)), fps))
  const stepFrames = (frames: number) => {
    const video = videoRef.current
    if (!video || !duration) return
    video.pause()
    const target = Math.max(0, Math.min(previewFrameCount(duration, fps) - 1, previewFrameIndex(video.currentTime, fps) + frames))
    seekFrameTime(previewFrameStart(target, fps))
  }
  const seekKeyframe = (direction: -1 | 1) => {
    if (!duration) return
    seekFrameTime(adjacentPreviewKeyframe(currentTime, keyframes.map((keyframe) => keyframe.time), duration, direction, fps))
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.01)) video.currentTime = 0
    if (video.paused || video.ended) void video.play().catch(() => {})
    else video.pause()
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (!video.muted && video.volume === 0) video.volume = 0.6
  }

  const toggleFullscreen = () => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void stage.requestFullscreen?.().catch(() => onMessage('当前浏览器不支持全屏播放'))
  }

  const toggleKeyframe = () => {
    if (readOnly || !duration) return
    if (activeKeyframe) {
      commitKeyframes(keyframes.filter((keyframe) => keyframe.id !== activeKeyframe.id))
      setSelectedId(null)
      return
    }
    const keyframe: CanvasVideoKeyframe = { id: crypto.randomUUID(), time: previewFrameStart(Math.min(currentFrame, previewFrameCount(duration, fps) - 1), fps), kind: 'manual' }
    commitKeyframes([...keyframes, keyframe])
    setSelectedId(keyframe.id)
  }

  const removeKeyframe = (id: string) => {
    if (readOnly) return
    commitKeyframes(keyframes.filter((keyframe) => keyframe.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const moveKeyframe = useCallback((id: string, time: number) => {
    const frame = previewFrameIndex(time + 1e-4, fps)
    const current = keyframesRef.current
    commitKeyframes(current
      .filter((keyframe) => keyframe.id === id || previewFrameIndex(keyframe.time + 1e-4, fps) !== frame)
      .map((keyframe) => keyframe.id === id ? { ...keyframe, time: previewFrameStart(frame, fps) } : keyframe))
  }, [commitKeyframes, fps])

  const captureCurrent = async () => {
    const video = videoRef.current
    if (!video || !onCaptureFrame || busy) return
    setBusy('current')
    try {
      await onCaptureFrame(await captureVideoFrame(video, undefined, title))
      if (activeKeyframe) setSavedIds((current) => new Set(current).add(activeKeyframe.id))
      onMessage(`已将 ${previewTimecode(video.currentTime, fps)} 的画面保存到画布`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '截取关键帧失败')
    } finally {
      setBusy(null)
    }
  }

  const saveKeyframes = async (targets: CanvasVideoKeyframe[]) => {
    if (!onCaptureFrame || !sampler || busy || !targets.length) return
    setBusy('batch')
    let saved = 0
    try {
      for (const keyframe of targets) {
        if (targets.length > 1) onMessage(`正在保存关键帧 ${saved + 1}/${targets.length}…`)
        const file = await sampler.run(keyframe.time + 0.001, (video) => captureVideoFrame(video, undefined, title), { priority: 4 })
        await onCaptureFrame(file)
        saved += 1
        setSavedIds((current) => new Set(current).add(keyframe.id))
      }
      onMessage(saved === 1 ? '关键帧已保存到画布' : `已将 ${saved} 个关键帧保存到画布`)
    } catch (error) {
      const reason = error instanceof SampleCancelledError ? '保存已中断' : error instanceof Error ? error.message : '关键帧保存失败'
      onMessage(saved ? `已保存 ${saved} 个，${reason}` : reason)
    } finally {
      setBusy(null)
    }
  }

  const detectShots = async () => {
    if (detectionRef.current) {
      detectionRef.current.cancelled = true
      detectionRef.current.sampler.dispose()
      return
    }
    if (!duration || readOnly) return
    const detector = new VideoFrameSampler(src)
    const token = { cancelled: false, sampler: detector }
    detectionRef.current = token
    setDetectProgress(0)
    onMessage('正在逐帧比对画面，识别镜头切换…')
    const read = (time: number) => detector.pixels(previewFrameStart(previewFrameIndex(time + 1e-4, fps), fps) + 0.001, 48, 27)
    try {
      const step = Math.max(0.125, duration / 240)
      const times: number[] = []
      for (let time = 0; time < lastFrame; time += step) times.push(time)
      times.push(lastFrame)
      let previous = await read(times[0])
      const samples: Array<{ time: number; difference: number }> = []
      for (let index = 1; index < times.length; index += 1) {
        const current = await read(times[index])
        samples.push({ time: times[index], difference: previewFrameDifference(previous, current) })
        previous = current
        setDetectProgress(Math.round(index / times.length * 85))
      }
      const cuts = detectPreviewShotBoundaries(samples, 0.6)
      const refined: number[] = []
      for (const [index, cut] of cuts.entries()) {
        let low = previewFrameIndex(Math.max(0, cut - step) + 1e-4, fps)
        let high = previewFrameIndex(cut + 1e-4, fps)
        let lowPixels = await read(previewFrameStart(low, fps))
        let highPixels = await read(previewFrameStart(high, fps))
        while (high - low > 1) {
          const middle = (low + high) >> 1
          const middlePixels = await read(previewFrameStart(middle, fps))
          if (previewFrameDifference(lowPixels, middlePixels) >= previewFrameDifference(middlePixels, highPixels)) {
            high = middle
            highPixels = middlePixels
          } else {
            low = middle
            lowPixels = middlePixels
          }
        }
        refined.push(previewFrameStart(high, fps))
        setDetectProgress(85 + Math.round((index + 1) / cuts.length * 15))
      }
      const { keyframes: next, added } = mergePreviewKeyframes(keyframesRef.current, refined, 'shot', fps)
      if (added) commitKeyframes(next)
      onMessage(!refined.length ? '未检测到明显的镜头切换' : added ? `识别到 ${refined.length} 个镜头切换点，已添加 ${added} 个标记` : `识别到 ${refined.length} 个镜头切换点，均已标记`)
    } catch (error) {
      onMessage(token.cancelled ? '已停止镜头识别' : error instanceof Error ? error.message : '镜头识别失败')
    } finally {
      detector.dispose()
      if (detectionRef.current === token) detectionRef.current = null
      setDetectProgress(null)
    }
  }

  const actions = useRef({ togglePlay, stepFrames, seekKeyframe, seekFrameTime, toggleKeyframe, toggleMute, toggleFullscreen, removeKeyframe, setZoom, zoom, selectedId, activeKeyframe, lastFrame })
  actions.current = { togglePlay, stepFrames, seekKeyframe, seekFrameTime, toggleKeyframe, toggleMute, toggleFullscreen, removeKeyframe, setZoom, zoom, selectedId, activeKeyframe, lastFrame }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || editableTarget(event.target)) return
      const current = actions.current
      const handled = () => { event.preventDefault(); event.stopPropagation() }
      if (event.ctrlKey || event.metaKey) {
        if (event.key === '=' || event.key === '+') { handled(); current.setZoom(current.zoom * 1.6) }
        else if (event.key === '-') { handled(); current.setZoom(current.zoom / 1.6) }
        return
      }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (event.code === 'Space') { handled(); current.togglePlay() }
      else if (key === 'ArrowLeft' || key === 'ArrowRight') { handled(); current.stepFrames((key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? Math.round(fps) : 1)) }
      else if (key === 'ArrowUp' || key === 'ArrowDown') { handled(); current.seekKeyframe(key === 'ArrowUp' ? -1 : 1) }
      else if (key === 'Home') { handled(); current.seekFrameTime(0) }
      else if (key === 'End') { handled(); current.seekFrameTime(current.lastFrame) }
      else if (key === 'k') { handled(); current.toggleKeyframe() }
      else if (key === 'm') { handled(); current.toggleMute() }
      else if (key === 'f') { handled(); current.toggleFullscreen() }
      else if (key === 'z' && event.shiftKey) { handled(); current.setZoom(1) }
      else if (key === 'Delete' || key === 'Backspace') {
        const target = current.selectedId || current.activeKeyframe?.id
        if (!target) return
        handled()
        current.removeKeyframe(target)
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [fps])

  const sliderValue = Math.round(previewSliderFromZoom(zoom, maxZoom))
  const unsaved = keyframes.filter((keyframe) => !savedIds.has(keyframe.id))
  const frameTotal = previewFrameCount(duration, fps)

  return <div className={`nori-video-workspace${inspectorOpen ? ' is-inspector-open' : ''}`} data-fps-source={fpsSource}>
    <section className="nori-video-player" aria-label="视频播放器">
      <div ref={stageRef} className={`nori-video-stage${fullscreen ? ' is-fullscreen' : ''}`} style={{ '--video-aspect': String(aspect) } as CSSProperties} onClick={(event) => { if (event.target === event.currentTarget) togglePlay() }} onDoubleClick={toggleFullscreen}>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            setDuration(video.duration)
            setVideoSize(video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight } : null)
            video.playbackRate = rate
          }}
          onDurationChange={(event) => setDuration(event.currentTarget.duration)}
          onPlay={(event) => { setPlaying(true); rememberPlayback(src, event.currentTarget.currentTime, true) }}
          onPause={(event) => { setPlaying(false); rememberPlayback(src, event.currentTarget.currentTime, false) }}
          onEnded={() => setPlaying(false)}
          onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onTimeUpdate={(event) => {
            const video = event.currentTarget
            setCurrentTime(video.currentTime)
            rememberPlayback(src, video.currentTime, !video.paused && !video.ended)
          }}
          onVolumeChange={(event) => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume) }}
          onClick={togglePlay}
        />
        <div className="nori-video-stage-badges" aria-hidden="true">
          <span className={playing ? 'is-live' : ''}><i />{playing ? '播放中' : '逐帧审阅'}</span>
          {activeKeyframe ? <span className={`is-keyframe is-${activeKeyframe.kind}`}><Diamond />{activeKeyframe.kind === 'shot' ? '镜头切换' : '关键帧'} {keyframes.indexOf(activeKeyframe) + 1}</span> : null}
        </div>
      </div>
      <div className="nori-video-player-bar">
        <div className="nori-video-player-time"><strong>{previewTimecode(currentTime, fps)}</strong><span>/</span><span>{previewTimecode(duration, fps)}</span></div>
        <div className="nori-video-player-transport">
          <button type="button" className="is-jump" aria-label="上一个关键帧" title="上一个关键帧 (↑)" onClick={() => seekKeyframe(-1)} disabled={!duration}><ChevronLeft /><Diamond /></button>
          <button type="button" aria-label="上一帧" title="上一帧 (←)" onClick={() => stepFrames(-1)} disabled={!duration}><ChevronLeft /></button>
          <button type="button" className="is-play" aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停 (Space)' : '播放 (Space)'} onClick={togglePlay} disabled={!duration}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
          <button type="button" aria-label="下一帧" title="下一帧 (→)" onClick={() => stepFrames(1)} disabled={!duration}><ChevronRight /></button>
          <button type="button" className="is-jump" aria-label="下一个关键帧" title="下一个关键帧 (↓)" onClick={() => seekKeyframe(1)} disabled={!duration}><Diamond /><ChevronRight /></button>
        </div>
        <div className="nori-video-player-options">
          <button type="button" className={loop ? 'is-active' : ''} aria-label="循环播放" title={loop ? '关闭循环播放' : '循环播放'} aria-pressed={loop} onClick={() => { const next = !loop; setLoop(next); if (videoRef.current) videoRef.current.loop = next }}><Repeat /></button>
          <select aria-label="播放速度" title="播放速度" value={rate} onChange={(event) => { const value = Number(event.target.value); setRate(value); if (videoRef.current) videoRef.current.playbackRate = value }}>
            {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
          </select>
          <span className="nori-video-player-volume">
            <button type="button" aria-label={muted ? '取消静音' : '静音'} title={muted ? '取消静音 (M)' : '静音 (M)'} onClick={toggleMute}>{muted || volume === 0 ? <VolumeX /> : <Volume2 />}</button>
            <input type="range" aria-label="音量" min={0} max={1} step={0.05} value={muted ? 0 : volume} style={{ '--value': `${(muted ? 0 : volume) * 100}%` } as CSSProperties} onChange={(event) => { const video = videoRef.current; if (!video) return; video.volume = Number(event.target.value); video.muted = video.volume === 0 }} />
          </span>
          <button type="button" aria-label={fullscreen ? '退出全屏' : '全屏'} title={fullscreen ? '退出全屏 (F)' : '全屏 (F)'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
        </div>
      </div>
    </section>

    {inspectorOpen ? <aside className="nori-video-inspector" aria-label="关键帧面板">
      <header>
        <div><Diamond /><strong>关键帧</strong><b>{keyframes.length}</b></div>
        <button type="button" aria-label="清除全部关键帧" title="清除全部关键帧" disabled={!keyframes.length || readOnly} onClick={() => { commitKeyframes([]); setSelectedId(null) }}><Trash2 /></button>
        <button type="button" className="nori-video-inspector-close" aria-label="收起关键帧面板" title="收起关键帧面板" onClick={() => setInspectorOpen(false)}><X /></button>
      </header>
      {keyframes.length ? <ol>
        {keyframes.map((keyframe, index) => {
          const frame = previewFrameIndex(keyframe.time + 1e-4, fps)
          const active = activeKeyframe?.id === keyframe.id
          return <li key={keyframe.id} className={`${active ? 'is-active' : ''}${selectedId === keyframe.id ? ' is-selected' : ''}`}>
            <button type="button" className="nori-video-inspector-item" aria-label={`跳转到关键帧 ${index + 1}`} onClick={() => { setSelectedId(keyframe.id); seekFrameTime(keyframe.time); videoRef.current?.pause() }}>
              <span className="nori-video-inspector-thumb" style={{ aspectRatio: String(aspect), backgroundImage: keyThumbs[frame] ? `url(${JSON.stringify(keyThumbs[frame])})` : undefined }}>{keyThumbs[frame] ? null : <ImageIcon />}</span>
              <span>
                <strong><i className={`is-${keyframe.kind}`} />{keyframe.kind === 'shot' ? '镜头切换' : '关键帧'} {index + 1}</strong>
                <time>{previewTimecode(keyframe.time, fps)}</time>
                <small>第 {frame + 1} 帧{savedIds.has(keyframe.id) ? ' · 已保存' : ''}</small>
              </span>
            </button>
            <div>
              {canSave ? <button type="button" aria-label={`保存关键帧 ${index + 1} 到画布`} title="保存到画布" disabled={Boolean(busy)} onClick={() => void saveKeyframes([keyframe])}><Camera /></button> : null}
              {!readOnly ? <button type="button" aria-label={`删除关键帧 ${index + 1}`} title="删除" onClick={() => removeKeyframe(keyframe.id)}><Trash2 /></button> : null}
            </div>
          </li>
        })}
      </ol> : <div className="nori-video-inspector-empty">
        <Diamond />
        <strong>还没有关键帧</strong>
        <span>{readOnly ? '只读预览不可添加标记' : '在播放头处按 K 标记，或使用「识别镜头」自动定位镜头切换。'}</span>
      </div>}
      {canSave ? <button type="button" className="nori-video-inspector-save" disabled={!unsaved.length || Boolean(busy)} onClick={() => void saveKeyframes(unsaved)}>
        {busy === 'batch' ? <LoaderCircle className="is-spinning" /> : <ImageIcon />}{unsaved.length ? `保存 ${unsaved.length} 个关键帧到画布` : keyframes.length ? '关键帧均已保存' : '保存关键帧到画布'}
      </button> : null}
      <dl className="nori-video-inspector-info">
        <div><dt>分辨率</dt><dd>{videoSize ? `${videoSize.width} × ${videoSize.height}` : '—'}</dd></div>
        <div><dt>画面比例</dt><dd>{videoSize ? ratioLabel(videoSize.width, videoSize.height) : '—'}</dd></div>
        <div><dt>帧率</dt><dd>{Math.round(fps * 1000) / 1000} fps<small>{fpsSource}</small></dd></div>
        <div><dt>总帧数</dt><dd>{frameTotal || '—'}</dd></div>
        <div><dt>时长</dt><dd>{previewTimecode(duration, fps)}</dd></div>
      </dl>
    </aside> : null}

    <section className="nori-video-timeline nodrag nowheel" aria-label="视频时间线">
      <div className="nori-video-timeline-toolbar">
        <div className="nori-video-timeline-actions">
          <button type="button" className={`is-keyframe${activeKeyframe ? ' is-active' : ''}`} aria-label={activeKeyframe ? '移除关键帧' : '标记关键帧'} title={readOnly ? '只读预览不可标记关键帧' : activeKeyframe ? '移除播放头处的关键帧 (K)' : '在播放头处标记关键帧 (K)'} onClick={toggleKeyframe} disabled={!duration || readOnly}><Diamond /><span>关键帧</span></button>
          <button type="button" className={detectProgress !== null ? 'is-active' : ''} aria-label={detectProgress !== null ? '停止识别镜头' : '智能识别镜头'} title={readOnly ? '只读预览不可识别镜头' : '自动比对画面并标记镜头切换点'} onClick={() => void detectShots()} disabled={!duration || readOnly}>
            {detectProgress !== null ? <LoaderCircle className="is-spinning" /> : <Sparkles />}<span>{detectProgress !== null ? `识别中 ${detectProgress}%` : '识别镜头'}</span>
          </button>
          {canSave ? <button type="button" aria-label="截取当前帧" title="把播放头处的画面保存到画布" onClick={() => void captureCurrent()} disabled={Boolean(busy) || !duration}>{busy === 'current' ? <LoaderCircle className="is-spinning" /> : <Camera />}<span>{busy === 'current' ? '正在截取…' : '截取当前帧'}</span></button> : null}
        </div>
        <div className="nori-video-timeline-view">
          <button type="button" className={snapping ? 'is-active' : ''} aria-label="吸附" title={snapping ? '关闭吸附' : '开启吸附：拖动时对齐关键帧与片段边界'} aria-pressed={snapping} onClick={() => setSnapping(!snapping)}><Magnet /></button>
          <button type="button" className={hoverPreview ? 'is-active' : ''} aria-label="预览轴" title={hoverPreview ? '关闭预览轴' : '开启预览轴：悬停时预览画面'} aria-pressed={hoverPreview} onClick={() => setHoverPreview(!hoverPreview)}><Eye /></button>
          <i />
          <button type="button" aria-label="适应整个视频" title="适应整个视频 (Shift+Z)" onClick={() => setZoom(1)} disabled={zoom <= 1}><FitWidth /></button>
          <button type="button" aria-label="缩小时间线" title="缩小时间线 (Ctrl/⌘ -)" onClick={() => setZoom(zoom / 1.6)} disabled={zoom <= 1}><Minus /></button>
          <input type="range" aria-label="时间线缩放" aria-valuetext={`${Math.round(zoom * 100)}%`} min={0} max={100} step={1} value={sliderValue} style={{ '--value': `${sliderValue}%` } as CSSProperties} onChange={(event) => setZoom(previewZoomFromSlider(Number(event.target.value), maxZoom))} />
          <button type="button" aria-label="放大时间线" title="放大时间线 (Ctrl/⌘ +)" onClick={() => setZoom(zoom * 1.6)} disabled={zoom >= maxZoom}><Plus /></button>
          <i />
          <button type="button" className={inspectorOpen ? 'is-active' : ''} aria-label="关键帧面板" title={inspectorOpen ? '收起关键帧面板' : '展开关键帧面板'} aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><ListVideo /></button>
        </div>
      </div>
      <VideoPreviewTimeline
        src={src}
        title={title}
        duration={duration}
        fps={fps}
        currentTime={currentTime}
        playing={playing}
        aspect={aspect}
        zoom={zoom}
        keyframes={keyframes}
        selectedKeyframeId={selectedId}
        readOnly={readOnly}
        snapping={snapping}
        hoverPreview={hoverPreview}
        muted={muted}
        sampler={sampler}
        onViewportWidth={setTimelineWidth}
        onZoom={setZoom}
        onSeek={(time) => { videoRef.current?.pause(); seek(previewSeekTime(time, fps)) }}
        onSelectKeyframe={setSelectedId}
        onMoveKeyframe={moveKeyframe}
        onToggleMute={toggleMute}
      />
    </section>
  </div>
}
