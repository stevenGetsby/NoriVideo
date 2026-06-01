'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { NoteNode } from './nodes/NoteNode'
import { ProductionNode } from './nodes/ProductionNode'
import {
  CANVAS_NODE_TYPE_NOTE,
  CANVAS_NODE_TYPE_PRODUCTION_EPISODE,
  CANVAS_NODE_TYPE_PRODUCTION_PANEL,
  CANVAS_NODE_TYPE_PRODUCTION_STORYBOARD,
  CANVAS_NODE_TYPE_PRODUCTION_VIDEO,
} from './types'
import type { CanvasEdge, CanvasNode } from './types'
import { useCanvasGraph, useCanvasMutations, useNodePositionFlusher } from './state/useCanvasSync'

const nodeTypes = {
  [CANVAS_NODE_TYPE_NOTE]: NoteNode,
  [CANVAS_NODE_TYPE_PRODUCTION_EPISODE]: ProductionNode,
  [CANVAS_NODE_TYPE_PRODUCTION_STORYBOARD]: ProductionNode,
  [CANVAS_NODE_TYPE_PRODUCTION_PANEL]: ProductionNode,
  [CANVAS_NODE_TYPE_PRODUCTION_VIDEO]: ProductionNode,
} as const

type Props = {
  projectId: string
  canvasId: string
}

function CanvasGraphInner({ projectId, canvasId }: Props) {
  const graphQuery = useCanvasGraph(projectId, canvasId)
  const { createNode, deleteNode, createEdge, deleteEdge, syncProduction } = useCanvasMutations(projectId, canvasId)
  const { enqueue } = useNodePositionFlusher(projectId, canvasId)
  const autoSyncedRef = useRef(false)

  useEffect(() => {
    if (!graphQuery.data) return
    if (autoSyncedRef.current) return
    const hasProductionNode = graphQuery.data.nodes.some((node) => node.type.startsWith('production_'))
    if (!hasProductionNode && !syncProduction.isPending) {
      autoSyncedRef.current = true
      syncProduction.mutate()
    }
  }, [graphQuery.data, syncProduction])

  // 本地节点/边状态由 ReactFlow 维护渲染，但真值始终来自 React Query 缓存。
  // 我们把 query 数据映射成 ReactFlow Node[] / Edge[]，所有变更同步回服务端。
  const nodes: Node[] = useMemo(() => {
    if (!graphQuery.data) return []
    return graphQuery.data.nodes.map((n: CanvasNode) => ({
      id: n.id,
      type: n.type,
      position: n.position,
        data: n.data ?? {},
    }))
  }, [graphQuery.data])

  const edges: Edge[] = useMemo(() => {
    if (!graphQuery.data) return []
    return graphQuery.data.edges.map((e: CanvasEdge) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    }))
  }, [graphQuery.data])

  // 跟踪当前正在拖拽节点（避免每帧网络请求）：drag 中只更新本地缓存；drag 结束后入队提交。
  const draggingRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 本地用 applyNodeChanges 仅作类型保留；真实状态来自 graphQuery。
      // 由于 nodes 是 useMemo 派生，不能直接 setNodes，所以我们只关注 position 变化与 remove。
      const next = applyNodeChanges(changes, nodes)
      void next // 仅作类型对齐

      for (const change of changes) {
        if (change.type === 'position' && change.position && change.id) {
          draggingRef.current.set(change.id, change.position)
          if (change.dragging === false) {
            // 拖拽结束：入队批量提交
            const pos = draggingRef.current.get(change.id)
            if (pos) {
              enqueue(change.id, pos)
            }
            draggingRef.current.delete(change.id)
          } else {
            // 拖拽中：乐观更新本地缓存以保持流畅
            enqueue(change.id, change.position)
          }
        } else if (change.type === 'remove') {
          deleteNode.mutate(change.id)
        }
      }
    },
    [nodes, enqueue, deleteNode]
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, edges)
      void next
      for (const change of changes) {
        if (change.type === 'remove') {
          deleteEdge.mutate(change.id)
        }
      }
    },
    [edges, deleteEdge]
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      if (connection.source === connection.target) return
      createEdge.mutate({
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      })
    },
    [createEdge]
  )

  // 双击空白处创建 NoteNode（M0 仅 note 类型）
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement | null
      // 仅在画布背景上响应
      if (!target?.classList?.contains('react-flow__pane')) return
      const bounds = wrapperRef.current?.getBoundingClientRect()
      if (!bounds) return
      const offsetX = event.clientX - bounds.left
      const offsetY = event.clientY - bounds.top
      createNode.mutate({
        type: CANVAS_NODE_TYPE_NOTE,
        position: { x: offsetX, y: offsetY },
        data: { text: '' },
      })
    },
    [createNode]
  )

  // 工具栏按钮：在视图中心附近创建一个 note 节点（避免新手不知道双击交互）
  const handleAddNoteFromToolbar = useCallback(() => {
    const bounds = wrapperRef.current?.getBoundingClientRect()
    const cx = bounds ? bounds.width / 2 : 200
    const cy = bounds ? bounds.height / 2 : 200
    // 每次稍微偏移避免堆叠
    const jitter = () => Math.floor(Math.random() * 60) - 30
    createNode.mutate({
      type: CANVAS_NODE_TYPE_NOTE,
      position: { x: cx + jitter(), y: cy + jitter() },
      data: { text: '' },
    })
  }, [createNode])

  // 加载/错误态
  if (graphQuery.isLoading) {
    return <div style={{ padding: 24 }}>Loading canvas…</div>
  }
  if (graphQuery.error) {
    return <div style={{ padding: 24, color: '#b91c1c' }}>Failed to load canvas: {String(graphQuery.error)}</div>
  }

  return (
    <div
      ref={wrapperRef}
      onDoubleClick={handlePaneDoubleClick}
      style={{ width: '100%', height: '100%' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        defaultViewport={
          graphQuery.data?.canvas.viewport ?? { x: 0, y: 0, zoom: 1 }
        }
        fitView={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls position="bottom-right" />
        <MiniMap pannable zoomable />
        <Panel position="top-left">
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '8px 10px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.86)',
              border: '1px solid rgba(148,163,184,0.34)',
              boxShadow: '0 10px 24px rgba(15,23,42,0.12)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <button
              type="button"
              onClick={handleAddNoteFromToolbar}
              style={{
                background: '#fde68a',
                border: '1px solid #f59e0b',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                color: '#78350f',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
              }}
            >
              + 便签
            </button>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              生产画布 · 拖动画面整理结构 · 选中按 Delete 删除自由节点
            </span>
            <button
              type="button"
              onClick={() => syncProduction.mutate()}
              disabled={syncProduction.isPending}
              style={{
                background: syncProduction.isPending ? '#e2e8f0' : '#0f172a',
                border: '1px solid rgba(15,23,42,0.14)',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                color: syncProduction.isPending ? '#64748b' : '#fff',
                cursor: syncProduction.isPending ? 'wait' : 'pointer',
              }}
            >
              {syncProduction.isPending ? '同步中' : '同步项目'}
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}

/**
 * 外层 Provider 隔离，便于在同一页面挂多个画布。
 */
export default function CanvasGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasGraphInner {...props} />
    </ReactFlowProvider>
  )
}
