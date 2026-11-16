import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStoryActions, type StoryActionDeps } from '@/features/canvas/story/useStoryCanvasActions'
import { registerConfirmHandler } from '@/lib/ui/feedback'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'
import { STORY_FLOW_ROLE, STORY_MOUNT_ROLE } from '@/lib/interactive/types'

const flow = (id: string, sourceHandle: string, target: string): CanvasFlowEdge => ({
  id, source: 'interaction', sourceHandle, target, type: 'bezier', data: { role: STORY_FLOW_ROLE },
})
const mount: CanvasFlowEdge = { id: 'mount', source: 'scene', target: 'interaction', sourceHandle: 'interact', targetHandle: 'mount', data: { role: STORY_MOUNT_ROLE } }
const nodes: CanvasFlowNode[] = [
  { id: 'interaction', type: 'story_interaction', position: { x: 0, y: 0 }, data: { interaction: 'choice', title: '限时抉择', options: [{ id: 'opt_a', label: '选项一', effects: [], when: 'now', retry: false }, { id: 'opt_b', label: '选项二', effects: [], when: 'now', retry: false }], timeoutMode: 'exit', results: { timeout: { effects: [{ variableId: 'v', op: 'add', value: 1 }], when: 'after', retry: false } } } },
  { id: 'scene', type: 'story_scene', position: { x: 0, y: 0 }, data: { title: '剧情片段' } },
  { id: 'b', type: 'story_scene', position: { x: 0, y: 0 }, data: { title: '片段B' } },
  { id: 'c', type: 'story_scene', position: { x: 0, y: 0 }, data: { title: '片段C' } },
  { id: 'd', type: 'story_scene', position: { x: 0, y: 0 }, data: { title: '片段D' } },
]

function harness(edges = [flow('a', 'opt_a', 'b'), flow('b', 'opt_b', 'c'), flow('timeout', 'timeout', 'd'), mount]) {
  let currentNodes = nodes.map((node) => ({ ...node, data: { ...node.data } }))
  let currentEdges = [...edges]
  const history: Array<{ nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] }> = []
  const record = vi.fn(() => history.push({ nodes: structuredClone(currentNodes), edges: structuredClone(currentEdges) }))
  const deps: StoryActionDeps = {
    story: null, writeLocked: false, flow: null,
    flowStore: { getState: () => ({ nodeLookup: new Map(), width: 0, height: 0, transform: [0, 0, 1] }) as never },
    nodesRef: { current: currentNodes }, edgesRef: { current: currentEdges },
    setNodes: vi.fn((next) => { currentNodes = typeof next === 'function' ? next(currentNodes) : next; deps.nodesRef.current = currentNodes }),
    setEdges: vi.fn((next) => { currentEdges = typeof next === 'function' ? next(currentEdges) : next; deps.edgesRef.current = currentEdges }),
    setWireMenu: vi.fn(), record, markChanged: vi.fn(), ensureNodeCapacity: () => true, toast: vi.fn(),
    toFlowPoint: (point) => point, animateNodeLayout: vi.fn(), removeEdges: vi.fn(), maxEdges: 100,
  }
  return { actions: createStoryActions({ current: deps }), deps, record, history, getNodes: () => currentNodes, getEdges: () => currentEdges }
}

afterEach(() => vi.restoreAllMocks())

describe('retargetInteraction', () => {
  it('preserves matching ports and unrelated edges without confirmation or extra history', async () => {
    const h = harness([flow('success', 'success', 'b'), flow('fail', 'fail', 'c'), mount])
    h.getNodes()[0].data = { interaction: 'tap', title: '快速点击' }
    await h.actions.retargetInteraction('interaction', 'swipe')
    expect(h.getEdges()).toEqual([expect.objectContaining({ id: 'success', sourceHandle: 'success' }), expect.objectContaining({ id: 'fail', sourceHandle: 'fail' }), mount])
    expect(h.getEdges()[2]).toBe(mount)
    expect(h.record).toHaveBeenCalledTimes(1)
    expect(h.getNodes()[0].data.interaction).toBe('swipe')
  })

  it('lists all dropped branches, leaves references unchanged on cancel, and restores in one undo', async () => {
    const confirm = vi.fn((request: { message: string; resolve: (value: boolean) => void }) => { request.resolve(false); return () => {} })
    const unregister = registerConfirmHandler(confirm)
    const h = harness()
    const oldNodes = h.getNodes()
    const oldEdges = h.getEdges()
    await h.actions.retargetInteraction('interaction', 'tap')
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0].message).toContain('2 条分支线')
    expect(confirm.mock.calls[0][0].message).toContain('选项一→片段B、选项二→片段C')
    expect(h.getNodes()).toBe(oldNodes)
    expect(h.getEdges()).toBe(oldEdges)
    expect(h.record).not.toHaveBeenCalled()
    unregister()
    registerConfirmHandler((request) => { request.resolve(true); return () => {} })
    await h.actions.retargetInteraction('interaction', 'tap')
    expect(h.getEdges()).toEqual([expect.objectContaining({ id: 'timeout', sourceHandle: 'fail' }), mount])
    const results = h.getNodes()[0].data.results as Record<string, unknown>
    expect(results.fail).toEqual({ effects: [{ variableId: 'v', op: 'add', value: 1 }], when: 'after', retry: false })
    expect(h.history).toHaveLength(1)
    h.deps.nodesRef.current = h.history[0].nodes
    h.deps.edgesRef.current = h.history[0].edges
    expect(h.deps.nodesRef.current).toEqual(oldNodes)
    expect(h.deps.edgesRef.current).toEqual(oldEdges)
  })
})
