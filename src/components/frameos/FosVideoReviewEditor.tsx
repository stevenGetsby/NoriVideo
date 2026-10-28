'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import {
  formatVideoReviewTimecode,
  type CollaborationAssignment,
  type VideoReviewAnnotationDraft,
  type VideoReviewContext,
  type VideoReviewSource,
} from './assignments-view-model'

let localAnnotationSequence = 0

function secondsInput(ms: number) {
  return Math.max(0, ms / 1_000).toFixed(1)
}

function inputMs(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1_000)) : 0
}

export function FosVideoReviewEditor({
  assignment,
  value,
  onChange,
  readOnly = false,
}: {
  assignment: CollaborationAssignment
  value: VideoReviewAnnotationDraft[]
  onChange: (annotations: VideoReviewAnnotationDraft[]) => void
  readOnly?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [context, setContext] = useState<VideoReviewContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [startMs, setStartMs] = useState(0)
  const [endMs, setEndMs] = useState(5_000)
  const [note, setNote] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void apiFetch(`/api/collaboration/assignments/${encodeURIComponent(assignment.id)}/video-review`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载视频审查内容失败'))
      return await response.json() as VideoReviewContext
    }).then((payload) => {
      const sources = Array.isArray(payload.sources) ? payload.sources : []
      setContext({ ...payload, sources })
      const first = sources.find((source) => Boolean(source.panelId)) || sources[0]
      if (first) {
        setSourceId(first.id)
        setStartMs(first.startMs)
        setEndMs(first.endMs > first.startMs ? first.endMs : first.startMs + 5_000)
      }
    }).catch((loadError) => {
      if (controller.signal.aborted) return
      setError(loadError instanceof Error ? loadError.message : '加载视频审查内容失败')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [assignment.id])

  const selectedSource = useMemo<VideoReviewSource | null>(() => (
    context?.sources.find((source) => source.id === sourceId) || context?.sources[0] || null
  ), [context, sourceId])
  const shotSources = useMemo(() => (
    (context?.sources || []).filter((source) => Boolean(source.panelId))
  ), [context])
  const previewUrl = toDisplayImageUrl(selectedSource?.videoUrl)
  const outsideSelectedShot = Boolean(selectedSource?.panelId) && (
    startMs < (selectedSource?.startMs || 0)
    || endMs > (selectedSource?.endMs || 0)
  )
  const invalidRange = endMs <= startMs || outsideSelectedShot
  const canAdd = note.trim().length > 0 && !invalidRange
  const recordedAnnotations = (context?.annotations || []).filter((annotation) => readOnly || annotation.status === 'resolved')

  const annotationSourceLabel = (panelId: string | null | undefined) => {
    if (!panelId) return '本集整体'
    return context?.sources.find((source) => source.panelId === panelId)?.label || '未知 Segment'
  }

  const chooseSource = (source: VideoReviewSource) => {
    setSourceId(source.id)
    setStartMs(source.startMs)
    setEndMs(source.endMs > source.startMs ? source.endMs : source.startMs + 5_000)
  }

  const syncVideoMetadataDuration = () => {
    const measuredSeconds = videoRef.current?.duration
    if (!selectedSource || typeof measuredSeconds !== 'number' || !Number.isFinite(measuredSeconds) || measuredSeconds <= 0) return
    const measuredDurationMs = Math.max(1, Math.round(measuredSeconds * 1_000))
    setContext((current) => {
      if (!current) return current
      const measuredSources = current.sources.map((source) => source.id === selectedSource.id ? {
        ...source,
        durationMs: measuredDurationMs,
        endMs: source.startMs + measuredDurationMs,
      } : source)
      let panelCursorMs = 0
      const reflowedPanels = new Map<string, VideoReviewSource>()
      for (const source of measuredSources.filter((item) => item.panelId)) {
        const startMs = panelCursorMs
        panelCursorMs += source.durationMs
        reflowedPanels.set(source.id, { ...source, startMs, endMs: panelCursorMs })
      }
      const sources = measuredSources.map((source) => reflowedPanels.get(source.id) || source)
      const outputDurationMs = sources
        .filter((source) => !source.panelId)
        .reduce((maximum, source) => Math.max(maximum, source.durationMs), 0)
      const durationMs = Math.max(panelCursorMs, outputDurationMs)
      return { ...current, sources, durationMs }
    })
    setEndMs(selectedSource.startMs + measuredDurationMs)
  }

  const currentEpisodeMs = () => {
    const localMs = Math.round((videoRef.current?.currentTime || 0) * 1_000)
    return (selectedSource?.startMs || 0) + localMs
  }

  const addAnnotation = () => {
    if (!canAdd) return
    localAnnotationSequence += 1
    onChange([...value, {
      id: `video-review-${Date.now()}-${localAnnotationSequence}`,
      panelId: selectedSource?.panelId || null,
      startMs,
      endMs,
      note: note.trim(),
    }].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs))
    setNote('')
  }

  return (
    <section className="fa-video-review" aria-label="视频时段审查">
      <div className="fa-video-review-title">
        <div><AppIcon name="video" /><span>逐 Segment 视频批注</span></div>
        <small>本集 {shotSources.length} 个 Segment · 选择 Segment 后播放、取点并填写修改意见</small>
      </div>

      {loading ? <div className="fa-video-review-state"><AppIcon name="loader" className="animate-spin" />正在加载本集视频…</div> : null}
      {error ? <div className="fa-video-review-state is-error"><AppIcon name="alert" />{error}</div> : null}

      {!loading && !error ? (
        <div className={`fa-video-review-grid${readOnly ? ' is-read-only' : ''}`}>
          <div className="fa-video-review-preview">
            {previewUrl ? (
              <video ref={videoRef} key={previewUrl} src={previewUrl} controls playsInline preload="metadata" onLoadedMetadata={syncVideoMetadataDuration} />
            ) : (
              <div className="fa-video-review-empty"><AppIcon name="video" /><span>本集还没有可播放的视频</span><small>仍可按时间码填写审查意见</small></div>
            )}
            {context?.sources.length ? (
              <div className="fa-video-source-list" aria-label="本集 Segment 列表">
                {context.sources.map((source) => (
                  <button
                    type="button"
                    key={source.id}
                    className={source.id === selectedSource?.id ? 'is-active' : ''}
                    aria-pressed={source.id === selectedSource?.id}
                    data-review-source={source.panelId ? 'shot' : 'episode'}
                    onClick={() => chooseSource(source)}
                  >
                    <span>{source.label}</span>
                    <small>{formatVideoReviewTimecode(source.startMs)}–{formatVideoReviewTimecode(source.endMs)}</small>
                    <em>{source.panelId ? `${value.filter((annotation) => annotation.panelId === source.panelId).length} 条本次批注` : '整集预览'}</em>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {!readOnly ? <div className="fa-video-review-form">
            <div className="fa-video-review-shot-context">
              <div><span>当前批注对象</span><strong>{selectedSource?.label || '未选择 Segment'}</strong></div>
              <small>{selectedSource?.panelId ? '批注将绑定到当前 Segment，分镜师可在对应镜头下查看。' : '当前是整集成片，适合填写跨 Segment 的整体问题。'}</small>
            </div>
            <div className="fa-timecode-fields">
              <label><span>本集开始时间（秒）</span><input type="number" min="0" step="0.1" value={secondsInput(startMs)} onChange={(event) => setStartMs(inputMs(event.target.value))} /></label>
              <button type="button" onClick={() => setStartMs(currentEpisodeMs())}>取当前播放点</button>
              <label><span>本集结束时间（秒）</span><input type="number" min="0" step="0.1" value={secondsInput(endMs)} onChange={(event) => setEndMs(inputMs(event.target.value))} /></label>
              <button type="button" onClick={() => setEndMs(currentEpisodeMs())}>取当前播放点</button>
            </div>
            <div className="fa-timecode-summary">
              <span>{formatVideoReviewTimecode(startMs)}</span><i>→</i><span>{formatVideoReviewTimecode(endMs)}</span>
              {endMs <= startMs ? <em>结束时间需晚于开始时间</em> : null}
              {outsideSelectedShot ? <em>时间范围必须位于当前 Segment 内</em> : null}
            </div>
            <label className="fa-video-note-field">
              <span>{selectedSource?.label || '当前 Segment'} · 该时段修改意见</span>
              <textarea rows={3} maxLength={1_000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：00:12.4–00:15.8 人物口型与台词不同步，请重新生成并保持镜头节奏。" />
            </label>
            <button type="button" className="fa-video-add" disabled={!canAdd} onClick={addAnnotation}><AppIcon name="plus" />添加到 {selectedSource?.label || '当前 Segment'}</button>
          </div> : null}
        </div>
      ) : null}

      {!readOnly ? <div className="fa-video-annotation-list">
        <div className="fa-video-annotation-head"><span>本次审查标注</span><small>{value.length} 条</small></div>
        {value.length ? value.map((annotation, index) => (
          <article key={annotation.id}>
            <b>{String(index + 1).padStart(2, '0')}</b>
            <div><span className="fa-video-annotation-source">{annotationSourceLabel(annotation.panelId)}</span><strong>{formatVideoReviewTimecode(annotation.startMs)} – {formatVideoReviewTimecode(annotation.endMs)}</strong><p>{annotation.note}</p></div>
            <button type="button" aria-label={`删除第 ${index + 1} 条标注`} onClick={() => onChange(value.filter((item) => item.id !== annotation.id))}><AppIcon name="trash" /></button>
          </article>
        )) : <p className="fa-video-annotation-empty">还没有时段标注；如仅需整体修改，也可以只填写下方总体意见。</p>}
      </div> : null}

      {recordedAnnotations.length ? (
        <div className="fa-video-annotation-list">
          <div className="fa-video-annotation-head"><span>{readOnly ? '已有时段标注' : '历史审查记录'}</span><small>{recordedAnnotations.length} 条</small></div>
          {recordedAnnotations.map((annotation, index) => (
            <article key={annotation.id}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <div><span className="fa-video-annotation-source">{annotationSourceLabel(annotation.panelId)}</span><strong>{formatVideoReviewTimecode(annotation.startMs)} – {formatVideoReviewTimecode(annotation.endMs)}</strong><p>{annotation.note}</p></div>
              <span className="shrink-0 rounded-full border border-white/20 bg-white/10 px-2 py-1 text-[9px] font-bold text-neutral-200">{annotation.status === 'open' ? '待处理' : '已处理'}</span>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
