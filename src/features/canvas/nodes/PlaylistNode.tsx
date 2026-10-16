'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import {
  Check,
  ListVideo,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Video,
  X,
} from '@/components/ui/icons'
import { FosAssemblyTimeline, type AssemblyTrackSelection } from '@/components/frameos/views/FosAssemblyTimeline'
import { calculateTimelineDuration, computeClipPositions, framesToTime } from '@/features/video-editor/utils/time-utils'
import {
  CANVAS_PLAYLIST_FPS,
  CANVAS_PLAYLIST_MAX_ITEMS,
  canvasPlaylistEditorProject,
  canvasPlaylistFingerprint,
  canvasPlaylistFrameToMs,
  canvasPlaylistMsToFrame,
  normalizeCanvasPlaylistItems,
} from '@/lib/canvas/playlist'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { CANVAS_MATERIAL_DRAG_TYPE } from '../components/CanvasProjectAssets'
import { useCanvasEditor, type CanvasPlaylistVideoSource } from '../CanvasEditorContext'
import type { CanvasFlowNode } from '../editor-types'
import type { CanvasPlaylistItem, CanvasPlaylistRenderSummary, CanvasPlaylistReviewSummary } from '../types'

const DEFAULT_REVIEW: CanvasPlaylistReviewSummary = {
  assignmentId: null,
  status: 'draft',
  submittedAt: null,
  completedAt: null,
  lastReviewNote: null,
  annotationCount: 0,
}

const DEFAULT_RENDER: CanvasPlaylistRenderSummary = {
  taskId: null,
  fingerprint: null,
  status: 'draft',
  progress: 0,
  outputUrl: null,
  materialId: null,
  durationMs: null,
  completedAt: null,
  errorMessage: null,
}

function createItemId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function finiteDurationMs(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

function sourceItem(source: CanvasPlaylistVideoSource): CanvasPlaylistItem {
  return {
    id: createItemId(),
    sourceNodeId: source.id,
    materialId: source.materialId,
    title: source.title,
    videoUrl: source.videoUrl,
    posterUrl: source.posterUrl,
    sourceInMs: 0,
    sourceOutMs: source.durationMs,
    durationMs: source.durationMs,
  }
}

function reviewLabel(status: CanvasPlaylistReviewSummary['status']) {
  if (status === 'pending_review') return '审核中'
  if (status === 'completed') return '已通过'
  if (status === 'rejected') return '需修改'
  return '草稿'
}

function renderLabel(render: CanvasPlaylistRenderSummary) {
  if (render.status === 'queued') return '等待渲染'
  if (render.status === 'processing') return `正在渲染 ${Math.round(render.progress)}%`
  if (render.status === 'completed') return '当前版本已成片'
  if (render.status === 'failed') return '渲染失败'
  if (render.status === 'canceled') return '渲染已取消'
  return '当前版本未成片'
}

function PlaylistNodeImpl({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const editor = useCanvasEditor()
  const acceptingNodeDrop = editor.playlistDropTargetId === id
  const videoRef = useRef<HTMLVideoElement>(null)
  const continuePlaybackRef = useRef(false)
  const pendingSeekMsRef = useRef<number | null>(null)
  const transitioningClipRef = useRef<string | null>(null)
  const items = useMemo(() => normalizeCanvasPlaylistItems(data.playlistItems), [data.playlistItems])
  const playlistFingerprint = useMemo(() => canvasPlaylistFingerprint(items), [items])
  const playlistFingerprintRef = useRef(playlistFingerprint)
  playlistFingerprintRef.current = playlistFingerprint
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(data.title || '播放列表')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [selection, setSelection] = useState<AssemblyTrackSelection | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentClipMs, setCurrentClipMs] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [review, setReview] = useState<CanvasPlaylistReviewSummary>(DEFAULT_REVIEW)
  const [reviewLoading, setReviewLoading] = useState(true)
  const [render, setRender] = useState<CanvasPlaylistRenderSummary>(DEFAULT_RENDER)
  const [renderLoading, setRenderLoading] = useState(true)
  const [renderStarting, setRenderStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canvasSources = editor.listPlaylistVideoSources()
  const sourceById = useMemo(() => new Map(canvasSources.map((source) => [source.id, source])), [canvasSources])
  const resolvedItems = useMemo(() => items.map((item) => {
    const source = item.sourceNodeId ? sourceById.get(item.sourceNodeId) : null
    return {
      ...item,
      title: source?.title || item.title,
      videoUrl: source?.videoUrl || item.videoUrl || null,
      posterUrl: source?.posterUrl || item.posterUrl || null,
      materialId: source?.materialId || item.materialId || null,
      durationMs: source?.durationMs || item.durationMs || null,
      sourceOutMs: item.sourceOutMs || source?.durationMs || item.durationMs || null,
    }
  }), [items, sourceById])
  const usedNodeIds = useMemo(() => new Set(items.map((item) => item.sourceNodeId).filter(Boolean)), [items])
  const availableSources = canvasSources.filter((source) => source.id !== id && !usedNodeIds.has(source.id))
  const requestedActiveIndex = resolvedItems.findIndex((item) => item.id === activeItemId)
  const activeIndex = requestedActiveIndex >= 0 ? requestedActiveIndex : 0
  const activeItem = resolvedItems[activeIndex] || null
  const activeUrl = toDisplayImageUrl(activeItem?.videoUrl)
  const timelineProject = useMemo(() => canvasPlaylistEditorProject(id, resolvedItems), [id, resolvedItems])
  const positions = useMemo(() => computeClipPositions(timelineProject.timeline), [timelineProject.timeline])
  const totalFrames = calculateTimelineDuration(timelineProject.timeline)
  const activeClip = activeItem ? timelineProject.timeline.find((clip) => clip.id === activeItem.id) || null : null
  const activePosition = activeClip ? positions.find((position) => position.id === activeClip.id) || null : null
  const currentSourceFrame = activeClip
    ? clamp(canvasPlaylistMsToFrame(currentClipMs), activeClip.trim?.from || 0, activeClip.trim?.to || activeClip.durationInFrames)
    : 0
  const currentFrame = activeClip && activePosition
    ? activePosition.startFrame + clamp(currentSourceFrame - (activeClip.trim?.from || 0), 0, activeClip.durationInFrames)
    : 0
  const timelineSelection = activeItem
    ? selection?.clipId === activeItem.id ? selection : { clipId: activeItem.id, track: 'video' as const }
    : null
  const splitOffset = activeClip && activePosition
    ? clamp(currentFrame - activePosition.startFrame, 0, activeClip.durationInFrames)
    : 0
  const canCutActive = Boolean(
    activeClip
    && timelineSelection?.track === 'video'
    && splitOffset >= 1
    && splitOffset < activeClip.durationInFrames,
  )
  const timelineDirty = editor.saveState === 'pending'
    || editor.saveState === 'offline'
    || editor.saveState === 'error'
    || editor.saveState === 'conflict'
    || editor.saveState === 'recovery'
  const canSubmit = resolvedItems.length > 0
    && resolvedItems.every((item) => Boolean(item.videoUrl))
    && render.status === 'completed'
    && Boolean(render.outputUrl)
    && review.status !== 'pending_review'

  const commitItems = useCallback((next: CanvasPlaylistItem[], label = '编辑播放列表') => {
    setRender(DEFAULT_RENDER)
    editor.updateNodeData(id, { playlistItems: next }, label)
  }, [editor, id])

  const updateItem = useCallback((itemId: string, patch: Partial<CanvasPlaylistItem>, label = '调整播放列表剪辑') => {
    commitItems(items.map((item) => item.id === itemId ? { ...item, ...patch } : item), label)
  }, [commitItems, items])

  const refreshReview = useCallback(async () => {
    setReviewLoading(true)
    try {
      setReview(await editor.loadPlaylistReview(id))
    } catch {
      setReview(DEFAULT_REVIEW)
    } finally {
      setReviewLoading(false)
    }
  }, [editor, id])

  const refreshRender = useCallback(async (showLoading = false) => {
    if (showLoading) setRenderLoading(true)
    try {
      const next = await editor.loadPlaylistRender(id)
      if (next.fingerprint === playlistFingerprintRef.current) setRender(next)
    } catch (loadError) {
      if (showLoading) setError(loadError instanceof Error ? loadError.message : '读取成片状态失败')
    } finally {
      if (showLoading) setRenderLoading(false)
    }
  }, [editor, id])

  useEffect(() => { void refreshReview() }, [refreshReview])
  useEffect(() => {
    if (!items.length) {
      setRender(DEFAULT_RENDER)
      setRenderLoading(false)
      return
    }
    void refreshRender(true)
  }, [items.length, playlistFingerprint, refreshRender])
  useEffect(() => {
    if (render.status !== 'queued' && render.status !== 'processing') return
    const timer = window.setInterval(() => void refreshRender(), 1_500)
    return () => window.clearInterval(timer)
  }, [refreshRender, render.status])
  useEffect(() => {
    if (!resolvedItems.length) {
      if (activeItemId !== null) setActiveItemId(null)
      if (selection !== null) setSelection(null)
      return
    }
    if (!activeItemId || !resolvedItems.some((item) => item.id === activeItemId)) {
      setActiveItemId(resolvedItems[0].id)
      setSelection({ clipId: resolvedItems[0].id, track: 'video' })
      setCurrentClipMs(resolvedItems[0].sourceInMs || 0)
    }
  }, [activeItemId, resolvedItems, selection])
  useEffect(() => {
    transitioningClipRef.current = null
  }, [activeItem?.id])

  const saveTitle = () => {
    const next = title.trim() || '播放列表'
    setTitle(next)
    setRenaming(false)
    if (next !== data.title) editor.updateNodeData(id, { title: next }, '重命名播放列表')
  }

  const addSource = (source: CanvasPlaylistVideoSource) => {
    const nextItem = sourceItem(source)
    commitItems([...items, nextItem], '添加播放列表视频')
    setActiveItemId(nextItem.id)
    setSelection({ clipId: nextItem.id, track: 'video' })
    setCurrentClipMs(0)
    setPickerOpen(false)
    setError(null)
  }

  const rememberDuration = (itemId: string, durationSeconds: number) => {
    const durationMs = finiteDurationMs(durationSeconds * 1_000)
    const current = items.find((item) => item.id === itemId)
    if (!durationMs || !current || current.durationMs === durationMs) return
    updateItem(itemId, {
      durationMs,
      sourceOutMs: !current.sourceOutMs || current.sourceOutMs > durationMs ? durationMs : current.sourceOutMs,
    }, '读取视频时长')
  }

  const reorderItems = (from: number, to: number) => {
    if (editor.readOnly || from === to || !items[from] || !items[to]) return
    const next = [...items]
    const [moving] = next.splice(from, 1)
    next.splice(to, 0, moving)
    commitItems(next, '调整播放列表顺序')
  }

  const selectAndSeek = (index: number, sourceFrame?: number, autoplay = false) => {
    const target = resolvedItems[index]
    const targetClip = timelineProject.timeline[index]
    if (!target || !targetClip) return
    const targetFrame = clamp(sourceFrame ?? targetClip.trim?.from ?? 0, targetClip.trim?.from || 0, targetClip.trim?.to || targetClip.durationInFrames)
    const targetMs = canvasPlaylistFrameToMs(targetFrame)
    continuePlaybackRef.current = autoplay
    pendingSeekMsRef.current = targetMs
    setActiveItemId(target.id)
    setSelection((current) => current?.clipId === target.id ? current : { clipId: target.id, track: 'video' })
    setCurrentClipMs(targetMs)
    const video = videoRef.current
    if (target.id === activeItem?.id && video?.readyState) {
      video.currentTime = targetMs / 1_000
      pendingSeekMsRef.current = null
      if (autoplay) void video.play().catch(() => setPlaying(false))
    }
  }

  const seekTimeline = (frame: number, preferredClipId?: string | null) => {
    if (!positions.length) return
    const nextFrame = clamp(Math.round(frame), 0, totalFrames)
    const preferred = preferredClipId ? positions.find((clip) => clip.id === preferredClipId) : null
    const position = preferred || positions.find((clip) => nextFrame >= clip.startFrame && nextFrame < clip.endFrame) || positions.at(-1)
    if (!position) return
    const offset = clamp(nextFrame - position.startFrame, 0, position.durationInFrames)
    selectAndSeek(
      timelineProject.timeline.findIndex((clip) => clip.id === position.id),
      (position.trim?.from || 0) + offset,
      playing,
    )
  }

  const selectTimelineClip = (nextSelection: AssemblyTrackSelection, frame: number) => {
    const index = timelineProject.timeline.findIndex((clip) => clip.id === nextSelection.clipId)
    const position = positions.find((clip) => clip.id === nextSelection.clipId)
    if (index >= 0 && position) {
      const clip = timelineProject.timeline[index]
      const sourceFrame = (clip.trim?.from || 0) + clamp(frame - position.startFrame, 0, Math.max(0, clip.durationInFrames - 1))
      setSelection(nextSelection)
      selectAndSeek(index, sourceFrame, false)
    }
    else seekTimeline(frame)
  }

  const finishClip = (clipId: string) => {
    if (transitioningClipRef.current === clipId) return
    transitioningClipRef.current = clipId
    if (activeIndex >= resolvedItems.length - 1) {
      continuePlaybackRef.current = false
      setPlaying(false)
      return
    }
    const nextClip = timelineProject.timeline[activeIndex + 1]
    selectAndSeek(activeIndex + 1, nextClip?.trim?.from, true)
  }

  const applyPlaybackPosition = (video: HTMLVideoElement) => {
    if (!activeItem || video.readyState < 1) return
    const targetMs = pendingSeekMsRef.current ?? activeItem.sourceInMs ?? 0
    if (Math.abs(video.currentTime - targetMs / 1_000) > 0.02) video.currentTime = targetMs / 1_000
    setCurrentClipMs(targetMs)
    pendingSeekMsRef.current = null
    if (continuePlaybackRef.current) {
      continuePlaybackRef.current = false
      void video.play().catch(() => setPlaying(false))
    }
  }

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video || !activeClip) return
    if (!video.paused) {
      video.pause()
      setPlaying(false)
      continuePlaybackRef.current = false
      return
    }
    const endSeconds = canvasPlaylistFrameToMs(activeClip.trim?.to || activeClip.durationInFrames) / 1_000
    if (video.currentTime >= endSeconds - 0.02) {
      video.currentTime = canvasPlaylistFrameToMs(activeClip.trim?.from || 0) / 1_000
    }
    transitioningClipRef.current = null
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  const splitAtPlayhead = () => {
    if (editor.readOnly || !activeItem || !activeClip || !activePosition || !canCutActive) return
    if (items.length >= CANVAS_PLAYLIST_MAX_ITEMS) {
      setError(`播放列表最多支持 ${CANVAS_PLAYLIST_MAX_ITEMS} 个剪辑片段`)
      return
    }
    videoRef.current?.pause()
    continuePlaybackRef.current = false
    setPlaying(false)
    const itemIndex = items.findIndex((item) => item.id === activeItem.id)
    if (itemIndex < 0) return
    const sourceFrom = activeClip.trim?.from || 0
    const sourceTo = activeClip.trim?.to || sourceFrom + activeClip.durationInFrames
    const sourceSplit = sourceFrom + splitOffset
    const original = items[itemIndex]
    const secondId = createItemId()
    const first = {
      ...original,
      sourceInMs: canvasPlaylistFrameToMs(sourceFrom),
      sourceOutMs: canvasPlaylistFrameToMs(sourceSplit),
    }
    const second = {
      ...original,
      id: secondId,
      sourceInMs: canvasPlaylistFrameToMs(sourceSplit),
      sourceOutMs: canvasPlaylistFrameToMs(sourceTo),
    }
    const next = [...items]
    next.splice(itemIndex, 1, first, second)
    commitItems(next, '在播放头切割片段')
    setActiveItemId(secondId)
    setSelection({ clipId: secondId, track: 'video' })
    setCurrentClipMs(second.sourceInMs)
    setError(null)
  }

  const removeActive = () => {
    if (!activeItem) return
    const nextItems = items.filter((item) => item.id !== activeItem.id)
    const nextActive = nextItems[Math.min(activeIndex, Math.max(0, nextItems.length - 1))] || null
    commitItems(nextItems, '移除播放列表视频')
    setActiveItemId(nextActive?.id || null)
    setSelection(nextActive ? { clipId: nextActive.id, track: 'video' } : null)
    setCurrentClipMs(nextActive?.sourceInMs || 0)
    setPlaying(false)
  }

  const addDroppedMaterial = (rawMaterial: string) => {
    try {
      const material = JSON.parse(rawMaterial) as { id?: string; type?: string; title?: string; url?: string; thumbnailUrl?: string; metadata?: Record<string, unknown> }
      if (material.type !== 'video' || !material.url) throw new Error('not video')
      const durationMs = finiteDurationMs(material.metadata?.durationMs)
      const nextItem: CanvasPlaylistItem = {
        id: createItemId(),
        sourceNodeId: null,
        materialId: material.id || null,
        title: material.title || `视频 ${items.length + 1}`,
        videoUrl: material.url,
        posterUrl: material.thumbnailUrl || null,
        sourceInMs: 0,
        sourceOutMs: durationMs,
        durationMs,
      }
      commitItems([...items, nextItem], '添加素材库视频到播放列表')
      setActiveItemId(nextItem.id)
      setSelection({ clipId: nextItem.id, track: 'video' })
      setCurrentClipMs(0)
      setError(null)
    } catch {
      setError('播放列表只接收视频素材')
    }
  }

  const restoreFullClips = () => {
    if (editor.readOnly || !resolvedItems.length) return
    const seen = new Set<string>()
    const next = resolvedItems.flatMap((resolvedItem) => {
      const sourceKey = resolvedItem.sourceNodeId
        ? `node:${resolvedItem.sourceNodeId}`
        : resolvedItem.materialId
          ? `material:${resolvedItem.materialId}`
          : `url:${resolvedItem.videoUrl || resolvedItem.id}`
      if (seen.has(sourceKey)) return []
      seen.add(sourceKey)
      const original = items.find((item) => item.id === resolvedItem.id) || resolvedItem
      const durationMs = resolvedItem.durationMs || original.durationMs || original.sourceOutMs || null
      return [{ ...original, sourceInMs: 0, sourceOutMs: durationMs, durationMs }]
    })
    commitItems(next, '恢复播放列表完整片段')
    const first = next[0] || null
    setActiveItemId(first?.id || null)
    setSelection(first ? { clipId: first.id, track: 'video' } : null)
    setCurrentClipMs(0)
    setPlaying(false)
    setError(null)
  }

  const submit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      setReview(await editor.submitPlaylistReview(id))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交播放列表审核失败')
    } finally {
      setSubmitting(false)
    }
  }

  const startRender = async () => {
    if (renderStarting || !resolvedItems.length || resolvedItems.some((item) => !item.videoUrl)) return
    setRenderStarting(true)
    setError(null)
    try {
      const next = await editor.startPlaylistRender(id)
      if (next.fingerprint === playlistFingerprintRef.current) setRender(next)
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : '播放列表成片渲染失败')
    } finally {
      setRenderStarting(false)
    }
  }

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.matches('input, textarea, select, [contenteditable="true"]')) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) editor.redo()
      else editor.undo()
      return
    }
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      void editor.saveCanvas()
      return
    }
    if (event.code === 'Space') {
      event.preventDefault()
      event.stopPropagation()
      togglePlayback()
      return
    }
    if (!mod && !event.altKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      event.stopPropagation()
      splitAtPlayhead()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      if (timelineSelection?.track === 'video') removeActive()
    }
  }

  return (
    <div className={`nori-canvas-playlist-node${selected ? ' is-selected' : ''}${review.status === 'rejected' ? ' is-rejected' : ''}${acceptingNodeDrop ? ' is-node-drop-target' : ''}`}>
      <NodeResizer isVisible={selected && !editor.readOnly} minWidth={720} minHeight={680} lineClassName="nori-canvas-resize-line" handleClassName="nori-canvas-resize-handle" />
      <header className="nori-playlist-header">
        <div className="nori-playlist-heading">
          <ListVideo />
          {renaming && !editor.readOnly ? (
            <input className="nodrag" value={title} autoFocus maxLength={80} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => { if (event.key === 'Enter') saveTitle(); if (event.key === 'Escape') { setTitle(data.title || '播放列表'); setRenaming(false) } }} />
          ) : <button type="button" className="nodrag" onDoubleClick={() => !editor.readOnly && setRenaming(true)}>{data.title || '播放列表'}</button>}
          <span>{resolvedItems.length} 段 · {framesToTime(totalFrames, CANVAS_PLAYLIST_FPS)} · {CANVAS_PLAYLIST_FPS}fps</span>
        </div>
        <div className="nori-playlist-review-actions nodrag">
          <span className={`is-${review.status}`}>{reviewLoading ? '读取状态…' : reviewLabel(review.status)}</span>
          {!editor.readOnly ? <button type="button" className="is-submit" disabled={!canSubmit || submitting} title={!resolvedItems.length ? '请先加入视频' : render.status !== 'completed' || !render.outputUrl ? '请先渲染当前剪辑版本的成片' : review.status === 'pending_review' ? '当前版本正在审核' : '冻结当前顺序、切割结果和成片快照并提交审核员'} onClick={() => void submit()}>{submitting ? <LoaderCircle className="animate-spin" /> : review.status === 'rejected' ? '重新提交终审' : '提交最终审核'}</button> : null}
        </div>
      </header>

      <div className={`nori-playlist-render nodrag is-${render.status}`}>
        <div>
          <strong>{renderLoading ? '读取成片状态…' : renderLabel(render)}</strong>
          <small>{render.errorMessage || (render.status === 'completed' ? '审核将锁定这个不可变成片版本' : '按时间线中的切割与排序拼装为单个 MP4')}</small>
        </div>
        {render.outputUrl ? <a href={toDisplayImageUrl(render.outputUrl) || render.outputUrl} target="_blank" rel="noreferrer">查看成片</a> : null}
        {!editor.readOnly ? <button type="button" disabled={renderStarting || render.status === 'queued' || render.status === 'processing' || !resolvedItems.length || resolvedItems.some((item) => !item.videoUrl)} onClick={() => void startRender()}>{renderStarting || render.status === 'queued' || render.status === 'processing' ? <LoaderCircle className="animate-spin" /> : <Video />}{render.status === 'completed' ? '重新渲染' : '渲染成片'}</button> : null}
      </div>

      <section
        className="nori-playlist-editor nodrag nowheel"
        tabIndex={0}
        onKeyDown={handleKeyboard}
        onDragOver={(event) => {
          if (!editor.readOnly && event.dataTransfer.types.includes(CANVAS_MATERIAL_DRAG_TYPE)) {
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(event) => {
          if (editor.readOnly) return
          const rawMaterial = event.dataTransfer.getData(CANVAS_MATERIAL_DRAG_TYPE)
          if (!rawMaterial) return
          event.preventDefault()
          event.stopPropagation()
          addDroppedMaterial(rawMaterial)
        }}
      >
        {acceptingNodeDrop ? <div className="nori-playlist-node-drop-hint" role="status" aria-live="polite"><span><Video /></span><strong>松开加入最终审核</strong><small>源视频节点会留在原位，并自动建立输入关系</small></div> : null}
        <div className="nori-playlist-stage">
          {activeItem && activeUrl ? (
            <div className="nori-playlist-preview">
              <video
                ref={videoRef}
                key={`${activeItem.id}:${activeUrl}`}
                src={activeUrl}
                poster={toDisplayImageUrl(activeItem.posterUrl) || undefined}
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  rememberDuration(activeItem.id, event.currentTarget.duration)
                  applyPlaybackPosition(event.currentTarget)
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => {
                  const currentMs = Math.round(event.currentTarget.currentTime * 1_000)
                  const startMs = canvasPlaylistFrameToMs(activeClip?.trim?.from || 0)
                  if (currentMs < startMs - 20) {
                    event.currentTarget.currentTime = startMs / 1_000
                    return
                  }
                  setCurrentClipMs(currentMs)
                  const endMs = canvasPlaylistFrameToMs(activeClip?.trim?.to || activeClip?.durationInFrames || 0)
                  if (!event.currentTarget.paused && endMs > 0 && currentMs >= endMs - 20) {
                    event.currentTarget.pause()
                    finishClip(activeItem.id)
                  }
                }}
                onEnded={() => finishClip(activeItem.id)}
              />
              <button type="button" className="nori-playlist-play nodrag" aria-label={playing ? '暂停连续预览' : '播放连续预览'} onClick={togglePlayback}>{playing ? <Pause /> : <Play />}</button>
              <div className="nori-playlist-preview-meta">
                <strong>{activeItem.title}</strong>
                <span>{framesToTime(currentFrame, CANVAS_PLAYLIST_FPS)} / {framesToTime(totalFrames, CANVAS_PLAYLIST_FPS)}</span>
                {!editor.readOnly ? <button type="button" className="nori-playlist-add" onClick={() => setPickerOpen((open) => !open)}><Plus />添加视频</button> : null}
              </div>
            </div>
          ) : resolvedItems.length ? (
            <div className="nori-playlist-empty is-missing nodrag">
              <span><Video /></span>
              <strong>当前片段视频不可用</strong>
              <small>时间线已保留剪辑，请替换失效视频后再预览</small>
              {!editor.readOnly ? <button type="button" className="nori-playlist-add" onClick={() => setPickerOpen(true)}><Plus />添加视频</button> : null}
            </div>
          ) : (
            <button type="button" className="nori-playlist-empty nodrag" disabled={editor.readOnly} onClick={() => setPickerOpen(true)}><span><Plus /></span><strong>添加视频到播放列表</strong><small>选择视频，或把生成视频节点 / 作品素材拖到这里</small></button>
          )}
        </div>

        {availableSources.length && resolvedItems.length ? <div className="fac-restore nori-playlist-source-restore"><span>可加入时间线</span>{availableSources.slice(0, 8).map((source) => <button type="button" key={source.id} disabled={editor.readOnly || !source.videoUrl} onClick={() => addSource(source)}><Plus />{source.title}</button>)}</div> : null}

        <FosAssemblyTimeline
          project={timelineProject}
          currentFrame={currentFrame}
          selection={timelineSelection}
          zoom={zoom}
          readOnly={editor.readOnly}
          isDirty={timelineDirty}
          saving={editor.saveState === 'saving'}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          onReorder={reorderItems}
          onSelect={selectTimelineClip}
          onSeek={seekTimeline}
          onZoom={setZoom}
          onMoveAudio={() => undefined}
          onCut={splitAtPlayhead}
          onDelete={removeActive}
          onUndo={editor.undo}
          onRedo={editor.redo}
          onReset={restoreFullClips}
          onSave={() => void editor.saveCanvas()}
          canCut={canCutActive}
          canDelete={timelineSelection?.track === 'video'}
          audioReadOnly
          resetLabel="恢复完整片段"
        />

        {pickerOpen && !editor.readOnly ? <div className="nori-playlist-picker nodrag nowheel">
          <header><span>从画布选择视频</span><button type="button" aria-label="关闭视频选择" onClick={() => setPickerOpen(false)}><X /></button></header>
          {availableSources.length ? availableSources.map((source) => <button type="button" key={source.id} disabled={!source.videoUrl} onClick={() => addSource(source)}><span>{source.videoUrl ? <Video /> : <LoaderCircle />}</span><div><strong>{source.title}</strong><small>{source.videoUrl ? `${source.durationMs ? framesToTime(canvasPlaylistMsToFrame(source.durationMs), CANVAS_PLAYLIST_FPS) : '时长待读取'} · 点击加入` : '视频尚未生成完成'}</small></div><Plus /></button>) : <p>画布上暂无可加入的视频节点</p>}
        </div> : null}
      </section>

      {(review.status === 'rejected' || error) ? <div className="nori-playlist-feedback nodrag"><span>{review.status === 'rejected' ? '评审意见' : '操作失败'}</span><p>{error || review.lastReviewNote || '审核员已标注修改项，请打开“我的任务”查看时段批注。'}</p>{review.annotationCount ? <small>{review.annotationCount} 条时段批注</small> : null}</div> : null}
      {review.status === 'completed' ? <div className="nori-playlist-approved nodrag"><Check />该播放列表版本已通过最终审核</div> : null}
      <Handle type="target" position={Position.Left} id="input" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
      <Handle type="source" position={Position.Right} id="output" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
    </div>
  )
}

export const PlaylistNode = memo(PlaylistNodeImpl)
PlaylistNode.displayName = 'PlaylistNode'
