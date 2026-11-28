'use client'

import { createContext, createElement, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { CanvasFlowNode } from './editor-types'

export type CanvasNodeSource = {
  get(): CanvasFlowNode[]
  byId(id: string): CanvasFlowNode | undefined
  publish(nodes: CanvasFlowNode[], options?: { notify?: boolean }): void
  subscribe(listener: () => void): () => void
}

export function createCanvasNodeSource(initial: CanvasFlowNode[] = []): CanvasNodeSource {
  let nodes = initial
  let index: Map<string, CanvasFlowNode> | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => nodes,
    byId(id) {
      if (!index) index = new Map(nodes.map((node) => [node.id, node]))
      return index.get(id)
    },
    publish(next, options) {
      if (next === nodes) return
      nodes = next
      index = null
      if (options?.notify === false) return
      for (const listener of Array.from(listeners)) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const CanvasNodeSourceContext = createContext<CanvasNodeSource | null>(null)

export function CanvasNodeSourceProvider({ source, children }: { source: CanvasNodeSource | null; children: ReactNode }) {
  return createElement(CanvasNodeSourceContext.Provider, { value: source }, children)
}

export function useCanvasNodeSource(): CanvasNodeSource | null {
  return useContext(CanvasNodeSourceContext)
}

const noopSubscribe = () => () => {}

// `select` must be referentially stable (module-level or memoized); the snapshot is cached until nodes or `select` change.
export function useCanvasNodeSourceSelector<T>(
  source: CanvasNodeSource | null,
  select: (nodes: CanvasFlowNode[], byId: (id: string) => CanvasFlowNode | undefined) => T,
  equal: (a: T, b: T) => boolean,
  fallback: T,
): T {
  const cache = useRef<{ nodes: CanvasFlowNode[]; select: typeof select; value: T } | null>(null)
  const getSnapshot = () => {
    if (!source) return fallback
    const nodes = source.get()
    const cached = cache.current
    if (cached && cached.nodes === nodes && cached.select === select) return cached.value
    const value = select(nodes, source.byId)
    if (cached && equal(cached.value, value)) {
      cache.current = { nodes, select, value: cached.value }
      return cached.value
    }
    cache.current = { nodes, select, value }
    return value
  }
  return useSyncExternalStore(source ? source.subscribe : noopSubscribe, getSnapshot, () => fallback)
}
