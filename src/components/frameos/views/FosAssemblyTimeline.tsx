'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MediaImage } from '@/components/media/MediaImage'
import { AppIcon } from '@/components/ui/icons'
import type { ComputedClip, VideoClip, VideoEditorProject } from '@/features/video-editor/types/editor.types'
import {
  assemblyClipWidths,
  assemblyRulerFrames,
  assemblyTimelineWidth,
  clientXToCssOffset,
  sourceAudioTimelineStart,
  timelineFrameToOffset,
  timelineOffsetToLocation,
} from '@/features/video-editor/utils/assembly-timeline'
import { calculateTimelineDuration, computeClipPositions, framesToTime } from '@/features/video-editor/utils/time-utils'

const TRACK_LABEL_WIDTH = 82

export type AssemblyTrackKind = 'video' | 'audio'
export interface AssemblyTrackSelection { clipId: string; track: AssemblyTrackKind; audioSegmentId?: string }

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Convert a viewport pointer coordinate back to the element's CSS-pixel
 * coordinate system. The whole FrameOS shell is intentionally rendered at
 * 120% with CSS `zoom`; DOMRects are therefore expressed in enlarged screen
 * pixels while timeline widths and React state remain in logical CSS pixels.
 */
function localCssX(element: HTMLElement, clientX: number) {
  const rect = element.getBoundingClientRect()
  const logicalWidth = element.offsetWidth || element.clientWidth
  return clientXToCssOffset(clientX, rect.left, rect.width, logicalWidth)
}

const FALLBACK_TRACK_WIDTH = 720

export function FosAssemblyTimeline({
  project,
  currentFrame,
  selection,
  zoom,
  readOnly,
  isDirty,
  saving,
  canUndo,
  canRedo,
  onReorder,
  onSelect,
  onSeek,
  onZoom,
  onMoveAudio,
  onCut,
  onDelete,
  onUndo,
  onRedo,
  onReset,
  onSave,
  canCut = Boolean(selection),
  canDelete = Boolean(selection),
  audioReadOnly = readOnly,
  resetLabel = '恢复分镜顺序',
}: {
  project: VideoEditorProject
  currentFrame: number
  selection: AssemblyTrackSelection | null
  zoom: number
  readOnly: boolean
  isDirty: boolean
  saving: boolean
  canUndo: boolean
  canRedo: boolean
  onReorder: (from: number, to: number) => void
  onSelect: (selection: AssemblyTrackSelection, frame: number) => void
  onSeek: (frame: number, preferredClipId?: string | null) => void
  onZoom: (zoom: number) => void
  onMoveAudio: (clipId: string, segmentId: string, timelineStartFrame: number) => void
  onCut: () => void
  onDelete: () => void
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  onSave: () => void
  canCut?: boolean
  canDelete?: boolean
  audioReadOnly?: boolean
  resetLabel?: string
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [fitTrackWidth, setFitTrackWidth] = useState(FALLBACK_TRACK_WIDTH)
  const [playheadPointerId, setPlayheadPointerId] = useState<number | null>(null)
  const [audioDrag, setAudioDrag] = useState<{
    pointerId: number
    clipId: string
    segmentId: string
    pointerStartFrame: number
    initialStartFrame: number
    nextStartFrame: number
    durationInFrames: number
  } | null>(null)
  const positions = useMemo(() => computeClipPositions(project.timeline), [project.timeline])
  const totalFrames = calculateTimelineDuration(project.timeline)
  const widths = useMemo(() => assemblyClipWidths({
    durations: project.timeline.map((clip) => clip.durationInFrames),
    fps: project.config.fps,
    zoom,
    fitTrackWidth,
  }), [fitTrackWidth, project.config.fps, project.timeline, zoom])
  const timelineWidth = assemblyTimelineWidth(widths, fitTrackWidth)
  const playheadLeft = TRACK_LABEL_WIDTH + timelineFrameToOffset(currentFrame, positions, widths, selection?.clipId)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ticks = useMemo(
    () => assemblyRulerFrames(totalFrames, project.config.fps, timelineWidth),
    [project.config.fps, timelineWidth, totalFrames],
  )

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const update = () => {
      const next = Math.max(240, Math.round(element.clientWidth - TRACK_LABEL_WIDTH))
      setFitTrackWidth((current) => Math.abs(current - next) < 2 ? current : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scenes = useMemo(() => {
    const result: Array<{ key: string; label: string; width: number }> = []
    project.timeline.forEach((clip, index) => {
      const label = clip.metadata.sceneLabel || '未分场'
      const previous = result.at(-1)
      if (previous?.label === label) previous.width += widths[index] + 3
      else result.push({ key: `${label}:${index}`, label, width: widths[index] })
    })
    return result
  }, [project.timeline, widths])
  const audioItems = useMemo(() => positions.flatMap((clip) => {
    const segments = clip.sourceAudio?.detached
      ? clip.sourceAudio.segments ?? [{ id: `source:${clip.id}`, from: 0, to: clip.durationInFrames, volume: clip.sourceAudio.volume }]
      : [{ id: `source:${clip.id}`, from: 0, to: clip.durationInFrames, volume: 1 }]
    return segments.map((segment) => ({
      clip,
      segment,
      startFrame: sourceAudioTimelineStart(clip.startFrame, segment),
      durationInFrames: Math.max(1, segment.to - segment.from),
    }))
  }), [positions])

  const dragEnd = (event: DragEndEvent) => {
    if (readOnly || !event.over || event.active.id === event.over.id) return
    const from = project.timeline.findIndex((clip) => clip.id === event.active.id)
    const to = project.timeline.findIndex((clip) => clip.id === event.over?.id)
    if (from >= 0 && to >= 0) onReorder(from, to)
  }

  const seekFromPointer = (event: MouseEvent<HTMLDivElement>) => {
    if (!totalFrames) return
    const location = timelineOffsetToLocation(localCssX(event.currentTarget, event.clientX), positions, widths)
    onSeek(location.frame, location.clipId)
  }

  const locationFromClientX = (clientX: number) => {
    if (!totalFrames || !canvasRef.current) return
    return timelineOffsetToLocation(localCssX(canvasRef.current, clientX) - TRACK_LABEL_WIDTH, positions, widths)
  }

  const seekFromClientX = (clientX: number) => {
    const location = locationFromClientX(clientX)
    if (location) onSeek(location.frame, location.clipId)
  }

  const startPlayheadDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setPlayheadPointerId(event.pointerId)
    seekFromClientX(event.clientX)
  }

  const movePlayhead = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (playheadPointerId !== event.pointerId) return
    seekFromClientX(event.clientX)
  }

  const finishPlayheadDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (playheadPointerId !== event.pointerId) return
    seekFromClientX(event.clientX)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setPlayheadPointerId(null)
  }

  const startAudioDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: (typeof audioItems)[number],
  ) => {
    if (!totalFrames) return
    event.preventDefault()
    event.stopPropagation()
    const pointerStartFrame = locationFromClientX(event.clientX)?.frame ?? item.startFrame
    const selectedFrame = clamp(pointerStartFrame, item.startFrame, item.startFrame + item.durationInFrames - 1)
    onSelect({ clipId: item.clip.id, track: 'audio', audioSegmentId: item.segment.id }, selectedFrame)
    if (readOnly || audioReadOnly) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setAudioDrag({
      pointerId: event.pointerId,
      clipId: item.clip.id,
      segmentId: item.segment.id,
      pointerStartFrame,
      initialStartFrame: item.startFrame,
      nextStartFrame: item.startFrame,
      durationInFrames: item.durationInFrames,
    })
  }

  const moveAudioDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    setAudioDrag((current) => {
      if (!current || current.pointerId !== event.pointerId || !totalFrames) return current
      const pointerFrame = locationFromClientX(event.clientX)?.frame
      if (pointerFrame === undefined) return current
      const deltaFrames = pointerFrame - current.pointerStartFrame
      const nextStartFrame = clamp(
        current.initialStartFrame + deltaFrames,
        0,
        Math.max(0, totalFrames - current.durationInFrames),
      )
      return nextStartFrame === current.nextStartFrame ? current : { ...current, nextStartFrame }
    })
  }

  const finishAudioDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!audioDrag || audioDrag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const pointerFrame = locationFromClientX(event.clientX)?.frame
    const finalStartFrame = pointerFrame === undefined
      ? audioDrag.nextStartFrame
      : clamp(
        audioDrag.initialStartFrame + pointerFrame - audioDrag.pointerStartFrame,
        0,
        Math.max(0, totalFrames - audioDrag.durationInFrames),
      )
    if (finalStartFrame !== audioDrag.initialStartFrame) {
      onMoveAudio(audioDrag.clipId, audioDrag.segmentId, finalStartFrame)
    }
    setAudioDrag(null)
  }

  const selectFromPointer = (event: MouseEvent<HTMLButtonElement>, clip: ComputedClip, track: AssemblyTrackKind) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = Math.round(clamp((event.clientX - rect.left) / rect.width, 0, 1) * Math.max(0, clip.durationInFrames - 1))
    onSelect({ clipId: clip.id, track }, clip.startFrame + offset)
  }

  const widthStyle = { '--fac-timeline-width': `${timelineWidth}px` } as CSSProperties
  return (
    <section className="fac-timeline" style={widthStyle} aria-label="组装剪辑时间线">
      <header className="fac-timeline-head">
        <div className="fac-timeline-title"><strong>时间线</strong><span>{project.timeline.length} 个剪辑片段 · 选择轨道片段后在播放头处切割</span></div>
        <div className="fac-timeline-tools">
          <button type="button" disabled={readOnly || !selection || !canCut} onClick={onCut}><AppIcon name="edit" />切割<kbd>C</kbd></button>
          <button type="button" disabled={!canUndo} onClick={onUndo}><AppIcon name="undo" />撤回<kbd>⌘Z</kbd></button>
          <button type="button" disabled={!canRedo} onClick={onRedo}><AppIcon name="redo" />重做</button>
          <button type="button" className="is-danger" disabled={readOnly || !selection || !canDelete} onClick={onDelete}><AppIcon name="trash" />删除<kbd>⌫</kbd></button>
          <button type="button" disabled={readOnly} onClick={onReset}><AppIcon name="refresh" />{resetLabel}</button>
          <button type="button" className="is-save" disabled={readOnly || saving || !isDirty} onClick={onSave}><AppIcon name={saving ? 'loader' : 'check'} className={saving ? 'animate-spin' : ''} />{saving ? '保存中…' : isDirty ? '保存剪辑' : '剪辑已保存'}</button>
        </div>
        <label>缩放<input aria-label="组装时间线缩放" type="range" min={0.5} max={3} step={0.1} value={zoom} onChange={(event) => onZoom(Number(event.target.value))} /><small>{Math.round(zoom * 100)}%</small></label>
      </header>
      <div ref={viewportRef} className="fac-timeline-viewport">
        <div ref={canvasRef} className="fac-timeline-canvas" style={{ width: timelineWidth + TRACK_LABEL_WIDTH }}>
          <div className="fac-timeline-grid" aria-hidden="true">
            {ticks.map((frame, index) => (
              <i key={`${frame}:${index}`} style={{ left: timelineFrameToOffset(frame, positions, widths) }} />
            ))}
          </div>
          <div className="fac-ruler-row">
            <span>时间</span>
            <div className="fac-ruler" onClick={seekFromPointer}>
              {ticks.map((frame, index) => {
                const edge = index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'mid'
                return (
                  <span
                    key={`${frame}:${index}`}
                    className="fac-ruler-mark"
                    data-edge={edge}
                    style={{ left: timelineFrameToOffset(frame, positions, widths) }}
                  >
                    <time>{framesToTime(frame, project.config.fps)}</time>
                    <i />
                  </span>
                )
              })}
            </div>
          </div>
          <div className="fac-track-row is-scenes"><span className="fac-track-label">场景</span><div className="fac-track-lane">{scenes.map((scene) => <div key={scene.key} className="fac-scene-block" style={{ width: scene.width }}>{scene.label}</div>)}</div></div>
          <div className="fac-track-row is-video"><span className="fac-track-label">分镜</span><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={project.timeline.map((clip) => clip.id)} strategy={horizontalListSortingStrategy}><div className="fac-track-lane">{positions.map((clip, index) => <SortableAssemblyClip key={clip.id} clip={clip} index={index} width={widths[index]} fps={project.config.fps} selected={selection?.clipId === clip.id && selection.track === 'video'} readOnly={readOnly} onClick={(event) => selectFromPointer(event, clip, 'video')} />)}{!positions.length ? <div className="fac-track-empty">暂无可剪辑的分镜视频</div> : null}</div></SortableContext></DndContext></div>
          <div className="fac-track-row is-audio"><span className="fac-track-label"><AppIcon name="audioWave" />音频</span><div className="fac-track-lane fac-audio-lane">{audioItems.map((item) => {
            const previewStart = audioDrag?.clipId === item.clip.id && audioDrag.segmentId === item.segment.id
              ? audioDrag.nextStartFrame
              : item.startFrame
            return (
              <button
                key={`${item.clip.id}:${item.segment.id}`}
                type="button"
                aria-label={`移动音频 ${item.clip.metadata.sceneLabel || ''} ${item.clip.metadata.segmentLabel || ''}`.trim()}
                title={audioReadOnly ? '源音频随视频片段移动' : '拖动以调整音频在时间线中的位置'}
                className={`fac-audio-block${selection?.clipId === item.clip.id && selection.track === 'audio' && selection.audioSegmentId === item.segment.id ? ' is-selected' : ''}${audioDrag?.clipId === item.clip.id && audioDrag.segmentId === item.segment.id ? ' is-dragging' : ''}`}
                style={{
                  left: timelineFrameToOffset(previewStart, positions, widths),
                  width: Math.max(22, timelineFrameToOffset(previewStart + item.durationInFrames, positions, widths) - timelineFrameToOffset(previewStart, positions, widths)),
                }}
                onPointerDown={(event) => startAudioDrag(event, item)}
                onPointerMove={moveAudioDrag}
                onPointerUp={finishAudioDrag}
                onPointerCancel={finishAudioDrag}
              ><AppIcon name="audioWave" /><span>源音频</span><AppIcon name="gripVertical" /></button>
            )
          })}</div></div>
          <div className="fac-track-row is-bgm"><span className="fac-track-label">BGM</span><div className="fac-track-lane"><div className="fac-bgm-empty"><AppIcon name="audioWave" />暂无配乐轨</div></div></div>
          <button
            type="button"
            className={`fac-playhead${playheadPointerId !== null ? ' is-dragging' : ''}`}
            style={{ left: playheadLeft }}
            aria-label="剪辑播放头"
            title="拖动播放头定位时间"
            onPointerDown={startPlayheadDrag}
            onPointerMove={movePlayhead}
            onPointerUp={finishPlayheadDrag}
            onPointerCancel={finishPlayheadDrag}
          ><b /></button>
        </div>
      </div>
    </section>
  )
}

function SortableAssemblyClip({ clip, index, width, fps, selected, readOnly, onClick }: { clip: VideoClip; index: number; width: number; fps: number; selected: boolean; readOnly: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  const sortable = useSortable({ id: clip.id, disabled: readOnly })
  const style = { width, transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }
  return (
    <button ref={sortable.setNodeRef} type="button" className={`fac-video-clip${selected ? ' is-selected' : ''}${sortable.isDragging ? ' is-dragging' : ''}`} style={style} onClick={onClick} {...sortable.attributes} {...sortable.listeners}>
      <span className="fac-video-thumb">{clip.metadata.imageUrl ? <MediaImage src={clip.metadata.imageUrl} alt="" fill sizes="180px" style={{ objectFit: 'cover' }} /> : <AppIcon name="video" />}</span>
      <span className="fac-video-shade" />
      <span className="fac-video-grip"><AppIcon name="gripVertical" /></span>
      <span className="fac-video-index">#{String(index + 1).padStart(2, '0')}</span>
      <span className="fac-video-copy"><strong>{clip.metadata.sceneLabel} · {clip.metadata.segmentLabel}</strong><small>{framesToTime(clip.durationInFrames, fps)}</small></span>
    </button>
  )
}
