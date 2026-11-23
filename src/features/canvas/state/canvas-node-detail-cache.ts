import { canvasApi } from '../api/client'
import { createCanvasNodeDetailVersion, type CanvasDocumentInput, type CanvasNode } from '../types'
import { projectCanvasNodeCardData } from '@/lib/canvas/graph-summary'
import { mergeCanvasCardEdits } from './canvas-three-way-merge'

export const CANVAS_DETAIL_CACHE_MAX_NODES = 24
export const CANVAS_DETAIL_CACHE_MAX_BYTES = 16 * 1024 * 1024
export const CANVAS_DETAIL_CACHE_CONCURRENCY = 4

type Scope = { accountId: string; projectId: string; canvasId: string }
type Entry = { node: CanvasNode; detailVersion: string; bytes: number }
type FetchDetail = (projectId: string, canvasId: string, nodeId: string, signal?: AbortSignal) => Promise<{ detailVersion: string; node: CanvasNode }>

const byteLength = (node: CanvasNode) => JSON.stringify(node).length * 2

/** An unhydrated summary may be moved or deleted, but never serialized as a full node. */
export function assertCanvasNodeHydrated(node: Pick<CanvasNode, 'id' | 'data'>, action = 'write') {
  if (node.data?.__canvasUnhydrated === true) {
    throw new Error(`节点 ${node.id} 尚未加载完整内容，不能执行 ${action}。`)
  }
  return node
}

export async function hydrateCanvasDocumentForWrite(
  document: CanvasDocumentInput,
  loadDetail: (node: CanvasNode) => Promise<CanvasNode>,
  confirmed?: CanvasDocumentInput | null,
): Promise<CanvasDocumentInput> {
  const summaries = document.nodes.filter((node) => node.data?.__canvasUnhydrated === true)
  if (!summaries.length) return document
  const confirmedById = confirmed ? new Map(confirmed.nodes.map((node) => [node.id, node])) : null
  const details = await Promise.all(summaries.map(async (node) => {
    const detail = await loadDetail(node)
    const { detailVersion: _detailVersion, ...hydrated } = detail as CanvasNode & { detailVersion?: string }
    void _detailVersion
    const base = confirmedById?.get(node.id)
    if (confirmedById && !base) throw new Error(`节点 ${node.id} 缺少已确认的摘要基线，不能写入。`)
    const data = base
      ? mergeCanvasCardEdits(projectCanvasNodeCardData(base.data), projectCanvasNodeCardData(node.data), detail.data)
      : detail.data
    return { ...hydrated, position: node.position, size: node.size, data }
  }))
  const byId = new Map(details.map((node) => [node.id, node]))
  return { ...document, nodes: document.nodes.map((node) => byId.get(node.id) || node) }
}

/**
 * Bounded, account/project/canvas/version-isolated detail reads. Eviction and
 * cancellation happen outside React so a large canvas can share in-flight reads.
 */
export class CanvasNodeDetailCache {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly fetchDetail: FetchDetail = canvasApi.getNodeDetail) {}

  static key(scope: Scope, nodeId: string, detailVersion: string) {
    return JSON.stringify([scope.accountId, scope.projectId, scope.canvasId, nodeId, detailVersion])
  }

  get(scope: Scope, node: Pick<CanvasNode, 'id' | 'data'> & Partial<Pick<CanvasNode, 'status' | 'taskId' | 'runId' | 'mediaObjectId' | 'parentNodeId'>> & { detailVersion?: string }) {
    const detailVersion = node.detailVersion || createCanvasNodeDetailVersion({
      data: node.data,
      status: node.status || 'IDLE',
      taskId: node.taskId ?? null,
      runId: node.runId ?? null,
      mediaObjectId: node.mediaObjectId ?? null,
      parentNodeId: node.parentNodeId ?? null,
    })
    const key = CanvasNodeDetailCache.key(scope, node.id, detailVersion)
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.node
  }

  invalidate(scope: Scope, nodeId?: string) {
    const prefix = JSON.stringify([scope.accountId, scope.projectId, scope.canvasId]).slice(0, -1)
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix) || (nodeId && !key.includes(`,${JSON.stringify(nodeId)},`))) continue
      this.entries.delete(key)
      this.bytes -= entry.bytes
    }
  }

  async load(scope: Scope, nodeId: string, signal?: AbortSignal): Promise<CanvasNode> {
    await this.acquire(signal)
    try {
      const response = await this.fetchDetail(scope.projectId, scope.canvasId, nodeId, signal)
      const key = CanvasNodeDetailCache.key(scope, nodeId, response.detailVersion)
      const entry = { node: { ...response.node, detailVersion: response.detailVersion } as CanvasNode & { detailVersion: string }, detailVersion: response.detailVersion, bytes: byteLength(response.node) }
      const previous = this.entries.get(key)
      if (previous) this.bytes -= previous.bytes
      this.entries.set(key, entry)
      this.bytes += entry.bytes
      while (this.entries.size > CANVAS_DETAIL_CACHE_MAX_NODES || this.bytes > CANVAS_DETAIL_CACHE_MAX_BYTES) {
        const oldest = this.entries.keys().next().value as string | undefined
        if (!oldest || oldest === key) break
        this.bytes -= this.entries.get(oldest)?.bytes ?? 0
        this.entries.delete(oldest)
      }
      return entry.node
    } finally {
      this.release()
    }
  }

  private async acquire(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (this.active < CANVAS_DETAIL_CACHE_CONCURRENCY) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener('abort', abort)
        this.active += 1
        resolve()
      }
      const abort = () => {
        const index = this.queue.indexOf(start)
        if (index >= 0) this.queue.splice(index, 1)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      this.queue.push(start)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }

  private release() {
    this.active -= 1
    this.queue.shift()?.()
  }
}
