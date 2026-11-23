import { expect, it } from 'vitest'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'
import { createAgentTaskTracker } from '@/features/canvas/agent/task-watcher'

function node(id: string, status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'): CanvasFlowNode {
  return {
    id, type: 'image', position: { x: 0, y: 0 },
    data: { __server: { status, taskId: 'fixture', runId: null, mediaObjectId: null, parentNodeId: null } },
  }
}

it('observes busy-to-terminal transitions once, without confusing an older result for a new run', () => {
  const tracker = createAgentTaskTracker()
  tracker.track([{ id: 'a', token: 'old', observedBusy: true }, { id: 'b', token: 'next', observedBusy: false }])
  expect(tracker.poll([node('a', 'SUCCEEDED'), node('b', 'SUCCEEDED')])).toEqual({ completed: 1, failed: 0 })
  expect(tracker.poll([node('a', 'SUCCEEDED'), node('b', 'RUNNING')])).toEqual({ completed: 0, failed: 0 })
  expect(tracker.poll([node('a', 'SUCCEEDED'), node('b', 'FAILED')])).toEqual({ completed: 0, failed: 1 })
  tracker.track([{ id: 'a', token: 'old', observedBusy: true }])
  expect(tracker.active()).toBe(false)
  tracker.track([{ id: 'a', token: 'new', observedBusy: true }])
  expect(tracker.poll([node('a', 'SUCCEEDED')])).toEqual({ completed: 1, failed: 0 })
})
