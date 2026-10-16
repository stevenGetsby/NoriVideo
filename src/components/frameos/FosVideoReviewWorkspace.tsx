'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { AppIcon } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { FosShell } from './FosShell'
import { AssignmentStatusChip } from './FosAssignmentControls'
import type {
  AssignmentTab,
  VideoReviewAnnotationDraft,
  VideoReviewAnnotationRecord,
  VideoReviewContext,
  VideoReviewSource,
} from './assignments-view-model'

const DEFAULT_RANGE_MS = 2_000
const RANGE_STEP_MS = 100

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function formatClock(value: number) {
  const totalMs = Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1_000)
  const tenths = Math.floor((totalMs % 1_000) / 100)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

function ReviewRangeSlider({
  startMs,
  endMs,
  maximumMs,
  onChange,
  onCommit,
}: {
  startMs: number
  endMs: number
  maximumMs: number
  onChange: (boundary: 'start' | 'end', value: number) => void
  onCommit: (boundary: 'start' | 'end', value: number) => void
}) {
  const safeMaximum = Math.max(RANGE_STEP_MS, Math.round(maximumMs))
  const startPercent = clamp((startMs / safeMaximum) * 100, 0, 100)
  const endPercent = clamp((endMs / safeMaximum) * 100, 0, 100)
  const style = {
    '--fvr-range-start': `${startPercent}%`,
    '--fvr-range-end': `${endPercent}%`,
  } as CSSProperties
  const commitOnKey = (event: ReactKeyboardEvent<HTMLInputElement>, boundary: 'start' | 'end') => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      onCommit(boundary, Number(event.currentTarget.value))
    }
  }

  return (
    <div className="fvr-range-editor" style={style}>
      <div className="fvr-range-timecodes">
        <span><i className="is-start" />起点 <time>{formatClock(startMs)}</time></span>
        <span><i className="is-end" />终点 <time>{formatClock(endMs)}</time></span>
      </div>
      <div className="fvr-range-slider">
        <div className="fvr-range-slider-track"><span /></div>
        <input
          type="range"
          aria-label="评审开始时间"
          min={0}
          max={safeMaximum}
          step={RANGE_STEP_MS}
          value={startMs}
          onChange={(event) => onChange('start', Number(event.target.value))}
          onPointerUp={(event) => onCommit('start', Number(event.currentTarget.value))}
          onKeyUp={(event) => commitOnKey(event, 'start')}
        />
        <input
          type="range"
          aria-label="评审结束时间"
          min={0}
          max={safeMaximum}
          step={RANGE_STEP_MS}
          value={endMs}
          onChange={(event) => onChange('end', Number(event.target.value))}
          onPointerUp={(event) => onCommit('end', Number(event.currentTarget.value))}
          onKeyUp={(event) => commitOnKey(event, 'end')}
        />
        <span className="fvr-range-handle-label is-start">开始</span>
        <span className="fvr-range-handle-label is-end">结束</span>
      </div>
      <div className="fvr-range-scale"><time>00:00:00.0</time><time>{formatClock(safeMaximum / 2)}</time><time>{formatClock(safeMaximum)}</time></div>
    </div>
  )
}

function sourceForAnnotation(
  sources: VideoReviewSource[],
  annotation: Pick<VideoReviewAnnotationDraft, 'panelId' | 'startMs' | 'endMs'>,
) {
  if (!annotation.panelId) return sources.find((source) => source.kind === 'episode') || null
  return sources.find((source) => (
    source.panelId === annotation.panelId
    && annotation.startMs >= source.startMs
    && annotation.endMs <= source.endMs
  )) || sources.find((source) => source.panelId === annotation.panelId) || null
}

function annotationTime(annotation: Pick<VideoReviewAnnotationDraft, 'startMs' | 'endMs'>) {
  return `${formatClock(annotation.startMs)} – ${formatClock(annotation.endMs)}`
}

export function FosVideoReviewWorkspace({
  assignmentId,
  returnTab = 'pending_review',
}: {
  assignmentId: string
  returnTab?: AssignmentTab
}) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const continuePlaybackRef = useRef(false)
  const [context, setContext] = useState<VideoReviewContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sequenceIndex, setSequenceIndex] = useState(0)
  const [currentGlobalMs, setCurrentGlobalMs] = useState(0)
  const [rangeStartMs, setRangeStartMs] = useState(0)
  const [rangeEndMs, setRangeEndMs] = useState(DEFAULT_RANGE_MS)
  const [annotationNote, setAnnotationNote] = useState('')
  const [overallNote, setOverallNote] = useState('')
  const [drafts, setDrafts] = useState<VideoReviewAnnotationDraft[]>([])
  const [busyAction, setBusyAction] = useState<'approve' | 'reject' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${encodeURIComponent(assignmentId)}/video-review`, { signal })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载本集审核内容失败'))
      const payload = await response.json() as VideoReviewContext
      const sources = Array.isArray(payload.sources) ? payload.sources : []
      setContext({ ...payload, sources, annotations: Array.isArray(payload.annotations) ? payload.annotations : [] })
      const firstSource = sources.find((source) => source.kind === 'episode') || sources[0]
      setSequenceIndex(0)
      setCurrentGlobalMs(firstSource?.startMs || 0)
      setRangeStartMs(0)
      setRangeEndMs(Math.min(firstSource?.durationMs || DEFAULT_RANGE_MS, DEFAULT_RANGE_MS))
    } catch (error) {
      if (signal?.aborted) return
      setLoadError(error instanceof Error ? error.message : '加载本集审核内容失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [assignmentId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const sources = context?.sources || []
  const episodeSource = sources.find((source) => source.kind === 'episode') || null
  const segmentSources = sources.filter((source) => source.kind === 'segment' || Boolean(source.panelId))
  const selectedSource = episodeSource || segmentSources[0] || null
  const isEpisodeSource = selectedSource?.kind === 'episode' || !selectedSource?.panelId
  const sequenceSegment = isEpisodeSource && selectedSource?.virtualSequence
    ? segmentSources[clamp(sequenceIndex, 0, Math.max(0, segmentSources.length - 1))] || null
    : null
  const playbackSource = sequenceSegment || selectedSource
  const previewUrl = toDisplayImageUrl(playbackSource?.videoUrl)
  const posterUrl = toDisplayImageUrl(playbackSource?.imageUrl)
  const detailSource = isEpisodeSource
    ? sequenceSegment
      || segmentSources.find((source, index) => currentGlobalMs >= source.startMs && (
        currentGlobalMs < source.endMs
        || (index === segmentSources.length - 1 && currentGlobalMs <= source.endMs)
      ))
      || segmentSources[0]
      || selectedSource
    : selectedSource
  const rangeMaximum = episodeSource?.durationMs || context?.durationMs || selectedSource?.durationMs || 0
  const invalidRange = rangeEndMs <= rangeStartMs || rangeStartMs < 0 || rangeEndMs > rangeMaximum
  const canAnnotate = context?.assignment.canAnnotate === true
  const isCanvasPlaylist = context?.reviewTarget?.kind === 'canvas_playlist'
  const canAddAnnotation = canAnnotate && annotationNote.trim().length > 0 && !invalidRange
  const existingAnnotations = useMemo(() => context?.annotations || [], [context?.annotations])

  const annotationCount = useCallback((source: VideoReviewSource) => {
    const belongsToSource = (annotation: Pick<VideoReviewAnnotationDraft, 'panelId'>) => (
      source.kind === 'episode' || !source.panelId
        ? true
        : annotation.panelId === source.panelId
    )
    return drafts.filter(belongsToSource).length
      + existingAnnotations.filter((annotation) => annotation.status === 'open' && belongsToSource(annotation)).length
  }, [drafts, existingAnnotations])

  const seekEpisodeStart = () => {
    setSequenceIndex(0)
    setCurrentGlobalMs(0)
    setRangeStartMs(0)
    setRangeEndMs(Math.min(rangeMaximum, DEFAULT_RANGE_MS))
    setAnnotationNote('')
    pendingSeekRef.current = 0
    if (videoRef.current) videoRef.current.currentTime = 0
  }

  const seekEpisodeToSegment = (source: VideoReviewSource) => {
    const index = segmentSources.findIndex((segment) => segment.id === source.id)
    if (selectedSource?.virtualSequence && index >= 0) {
      if (index === sequenceIndex && videoRef.current) videoRef.current.currentTime = 0
      setSequenceIndex(index)
    } else if (videoRef.current) {
      videoRef.current.currentTime = source.startMs / 1_000
    }
    setCurrentGlobalMs(source.startMs)
    setRangeStartMs(source.startMs)
    setRangeEndMs(Math.min(rangeMaximum, source.startMs + Math.min(DEFAULT_RANGE_MS, source.durationMs)))
    setAnnotationNote('')
    pendingSeekRef.current = source.startMs
  }

  const playbackGlobalMs = () => {
    const mediaMs = Math.round((videoRef.current?.currentTime || 0) * 1_000)
    if (isEpisodeSource && !selectedSource?.virtualSequence) return mediaMs
    return (playbackSource?.startMs || 0) + Math.max(0, mediaMs - (playbackSource?.trimStartMs || 0))
  }

  const updateRangeBoundary = (boundary: 'start' | 'end', rawValue: number) => {
    const minimumGap = Math.min(RANGE_STEP_MS, rangeMaximum)
    if (boundary === 'start') {
      setRangeStartMs(clamp(Math.round(rawValue), 0, Math.max(0, rangeEndMs - minimumGap)))
      return
    }
    setRangeEndMs(clamp(Math.round(rawValue), Math.min(rangeMaximum, rangeStartMs + minimumGap), rangeMaximum))
  }

  const takeCurrentPoint = (boundary: 'start' | 'end') => {
    const globalMs = playbackGlobalMs()
    const localMs = isEpisodeSource ? globalMs : globalMs - (selectedSource?.startMs || 0)
    const value = clamp(localMs, 0, rangeMaximum)
    const minimumGap = Math.min(RANGE_STEP_MS, rangeMaximum)
    if (boundary === 'start') {
      const nextEnd = rangeEndMs <= value
        ? Math.min(rangeMaximum, value + DEFAULT_RANGE_MS)
        : rangeEndMs
      setRangeEndMs(nextEnd)
      setRangeStartMs(clamp(value, 0, Math.max(0, nextEnd - minimumGap)))
      return
    }
    const nextStart = rangeStartMs >= value
      ? Math.max(0, value - DEFAULT_RANGE_MS)
      : rangeStartMs
    setRangeStartMs(nextStart)
    setRangeEndMs(clamp(value, Math.min(rangeMaximum, nextStart + minimumGap), rangeMaximum))
  }

  const applyPendingSeek = useCallback(() => {
    const target = pendingSeekRef.current
    const video = videoRef.current
    if (target == null || !video || video.readyState < 1 || !playbackSource) return
    const localMs = isEpisodeSource && !selectedSource?.virtualSequence
      ? target
      : (playbackSource.trimStartMs || 0) + target - playbackSource.startMs
    const trimEndSeconds = (playbackSource.trimEndMs || 0) / 1_000
    const mediaMaximum = trimEndSeconds > 0
      ? trimEndSeconds
      : Number.isFinite(video.duration) ? video.duration : localMs / 1_000
    video.currentTime = clamp(localMs / 1_000, 0, mediaMaximum)
    pendingSeekRef.current = null
    if (continuePlaybackRef.current) {
      continuePlaybackRef.current = false
      void video.play().catch(() => undefined)
    }
  }, [isEpisodeSource, playbackSource, selectedSource?.virtualSequence])

  useEffect(() => { applyPendingSeek() }, [applyPendingSeek, previewUrl])

  const commitRangeBoundary = (boundary: 'start' | 'end', rawValue: number) => {
    if (!selectedSource) return
    const minimumGap = Math.min(RANGE_STEP_MS, rangeMaximum)
    const localMs = boundary === 'start'
      ? clamp(Math.round(rawValue), 0, Math.max(0, rangeEndMs - minimumGap))
      : clamp(Math.round(rawValue), Math.min(rangeMaximum, rangeStartMs + minimumGap), rangeMaximum)
    if (boundary === 'start') setRangeStartMs(localMs)
    else setRangeEndMs(localMs)
    const globalMs = isEpisodeSource ? localMs : selectedSource.startMs + localMs
    pendingSeekRef.current = globalMs
    setCurrentGlobalMs(globalMs)
    if (isEpisodeSource && selectedSource.virtualSequence) {
      const targetIndex = segmentSources.findIndex((source, index) => (
        globalMs >= source.startMs
        && (globalMs < source.endMs || (index === segmentSources.length - 1 && globalMs <= source.endMs))
      ))
      if (targetIndex >= 0 && targetIndex !== sequenceIndex) {
        setSequenceIndex(targetIndex)
        return
      }
    }
    window.requestAnimationFrame(applyPendingSeek)
  }

  const handleEnded = () => {
    if (!isEpisodeSource || !selectedSource?.virtualSequence || sequenceIndex >= segmentSources.length - 1) return
    if (continuePlaybackRef.current) return
    const nextIndex = sequenceIndex + 1
    const next = segmentSources[nextIndex]
    continuePlaybackRef.current = true
    pendingSeekRef.current = next.startMs
    setSequenceIndex(nextIndex)
    setCurrentGlobalMs(next.startMs)
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    const trimStartMs = playbackSource?.trimStartMs || 0
    const trimEndMs = playbackSource?.trimEndMs || 0
    if (video && trimStartMs && video.currentTime * 1_000 < trimStartMs - 40) {
      video.currentTime = trimStartMs / 1_000
      setCurrentGlobalMs(playbackSource?.startMs || 0)
      return
    }
    setCurrentGlobalMs(playbackGlobalMs())
    if (!video || !trimEndMs || video.currentTime * 1_000 < trimEndMs - 40) return
    video.pause()
    handleEnded()
  }

  const addAnnotation = () => {
    if (!canAddAnnotation || !selectedSource) return
    const containingSegment = segmentSources.find((source) => (
      rangeStartMs >= source.startMs && rangeEndMs <= source.endMs
    ))
    const annotationPanelId = containingSegment?.panelId || null
    setDrafts((current) => [...current, {
      id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      panelId: annotationPanelId,
      startMs: rangeStartMs,
      endMs: rangeEndMs,
      note: annotationNote.trim(),
    }].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs))
    setAnnotationNote('')
  }

  const focusAnnotation = (annotation: VideoReviewAnnotationDraft | VideoReviewAnnotationRecord) => {
    const segmentIndex = segmentSources.findIndex((source, index) => (
      annotation.startMs >= source.startMs
      && (annotation.startMs < source.endMs || (index === segmentSources.length - 1 && annotation.startMs <= source.endMs))
    ))
    const changesSequence = Boolean(selectedSource?.virtualSequence && segmentIndex >= 0 && segmentIndex !== sequenceIndex)
    if (changesSequence) setSequenceIndex(segmentIndex)
    setRangeStartMs(clamp(annotation.startMs, 0, rangeMaximum))
    setRangeEndMs(clamp(annotation.endMs, 0, rangeMaximum))
    setCurrentGlobalMs(annotation.startMs)
    pendingSeekRef.current = annotation.startMs
    if (changesSequence) return
    window.requestAnimationFrame(applyPendingSeek)
  }

  const runReview = async (action: 'approve' | 'reject') => {
    if (!canAnnotate || busyAction) return
    if (action === 'reject' && !overallNote.trim() && drafts.length === 0) {
      setActionError('请填写整集修改意见，或至少添加一条时段批注。')
      return
    }
    setBusyAction(action)
    setActionError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId,
          ...(overallNote.trim() ? { note: overallNote.trim() } : {}),
          ...(action === 'reject' ? {
            videoAnnotations: drafts.map(({ panelId, startMs, endMs, note }) => ({ panelId: panelId || null, startMs, endMs, note })),
          } : {}),
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, action === 'approve' ? '审核通过失败' : '提交修改意见失败'))
      router.push({ pathname: '/my-assignments', query: { tab: action === 'approve' ? 'done' : 'pending_review' } })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '审核操作失败')
    } finally {
      setBusyAction(null)
    }
  }

  const backToTasks = () => router.push({ pathname: '/my-assignments', query: { tab: returnTab } })
  const openStoryboardProduction = () => {
    if (!context) return
    if (context.reviewTarget?.kind === 'canvas_playlist') {
      router.push({
        pathname: `/workflow/${context.assignment.projectId}/workbench-premium2/canvas/${context.reviewTarget.canvasId}`,
        query: { node_id: context.reviewTarget.nodeId },
      })
      return
    }
    router.push({
      pathname: `/workflow/${context.assignment.projectId}/workbench-premium2/production/shot`,
      query: context.assignment.episodeId ? { episode_id: context.assignment.episodeId, from: 'video-review' } : {},
    })
  }
  const playheadPercent = context?.durationMs
    ? clamp((currentGlobalMs / context.durationMs) * 100, 0, 100)
    : 0
  const annotationMarkerStyle = (annotation: Pick<VideoReviewAnnotationDraft, 'startMs' | 'endMs'>) => {
    const durationMs = Math.max(1, context?.durationMs || 0)
    const start = clamp(annotation.startMs, 0, durationMs)
    const end = clamp(annotation.endMs, start, durationMs)
    return {
      left: `${(start / durationMs) * 100}%`,
      width: `${Math.max(0.45, ((end - start) / durationMs) * 100)}%`,
    }
  }

  return (
    <FosShell activeKey="assignments">
      <section className="fvr-page" data-testid="video-review-workspace">
        <header className="fvr-header">
          <button type="button" className="fvr-back" onClick={backToTasks}><AppIcon name="chevronLeft" />返回我的任务</button>
          <div className="fvr-heading">
            <span>{context?.assignment.workName || '项目'} / {context?.assignment.projectName || '作品'}</span>
            <h1>{isCanvasPlaylist ? '播放列表最终审核' : `第 ${context?.assignment.episodeNumber ?? '—'} 集视频审核`}</h1>
            <p>{context?.assignment.episodeName || (isCanvasPlaylist ? '画布播放列表' : '未命名分集')} · {segmentSources.length} 个 {isCanvasPlaylist ? 'Clip' : 'Segment'}</p>
          </div>
          {context ? <AssignmentStatusChip status={context.assignment.status} /> : null}
        </header>

        {loading ? <div className="fvr-state"><AppIcon name="loader" className="animate-spin" />正在读取本次提交快照…</div> : null}
        {!loading && loadError ? <div className="fvr-state is-error"><AppIcon name="alert" />{loadError}<button type="button" onClick={() => void load()}>重新加载</button></div> : null}

        {!loading && !loadError && context ? (
          <div className="fvr-layout">
            <aside className="fvr-segments">
              <div className="fvr-rail-title"><span>{isCanvasPlaylist ? '播放列表导航' : '整集导航'}</span><small>{segmentSources.length} 段</small></div>
              {episodeSource ? (
                <button type="button" className="fvr-source-card is-episode is-active" onClick={seekEpisodeStart}>
                  <span className="fvr-source-index">ALL</span>
                  <div><strong>整集连续预览</strong><small>{formatClock(episodeSource.durationMs)} · 多段标注</small></div>
                  {annotationCount(episodeSource) ? <em>{annotationCount(episodeSource)}</em> : null}
                </button>
              ) : null}
              <div className="fvr-rail-divider"><span>{isCanvasPlaylist ? 'Clips' : 'Segments'}</span></div>
              {segmentSources.map((source) => (
                <button type="button" className={`fvr-source-card${detailSource?.panelId === source.panelId ? ' is-current' : ''}`} key={source.id} onClick={() => seekEpisodeToSegment(source)}>
                  <span className="fvr-source-index">{String(source.sequence || 0).padStart(2, '0')}</span>
                  <div><strong>{source.label}</strong><small>{formatClock(source.durationMs)} · {source.shotType || '未标注景别'}</small></div>
                  {annotationCount(source) ? <em>{annotationCount(source)}</em> : null}
                </button>
              ))}
              <div className="fvr-snapshot-note"><AppIcon name="check" /><span>当前展示提交时的版本快照，不会被后续重新生成覆盖。</span></div>
            </aside>

            <main className="fvr-preview-column">
              <div className="fvr-preview-head">
                <div><span>整集连续预览</span><small>{selectedSource?.virtualSequence ? `正在播放 ${playbackSource?.label || ''}` : '提交版本'}</small></div>
                <time>{formatClock(currentGlobalMs)} / {formatClock(context.durationMs)}</time>
              </div>
              <div className="fvr-player">
                {previewUrl ? (
                  <video
                    ref={videoRef}
                    key={previewUrl}
                    src={previewUrl}
                    poster={posterUrl || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={applyPendingSeek}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleEnded}
                  />
                ) : (
                  <div className="fvr-player-empty"><AppIcon name="video" /><strong>该 Segment 的提交视频不可用</strong><span>请检查媒体存储地址或重新提交全集进行评审。</span></div>
                )}
              </div>

              <div className="fvr-timeline" aria-label="整集 Segment 时间线">
                <div className="fvr-timeline-ruler"><span>00:00:00.0</span><span>{formatClock(context.durationMs)}</span></div>
                <div className="fvr-timeline-track">
                  {segmentSources.map((source) => (
                    <button
                      type="button"
                      key={source.id}
                      title={`${source.label} ${formatClock(source.startMs)}–${formatClock(source.endMs)}`}
                      className={detailSource?.panelId === source.panelId ? 'is-active' : ''}
                      style={{ width: `${Math.max(2, (source.durationMs / Math.max(1, context.durationMs)) * 100)}%` }}
                      onClick={() => seekEpisodeToSegment(source)}
                    ><span>{source.segmentLabel || source.label}</span></button>
                  ))}
                  <i style={{ left: `${playheadPercent}%` }} />
                </div>
                <div className="fvr-annotation-lane-head"><span>整集时段标注</span><small>{drafts.length + existingAnnotations.length} 段</small></div>
                <div className="fvr-annotation-lane" aria-label="整集多段评审批注">
                  {existingAnnotations.map((annotation, index) => {
                    const source = sourceForAnnotation(sources, annotation)
                    return <button type="button" className={`is-history${annotation.status === 'resolved' ? ' is-resolved' : ''}`} key={`history-${annotation.id}`} style={annotationMarkerStyle(annotation)} title={`${source?.label || '整集'} · ${annotationTime(annotation)} · ${annotation.note}`} onClick={() => focusAnnotation(annotation)}><span>{index + 1}</span></button>
                  })}
                  {drafts.map((annotation, index) => {
                    const source = sourceForAnnotation(sources, annotation)
                    return <button type="button" className="is-draft" key={`draft-${annotation.id}`} style={annotationMarkerStyle(annotation)} title={`${source?.label || '整集'} · ${annotationTime(annotation)} · ${annotation.note}`} onClick={() => focusAnnotation(annotation)}><span>{index + 1}</span></button>
                  })}
                  {!drafts.length && !existingAnnotations.length ? <p>拖动右侧双指针添加第一段批注</p> : null}
                </div>
              </div>

              <section className="fvr-storyboard">
                <div className="fvr-section-heading"><div><AppIcon name="fileText" /><span>{detailSource?.label || (isCanvasPlaylist ? '当前 Clip' : '当前 Segment')} · {isCanvasPlaylist ? '播放列表片段' : '分镜内容'}</span></div><span className="fvr-section-actions"><small>{detailSource?.location || (isCanvasPlaylist ? '画布视频节点' : '未填写场景')}</small><button type="button" onClick={openStoryboardProduction}>{isCanvasPlaylist ? '返回播放列表节点' : '进入分镜制作'}</button></span></div>
                <div className="fvr-storyboard-grid">
                  <div className="fvr-storyboard-image">
                    {toDisplayImageUrl(detailSource?.imageUrl) ? <MediaImage src={toDisplayImageUrl(detailSource?.imageUrl)} alt={detailSource?.label || '分镜参考图'} fill sizes="240px" style={{ objectFit: 'contain' }} /> : <AppIcon name="imageLandscape" />}
                  </div>
                  <div className="fvr-storyboard-copy">
                    <div className="fvr-metadata"><span>{detailSource?.shotType || '景别未填'}</span><span>{detailSource?.cameraMove || '运镜未填'}</span><span>{formatClock(detailSource?.durationMs || 0)}</span></div>
                    <h3>剧本 / 画面</h3><p>{detailSource?.sourceText || detailSource?.description || '本 Segment 暂无分镜文字。'}</p>
                    <div className="fvr-assets">
                      {[...(detailSource?.characters || []).map((name) => `角色 · @${name}`), ...(detailSource?.props || []).map((name) => `物品 · @${name}`)].map((item) => <span key={item}>{item}</span>)}
                    </div>
                  </div>
                  <div className="fvr-prompt-wide"><h3>生视频提示词</h3><p>{detailSource?.videoPrompt || '未填写视频提示词。'}</p></div>
                </div>
              </section>
            </main>

            <aside className="fvr-review-panel">
              <div className="fvr-review-title"><div><AppIcon name="clipboardCheck" /><span>整集预览 · 多段标注</span></div><small>{canAnnotate ? '审核中' : '只读'}</small></div>
              {canAnnotate ? (
                <>
                  <div className="fvr-target"><span>当前播放位置</span><strong>{detailSource?.label || '整集连续时间轴'}</strong><p>所有时间码均对应整集时间轴；点击左侧 Segment 只会快速定位，不会切换评审模式。</p></div>
                  <label className="fvr-overall fvr-overall-editor"><span>整集修改意见</span><textarea rows={4} maxLength={1_000} value={overallNote} onChange={(event) => setOverallNote(event.target.value)} placeholder="填写跨 Segment 的节奏、叙事、整体风格或合成问题…" /><small>{overallNote.length} / 1000</small></label>
                  <div className="fvr-range-heading"><span>添加一段时段批注</span><small>可连续添加多段</small></div>
                  <ReviewRangeSlider
                    startMs={rangeStartMs}
                    endMs={rangeEndMs}
                    maximumMs={rangeMaximum}
                    onChange={updateRangeBoundary}
                    onCommit={commitRangeBoundary}
                  />
                  <div className="fvr-range-actions">
                    <button type="button" onClick={() => takeCurrentPoint('start')}>当前播放点设为开始</button>
                    <button type="button" onClick={() => takeCurrentPoint('end')}>当前播放点设为结束</button>
                  </div>
                  {invalidRange ? <div className="fvr-range-error"><AppIcon name="alert" />开始与结束指针的范围无效</div> : null}
                  <label className="fvr-note"><span>该时段评审意见</span><textarea rows={4} maxLength={1_000} value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} placeholder="描述该时间段的画面、动作、连续性、角色变体或声音应如何修改…" /></label>
                  <button type="button" className="fvr-add" disabled={!canAddAnnotation} onClick={addAnnotation}><AppIcon name="plus" />添加时段批注</button>
                </>
              ) : <div className="fvr-readonly-note">该任务当前不是待审核状态，已切换为只读查看。</div>}

              <div className="fvr-comments-head"><span>本次时段批注</span><small>{drafts.length} 条</small></div>
              <div className="fvr-comments">
                {drafts.map((annotation, index) => {
                  const source = sourceForAnnotation(sources, annotation)
                  return <article key={annotation.id} onClick={() => focusAnnotation(annotation)}><b>{String(index + 1).padStart(2, '0')}</b><div><span>{source?.label || '跨 Segment'}</span><time>{annotationTime(annotation)}</time><p>{annotation.note}</p></div><button type="button" aria-label="删除批注" onClick={(event) => { event.stopPropagation(); setDrafts((current) => current.filter((item) => item.id !== annotation.id)) }}><AppIcon name="trash" /></button></article>
                })}
                {!drafts.length ? <p className="fvr-comments-empty">选择整集或 Segment，拖动开始、结束指针后添加批注。</p> : null}
              </div>

              {existingAnnotations.length ? <ExistingAnnotations annotations={existingAnnotations} sources={sources} onFocus={focusAnnotation} /> : null}

              {!canAnnotate && isEpisodeSource && context.assignment.lastReviewNote ? <div className="fvr-overall is-readonly"><span>整集审核意见</span><p>{context.assignment.lastReviewNote}</p></div> : null}
              {actionError ? <div className="fvr-action-error"><AppIcon name="alert" />{actionError}</div> : null}
              {canAnnotate ? (
                <div className="fvr-actions">
                  <button type="button" className="is-reject" disabled={Boolean(busyAction)} onClick={() => void runReview('reject')}>{busyAction === 'reject' ? <AppIcon name="loader" className="animate-spin" /> : null}发布修改意见</button>
                  <button type="button" className="is-approve" title={drafts.length ? '请先删除本次修改批注，或选择发布修改意见' : ''} disabled={Boolean(busyAction) || drafts.length > 0} onClick={() => void runReview('approve')}>{busyAction === 'approve' ? <AppIcon name="loader" className="animate-spin" /> : <AppIcon name="check" />}审核通过</button>
                </div>
              ) : null}
            </aside>
          </div>
        ) : null}
      </section>
    </FosShell>
  )
}

function ExistingAnnotations({
  annotations,
  sources,
  onFocus,
}: {
  annotations: VideoReviewAnnotationRecord[]
  sources: VideoReviewSource[]
  onFocus: (annotation: VideoReviewAnnotationRecord) => void
}) {
  return (
    <>
      <div className="fvr-comments-head"><span>历史评审</span><small>{annotations.length} 条</small></div>
      <div className="fvr-comments is-history">
        {annotations.map((annotation, index) => {
          const source = sourceForAnnotation(sources, annotation)
          return <article key={annotation.id} onClick={() => onFocus(annotation)}><b>{String(index + 1).padStart(2, '0')}</b><div><span>{source?.label || '跨 Segment'}</span><time>{annotationTime(annotation)}</time><p>{annotation.note}</p></div><em>{annotation.status === 'open' ? '待修改' : '已处理'}</em></article>
        })}
      </div>
    </>
  )
}
