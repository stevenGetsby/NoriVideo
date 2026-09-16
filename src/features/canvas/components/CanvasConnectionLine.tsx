'use client'

import { useMemo } from 'react'
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

import {
  findCanvasTargetNodeIdAtPoint,
  resolveCanvasConnectionEndpoint,
  resolveCanvasNodeEdgeEndpoint,
  resolveCanvasRenderedScale,
  type CanvasEdgePosition,
} from '../connection-line-geometry'

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
  const source = props.fromNode
    ? resolveCanvasNodeEdgeEndpoint({
        positionAbsolute: props.fromNode.internals.positionAbsolute,
        measuredWidth: props.fromNode.measured?.width ?? props.fromNode.width ?? 0,
        measuredHeight: props.fromNode.measured?.height ?? props.fromNode.height ?? 0,
        position: props.fromPosition as CanvasEdgePosition,
      })
    : { x: props.fromX, y: props.fromY }
  const pointerFlow = resolveCanvasConnectionEndpoint({
    pointer: props.pointer,
    fallback: { x: props.toX, y: props.toY },
    viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
    renderedScale,
    anchored: false,
  })
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
