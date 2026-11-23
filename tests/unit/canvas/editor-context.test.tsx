// @vitest-environment happy-dom
import { act, memo } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import * as context from '@/features/canvas/CanvasEditorContext'

it('updates save controls without invalidating memoized canvas cards', async () => {
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const before = environment.IS_REACT_ACT_ENVIRONMENT
  environment.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  let cardRenders = 0
  const Card = memo(() => {
    cardRenders += 1
    return <span>{context.useCanvasEditor().readOnly ? '只读' : '可编辑'}</span>
  })
  function Timeline() {
    return <span>{context.useCanvasEditorPersistence().saveState}</span>
  }
  const value = { readOnly: false } as context.CanvasEditorActions
  const children = <><Card /><Timeline /></>
  try {
    await act(async () => root.render(<context.CanvasEditorProvider value={value} persistence={{ saveState: 'saving', canUndo: false, canRedo: false }}>{children}</context.CanvasEditorProvider>))
    await act(async () => root.render(<context.CanvasEditorProvider value={value} persistence={{ saveState: 'saved', canUndo: true, canRedo: false }}>{children}</context.CanvasEditorProvider>))
    expect(container.textContent).toBe('可编辑saved')
    expect(cardRenders).toBe(1)
  } finally {
    await act(async () => root.unmount())
    environment.IS_REACT_ACT_ENVIRONMENT = before
  }
})
