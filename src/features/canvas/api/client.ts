import { apiFetch } from '@/lib/api-fetch'
import type {
  Canvas,
  CanvasEdge,
  CanvasGraphResponse,
  CanvasListResponse,
  CanvasNode,
  CanvasNodeData,
  Viewport,
} from '../types'

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown = null
    try {
      detail = await res.json()
    } catch {
      /* ignore */
    }
    const msg =
      detail && typeof detail === 'object' && 'error' in detail && typeof (detail as { error?: unknown }).error === 'string'
        ? (detail as { error: string }).error
        : `Canvas API ${res.status}`
    throw new Error(msg)
  }
  return (await res.json()) as T
}

export const canvasApi = {
  list: async (projectId: string): Promise<Canvas[]> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas`)
    const json = await asJson<CanvasListResponse>(res)
    return json.canvases
  },

  create: async (projectId: string, input: { title: string; themeColor?: string }): Promise<Canvas> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const json = await asJson<{ canvas: Canvas }>(res)
    return json.canvas
  },

  get: async (projectId: string, canvasId: string): Promise<CanvasGraphResponse> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}`)
    return asJson<CanvasGraphResponse>(res)
  },

  patch: async (
    projectId: string,
    canvasId: string,
    input: { title?: string; themeColor?: string | null; viewport?: Viewport }
  ): Promise<Canvas> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const json = await asJson<{ canvas: Canvas }>(res)
    return json.canvas
  },

  remove: async (projectId: string, canvasId: string): Promise<void> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}`, { method: 'DELETE' })
    await asJson<{ success: boolean }>(res)
  },

  syncProduction: async (projectId: string, canvasId: string): Promise<CanvasGraphResponse> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/production-sync`, {
      method: 'POST',
    })
    return asJson<CanvasGraphResponse>(res)
  },

  createNode: async (
    projectId: string,
    canvasId: string,
    input: {
      type: string
      position: { x: number; y: number }
      size?: { width: number; height: number } | null
      data?: CanvasNodeData
      parentNodeId?: string | null
    }
  ): Promise<CanvasNode> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const json = await asJson<{ node: CanvasNode }>(res)
    return json.node
  },

  patchNodes: async (
    projectId: string,
    canvasId: string,
    updates: Array<{
      id: string
      position?: { x: number; y: number }
      size?: { width: number; height: number }
      data?: CanvasNodeData
    }>
  ): Promise<void> => {
    if (updates.length === 0) return
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/nodes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    await asJson<{ updated: number }>(res)
  },

  deleteNode: async (projectId: string, canvasId: string, nodeId: string): Promise<void> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/nodes/${nodeId}`, { method: 'DELETE' })
    await asJson<{ success: boolean }>(res)
  },

  createEdge: async (
    projectId: string,
    canvasId: string,
    input: {
      sourceNodeId: string
      targetNodeId: string
      sourceHandle?: string | null
      targetHandle?: string | null
      role?: string
    }
  ): Promise<CanvasEdge> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const json = await asJson<{ edge: CanvasEdge }>(res)
    return json.edge
  },

  deleteEdge: async (projectId: string, canvasId: string, edgeId: string): Promise<void> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/edges/${edgeId}`, { method: 'DELETE' })
    await asJson<{ success: boolean }>(res)
  },
}
