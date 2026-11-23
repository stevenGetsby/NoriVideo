import { apiFetch } from '@/lib/api-fetch'
import { CANVAS_DELTA_RESPONSE_HEADER } from '../types'
import type {
  Canvas,
  CanvasGraphDelta,
  CanvasGraphResponse,
  CanvasGraphSummaryV1,
  CanvasNodeDetailV1,
  CanvasNodeHistoryItemV1,
  CanvasNodeHistoryV1,
  CanvasListResponse,
  CanvasDocumentInput,
  CanvasOperationsInput,
  CanvasRevision,
  Viewport,
} from '../types'

async function postOperations(
  projectId: string,
  canvasId: string,
  input: CanvasOperationsInput,
  delta = false,
): Promise<Response> {
  const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/ops`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(delta ? { [CANVAS_DELTA_RESPONSE_HEADER]: 'delta' } : {}),
    },
    body: JSON.stringify(input),
  })
  if (res.status === 409) {
    const payload: unknown = await res.json().catch(() => null)
    throw new CanvasRevisionConflictError(readApiErrorMessage(payload) || undefined, readActualRevision(payload))
  }
  return res
}

export class CanvasRevisionConflictError extends Error {
  readonly status = 409
  readonly actualRevision: number | null

  constructor(message = '画布已在其他标签页更新', actualRevision: number | null = null) {
    super(message)
    this.name = 'CanvasRevisionConflictError'
    this.actualRevision = actualRevision
  }
}

function readApiErrorMessage(detail: unknown): string | null {
  const payload = detail && typeof detail === 'object' && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : null
  const error = payload?.error
  const nestedMessage = error && typeof error === 'object' && !Array.isArray(error)
    ? (error as Record<string, unknown>).message
    : null
  return (
    (typeof nestedMessage === 'string' && nestedMessage.trim()) ||
    (typeof error === 'string' && error.trim()) ||
    (typeof payload?.message === 'string' && payload.message.trim()) ||
    null
  )
}

function readActualRevision(detail: unknown): number | null {
  const payload = detail && typeof detail === 'object' && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : null
  const error = payload?.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
    ? payload.error as Record<string, unknown>
    : null
  const details = error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details as Record<string, unknown>
    : null
  const value = details?.actualRevision ?? payload?.actualRevision
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown = null
    try {
      detail = await res.json()
    } catch {
      /* ignore */
    }
    const msg = readApiErrorMessage(detail) || `Canvas API ${res.status}`
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

  getSummary: async (projectId: string, canvasId: string, signal?: AbortSignal): Promise<CanvasGraphSummaryV1> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}?view=summary-v1`, { signal })
    return asJson<CanvasGraphSummaryV1>(res)
  },

  getNodeDetail: async (projectId: string, canvasId: string, nodeId: string, signal?: AbortSignal): Promise<CanvasNodeDetailV1> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/nodes/${encodeURIComponent(nodeId)}?view=detail-v1`, { signal })
    return asJson<CanvasNodeDetailV1>(res)
  },

  getNodeHistory: async (projectId: string, canvasId: string, nodeId: string, options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}): Promise<CanvasNodeHistoryV1> => {
    const query = new URLSearchParams({ view: 'history-v1', limit: String(options.limit ?? 20) })
    if (options.cursor) query.set('cursor', options.cursor)
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/nodes/${encodeURIComponent(nodeId)}?${query}`, { signal: options.signal })
    return asJson<CanvasNodeHistoryV1>(res)
  },

  getNodeHistoryItem: async (projectId: string, canvasId: string, nodeId: string, entryId: string, signal?: AbortSignal): Promise<CanvasNodeHistoryItemV1> => {
    const query = new URLSearchParams({ view: 'history-item-v1', entryId })
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/nodes/${encodeURIComponent(nodeId)}?${query}`, { signal })
    return asJson<CanvasNodeHistoryItemV1>(res)
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

  saveDocument: async (
    projectId: string,
    canvasId: string,
    input: CanvasDocumentInput,
  ): Promise<CanvasGraphResponse> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/document`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 409) {
      const payload: unknown = await res.json().catch(() => null)
      throw new CanvasRevisionConflictError(readApiErrorMessage(payload) || undefined, readActualRevision(payload))
    }
    return asJson<CanvasGraphResponse>(res)
  },

  saveOperations: async (
    projectId: string,
    canvasId: string,
    input: CanvasOperationsInput,
  ): Promise<CanvasGraphResponse> => {
    for (const operation of input.ops) {
      if (operation.type === 'node.upsert' && operation.node.data?.__canvasUnhydrated === true) {
        throw new Error(`节点 ${operation.node.id} 尚未加载完整内容，不能保存。`)
      }
    }
    const res = await postOperations(projectId, canvasId, input)
    return asJson<CanvasGraphResponse>(res)
  },

  saveOperationsDelta: async (
    projectId: string,
    canvasId: string,
    input: CanvasOperationsInput,
  ): Promise<CanvasGraphDelta> => {
    for (const operation of input.ops) {
      if (operation.type === 'node.upsert' && operation.node.data?.__canvasUnhydrated === true) {
        throw new Error(`节点 ${operation.node.id} 尚未加载完整内容，不能保存。`)
      }
    }
    const res = await postOperations(projectId, canvasId, input, true)
    return asJson<CanvasGraphDelta>(res)
  },

  listRevisions: async (
    projectId: string,
    canvasId: string,
  ): Promise<CanvasRevision[]> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/revisions`)
    const payload = await asJson<{ revisions: CanvasRevision[] }>(res)
    return payload.revisions
  },

  restoreRevision: async (
    projectId: string,
    canvasId: string,
    input: { snapshotId: string; expectedRevision: number; clientId: string },
  ): Promise<CanvasGraphResponse> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 409) {
      const payload: unknown = await res.json().catch(() => null)
      throw new CanvasRevisionConflictError(readApiErrorMessage(payload) || undefined, readActualRevision(payload))
    }
    return asJson<CanvasGraphResponse>(res)
  },

  syncProduction: async (
    projectId: string,
    canvasId: string,
    input: { expectedRevision: number; clientId: string },
  ): Promise<CanvasGraphResponse> => {
    const res = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/production-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 409) {
      const payload: unknown = await res.json().catch(() => null)
      throw new CanvasRevisionConflictError(readApiErrorMessage(payload) || undefined, readActualRevision(payload))
    }
    return asJson<CanvasGraphResponse>(res)
  },
}
