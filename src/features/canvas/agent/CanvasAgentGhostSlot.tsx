'use client'

import { ViewportPortal } from '@xyflow/react'
import { useSyncExternalStore } from 'react'
import type { AgentFeedbackStore } from './feedback-store'

export function CanvasAgentGhostSlot({ feedback }: { feedback: AgentFeedbackStore }) {
  const ghost = useSyncExternalStore(feedback.ghost.subscribe, feedback.ghost.get, feedback.ghost.get)
  if (!ghost) return null
  const nodes = new Map(ghost.nodes.map((node) => [node.id, node]))
  return <ViewportPortal>
    <div className="nori-canvas-agent-ghost-layer" aria-hidden>
      {ghost.edges.map((edge) => {
        const source = nodes.get(edge.source)
        const target = nodes.get(edge.target)
        if (!source || !target) return null
        const left = source.position.x + (source.width || 300)
        const top = source.position.y + (source.height || 200) / 2
        const dx = target.position.x - left
        const dy = target.position.y + (target.height || 200) / 2 - top
        return <span key={edge.id} className="nori-canvas-agent-ghost-wire"
          style={{ left, top, width: Math.hypot(dx, dy), transform: `rotate(${Math.atan2(dy, dx)}rad)` }} />
      })}
      {ghost.nodes.map((node) => <div className="nori-canvas-agent-ghost-node" key={node.id}
        style={{ left: node.position.x, top: node.position.y, width: node.width || 300, height: node.height || 200 }}>
        {node.data.title || '节点'}
      </div>)}
    </div>
  </ViewportPortal>
}
