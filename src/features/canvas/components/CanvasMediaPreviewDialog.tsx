'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Loader2, Maximize2, Minus, Music2, Plus, RotateCcw, RotateCw, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl, toPlayableVideoUrl } from '@/lib/media/image-url'
import type { CanvasFlowNode } from '../editor-types'
import { attachMediaPlayer, handOffMediaPlayback, rememberPlayback, syncMediaPlayers } from '../media-playback'
import { captureVideoFrame } from '../video-frame-capture'

function mediaType(node: CanvasFlowNode) {
  if (node.type === 'model_3d') return 'model3d'
  return node.data.mediaType || node.type || 'image'
}

function clampScale(value: number) {
  return Math.max(0.2, Math.min(5, Math.round(value * 10) / 10))
}

export function CanvasMediaPreviewDialog({ node, readOnly = false, onCaptureFrame, onClose }: {
  node: CanvasFlowNode
  readOnly?: boolean
  onCaptureFrame?: (file: File, sourceNode: CanvasFlowNode) => Promise<void>
  onClose: () => void
}) {
  const type = mediaType(node)
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [fit, setFit] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const capturePendingRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const url = useMemo(() => {
    const raw = type === 'video'
      ? node.data.videoUrl || node.data.contentUrl
      : type === 'audio'
        ? node.data.audioUrl || node.data.contentUrl
        : node.data.imageUrl || node.data.contentUrl
    return (type === 'video' ? toPlayableVideoUrl(raw) : toDisplayImageUrl(raw)) || ''
  }, [node.data.audioUrl, node.data.contentUrl, node.data.imageUrl, node.data.videoUrl, type])

  // Opening the preview takes over the card's playback: the card pauses and the enlarged
  // player continues from the same second instead of replaying from the start.
  useEffect(() => {
    const video = videoRef.current
    if (!video || type !== 'video') return
    const start = handOffMediaPlayback(url, video)
    const detach = attachMediaPlayer(url, video)
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
      if (video.currentTime > 0) rememberPlayback(url, video.currentTime, false)
      detach()
      syncMediaPlayers(url, { keep: video, resume: Boolean(start?.playing) })
    }
  }, [type, url])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (type !== 'image') return
      if (event.key === '+' || event.key === '=') { setFit(false); setScale((value) => clampScale(value + 0.1)) }
      if (event.key === '-') { setFit(false); setScale((value) => clampScale(value - 0.1)) }
      if (event.key === '0') { setFit(true); setScale(1); setRotation(0) }
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [onClose, type])

  const captureFrame = async () => {
    const video = videoRef.current
    if (!video || !onCaptureFrame || capturePendingRef.current) return
    capturePendingRef.current = true
    setCapturing(true)
    setCaptureError('')
    try {
      const file = await captureVideoFrame(video, undefined, node.data.title || '视频')
      await onCaptureFrame(file, node)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : '截取关键帧失败')
    } finally {
      capturePendingRef.current = false
      setCapturing(false)
    }
  }

  return (
    <div className="nori-canvas-media-preview" role="dialog" aria-modal="true" aria-label={`${node.data.title || '素材'}预览`} onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <div><Maximize2 /><span><strong>{node.data.title || '素材预览'}</strong><small>{type === 'video' ? '视频预览' : type === 'audio' ? '音频预览' : '图片预览'}</small></span></div>
        <div>
          {type === 'image' ? <>
            <button type="button" title="适应窗口" className={fit ? 'is-active' : ''} onClick={() => { setFit(true); setScale(1) }}><Maximize2 /></button>
            <button type="button" title="缩小" onClick={() => { setFit(false); setScale((value) => clampScale(value - 0.1)) }}><Minus /></button>
            <b>{Math.round(scale * 100)}%</b>
            <button type="button" title="放大" onClick={() => { setFit(false); setScale((value) => clampScale(value + 0.1)) }}><Plus /></button>
            <button type="button" title="逆时针旋转" onClick={() => setRotation((value) => value - 90)}><RotateCcw /></button>
            <button type="button" title="顺时针旋转" onClick={() => setRotation((value) => value + 90)}><RotateCw /></button>
          </> : null}
          <button type="button" title="关闭 (Esc)" onClick={onClose}><X /></button>
        </div>
      </header>
      <main
        onWheel={type === 'image' ? (event) => {
          event.preventDefault()
          setFit(false)
          setScale((value) => clampScale(value + (event.deltaY < 0 ? 0.1 : -0.1)))
        } : undefined}
      >
        {!url ? <div className="nori-canvas-media-preview-empty">素材地址不可用</div> : null}
        {url && type === 'image' ? <MediaImage className={fit ? 'is-fit' : ''} src={url} alt={node.data.title || ''} draggable={false} width={1920} height={1080} style={{ transform: `rotate(${rotation}deg) scale(${fit ? 1 : scale})` }} /> : null}
        {url && type === 'video' ? (
          <video
            ref={videoRef}
            src={url}
            poster={toDisplayImageUrl(node.data.posterUrl || node.data.imageUrl || null) || undefined}
            controls
            playsInline
            onPlay={(event) => rememberPlayback(url, event.currentTarget.currentTime, true)}
            onPause={(event) => rememberPlayback(url, event.currentTarget.currentTime, false)}
            onTimeUpdate={(event) => {
              const video = event.currentTarget
              rememberPlayback(url, video.currentTime, !video.paused && !video.ended)
            }}
          />
        ) : null}
        {url && type === 'audio' ? <div className="nori-canvas-media-preview-audio"><i><Music2 /></i><strong>{node.data.title || '音频素材'}</strong><audio src={url} controls autoPlay /></div> : null}
      </main>
      <footer><span>{captureError || (type === 'image' ? '滚轮缩放 · 0 重置 · Esc 关闭' : 'Esc 关闭预览')}</span><div>{type === 'video' && onCaptureFrame && !readOnly ? <button type="button" disabled={!url || capturing} onClick={() => void captureFrame()}>{capturing ? <Loader2 className="animate-spin" /> : <Camera />}{capturing ? '正在截取…' : '截取当前帧'}</button> : null}<small>{url}</small></div></footer>
    </div>
  )
}
