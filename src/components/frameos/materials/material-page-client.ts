import type { UIEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { FrameosMaterialItem } from './contracts'

export const MATERIAL_PAGE_SIZE = 48

export type MaterialPage = {
  materials: FrameosMaterialItem[]
  nextCursor: string | null
  total: number | null
  missingVoiceCount: number
}

export async function fetchFrameosMaterialPage(params: URLSearchParams, signal?: AbortSignal): Promise<MaterialPage> {
  const response = await apiFetch(`/api/frameos/materials?${params}`, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载素材失败'))
  const payload = await response.json() as {
    materials?: FrameosMaterialItem[]
    pagination?: { nextCursor?: string | null; total?: number; missingVoiceCount?: number }
  }
  return {
    materials: Array.isArray(payload.materials) ? payload.materials : [],
    nextCursor: payload.pagination?.nextCursor || null,
    total: typeof payload.pagination?.total === 'number' ? payload.pagination.total : null,
    missingVoiceCount: payload.pagination?.missingVoiceCount || 0,
  }
}

export function boundedWindow(index: number, length: number, before = 12, after = 48, maximum = 96) {
  const count = Math.min(maximum, Math.max(0, length))
  const start = Math.max(0, Math.min(index - before, length - count))
  return { start, end: Math.min(length, start + count), after }
}

/** A fixed row stride preserves native scrolling while mounted cards stay bounded. */
export function useWindowedList<T>(items: readonly T[], rowHeight: number, rowCount: (item: T) => number = () => 1) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [, setScrollTop] = useState(0)
  const scrollTopRef = useRef(0)
  const [height, setHeight] = useState(600)
  const offsetsRef = useRef<number[]>([])
  let total = 0
  const offsets = items.map((item) => {
    const offset = total
    total += rowHeight * rowCount(item)
    return offset
  })
  offsetsRef.current = offsets
  const indexAt = (top: number) => {
    let low = 0
    let high = offsetsRef.current.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if ((offsetsRef.current[middle] || 0) <= top) low = middle + 1
      else high = middle
    }
    return Math.max(0, low - 1)
  }
  const window = boundedWindow(indexAt(scrollTopRef.current), items.length, 12, Math.max(48, Math.ceil(height / rowHeight) * 8))
  useEffect(() => {
    const element = scrollerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    scrollTopRef.current = event.currentTarget.scrollTop
    setScrollTop(event.currentTarget.scrollTop)
  }, [])
  const resetWindow = useCallback(() => {
    scrollTopRef.current = 0
    setScrollTop(0)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }, [])
  return { scrollerRef, onScroll, resetWindow, totalHeight: total, window, offsets }
}
