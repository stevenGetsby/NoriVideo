'use client'

import { useCallback, useRef, useState } from 'react'
import { createCanvasHistoryStack, type CanvasEditorSnapshot } from './canvas-history-stack'

export type { CanvasEditorSnapshot }

export function useCanvasHistory(limit = 80) {
  const stackRef = useRef<ReturnType<typeof createCanvasHistoryStack> | null>(null)
  if (!stackRef.current) stackRef.current = createCanvasHistoryStack(limit)
  const stack = stackRef.current
  const [version, setVersion] = useState(0)

  const record = useCallback((label: string, current: CanvasEditorSnapshot) => {
    stack.record(label, current)
    setVersion((value) => value + 1)
  }, [stack])

  const undo = useCallback((current: CanvasEditorSnapshot) => {
    const next = stack.undo(current)
    if (next) setVersion((value) => value + 1)
    return next
  }, [stack])

  const redo = useCallback((current: CanvasEditorSnapshot) => {
    const next = stack.redo(current)
    if (next) setVersion((value) => value + 1)
    return next
  }, [stack])

  const reset = useCallback(() => {
    stack.reset()
    setVersion((value) => value + 1)
  }, [stack])

  void version
  return {
    canUndo: stack.canUndo(),
    canRedo: stack.canRedo(),
    depth: stack.getDepth(),
    lastLabel: stack.getLastLabel(),
    getDepth: stack.getDepth,
    getLastLabel: stack.getLastLabel,
    getHead: stack.getHead,
    record,
    undo,
    redo,
    reset,
  }
}
