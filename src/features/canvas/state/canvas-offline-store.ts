import type { CanvasDocumentInput, CanvasOperation } from '../types'
import { isCanvasOperationArray } from './canvas-operations'
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  isCompatibleCanvasDocumentSchemaVersion,
} from '@/lib/canvas/document-version'

const CANVAS_OFFLINE_DB_NAME = 'nori-canvas-offline-v1'
const CANVAS_OFFLINE_STORE_NAME = 'pending_documents'
const CANVAS_OFFLINE_SCHEMA_VERSION = 1 as const

export type CanvasOfflineNamespace = {
  accountId: string
  projectId: string
  canvasId: string
}

export type CanvasOfflineDraft = {
  key: string
  schema_version: typeof CANVAS_OFFLINE_SCHEMA_VERSION
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
}: {
  namespace: CanvasOfflineNamespace
  document: CanvasDocumentInput
  pendingOps?: CanvasOperation[]
  lastServerRevision?: number
  retryAttempt?: number
  lastError?: string | null
  updatedAt?: number
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
    document: { ...clone(document), schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION },
    pendingOps: clone(pendingOps),
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

export function parseCanvasOfflineDraft(
  value: unknown,
  namespace: CanvasOfflineNamespace,
): CanvasOfflineDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<CanvasOfflineDraft> & { schemaVersion?: unknown }
  const expectedKey = canvasOfflineDraftKey(namespace)
  const storedSchemaVersion = source.schema_version ?? source.schemaVersion
  if (source.key !== expectedKey || (storedSchemaVersion !== undefined && storedSchemaVersion !== CANVAS_OFFLINE_SCHEMA_VERSION) || source.dirty !== true) return null
  if (!validNamespace(source.namespace) || canvasOfflineDraftKey(source.namespace) !== expectedKey) return null
  if (!validDocument(source.document)) return null
  if (!Number.isSafeInteger(source.baseRevision) || source.baseRevision !== source.document.expectedRevision) return null
  const pendingOps = source.pendingOps === undefined ? [] : source.pendingOps
  const lastServerRevision = source.lastServerRevision === undefined
    ? source.document.expectedRevision
    : source.lastServerRevision
  if (!isCanvasOperationArray(pendingOps)) return null
  if (!Number.isSafeInteger(lastServerRevision) || (lastServerRevision as number) < 0) return null
  if (!Number.isFinite(source.updatedAt) || (source.updatedAt as number) <= 0) return null
  return createCanvasOfflineDraft({
    namespace,
    document: source.document,
    pendingOps,
    lastServerRevision: lastServerRevision as number,
    retryAttempt: source.retryAttempt,
    lastError: source.lastError,
    updatedAt: source.updatedAt,
  })
}

export async function loadCanvasOfflineDraft(
  namespace: CanvasOfflineNamespace,
  store: CanvasOfflineDraftStore = browserCanvasOfflineDraftStore,
): Promise<CanvasOfflineDraft | null> {
  const value = await store.get(canvasOfflineDraftKey(namespace))
  return parseCanvasOfflineDraft(value, namespace)
}

export async function saveCanvasOfflineDraft(
  draft: CanvasOfflineDraft,
  store: CanvasOfflineDraftStore = browserCanvasOfflineDraftStore,
): Promise<void> {
  await store.put(createCanvasOfflineDraft({
    namespace: draft.namespace,
    document: draft.document,
    pendingOps: draft.pendingOps,
    lastServerRevision: draft.lastServerRevision,
    retryAttempt: draft.retryAttempt,
    lastError: draft.lastError,
    updatedAt: draft.updatedAt,
  }))
}

export async function deleteCanvasOfflineDraft(
  namespace: CanvasOfflineNamespace,
  store: CanvasOfflineDraftStore = browserCanvasOfflineDraftStore,
): Promise<void> {
  await store.delete(canvasOfflineDraftKey(namespace))
}

export type CanvasOfflineRecoveryChoice = 'local' | 'server'

export function resolveCanvasOfflineRecoveryChoice({
  draft,
  choice,
  serverRevision,
  clientId,
}: {
  draft: CanvasOfflineDraft
  choice: CanvasOfflineRecoveryChoice
  serverRevision: number
  clientId: string
}): CanvasDocumentInput | null {
  if (choice === 'server') return null
  return {
    ...clone(draft.document),
    expectedRevision: serverRevision,
    clientId,
    changeSummary: '恢复本地未同步版本',
  }
}

export function createMemoryCanvasOfflineDraftStore(
  initial: CanvasOfflineDraft[] = [],
): CanvasOfflineDraftStore & { size: () => number } {
  const rows = new Map(initial.map((draft) => [draft.key, clone(draft)]))
  return {
    async get(key) {
      const value = rows.get(key)
      return value ? clone(value) : undefined
    },
    async put(draft) {
      rows.set(draft.key, clone(draft))
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

const volatileFallbackStore = createMemoryCanvasOfflineDraftStore()

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
