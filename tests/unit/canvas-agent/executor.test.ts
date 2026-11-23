import { expect, it, vi } from 'vitest'
import { createToolExecutor, type CanvasAgentExecutionContext, type CanvasAgentToolResult } from '@/features/canvas/agent/executor'
import type { CanvasFlowNode, CanvasFlowEdge } from '@/features/canvas/editor-types'
import type { AgentGraphChange, CanvasAgentBridge } from '@/features/canvas/agent/bridge-types'

const node = (id: string, title = id): CanvasFlowNode => ({ id, type: 'text', position: { x: 0, y: 0 }, data: { title } })

function fixture() {
  let nodes = [node('id-1', '首镜')]
  let edges: CanvasFlowEdge[] = []
  const commit = vi.fn((change: AgentGraphChange) => { nodes = change.nodes; edges = change.edges })
  const bridge: CanvasAgentBridge = {
    projectId: 'fixture', canvasId: 'fixture', mode: 'canvas', readOnly: false,
    limits: { maxNodes: 1000, maxEdges: 4000 },
    getGraph: () => ({ nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }),
    getViewportBounds: () => ({ x: 0, y: 0, width: 300, height: 300 }),
    centerPosition: () => ({ x: 0, y: 0 }), isWriteLocked: vi.fn(() => false),
    beginTurn: vi.fn(), endTurn: vi.fn(() => null), undoTurn: vi.fn(), canUndoTurn: vi.fn(() => false),
    run: async (fn) => await fn(), commit, select: vi.fn(), focus: vi.fn(), flash: vi.fn(),
    generate: vi.fn(async () => undefined), runNodeAction: vi.fn(),
  }
  const write = vi.fn<(value: CanvasAgentToolResult) => void>()
  const ctx: CanvasAgentExecutionContext = {
    bridge, turn: { toolCalls: 0, questions: 0, quotedPoints: 0 }, stopped: () => false,
    confirmBlueprint: vi.fn(async () => true), confirmDelete: vi.fn(async () => false), ask: vi.fn(async () => '答案'),
    hasExplicitDeleteIntent: () => true,
  }
  return { ctx, write, commit, execute: createToolExecutor(() => ctx, write), replaceNodes: (items: CanvasFlowNode[]) => { nodes = items } }
}

it('serializes calls, reads the previous mutation, and commits one graph per write tool', async () => {
  const { execute, write, commit } = fixture()
  const first = execute({ toolCallId: '1', toolName: 'update_nodes', input: { updates: [{ node: '首镜', title: '新首镜' }] } })
  const second = execute({ toolCallId: '2', toolName: 'read_node', input: { node: '新首镜' } })
  await Promise.all([first, second])
  expect(commit).toHaveBeenCalledOnce()
  expect(write.mock.calls.map(([result]) => result.toolCallId)).toEqual(['1', '2'])
  expect(write.mock.calls[1]?.[0]).toMatchObject({ output: { status: 'done', node: { title: '新首镜' } } })
})

it('rejects invalid and locked tools, and caps one turn at 24 calls', async () => {
  const { execute, ctx, write, commit } = fixture()
  await execute({ toolCallId: '1', toolName: 'update_nodes', input: { updates: [] } })
  vi.mocked(ctx.bridge.isWriteLocked).mockReturnValue(true)
  await execute({ toolCallId: '2', toolName: 'update_nodes', input: { updates: [{ node: '首镜', title: '新' }] } })
  ctx.turn.toolCalls = 24
  await execute({ toolCallId: '3', toolName: 'find_nodes', input: {} })
  expect(write.mock.calls.map(([output]) => 'errorText' in output ? output.errorText : '')).toEqual([
    expect.stringMatching(/^BAD_INPUT/), expect.stringMatching(/^CANVAS_LOCKED/), expect.stringMatching(/^TURN_LIMIT/),
  ])
  expect(commit).not.toHaveBeenCalled()
})

it('will not apply a destructive action to a different graph after confirmation', async () => {
  const { execute, ctx, write, commit, replaceNodes } = fixture()
  replaceNodes([{ ...node('old', '须确认'), data: { title: '须确认', contentUrl: '/fixture.png' } }])
  vi.mocked(ctx.confirmDelete).mockImplementation(async () => {
    replaceNodes([node('new', '须确认')])
    return true
  })
  await execute({ toolCallId: '1', toolName: 'delete_nodes', input: { nodes: ['须确认'], reason: '用户明确要求' } })
  expect(commit).not.toHaveBeenCalled()
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ errorText: expect.stringMatching(/^CANVAS_CHANGED/) }))
})

it('does not repeat a write when a stream repeats a tool call ID', async () => {
  const { ctx, execute, write, commit } = fixture()
  const input = { title: '新增节点', nodes: [{ key: 'n1', type: 'text', title: '第二镜' }] }
  await Promise.all([
    execute({ toolCallId: 'replayed-call', toolName: 'build_graph', input }),
    execute({ toolCallId: 'replayed-call', toolName: 'build_graph', input }),
  ])
  expect(commit).toHaveBeenCalledOnce()
  expect(write).toHaveBeenCalledOnce()
  expect(ctx.turn.toolCalls).toBe(1)
})

it('does not claim a cancellation that the existing canvas action refused', async () => {
  const { ctx, execute, write, replaceNodes } = fixture()
  replaceNodes([{ ...node('target', '运行中'), data: {
    title: '运行中',
    generationTask: { kind: 'text', taskId: 'fixture-task', submittedAt: '2026-11-22T00:00:00Z' },
    __server: { status: 'RUNNING', taskId: 'fixture-task', runId: null, mediaObjectId: null, parentNodeId: null },
  } }])
  vi.mocked(ctx.bridge.runNodeAction).mockResolvedValueOnce(false)
  await execute({ toolCallId: 'cancel-once', toolName: 'cancel_generation', input: { node: '运行中' } })
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ state: 'output-error', errorText: expect.stringMatching(/^CANCEL_FAILED/) }))
})
