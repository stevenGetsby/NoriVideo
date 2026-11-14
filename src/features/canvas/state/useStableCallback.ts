import { useCallback, useLayoutEffect, useRef } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any

/**
 * Returns a function whose identity never changes but which always runs the
 * latest closure. React Flow re-renders every node whenever one of its handler
 * props changes identity, so handlers passed to it must not be recreated per render.
 */
export function useStableCallback<T extends AnyFunction>(callback: T): T {
  const latest = useRef(callback)
  useLayoutEffect(() => { latest.current = callback })
  return useCallback(((...args: Parameters<T>) => latest.current(...args)) as T, [])
}
