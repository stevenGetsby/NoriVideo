'use client'

import { useCallback, useRef, useState } from 'react'
import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'
import type { Viewport } from '../types'

export type CanvasEditorSnapshot = {
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  viewport: Viewport
}

type HistoryEntry = { label: string; snapshot: CanvasEditorSnapshot }

function cloneSnapshot(snapshot: CanvasEditorSnapshot): CanvasEditorSnapshot {
  return structuredClone(snapshot)
}

export function useCanvasHistory(limit = 80) {
  const pastRef = useRef<HistoryEntry[]>([])
  const futureRef = useRef<HistoryEntry[]>([])
  const [version, setVersion] = useState(0)

  const record = useCallback((label: string, current: CanvasEditorSnapshot) => {
    pastRef.current.push({ label, snapshot: cloneSnapshot(current) })
    if (pastRef.current.length > limit) pastRef.current.splice(0, pastRef.current.length - limit)
    futureRef.current = []
    setVersion((value) => value + 1)
  }, [limit])

  const undo = useCallback((current: CanvasEditorSnapshot) => {
    const entry = pastRef.current.pop()
    if (!entry) return null
    futureRef.current.push({ label: entry.label, snapshot: cloneSnapshot(current) })
    setVersion((value) => value + 1)
    return cloneSnapshot(entry.snapshot)
  }, [])

  const redo = useCallback((current: CanvasEditorSnapshot) => {
    const entry = futureRef.current.pop()
    if (!entry) return null
    pastRef.current.push({ label: entry.label, snapshot: cloneSnapshot(current) })
    setVersion((value) => value + 1)
    return cloneSnapshot(entry.snapshot)
  }, [])

  const reset = useCallback(() => {
    pastRef.current = []
    futureRef.current = []
    setVersion((value) => value + 1)
  }, [])

  void version
  return {
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    record,
    undo,
    redo,
    reset,
  }
}
