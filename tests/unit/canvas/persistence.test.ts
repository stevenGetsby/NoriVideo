import { describe, expect, it, vi } from 'vitest'
import {
  applyCanvasOperationsInTransaction,
  mergeCanvasTerminalNodeState,
  replaceCanvasDocumentInTransaction,
} from '@/lib/canvas/persistence'
import type { CanvasDocumentSaveInput } from '@/lib/canvas/document'
import { DEFAULT_STUDIO_SCENE } from '@/features/canvas/studio-types'

function input(): CanvasDocumentSaveInput {
  return {
    schema_version: 1,
    expectedRevision: 5,
    clientId: 'tab-1',
    changeSummary: '保存画布',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{
      id: 'node-1',
      type: 'image',
      position: { x: 10, y: 20 },
      size: { width: 300, height: 200 },
      data: { title: '图片' },
      status: 'IDLE',
      taskId: null,
      runId: null,
      mediaObjectId: null,
      parentNodeId: null,
    }],
    edges: [],
  }
}

function transaction(claimed = 1) {
  return {
    $queryRaw: vi.fn(async (): Promise<unknown[]> => []),
    canvas: {
      updateMany: vi.fn(async () => ({ count: claimed })),
      findFirst: vi.fn(async () => ({ revision: 6 })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'canvas-1', revision: 6, viewport: { x: 0, y: 0, zoom: 1 } })),
    },
    canvasEdge: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasNode: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findFirst: vi.fn(async (): Promise<unknown> => null),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: 'node-new' })),
    },
    canvasSnapshot: {
      create: vi.fn(async () => ({ id: 'snapshot-6' })),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasStudio3DDocument: {
      findFirst: vi.fn(async (): Promise<unknown> => null),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      create: vi.fn(async () => ({ id: 'studio-document-1' })),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasStudio3DDocumentSnapshot: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasWorkflowTemplate: {
      findFirst: vi.fn(async () => null),
    },
  }
}

describe('canvas document persistence', () => {
  it('claims the expected revision before replacing graph rows', async () => {
    const tx = transaction()
    const canvas = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: input(),
    })

    expect(canvas).toMatchObject({
      canvas: { id: 'canvas-1', revision: 6 },
      nodes: [{ id: 'node-1', canvasId: 'canvas-1' }],
      edges: [],
    })
    expect(tx.canvas.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 5 },
    }))
    expect(tx.canvasNode.createMany).toHaveBeenCalledOnce()
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 6,
        clientId: 'tab-1',
        document: expect.objectContaining({ schema_version: 1 }),
      }),
    }))
  })

  it('atomically replaces a populated canvas with an empty revisioned snapshot', async () => {
    const tx = transaction()
    tx.canvasNode.findMany.mockResolvedValueOnce([input().nodes[0]])

    const graph = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        ...input(),
        changeSummary: '清空画布',
        nodes: [],
        edges: [],
      },
    })

    expect(tx.canvas.updateMany).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 5 },
      data: {
        revision: { increment: 1 },
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    expect(tx.canvasEdge.deleteMany).toHaveBeenCalledWith({ where: { canvasId: 'canvas-1' } })
    expect(tx.canvasNode.deleteMany).toHaveBeenCalledWith({
      where: { canvasId: 'canvas-1', id: { in: ['node-1'] } },
    })
    expect(tx.canvasNode.createMany).not.toHaveBeenCalled()
    expect(tx.canvasEdge.createMany).not.toHaveBeenCalled()
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 6,
        changeSummary: '清空画布',
        document: {
          schema_version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [],
          edges: [],
        },
      }),
    }))
    expect(graph).toMatchObject({
      canvas: { id: 'canvas-1', revision: 6 },
      nodes: [],
      edges: [],
    })
  })

  it('keeps an existing studio node row so canvas autosave cannot cascade-delete its independent document', async () => {
    const tx = transaction()
    const studioNode = {
      ...input().nodes[0],
      id: 'studio-1',
      type: 'studio_3d',
      data: { title: '导演台' },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([{
      id: studioNode.id,
      status: studioNode.status,
      taskId: studioNode.taskId,
      runId: studioNode.runId,
      mediaObjectId: studioNode.mediaObjectId,
      data: studioNode.data,
    }])

    await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: { ...input(), nodes: [studioNode] },
    })

    expect(tx.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'studio-1', canvasId: 'canvas-1' },
    }))
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(tx.canvasNode.createMany).not.toHaveBeenCalled()
    expect(tx.canvasStudio3DDocument.deleteMany).not.toHaveBeenCalled()
  })

  it('stops without deleting nodes when another tab owns the revision', async () => {
    const tx = transaction(0)
    await expect(replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: input(),
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(tx.canvasSnapshot.create).not.toHaveBeenCalled()
  })

  it('preserves a reconciled task terminal state over a stale RUNNING autosave', () => {
    const stale = {
      ...input().nodes[0],
      status: 'RUNNING',
      taskId: 'task-1',
      data: { prompt: '保留编辑', progress: 20, pollErrorMessage: '暂时无法读取状态' },
    }
    const merged = mergeCanvasTerminalNodeState({
      id: stale.id,
      status: 'SUCCEEDED',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: 'media-1',
      data: {
        progress: 100,
        contentUrl: '/result.png',
        sourceMetadata: { durationSeconds: 5 },
        pollErrorMessage: null,
        history: [{ id: 'result', status: 'ready' }],
      },
    }, stale)

    expect(merged).toMatchObject({
      status: 'SUCCEEDED',
      taskId: 'task-1',
      mediaObjectId: 'media-1',
      data: {
        prompt: '保留编辑',
        progress: 100,
        contentUrl: '/result.png',
        sourceMetadata: { durationSeconds: 5 },
        pollErrorMessage: null,
        history: [{ id: 'result', status: 'ready' }],
      },
    })
  })

  it('preserves a worker-bound storyboard shot over a stale planning autosave', () => {
    const stale = {
      ...input().nodes[0],
      id: 'story-source',
      status: 'RUNNING',
      taskId: 'task-plan',
      data: {
        prompt: '原始剧情',
        generation: { modelKey: 'image-model', count: 4 },
        generationTask: { kind: 'storyboard_plan', taskId: 'task-plan' },
      },
    }
    const merged = mergeCanvasTerminalNodeState({
      id: stale.id,
      status: 'RUNNING',
      taskId: 'task-image-1',
      runId: null,
      mediaObjectId: null,
      data: {
        prompt: '镜头一提示词',
        storyboardPlanningTaskId: 'task-plan',
        storyboardIndex: 1,
        generationTask: null,
        generation: { modelKey: 'image-model', assetId: 'asset-1', taskId: 'task-image-1', count: 1 },
      },
    }, { ...stale, position: { x: 900, y: 600 } })

    expect(merged).toMatchObject({
      position: { x: 900, y: 600 },
      status: 'RUNNING',
      taskId: 'task-image-1',
      data: {
        prompt: '镜头一提示词',
        storyboardPlanningTaskId: 'task-plan',
        generationTask: null,
        generation: { assetId: 'asset-1', taskId: 'task-image-1' },
      },
    })
  })

  it('keeps server-created storyboard siblings and edges during a stale full-document recovery', async () => {
    const tx = transaction()
    const staleSource = {
      ...input().nodes[0],
      id: 'story-source',
      status: 'RUNNING',
      taskId: 'task-plan',
      data: {
        prompt: '原始剧情',
        generation: { modelKey: 'image-model', count: 4 },
        generationTask: { kind: 'storyboard_plan', taskId: 'task-plan' },
      },
    }
    const storedSource = {
      ...staleSource,
      taskId: 'task-image-1',
      data: {
        prompt: '镜头一提示词',
        storyboardPlanningTaskId: 'task-plan',
        generationTask: null,
        generation: { assetId: 'asset-1', taskId: 'task-image-1' },
      },
    }
    const sibling = {
      ...storedSource,
      id: 'story-shot-2',
      taskId: 'task-image-2',
      parentNodeId: 'story-source',
      position: { x: 356, y: 20 },
      data: {
        ...storedSource.data,
        storyboardIndex: 2,
        generation: { assetId: 'asset-2', taskId: 'task-image-2' },
      },
    }
    const group = {
      ...storedSource,
      id: 'story-group',
      type: 'group',
      taskId: null,
      status: 'IDLE',
      parentNodeId: null,
      data: {
        storyboardPlanningTaskId: 'task-plan',
        memberIds: ['story-source', 'story-shot-2'],
      },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([storedSource, sibling, group])
    tx.canvasEdge.findMany.mockResolvedValueOnce([{
      id: 'story-edge-2',
      sourceNodeId: 'story-source',
      targetNodeId: 'story-shot-2',
      sourceHandle: 'output',
      targetHandle: 'input',
      role: 'REF',
    }])

    const graph = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: { ...input(), nodes: [staleSource], edges: [] },
    })

    expect(graph.nodes.map((node) => node.id)).toEqual(['story-source', 'story-shot-2', 'story-group'])
    expect(graph.nodes[0]).toMatchObject({ taskId: 'task-image-1', data: { prompt: '镜头一提示词' } })
    expect(graph.edges).toEqual([expect.objectContaining({ id: 'story-edge-2', targetNodeId: 'story-shot-2' })])
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(tx.canvasEdge.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: 'story-edge-2', canvasId: 'canvas-1' })],
    })
  })

  it('re-reads and reapplies terminal truth when reconciliation wins the full-PUT write race', async () => {
    const tx = transaction()
    const stale = { ...input().nodes[0], status: 'RUNNING', taskId: 'task-1', data: { prompt: '本地编辑', progress: 20 } }
    tx.canvasNode.findMany.mockResolvedValueOnce([{
      id: stale.id,
      status: 'RUNNING',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: null,
      data: stale.data,
    }])
    tx.canvasNode.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    tx.$queryRaw.mockResolvedValueOnce([{
      id: stale.id,
      status: 'SUCCEEDED',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: 'media-1',
      data: { progress: 100, contentUrl: '/done.png' },
    }])

    const graph = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: { ...input(), nodes: [stale] },
    })

    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.canvasNode.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: stale.id, canvasId: 'canvas-1', status: 'SUCCEEDED' },
      data: expect.objectContaining({ status: 'SUCCEEDED', mediaObjectId: 'media-1' }),
    }))
    expect(graph.nodes[0]).toMatchObject({
      status: 'SUCCEEDED',
      mediaObjectId: 'media-1',
      data: { prompt: '本地编辑', progress: 100, contentUrl: '/done.png' },
    })
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        document: expect.objectContaining({ nodes: [expect.objectContaining({ status: 'SUCCEEDED' })] }),
      }),
    }))
  })

  it('applies a scoped operation batch, increments once, and snapshots the final graph', async () => {
    const tx = transaction()
    tx.canvasNode.findMany.mockResolvedValueOnce([{
      ...input().nodes[0],
      canvasId: 'canvas-1',
    }])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])

    const graph = await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '移动并新增节点',
        ops: [
          { type: 'node.upsert', node: { ...input().nodes[0], position: { x: 90, y: 120 } } },
          { type: 'node.upsert', node: { ...input().nodes[0], id: 'node-2', position: { x: 400, y: 120 } } },
          {
            type: 'edge.add',
            edge: {
              id: 'edge-1',
              sourceNodeId: 'node-1',
              targetNodeId: 'node-2',
              sourceHandle: null,
              targetHandle: null,
              role: 'INPUT_DEFAULT',
            },
          },
          { type: 'canvas.update_meta', viewport: { x: 12, y: -4, zoom: 0.9 } },
        ],
      },
    })

    expect(tx.canvas.updateMany).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 5 },
      data: { revision: { increment: 1 }, viewport: { x: 12, y: -4, zoom: 0.9 } },
    })
    expect(tx.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'node-1', canvasId: 'canvas-1' },
    }))
    expect(tx.canvasNode.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 'node-2', canvasId: 'canvas-1' }),
    }))
    expect(tx.canvasEdge.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: 'edge-1', canvasId: 'canvas-1' })],
    })
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 6, changeSummary: '移动并新增节点' }),
    }))
    expect(graph).toMatchObject({ canvas: { revision: 6 }, nodes: [{ id: 'node-1' }, { id: 'node-2' }] })
  })

  it('reports the actual revision when an operation batch loses the atomic claim', async () => {
    const tx = transaction(0)
    tx.canvas.findFirst.mockResolvedValueOnce({ revision: 9 })
    await expect(applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: null,
        ops: [{ type: 'node.delete', id: 'node-1' }],
      },
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { expectedRevision: 5, actualRevision: 9 },
    })
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
  })

  it('re-reads a terminal node when reconciliation wins the ops update race', async () => {
    const tx = transaction()
    const stale = { ...input().nodes[0], status: 'RUNNING', taskId: 'task-1', data: { prompt: '移动后保留', progress: 10 } }
    tx.canvasNode.findMany.mockResolvedValueOnce([{ ...stale, canvasId: 'canvas-1' }])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])
    tx.canvasNode.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    tx.$queryRaw.mockResolvedValueOnce([{
      id: stale.id,
      status: 'FAILED',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: null,
      data: { progress: 80, errorMessage: '生成失败' },
    }])

    const graph = await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '移动运行中节点',
        ops: [{ type: 'node.upsert', node: { ...stale, position: { x: 600, y: 300 } } }],
      },
    })

    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(graph.nodes[0]).toMatchObject({
      position: { x: 600, y: 300 },
      status: 'FAILED',
      data: { prompt: '移动后保留', progress: 80, errorMessage: '生成失败' },
    })
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        document: expect.objectContaining({ nodes: [expect.objectContaining({ status: 'FAILED' })] }),
      }),
    }))
  })

  it('copies an independent studio document when a duplicated node is created', async () => {
    const tx = transaction()
    const source = {
      ...input().nodes[0],
      id: 'studio-source',
      type: 'studio_3d',
      canvasId: 'canvas-1',
      data: { title: '源导演台' },
    }
    const target = {
      ...input().nodes[0],
      id: 'studio-copy',
      type: 'studio_3d',
      data: {
        title: '源导演台',
        __studioDocumentSource: {
          kind: 'canvas-node',
          projectId: 'project-1',
          canvasId: 'canvas-1',
          nodeId: 'studio-source',
        },
      },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([source])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])
    tx.canvasNode.findFirst.mockResolvedValueOnce(source)
    tx.canvasStudio3DDocument.findFirst.mockResolvedValueOnce({
      revision: 7,
      document: { ...DEFAULT_STUDIO_SCENE, backgroundColor: '#123456' },
    })

    const graph = await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'storyboard-user',
      templateOwnerId: 'workspace-owner',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '创建副本',
        ops: [{ type: 'node.upsert', node: target }],
      },
    })

    expect(tx.canvas.findFirst).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1' },
      select: { id: true },
    })
    expect(tx.canvasStudio3DDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'studio-source' },
    }))
    expect(tx.canvasStudio3DDocument.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'studio-copy',
        revision: 1,
        updatedBy: 'storyboard-user',
        document: expect.objectContaining({ backgroundColor: '#123456' }),
      })],
    })
    expect(graph.nodes.find((node) => node.id === 'studio-copy')).toMatchObject({
      data: {
        __studioDocumentSource: {
          kind: 'canvas-node',
          projectId: 'project-1',
          canvasId: 'canvas-1',
          nodeId: 'studio-copy',
        },
      },
    })
  })

  it('restores the studio scene archived with a canvas history snapshot', async () => {
    const tx = transaction()
    const studioNode = {
      ...input().nodes[0],
      id: 'studio-1',
      type: 'studio_3d',
      data: { title: '导演台' },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([studioNode])
    tx.canvasStudio3DDocument.findMany
      .mockResolvedValueOnce([{ id: 'studio-document-1', nodeId: 'studio-1', revision: 11 }])
      .mockResolvedValueOnce([])

    await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'storyboard-user',
      input: { ...input(), nodes: [studioNode] },
      studioDocumentRestore: [{
        nodeId: 'studio-1',
        revision: 4,
        document: { ...DEFAULT_STUDIO_SCENE, backgroundColor: '#654321' },
      }],
    })

    expect(tx.canvasStudio3DDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'studio-document-1',
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'studio-1',
        revision: 11,
      },
      data: {
        revision: { increment: 1 },
        document: expect.objectContaining({ backgroundColor: '#654321' }),
        updatedBy: 'storyboard-user',
      },
    })
  })

  it('deletes a studio node only through the scoped node row so its document cascades safely', async () => {
    const tx = transaction()
    const studioNode = {
      ...input().nodes[0],
      id: 'studio-1',
      type: 'studio_3d',
      canvasId: 'canvas-1',
      data: { title: '导演台' },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([studioNode])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])

    await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'storyboard-user',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '删除节点',
        ops: [{ type: 'node.delete', id: 'studio-1' }],
      },
    })

    expect(tx.canvasNode.deleteMany).toHaveBeenCalledWith({
      where: { canvasId: 'canvas-1', id: { in: ['studio-1'] } },
    })
    expect(tx.canvasStudio3DDocument.deleteMany).not.toHaveBeenCalled()
  })
})
