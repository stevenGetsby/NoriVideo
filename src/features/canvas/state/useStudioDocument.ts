'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import {
  mergeCanvasStudioScenes,
  normalizeCanvasStudioScene,
  type CanvasStudioScene,
} from '../studio-types'

export type StudioDocumentSaveState = 'loading' | 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

type StudioDocumentPayload = {
  studioDocument?: {
    projectId: string
    canvasId: string
    nodeId: string
    revision: number
    document: unknown
    updatedAt: string | null
    persisted: boolean
    source: 'document' | 'legacy-node' | 'default'
  }
}

type StudioConflict = {
  actualRevision: number
}

type SaveResult = 'saved' | 'dirty' | 'conflict' | 'error'

const SAVE_DEBOUNCE_MS = 800

function serializeScene(scene: CanvasStudioScene): string {
  return JSON.stringify(normalizeCanvasStudioScene(scene))
}

function apiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback
  const source = payload as Record<string, unknown>
  if (typeof source.message === 'string' && source.message.trim()) return source.message
  const error = source.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function actualRevision(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const source = payload as Record<string, unknown>
  if (typeof source.actualRevision === 'number') return source.actualRevision
  const error = source.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const details = (error as Record<string, unknown>).details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const revision = (details as Record<string, unknown>).actualRevision
  return typeof revision === 'number' ? revision : null
}

export function useStudioDocument({
  projectId,
  canvasId,
  nodeId,
  initialScene,
  deriveLoadedScene,
  readOnly,
}: {
  projectId: string
  canvasId: string
  nodeId: string
  initialScene: CanvasStudioScene
  deriveLoadedScene: (scene: CanvasStudioScene) => CanvasStudioScene
  readOnly: boolean
}) {
  const [scene, setScene] = useState<CanvasStudioScene>(initialScene)
  const sceneRef = useRef(scene)
  const [saveState, setSaveState] = useState<StudioDocumentSaveState>('loading')
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<StudioConflict | null>(null)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const persistedRef = useRef(false)
  const baseSceneRef = useRef(normalizeCanvasStudioScene(initialScene))
  const deriveLoadedSceneRef = useRef(deriveLoadedScene)
  const lastSavedRef = useRef('')
  const saveTimerRef = useRef<number | null>(null)
  const savePromiseRef = useRef<Promise<SaveResult> | null>(null)
  const queuedRef = useRef(false)
  const mountedRef = useRef(true)
  const [savePulse, setSavePulse] = useState(0)
  const clientIdRef = useRef<string | null>(null)
  if (!clientIdRef.current) clientIdRef.current = crypto.randomUUID()

  useEffect(() => {
    deriveLoadedSceneRef.current = deriveLoadedScene
  }, [deriveLoadedScene])

  const endpoint = `/api/projects/${projectId}/canvas/${canvasId}/nodes/${nodeId}/studio-document`

  const installServerDocument = useCallback((payload: StudioDocumentPayload, derive: boolean) => {
    const row = payload.studioDocument
    if (!row || row.projectId !== projectId || row.canvasId !== canvasId || row.nodeId !== nodeId || !Number.isInteger(row.revision)) {
      throw new Error('3D 导演台文档响应格式无效')
    }
    const serverScene = normalizeCanvasStudioScene(row.document)
    const nextScene = derive ? deriveLoadedSceneRef.current(serverScene) : serverScene
    revisionRef.current = row.revision
    setRevision(row.revision)
    persistedRef.current = row.persisted
    baseSceneRef.current = serverScene
    lastSavedRef.current = serializeScene(serverScene)
    sceneRef.current = nextScene
    setScene(nextScene)
    setReady(true)
    readyRef.current = true
    setConflict(null)
    setError(null)
    const needsWrite = !readOnly && (!row.persisted || serializeScene(nextScene) !== lastSavedRef.current)
    setSaveState(needsWrite ? 'dirty' : 'saved')
    if (needsWrite) setSavePulse((value) => value + 1)
    return serverScene
  }, [canvasId, nodeId, projectId, readOnly])

  const fetchDocument = useCallback(async (): Promise<StudioDocumentPayload> => {
    const response = await apiFetch(endpoint, { cache: 'no-store' })
    const payload = await response.json().catch(() => null) as StudioDocumentPayload | null
    if (!response.ok) throw new Error(apiError(payload, '3D 导演台文档加载失败'))
    if (!payload) throw new Error('3D 导演台文档未返回内容')
    return payload
  }, [endpoint])

  const load = useCallback(async () => {
    setSaveState('loading')
    setError(null)
    try {
      const payload = await fetchDocument()
      if (mountedRef.current) installServerDocument(payload, true)
    } catch (loadError) {
      if (!mountedRef.current) return
      setReady(false)
      readyRef.current = false
      setSaveState('error')
      setError(loadError instanceof Error ? loadError.message : '3D 导演台文档加载失败')
    }
  }, [fetchDocument, installServerDocument])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [load])

  const performSave = useCallback(async (snapshotValue: CanvasStudioScene): Promise<SaveResult> => {
    const snapshot = normalizeCanvasStudioScene(snapshotValue)
    const snapshotSerialized = serializeScene(snapshot)
    setSaveState('saving')
    setError(null)
    const expectedRevision = revisionRef.current
    try {
      const response = await apiFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision,
          document: snapshot,
          clientId: clientIdRef.current,
        }),
      })
      const payload = await response.json().catch(() => null) as StudioDocumentPayload | null
      if (response.status === 409) {
        const actual = actualRevision(payload) ?? expectedRevision
        setConflict({ actualRevision: actual })
        setSaveState('conflict')
        setError(apiError(payload, '3D 导演台文档发生版本冲突'))
        return 'conflict'
      }
      if (!response.ok) throw new Error(apiError(payload, '3D 导演台保存失败'))
      const row = payload?.studioDocument
      if (!row || !Number.isInteger(row.revision)) throw new Error('3D 导演台保存响应格式无效')
      const savedScene = normalizeCanvasStudioScene(row.document)
      revisionRef.current = row.revision
      setRevision(row.revision)
      persistedRef.current = true
      baseSceneRef.current = savedScene
      lastSavedRef.current = serializeScene(savedScene)
      const dirty = serializeScene(sceneRef.current) !== snapshotSerialized
      setSaveState(dirty ? 'dirty' : 'saved')
      if (dirty) setSavePulse((value) => value + 1)
      return dirty ? 'dirty' : 'saved'
    } catch (saveError) {
      setSaveState('error')
      setError(saveError instanceof Error ? saveError.message : '3D 导演台保存失败')
      return 'error'
    }
  }, [endpoint])

  const saveNow = useCallback(async (snapshot: CanvasStudioScene = sceneRef.current): Promise<SaveResult> => {
    if (readOnly || !readyRef.current || conflict) return conflict ? 'conflict' : 'error'
    if (savePromiseRef.current) {
      queuedRef.current = true
      return await savePromiseRef.current
    }
    const promise = performSave(snapshot)
    savePromiseRef.current = promise
    const result = await promise
    if (savePromiseRef.current === promise) savePromiseRef.current = null
    if (queuedRef.current) {
      queuedRef.current = false
      setSavePulse((value) => value + 1)
    }
    return result
  }, [conflict, performSave, readOnly])

  useEffect(() => {
    sceneRef.current = scene
    if (readOnly || !ready || conflict) return
    const serialized = serializeScene(scene)
    if (persistedRef.current && serialized === lastSavedRef.current) {
      if (!savePromiseRef.current) setSaveState('saved')
      return
    }
    if (!savePromiseRef.current) setSaveState('dirty')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void saveNow(sceneRef.current)
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [conflict, readOnly, ready, saveNow, savePulse, scene])

  const updateScene = useCallback((updater: (current: CanvasStudioScene) => CanvasStudioScene) => {
    if (readOnly || !readyRef.current || conflict) return
    setScene((current) => {
      const next = normalizeCanvasStudioScene(updater(current))
      sceneRef.current = next
      return next
    })
  }, [conflict, readOnly])

  const retry = useCallback(() => {
    if (!readyRef.current) {
      void load()
      return
    }
    setError(null)
    setSaveState('dirty')
    setSavePulse((value) => value + 1)
  }, [load])

  const useServerVersion = useCallback(async () => {
    setSaveState('loading')
    setError(null)
    try {
      const payload = await fetchDocument()
      installServerDocument(payload, false)
    } catch (loadError) {
      setSaveState('conflict')
      setError(loadError instanceof Error ? loadError.message : '服务端场景加载失败')
    }
  }, [fetchDocument, installServerDocument])

  const mergeAndRetry = useCallback(async () => {
    const localScene = sceneRef.current
    setSaveState('loading')
    setError(null)
    try {
      const payload = await fetchDocument()
      const row = payload.studioDocument
      if (!row) throw new Error('服务端场景未返回内容')
      const serverScene = normalizeCanvasStudioScene(row.document)
      const merged = mergeCanvasStudioScenes(baseSceneRef.current, localScene, serverScene)
      revisionRef.current = row.revision
      setRevision(row.revision)
      persistedRef.current = row.persisted
      baseSceneRef.current = serverScene
      lastSavedRef.current = serializeScene(serverScene)
      sceneRef.current = merged
      setScene(merged)
      setConflict(null)
      setSaveState('dirty')
      setSavePulse((value) => value + 1)
    } catch (mergeError) {
      setSaveState('conflict')
      setError(mergeError instanceof Error ? mergeError.message : '本地场景合并失败')
    }
  }, [fetchDocument])

  const flush = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true
    if (!readyRef.current || conflict) return false
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (savePromiseRef.current) await savePromiseRef.current
    if (persistedRef.current && serializeScene(sceneRef.current) === lastSavedRef.current) return true
    const result = await saveNow(sceneRef.current)
    if (result === 'dirty') {
      const retryResult = await saveNow(sceneRef.current)
      return retryResult === 'saved'
    }
    return result === 'saved'
  }, [conflict, readOnly, saveNow])

  return {
    scene,
    updateScene,
    saveState,
    revision,
    error,
    conflict,
    ready,
    retry,
    useServerVersion,
    mergeAndRetry,
    flush,
  }
}
