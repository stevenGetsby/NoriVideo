'use client'

import { useCallback, useEffect, useRef } from 'react'
import { CanvasNodeDetailCache } from './canvas-node-detail-cache'

/** Summary-mode reads share the same bounded cache and abort when leaving the canvas. */
export function useCanvasNodeDetails(accountId: string, projectId: string, canvasId: string) {
  const cacheRef = useRef<CanvasNodeDetailCache | null>(null)
  if (!cacheRef.current) cacheRef.current = new CanvasNodeDetailCache()
  const controllersRef = useRef(new Set<AbortController>())
  const scopeRef = useRef({ accountId, projectId, canvasId })
  scopeRef.current = { accountId, projectId, canvasId }

  useEffect(() => {
    const controllers = controllersRef.current
    const cache = cacheRef.current!
    return () => {
      for (const controller of controllers) controller.abort()
      controllers.clear()
      cache.invalidate(scopeRef.current)
    }
  }, [accountId, canvasId, projectId])

  return useCallback(async (nodeId: string, summary?: Parameters<CanvasNodeDetailCache['get']>[1]) => {
    const cached = summary ? cacheRef.current!.get(scopeRef.current, summary) : null
    if (cached) return cached
    const controller = new AbortController()
    controllersRef.current.add(controller)
    try {
      return await cacheRef.current!.load(scopeRef.current, nodeId, controller.signal)
    } finally {
      controllersRef.current.delete(controller)
    }
  }, [])
}
