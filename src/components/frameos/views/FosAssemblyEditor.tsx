'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { useEditorActions } from '@/features/video-editor/hooks/useEditorActions'
import { useEditorState } from '@/features/video-editor/hooks/useEditorState'
import { RemotionPreview, type RemotionPreviewHandle } from '@/features/video-editor/components/Preview'
import type { SourceAudioSegment, VideoClip, VideoEditorProject } from '@/features/video-editor/types/editor.types'
import { calculateTimelineDuration, computeClipPositions, framesToTime } from '@/features/video-editor/utils/time-utils'
import { sourceAudioTimelineStart } from '@/features/video-editor/utils/assembly-timeline'
import {
  createRoughCutClip,
  createRoughCutProject,
  normalizeRoughCutProject,
  roughCutDimensionsForRatio,
  type RoughCutSourcePanel,
} from '@/lib/novel-promotion/rough-cut'
import type { FosProjectData } from '../useFosProject'
import { useEpisodeVideoReview } from '../useEpisodeVideoReview'
import {
  formatVideoReviewTimecode,
  type VideoReviewAnnotationDraft,
  type VideoReviewAnnotationRecord,
  type VideoReviewSource,
} from '../assignments-view-model'
import { MentionPromptEditor } from '../materials/MentionPromptEditor'
import { FosAssemblyTimeline, type AssemblyTrackSelection } from './FosAssemblyTimeline'
import { FosProductionModeTabs } from './FosProductionModeTabs'
import { useRouter } from '@/i18n/navigation'

interface EditorPayload {
  projectData?: VideoEditorProject | null
  sourcePanels?: RoughCutSourcePanel[]
  videoRatio?: string | null
}

interface LoadedEditor {
  revision: number
  project: VideoEditorProject
  sources: RoughCutSourcePanel[]
  persisted: boolean
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function audioSegmentsForClip(clip: VideoClip): SourceAudioSegment[] {
  if (clip.sourceAudio?.detached) {
    return clip.sourceAudio.segments ?? [{ id: `source:${clip.id}`, from: 0, to: clip.durationInFrames, volume: clip.sourceAudio.volume }]
  }
  return [{ id: `source:${clip.id}`, from: 0, to: clip.durationInFrames, volume: 1 }]
}

function createAudioSegmentId(clipId: string) {
  return `audio:${clipId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function FosAssemblyEditor({ data, initialEpisodeId }: { data: FosProjectData; initialEpisodeId?: string }) {
  const router = useRouter()
  const { data: session } = useSession()
  const roleCanEdit = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['storyboardWrite'])
  const preferredEpisodeId = data.episodes.find((episode) => episode.id === initialEpisodeId)?.id || data.episodes[0]?.id || ''
  const [episodeId, setEpisodeId] = useState(preferredEpisodeId)
  const [loaded, setLoaded] = useState<LoadedEditor | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEpisodeId((current) => data.episodes.some((episode) => episode.id === current) ? current : preferredEpisodeId)
  }, [data.episodes, preferredEpisodeId])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!episodeId) { setLoaded(null); return }
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/editor?episodeId=${encodeURIComponent(episodeId)}`, { signal })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载组装工程失败'))
      const payload = await response.json() as EditorPayload
      const sources = Array.isArray(payload.sourcePanels) ? payload.sourcePanels : []
      const saved = normalizeRoughCutProject(payload.projectData, episodeId, sources)
      const project = saved || createRoughCutProject(episodeId, sources, 30, roughCutDimensionsForRatio(payload.videoRatio))
      setLoaded({ revision: Date.now(), project, sources, persisted: Boolean(saved) })
    } catch (loadError) {
      if (signal?.aborted) return
      setLoaded(null)
      setError(loadError instanceof Error ? loadError.message : '加载组装工程失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [data.projectId, episodeId])

  useEffect(() => {
    setLoaded(null)
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (!episodeId || data.episodes.length === 0) return <div className="fos-loading">当前作品还没有可组装的分集。</div>

  return (
    <div className="fac-page">
      <FosProductionModeTabs projectId={data.projectId} episodeId={episodeId} active="edit" />
      <header className="fac-topbar">
        <div className="fac-episode-picker">
          <span>剧集</span>
          <select className="fos-input" value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}>
            {data.episodes.map((episode) => <option key={episode.id} value={episode.id}>E{episode.episodeNumber} {episode.name}</option>)}
          </select>
        </div>
        <div className="fac-topbar-copy"><strong>时间线组装 / 预览</strong><span>连续监看整集，并以非线性方式调整镜头顺序、入出点与声音；镜头边界采用逐帧硬切。</span></div>
        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={loading} onClick={() => void load()}><AppIcon name="refresh" className={loading ? 'animate-spin' : ''} />刷新素材</button>
      </header>
      {error ? <div className="fac-load-state is-error"><AppIcon name="alert" />{error}<button type="button" onClick={() => void load()}>重试</button></div> : null}
      {loading && !loaded ? <div className="fac-load-state"><AppIcon name="loader" className="animate-spin" />正在读取本集分镜视频与组装工程…</div> : null}
      {loaded ? (
        <AssemblyWorkspace
          key={`${episodeId}:${loaded.revision}`}
          projectId={data.projectId}
          episodeId={episodeId}
          initialProject={loaded.project}
          sources={loaded.sources}
          initialPersisted={loaded.persisted}
          roleCanEdit={roleCanEdit}
          onOpenShotProduction={() => router.push({
            pathname: `/workflow/${data.projectId}/workbench-premium2/production/shot`,
            query: { episode_id: episodeId },
          })}
        />
      ) : null}
    </div>
  )
}

function AssemblyWorkspace({
  projectId,
  episodeId,
  initialProject,
  sources,
  initialPersisted,
  roleCanEdit,
  onOpenShotProduction,
}: {
  projectId: string
  episodeId: string
  initialProject: VideoEditorProject
  sources: RoughCutSourcePanel[]
  initialPersisted: boolean
  roleCanEdit: boolean
  onOpenShotProduction: () => void
}) {
  const {
    project,
    timelineState,
    isDirty,
    addClip,
    removeClip,
    updateClip,
    reorderClips,
    splitClip,
    undo,
    redo,
    canUndo,
    canRedo,
    play,
    pause,
    seek,
    selectClip,
    setZoom,
    loadProject,
    replaceProject,
    markSaved,
  } = useEditorState({ episodeId, initialProject })
  const { saveProject } = useEditorActions({ projectId, episodeId })
  const review = useEpisodeVideoReview({ projectId, episodeId, refreshKey: String(project.timeline.length) })
  const reviewLocked = review.assignment?.status === 'pending_review' || review.assignment?.status === 'completed'
  const canEdit = roleCanEdit && !review.loading && !reviewLocked
  const [saving, setSaving] = useState(false)
  const [hasSavedProject, setHasSavedProject] = useState(initialPersisted)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [selection, setSelection] = useState<AssemblyTrackSelection | null>(null)
  const [reviewOverallNote, setReviewOverallNote] = useState('')
  const [reviewRangeStartMs, setReviewRangeStartMs] = useState(0)
  const [reviewRangeEndMs, setReviewRangeEndMs] = useState(2_000)
  const [reviewAnnotationNote, setReviewAnnotationNote] = useState('')
  const [reviewDrafts, setReviewDrafts] = useState<VideoReviewAnnotationDraft[]>([])
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null)
  const [reviewActionError, setReviewActionError] = useState<string | null>(null)
  const previewRef = useRef<RemotionPreviewHandle>(null)
  const positions = useMemo(() => computeClipPositions(project.timeline), [project.timeline])
  const totalFrames = calculateTimelineDuration(project.timeline)
  const selectedClip = project.timeline.find((clip) => clip.id === timelineState.selectedClipId) || project.timeline[0] || null
  const selectedPosition = positions.find((clip) => clip.id === selectedClip?.id) || null
  const selectedSource = sources.find((source) => source.panelId === selectedClip?.metadata.panelId) || null
  const selectedMentionAssets = useMemo(() => {
    const names = [selectedSource?.location, ...(selectedSource?.characters || []), ...(selectedSource?.props || [])].filter((name): name is string => Boolean(name?.trim()))
    return [...new Set(names)].map((name) => ({ id: name, name }))
  }, [selectedSource])
  const usedPanelIds = useMemo(() => new Set(project.timeline.map((clip) => clip.metadata.panelId)), [project.timeline])
  const unusedSources = useMemo(() => sources.filter((source) => !usedPanelIds.has(source.panelId)), [sources, usedPanelIds])
  const reviewDurationMs = Math.max(0, review.context?.durationMs || Math.round((totalFrames / project.config.fps) * 1_000))
  const reviewSegmentSources = useMemo(
    () => (review.context?.sources || []).filter((source) => source.kind === 'segment' || Boolean(source.panelId)),
    [review.context?.sources],
  )
  const canReviewHere = Boolean(review.assignment?.canReview && review.context?.assignment.canAnnotate)

  useEffect(() => {
    if (timelineState.selectedClipId || !project.timeline[0]) return
    selectClip(project.timeline[0].id)
    setSelection({ clipId: project.timeline[0].id, track: 'video' })
  }, [project.timeline, selectClip, timelineState.selectedClipId])

  useEffect(() => {
    if (!selection) return
    const selectedTimelineClip = project.timeline.find((clip) => clip.id === selection.clipId)
    if (selectedTimelineClip) {
      if (selection.track === 'audio') {
        const firstAudioSegment = audioSegmentsForClip(selectedTimelineClip)[0]
        if (firstAudioSegment && !audioSegmentsForClip(selectedTimelineClip).some((segment) => segment.id === selection.audioSegmentId)) {
          setSelection({ clipId: selectedTimelineClip.id, track: 'audio', audioSegmentId: firstAudioSegment.id })
        }
      }
      return
    }
    const fallback = project.timeline[0]
    setSelection(fallback ? { clipId: fallback.id, track: 'video' } : null)
    selectClip(fallback?.id || null)
  }, [project.timeline, selectClip, selection])

  useEffect(() => {
    const maximumFrame = Math.max(0, totalFrames - 1)
    if (timelineState.currentFrame <= maximumFrame) return
    seek(maximumFrame)
  }, [seek, timelineState.currentFrame, totalFrames])

  useEffect(() => {
    setReviewRangeStartMs(0)
    setReviewRangeEndMs(2_000)
    setReviewOverallNote('')
    setReviewAnnotationNote('')
    setReviewDrafts([])
    setReviewActionError(null)
  }, [episodeId, review.assignment?.status, review.assignment?.submittedAt])

  useEffect(() => {
    setReviewRangeStartMs((current) => clamp(current, 0, reviewDurationMs))
    setReviewRangeEndMs((current) => {
      if (reviewDurationMs <= 0) return 0
      if (current <= 0) return Math.min(reviewDurationMs, 2_000)
      return clamp(current, Math.min(100, reviewDurationMs), reviewDurationMs)
    })
  }, [reviewDurationMs])

  const selectTimelineClip = useCallback((nextSelection: AssemblyTrackSelection, frame: number) => {
    previewRef.current?.pauseAndSeek(frame)
    pause()
    setSelection(nextSelection)
    selectClip(nextSelection.clipId)
    seek(frame)
  }, [pause, seek, selectClip])

  const seekTimeline = useCallback((frame: number, preferredClipId?: string | null) => {
    const nextFrame = clamp(frame, 0, Math.max(0, totalFrames - 1))
    seek(nextFrame)
    const preferred = preferredClipId
      ? positions.find((clip) => clip.id === preferredClipId && nextFrame >= clip.startFrame && nextFrame < clip.endFrame)
      : null
    const selected = positions.find((clip) => clip.id === timelineState.selectedClipId && nextFrame >= clip.startFrame && nextFrame < clip.endFrame)
    const position = preferred || selected || positions.find((clip) => nextFrame >= clip.startFrame && nextFrame < clip.endFrame) || positions.at(-1)
    if (position && position.id !== timelineState.selectedClipId && selection?.track !== 'audio') {
      selectClip(position.id)
      setSelection((current) => current?.clipId === position.id && current.track !== 'audio'
        ? current
        : { clipId: position.id, track: current?.track || 'video' })
    }
  }, [positions, seek, selectClip, selection?.track, timelineState.selectedClipId, totalFrames])

  const seekTimelineFromUser = useCallback((frame: number, preferredClipId?: string | null) => {
    previewRef.current?.pauseAndSeek(frame)
    pause()
    seekTimeline(frame, preferredClipId)
  }, [pause, seekTimeline])

  const reorderTimelineClips = useCallback((fromIndex: number, toIndex: number) => {
    pause()
    reorderClips(fromIndex, toIndex)
  }, [pause, reorderClips])

  const syncPreviewPlayingState = useCallback((playingNow: boolean) => {
    if (playingNow) play()
    else pause()
  }, [pause, play])

  const save = useCallback(async () => {
    if (!canEdit || saving) return
    setSaving(true); setSaveError(null); setNotice(null)
    try {
      const payload = await saveProject(project) as { projectData?: VideoEditorProject }
      if (payload.projectData) loadProject(payload.projectData)
      else markSaved()
      setHasSavedProject(true)
      await review.reload()
      setNotice('组装工程已保存。整集评审与后续导出将使用当前时间线。')
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : '保存组装工程失败')
    } finally { setSaving(false) }
  }, [canEdit, loadProject, markSaved, project, review, saveProject, saving])

  const reset = () => {
    if (!canEdit) return
    pause()
    const next = createRoughCutProject(episodeId, sources, project.config.fps, { width: project.config.width, height: project.config.height })
    replaceProject(next)
    selectClip(next.timeline[0]?.id || null)
    setSelection(next.timeline[0] ? { clipId: next.timeline[0].id, track: 'video' } : null)
    seek(0)
    setNotice('已按分镜顺序重新组装；保存后生效。')
  }

  const addSource = (source: RoughCutSourcePanel) => {
    if (!canEdit || usedPanelIds.has(source.panelId)) return
    pause()
    const clip = createRoughCutClip(source, project.config.fps)
    const clipId = addClip({ src: clip.src, durationInFrames: clip.durationInFrames, trim: clip.trim, metadata: clip.metadata })
    selectClip(clipId)
    setSelection({ clipId, track: 'video' })
    seek(totalFrames)
    setNotice(null)
  }

  const deleteSelected = useCallback(() => {
    if (!canEdit || !selectedClip || !selection) return
    pause()
    if (selection.track === 'audio') {
      const remaining = audioSegmentsForClip(selectedClip).filter((segment) => segment.id !== selection.audioSegmentId)
      updateClip(selectedClip.id, { sourceAudio: { detached: true, volume: 1, segments: remaining } })
      setSelection(null)
      setNotice('已删除所选音频段；可按 ⌘Z / Ctrl+Z 撤回。')
      return
    }
    const index = project.timeline.findIndex((clip) => clip.id === selectedClip.id)
    const next = project.timeline[index + 1] || project.timeline[index - 1] || null
    // When removing a clip before the next shot, the next shot shifts left to
    // the removed clip's old start. Seeking to its old position makes the
    // playhead jump into a later shot and looks like timeline jitter.
    const nextFrame = project.timeline[index + 1]
      ? selectedPosition?.startFrame || 0
      : positions.find((position) => position.id === next?.id)?.startFrame || 0
    removeClip(selectedClip.id)
    selectClip(next?.id || null)
    setSelection(next ? { clipId: next.id, track: 'video' } : null)
    seek(nextFrame)
    setNotice('已删除所选分镜视频段；可按 ⌘Z / Ctrl+Z 撤回。')
  }, [canEdit, pause, positions, project.timeline, removeClip, seek, selectClip, selectedClip, selectedPosition?.startFrame, selection, updateClip])

  const moveAudioSegment = useCallback((clipId: string, segmentId: string, timelineStartFrame: number) => {
    if (!canEdit) return
    const clip = project.timeline.find((item) => item.id === clipId)
    if (!clip) return
    const segments = audioSegmentsForClip(clip)
    if (!segments.some((segment) => segment.id === segmentId)) return
    updateClip(clipId, {
      sourceAudio: {
        detached: true,
        volume: clip.sourceAudio?.volume ?? 1,
        segments: segments.map((segment) => segment.id === segmentId
          ? { ...segment, timelineStartFrame: Math.max(0, Math.round(timelineStartFrame)) }
          : segment),
      },
    })
    setNotice('已移动音频片段；保存组装后生效。')
    setSaveError(null)
  }, [canEdit, project.timeline, updateClip])

  const splitSelected = () => {
    if (!canEdit || !selectedClip || !selectedPosition || !selection) return
    pause()
    const offset = Math.round(timelineState.currentFrame - selectedPosition.startFrame)
    if (selection.track === 'audio') {
      const segments = audioSegmentsForClip(selectedClip)
      const selectedAudio = segments.find((segment) => segment.id === selection.audioSegmentId)
      const audioStartFrame = selectedAudio
        ? sourceAudioTimelineStart(selectedPosition.startFrame, selectedAudio)
        : 0
      const sourceOffset = selectedAudio
        ? selectedAudio.from + Math.round(timelineState.currentFrame - audioStartFrame)
        : offset
      if (!selectedAudio || sourceOffset <= selectedAudio.from || sourceOffset >= selectedAudio.to) {
        setSaveError('请把播放头移动到所选音频段内部，再执行切割。')
        return
      }
      const rightId = createAudioSegmentId(selectedClip.id)
      const nextSegments = segments.flatMap((segment) => segment.id === selectedAudio.id
        ? [
          { ...segment, to: sourceOffset, timelineStartFrame: audioStartFrame },
          { ...segment, id: rightId, from: sourceOffset, timelineStartFrame: timelineState.currentFrame },
        ]
        : [segment])
      updateClip(selectedClip.id, { sourceAudio: { detached: true, volume: selectedClip.sourceAudio?.volume ?? 1, segments: nextSegments } })
      setSelection({ clipId: selectedClip.id, track: 'audio', audioSegmentId: rightId })
      setNotice('已在播放头处切割音频段。')
      setSaveError(null)
      return
    }
    if (offset <= 0 || offset >= selectedClip.durationInFrames) {
      setSaveError('请先把播放头移动到当前片段内部，再执行分割。')
      return
    }
    const nextId = splitClip(selectedClip.id, offset)
    selectClip(nextId)
    setSelection({ clipId: nextId, track: 'video' })
    setNotice('已在播放头处分割分镜视频段。')
  }

  const stepClip = (offset: number) => {
    const currentIndex = positions.findIndex((clip) => clip.id === selectedClip?.id)
    const next = positions[clamp((currentIndex < 0 ? 0 : currentIndex) + offset, 0, Math.max(0, positions.length - 1))]
    if (next) selectTimelineClip({ clipId: next.id, track: 'video' }, next.startFrame)
  }

  const restoreHistorySelection = useCallback((restoredProject: VideoEditorProject) => {
    const restoredPositions = computeClipPositions(restoredProject.timeline)
    const maximumFrame = Math.max(0, calculateTimelineDuration(restoredProject.timeline) - 1)
    const frame = clamp(timelineState.currentFrame, 0, maximumFrame)
    const clip = restoredPositions.find((item) => frame >= item.startFrame && frame < item.endFrame) || restoredPositions.at(-1) || null
    pause()
    seek(frame)
    selectClip(clip?.id || null)
    setSelection(clip ? { clipId: clip.id, track: 'video' } : null)
  }, [pause, seek, selectClip, timelineState.currentFrame])

  const undoEdit = useCallback(() => {
    const restored = undo()
    if (!restored) return
    restoreHistorySelection(restored)
    setNotice('已撤回上一步编辑。')
    setSaveError(null)
  }, [restoreHistorySelection, undo])

  const redoEdit = useCallback(() => {
    const restored = redo()
    if (!restored) return
    restoreHistorySelection(restored)
    setNotice('已重做上一步编辑。')
    setSaveError(null)
  }, [redo, restoreHistorySelection])

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.matches('input, textarea, select, [contenteditable="true"]')) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redoEdit()
      else undoEdit()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); void save(); return
    }
    if (event.code === 'Space') {
      event.preventDefault()
      if (positions.length) {
        if (timelineState.playing) pause()
        else play()
      }
      return
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      splitSelected()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); deleteSelected()
    }
  }

  const lockReason = reviewLocked
    ? review.assignment?.status === 'completed' ? '本集已通过，组装工程已锁定' : '本集审核中，组装工程已锁定'
    : !roleCanEdit ? '当前账号只有查看权限' : null
  const reviewStatus = review.assignment?.status || null
  const needsSave = !hasSavedProject || isDirty
  const canSubmitReview = Boolean(
    review.assignment?.canSubmit
    && review.context?.readyForReview === true
    && !review.submitting
    && !needsSave,
  )
  const submitReview = async () => {
    const submitted = await review.submitEpisode()
    if (submitted) setNotice('已提交全集进行评审，管理账号可直接在本页提出意见或确认整集视频。')
  }

  const updateReviewBoundary = (boundary: 'start' | 'end', rawValue: number) => {
    const maximum = Math.max(0, reviewDurationMs)
    const minimumGap = Math.min(100, maximum)
    if (boundary === 'start') {
      setReviewRangeStartMs(clamp(Math.round(rawValue), 0, Math.max(0, reviewRangeEndMs - minimumGap)))
      return
    }
    setReviewRangeEndMs(clamp(Math.round(rawValue), Math.min(maximum, reviewRangeStartMs + minimumGap), maximum))
  }

  const usePlayheadForReviewBoundary = (boundary: 'start' | 'end') => {
    const maximum = Math.max(0, reviewDurationMs)
    const playheadMs = clamp(Math.round((timelineState.currentFrame / project.config.fps) * 1_000), 0, maximum)
    if (boundary === 'start') {
      const nextEnd = reviewRangeEndMs <= playheadMs
        ? Math.min(maximum, playheadMs + 2_000)
        : reviewRangeEndMs
      setReviewRangeStartMs(Math.min(playheadMs, Math.max(0, nextEnd - Math.min(100, maximum))))
      setReviewRangeEndMs(nextEnd)
      return
    }
    const nextStart = reviewRangeStartMs >= playheadMs
      ? Math.max(0, playheadMs - 2_000)
      : reviewRangeStartMs
    setReviewRangeStartMs(nextStart)
    setReviewRangeEndMs(Math.max(playheadMs, Math.min(maximum, nextStart + Math.min(100, maximum))))
  }

  const addReviewAnnotation = () => {
    const note = reviewAnnotationNote.trim()
    if (!canReviewHere || !note || reviewRangeEndMs <= reviewRangeStartMs) return
    const containingSegment = reviewSegmentSources.find((source) => (
      reviewRangeStartMs >= source.startMs && reviewRangeEndMs <= source.endMs
    ))
    setReviewDrafts((current) => [...current, {
      id: `assembly-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      panelId: containingSegment?.panelId || null,
      startMs: reviewRangeStartMs,
      endMs: reviewRangeEndMs,
      note,
    }].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs))
    setReviewAnnotationNote('')
    setReviewActionError(null)
  }

  const focusReviewAnnotation = (annotation: Pick<VideoReviewAnnotationDraft, 'panelId' | 'startMs' | 'endMs'>) => {
    setReviewRangeStartMs(clamp(annotation.startMs, 0, reviewDurationMs))
    setReviewRangeEndMs(clamp(annotation.endMs, 0, reviewDurationMs))
    pause()
    seek(clamp(Math.round((annotation.startMs / 1_000) * project.config.fps), 0, totalFrames))
    const matchedClip = annotation.panelId
      ? project.timeline.find((clip) => clip.metadata.panelId === annotation.panelId)
      : null
    if (matchedClip) {
      selectClip(matchedClip.id)
      setSelection({ clipId: matchedClip.id, track: 'video' })
    }
  }

  const runReviewAction = async (action: 'approve' | 'reject') => {
    if (!canReviewHere || reviewAction || !review.assignment) return
    if (action === 'reject' && !reviewOverallNote.trim() && reviewDrafts.length === 0) {
      setReviewActionError('请填写整集修改意见，或至少添加一条时段意见。')
      return
    }
    setReviewAction(action)
    setReviewActionError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: review.assignment.id,
          ...(reviewOverallNote.trim() ? { note: reviewOverallNote.trim() } : {}),
          ...(action === 'reject' ? {
            videoAnnotations: reviewDrafts.map(({ panelId, startMs, endMs, note }) => ({
              panelId: panelId || null,
              startMs,
              endMs,
              note,
            })),
          } : {}),
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, action === 'approve' ? '确认整集视频失败' : '发布修改意见失败'))
      }
      setReviewOverallNote('')
      setReviewAnnotationNote('')
      setReviewDrafts([])
      setNotice(action === 'approve' ? '整集视频已由管理账号确认。' : '修改意见已发布，分镜师可在本页查看并继续修改。')
      await review.reload()
    } catch (actionFailure) {
      setReviewActionError(actionFailure instanceof Error ? actionFailure.message : '评审操作失败')
    } finally {
      setReviewAction(null)
    }
  }

  return (
    <div className="fac-workspace" tabIndex={0} onKeyDown={handleKeyboard}>
      <section className="fac-preview-panel">
        <div className="fac-preview-head"><div><strong>整集连续预览</strong><span>{project.timeline.length} 个片段 · {framesToTime(totalFrames, project.config.fps)}</span></div><em className={needsSave ? 'is-dirty' : 'is-saved'}>{needsSave ? '需要保存剪辑' : '剪辑已保存'}</em></div>
        <div className="fac-preview-stage">
          <RemotionPreview ref={previewRef} project={project} currentFrame={timelineState.currentFrame} playing={timelineState.playing} onFrameChange={seekTimeline} onPlayingChange={syncPreviewPlayingState} />
        </div>
        <div className="fac-transport">
          <button type="button" title="上一片段" disabled={!positions.length} onClick={() => stepClip(-1)}><AppIcon name="chevronLeft" /></button>
          <button type="button" className="is-primary" title={timelineState.playing ? '暂停' : '播放'} disabled={!positions.length} onClick={() => timelineState.playing ? pause() : play()}><AppIcon name={timelineState.playing ? 'pause' : 'play'} /></button>
          <button type="button" title="下一片段" disabled={!positions.length} onClick={() => stepClip(1)}><AppIcon name="chevronRight" /></button>
          <time>{framesToTime(timelineState.currentFrame, project.config.fps)} / {framesToTime(totalFrames, project.config.fps)}</time>
        </div>
        <div className="fac-shortcuts"><span>Space 播放 / 暂停</span><span>C 切割</span><span>⌘Z / Ctrl+Z 撤回</span><span>Backspace 删除</span></div>
      </section>

      <section className="fac-edit-panel">
        {lockReason ? <div className="fac-notice is-lock"><AppIcon name="lock" />{lockReason}</div> : null}
        {notice ? <div className="fac-notice is-success">{notice}</div> : null}
        {saveError || review.error ? <div className="fac-notice is-error">{saveError || review.error}</div> : null}

        <div className="fac-current-shot">
          <article className="fac-shot-card">
            <header className="fac-shot-heading">
              <div><span>当前分镜</span><h2>{selectedClip ? `${selectedClip.metadata.sceneLabel} · ${selectedClip.metadata.segmentLabel}` : '未选择分镜'}</h2><p>{selectedSource?.shotType || '分镜视频'} · {framesToTime(selectedClip?.durationInFrames || 0, project.config.fps)} · 当前选中{selection?.track === 'audio' ? '音频段' : '视频段'}</p></div>
              <div className="fac-shot-heading-actions"><button type="button" className="fac-open-production" onClick={onOpenShotProduction}><AppIcon name="film" />进入分镜制作</button><div className="fac-shot-status"><i />{selection ? '已选中，可在播放头切割' : '点击下方轨道选择片段'}</div></div>
            </header>
            {selectedSource ? (
              <div className="fac-shot-copy">
                <dl><div><dt>场景</dt><dd>{selectedSource.location || selectedSource.sceneLabel}</dd></div><div><dt>角色</dt><dd>{selectedSource.characters?.join('、') || '—'}</dd></div><div><dt>物品</dt><dd>{selectedSource.props?.join('、') || '—'}</dd></div></dl>
                <h4>视频提示词</h4>
                <MentionPromptEditor className="fac-shot-prompt" value={selectedSource.videoPrompt || selectedSource.description || ''} assets={selectedMentionAssets} onChange={() => undefined} minHeight={220} placeholder="当前分镜暂无提示词" hint={null} readOnly />
              </div>
            ) : <div className="fac-empty-inspector">从下方时间线选择一个片段。</div>}
          </article>
        </div>

        {unusedSources.length ? <div className="fac-restore"><span>未使用分镜</span>{unusedSources.map((source) => <button key={source.panelId} type="button" disabled={!canEdit} onClick={() => addSource(source)}><AppIcon name="plus" />{source.sceneLabel} · {source.segmentLabel}</button>)}</div> : null}
        <FosAssemblyTimeline project={project} currentFrame={timelineState.currentFrame} selection={selection} zoom={timelineState.zoom} readOnly={!canEdit} isDirty={needsSave} saving={saving} canUndo={canUndo} canRedo={canRedo} onReorder={reorderTimelineClips} onSelect={selectTimelineClip} onSeek={seekTimelineFromUser} onZoom={setZoom} onMoveAudio={moveAudioSegment} onCut={splitSelected} onDelete={deleteSelected} onUndo={undoEdit} onRedo={redoEdit} onReset={reset} onSave={() => void save()} />
      </section>

      <AssemblyReviewPanel
        status={reviewStatus}
        loading={review.loading}
        error={reviewActionError}
        assignmentError={review.error}
        canReview={canReviewHere}
        canSubmit={Boolean(review.assignment?.canSubmit)}
        submitterLabel={review.assignment?.assigneeName || null}
        canSubmitReview={canSubmitReview}
        canSave={canEdit}
        saving={saving}
        submitting={review.submitting}
        busyAction={reviewAction}
        readyForReview={review.context?.readyForReview === true}
        isDirty={needsSave}
        durationMs={reviewDurationMs}
        currentMs={Math.round((timelineState.currentFrame / project.config.fps) * 1_000)}
        overallNote={reviewOverallNote}
        annotationNote={reviewAnnotationNote}
        rangeStartMs={reviewRangeStartMs}
        rangeEndMs={reviewRangeEndMs}
        drafts={reviewDrafts}
        annotations={review.context?.annotations || []}
        sources={review.context?.sources || []}
        lastReviewNote={review.assignment?.lastReviewNote || review.context?.assignment.lastReviewNote || ''}
        onOverallNoteChange={setReviewOverallNote}
        onAnnotationNoteChange={setReviewAnnotationNote}
        onRangeChange={updateReviewBoundary}
        onUsePlayhead={usePlayheadForReviewBoundary}
        onAddAnnotation={addReviewAnnotation}
        onRemoveDraft={(id) => setReviewDrafts((current) => current.filter((item) => item.id !== id))}
        onFocusAnnotation={focusReviewAnnotation}
        onSave={() => void save()}
        onSubmit={() => void submitReview()}
        onReview={(action) => void runReviewAction(action)}
      />
    </div>
  )
}

function reviewStatusCopy(status: string | null, canReview: boolean) {
  if (status === 'completed') return { label: '已确认', title: '整集视频已确认', detail: '当前版本已完成管理确认，时间线已锁定。' }
  if (status === 'rejected') return { label: '需修改', title: '本集已退回修改', detail: '按下方意见调整剪辑，保存后可重新提交。' }
  if (status === 'pending_review') return canReview
    ? { label: '待确认', title: '请审核当前整集', detail: '可添加整集或时间段意见，也可直接确认视频。' }
    : { label: '审核中', title: '等待管理账号确认', detail: '提交版本已锁定；管理账号会在这里给出结论。' }
  return { label: '剪辑中', title: '完成剪辑后提交', detail: '提交后，管理账号会在同一页面提出意见或确认视频。' }
}

function sourceForReviewAnnotation(sources: VideoReviewSource[], annotation: Pick<VideoReviewAnnotationDraft, 'panelId' | 'startMs'>) {
  if (annotation.panelId) return sources.find((source) => source.panelId === annotation.panelId) || null
  return sources.find((source) => (
    (source.kind === 'segment' || Boolean(source.panelId))
    && annotation.startMs >= source.startMs
    && annotation.startMs <= source.endMs
  )) || sources.find((source) => source.kind === 'episode') || null
}

function AssemblyReviewRange({
  startMs,
  endMs,
  durationMs,
  onChange,
}: {
  startMs: number
  endMs: number
  durationMs: number
  onChange: (boundary: 'start' | 'end', value: number) => void
}) {
  const maximum = Math.max(100, durationMs)
  const rangeStyle = {
    '--fac-review-start': `${clamp((startMs / maximum) * 100, 0, 100)}%`,
    '--fac-review-end': `${clamp((endMs / maximum) * 100, 0, 100)}%`,
  } as CSSProperties
  return (
    <div className="fac-review-range" style={rangeStyle}>
      <div className="fac-review-timecodes"><span>开始 <time>{formatVideoReviewTimecode(startMs)}</time></span><span>结束 <time>{formatVideoReviewTimecode(endMs)}</time></span></div>
      <div className="fac-review-range-track"><i /><b /></div>
      <input type="range" aria-label="整集评审开始时间" min={0} max={maximum} step={100} value={startMs} onChange={(event) => onChange('start', Number(event.target.value))} />
      <input type="range" aria-label="整集评审结束时间" min={0} max={maximum} step={100} value={endMs} onChange={(event) => onChange('end', Number(event.target.value))} />
    </div>
  )
}

function AssemblyReviewComment({
  annotation,
  index,
  sources,
  draft = false,
  onFocus,
  onRemove,
}: {
  annotation: VideoReviewAnnotationDraft | VideoReviewAnnotationRecord
  index: number
  sources: VideoReviewSource[]
  draft?: boolean
  onFocus: () => void
  onRemove?: () => void
}) {
  const source = sourceForReviewAnnotation(sources, annotation)
  return (
    <article className={`fac-review-comment${draft ? ' is-draft' : ''}`}>
      <button type="button" className="fac-review-comment-main" onClick={onFocus}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <div><strong>{source?.label || '整集时间轴'}</strong><time>{formatVideoReviewTimecode(annotation.startMs)} – {formatVideoReviewTimecode(annotation.endMs)}</time><p>{annotation.note}</p></div>
      </button>
      {onRemove ? <button type="button" className="fac-review-comment-remove" aria-label={`删除第 ${index + 1} 条时段意见`} onClick={onRemove}><AppIcon name="trash" /></button> : null}
    </article>
  )
}

function AssemblyReviewPanel({
  status,
  loading,
  error,
  assignmentError,
  canReview,
  canSubmit,
  submitterLabel,
  canSubmitReview,
  canSave,
  saving,
  submitting,
  busyAction,
  readyForReview,
  isDirty,
  durationMs,
  currentMs,
  overallNote,
  annotationNote,
  rangeStartMs,
  rangeEndMs,
  drafts,
  annotations,
  sources,
  lastReviewNote,
  onOverallNoteChange,
  onAnnotationNoteChange,
  onRangeChange,
  onUsePlayhead,
  onAddAnnotation,
  onRemoveDraft,
  onFocusAnnotation,
  onSave,
  onSubmit,
  onReview,
}: {
  status: string | null
  loading: boolean
  error: string | null
  assignmentError: string | null
  canReview: boolean
  canSubmit: boolean
  submitterLabel: string | null
  canSubmitReview: boolean
  canSave: boolean
  saving: boolean
  submitting: boolean
  busyAction: 'approve' | 'reject' | null
  readyForReview: boolean
  isDirty: boolean
  durationMs: number
  currentMs: number
  overallNote: string
  annotationNote: string
  rangeStartMs: number
  rangeEndMs: number
  drafts: VideoReviewAnnotationDraft[]
  annotations: VideoReviewAnnotationRecord[]
  sources: VideoReviewSource[]
  lastReviewNote: string
  onOverallNoteChange: (value: string) => void
  onAnnotationNoteChange: (value: string) => void
  onRangeChange: (boundary: 'start' | 'end', value: number) => void
  onUsePlayhead: (boundary: 'start' | 'end') => void
  onAddAnnotation: () => void
  onRemoveDraft: (id: string) => void
  onFocusAnnotation: (annotation: Pick<VideoReviewAnnotationDraft, 'panelId' | 'startMs' | 'endMs'>) => void
  onSave: () => void
  onSubmit: () => void
  onReview: (action: 'approve' | 'reject') => void
}) {
  const statusCopy = reviewStatusCopy(status, canReview)
  const openAnnotations = annotations.filter((annotation) => annotation.status === 'open')
  const historicalAnnotations = annotations.filter((annotation) => annotation.status !== 'open')
  const invalidRange = durationMs <= 0 || rangeEndMs <= rangeStartMs || rangeEndMs > durationMs
  const canAddAnnotation = canReview && annotationNote.trim().length > 0 && !invalidRange
  const submitTitle = isDirty
    ? '请先保存剪辑'
    : !readyForReview ? '请先保存至少一个可用的视频片段' : ''

  return (
    <aside className={`fac-review-panel is-${status || 'idle'}`} data-testid="assembly-review-panel">
      <header className="fac-review-panel-head">
        <div><span>REVIEW</span><h2>评审与确认</h2></div>
        <em>{loading ? '同步中' : statusCopy.label}</em>
      </header>
      <section className="fac-review-state-card">
        <span className="fac-review-state-icon"><AppIcon name={status === 'completed' ? 'check' : status === 'rejected' ? 'alert' : 'clipboardCheck'} /></span>
        <div><strong>{loading ? '正在读取评审状态…' : statusCopy.title}</strong><p>{statusCopy.detail}</p></div>
      </section>

      {status === 'in_progress' || status === 'rejected' ? (
        <section className="fac-review-submit-card">
          <div>
            <strong>{!canSubmit ? '等待执行人或管理账号提交' : isDirty ? '第一步 · 保存当前剪辑' : status === 'rejected' ? '修改完成后重新提交' : '第二步 · 提交当前整集'}</strong>
            <p>{!canSubmit ? `当前执行人：${submitterLabel || '未分配'}。普通非执行子账号只能查看提交状态。` : isDirty ? '先保存时间线上的切割、排序和音频调整，保存后即可提交评审。' : readyForReview ? '剪辑已保存，可以提交并等待管理账号确认。' : '请先保存包含至少一个可用视频片段的剪辑。'}</p>
          </div>
          {!canSubmit ? (
            <button type="button" disabled><AppIcon name="lock" />无提交权限</button>
          ) : isDirty ? (
            <button type="button" className="is-save" disabled={!canSave || saving} onClick={onSave}><AppIcon name={saving ? 'loader' : 'check'} className={saving ? 'animate-spin' : ''} />{saving ? '保存中…' : '保存剪辑'}</button>
          ) : (
            <button type="button" title={submitTitle} disabled={!canSubmitReview} onClick={onSubmit}><AppIcon name={submitting ? 'loader' : 'clipboardCheck'} className={submitting ? 'animate-spin' : ''} />{status === 'rejected' ? '重新提交全集评审' : '提交全集进行评审'}</button>
          )}
        </section>
      ) : null}

      {canReview ? (
        <div className="fac-review-editor">
          <label className="fac-review-field">
            <span><strong>整集修改意见</strong><small>{overallNote.length} / 1000</small></span>
            <textarea rows={4} maxLength={1_000} value={overallNote} onChange={(event) => onOverallNoteChange(event.target.value)} placeholder="填写节奏、叙事、风格或整体剪辑问题…" />
          </label>
          <section className="fac-review-range-card">
            <div className="fac-review-section-title"><span>时间段批注</span><time>播放点 {formatVideoReviewTimecode(currentMs)}</time></div>
            <AssemblyReviewRange startMs={rangeStartMs} endMs={rangeEndMs} durationMs={durationMs} onChange={onRangeChange} />
            <div className="fac-review-range-actions"><button type="button" onClick={() => onUsePlayhead('start')}>播放点设为开始</button><button type="button" onClick={() => onUsePlayhead('end')}>播放点设为结束</button></div>
            <label className="fac-review-field is-annotation"><span><strong>该时段意见</strong></span><textarea rows={3} maxLength={1_000} value={annotationNote} onChange={(event) => onAnnotationNoteChange(event.target.value)} placeholder="说明这一时间段需要怎样修改…" /></label>
            <button type="button" className="fac-review-add" disabled={!canAddAnnotation} onClick={onAddAnnotation}><AppIcon name="plus" />添加时段意见</button>
          </section>
          {drafts.length ? <section className="fac-review-comments"><div className="fac-review-section-title"><span>本次待发布</span><small>{drafts.length} 条</small></div>{drafts.map((annotation, index) => <AssemblyReviewComment key={annotation.id} annotation={annotation} index={index} sources={sources} draft onFocus={() => onFocusAnnotation(annotation)} onRemove={() => onRemoveDraft(annotation.id)} />)}</section> : null}
        </div>
      ) : null}

      {(lastReviewNote || openAnnotations.length > 0) ? (
        <section className="fac-review-feedback-list">
          <div className="fac-review-section-title"><span>{status === 'rejected' ? '管理账号修改意见' : '当前评审意见'}</span><small>{openAnnotations.length} 条时段意见</small></div>
          {lastReviewNote ? <div className="fac-review-overall-note"><strong>整集意见</strong><p>{lastReviewNote}</p></div> : null}
          {openAnnotations.map((annotation, index) => <AssemblyReviewComment key={annotation.id} annotation={annotation} index={index} sources={sources} onFocus={() => onFocusAnnotation(annotation)} />)}
        </section>
      ) : null}

      {historicalAnnotations.length > 0 && canReview ? <details className="fac-review-history"><summary>查看历史意见（{historicalAnnotations.length}）</summary>{historicalAnnotations.map((annotation, index) => <AssemblyReviewComment key={annotation.id} annotation={annotation} index={index} sources={sources} onFocus={() => onFocusAnnotation(annotation)} />)}</details> : null}
      {error || assignmentError ? <div className="fac-review-error"><AppIcon name="alert" />{error || assignmentError}</div> : null}

      {canReview ? (
        <footer className="fac-review-actions">
          <button type="button" className="is-reject" disabled={Boolean(busyAction)} onClick={() => onReview('reject')}>{busyAction === 'reject' ? <AppIcon name="loader" className="animate-spin" /> : <AppIcon name="alert" />}发布修改意见</button>
          <button type="button" className="is-approve" title={drafts.length ? '存在未发布的时段意见，请先发布或删除' : ''} disabled={Boolean(busyAction) || drafts.length > 0} onClick={() => onReview('approve')}>{busyAction === 'approve' ? <AppIcon name="loader" className="animate-spin" /> : <AppIcon name="check" />}确认整集视频</button>
        </footer>
      ) : null}
    </aside>
  )
}
