'use client'

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
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
import type { VideoClip, VideoEditorProject } from '../types/editor.types'
import { calculateTimelineDuration, computeClipPositions, framesToTime } from '../utils/time-utils'

export function RoughCutTrimEditor({
  clip,
  fps,
  disabled,
  onChange,
}: {
  clip: VideoClip
  fps: number
  disabled: boolean
  onChange: (boundary: 'from' | 'to', value: number) => void
}) {
  const maximum = Math.max(1, clip.metadata.sourceDurationInFrames || clip.durationInFrames)
  const from = clip.trim?.from ?? 0
  const to = clip.trim?.to ?? maximum
  const style = { '--frc-in': `${(from / maximum) * 100}%`, '--frc-out': `${(to / maximum) * 100}%` } as CSSProperties
  return (
    <div className="frc-trim" style={style}>
      <div className="frc-trim-head">
        <span>入点 <time>{framesToTime(from, fps)}</time></span>
        <strong>保留 {framesToTime(to - from, fps)}</strong>
        <span>出点 <time>{framesToTime(to, fps)}</time></span>
      </div>
      <div className="frc-trim-slider">
        <i><span /></i>
        <input aria-label="粗剪入点" disabled={disabled} type="range" min={0} max={maximum} step={1} value={from} onChange={(event) => onChange('from', Number(event.target.value))} />
        <input aria-label="粗剪出点" disabled={disabled} type="range" min={0} max={maximum} step={1} value={to} onChange={(event) => onChange('to', Number(event.target.value))} />
      </div>
    </div>
  )
}

export function RoughCutTimeline({
  project,
  currentFrame,
  selectedClipId,
  zoom,
  readOnly,
  onReorder,
  onSelect,
  onSeek,
  onZoom,
}: {
  project: VideoEditorProject
  currentFrame: number
  selectedClipId: string | null
  zoom: number
  readOnly: boolean
  onReorder: (from: number, to: number) => void
  onSelect: (clipId: string, frame: number) => void
  onSeek: (frame: number) => void
  onZoom: (zoom: number) => void
}) {
  const positions = computeClipPositions(project.timeline)
  const totalFrames = calculateTimelineDuration(project.timeline)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const dragEnd = (event: DragEndEvent) => {
    if (readOnly || !event.over || event.active.id === event.over.id) return
    const from = project.timeline.findIndex((clip) => clip.id === event.active.id)
    const to = project.timeline.findIndex((clip) => clip.id === event.over?.id)
    if (from >= 0 && to >= 0) onReorder(from, to)
  }
  const seekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!totalFrames) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
    onSeek(Math.round(ratio * totalFrames))
  }
  return (
    <section className="frc-timeline" aria-label="本集粗剪时间线">
      <div className="frc-timeline-toolbar">
        <div><strong>视频轨道 V1</strong><span>拖动片段调整顺序，拖动双指针裁剪头尾</span></div>
        <label>缩放<input aria-label="时间线缩放" type="range" min={0.5} max={2.5} step={0.1} value={zoom} onChange={(event) => onZoom(Number(event.target.value))} /><small>{Math.round(zoom * 100)}%</small></label>
      </div>
      <div
        className="frc-ruler"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          seekFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event)
        }}
        onPointerUp={(event) => {
          seekFromPointer(event)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      >
        <span style={{ width: `${totalFrames ? (currentFrame / totalFrames) * 100 : 0}%` }} />
        <i style={{ left: `${totalFrames ? (currentFrame / totalFrames) * 100 : 0}%` }} />
        <time>00:00.00</time>
        <time>{framesToTime(totalFrames, project.config.fps)}</time>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
        <SortableContext items={project.timeline.map((clip) => clip.id)} strategy={horizontalListSortingStrategy}>
          <div className="frc-track">
            {positions.map((clip, index) => (
              <SortableRoughClip
                key={clip.id}
                clip={clip}
                index={index}
                fps={project.config.fps}
                zoom={zoom}
                selected={clip.id === selectedClipId}
                readOnly={readOnly}
                onClick={() => onSelect(clip.id, clip.startFrame)}
              />
            ))}
            {!positions.length ? <div className="frc-track-empty">暂无可剪辑视频</div> : null}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  )
}

function SortableRoughClip({
  clip,
  index,
  fps,
  zoom,
  selected,
  readOnly,
  onClick,
}: {
  clip: VideoClip
  index: number
  fps: number
  zoom: number
  selected: boolean
  readOnly: boolean
  onClick: () => void
}) {
  const sortable = useSortable({ id: clip.id, disabled: readOnly })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    width: `${Math.max(112, (clip.durationInFrames / fps) * 42 * zoom)}px`,
  }
  return (
    <button
      ref={sortable.setNodeRef}
      type="button"
      className={`frc-clip${selected ? ' is-selected' : ''}${sortable.isDragging ? ' is-dragging' : ''}`}
      style={style}
      onClick={onClick}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <span className="frc-clip-media">{clip.metadata.imageUrl ? <MediaImage src={clip.metadata.imageUrl} alt="" fill sizes="160px" style={{ objectFit: 'cover' }} /> : <AppIcon name="video" />}</span>
      <span className="frc-clip-shade" />
      <span className="frc-clip-grip"><AppIcon name="gripVertical" /></span>
      <span className="frc-clip-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="frc-clip-copy"><strong>{clip.metadata.sceneLabel} · {clip.metadata.segmentLabel}</strong><small>{framesToTime(clip.durationInFrames, fps)}</small></span>
    </button>
  )
}
