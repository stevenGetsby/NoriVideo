import { describe, expect, it } from 'vitest'
import { applyCanvasDocumentDelta, buildCanvasOperations } from '@/features/canvas/state/canvas-operations'
import type { Canvas, CanvasDocumentInput, CanvasGraphDelta, CanvasNode } from '@/features/canvas/types'
import { canvasNodeToFlow, mergeServerTerminalFlowNode } from '@/features/canvas/editor-types'
import { buildCanvasNodeSummaryV1 } from '@/lib/canvas/graph-summary'

function document(): CanvasDocumentInput {
  return {
    expectedRevision: 2,
    clientId: 'tab-1',
    changeSummary: '编辑',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: 'node-1',
        canvasId: 'canvas-1',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
        data: { text: '旧文本' },
        status: 'IDLE',
        taskId: null,
        runId: null,
        mediaObjectId: null,
        parentNodeId: null,
      },
      {
        id: 'node-2',
        canvasId: 'canvas-1',
        type: 'image',
        position: { x: 400, y: 0 },
        size: null,
        data: null,
        status: 'IDLE',
        taskId: null,
        runId: null,
        mediaObjectId: null,
        parentNodeId: null,
      },
    ],
    edges: [{
      id: 'edge-1',
      canvasId: 'canvas-1',
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
      sourceHandle: null,
      targetHandle: null,
      role: 'INPUT_TEXT',
    }],
  }
}

function canvas(overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    title: '画布',
    themeColor: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    revision: 3,
    visibility: 'private',
    forkedFromId: null,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    ...overrides,
  }
}

function delta(overrides: Partial<CanvasGraphDelta> = {}): CanvasGraphDelta {
  return {
    canvas: canvas(),
    nodes: [],
    edges: [],
    deletedNodeIds: [],
    deletedEdgeIds: [],
    ...overrides,
  }
}

describe('canvas delta application', () => {
  it('keeps every untouched node so the next diff cannot delete them', () => {
    const confirmed = document()
    const moved = { ...confirmed.nodes[0]!, position: { x: 200, y: 300 } }

    const next = applyCanvasDocumentDelta(confirmed, delta({ nodes: [moved] }), 'tab-1', '移动节点')

    expect(next.nodes.map((node) => node.id)).toEqual(['node-1', 'node-2'])
    expect(next.nodes[0]!.position).toEqual({ x: 200, y: 300 })
    expect(next.edges).toEqual(confirmed.edges)
    expect(next.expectedRevision).toBe(3)
    expect(buildCanvasOperations(next, { ...next, expectedRevision: 3 })).toEqual([])
  })

  it('drops deleted nodes and edges and applies added ones', () => {
    const confirmed = document()
    const next = applyCanvasDocumentDelta(confirmed, delta({
      deletedNodeIds: ['node-2'],
      deletedEdgeIds: ['edge-1'],
      nodes: [{ ...confirmed.nodes[0]!, status: 'SUCCEEDED' }],
      edges: [{
        id: 'edge-2',
        canvasId: 'canvas-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-1',
        sourceHandle: null,
        targetHandle: null,
        role: 'REF',
      }],
    }), 'tab-1', null)

    expect(next.nodes.map((node) => node.id)).toEqual(['node-1'])
    expect(next.nodes[0]!.status).toBe('SUCCEEDED')
    expect(next.edges.map((edge) => edge.id)).toEqual(['edge-2'])
  })

  it('uses the server viewport unless the canvas has none', () => {
    const confirmed = document()
    const withViewport = applyCanvasDocumentDelta(confirmed, delta({ canvas: canvas({ viewport: { x: 5, y: 6, zoom: 0.5 } }) }), 'tab-1', null)
    expect(withViewport.viewport).toEqual({ x: 5, y: 6, zoom: 0.5 })

    const withoutViewport = applyCanvasDocumentDelta(confirmed, delta({ canvas: canvas({ viewport: null }) }), 'tab-1', null)
    expect(withoutViewport.viewport).toEqual(confirmed.viewport)
  })
})

describe('canvas operation compression', () => {
  it('collapses a current document into one final operation per changed entity', () => {
    const confirmed = document()
    const current = structuredClone(confirmed)
    current.nodes[0]!.position = { x: 10, y: 20 }
    current.nodes[0]!.position = { x: 80, y: 90 }
    current.nodes[0]!.data = { text: '最终文本' }
    current.edges[0]!.targetHandle = 'image'
    current.viewport = { x: 12, y: -8, zoom: 0.9 }

    const operations = buildCanvasOperations(confirmed, current)

    expect(operations.map((operation) => operation.type)).toEqual([
      'edge.delete',
      'node.upsert',
      'edge.add',
      'canvas.update_meta',
    ])
    expect(operations.filter((operation) => operation.type === 'node.upsert')).toHaveLength(1)
    expect(operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ node: expect.objectContaining({ canvasId: 'canvas-1' }) }),
    ]))
  })

  it('emits no request operations when the final graph matches the confirmed graph', () => {
    expect(buildCanvasOperations(document(), structuredClone(document()))).toEqual([])
  })

  it('compares a full confirmed node with its current summary without writing omitted detail', () => {
    const confirmed = document()
    const summaryOf = (node: CanvasNode): CanvasNode => ({
      ...buildCanvasNodeSummaryV1(node),
      data: { ...buildCanvasNodeSummaryV1(node).data, __canvasUnhydrated: true },
    })
    const current = {
      ...confirmed,
      nodes: confirmed.nodes.map(summaryOf),
    }
    expect(buildCanvasOperations(confirmed, current, { geometryOps: true })).toEqual([])

    expect(buildCanvasOperations(confirmed, { ...confirmed, nodes: current.nodes.map((node) => ({ ...node, position: node.id === 'node-1' ? { x: 100, y: 120 } : node.position })) }, { geometryOps: true })).toEqual([
      { type: 'node.update_geometry', id: 'node-1', position: { x: 100, y: 120 } },
    ])
  })

  it('does not treat an unchanged summary as a complete body edit', () => {
    const confirmed = document()
    const summaryOf = (node: CanvasNode): CanvasNode => ({
      ...buildCanvasNodeSummaryV1(node),
      data: { ...buildCanvasNodeSummaryV1(node).data, __canvasUnhydrated: true },
    })
    const current = {
      ...confirmed,
      nodes: confirmed.nodes.map(summaryOf),
    }
    expect(buildCanvasOperations(confirmed, current, { geometryOps: true })).toEqual([])

    current.nodes[0] = {
      ...current.nodes[0]!,
      data: { ...current.nodes[0]!.data, title: '正文已修改' },
    }
    expect(buildCanvasOperations(confirmed, current, { geometryOps: true })).toEqual([
      expect.objectContaining({ type: 'node.upsert' }),
    ])
  })

  it('does not silently discard a generation-model edit on a summary node', () => {
    const confirmed = document()
    const original = confirmed.nodes[0]!
    original.data = { generation: { modelKey: 'synthetic-original' } }
    const summary = buildCanvasNodeSummaryV1(original)
    const edited: CanvasNode = {
      ...summary,
      position: { x: 20, y: 30 },
      data: { ...summary.data, __canvasUnhydrated: true, generation: { ...summary.data.generation, modelKey: 'synthetic-new' } },
    }
    expect(buildCanvasOperations(confirmed, { ...confirmed, nodes: [edited, confirmed.nodes[1]!] }, { geometryOps: true }))
      .toEqual([expect.objectContaining({ type: 'node.upsert' })])
  })

  it('keeps clearing an explicit size on a full node a body write', () => {
    const confirmed = document()
    const current = structuredClone(confirmed)
    current.nodes[0]!.size = null
    expect(buildCanvasOperations(confirmed, current, { geometryOps: true }))
      .toEqual([expect.objectContaining({ type: 'node.upsert', node: expect.objectContaining({ size: null }) })])
  })

  it('projects only matching server terminal truth into an actively edited RUNNING node', () => {
    const base = document().nodes[0]!
    const local = canvasNodeToFlow({
      ...base,
      position: { x: 900, y: 450 },
      status: 'RUNNING',
      taskId: 'task-1',
      data: {
        prompt: '请求发出后的本地编辑',
        progress: 20,
        pollErrorMessage: '暂时无法读取状态',
        generation: { taskId: 'task-1' },
      },
    })
    const server = canvasNodeToFlow({
      ...base,
      status: 'SUCCEEDED',
      taskId: 'task-1',
      mediaObjectId: 'media-1',
      data: {
        prompt: '旧提示词',
        progress: 100,
        contentUrl: '/done.png',
        sourceMetadata: { durationSeconds: 5 },
        pollErrorMessage: null,
        generation: { taskId: 'task-1' },
        history: [{ id: 'result', status: 'ready', createdAt: '2026-07-17T00:00:00.000Z' }],
      },
    })

    const merged = mergeServerTerminalFlowNode(local, server)

    expect(merged.position).toEqual({ x: 900, y: 450 })
    expect(merged.data).toMatchObject({
      prompt: '请求发出后的本地编辑',
      progress: 100,
      contentUrl: '/done.png',
      sourceMetadata: { durationSeconds: 5 },
      pollErrorMessage: null,
      __server: { status: 'SUCCEEDED', taskId: 'task-1', mediaObjectId: 'media-1' },
    })
    const nextTask = {
      ...local,
      data: {
        ...local.data,
        generation: { taskId: 'task-2' },
        __server: { ...local.data.__server!, taskId: 'task-2' },
      },
    }
    expect(mergeServerTerminalFlowNode(nextTask, server)).toBe(nextTask)
  })

  it('accepts a new running task on a blank comparison without overwriting local prompt edits', () => {
    const base = document().nodes[0]!
    const local = canvasNodeToFlow({
      ...base,
      id: 'comparison',
      type: 'video',
      status: 'IDLE',
      taskId: null,
      data: { prompt: '用户的新提示词', generation: { referenceNodeIds: ['ref-1'] } },
    })
    const server = canvasNodeToFlow({
      ...base,
      id: 'comparison',
      type: 'video',
      status: 'RUNNING',
      taskId: 'comparison-task',
      data: { prompt: '提交时的提示词', progress: 2, generation: { assetId: 'comparison-asset', taskId: 'comparison-task' } },
    })
    expect(mergeServerTerminalFlowNode(local, server).data).toMatchObject({
      prompt: '用户的新提示词',
      progress: 2,
      __server: { status: 'RUNNING', taskId: 'comparison-task' },
    })
  })

  it('adopts the canonical studio source after a copied scene is persisted', () => {
    const base = document().nodes[0]!
    const local = canvasNodeToFlow({
      ...base,
      id: 'studio-copy',
      type: 'studio_3d',
      data: {
        title: '本地标题',
        __studioDocumentSource: {
          kind: 'workflow-template',
          templateId: 'template-1',
          nodeId: 'studio-source',
        },
      },
    })
    const server = canvasNodeToFlow({
      ...base,
      id: 'studio-copy',
      type: 'studio_3d',
      data: {
        title: '旧标题',
        __studioDocumentSource: {
          kind: 'canvas-node',
          projectId: 'project-1',
          canvasId: 'canvas-1',
          nodeId: 'studio-copy',
        },
      },
    })

    const merged = mergeServerTerminalFlowNode(local, server)

    expect(merged.data).toMatchObject({
      title: '本地标题',
      __studioDocumentSource: {
        kind: 'canvas-node',
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'studio-copy',
      },
    })
  })
})
