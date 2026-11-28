'use client'

import { memo, type CSSProperties } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStoreApi, type EdgeProps } from '@xyflow/react'
import { X } from '@/components/ui/icons'
import type { CanvasFlowEdge } from '../editor-types'
import {
  resolveCanvasNodeEdgeEndpoint,
  type CanvasEdgePosition,
} from '../connection-line-geometry'
import { STORY_FLOW_ROLE, STORY_MOUNT_ROLE } from '@/lib/interactive/types'
import { STORY_NODE_HUES, useStoryCanvasContext } from '../story/StoryCanvasContext'
import { isStoryMediaTarget } from '../story/story-connection'
import { paneRenderedScale, storyEdgeEnds } from '../story/story-geometry'

const EDGE_HUE_BY_NODE_TYPE: Record<string, string> = {
  text: 'var(--dm-hue-text)',
  note: 'var(--dm-hue-text)',
  image: 'var(--dm-hue-image)',
  model_3d: 'var(--dm-hue-image)',
  studio_3d: 'var(--dm-hue-image)',
  production_panel: 'var(--dm-hue-image)',
  video: 'var(--dm-hue-video)',
  video_edit: 'var(--dm-hue-video)',
  playlist: 'var(--dm-hue-video)',
  production_video: 'var(--dm-hue-video)',
  audio: 'var(--dm-hue-audio)',
  ...STORY_NODE_HUES,
}

const EDGE_STYLE_BY_HUE: Record<string, CSSProperties> = Object.fromEntries(
  Array.from(new Set(Object.values(EDGE_HUE_BY_NODE_TYPE))).map((hue) => [hue, { '--edge-hue': hue } as CSSProperties]),
)

function measuredSize(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export const CanvasEdge = memo(function CanvasEdge(props: EdgeProps<CanvasFlowEdge>) {
  const {
    id,
    source,
    target,
    sourcePosition,
    targetPosition,
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerEnd,
    style,
    selected,
    sourceHandleId,
  } = props
  const store = useStoreApi().getState()
  const story = useStoryCanvasContext()
  const sourceNode = store.nodeLookup.get(source)
  const targetNode = store.nodeLookup.get(target)

  // Story flows leave from a specific option / branch row, pictures enter a scene from its top port,
  // and a mounted interaction hangs from the scene's bottom port.
  const storyFlow = props.data?.role === STORY_FLOW_ROLE
  const storyMount = props.data?.role === STORY_MOUNT_ROLE
  const storyLine = storyFlow || storyMount
  const storyEnds = sourceNode && targetNode && (storyLine || isStoryMediaTarget(targetNode.type))
    ? storyEdgeEnds({ source: sourceNode, target: targetNode, sourceHandle: sourceHandleId, flow: storyFlow, mount: storyMount, scale: paneRenderedScale(store.domNode, store.width) })
    : null
  const from = storyEnds?.source ?? (sourceNode && !storyLine
    ? resolveCanvasNodeEdgeEndpoint({
        positionAbsolute: sourceNode.internals.positionAbsolute,
        measuredWidth: measuredSize(sourceNode.measured?.width, sourceNode.width ?? sourceNode.internals.bounds?.width ?? 0),
        measuredHeight: measuredSize(sourceNode.measured?.height, sourceNode.height ?? sourceNode.internals.bounds?.height ?? 0),
        position: sourcePosition as CanvasEdgePosition,
      })
    : { x: sourceX, y: sourceY })
  const to = storyEnds?.target ?? (targetNode && !storyLine
    ? resolveCanvasNodeEdgeEndpoint({
        positionAbsolute: targetNode.internals.positionAbsolute,
        measuredWidth: measuredSize(targetNode.measured?.width, targetNode.width ?? targetNode.internals.bounds?.width ?? 0),
        measuredHeight: measuredSize(targetNode.measured?.height, targetNode.height ?? targetNode.internals.bounds?.height ?? 0),
        position: targetPosition as CanvasEdgePosition,
      })
    : { x: targetX, y: targetY })

  const [path, labelX, labelY] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: storyEnds?.sourcePosition ?? sourcePosition,
    targetX: to.x,
    targetY: to.y,
    targetPosition: storyEnds?.targetPosition ?? targetPosition,
  })

  const edgeHue = storyMount ? STORY_NODE_HUES.story_interaction : sourceNode?.type ? EDGE_HUE_BY_NODE_TYPE[sourceNode.type] : undefined
  const edgeStyle = edgeHue
    ? (style ? ({ ...style, '--edge-hue': edgeHue } as CSSProperties) : (EDGE_STYLE_BY_HUE[edgeHue] ?? ({ '--edge-hue': edgeHue } as CSSProperties)))
    : style
  const storyClass = storyFlow ? 'is-story-flow' : storyMount ? 'is-story-mount' : storyEnds ? 'is-story-media' : undefined
  const canDelete = Boolean(storyEnds && selected && story && !story.readOnly)
  const deleteLabel = storyFlow ? '断开剧情连线' : storyMount ? '从片段上取下互动' : targetNode?.type === 'story_scene' ? '移除片段画面' : '移除互动画面'

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={storyEnds ? undefined : markerEnd} style={edgeStyle} className={storyClass} />
      {canDelete && story ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nori-story-edge-delete nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, '--edge-hue': edgeHue } as CSSProperties}
            aria-label={deleteLabel}
            title={deleteLabel}
            onClick={() => story.actions.removeEdge(id)}
          >
            <X />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
})
