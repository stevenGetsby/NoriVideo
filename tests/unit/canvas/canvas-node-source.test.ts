import { describe, expect, it, vi } from 'vitest'
import { createCanvasNodeSource } from '@/features/canvas/canvas-node-source'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

const node = (id: string) => ({ id, type: 'text', position: { x: 0, y: 0 }, data: {} }) as unknown as CanvasFlowNode

describe('canvas node source', () => {
  it('serves nodes by id from the latest published array', () => {
    const a = node('a')
    const b = node('b')
    const source = createCanvasNodeSource([a])
    expect(source.byId('a')).toBe(a)
    expect(source.byId('b')).toBeUndefined()
    source.publish([a, b])
    expect(source.get()).toEqual([a, b])
    expect(source.byId('b')).toBe(b)
  })

  it('rebuilds the id index after a publish so removed nodes disappear', () => {
    const a = node('a')
    const b = node('b')
    const source = createCanvasNodeSource([a, b])
    expect(source.byId('b')).toBe(b)
    source.publish([a])
    expect(source.byId('b')).toBeUndefined()
  })

  it('notifies subscribers only when the array identity changes', () => {
    const nodes = [node('a')]
    const source = createCanvasNodeSource(nodes)
    const listener = vi.fn()
    source.subscribe(listener)
    source.publish(nodes)
    expect(listener).not.toHaveBeenCalled()
    source.publish([...nodes])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe and tolerates unsubscribing during a notification', () => {
    const source = createCanvasNodeSource([])
    const calls: string[] = []
    const stopFirst = source.subscribe(() => {
      calls.push('first')
      stopFirst()
    })
    source.subscribe(() => calls.push('second'))
    source.publish([node('a')])
    source.publish([node('b')])
    expect(calls).toEqual(['first', 'second', 'second'])
  })
})
