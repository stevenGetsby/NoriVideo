'use client'

import { memo } from 'react'
import { BaseEdge, getBezierPath, useStoreApi, type EdgeProps } from '@xyflow/react'
import type { CanvasFlowEdge } from '../editor-types'
import {
  resolveCanvasNodeEdgeEndpoint,
  type CanvasEdgePosition,
} from '../connection-line-geometry'

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
  } = props
  const nodeLookup = useStoreApi().getState().nodeLookup
  const sourceNode = nodeLookup.get(source)
  const targetNode = nodeLookup.get(target)

  const from = sourceNode
    ? resolveCanvasNodeEdgeEndpoint({
        positionAbsolute: sourceNode.internals.positionAbsolute,
        measuredWidth: measuredSize(sourceNode.measured?.width, sourceNode.width ?? sourceNode.internals.bounds?.width ?? 0),
        measuredHeight: measuredSize(sourceNode.measured?.height, sourceNode.height ?? sourceNode.internals.bounds?.height ?? 0),
        position: sourcePosition as CanvasEdgePosition,
      })
    : { x: sourceX, y: sourceY }
  const to = targetNode
    ? resolveCanvasNodeEdgeEndpoint({
        positionAbsolute: targetNode.internals.positionAbsolute,
        measuredWidth: measuredSize(targetNode.measured?.width, targetNode.width ?? targetNode.internals.bounds?.width ?? 0),
        measuredHeight: measuredSize(targetNode.measured?.height, targetNode.height ?? targetNode.internals.bounds?.height ?? 0),
        position: targetPosition as CanvasEdgePosition,
      })
    : { x: targetX, y: targetY }

  const [path] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition,
    targetX: to.x,
    targetY: to.y,
    targetPosition,
  })

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
})
