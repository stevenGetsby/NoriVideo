'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { canvasApi, CanvasRevisionConflictError } from '../api/client'
import type { CanvasEdge, CanvasDocumentInput, CanvasGraphResponse, CanvasNode, CanvasOperation, Viewport } from '../types'
import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'
import type { CanvasSaveState } from '../components/CanvasChrome'
import {
  createCanvasGeometryOfflineDraft,
  createCanvasOfflineDraft,
  deleteCanvasOfflineDraft,
  isCanvasGeometryOfflineDraft,
  loadCanvasOfflineDraft,
  resolveCanvasOfflineRecoveryChoice,
  saveCanvasOfflineDraft,
  type CanvasOfflineDraft,
  type CanvasOfflineNamespace,
} from './canvas-offline-store'
import {
  createCanvasAutosaveRetryController,
  createCanvasOfflineDraftBuffer,
  createCanvasPersistenceHold,
} from './canvas-autosave-runtime'
import {
  applyCanvasDocumentDelta,
  buildCanvasOperations,
  buildCanvasOperationsFromChanges,
  canvasGraphToDocument,
  sameOperationTargets,
  withoutCanvasId,
} from './canvas-operations'
import { createCanvasChangeTracker } from './canvas-change-tracker'
import { mergeCanvasDocuments } from './canvas-three-way-merge'

const SAVE_DELAY_MS = 800
const RESTORE_SAVE_DELAY_MS = 120
const MAX_AUTOMATIC_CONFLICT_MERGES = 8
const TRACKER_VERIFY_EVERY = 40

type OfflineRecoveryState = 'loading' | 'pending' | 'none'

export type CanvasChangeSource = {
  nodes(): readonly CanvasFlowNode[]
  edges(): readonly CanvasFlowEdge[]
  viewport(): Viewport
  nodeToDocument(node: CanvasFlowNode): CanvasNode
  nodeGeometryToDocument?(node: CanvasFlowNode): CanvasNode
  edgeToDocument(edge: CanvasFlowEdge): CanvasEdge
}

export function canAcceptExternalRevision(currentRevision: number, expectedRevision: number, nextRevision: number) {
  return Number.isSafeInteger(currentRevision)
    && Number.isSafeInteger(expectedRevision)
    && Number.isSafeInteger(nextRevision)
    && currentRevision === expectedRevision
    && nextRevision === expectedRevision + 1
}

function createBrowserId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export function canvasTabSaveDelay(baseDelay: number, tabId: string) {
  let hash = 0
  for (let index = 0; index < tabId.length; index += 1) hash = (hash * 31 + tabId.charCodeAt(index)) >>> 0
  return Math.max(0, Math.floor(baseDelay)) + (hash % 181)
}

async function saveOperationDelta(input: {
  projectId: string
  canvasId: string
  operations: CanvasOperation[]
  expectedRevision: number
  clientId: string
  changeSummary: string
}) {
  const delta = await canvasApi.saveOperationsDelta(input.projectId, input.canvasId, {
    expectedRevision: input.expectedRevision,
    clientId: input.clientId,
    changeSummary: input.changeSummary,
    ops: input.operations,
  })
  return { graph: delta, delta }
}

function getClientId() {
  const key = 'nori-canvas-client-id'
  try {
    const current = window.sessionStorage.getItem(key)
    if (current) return current
    const created = createBrowserId()
    window.sessionStorage.setItem(key, created)
    return created
  } catch {
    return createBrowserId()
  }
}

interface CanvasRevisionBroadcast {
  type: 'canvas-revision'
  source: string
  revision: number
}

export function parseCanvasRevisionBroadcast(value: unknown): CanvasRevisionBroadcast | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (
    source.type !== 'canvas-revision'
    || typeof source.source !== 'string'
    || !source.source.trim()
    || typeof source.revision !== 'number'
    || !Number.isSafeInteger(source.revision)
    || source.revision < 0
  ) return null
  return { type: 'canvas-revision', source: source.source, revision: source.revision }
}

export function useCanvasAutosave({
  accountId,
  enabled = true,
  projectId,
  canvasId,
  initialRevision,
  buildDocument,
  initialDocument,
  changeSource,
  geometryOps = false,
  onSaved,
  onLoadServer,
  onMergeDocument,
  onRestoreLocal,
  hydrateForDocument,
}: {
  accountId: string
  enabled?: boolean
  projectId: string
  canvasId: string
  initialRevision: number
  buildDocument: (expectedRevision: number, clientId: string, changeSummary: string) => CanvasDocumentInput
  initialDocument?: CanvasDocumentInput
  /** When given, saves only convert and compare the entities that changed since the last confirmed save. */
  changeSource?: CanvasChangeSource
  geometryOps?: boolean
  onSaved: (graph: CanvasGraphResponse) => void
  onLoadServer: (graph: CanvasGraphResponse) => void
  onMergeDocument: (document: CanvasDocumentInput, graph: CanvasGraphResponse) => void
  onRestoreLocal: (document: CanvasDocumentInput, geometryOnly?: boolean) => void
  hydrateForDocument?: (document: CanvasDocumentInput, confirmed?: CanvasDocumentInput | null) => Promise<CanvasDocumentInput>
}) {
  const offlineEnabled = enabled && Boolean(accountId.trim())
  const [saveState, setSaveState] = useState<CanvasSaveState>('idle')
  const [conflictOpen, setConflictOpen] = useState(false)
  const [offlineRecoveryState, setOfflineRecoveryState] = useState<OfflineRecoveryState>(
    offlineEnabled ? 'loading' : 'none',
  )
  const [offlineDraft, setOfflineDraft] = useState<CanvasOfflineDraft | null>(null)
  const revisionRef = useRef(initialRevision)
  const clientIdRef = useRef('')
  const tabIdRef = useRef('')
  const revisionChannelRef = useRef<BroadcastChannel | null>(null)
  const externalSyncRef = useRef<Promise<void> | null>(null)
  const automaticConflictMergesRef = useRef(0)
  const buildRef = useRef(buildDocument)
  const hydrateRef = useRef(hydrateForDocument)
  const changeSourceRef = useRef(changeSource)
  const trackerRef = useRef(createCanvasChangeTracker<CanvasFlowNode, CanvasFlowEdge>())
  const contentDirtyRef = useRef(false)
  const verifyCountRef = useRef(0)
  const onSavedRef = useRef(onSaved)
  const onLoadServerRef = useRef(onLoadServer)
  const onMergeDocumentRef = useRef(onMergeDocument)
  const onRestoreLocalRef = useRef(onRestoreLocal)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef<Promise<unknown> | null>(null)
  const networkSavePendingRef = useRef(false)
  const dirtyRef = useRef(false)
  const pausedRef = useRef(false)
  const mountedRef = useRef(true)
  const summaryRef = useRef('编辑画布')
  const lastErrorRef = useRef<string | null>(null)
  const offlineDraftRef = useRef<CanvasOfflineDraft | null>(null)
  const confirmedDocumentRef = useRef<CanvasDocumentInput | null>(initialDocument)
  const forceFullSaveRef = useRef(false)
  const pendingFullDocumentRef = useRef<CanvasDocumentInput | null>(null)
  const pendingNodeConfirmationsRef = useRef<CanvasFlowNode[]>([])
  const pendingHydrationDocumentRef = useRef<Promise<CanvasDocumentInput> | null>(null)
  const restoreInProgressRef = useRef(false)
  const initialOfflineLoadPendingRef = useRef(false)
  const offlineBufferRef = useRef<ReturnType<typeof createCanvasOfflineDraftBuffer> | null>(null)
  const retryControllerRef = useRef<ReturnType<typeof createCanvasAutosaveRetryController> | null>(null)
  const flushRef = useRef<() => Promise<void>>(async () => undefined)
  const persistenceHoldRef = useRef(createCanvasPersistenceHold())

  const initialDocumentRef = useRef(initialDocument)
  const initialRevisionRef = useRef(initialRevision)
  const geometryOpsRef = useRef(geometryOps)
  initialDocumentRef.current = initialDocument
  initialRevisionRef.current = initialRevision
  geometryOpsRef.current = geometryOps
  useEffect(() => { buildRef.current = buildDocument }, [buildDocument])
  useEffect(() => { hydrateRef.current = hydrateForDocument }, [hydrateForDocument])
  useEffect(() => { changeSourceRef.current = changeSource }, [changeSource])
  if (!trackerRef.current.ready() && changeSource) {
    trackerRef.current.reconcile(changeSource.nodes(), changeSource.edges())
  }
  onSavedRef.current = onSaved
  onLoadServerRef.current = onLoadServer
  onMergeDocumentRef.current = onMergeDocument
  onRestoreLocalRef.current = onRestoreLocal
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const clearSaveTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const planTrackedOperations = useCallback((confirmed: CanvasDocumentInput) => {
    const source = changeSourceRef.current
    if (!source || pendingFullDocumentRef.current || forceFullSaveRef.current) return null
    const tracked = trackerRef.current.collect(source.nodes(), source.edges())
    if (!tracked) return null
    const nodes = new Map<string, CanvasNode | undefined>()
    const edges = new Map<string, CanvasEdge | undefined>()
    const operations = buildCanvasOperationsFromChanges(
      confirmed,
      {
        viewport: source.viewport(),
        node(id) {
          if (!nodes.has(id)) {
            const node = tracked.node(id)
            nodes.set(id, node
              ? node.data.__canvasUnhydrated === true && source.nodeGeometryToDocument
                ? source.nodeGeometryToDocument(node)
                : source.nodeToDocument(node)
              : undefined)
          }
          return nodes.get(id)
        },
        edge(id) {
          if (!edges.has(id)) {
            const edge = tracked.edge(id)
            edges.set(id, edge ? source.edgeToDocument(edge) : undefined)
          }
          return edges.get(id)
        },
      },
      tracked.changes,
      { geometryOps: geometryOpsRef.current },
    )
    return { tracked, operations }
  }, [])

  const confirmHydratedNodes = useCallback((nodes: readonly CanvasNode[]) => {
    const confirmed = confirmedDocumentRef.current
    if (!confirmed || nodes.length === 0) return
    const byId = new Map(confirmed.nodes.map((node) => [node.id, node]))
    const loaded = new Set<string>()
    for (const node of nodes) {
      const existing = byId.get(node.id)
      if (!existing) continue
      // Detail reads do not persist anything; never acknowledge a local drag
      // just because the editor keeps that drag when it applies the detail.
      byId.set(node.id, { ...node, position: existing.position, size: existing.size })
      loaded.add(node.id)
    }
    if (!loaded.size) return
    confirmedDocumentRef.current = { ...confirmed, nodes: Array.from(byId.values()) }
    const source = changeSourceRef.current
    if (!source || !trackerRef.current.ready()) return
    const current = source.nodes().filter((node) => loaded.has(node.id) && node.data.__canvasUnhydrated !== true)
    if (savingRef.current || networkSavePendingRef.current) {
      pendingNodeConfirmationsRef.current.push(...current)
      return
    }
    trackerRef.current.confirmNodes(current, true)
  }, [])

  const confirmMeasuredNodes = useCallback((nodes: readonly CanvasFlowNode[]) => {
    if (nodes.length === 0) return
    if (savingRef.current || networkSavePendingRef.current) {
      pendingNodeConfirmationsRef.current.push(...nodes)
      return
    }
    trackerRef.current.confirmNodes(nodes, true)
  }, [])

  const buildCompleteDocument = useCallback(async (expectedRevision: number, summary: string) => {
    const snapshot = buildRef.current(expectedRevision, clientIdRef.current, summary)
    const document = await (hydrateRef.current ? hydrateRef.current(snapshot, confirmedDocumentRef.current) : Promise.resolve(snapshot))
    const summaryNode = document.nodes.find((node) => node.data?.__canvasUnhydrated === true)
    if (summaryNode) throw new Error(`节点 ${summaryNode.id} 尚未加载完整内容，不能写入完整文档。`)
    return document
  }, [])

  const prepareCompleteDocument = useCallback((expectedRevision: number, summary: string) => {
    const pending = pendingHydrationDocumentRef.current
    if (pending) return pending
    const hydrating = buildCompleteDocument(expectedRevision, summary)
    pendingHydrationDocumentRef.current = hydrating
    void hydrating.then(() => {
      if (pendingHydrationDocumentRef.current === hydrating) pendingHydrationDocumentRef.current = null
    }, () => {
      if (pendingHydrationDocumentRef.current === hydrating) pendingHydrationDocumentRef.current = null
    })
    return hydrating
  }, [buildCompleteDocument])

  const mergeIncomingGraph = useCallback(async (graph: CanvasGraphResponse, summary: string) => {
    const local = await buildCompleteDocument(revisionRef.current, summary)
    const base = confirmedDocumentRef.current || local
    const remote = canvasGraphToDocument(graph, clientIdRef.current)
    const merged = mergeCanvasDocuments(base, local, remote, summary)
    pendingFullDocumentRef.current = null
    revisionRef.current = graph.canvas.revision
    confirmedDocumentRef.current = remote
    trackerRef.current.invalidate()
    onMergeDocumentRef.current(merged, graph)
  }, [buildCompleteDocument])

  const mergeLatestServerVersion = useCallback(async () => {
    if (automaticConflictMergesRef.current >= MAX_AUTOMATIC_CONFLICT_MERGES) return false
    automaticConflictMergesRef.current += 1
    try {
      const graph = await canvasApi.get(projectId, canvasId)
      const recoveryDocument = pendingFullDocumentRef.current
      await mergeIncomingGraph(graph, '自动合并多标签页更改')
      if (recoveryDocument) {
        pendingFullDocumentRef.current = {
          ...recoveryDocument,
          expectedRevision: graph.canvas.revision,
        }
        summaryRef.current = '恢复本地未同步版本'
      }
      forceFullSaveRef.current = recoveryDocument !== null
      pausedRef.current = false
      setConflictOpen(false)
      dirtyRef.current = true
      contentDirtyRef.current = true
      summaryRef.current = recoveryDocument ? '恢复本地未同步版本' : '自动合并多标签页更改'
      offlineBufferRef.current?.schedule()
      if (mountedRef.current) setSaveState('pending')
      return true
    } catch {
      return false
    }
  }, [canvasId, mergeIncomingGraph, projectId])

  const flush = useCallback(async () => {
    if (pausedRef.current || !dirtyRef.current) return
    clearSaveTimer()
    if (savingRef.current) {
      if (typeof performance !== 'undefined') performance.clearMarks('canvas:viewport-save-scheduled')
      await savingRef.current
      if (dirtyRef.current && !pausedRef.current && !retryControllerRef.current?.hasPending()) {
        timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(SAVE_DELAY_MS, tabIdRef.current))
      }
      return
    }

    const hasContentChanges = contentDirtyRef.current
    dirtyRef.current = false
    contentDirtyRef.current = false
    if (typeof performance !== 'undefined') performance.mark('canvas:viewport-save-scheduled')
    const expectedRevision = revisionRef.current
    const confirmed = confirmedDocumentRef.current
    const source = changeSourceRef.current
    const tracker = trackerRef.current
    const recovery = pendingFullDocumentRef.current
    const viewportOnly = !hasContentChanges && Boolean(confirmed && source && tracker.ready()
      && !recovery && !forceFullSaveRef.current)
    const nodesAtBuild = viewportOnly ? undefined : source?.nodes()
    const edgesAtBuild = viewportOnly ? undefined : source?.edges()
    let plan: ReturnType<typeof planTrackedOperations> = null
    let document: CanvasDocumentInput | null = null
    let operations: CanvasOperation[] = []
    const epoch = tracker.epoch()
    if (mountedRef.current) setSaveState('saving')
    const task = (async () => {
      try {
        if (viewportOnly && source && confirmed) {
          const viewport = source.viewport()
          const previous = confirmed.viewport
          if (viewport.x !== previous.x || viewport.y !== previous.y || viewport.zoom !== previous.zoom) {
            operations = [{ type: 'canvas.update_meta', viewport }]
          }
        } else {
          plan = confirmed ? planTrackedOperations(confirmed) : null
          operations = plan?.operations ?? []
        }
        if (plan && confirmed && operations.some((operation) => operation.type !== 'canvas.update_meta')) {
          const summaryUpserts = operations.flatMap((operation) => operation.type === 'node.upsert'
            && operation.node.data?.__canvasUnhydrated === true ? [{ ...operation.node, canvasId }] : [])
          if (summaryUpserts.length > 0) {
            const hydrate = hydrateRef.current
            if (!hydrate) throw new Error('画布节点尚未加载完整内容。')
            const snapshot = await hydrate({ ...confirmed, nodes: summaryUpserts, edges: [] }, confirmed)
            const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]))
            operations = operations.map((operation) => {
              if (operation.type !== 'node.upsert' || operation.node.data?.__canvasUnhydrated !== true) return operation
              const node = nodes.get(operation.node.id)
              if (!node || node.data?.__canvasUnhydrated === true) throw new Error(`节点 ${operation.node.id} 尚未加载完整内容，不能写入完整文档。`)
              return { type: 'node.upsert', node: withoutCanvasId(node) }
            })
          }
          verifyCountRef.current += 1
          if (verifyCountRef.current % TRACKER_VERIFY_EVERY === 0) {
            // An entity mutated in place would be invisible to the reference check, so compare everything now and then.
            const fullDocument = await buildCompleteDocument(expectedRevision, summaryRef.current)
            const fullOperations = buildCanvasOperations(confirmed, fullDocument, { geometryOps: geometryOpsRef.current })
            if (!sameOperationTargets(operations, fullOperations)) {
              document = fullDocument
              operations = fullOperations
              plan = null
              tracker.invalidate()
            }
          }
        }
        if (!viewportOnly && !plan && !document) {
          document = recovery
            ? { ...recovery, expectedRevision, clientId: clientIdRef.current, changeSummary: summaryRef.current }
            : await buildCompleteDocument(expectedRevision, summaryRef.current)
          operations = confirmed ? buildCanvasOperations(confirmed, document, { geometryOps: geometryOpsRef.current }) : []
        }
        const request = document && (forceFullSaveRef.current || !confirmed)
          ? () => canvasApi.saveDocument(projectId, canvasId, document!).then((graph) => ({ graph, delta: null }))
          : operations.length > 0
            ? () => saveOperationDelta({
                projectId,
                canvasId,
                operations,
                expectedRevision,
                clientId: clientIdRef.current,
                changeSummary: summaryRef.current,
              })
            : null
        networkSavePendingRef.current = request !== null
        if (typeof performance !== 'undefined') {
          if ((viewportOnly || plan) && operations.length === 1 && operations[0].type === 'canvas.update_meta') {
            performance.mark('canvas:viewport-save-request')
            performance.measure('canvas:viewport-save-sync', 'canvas:viewport-save-scheduled', 'canvas:viewport-save-request')
          } else {
            performance.clearMarks('canvas:viewport-save-scheduled')
          }
        }
        const saved = request ? await request() : null
        networkSavePendingRef.current = false
        if (plan) {
          tracker.commit(plan.tracked.changes)
        } else if (source && nodesAtBuild && edgesAtBuild) {
          if (recovery || document) tracker.invalidate()
          else tracker.reconcile(nodesAtBuild, edgesAtBuild, epoch)
        }
        if (source && tracker.ready() && pendingNodeConfirmationsRef.current.length > 0) {
          const current = new Map(source.nodes().map((node) => [node.id, node]))
          const pending = pendingNodeConfirmationsRef.current
          pendingNodeConfirmationsRef.current = []
          for (const node of pending) {
            if (current.get(node.id) === node) tracker.confirmNodes([node], true)
          }
        }
        if (saved) {
          revisionRef.current = saved.graph.canvas.revision
          // A detail read can refine the confirmed body during the network
          // request. Apply its delta to that baseline at the same revision.
          const latest = confirmedDocumentRef.current
          const base = latest?.expectedRevision === expectedRevision ? latest : confirmed
          confirmedDocumentRef.current = saved.delta && confirmed
            ? applyCanvasDocumentDelta(base ?? confirmed, saved.delta, clientIdRef.current, summaryRef.current)
            : canvasGraphToDocument(saved.graph, clientIdRef.current, summaryRef.current)
          forceFullSaveRef.current = false
          pendingFullDocumentRef.current = null
          revisionChannelRef.current?.postMessage({
            type: 'canvas-revision',
            source: tabIdRef.current,
            revision: saved.graph.canvas.revision,
          } satisfies CanvasRevisionBroadcast)
        }
        automaticConflictMergesRef.current = 0
        lastErrorRef.current = null
        retryControllerRef.current?.reset()
        if (contentDirtyRef.current) {
          await offlineBufferRef.current?.flush()
        } else {
          await offlineBufferRef.current?.clear()
        }
        if (!mountedRef.current) return
        if (saved) onSavedRef.current(saved.graph)
        if (dirtyRef.current) {
          setSaveState('pending')
        } else {
          setSaveState('saved')
          window.setTimeout(() => setSaveState((current) => current === 'saved' ? 'idle' : current), 2_200)
        }
      } catch (error) {
        dirtyRef.current = true
        contentDirtyRef.current = true
        lastErrorRef.current = error instanceof Error ? error.message : '画布保存失败'
        await offlineBufferRef.current?.flush().catch(() => undefined)
        if (error instanceof CanvasRevisionConflictError) {
          retryControllerRef.current?.reset()
          if (await mergeLatestServerVersion()) return
          pausedRef.current = true
          if (mountedRef.current) {
            setConflictOpen(true)
            setSaveState('conflict')
          }
        } else {
          retryControllerRef.current?.scheduleAfterFailure()
          if (mountedRef.current) setSaveState('offline')
        }
      } finally {
        networkSavePendingRef.current = false
        savingRef.current = null
        if (typeof performance !== 'undefined') performance.clearMarks('canvas:viewport-save-scheduled')
      }
    })()
    savingRef.current = task
    await task
    if (dirtyRef.current && !pausedRef.current && !retryControllerRef.current?.hasPending()) {
      timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(SAVE_DELAY_MS, tabIdRef.current))
    }
  }, [canvasId, clearSaveTimer, mergeLatestServerVersion, planTrackedOperations, projectId])

  useEffect(() => { flushRef.current = flush }, [flush])

  useEffect(() => {
    let active = true
    initialOfflineLoadPendingRef.current = offlineEnabled
    clearSaveTimer()
    retryControllerRef.current?.dispose()

    revisionRef.current = initialRevisionRef.current
    tabIdRef.current = createBrowserId()
    clientIdRef.current = `${getClientId()}:${tabIdRef.current}`.slice(0, 120)
    automaticConflictMergesRef.current = 0
    dirtyRef.current = false
    contentDirtyRef.current = false
    pausedRef.current = offlineEnabled
    summaryRef.current = '编辑画布'
    lastErrorRef.current = null
    offlineDraftRef.current = null
    confirmedDocumentRef.current = confirmedDocumentRef.current || initialDocumentRef.current || buildRef.current(
      initialRevisionRef.current,
      clientIdRef.current,
      '编辑画布',
    )
    const initialSource = changeSourceRef.current
    const sourceInitialized = trackerRef.current.ready()
    if (initialSource && !sourceInitialized) trackerRef.current.reconcile(initialSource.nodes(), initialSource.edges())
    else if (!initialSource) trackerRef.current.invalidate()
    verifyCountRef.current = 0
    forceFullSaveRef.current = false
    pendingFullDocumentRef.current = null
    if (!sourceInitialized) pendingNodeConfirmationsRef.current = []
    restoreInProgressRef.current = false
    setOfflineDraft(null)
    setConflictOpen(false)
    setSaveState('idle')
    setOfflineRecoveryState(offlineEnabled ? 'loading' : 'none')

    const namespace: CanvasOfflineNamespace | null = offlineEnabled
      ? { accountId: accountId.trim(), projectId, canvasId }
      : null

    const retryController = createCanvasAutosaveRetryController({
      run: async () => await flushRef.current(),
    })
    retryControllerRef.current = retryController

    const buffer = createCanvasOfflineDraftBuffer({
      read: async () => {
        if (!namespace || !dirtyRef.current || !contentDirtyRef.current) return null
        const confirmed = confirmedDocumentRef.current
        const tracked = confirmed && planTrackedOperations(confirmed)
        if (tracked && confirmed) {
          const journal = createCanvasGeometryOfflineDraft({
            namespace,
            base: confirmed,
            operations: tracked.operations,
            retryAttempt: retryController.failureCount(),
            lastError: lastErrorRef.current,
          })
          if (journal) return journal
        }
        const document = pendingFullDocumentRef.current
          || await prepareCompleteDocument(revisionRef.current, summaryRef.current)
        return createCanvasOfflineDraft({
          namespace,
          document,
          pendingOps: forceFullSaveRef.current || !confirmed
            ? []
            : planTrackedOperations(confirmed)?.operations ?? buildCanvasOperations(confirmed, document, { geometryOps: geometryOpsRef.current }),
          lastServerRevision: revisionRef.current,
          retryAttempt: retryController.failureCount(),
          lastError: lastErrorRef.current,
          copy: false,
        })
      },
      write: async (draft) => await saveCanvasOfflineDraft(draft),
      remove: async () => {
        if (namespace) await deleteCanvasOfflineDraft(namespace)
      },
    })
    offlineBufferRef.current = buffer

    if (!namespace) {
      pausedRef.current = false
      return () => {
        active = false
        retryController.dispose()
        void buffer.dispose({ flush: false }).catch(() => undefined)
      }
    }

    void loadCanvasOfflineDraft(namespace)
      .then((draft) => {
        if (!active) return
        if (initialOfflineLoadPendingRef.current && restoreInProgressRef.current) return
        initialOfflineLoadPendingRef.current = false
        if (draft?.dirty) {
          offlineDraftRef.current = draft
          pausedRef.current = true
          setOfflineDraft(draft)
          setOfflineRecoveryState('pending')
          setSaveState('recovery')
          return
        }
        pausedRef.current = false
        setOfflineRecoveryState('none')
      })
      .catch(() => {
        if (!active) return
        if (initialOfflineLoadPendingRef.current && restoreInProgressRef.current) return
        initialOfflineLoadPendingRef.current = false
        pausedRef.current = false
        setOfflineRecoveryState('none')
      })

    return () => {
      active = false
      initialOfflineLoadPendingRef.current = false
      clearSaveTimer()
      retryController.dispose()
      const shouldFlush = dirtyRef.current && !pausedRef.current
      void buffer.dispose({ flush: shouldFlush }).catch(() => undefined)
    }
  }, [accountId, canvasId, clearSaveTimer, offlineEnabled, prepareCompleteDocument, projectId])

  const scheduleSave = useCallback((summary = '编辑画布', options?: { viewportOnly?: boolean }) => {
    if (pausedRef.current) return
    dirtyRef.current = true
    // A pan or zoom is not worth a full offline draft; only content edits are cached locally.
    if (!options?.viewportOnly) contentDirtyRef.current = true
    if (options?.viewportOnly) contentDirtyRef.current = contentDirtyRef.current || false
    if (!options?.viewportOnly || !contentDirtyRef.current) summaryRef.current = summary
    if (mountedRef.current) {
      setSaveState((current) => current === 'saving' || current === 'offline' ? current : 'pending')
    }
    if (persistenceHoldRef.current.defer()) return
    if (contentDirtyRef.current) offlineBufferRef.current?.schedule()
    if (retryControllerRef.current?.hasPending()) return
    clearSaveTimer()
    timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(SAVE_DELAY_MS, tabIdRef.current))
  }, [clearSaveTimer])

  const holdPersistence = useCallback((held: boolean) => {
    const hold = persistenceHoldRef.current
    if (held) {
      hold.hold()
      if (dirtyRef.current) {
        clearSaveTimer()
        offlineBufferRef.current?.cancel()
        hold.defer()
      }
      return
    }
    if (!hold.release() || pausedRef.current || !dirtyRef.current) return
    if (contentDirtyRef.current) offlineBufferRef.current?.schedule()
    if (retryControllerRef.current?.hasPending()) return
    clearSaveTimer()
    timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(SAVE_DELAY_MS, tabIdRef.current))
  }, [clearSaveTimer])

  const syncExternalRevision = useCallback(async (incomingRevision: number) => {
    if (incomingRevision <= revisionRef.current || pausedRef.current) return
    if (externalSyncRef.current) await externalSyncRef.current
    if (incomingRevision <= revisionRef.current || pausedRef.current) return

    const task = (async () => {
      const pendingSave = savingRef.current
      if (pendingSave) await pendingSave
      if (incomingRevision <= revisionRef.current || pausedRef.current) return
      const graph = await canvasApi.get(projectId, canvasId)
      if (graph.canvas.revision <= revisionRef.current) return

      const preserveLocalChanges = dirtyRef.current
      const pendingRecoveryDocument = pendingFullDocumentRef.current
      forceFullSaveRef.current = pendingRecoveryDocument !== null
      automaticConflictMergesRef.current = 0
      if (preserveLocalChanges) {
        await mergeIncomingGraph(graph, '同步并合并其他标签页更改')
        forceFullSaveRef.current = pendingRecoveryDocument !== null
        if (pendingRecoveryDocument) {
          pendingFullDocumentRef.current = {
            ...pendingRecoveryDocument,
            expectedRevision: graph.canvas.revision,
          }
        }
        dirtyRef.current = true
        contentDirtyRef.current = true
        summaryRef.current = '同步并合并其他标签页更改'
        offlineBufferRef.current?.schedule()
        clearSaveTimer()
        timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(RESTORE_SAVE_DELAY_MS, tabIdRef.current))
        if (mountedRef.current) setSaveState('pending')
        return
      }

      revisionRef.current = graph.canvas.revision
      confirmedDocumentRef.current = canvasGraphToDocument(graph, clientIdRef.current)
      trackerRef.current.invalidate()
      onLoadServerRef.current(graph)
      await offlineBufferRef.current?.clear()
      if (mountedRef.current) {
        setConflictOpen(false)
        setSaveState('saved')
        window.setTimeout(() => setSaveState((current) => current === 'saved' ? 'idle' : current), 1_200)
      }
    })().catch(() => undefined).finally(() => {
      externalSyncRef.current = null
    })
    externalSyncRef.current = task
    await task
  }, [canvasId, clearSaveTimer, mergeIncomingGraph, projectId])

  useEffect(() => {
    if (!enabled) return
    const channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(`nori-canvas:${accountId.trim()}:${projectId}:${canvasId}`)
    if (channel) {
      revisionChannelRef.current = channel
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = parseCanvasRevisionBroadcast(event.data)
        if (!message || message.source === tabIdRef.current) return
        void syncExternalRevision(message.revision)
      }
    }
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') void syncExternalRevision(revisionRef.current + 1)
    }
    const persistBeforeLeave = () => {
      if (!dirtyRef.current) return
      void offlineBufferRef.current?.flush().catch(() => undefined)
      if (!pausedRef.current) void flushRef.current()
    }
    window.addEventListener('focus', syncWhenVisible)
    window.addEventListener('pagehide', persistBeforeLeave)
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      window.removeEventListener('focus', syncWhenVisible)
      window.removeEventListener('pagehide', persistBeforeLeave)
      document.removeEventListener('visibilitychange', syncWhenVisible)
      channel?.close()
      if (revisionChannelRef.current === channel) revisionChannelRef.current = null
    }
  }, [accountId, canvasId, enabled, projectId, syncExternalRevision])

  const retry = useCallback(() => {
    if (pausedRef.current) return
    retryControllerRef.current?.reset()
    if (mountedRef.current) setSaveState('pending')
    void flushRef.current()
  }, [])

  const loadServerVersion = useCallback(async () => {
    const graph = await canvasApi.get(projectId, canvasId)
    revisionRef.current = graph.canvas.revision
    confirmedDocumentRef.current = canvasGraphToDocument(graph, clientIdRef.current)
    trackerRef.current.invalidate()
    forceFullSaveRef.current = false
    pendingFullDocumentRef.current = null
    dirtyRef.current = false
    contentDirtyRef.current = false
    pausedRef.current = false
    summaryRef.current = '编辑画布'
    lastErrorRef.current = null
    retryControllerRef.current?.reset()
    automaticConflictMergesRef.current = 0
    await offlineBufferRef.current?.clear()
    offlineDraftRef.current = null
    setOfflineDraft(null)
    setOfflineRecoveryState('none')
    setConflictOpen(false)
    setSaveState('idle')
    onLoadServerRef.current(graph)
    return graph
  }, [canvasId, projectId])

  const mergeServerVersion = useCallback(async () => {
    const graph = await canvasApi.get(projectId, canvasId)
    await mergeIncomingGraph(graph, '重新合并多标签更改')
    forceFullSaveRef.current = false
    pausedRef.current = false
    automaticConflictMergesRef.current = 0
    setConflictOpen(false)
    setSaveState('pending')
    dirtyRef.current = true
    contentDirtyRef.current = true
    summaryRef.current = '重新合并多标签更改'
    offlineBufferRef.current?.schedule()
    clearSaveTimer()
    timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(RESTORE_SAVE_DELAY_MS, tabIdRef.current))
  }, [canvasId, clearSaveTimer, mergeIncomingGraph, projectId])

  const restoreLocalVersion = useCallback(async () => {
    const draft = offlineDraftRef.current
    if (!draft) return
    const geometryOnly = isCanvasGeometryOfflineDraft(draft)
    const document = resolveCanvasOfflineRecoveryChoice({
      draft,
      choice: 'local',
      serverRevision: revisionRef.current,
      clientId: clientIdRef.current,
      ...(geometryOnly ? { currentDocument: buildRef.current(revisionRef.current, clientIdRef.current, '恢复本地未同步版本') } : {}),
    })
    if (!document) return
    restoreInProgressRef.current = true
    const restoredDocument = geometryOnly ? document : {
      ...document,
      edges: document.edges.map((edge) => ({
        ...edge,
        role: edge.role === 'VIDEO_FRAME' ? 'REF' : edge.role,
      })),
    }
    dirtyRef.current = true
    contentDirtyRef.current = true
    forceFullSaveRef.current = !geometryOnly
    pendingFullDocumentRef.current = geometryOnly ? null : restoredDocument
    summaryRef.current = '恢复本地未同步版本'
    offlineDraftRef.current = null
    void offlineBufferRef.current?.flush().catch(() => undefined)
    onRestoreLocalRef.current(restoredDocument, geometryOnly)
    pausedRef.current = false
    lastErrorRef.current = null
    retryControllerRef.current?.reset()
    automaticConflictMergesRef.current = 0
    setOfflineDraft(null)
    setOfflineRecoveryState('none')
    setSaveState('pending')
    clearSaveTimer()
    timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(RESTORE_SAVE_DELAY_MS, tabIdRef.current))
  }, [clearSaveTimer])

  const useServerVersion = useCallback(async () => {
    restoreInProgressRef.current = true
    const draft = offlineDraftRef.current
    if (draft) {
      resolveCanvasOfflineRecoveryChoice({
        draft,
        choice: 'server',
        serverRevision: revisionRef.current,
        clientId: clientIdRef.current,
      })
    }
    dirtyRef.current = false
    contentDirtyRef.current = false
    pausedRef.current = false
    forceFullSaveRef.current = false
    pendingFullDocumentRef.current = null
    summaryRef.current = '编辑画布'
    lastErrorRef.current = null
    retryControllerRef.current?.reset()
    automaticConflictMergesRef.current = 0
    void offlineBufferRef.current?.clear().catch(() => undefined)
    offlineDraftRef.current = null
    setOfflineDraft(null)
    setOfflineRecoveryState('none')
    setSaveState('idle')
  }, [])

  const prepareRevisionedMutation = useCallback(async () => {
    const pendingSave = savingRef.current
    if (pendingSave) await pendingSave
    if (pausedRef.current) {
      throw new CanvasRevisionConflictError('画布存在尚未处理的本地版本或版本冲突，请先完成恢复选择。')
    }
    // A successful save can still leave the canvas dirty when an edit lands while it is in
    // flight (a viewport animation settling, for one); persist that too instead of failing.
    for (let pass = 0; pass < 3; pass += 1) {
      if (dirtyRef.current) await flushRef.current()
      const trailingSave = savingRef.current
      if (trailingSave) await trailingSave
      if (pausedRef.current || !dirtyRef.current || lastErrorRef.current) break
    }
    if (pausedRef.current) {
      throw new CanvasRevisionConflictError('画布保存时发生版本冲突，请先处理冲突后再同步。')
    }
    if (dirtyRef.current) {
      throw new Error('画布仍有未保存的更改；本地副本已缓存，请联网并保存成功后重试同步。')
    }
    if (!clientIdRef.current) clientIdRef.current = getClientId()
    return {
      expectedRevision: revisionRef.current,
      clientId: clientIdRef.current,
    }
  }, [])

  /**
   * Revisioned operation saves (generation drafts and their cleanup) must join
   * the same in-flight slot as autosave. Otherwise a timer-driven flush can
   * send a stale expectedRevision mid-flight, lose the 409 race, merge the
   * server revision and invalidate this save's revision handoff afterwards.
   */
  const saveRevisionedOperations = useCallback(async (input: {
    changeSummary: string
    ops: CanvasOperation[]
  }) => {
    const pendingSave = savingRef.current
    if (pendingSave) await pendingSave
    if (pausedRef.current) {
      throw new CanvasRevisionConflictError('画布存在尚未处理的本地版本或版本冲突，请先完成恢复选择。')
    }
    for (let pass = 0; pass < 3; pass += 1) {
      if (dirtyRef.current) await flushRef.current()
      const trailingSave = savingRef.current
      if (trailingSave) await trailingSave
      if (pausedRef.current || !dirtyRef.current || lastErrorRef.current) break
    }
    if (pausedRef.current) {
      throw new CanvasRevisionConflictError('画布保存时发生版本冲突，请先处理冲突后再同步。')
    }
    if (dirtyRef.current) {
      throw new Error('画布仍有未保存的更改；本地副本已缓存，请联网并保存成功后重试同步。')
    }
    if (!clientIdRef.current) clientIdRef.current = getClientId()
    const expectedRevision = revisionRef.current
    const clientId = clientIdRef.current
    const task = (async () => {
      try {
        const graph = await canvasApi.saveOperations(projectId, canvasId, {
          expectedRevision,
          clientId,
          changeSummary: input.changeSummary,
          ops: input.ops,
        })
        revisionRef.current = graph.canvas.revision
        confirmedDocumentRef.current = canvasGraphToDocument(graph, clientId, input.changeSummary)
        trackerRef.current.invalidate()
        forceFullSaveRef.current = false
        pendingFullDocumentRef.current = null
        lastErrorRef.current = null
        retryControllerRef.current?.reset()
        revisionChannelRef.current?.postMessage({
          type: 'canvas-revision',
          source: tabIdRef.current,
          revision: graph.canvas.revision,
        } satisfies CanvasRevisionBroadcast)
        if (dirtyRef.current) {
          offlineBufferRef.current?.schedule()
          if (mountedRef.current) setSaveState('pending')
          clearSaveTimer()
          timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(SAVE_DELAY_MS, tabIdRef.current))
        } else {
          await offlineBufferRef.current?.clear()
          if (mountedRef.current) {
            setSaveState('saved')
            window.setTimeout(() => setSaveState((current) => current === 'saved' ? 'idle' : current), 2_200)
          }
        }
        onSavedRef.current(graph)
        return graph
      } catch (error) {
        dirtyRef.current = true
        contentDirtyRef.current = true
        lastErrorRef.current = error instanceof Error ? error.message : '画布保存失败'
        await offlineBufferRef.current?.flush().catch(() => undefined)
        if (error instanceof CanvasRevisionConflictError) {
          retryControllerRef.current?.reset()
          if (!await mergeLatestServerVersion()) {
            pausedRef.current = true
            if (mountedRef.current) {
              setConflictOpen(true)
              setSaveState('conflict')
            }
          }
        } else {
          retryControllerRef.current?.scheduleAfterFailure()
          if (mountedRef.current) setSaveState('offline')
        }
        throw error
      } finally {
        savingRef.current = null
      }
    })()
    savingRef.current = task
    return await task
  }, [canvasId, clearSaveTimer, mergeLatestServerVersion, projectId])

  const acceptExternalRevision = useCallback(async (expectedRevision: number, graph: CanvasGraphResponse) => {
    const pendingSave = savingRef.current
    if (pendingSave) await pendingSave
    if (!canAcceptExternalRevision(revisionRef.current, expectedRevision, graph.canvas.revision)) return false

    revisionRef.current = graph.canvas.revision
    confirmedDocumentRef.current = canvasGraphToDocument(graph, clientIdRef.current)
    trackerRef.current.invalidate()
    revisionChannelRef.current?.postMessage({
      type: 'canvas-revision',
      source: tabIdRef.current,
      revision: graph.canvas.revision,
    } satisfies CanvasRevisionBroadcast)
    pausedRef.current = false
    setConflictOpen(false)
    clearSaveTimer()
    if (dirtyRef.current) {
      setSaveState('pending')
      offlineBufferRef.current?.schedule()
      timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(SAVE_DELAY_MS, tabIdRef.current))
    } else {
      await offlineBufferRef.current?.clear()
      setSaveState('saved')
      window.setTimeout(() => setSaveState((current) => current === 'saved' ? 'idle' : current), 2_200)
    }
    return true
  }, [clearSaveTimer])

  useEffect(() => {
    const resumeOnline = () => {
      if (pausedRef.current || !dirtyRef.current) return
      setSaveState('pending')
      retryControllerRef.current?.reconnect()
    }
    const persistBeforeLeave = () => {
      if (pausedRef.current || !dirtyRef.current) return
      void offlineBufferRef.current?.flush().catch(() => undefined)
    }
    window.addEventListener('online', resumeOnline)
    window.addEventListener('pagehide', persistBeforeLeave)
    window.addEventListener('beforeunload', persistBeforeLeave)
    return () => {
      window.removeEventListener('online', resumeOnline)
      window.removeEventListener('pagehide', persistBeforeLeave)
      window.removeEventListener('beforeunload', persistBeforeLeave)
      persistBeforeLeave()
    }
  }, [])

  return {
    saveState,
    conflictOpen,
    offlineRecoveryState,
    offlineDraft,
    revision: revisionRef,
    clientId: clientIdRef,
    scheduleSave,
    holdPersistence,
    flush,
    retry,
    confirmHydratedNodes,
    confirmMeasuredNodes,
    loadServerVersion,
    mergeServerVersion,
    restoreLocalVersion,
    useServerVersion,
    prepareRevisionedMutation,
    saveRevisionedOperations,
    acceptExternalRevision,
  }
}
