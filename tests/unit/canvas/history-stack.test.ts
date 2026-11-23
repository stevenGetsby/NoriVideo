import { describe, expect, it } from 'vitest'
import { createCanvasHistoryStack, type CanvasEditorSnapshot } from '@/features/canvas/state/canvas-history-stack'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'

const node = (id: string, x = 0) => ({ id, type: 'text', position: { x, y: 0 }, data: { title: id } }) as unknown as CanvasFlowNode
const edge = (id: string) => ({ id, source: 'a', target: 'b' }) as unknown as CanvasFlowEdge
const view = (nodes: CanvasFlowNode[], edges: CanvasFlowEdge[] = [], x = 0): CanvasEditorSnapshot => ({
  nodes,
  edges,
  viewport: { x, y: 0, zoom: 1 },
})

describe('canvas history stack', () => {
  it('undoes and redoes whole editor states', () => {
    const history = createCanvasHistoryStack()
    const before = view([node('a')])
    const after = view([node('a'), node('b')], [edge('e1')], 5)
    history.record('add b', before)

    const undone = history.undo(after)
    expect(undone?.nodes.map((item) => item.id)).toEqual(['a'])
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)

    const redone = history.redo(undone!)
    expect(redone?.nodes.map((item) => item.id)).toEqual(['a', 'b'])
    expect(redone?.edges.map((item) => item.id)).toEqual(['e1'])
    expect(redone?.viewport.x).toBe(5)
  })

  it('shares unchanged entities instead of cloning the graph', () => {
    const history = createCanvasHistoryStack()
    const untouched = node('a')
    history.record('move b', view([untouched, node('b')]))
    const restored = history.undo(view([untouched, node('b', 40)]))!
    expect(restored.nodes[0]).toBe(untouched)
  })

  it('is not corrupted when the caller changes the arrays it passed or received', () => {
    const history = createCanvasHistoryStack()
    const nodes = [node('a'), node('b')]
    history.record('edit', view(nodes))
    nodes.push(node('c'))
    const restored = history.undo(view(nodes))!
    expect(restored.nodes.map((item) => item.id)).toEqual(['a', 'b'])
    restored.nodes.length = 0
    const again = history.redo(restored)!
    expect(again.nodes.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the newest 80 steps and clears redo on a new edit', () => {
    const history = createCanvasHistoryStack()
    for (let index = 0; index < 90; index += 1) history.record(`step ${index}`, view([node(`n${index}`)]))
    let steps = 0
    let current = view([node('now')])
    for (;;) {
      const next = history.undo(current)
      if (!next) break
      current = next
      steps += 1
    }
    expect(steps).toBe(80)
    expect(current.nodes[0].id).toBe('n10')

    history.record('again', view([node('x')]))
    expect(history.canRedo()).toBe(false)
  })

  it('returns null when there is nothing to undo or redo, and reset empties both stacks', () => {
    const history = createCanvasHistoryStack()
    expect(history.undo(view([]))).toBeNull()
    expect(history.redo(view([]))).toBeNull()
    history.record('x', view([node('a')]))
    history.undo(view([]))
    history.reset()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
  })
})
