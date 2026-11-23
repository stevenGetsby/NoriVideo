'use client'

import { useEffect, useRef } from 'react'

export function startVisiblePolling(callback: () => void | Promise<void>, intervalMs: number): () => void {
  let cancelled = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    if (cancelled || running || document.visibilityState === 'hidden') return
    running = true
    try {
      await callback()
    } catch {
      // Best-effort polling: the callback reports its own errors; a rejected tick must not become an unhandled rejection.
    } finally {
      running = false
      if (!cancelled) timer = setTimeout(run, intervalMs)
    }
  }
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || cancelled) return
    if (timer) clearTimeout(timer)
    void run()
  }
  void run()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export function useVisiblePolling(callback: () => void | Promise<void>, intervalMs: number | null): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (intervalMs === null) return
    return startVisiblePolling(() => callbackRef.current(), intervalMs)
  }, [intervalMs])
}
