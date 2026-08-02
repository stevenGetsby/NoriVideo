import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  canvasNode: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  bindCanvasGenerationTaskToNode,
  type CanvasStoryboardPlanTaskPayload,
  type CanvasTextGenerationTaskPayload,
} from '@/lib/canvas/generation-task'

const payload: CanvasTextGenerationTaskPayload = {
  kind: 'text',
  canvasId: 'canvas-1',
  nodeId: 'legacy-note-1',
  prompt: '将这段剧情改写为分镜文本',
  modelKey: 'openai::gpt-5',
  analysisModel: 'openai::gpt-5',
  maxInputTokens: 8_000,
  maxOutputTokens: 6_000,
  retryOf: null,
}

describe('canvas generation task binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.canvasNode.findFirst.mockResolvedValue({
      id: 'legacy-note-1',
      data: { title: '历史文本节点' },
      taskId: null,
    })
    prismaMock.canvasNode.updateMany.mockResolvedValue({ count: 1 })
  })

  it('accepts both current text nodes and legacy note nodes for text generation', async () => {
    await expect(bindCanvasGenerationTaskToNode({
      projectId: 'project-1',
      taskId: 'task-1',
      payload,
    })).resolves.toBe(true)

    expect(prismaMock.canvasNode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'legacy-note-1',
        canvasId: 'canvas-1',
        type: { in: ['text', 'note'] },
        canvas: { projectId: 'project-1' },
      }),
    }))
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'RUNNING',
        taskId: 'task-1',
        data: expect.objectContaining({
          prompt: payload.prompt,
          generationTask: expect.objectContaining({ kind: 'text', taskId: 'task-1' }),
        }),
      }),
    }))
  })

  it('removes an old image asset binding when a storyboard plan is registered', async () => {
    prismaMock.canvasNode.findFirst.mockResolvedValue({
      id: 'image-1',
      data: {
        title: '已生成图片',
        generation: { assetId: 'asset-old', taskId: 'task-old', modelKey: 'image-old' },
      },
      taskId: 'task-old',
    })
    const storyboardPayload: CanvasStoryboardPlanTaskPayload = {
      kind: 'storyboard_plan',
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      prompt: '连续分镜',
      count: 4,
      analysisModel: 'openai::gpt-5',
      imageRequest: {
        modelKey: 'volcengine::seedream-4',
        modelLabel: 'Seedream 4',
        referenceNodeIds: [],
        referenceMaterialIds: [],
        inputMode: 'text',
        aspectRatio: '16:9',
        resolution: '2K',
        quality: 'high',
      },
      maxInputTokens: 8_000,
      maxOutputTokens: 5_000,
      retryOf: null,
    }

    await expect(bindCanvasGenerationTaskToNode({
      projectId: 'project-1',
      taskId: 'task-plan',
      payload: storyboardPayload,
    })).resolves.toBe(true)

    const update = prismaMock.canvasNode.updateMany.mock.calls[0][0] as {
      data: { data: { generation: Record<string, unknown> } }
    }
    expect(update.data.data.generation).toMatchObject({
      modelKey: 'volcengine::seedream-4',
      taskId: 'task-plan',
    })
    expect(update.data.data.generation).not.toHaveProperty('assetId')
  })
})
