'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import {
  createRoughCutClip,
  createRoughCutProject,
  normalizeRoughCutProject,
  type RoughCutSourcePanel,
} from '@/lib/novel-promotion/rough-cut'
import { useEditorActions } from '@/features/video-editor/hooks/useEditorActions'
import { useEditorState } from '@/features/video-editor/hooks/useEditorState'
import { RoughCutTimeline, RoughCutTrimEditor } from '@/features/video-editor/components/RoughCutControls'
import type { VideoEditorProject } from '@/features/video-editor/types/editor.types'
import { calculateTimelineDuration, computeClipPositions, framesToTime } from '@/features/video-editor/utils/time-utils'

interface EditorPayload {
  projectData?: VideoEditorProject | null
  sourcePanels?: RoughCutSourcePanel[]
}

interface LoadedEditor {
  revision: number
  project: VideoEditorProject
  sources: RoughCutSourcePanel[]
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function FosRoughCutStrip({
  projectId,
  episodeId,
  activePanelId,
  canEdit,
  lockReason,
  onSelectPanel,
}: {
  projectId: string
  episodeId: string
  activePanelId?: string
  canEdit: boolean
  lockReason?: string | null
  onSelectPanel: (panelId: string) => void
}) {
  const [loaded, setLoaded] = useState<LoadedEditor | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!episodeId) {
      setLoaded(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/editor?episodeId=${encodeURIComponent(episodeId)}`, { signal })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载粗剪工程失败'))
      const payload = await response.json() as EditorPayload
      const sources = Array.isArray(payload.sourcePanels) ? payload.sourcePanels : []
      const saved = normalizeRoughCutProject(payload.projectData, episodeId, sources)
      setLoaded({
        revision: Date.now(),
        project: saved || createRoughCutProject(episodeId, sources),
        sources,
      })
    } catch (loadError) {
      if (signal?.aborted) return
      setLoaded(null)
      setError(loadError instanceof Error ? loadError.message : '加载粗剪工程失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [episodeId, projectId])

  useEffect(() => {
    setLoaded(null)
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <section className="frc-strip" data-testid="rough-cut-strip">
      {loading && !loaded ? <div className="frc-inline-state"><AppIcon name="loader" className="animate-spin" />正在读取本集视频与粗剪工程…</div> : null}
      {error ? <div className="frc-inline-state is-error"><AppIcon name="alert" />{error}<button type="button" onClick={() => void load()}>重试</button></div> : null}
      {loaded ? (
        <RoughCutWorkspace
          key={`${episodeId}:${loaded.revision}`}
          projectId={projectId}
          episodeId={episodeId}
          initialProject={loaded.project}
          sources={loaded.sources}
          activePanelId={activePanelId}
          canEdit={canEdit}
          lockReason={lockReason || null}
          onSelectPanel={onSelectPanel}
          onRefresh={() => void load()}
          refreshing={loading}
        />
      ) : null}
    </section>
  )
}

function RoughCutWorkspace({
  projectId,
  episodeId,
  initialProject,
  sources,
  activePanelId,
  canEdit,
  lockReason,
  onSelectPanel,
  onRefresh,
  refreshing,
}: {
  projectId: string
  episodeId: string
  initialProject: VideoEditorProject
  sources: RoughCutSourcePanel[]
  activePanelId?: string
  canEdit: boolean
  lockReason: string | null
  onSelectPanel: (panelId: string) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const {
    project,
    timelineState,
    isDirty,
    addClip,
    removeClip,
    updateClip,
    reorderClips,
    seek,
    selectClip,
    setZoom,
    loadProject,
    replaceProject,
    markSaved,
  } = useEditorState({ episodeId, initialProject })
  const { saveProject } = useEditorActions({ projectId, episodeId })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const positions = useMemo(() => computeClipPositions(project.timeline), [project.timeline])
  const totalFrames = calculateTimelineDuration(project.timeline)
  const selectedClip = project.timeline.find((clip) => clip.id === timelineState.selectedClipId) || null
  const selectedPosition = positions.find((clip) => clip.id === selectedClip?.id) || null
  const usedPanelIds = useMemo(() => new Set(project.timeline.map((clip) => clip.metadata.panelId)), [project.timeline])
  const unusedSources = useMemo(() => sources.filter((source) => !usedPanelIds.has(source.panelId)), [sources, usedPanelIds])

  const selectTimelineClip = useCallback((clipId: string, frame: number) => {
    const clip = project.timeline.find((item) => item.id === clipId)
    selectClip(clipId)
    seek(frame)
    if (clip?.metadata.panelId) onSelectPanel(clip.metadata.panelId)
  }, [onSelectPanel, project.timeline, seek, selectClip])

  useEffect(() => {
    const preferred = project.timeline.find((clip) => clip.metadata.panelId === activePanelId) || project.timeline[0]
    if (!preferred || preferred.id === timelineState.selectedClipId) return
    const position = positions.find((clip) => clip.id === preferred.id)
    selectClip(preferred.id)
    if (position) seek(position.startFrame)
  }, [activePanelId, positions, project.timeline, seek, selectClip, timelineState.selectedClipId])

  useEffect(() => {
    if (timelineState.currentFrame > totalFrames) seek(totalFrames)
  }, [seek, timelineState.currentFrame, totalFrames])

  const save = async () => {
    if (!canEdit || saving) return
    setSaving(true)
    setSaveError(null)
    setNotice(null)
    try {
      const payload = await saveProject(project) as { projectData?: VideoEditorProject }
      if (payload.projectData) loadProject(payload.projectData)
      else markSaved()
      setNotice('已保存，提交全集评审时将使用当前顺序和裁剪区间。')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存粗剪工程失败')
    } finally {
      setSaving(false)
    }
  }

  const addSource = (source: RoughCutSourcePanel) => {
    if (!canEdit || usedPanelIds.has(source.panelId)) return
    const clip = createRoughCutClip(source, project.config.fps)
    const clipId = addClip({
      src: clip.src,
      durationInFrames: clip.durationInFrames,
      trim: clip.trim,
      metadata: clip.metadata,
    })
    selectClip(clipId)
    seek(totalFrames)
    onSelectPanel(source.panelId)
    setNotice(null)
  }

  const reset = () => {
    if (!canEdit) return
    const next = createRoughCutProject(episodeId, sources, project.config.fps)
    replaceProject(next)
    const first = next.timeline[0]
    selectClip(first?.id || null)
    seek(0)
    if (first?.metadata.panelId) onSelectPanel(first.metadata.panelId)
    setNotice('已恢复为分镜顺序，保存后生效。')
  }

  const updateTrim = (boundary: 'from' | 'to', value: number) => {
    if (!canEdit || !selectedClip) return
    const sourceFrames = Math.max(1, selectedClip.metadata.sourceDurationInFrames || selectedClip.durationInFrames)
    const currentFrom = selectedClip.trim?.from ?? 0
    const currentTo = selectedClip.trim?.to ?? sourceFrames
    const from = boundary === 'from' ? clamp(Math.round(value), 0, currentTo - 1) : currentFrom
    const to = boundary === 'to' ? clamp(Math.round(value), currentFrom + 1, sourceFrames) : currentTo
    updateClip(selectedClip.id, { trim: { from, to }, durationInFrames: to - from })
    setNotice(null)
  }

  const seekTimeline = (frame: number) => {
    const nextFrame = clamp(frame, 0, totalFrames)
    seek(nextFrame)
    const position = positions.find((clip) => nextFrame >= clip.startFrame && nextFrame < clip.endFrame) || positions.at(-1)
    if (position && position.id !== timelineState.selectedClipId) {
      selectClip(position.id)
      onSelectPanel(position.metadata.panelId)
    }
  }

  const stepClip = (offset: number) => {
    const currentIndex = positions.findIndex((clip) => clip.id === selectedClip?.id)
    const next = positions[clamp((currentIndex < 0 ? 0 : currentIndex) + offset, 0, Math.max(0, positions.length - 1))]
    if (next) selectTimelineClip(next.id, next.startFrame)
  }

  const currentSourceFrame = selectedClip && selectedPosition
    ? (selectedClip.trim?.from || 0) + clamp(timelineState.currentFrame - selectedPosition.startFrame, 0, selectedClip.durationInFrames)
    : 0

  const removeSelected = () => {
    if (!canEdit || !selectedClip) return
    const index = project.timeline.findIndex((clip) => clip.id === selectedClip.id)
    const next = project.timeline[index + 1] || project.timeline[index - 1] || null
    removeClip(selectedClip.id)
    selectClip(next?.id || null)
    if (next?.metadata.panelId) onSelectPanel(next.metadata.panelId)
    setNotice(null)
  }

  return (
    <div className="frc-inline-workspace">
      <div className="frc-commandbar">
        <div className="frc-command-title"><AppIcon name="video" /><div><strong>本集粗剪</strong><span>{project.timeline.length} 段 · {framesToTime(totalFrames, project.config.fps)}</span></div></div>
        <div className="frc-transport">
          <button type="button" title="上一片段" disabled={!positions.length} onClick={() => stepClip(-1)}><AppIcon name="chevronLeft" /></button>
          <time>{framesToTime(timelineState.currentFrame, project.config.fps)} / {framesToTime(totalFrames, project.config.fps)}</time>
          <button type="button" title="下一片段" disabled={!positions.length} onClick={() => stepClip(1)}><AppIcon name="chevronRight" /></button>
        </div>
        <button type="button" className="frc-tool" disabled={!canEdit || !selectedClip} onClick={() => updateTrim('from', currentSourceFrame)}>设为入点</button>
        <button type="button" className="frc-tool" disabled={!canEdit || !selectedClip} onClick={() => updateTrim('to', currentSourceFrame)}>设为出点</button>
        <button type="button" className="frc-tool is-danger" disabled={!canEdit || !selectedClip} onClick={removeSelected}><AppIcon name="trash" />移除</button>
        <button type="button" className="frc-tool" disabled={!canEdit || saving} onClick={reset}><AppIcon name="refresh" />恢复顺序</button>
        <button type="button" className="frc-tool" disabled={refreshing || isDirty} title={isDirty ? '请先保存或恢复当前修改' : '重新读取已生成的视频'} onClick={onRefresh}><AppIcon name="refresh" className={refreshing ? 'animate-spin' : ''} />刷新素材</button>
        <button type="button" className="frc-save" disabled={!canEdit || saving || !isDirty} onClick={() => void save()}><AppIcon name={saving ? 'loader' : 'check'} className={saving ? 'animate-spin' : ''} />{saving ? '保存中…' : isDirty ? '保存粗剪' : '已保存'}</button>
      </div>

      {lockReason ? <div className="frc-lock"><AppIcon name="lock" />{lockReason}</div> : null}
      {notice ? <div className="frc-notice is-success">{notice}</div> : null}
      {saveError ? <div className="frc-notice is-error">{saveError}</div> : null}

      {selectedClip ? (
        <div className="frc-cut-detail">
          <div className="frc-cut-name"><span>当前片段</span><strong>{selectedClip.metadata.sceneLabel} · {selectedClip.metadata.segmentLabel}</strong></div>
          <RoughCutTrimEditor clip={selectedClip} fps={project.config.fps} disabled={!canEdit} onChange={updateTrim} />
        </div>
      ) : null}

      {unusedSources.length ? (
        <div className="frc-restore-row"><span>已移出时间线</span>{unusedSources.map((source) => <button type="button" key={source.panelId} disabled={!canEdit} onClick={() => addSource(source)}><AppIcon name="plus" />{source.sceneLabel} · {source.segmentLabel}</button>)}</div>
      ) : null}

      <RoughCutTimeline
        project={project}
        currentFrame={timelineState.currentFrame}
        selectedClipId={timelineState.selectedClipId}
        zoom={timelineState.zoom}
        readOnly={!canEdit}
        onReorder={reorderClips}
        onSelect={selectTimelineClip}
        onSeek={seekTimeline}
        onZoom={setZoom}
      />
      {!sources.length ? <div className="frc-track-empty">本集还没有已生成的 Segment 视频，生成后点击“刷新素材”即可加入时间线。</div> : null}
    </div>
  )
}
