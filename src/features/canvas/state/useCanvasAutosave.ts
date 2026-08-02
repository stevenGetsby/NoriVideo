'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { canvasApi, CanvasRevisionConflictError } from '../api/client'
import type { CanvasDocumentInput, CanvasGraphResponse } from '../types'
import type { CanvasSaveState } from '../components/CanvasChrome'
import {
  createCanvasOfflineDraft,
  deleteCanvasOfflineDraft,
  loadCanvasOfflineDraft,
  resolveCanvasOfflineRecoveryChoice,
  saveCanvasOfflineDraft,
  type CanvasOfflineDraft,
  type CanvasOfflineNamespace,
} from './canvas-offline-store'
import {
  createCanvasAutosaveRetryController,
  createCanvasOfflineDraftBuffer,
} from './canvas-autosave-runtime'
import {
  buildCanvasOperations,
  canvasDocumentWithRevision,
  canvasGraphToDocument,
} from './canvas-operations'
import { mergeCanvasDocuments } from './canvas-three-way-merge'

const SAVE_DELAY_MS = 800
const RESTORE_SAVE_DELAY_MS = 120
const MAX_AUTOMATIC_CONFLICT_MERGES = 8

type OfflineRecoveryState = 'loading' | 'pending' | 'none'

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
  onSaved,
  onLoadServer,
  onMergeDocument,
  onRestoreLocal,
}: {
  accountId: string
  enabled?: boolean
  projectId: string
  canvasId: string
  initialRevision: number
  buildDocument: (expectedRevision: number, clientId: string, changeSummary: string) => CanvasDocumentInput
  onSaved: (graph: CanvasGraphResponse) => void
  onLoadServer: (graph: CanvasGraphResponse) => void
  onMergeDocument: (document: CanvasDocumentInput, graph: CanvasGraphResponse) => void
  onRestoreLocal: (document: CanvasDocumentInput) => void
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
  const onSavedRef = useRef(onSaved)
  const onLoadServerRef = useRef(onLoadServer)
  const onMergeDocumentRef = useRef(onMergeDocument)
  const onRestoreLocalRef = useRef(onRestoreLocal)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef<Promise<void> | null>(null)
  const dirtyRef = useRef(false)
  const pausedRef = useRef(false)
  const mountedRef = useRef(true)
  const summaryRef = useRef('编辑画布')
  const lastErrorRef = useRef<string | null>(null)
  const offlineDraftRef = useRef<CanvasOfflineDraft | null>(null)
  const confirmedDocumentRef = useRef<CanvasDocumentInput | null>(null)
  const forceFullSaveRef = useRef(false)
  const offlineBufferRef = useRef<ReturnType<typeof createCanvasOfflineDraftBuffer> | null>(null)
  const retryControllerRef = useRef<ReturnType<typeof createCanvasAutosaveRetryController> | null>(null)
  const flushRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => { buildRef.current = buildDocument }, [buildDocument])
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  useEffect(() => { onLoadServerRef.current = onLoadServer }, [onLoadServer])
  useEffect(() => { onMergeDocumentRef.current = onMergeDocument }, [onMergeDocument])
  useEffect(() => { onRestoreLocalRef.current = onRestoreLocal }, [onRestoreLocal])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const clearSaveTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const mergeIncomingGraph = useCallback((graph: CanvasGraphResponse, summary: string) => {
    const local = buildRef.current(revisionRef.current, clientIdRef.current, summary)
    const base = confirmedDocumentRef.current || local
    const remote = canvasGraphToDocument(graph, clientIdRef.current)
    const merged = mergeCanvasDocuments(base, local, remote, summary)
    revisionRef.current = graph.canvas.revision
    confirmedDocumentRef.current = remote
    onMergeDocumentRef.current(merged, graph)
  }, [])

  const mergeLatestServerVersion = useCallback(async () => {
    if (automaticConflictMergesRef.current >= MAX_AUTOMATIC_CONFLICT_MERGES) return false
    automaticConflictMergesRef.current += 1
    try {
      const graph = await canvasApi.get(projectId, canvasId)
      mergeIncomingGraph(graph, '自动合并多标签页更改')
      forceFullSaveRef.current = false
      pausedRef.current = false
      setConflictOpen(false)
      dirtyRef.current = true
      summaryRef.current = '自动合并多标签页更改'
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
      await savingRef.current
      return
    }

    dirtyRef.current = false
    const expectedRevision = revisionRef.current
    const document = buildRef.current(expectedRevision, clientIdRef.current, summaryRef.current)
    const confirmed = confirmedDocumentRef.current
    const operations = confirmed ? buildCanvasOperations(confirmed, document) : []
    if (mountedRef.current) setSaveState('saving')
    const task = (async () => {
      try {
        const graph = forceFullSaveRef.current || !confirmed
          ? await canvasApi.saveDocument(projectId, canvasId, document)
          : operations.length > 0
            ? await canvasApi.saveOperations(projectId, canvasId, {
                expectedRevision,
                clientId: clientIdRef.current,
                changeSummary: summaryRef.current,
                ops: operations,
              })
            : null
        if (graph) {
          revisionRef.current = graph.canvas.revision
          confirmedDocumentRef.current = canvasGraphToDocument(graph, clientIdRef.current, summaryRef.current)
          forceFullSaveRef.current = false
          revisionChannelRef.current?.postMessage({
            type: 'canvas-revision',
            source: tabIdRef.current,
            revision: graph.canvas.revision,
          } satisfies CanvasRevisionBroadcast)
        }
        automaticConflictMergesRef.current = 0
        lastErrorRef.current = null
        retryControllerRef.current?.reset()
        if (dirtyRef.current) {
          await offlineBufferRef.current?.flush()
        } else {
          await offlineBufferRef.current?.clear()
        }
        if (!mountedRef.current) return
        if (graph) onSavedRef.current(graph)
        if (dirtyRef.current) {
          setSaveState('pending')
        } else {
          setSaveState('saved')
          window.setTimeout(() => setSaveState((current) => current === 'saved' ? 'idle' : current), 2_200)
        }
      } catch (error) {
        dirtyRef.current = true
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
        savingRef.current = null
      }
    })()
    savingRef.current = task
    await task
    if (dirtyRef.current && !pausedRef.current && !retryControllerRef.current?.hasPending()) {
      timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(SAVE_DELAY_MS, tabIdRef.current))
    }
  }, [canvasId, clearSaveTimer, mergeLatestServerVersion, projectId])

  useEffect(() => { flushRef.current = flush }, [flush])

  useEffect(() => {
    let active = true
    clearSaveTimer()
    retryControllerRef.current?.dispose()

    revisionRef.current = initialRevision
    tabIdRef.current = createBrowserId()
    clientIdRef.current = `${getClientId()}:${tabIdRef.current}`.slice(0, 120)
    automaticConflictMergesRef.current = 0
    dirtyRef.current = false
    pausedRef.current = offlineEnabled
    summaryRef.current = '编辑画布'
    lastErrorRef.current = null
    offlineDraftRef.current = null
    confirmedDocumentRef.current = buildRef.current(
      initialRevision,
      clientIdRef.current,
      '编辑画布',
    )
    forceFullSaveRef.current = false
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
      read: () => {
        if (!namespace || !dirtyRef.current) return null
        const document = buildRef.current(revisionRef.current, clientIdRef.current, summaryRef.current)
        return createCanvasOfflineDraft({
          namespace,
          document,
          pendingOps: forceFullSaveRef.current || !confirmedDocumentRef.current
            ? []
            : buildCanvasOperations(confirmedDocumentRef.current, document),
          lastServerRevision: revisionRef.current,
          retryAttempt: retryController.failureCount(),
          lastError: lastErrorRef.current,
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
        pausedRef.current = false
        setOfflineRecoveryState('none')
      })

    return () => {
      active = false
      clearSaveTimer()
      retryController.dispose()
      const shouldFlush = dirtyRef.current && !pausedRef.current
      void buffer.dispose({ flush: shouldFlush }).catch(() => undefined)
    }
  }, [accountId, canvasId, clearSaveTimer, initialRevision, offlineEnabled, projectId])

  const scheduleSave = useCallback((summary = '编辑画布') => {
    if (pausedRef.current) return
    dirtyRef.current = true
    summaryRef.current = summary
    offlineBufferRef.current?.schedule()
    if (mountedRef.current) {
      setSaveState((current) => current === 'saving' || current === 'offline' ? current : 'pending')
    }
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
      forceFullSaveRef.current = false
      automaticConflictMergesRef.current = 0
      if (preserveLocalChanges) {
        mergeIncomingGraph(graph, '同步并合并其他标签页更改')
        dirtyRef.current = true
        summaryRef.current = '同步并合并其他标签页更改'
        offlineBufferRef.current?.schedule()
        clearSaveTimer()
        timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(RESTORE_SAVE_DELAY_MS, tabIdRef.current))
        if (mountedRef.current) setSaveState('pending')
        return
      }

      revisionRef.current = graph.canvas.revision
      confirmedDocumentRef.current = canvasGraphToDocument(graph, clientIdRef.current)
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
    forceFullSaveRef.current = false
    dirtyRef.current = false
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
  }, [canvasId, projectId])

  const mergeServerVersion = useCallback(async () => {
    const graph = await canvasApi.get(projectId, canvasId)
    mergeIncomingGraph(graph, '重新合并多标签更改')
    forceFullSaveRef.current = false
    pausedRef.current = false
    automaticConflictMergesRef.current = 0
    setConflictOpen(false)
    setSaveState('pending')
    dirtyRef.current = true
    summaryRef.current = '重新合并多标签更改'
    offlineBufferRef.current?.schedule()
    clearSaveTimer()
    timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(RESTORE_SAVE_DELAY_MS, tabIdRef.current))
  }, [canvasId, clearSaveTimer, mergeIncomingGraph, projectId])

  const restoreLocalVersion = useCallback(async () => {
    const draft = offlineDraftRef.current
    if (!draft) return
    const document = resolveCanvasOfflineRecoveryChoice({
      draft,
      choice: 'local',
      serverRevision: revisionRef.current,
      clientId: clientIdRef.current,
    })
    if (!document) return
    onRestoreLocalRef.current(document)
    dirtyRef.current = true
    forceFullSaveRef.current = true
    pausedRef.current = false
    summaryRef.current = '恢复本地未同步版本'
    lastErrorRef.current = null
    retryControllerRef.current?.reset()
    automaticConflictMergesRef.current = 0
    offlineDraftRef.current = null
    setOfflineDraft(null)
    setOfflineRecoveryState('none')
    setSaveState('pending')
    await offlineBufferRef.current?.flush()
    clearSaveTimer()
    timerRef.current = setTimeout(() => void flushRef.current(), canvasTabSaveDelay(RESTORE_SAVE_DELAY_MS, tabIdRef.current))
  }, [clearSaveTimer])

  const useServerVersion = useCallback(async () => {
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
    pausedRef.current = false
    forceFullSaveRef.current = false
    summaryRef.current = '编辑画布'
    lastErrorRef.current = null
    retryControllerRef.current?.reset()
    automaticConflictMergesRef.current = 0
    await offlineBufferRef.current?.clear()
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
    if (dirtyRef.current) await flushRef.current()
    const trailingSave = savingRef.current
    if (trailingSave) await trailingSave
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

  const acceptExternalRevision = useCallback(async (expectedRevision: number, nextRevision: number) => {
    const pendingSave = savingRef.current
    if (pendingSave) await pendingSave
    if (!canAcceptExternalRevision(revisionRef.current, expectedRevision, nextRevision)) return false

    revisionRef.current = nextRevision
    revisionChannelRef.current?.postMessage({
      type: 'canvas-revision',
      source: tabIdRef.current,
      revision: nextRevision,
    } satisfies CanvasRevisionBroadcast)
    if (confirmedDocumentRef.current) {
      confirmedDocumentRef.current = canvasDocumentWithRevision(
        confirmedDocumentRef.current,
        nextRevision,
        clientIdRef.current,
      )
    }
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
    flush,
    retry,
    loadServerVersion,
    mergeServerVersion,
    restoreLocalVersion,
    useServerVersion,
    prepareRevisionedMutation,
    acceptExternalRevision,
  }
}
