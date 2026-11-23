'use client'

import { useRef, type RefObject } from 'react'
import type { XYPosition } from '@xyflow/react'
import type { CanvasNodeAction } from '../CanvasEditorContext'
import type { CanvasGenerateRequest } from '../components/CanvasGenerator'
import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'
import type { Viewport } from '../types'
import type { AgentGraphChange, AgentGraphLimits, CanvasAgentBridge } from './bridge-types'
import { CanvasAgentToolError } from './tool-error'
import type { createCanvasAgentTurnController } from './turn-record'

type Options = {
  projectId: string
  canvasId: string
  readOnly: boolean
  mode: 'canvas' | 'story'
  writeLocked: boolean
  limits: AgentGraphLimits
  nodesRef: RefObject<CanvasFlowNode[]>
  edgesRef: RefObject<CanvasFlowEdge[]>
  viewportRef: RefObject<Viewport>
  wrapperRef: RefObject<HTMLElement | null>
  turn: ReturnType<typeof createCanvasAgentTurnController>
  focus(ids: string[] | 'all'): void
  focusBounds?(bounds: { x: number; y: number; width: number; height: number }): void
  select(ids: string[]): void
  centerPosition(): XYPosition
  prepareNodesForWrite(ids: readonly string[]): Promise<void>
  readNodeDetails(id: string): Promise<CanvasFlowNode>
  commit(change: AgentGraphChange): void
  generate(request: CanvasGenerateRequest, verifyApproval?: () => void): Promise<unknown>
  runNodeAction(id: string, action: CanvasNodeAction): void | boolean | Promise<void | boolean>
  undo(): void
  history: { getDepth(): number; getLastLabel(): string | null; getHead(): symbol | null }
  flash?(ids: string[], follow?: boolean): void
}

export function useCanvasAgentBridge(options: Options): CanvasAgentBridge {
  const current = useRef(options)
  current.current = options
  const bridge = useRef<CanvasAgentBridge | null>(null)
  if (!bridge.current) {
    const lock = () => current.current.writeLocked || current.current.readOnly || current.current.mode !== 'canvas'
    const assertWritable = () => { if (lock()) throw new CanvasAgentToolError('CANVAS_LOCKED') }
    bridge.current = {
      get projectId() { return current.current.projectId }, get canvasId() { return current.current.canvasId },
      get mode() { return current.current.mode }, get readOnly() { return current.current.readOnly },
      get limits() { return current.current.limits },
      getGraph() {
        const { nodesRef, edgesRef, viewportRef } = current.current
        return { nodes: nodesRef.current, edges: edgesRef.current, viewport: viewportRef.current }
      },
      getViewportBounds() {
        const { wrapperRef, viewportRef } = current.current
        const { x, y, zoom } = viewportRef.current
        return { x: -x / zoom, y: -y / zoom, width: (wrapperRef.current?.clientWidth ?? 0) / zoom, height: (wrapperRef.current?.clientHeight ?? 0) / zoom }
      },
      isWriteLocked: lock,
      centerPosition: () => current.current.centerPosition(),
      beginTurn: (label) => { assertWritable(); current.current.turn.begin(label) },
      endTurn: () => current.current.turn.end(),
      run: (task) => { assertWritable(); return current.current.turn.run(task) },
      commit: (change) => {
        assertWritable()
        if (!current.current.turn.isExecuting()) throw new CanvasAgentToolError('STOPPED')
        current.current.commit(change)
      },
      select: (ids) => current.current.select(ids),
      focus: (ids) => current.current.focus(ids),
      focusBounds: (bounds) => current.current.focusBounds?.(bounds),
      flash: (ids, follow) => current.current.flash?.(ids, follow),
      prepareNodesForWrite: (ids) => { assertWritable(); return current.current.prepareNodesForWrite(ids) },
      readNodeDetails: (id) => current.current.readNodeDetails(id),
      generate: async (request, verifyApproval) => { assertWritable(); await current.current.generate(request, verifyApproval) },
      runNodeAction: (id, action) => { assertWritable(); return current.current.runNodeAction(id, action) },
      canUndoTurn: (receipt) => current.current.turn.canUndo(receipt, current.current.history, lock()),
      undoTurn: (receipt) => {
        if (current.current.turn.canUndo(receipt, current.current.history, lock())) current.current.undo()
      },
    }
  }
  return bridge.current
}
