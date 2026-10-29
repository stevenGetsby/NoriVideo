'use client'

import { useMemo, type CSSProperties } from 'react'
import {
  ConnectionLineType,
  Position,
  getBezierPath,
  getSimpleBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useStoreApi,
  type ConnectionLineComponentProps,
} from '@xyflow/react'
import { isStoryNodeType } from '@/lib/interactive/compile'

import {
  findCanvasTargetNodeIdAtPoint,
  resolveCanvasConnectionEndpoint,
  resolveCanvasNodeEdgeEndpoint,
  resolveCanvasRenderedScale,
  type CanvasEdgePosition,
} from '../connection-line-geometry'
import { STORY_NODE_HUES } from '../story/StoryCanvasContext'
import { STORY_MEDIA_HANDLE } from '../story/story-connection'
import { handleBoxCenter, nodeBox, resolveStoryWireTarget, storyHandleCenter, storyMediaAnchor, storyNodeAt, storyWireRole } from '../story/story-geometry'

const OPPOSITE: Record<Position, Position> = {
  [Position.Left]: Position.Right,
  [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom,
  [Position.Bottom]: Position.Top,
}

/**
 * Story wires start at the real port centre, snap to the port they would connect to, and turn red
 * over a card that refuses them. A picture link always runs into the scene's top port.
 */
function renderStoryConnectionLine(
  props: ConnectionLineComponentProps,
  pointerFlow: { x: number; y: number },
  scale: number,
  { nodeLookup, edges, transform }: ReturnType<ReturnType<typeof useStoreApi>['getState']>,
) {
  const role = storyWireRole(props.fromNode, props.fromHandle?.id)
  if (!role || !props.fromNode || !props.fromHandle) return null
  const target = resolveStoryWireTarget({ from: props.fromNode, fromHandle: props.fromHandle.id, point: pointerFlow, nodes: nodeLookup.values(), edges, scale, zoom: transform[2] })
  const hit = target ? null : storyNodeAt(nodeLookup.values(), pointerFlow, props.fromNode.id)
  const refused = Boolean(hit) && (role !== 'media' || isStoryNodeType(hit?.type))
  if (!target && role === 'media' && !refused && !isStoryNodeType(props.toNode?.type)) return null
  const scenePort = target?.connection.target === props.fromNode.id && target.connection.targetHandle === STORY_MEDIA_HANDLE
    ? storyHandleCenter(props.fromNode, STORY_MEDIA_HANDLE, scale)
    : null
  const start = role === 'media'
    ? storyMediaAnchor(nodeBox(props.fromNode), target?.point ?? pointerFlow)
    : scenePort
      ? { point: scenePort, position: Position.Top }
      : { point: handleBoxCenter(props.fromNode.internals.positionAbsolute, props.fromHandle, scale), position: props.fromPosition }
  const end = target ?? { point: pointerFlow, position: OPPOSITE[start.position] }
  const [path] = getBezierPath({ sourceX: start.point.x, sourceY: start.point.y, sourcePosition: start.position, targetX: end.point.x, targetY: end.point.y, targetPosition: end.position })
  const hue = STORY_NODE_HUES[props.fromNode.type as keyof typeof STORY_NODE_HUES] ?? 'var(--dm-hue-video)'
  const state = target ? ' is-snapped' : refused ? ' is-refused' : ''
  return (
    <g className={`nori-story-wire${state}`} style={{ '--wire-hue': hue } as CSSProperties}>
      <path d={path} fill="none" className="react-flow__connection-path" />
      {target ? <circle cx={end.point.x} cy={end.point.y} r={9} className="nori-story-wire-target" /> : null}
    </g>
  )
}

function connectionPath(
  props: ConnectionLineComponentProps,
  source: { x: number; y: number },
  target: { x: number; y: number },
  targetPosition: Position,
): string {
  const pathParams = {
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: props.fromPosition,
    targetX: target.x,
    targetY: target.y,
    targetPosition,
  }

  if (props.connectionLineType === ConnectionLineType.SimpleBezier) return getSimpleBezierPath(pathParams)[0]
  if (props.connectionLineType === ConnectionLineType.Step) return getSmoothStepPath({ ...pathParams, borderRadius: 0 })[0]
  if (props.connectionLineType === ConnectionLineType.SmoothStep) return getSmoothStepPath(pathParams)[0]
  if (props.connectionLineType === ConnectionLineType.Straight) return getStraightPath(pathParams)[0]
  return getBezierPath(pathParams)[0]
}

export function CanvasConnectionLine(props: ConnectionLineComponentProps) {
  const flowStore = useStoreApi()
  const { domNode, nodeLookup, transform } = flowStore.getState()
  const renderedScale = useMemo(() => {
    // React Flow removes the container offset from pointer events but does not
    // remove an ancestor CSS zoom. Compare rendered and layout sizes so the
    // free end remains under the pointer inside the zoomed application shell.
    const bounds = domNode?.getBoundingClientRect()
    return resolveCanvasRenderedScale({
      layoutWidth: domNode?.clientWidth || 0,
      layoutHeight: domNode?.clientHeight || 0,
      renderedWidth: bounds?.width || 0,
      renderedHeight: bounds?.height || 0,
    })
  }, [domNode])
  const pointerFlow = resolveCanvasConnectionEndpoint({
    pointer: props.pointer,
    fallback: { x: props.toX, y: props.toY },
    viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
    renderedScale,
    anchored: false,
  })
  const storyLine = renderStoryConnectionLine(props, pointerFlow, renderedScale.x, flowStore.getState())
  if (storyLine) return storyLine
  const source = props.fromNode
    ? resolveCanvasNodeEdgeEndpoint({
        positionAbsolute: props.fromNode.internals.positionAbsolute,
        measuredWidth: props.fromNode.measured?.width ?? props.fromNode.width ?? 0,
        measuredHeight: props.fromNode.measured?.height ?? props.fromNode.height ?? 0,
        position: props.fromPosition as CanvasEdgePosition,
      })
    : { x: props.fromX, y: props.fromY }
  const areaTargetId = findCanvasTargetNodeIdAtPoint({
    nodes: Array.from(nodeLookup.values()),
    point: pointerFlow,
    excludeNodeId: props.fromNode?.id,
  })
  const areaTargetNode = areaTargetId ? nodeLookup.get(areaTargetId) : null
  const sourceHandleIsLeft = props.fromHandle?.id === 'input' || props.fromHandle?.id === 'left'
  const hasHandleTarget = Boolean(props.toNode && props.toHandle)
  const targetPosition: Position = hasHandleTarget
    ? props.toPosition
    : areaTargetNode
      ? (sourceHandleIsLeft ? Position.Right : Position.Left)
      : props.toPosition
  const target = props.toNode && props.toHandle
    ? resolveCanvasNodeEdgeEndpoint({
        positionAbsolute: props.toNode.internals.positionAbsolute,
        measuredWidth: props.toNode.measured?.width ?? props.toNode.width ?? 0,
        measuredHeight: props.toNode.measured?.height ?? props.toNode.height ?? 0,
        position: props.toPosition as CanvasEdgePosition,
      })
    : areaTargetNode && props.connectionStatus !== 'invalid'
      ? resolveCanvasNodeEdgeEndpoint({
          positionAbsolute: areaTargetNode.internals.positionAbsolute,
          measuredWidth: areaTargetNode.measured?.width ?? areaTargetNode.width ?? 0,
          measuredHeight: areaTargetNode.measured?.height ?? areaTargetNode.height ?? 0,
          position: sourceHandleIsLeft ? 'right' : 'left',
        })
      : resolveCanvasConnectionEndpoint({
          pointer: props.pointer,
          fallback: { x: props.toX, y: props.toY },
          viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
          renderedScale,
          anchored: props.connectionStatus === 'valid' && Boolean(props.toHandle),
        })

  return (
    <path
      d={connectionPath(props, source, target, targetPosition)}
      fill="none"
      className="react-flow__connection-path"
      style={props.connectionLineStyle}
    />
  )
}
