import type { XYPosition } from '@xyflow/react'
import type { CanvasNodeAction } from '../CanvasEditorContext'
import type { CanvasGenerateRequest } from '../components/CanvasGenerator'
import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'
import type { Viewport } from '../types'

export type AgentGraphChange = {
  label: string
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  deletedNodeIds: string[]
  deletedEdgeIds: string[]
  touchedNodeIds: string[]
}
export type AgentGraphLimits = { maxNodes: number; maxEdges: number }
export type CanvasAgentTurnState = {
  label: string
  recorded: boolean
  historyDepth: number | null
  historyToken: symbol | null
  ended: boolean
}

export type CanvasAgentBridge = {
  projectId: string
  canvasId: string
  limits: AgentGraphLimits
  getGraph(): { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[]; viewport: Viewport }
  getViewportBounds(): { x: number; y: number; width: number; height: number }
  prepareNodesForWrite?(ids: readonly string[]): Promise<void>
  readNodeDetails?(id: string): Promise<CanvasFlowNode>
  isWriteLocked(): boolean
  centerPosition(): XYPosition
  beginTurn(label: string): void
  endTurn(): CanvasAgentTurnState | null
  run<T>(fn: () => T | Promise<T>): Promise<T>
  commit(change: AgentGraphChange): void
  select(nodeIds: string[]): void
  focus(nodeIds: string[] | 'all'): void
  focusBounds?(bounds: { x: number; y: number; width: number; height: number }): void
  flash(nodeIds: string[], follow?: boolean): void
  generate(request: CanvasGenerateRequest, verifyApproval?: () => void): Promise<void>
  runNodeAction(nodeId: string, action: CanvasNodeAction): void | boolean | Promise<void | boolean>
  canUndoTurn(turn: CanvasAgentTurnState): boolean
  undoTurn(turn: CanvasAgentTurnState): void
  readOnly: boolean
  mode: 'canvas' | 'story'
}
