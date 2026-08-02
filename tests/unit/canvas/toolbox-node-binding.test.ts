import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  node: {
    id: 'node-1',
    data: { title: '视频节点', generation: {}, history: [] } as Record<string, unknown>,
    taskId: null as string | null,
  },
}))

const prismaMock = vi.hoisted(() => ({
  canvasNode: {
    findFirst: vi.fn(async ({ where }: { where: { taskId?: string | null } }) => {
      if ('taskId' in where && state.node.taskId !== where.taskId) return null
      return { id: state.node.id, data: state.node.data, taskId: state.node.taskId }
    }),
    updateMany: vi.fn(async ({
      where,
      data,
    }: {
      where: { taskId?: string | null }
      data: { data?: Record<string, unknown>; taskId?: string | null }
    }) => {
      if ('taskId' in where && state.node.taskId !== where.taskId) return { count: 0 }
      if (data.data) state.node.data = data.data
      if (data.taskId !== undefined) state.node.taskId = data.taskId
      return { count: 1 }
    }),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  bindCanvasToolboxTaskToNode,
  projectCanvasToolboxSubmissionFailure,
  projectCanvasToolboxTaskTerminal,
} from '@/lib/canvas/toolbox-node-binding'

describe('canvas toolbox node binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.node = {
      id: 'node-1',
      data: { title: '视频节点', generation: {}, history: [] },
      taskId: null,
    }
  })

  it('persists the task association, generation parameters and reference summary before responding', async () => {
    await expect(bindCanvasToolboxTaskToNode({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      assetId: 'asset-1',
      taskId: 'task-1',
      type: 'video',
      title: '视频节点',
      prompt: '镜头向前推进',
      modelKey: 'nori::seedance2.0',
      inputMode: 'text',
      options: { aspectRatio: '21:9', resolution: '720p', duration: 5 },
      referenceSummary: [{ id: 'material-1', title: '角色图', type: 'image' }],
    })).resolves.toBe(true)

    expect(state.node.taskId).toBe('task-1')
    expect(state.node.data).toMatchObject({
      generation: {
        assetId: 'asset-1',
        taskId: 'task-1',
        aspectRatio: '21:9',
        referenceSummary: [{ title: '角色图', type: 'image' }],
      },
      history: [{
        assetId: 'asset-1',
        parameters: { inputMode: 'text', aspectRatio: '21:9' },
        references: [{ title: '角色图', type: 'image' }],
        status: 'processing',
      }],
    })
  })

  it('persists an explicit panorama marker across task binding and refresh', async () => {
    state.node.data = {
      title: '雨夜街道 · 720全景',
      mediaType: 'image',
      generation: { aspectRatio: '21:9' },
      history: [],
    }

    await expect(bindCanvasToolboxTaskToNode({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      assetId: 'asset-panorama',
      taskId: 'task-panorama',
      type: 'image',
      title: '雨夜街道 · 720全景',
      prompt: '生成无缝全景场景',
      modelKey: 'nori::nori-image',
      inputMode: 'image',
      options: { aspectRatio: '21:9', resolution: '2K' },
      referenceSummary: [{ id: 'source-1', title: '雨夜街道', type: 'image' }],
      processType: 'panorama_720',
    })).resolves.toBe(true)

    expect(state.node.data).toMatchObject({
      processType: 'panorama_720',
      generation: { assetId: 'asset-panorama', taskId: 'task-panorama' },
    })
  })

  it('uses the expected task binding as a CAS guard and clears a consumed planning marker', async () => {
    state.node.taskId = 'planning-task'
    state.node.data = {
      generationTask: { kind: 'storyboard_plan', taskId: 'planning-task' },
      generation: {},
      history: [],
    }

    await expect(bindCanvasToolboxTaskToNode({
      projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1', assetId: 'asset-shot-1',
      taskId: 'image-task', type: 'image', title: '镜头 1', prompt: '雨夜车站', modelKey: 'image-model',
      inputMode: 'text', options: { aspectRatio: '16:9' }, referenceSummary: [],
      expectedTaskId: 'newer-planning-task', clearGenerationTask: true,
    })).resolves.toBe(false)
    expect(state.node.taskId).toBe('planning-task')

    await expect(bindCanvasToolboxTaskToNode({
      projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1', assetId: 'asset-shot-1',
      taskId: 'image-task', type: 'image', title: '镜头 1', prompt: '雨夜车站', modelKey: 'image-model',
      inputMode: 'text', options: { aspectRatio: '16:9' }, referenceSummary: [],
      expectedTaskId: 'planning-task', clearGenerationTask: true,
    })).resolves.toBe(true)
    expect(state.node.taskId).toBe('image-task')
    expect(state.node.data.generationTask).toBeNull()
  })

  it('projects a terminal result only while the node still points at the same task and asset', async () => {
    state.node.taskId = 'task-1'
    state.node.data = {
      generation: { assetId: 'asset-1', taskId: 'task-1' },
      history: [{ id: 'asset:asset-1', assetId: 'asset-1', status: 'processing' }],
    }
    await expect(projectCanvasToolboxTaskTerminal({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      assetId: 'asset-1',
      taskId: 'task-1',
      type: 'video',
      status: 'ready',
      resultUrl: 'toolbox/video.mp4',
      materialId: 'material-1',
      materialMetadata: { durationSeconds: 5 },
    })).resolves.toBe(true)
    expect(state.node.data).toMatchObject({
      contentUrl: 'toolbox/video.mp4',
      videoUrl: 'toolbox/video.mp4',
      materialId: 'material-1',
      sourceMetadata: { durationSeconds: 5 },
      progress: 100,
      history: [{ status: 'ready', url: 'toolbox/video.mp4' }],
    })

    state.node.taskId = 'newer-task'
    await expect(projectCanvasToolboxTaskTerminal({
      projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1', assetId: 'asset-1',
      taskId: 'task-1', type: 'video', status: 'failed', errorMessage: 'late failure',
    })).resolves.toBe(false)
  })

  it('recovers when the worker finishes before the submit route binds the node', async () => {
    await expect(projectCanvasToolboxTaskTerminal({
      projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1', assetId: 'asset-fast',
      taskId: 'task-fast', type: 'image', status: 'ready', resultUrl: 'fast.jpg', materialId: 'material-fast',
    })).resolves.toBe(false)

    await bindCanvasToolboxTaskToNode({
      projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1', assetId: 'asset-fast',
      taskId: 'task-fast', type: 'image', title: '快速图片', prompt: '快速完成', modelKey: 'nori::nori-image',
      inputMode: 'text', options: { aspectRatio: '16:9', resolution: '2K' }, referenceSummary: [],
    })
    await expect(projectCanvasToolboxTaskTerminal({
      projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1', assetId: 'asset-fast',
      taskId: 'task-fast', type: 'image', status: 'ready', resultUrl: 'fast.jpg', materialId: 'material-fast',
    })).resolves.toBe(true)
    expect(state.node.data).toMatchObject({ imageUrl: 'fast.jpg', progress: 100 })
  })

  it('records a queue submission failure on the reserved output without touching a task-bound sibling', async () => {
    await expect(projectCanvasToolboxSubmissionFailure({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      assetId: 'asset-failed',
      type: 'image',
      title: '概念图 2',
      prompt: '第二张概念图',
      modelKey: 'nori::nori-image',
      inputMode: 'text',
      options: { aspectRatio: '16:9' },
      referenceSummary: [],
      errorMessage: 'queue unavailable',
    })).resolves.toBe(true)

    expect(state.node.data).toMatchObject({
      generation: { assetId: 'asset-failed', modelKey: 'nori::nori-image' },
      errorMessage: 'queue unavailable',
      history: [{ assetId: 'asset-failed', status: 'failed', errorMessage: 'queue unavailable' }],
    })
    expect((state.node.data.generation as Record<string, unknown>)).not.toHaveProperty('taskId')

    state.node.taskId = 'task-running'
    await expect(projectCanvasToolboxSubmissionFailure({
      projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1', assetId: 'asset-failed-again',
      type: 'image', title: '概念图 2', prompt: '重试', modelKey: 'nori::nori-image', inputMode: 'text',
      options: {}, referenceSummary: [], errorMessage: 'late duplicate failure',
    })).resolves.toBe(false)
  })
})
