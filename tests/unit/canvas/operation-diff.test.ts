import { describe, expect, it } from 'vitest'
import { buildCanvasOperations } from '@/features/canvas/state/canvas-operations'
import type { CanvasDocumentInput } from '@/features/canvas/types'
import { canvasNodeToFlow, mergeServerTerminalFlowNode } from '@/features/canvas/editor-types'

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
