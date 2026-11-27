import type { CanvasDocumentInput, CanvasOperation } from '../types'
import { applyCanvasOperationsToDocument, isCanvasOperationArray } from './canvas-operations'
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  isCompatibleCanvasDocumentSchemaVersion,
} from '@/lib/canvas/document-version'

const CANVAS_OFFLINE_DB_NAME = 'nori-canvas-offline-v1'
const CANVAS_OFFLINE_STORE_NAME = 'pending_documents'
const CANVAS_OFFLINE_SCHEMA_VERSION = 1 as const
const CANVAS_GEOMETRY_DRAFT_VERSION = 2 as const

export type CanvasOfflineNamespace = {
  accountId: string
  projectId: string
  canvasId: string
}

export type CanvasOfflineDraft = {
  key: string
  schema_version: typeof CANVAS_OFFLINE_SCHEMA_VERSION | typeof CANVAS_GEOMETRY_DRAFT_VERSION
  namespace: CanvasOfflineNamespace
  document: CanvasDocumentInput
  pendingOps: CanvasOperation[]
  lastServerRevision: number
  baseRevision: number
  dirty: true
  retryAttempt: number
  lastError: string | null
  updatedAt: number
}

export interface CanvasOfflineDraftStore {
  get: (key: string) => Promise<unknown>
  put: (draft: CanvasOfflineDraft) => Promise<void>
  delete: (key: string) => Promise<void>
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function cleanNamespace(value: CanvasOfflineNamespace): CanvasOfflineNamespace {
  return {
    accountId: value.accountId.trim(),
    projectId: value.projectId.trim(),
    canvasId: value.canvasId.trim(),
  }
}

function validNamespace(value: unknown): value is CanvasOfflineNamespace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const namespace = value as Partial<CanvasOfflineNamespace>
  return typeof namespace.accountId === 'string'
    && Boolean(namespace.accountId.trim())
    && typeof namespace.projectId === 'string'
    && Boolean(namespace.projectId.trim())
    && typeof namespace.canvasId === 'string'
    && Boolean(namespace.canvasId.trim())
}

export function canvasOfflineDraftKey(namespace: CanvasOfflineNamespace): string {
  const clean = cleanNamespace(namespace)
  return [
    'canvas-draft-v1',
    encodeURIComponent(clean.accountId),
    encodeURIComponent(clean.projectId),
    encodeURIComponent(clean.canvasId),
  ].join(':')
}

function validDocument(value: unknown): value is CanvasDocumentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const document = value as Partial<CanvasDocumentInput>
  const viewport = document.viewport
  return isCompatibleCanvasDocumentSchemaVersion(document.schema_version)
    && Number.isSafeInteger(document.expectedRevision)
    && (document.expectedRevision as number) >= 0
    && typeof document.clientId === 'string'
    && Boolean(document.clientId.trim())
    && Boolean(viewport)
    && Number.isFinite(viewport?.x)
    && Number.isFinite(viewport?.y)
    && Number.isFinite(viewport?.zoom)
    && Array.isArray(document.nodes)
    && Array.isArray(document.edges)
}

export function createCanvasOfflineDraft({
  namespace,
  document,
  pendingOps = [],
  lastServerRevision = document.expectedRevision,
  retryAttempt = 0,
  lastError = null,
  updatedAt = Date.now(),
  copy = true,
}: {
  namespace: CanvasOfflineNamespace
  document: CanvasDocumentInput
  pendingOps?: CanvasOperation[]
  lastServerRevision?: number
  retryAttempt?: number
  lastError?: string | null
  updatedAt?: number
  /** False borrows the immutable editor state; IndexedDB structured-clones it on write anyway. */
  copy?: boolean
}): CanvasOfflineDraft {
  const clean = cleanNamespace(namespace)
  if (!clean.accountId || !clean.projectId || !clean.canvasId) {
    throw new Error('Canvas offline draft namespace is incomplete')
  }
  const normalizedRetryAttempt = Number.isFinite(retryAttempt)
    ? Math.max(0, Math.floor(retryAttempt))
    : 0
  return {
    key: canvasOfflineDraftKey(clean),
    schema_version: CANVAS_OFFLINE_SCHEMA_VERSION,
    namespace: clean,
    document: { ...(copy ? clone(document) : document), schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION },
    pendingOps: copy ? clone(pendingOps) : pendingOps,
    lastServerRevision: Number.isSafeInteger(lastServerRevision) && lastServerRevision >= 0
      ? lastServerRevision
      : document.expectedRevision,
    baseRevision: document.expectedRevision,
    dirty: true,
    retryAttempt: normalizedRetryAttempt,
    lastError: typeof lastError === 'string' && lastError.trim() ? lastError.trim().slice(0, 1_000) : null,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  }
}

type GeometryDraftOperation = Extract<CanvasOperation, { type: 'node.update_geometry' | 'canvas.update_meta' }>

function isGeometryDraft(operations: CanvasOperation[]): operations is GeometryDraftOperation[] {
  let moved = false
  for (const operation of operations) {
    if (operation.type === 'node.update_geometry') {
      const { position, size, id } = operation
      if (!id || (!position && !size)) return false
      if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y))) return false
      if (size && (!Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0)) return false
      moved = true
    } else if (operation.type === 'canvas.update_meta' && operation.viewport && operation.title === undefined && operation.themeColor === undefined) {
      const { x, y, zoom } = operation.viewport
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) return false
    } else return false
  }
  return moved
}

function geometryDraftKey(namespace: CanvasOfflineNamespace) {
  return `${canvasOfflineDraftKey(namespace)}:geometry-v2`
}

export function isCanvasGeometryOfflineDraft(draft: CanvasOfflineDraft) {
  return draft.schema_version === CANVAS_GEOMETRY_DRAFT_VERSION
}

/** Geometry only: no history, media, node bodies, edge payloads, or detail requests. */
export function createCanvasGeometryOfflineDraft({
  namespace, base, operations, retryAttempt, lastError,
}: {
  namespace: CanvasOfflineNamespace
  base: CanvasDocumentInput
  operations: CanvasOperation[]
  retryAttempt?: number
  lastError?: string | null
}): CanvasOfflineDraft | null {
  if (!isGeometryDraft(operations)) return null
  const metadata = createCanvasOfflineDraft({
    namespace, document: { ...base, nodes: [], edges: [] }, pendingOps: operations, retryAttempt, lastError, copy: false,
  })
  // Old tabs do not recognize this key and must not interpret a sparse draft
  // as an entire canvas awaiting a full-document write.
  return { ...metadata, key: geometryDraftKey(namespace), schema_version: CANVAS_GEOMETRY_DRAFT_VERSION }
}

export function parseCanvasOfflineDraft(
  value: unknown,
  namespace: CanvasOfflineNamespace,
): CanvasOfflineDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<CanvasOfflineDraft> & { schemaVersion?: unknown }
  const storedSchemaVersion = source.schema_version ?? source.schemaVersion
  const geometryOnly = storedSchemaVersion === CANVAS_GEOMETRY_DRAFT_VERSION
  const expectedKey = canvasOfflineDraftKey(namespace)
  if (source.key !== (geometryOnly ? geometryDraftKey(namespace) : expectedKey) || source.dirty !== true) return null
  if (storedSchemaVersion !== undefined && storedSchemaVersion !== CANVAS_OFFLINE_SCHEMA_VERSION && !geometryOnly) return null
  if (!validNamespace(source.namespace) || canvasOfflineDraftKey(source.namespace) !== expectedKey) return null
  if (!validDocument(source.document)) return null
  if (!Number.isSafeInteger(source.baseRevision) || source.baseRevision !== source.document.expectedRevision) return null
  const pendingOps = source.pendingOps === undefined ? [] : source.pendingOps
  const lastServerRevision = source.lastServerRevision === undefined
    ? source.document.expectedRevision
    : source.lastServerRevision
  if (!isCanvasOperationArray(pendingOps)) return null
  if (geometryOnly && (!isGeometryDraft(pendingOps) || source.document.nodes.length || source.document.edges.length)) return null
  if (!Number.isSafeInteger(lastServerRevision) || (lastServerRevision as number) < 0) return null
  if (!Number.isFinite(source.updatedAt) || (source.updatedAt as number) <= 0) return null
  const draft = createCanvasOfflineDraft({
    namespace,
    document: source.document,
    pendingOps,
    lastServerRevision: lastServerRevision as number,
    retryAttempt: source.retryAttempt,
    lastError: source.lastError,
    updatedAt: source.updatedAt,
  })
  return geometryOnly ? { ...draft, key: geometryDraftKey(namespace), schema_version: CANVAS_GEOMETRY_DRAFT_VERSION } : draft
}

export async function loadCanvasOfflineDraft(
  namespace: CanvasOfflineNamespace,
  store: CanvasOfflineDraftStore = browserCanvasOfflineDraftStore,
): Promise<CanvasOfflineDraft | null> {
  const values = await Promise.all([store.get(canvasOfflineDraftKey(namespace)), store.get(geometryDraftKey(namespace))])
  const drafts = values.map((value) => parseCanvasOfflineDraft(value, namespace)).filter((draft) => draft !== null)
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
}

export async function saveCanvasOfflineDraft(
  draft: CanvasOfflineDraft,
  store: CanvasOfflineDraftStore = browserCanvasOfflineDraftStore,
): Promise<void> {
  await store.put(draft)
}

export async function deleteCanvasOfflineDraft(
  namespace: CanvasOfflineNamespace,
  store: CanvasOfflineDraftStore = browserCanvasOfflineDraftStore,
): Promise<void> {
  await Promise.all([store.delete(canvasOfflineDraftKey(namespace)), store.delete(geometryDraftKey(namespace))])
}

export type CanvasOfflineRecoveryChoice = 'local' | 'server'

export function resolveCanvasOfflineRecoveryChoice({
  draft,
  choice,
  serverRevision,
  clientId,
  currentDocument,
}: {
  draft: CanvasOfflineDraft
  choice: CanvasOfflineRecoveryChoice
  serverRevision: number
  clientId: string
  currentDocument?: CanvasDocumentInput
}): CanvasDocumentInput | null {
  if (choice === 'server') return null
  if (isCanvasGeometryOfflineDraft(draft)) {
    if (!currentDocument || !isGeometryDraft(draft.pendingOps)) throw new Error('缺少可供恢复的画布及几何草稿。')
    const byId = new Map(currentDocument.nodes.map((node) => [node.id, node]))
    let viewport = currentDocument.viewport
    for (const operation of draft.pendingOps) {
      if (operation.type === 'canvas.update_meta') {
        if (operation.viewport) viewport = operation.viewport
        continue
      }
      const node = byId.get(operation.id)
      if (!node) throw new Error(`本地草稿所移动的节点已不存在，无法恢复该批移动。`)
      byId.set(operation.id, {
        ...node,
        ...(operation.position ? { position: operation.position } : {}),
        ...(operation.size ? { size: operation.size } : {}),
      })
    }
    return { ...currentDocument, nodes: [...byId.values()], viewport, expectedRevision: serverRevision, clientId, changeSummary: '恢复本地未同步版本' }
  }
  // Non-geometry drafts: replay the pending operations on the latest server
  // document instead of overwriting with the whole local snapshot. This prevents
  // a stale draft from deleting server-side nodes/edges it does not know about.
  if (!currentDocument) throw new Error('缺少可供恢复的服务器画布文档。')
  const replayed = applyCanvasOperationsToDocument(currentDocument, draft.pendingOps, clientId, '恢复本地未同步版本')
  return { ...replayed, expectedRevision: serverRevision }
}

export function createMemoryCanvasOfflineDraftStore(
  initial: CanvasOfflineDraft[] = [],
  { copyOnPut = true }: { copyOnPut?: boolean } = {},
): CanvasOfflineDraftStore & { size: () => number } {
  const rows = new Map(initial.map((draft) => [draft.key, clone(draft)]))
  return {
    async get(key) {
      const value = rows.get(key)
      return value ? clone(value) : undefined
    },
    async put(draft) {
      rows.set(draft.key, copyOnPut ? clone(draft) : draft)
    },
    async delete(key) {
      rows.delete(key)
    },
    size: () => rows.size,
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

let databasePromise: Promise<IDBDatabase> | null = null

function openCanvasOfflineDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(CANVAS_OFFLINE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(CANVAS_OFFLINE_STORE_NAME)) {
        database.createObjectStore(CANVAS_OFFLINE_STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error || new Error('Unable to open canvas offline database'))
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('Canvas offline database upgrade is blocked'))
    }
  })
  return databasePromise
}

const indexedDbCanvasOfflineDraftStore: CanvasOfflineDraftStore = {
  async get(key) {
    const database = await openCanvasOfflineDatabase()
    const transaction = database.transaction(CANVAS_OFFLINE_STORE_NAME, 'readonly')
    const completed = transactionComplete(transaction)
    const value = await requestValue(transaction.objectStore(CANVAS_OFFLINE_STORE_NAME).get(key))
    await completed
    return value
  },
  async put(draft) {
    const database = await openCanvasOfflineDatabase()
    const transaction = database.transaction(CANVAS_OFFLINE_STORE_NAME, 'readwrite')
    const completed = transactionComplete(transaction)
    transaction.objectStore(CANVAS_OFFLINE_STORE_NAME).put(draft)
    await completed
  },
  async delete(key) {
    const database = await openCanvasOfflineDatabase()
    const transaction = database.transaction(CANVAS_OFFLINE_STORE_NAME, 'readwrite')
    const completed = transactionComplete(transaction)
    transaction.objectStore(CANVAS_OFFLINE_STORE_NAME).delete(key)
    await completed
  },
}

// Drafts are never mutated after creation, so the mirror can hold them without another copy.
const volatileFallbackStore = createMemoryCanvasOfflineDraftStore([], { copyOnPut: false })

/**
 * IndexedDB is the durable source. The in-memory mirror only protects the
 * current tab when a restricted browser context rejects IndexedDB; it never
 * serializes a canvas document into localStorage.
 */
export const browserCanvasOfflineDraftStore: CanvasOfflineDraftStore = {
  async get(key) {
    try {
      const value = await indexedDbCanvasOfflineDraftStore.get(key)
      if (value) return value
    } catch {
      // Fall through to the volatile mirror.
    }
    return await volatileFallbackStore.get(key)
  },
  async put(draft) {
    await volatileFallbackStore.put(draft)
    try {
      await indexedDbCanvasOfflineDraftStore.put(draft)
    } catch {
      // Keep the current-tab copy; callers can continue editing and retrying.
    }
  },
  async delete(key) {
    await volatileFallbackStore.delete(key)
    try {
      await indexedDbCanvasOfflineDraftStore.delete(key)
    } catch {
      // The durable store may be unavailable; the current tab is still clean.
    }
  },
}
