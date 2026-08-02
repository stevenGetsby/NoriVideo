import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  frameosToolboxAsset: {
    findMany: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
  canvasNode: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { reconcileCanvasGenerationNodes } from '@/lib/canvas/generation-reconciliation'

function runningNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    status: 'RUNNING',
    taskId: 'task-1',
    updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    data: {
      mediaType: 'image',
      contentUrl: 'previous.png',
      materialId: 'previous-material',
      progress: 12,
      generation: { assetId: 'asset-1', taskId: 'task-1' },
      history: [{ id: 'history-1', assetId: 'asset-1', status: 'processing' }],
    },
    ...overrides,
  }
}

function runningTextNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'text-node-1',
    status: 'RUNNING',
    taskId: 'task-text-1',
    updatedAt: new Date('2026-07-17T01:00:00.000Z'),
    data: {
      mediaType: 'text',
      text: '旧文本',
      prompt: '续写这一场戏',
      progress: 20,
      generation: { modelKey: 'openai::gpt-5', taskId: 'task-text-1' },
      generationTask: { kind: 'text', taskId: 'task-text-1' },
      history: [{ id: 'task:task-text-1', taskId: 'task-text-1', status: 'processing' }],
    },
    ...overrides,
  }
}

describe('canvas generation reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([])
    prismaMock.task.findMany.mockResolvedValue([])
  })

  it('persists and returns a completed toolbox asset as a succeeded canvas node', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValueOnce([{
      id: 'asset-1',
      type: 'image',
      status: 'ready',
      resultUrl: 'images/final.png',
      materialId: 'material-1',
      errorMessage: null,
    }])
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-completed',
      targetId: 'asset-1',
      status: 'completed',
      progress: 100,
      errorMessage: null,
    }])

    const [node] = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [runningNode()],
    })

    expect(node).toMatchObject({
      status: 'SUCCEEDED',
      taskId: 'task-completed',
      data: {
        contentUrl: 'images/final.png',
        imageUrl: 'images/final.png',
        materialId: 'material-1',
        progress: 100,
        errorMessage: null,
        history: [{
          assetId: 'asset-1',
          status: 'ready',
          url: 'images/final.png',
          materialId: 'material-1',
          errorMessage: null,
        }],
      },
    })
    expect(prismaMock.frameosToolboxAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['asset-1'] }, projectId: 'project-1' },
    }))
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'node-1',
        canvasId: 'canvas-1',
        status: 'RUNNING',
        updatedAt: new Date('2026-07-17T00:00:00.000Z'),
      },
      data: expect.objectContaining({
        status: 'SUCCEEDED',
        taskId: 'task-completed',
      }),
    })
  })

  it('projects a completed model3d toolbox asset into modelUrl for refresh recovery', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValueOnce([{
      id: 'asset-1',
      type: 'model3d',
      status: 'ready',
      resultUrl: 'toolbox-model3d/project-1/final.glb',
      materialId: 'material-model-1',
      errorMessage: null,
    }])
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-model-completed',
      targetId: 'asset-1',
      status: 'completed',
      progress: 100,
      errorMessage: null,
    }])

    const [node] = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [runningNode({
        data: {
          mediaType: 'model3d',
          contentUrl: null,
          modelUrl: null,
          progress: 40,
          generation: { assetId: 'asset-1', taskId: 'task-model-completed' },
          history: [{ id: 'history-model', assetId: 'asset-1', status: 'processing' }],
        },
      })],
    })

    expect(node).toMatchObject({
      status: 'SUCCEEDED',
      data: {
        contentUrl: 'toolbox-model3d/project-1/final.glb',
        modelUrl: 'toolbox-model3d/project-1/final.glb',
        materialId: 'material-model-1',
        progress: 100,
      },
    })
  })

  it('uses terminal task failure when an asset was left processing', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValueOnce([{
      id: 'asset-1',
      type: 'video',
      status: 'failed',
      resultUrl: null,
      materialId: null,
      errorMessage: null,
    }])
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-failed',
      targetId: 'asset-1',
      status: 'failed',
      progress: 36,
      errorMessage: 'provider timeout',
    }])

    const [node] = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [runningNode()],
    })

    expect(node).toMatchObject({
      status: 'FAILED',
      taskId: 'task-failed',
      data: {
        contentUrl: 'previous.png',
        materialId: 'previous-material',
        progress: 36,
        errorMessage: 'provider timeout',
        history: [{ assetId: 'asset-1', status: 'failed', errorMessage: 'provider timeout' }],
      },
    })
  })

  it('does not return a stale terminal projection when the compare-and-swap loses', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValueOnce([{
      id: 'asset-1',
      type: 'image',
      status: 'ready',
      resultUrl: 'images/old-result.png',
      materialId: 'material-old',
      errorMessage: null,
    }])
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-old',
      targetId: 'asset-1',
      status: 'completed',
      progress: 100,
      errorMessage: null,
    }])
    prismaMock.canvasNode.updateMany.mockResolvedValueOnce({ count: 0 })
    const original = runningNode()

    const nodes = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [original],
    })

    expect(nodes).toEqual([original])
  })

  it('does not treat a failed worker attempt as terminal while its task is retrying', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValueOnce([{
      id: 'asset-1',
      type: 'image',
      status: 'failed',
      resultUrl: null,
      materialId: null,
      errorMessage: null,
    }])
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-active',
      targetId: 'asset-1',
      status: 'processing',
      progress: 52,
      errorMessage: null,
    }])
    const active = runningNode()
    const idle = runningNode({ id: 'node-2', status: 'IDLE' })

    const nodes = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [active, idle],
    })

    expect(nodes).toEqual([active, idle])
    expect(prismaMock.canvasNode.updateMany).not.toHaveBeenCalled()
  })

  it('turns a completed task without a persisted media result into an explicit failure', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-completed',
      targetId: 'asset-1',
      status: 'completed',
      progress: 100,
      errorMessage: null,
    }])

    const [node] = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [runningNode()],
    })

    expect(node).toMatchObject({
      status: 'FAILED',
      data: {
        errorMessage: '生成任务已完成，但没有返回可用媒体',
      },
    })
  })

  it('projects a completed text task result into the persisted canvas node', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-text-1',
      type: 'canvas_text_generation',
      targetId: 'text-node-1',
      status: 'completed',
      progress: 100,
      payload: {
        canvasId: 'canvas-1',
        nodeId: 'text-node-1',
        prompt: '续写这一场戏',
        modelKey: 'openai::gpt-5',
        analysisModel: 'openai::gpt-5',
        maxInputTokens: 8000,
        maxOutputTokens: 6000,
      },
      result: { text: '新的持久文本' },
      errorMessage: null,
      finishedAt: new Date('2026-07-17T01:02:00.000Z'),
    }])

    const [node] = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [runningTextNode()],
    })

    expect(node).toMatchObject({
      status: 'SUCCEEDED',
      taskId: 'task-text-1',
      data: {
        text: '新的持久文本',
        origin: 'generate',
        progress: 100,
        errorMessage: null,
        generationTask: { completed: true },
        history: [{ taskId: 'task-text-1', text: '新的持久文本', status: 'ready' }],
      },
    })
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'text-node-1',
        canvasId: 'canvas-1',
        taskId: 'task-text-1',
      }),
      data: expect.objectContaining({ status: 'SUCCEEDED' }),
    }))
  })

  it('projects a failed persistent text task without removing the prior text', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-text-1',
      type: 'canvas_text_generation',
      targetId: 'text-node-1',
      status: 'failed',
      progress: 63,
      payload: {
        canvasId: 'canvas-1',
        nodeId: 'text-node-1',
        prompt: '续写这一场戏',
        modelKey: 'openai::gpt-5',
        analysisModel: 'openai::gpt-5',
      },
      result: null,
      errorMessage: 'provider timeout',
      finishedAt: new Date('2026-07-17T01:02:00.000Z'),
    }])

    const [node] = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [runningTextNode()],
    })

    expect(node).toMatchObject({
      status: 'FAILED',
      data: {
        text: '旧文本',
        progress: 63,
        errorMessage: 'provider timeout',
        history: [{ taskId: 'task-text-1', status: 'failed', errorMessage: 'provider timeout' }],
      },
    })
  })

  it('keeps a completed storyboard planning task running for client-side image materialization', async () => {
    const storyboardNode = runningTextNode({
      id: 'storyboard-node-1',
      taskId: 'task-plan-1',
      data: {
        mediaType: 'image',
        prompt: '拆成四镜',
        generation: { modelKey: 'volcengine::seedream-4', taskId: 'task-plan-1' },
        generationTask: { kind: 'storyboard_plan', taskId: 'task-plan-1' },
      },
    })
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-plan-1',
      type: 'canvas_storyboard_plan',
      targetId: 'storyboard-node-1',
      status: 'completed',
      progress: 100,
      payload: {
        canvasId: 'canvas-1',
        nodeId: 'storyboard-node-1',
        prompt: '拆成四镜',
        count: 4,
        analysisModel: 'openai::gpt-5',
        imageRequest: {
          modelKey: 'volcengine::seedream-4',
          referenceNodeIds: [],
          referenceMaterialIds: [],
          inputMode: 'text',
          aspectRatio: '16:9',
          resolution: '',
        },
      },
      result: { shots: [] },
      errorMessage: null,
      finishedAt: new Date('2026-07-17T01:02:00.000Z'),
    }])

    const nodes = await reconcileCanvasGenerationNodes({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodes: [storyboardNode],
    })

    expect(nodes).toEqual([storyboardNode])
    expect(prismaMock.canvasNode.updateMany).not.toHaveBeenCalled()
  })
})
