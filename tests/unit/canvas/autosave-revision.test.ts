import { describe, expect, it } from 'vitest'
import { canAcceptExternalRevision, canvasTabSaveDelay, parseCanvasRevisionBroadcast } from '@/features/canvas/state/useCanvasAutosave'

describe('canvas autosave external revision handoff', () => {
  it('accepts the exact next revision when no other save advanced the client', () => {
    expect(canAcceptExternalRevision(8, 8, 9)).toBe(true)
  })

  it('rejects stale sync responses after another save advanced the client', () => {
    expect(canAcceptExternalRevision(9, 8, 9)).toBe(false)
  })

  it('rejects skipped or non-incrementing server revisions', () => {
    expect(canAcceptExternalRevision(8, 8, 8)).toBe(false)
    expect(canAcceptExternalRevision(8, 8, 10)).toBe(false)
  })

  it('accepts only well-formed revision broadcasts from sibling tabs', () => {
    expect(parseCanvasRevisionBroadcast({ type: 'canvas-revision', source: 'tab-b', revision: 12 })).toEqual({
      type: 'canvas-revision',
      source: 'tab-b',
      revision: 12,
    })
    expect(parseCanvasRevisionBroadcast({ type: 'canvas-revision', source: '', revision: 12 })).toBeNull()
    expect(parseCanvasRevisionBroadcast({ type: 'canvas-revision', source: 'tab-b', revision: 1.5 })).toBeNull()
    expect(parseCanvasRevisionBroadcast({ type: 'other', source: 'tab-b', revision: 12 })).toBeNull()
  })

  it('stagger-schedules sibling tabs while keeping a bounded autosave delay', () => {
    const first = canvasTabSaveDelay(800, 'tab-a')
    const second = canvasTabSaveDelay(800, 'tab-b')
    expect(first).toBeGreaterThanOrEqual(800)
    expect(first).toBeLessThanOrEqual(980)
    expect(second).not.toBe(first)
    expect(canvasTabSaveDelay(800, 'tab-a')).toBe(first)
  })
})
