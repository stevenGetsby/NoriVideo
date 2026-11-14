'use client'

import { useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '@xyflow/react'
import { useCanvasEditor } from '../CanvasEditorContext'
import type { CanvasFlowEdge, CanvasFlowNode, CanvasFlowNodeData } from '../editor-types'
import {
  beatChipLabel,
  beatDragSeconds,
  beatTooltip,
  beatTrackFractions,
  formatBeatSecond,
  resolveBeatStart,
  STORY_BEAT_COLORS,
} from './story-beat-timeline'
import { mountedBeats, sceneVideoDurationSec, type SceneBeat } from './story-beats'
import { useStoryCanvasContext } from './StoryCanvasContext'

type BeatTimeline = { beats: SceneBeat[]; videoSec: number | null }
type DragState = { nodeId: string; originX: number; originStart: number; startSec: number; width: number }

/**
 * The scene's interaction timeline. Blocks drag horizontally inside the video; a drag never
 * overlaps a neighbour and commits one `startSec` change when the pointer is released.
 */
export function StoryBeatTimeline({ sceneId }: { sceneId: string }) {
  const editor = useCanvasEditor()
  const story = useStoryCanvasContext()
  const trackRef = useRef<HTMLDivElement | null>(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<DragState | null>(null)

  const timelineKey = useStore((state) => {
    const sceneEdges = state.edges.filter((edge) => edge.source === sceneId || edge.target === sceneId)
    const ids = new Set<string>([sceneId])
    for (const edge of sceneEdges) {
      ids.add(edge.source)
      ids.add(edge.target)
    }
    const nodes: Array<Pick<CanvasFlowNode, 'id' | 'type' | 'data'>> = []
    for (const nodeId of ids) {
      const node = state.nodeLookup.get(nodeId)
      if (node) nodes.push({ id: node.id, type: node.type ?? '', data: node.data as CanvasFlowNodeData })
    }
    const edges: Array<Pick<CanvasFlowEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'data'>> = sceneEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      data: edge.data as CanvasFlowEdge['data'],
    }))
    return JSON.stringify({ beats: mountedBeats(sceneId, nodes, edges), videoSec: sceneVideoDurationSec(sceneId, nodes, edges) })
  })
  const timeline = JSON.parse(timelineKey) as BeatTimeline
  const { beats, videoSec } = timeline
  const readOnly = editor.readOnly

  const begin = (event: ReactPointerEvent<HTMLButtonElement>, beat: SceneBeat) => {
    suppressClick.current = false
    if (readOnly || videoSec == null) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      nodeId: beat.nodeId,
      originX: event.clientX,
      originStart: beat.startSec,
      startSec: beat.startSec,
      width: trackRef.current?.getBoundingClientRect().width || 1,
    })
  }
  const move = (event: ReactPointerEvent<HTMLButtonElement>, beat: SceneBeat) => {
    if (!drag || drag.nodeId !== beat.nodeId || videoSec == null) return
    event.preventDefault()
    event.stopPropagation()
    const deltaPx = event.clientX - drag.originX
    if (Math.abs(deltaPx) > 2) suppressClick.current = true
    if (!suppressClick.current) return
    const proposed = drag.originStart + beatDragSeconds(deltaPx, drag.width, videoSec)
    const others = beats.filter((item) => item.nodeId !== beat.nodeId)
    const startSec = resolveBeatStart(proposed, beat.durationSec, others, videoSec, drag.originStart)
    if (startSec !== drag.startSec) setDrag({ ...drag, startSec })
  }
  const end = (event: ReactPointerEvent<HTMLButtonElement>, beat: SceneBeat) => {
    if (!drag || drag.nodeId !== beat.nodeId) return
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The browser may already have released the capture (pointercancel).
    }
    const { startSec } = drag
    setDrag(null)
    if (startSec !== beat.startSec) editor.updateNodeData(beat.nodeId, { startSec }, '调整互动时间')
  }
  const clickBlock = (event: MouseEvent<HTMLButtonElement>, beat: SceneBeat) => {
    event.stopPropagation()
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    story?.actions.focusNode(beat.nodeId)
  }

  if (readOnly && !beats.length) return null
  if (!beats.length) return <p className="nori-story-beat-empty" data-testid="story-beat-empty">在底部互动口添加互动</p>

  if (videoSec == null) {
    return (
      <div className="nori-story-beat-timeline">
        <div className="nori-story-beat-chips">
          {beats.map((beat) => (
            <button key={beat.nodeId} type="button" className="nori-story-beat-chip nodrag" data-testid={`story-beat-chip-${beat.nodeId}`}
              onClick={(event) => { event.stopPropagation(); story?.actions.focusNode(beat.nodeId) }}>
              {beatChipLabel(beat)}
            </button>
          ))}
        </div>
        <p className="nori-story-note">视频时长未知：在互动节点里填写开始秒数</p>
      </div>
    )
  }

  return (
    <div className="nori-story-beat-timeline">
      <div className="nori-story-beat-scale" aria-hidden="true">
        <span>0 秒</span>
        <span>{formatBeatSecond(videoSec)} 秒</span>
      </div>
      <div className="nori-story-beat-track" ref={trackRef} data-testid={`story-beat-track-${sceneId}`}>
        {beats.map((beat) => {
          const liveStart = drag?.nodeId === beat.nodeId ? drag.startSec : beat.startSec
          const fractions = beatTrackFractions(liveStart, beat.durationSec, videoSec)
          return (
            <button
              key={beat.nodeId}
              type="button"
              className={`nori-story-beat-block nodrag nopan${drag?.nodeId === beat.nodeId ? ' is-dragging' : ''}`}
              style={{ left: `${fractions.left * 100}%`, width: `${fractions.width * 100}%`, backgroundColor: STORY_BEAT_COLORS[beat.kind] }}
              title={beatTooltip({ ...beat, startSec: liveStart })}
              aria-label={beatTooltip({ ...beat, startSec: liveStart })}
              data-testid={`story-beat-${beat.nodeId}`}
              data-start-sec={liveStart}
              onPointerDown={(event) => begin(event, beat)}
              onPointerMove={(event) => move(event, beat)}
              onPointerUp={(event) => end(event, beat)}
              onPointerCancel={() => setDrag(null)}
              onClick={(event) => clickBlock(event, beat)}
            >
              <span>{beat.title}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
