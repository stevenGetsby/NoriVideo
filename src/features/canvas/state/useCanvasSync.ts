'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { canvasApi } from '../api/client'
import { canvasQueryKeys } from './keys'
import type { CanvasGraphResponse, CanvasNode, CanvasNodeData } from '../types'

const POSITION_FLUSH_MS = 400

type PendingPosition = { x: number; y: number }

export function useCanvasGraph(projectId: string, canvasId: string) {
  return useQuery<CanvasGraphResponse>({
    queryKey: canvasQueryKeys.detail(projectId, canvasId),
    queryFn: () => canvasApi.get(projectId, canvasId),
    staleTime: 30_000,
  })
}

/**
 * 综合 mutation：创建/删除节点、创建/删除边、批量提交节点位置（带防抖）。
 */
export function useCanvasMutations(projectId: string, canvasId: string) {
  const qc = useQueryClient()
  const detailKey = canvasQueryKeys.detail(projectId, canvasId)

  const invalidate = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: detailKey })
  }, [qc, detailKey])

  const createNode = useMutation({
    mutationFn: (input: {
      type: string
      position: { x: number; y: number }
      data?: CanvasNodeData
    }) => canvasApi.createNode(projectId, canvasId, input),
    onSuccess: (node) => {
      qc.setQueryData<CanvasGraphResponse>(detailKey, (prev) => {
        if (!prev) return prev
        return { ...prev, nodes: [...prev.nodes, node] }
      })
    },
  })

  const deleteNode = useMutation({
    mutationFn: (nodeId: string) => canvasApi.deleteNode(projectId, canvasId, nodeId),
    onSuccess: (_void, nodeId) => {
      qc.setQueryData<CanvasGraphResponse>(detailKey, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== nodeId),
          edges: prev.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
        }
      })
    },
  })

  const createEdge = useMutation({
    mutationFn: (input: {
      sourceNodeId: string
      targetNodeId: string
      sourceHandle?: string | null
      targetHandle?: string | null
      role?: string
    }) => canvasApi.createEdge(projectId, canvasId, input),
    onSuccess: (edge) => {
      qc.setQueryData<CanvasGraphResponse>(detailKey, (prev) => {
        if (!prev) return prev
        if (prev.edges.some((e) => e.id === edge.id)) return prev
        return { ...prev, edges: [...prev.edges, edge] }
      })
    },
  })

  const deleteEdge = useMutation({
    mutationFn: (edgeId: string) => canvasApi.deleteEdge(projectId, canvasId, edgeId),
    onSuccess: (_void, edgeId) => {
      qc.setQueryData<CanvasGraphResponse>(detailKey, (prev) => {
        if (!prev) return prev
        return { ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) }
      })
    },
  })

  const syncProduction = useMutation({
    mutationFn: () => canvasApi.syncProduction(projectId, canvasId),
    onSuccess: (graph) => {
      qc.setQueryData<CanvasGraphResponse>(detailKey, graph)
      qc.invalidateQueries({ queryKey: canvasQueryKeys.list(projectId) })
    },
  })

  return { createNode, deleteNode, createEdge, deleteEdge, syncProduction, invalidate }
}

/**
 * 节点位置批量提交：调用 enqueue(id, pos) 即可，本 hook 在 400ms 内合并提交。
 */
export function useNodePositionFlusher(projectId: string, canvasId: string) {
  const qc = useQueryClient()
  const detailKey = canvasQueryKeys.detail(projectId, canvasId)
  const pendingRef = useRef<Map<string, PendingPosition>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async () => {
    timerRef.current = null
    const pending = pendingRef.current
    if (pending.size === 0) return
    const updates = Array.from(pending.entries()).map(([id, position]) => ({ id, position }))
    pending.clear()
    try {
      await canvasApi.patchNodes(projectId, canvasId, updates)
    } catch {
      // 失败时让缓存回归服务端真值
      await qc.invalidateQueries({ queryKey: detailKey })
    }
  }, [projectId, canvasId, qc, detailKey])

  const enqueue = useCallback(
    (id: string, position: PendingPosition) => {
      pendingRef.current.set(id, position)
      // 乐观更新本地缓存，避免视觉抖动
      qc.setQueryData<CanvasGraphResponse>(detailKey, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          nodes: prev.nodes.map((n: CanvasNode) => (n.id === id ? { ...n, position } : n)),
        }
      })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, POSITION_FLUSH_MS)
    },
    [qc, detailKey, flush]
  )

  // 卸载前最后一次冲刷
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const pending = pendingRef.current
      if (pending.size === 0) return
      const updates = Array.from(pending.entries()).map(([id, position]) => ({ id, position }))
      pending.clear()
      canvasApi.patchNodes(projectId, canvasId, updates).catch(() => {
        /* best-effort; 用户已离开此画布 */
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return useMemo(() => ({ enqueue, flush }), [enqueue, flush])
}
