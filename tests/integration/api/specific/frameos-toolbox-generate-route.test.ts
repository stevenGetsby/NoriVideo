import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'

const state = vi.hoisted(() => ({ nextAsset: 1 }))
const submitTaskMock = vi.hoisted(() => vi.fn())
const generateAudioMock = vi.hoisted(() => vi.fn())
const uploadObjectMock = vi.hoisted(() => vi.fn())
const registerMaterialMock = vi.hoisted(() => vi.fn())
const capabilityMock = vi.hoisted(() => vi.fn(async () => ({ resolution: '1080p' })))
const audioAvailabilityMock = vi.hoisted(() => vi.fn(async () => ({
  available: true,
  modes: ['tts'],
  runtimeModelKey: 'bailian::qwen3-tts-vd-2026-01-26',
  unavailableReason: null,
})))
const prepareCanvasOutputsMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  frameosMaterial: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  frameosToolboxAsset: {
    create: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  task: { findFirst: vi.fn() },
  canvasNode: {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1', name: '资产师甲' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelection: vi.fn(async (_userId: string, _modelKey: string, type: string) => ({ modelKey: 'provider::model', provider: type === 'audio' ? 'bailian' : 'provider' })),
  getProviderKey: vi.fn((provider: string) => provider.split(':')[0]),
}))
vi.mock('@/lib/config-service', () => ({
  resolveProjectModelCapabilityGenerationOptions: capabilityMock,
}))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/audio/provider', () => ({ resolveAudioGenerationAvailability: audioAvailabilityMock }))
vi.mock('@/lib/generator-api', () => ({ generateAudio: generateAudioMock }))
vi.mock('@/lib/storage', () => ({
  generateUniqueKey: vi.fn(() => 'toolbox-audio/generated.wav'),
  toFetchableUrl: vi.fn((value: string) => value),
  uploadObject: uploadObjectMock,
}))
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial: registerMaterialMock }))
vi.mock('@/lib/canvas/toolbox-output-nodes', () => ({
  prepareCanvasToolboxImageOutputs: prepareCanvasOutputsMock,
}))
vi.mock('@/lib/model3d/frameos-3d-provider', () => ({
  FRAMEOS_3D_MODEL_KEY: 'frameos3d::frameos-3d-v1',
  getFrameos3DModelAvailability: vi.fn(() => ({
    modelKey: 'frameos3d::frameos-3d-v1',
    name: '帧界 3D 1.0',
    provider: 'frameos3d',
    available: true,
    unavailableReason: null,
    options: {},
  })),
  normalizeFrameos3DTopology: vi.fn((value: unknown) => value === 'low_poly' ? 'low_poly' : 'standard'),
  normalizeFrameos3DPose: vi.fn((value: unknown) => value === 'a_pose' || value === 't_pose' ? value : 'none'),
}))

import { POST } from '@/app/api/frameos/toolbox/generate/route'

const routeContext = { params: Promise.resolve({}) }

describe('FrameOS toolbox generation route', () => {
  it('automatically reuses saved character-card audio for multimodal video without duplicating it', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-1', title: '关羽', type: 'image', storageKey: 'images/guanyu.png', metadata: { voiceMaterialId: 'voice-1' } },
    ]).mockResolvedValueOnce([
      { id: 'voice-1', title: '关羽音色', type: 'audio', storageKey: 'voice/guanyu.wav', metadata: { durationSeconds: 6 } },
    ])
    const response = await POST(buildMockRequest({ path: '/api/frameos/toolbox/generate', method: 'POST', body: {
      projectId: 'project-1', type: 'video', title: '试镜', prompt: '关羽说话', modelKey: 'nori::norivideo2.5',
      inputMode: 'text', referenceMaterialIds: ['material-1'], options: { duration: 5, generateAudio: true },
    } }), routeContext)
    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ referenceImages: ['images/guanyu.png'], referenceAudios: ['voice/guanyu.wav'], referenceMaterialIds: ['material-1', 'voice-1'] }) }))
  })

  it('never attaches a role voice to an explicitly silent video', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-1', title: '关羽', type: 'image', storageKey: 'images/guanyu.png', metadata: { voiceMaterialId: 'voice-1' } },
    ])
    const response = await POST(buildMockRequest({ path: '/api/frameos/toolbox/generate', method: 'POST', body: {
      projectId: 'project-1', type: 'video', title: '静默', prompt: '关羽静坐', modelKey: 'nori::norivideo2.5',
      inputMode: 'text', referenceMaterialIds: ['material-1'], options: { duration: 5, generateAudio: false },
    } }), routeContext)
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledTimes(1)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ referenceAudios: [] }) }))
  })

  it('rejects unavailable saved voices without creating a paid task', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-1', type: 'image', storageKey: 'images/role.png', metadata: { voiceMaterialId: 'deleted-voice' } },
    ]).mockResolvedValueOnce([])
    const response = await POST(buildMockRequest({ path: '/api/frameos/toolbox/generate', method: 'POST', body: {
      projectId: 'project-1', type: 'video', title: '试镜', prompt: '说话', modelKey: 'nori::norivideo2.5', inputMode: 'text', referenceMaterialIds: ['material-1'],
    } }), routeContext)
    expect(response.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
  it('rejects media attached to explicit pure text video without charging or queuing', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate', method: 'POST',
      body: { projectId: 'project-1', type: 'video', title: '纯文生', prompt: '雨夜街头', modelKey: 'nori::norivideo2.5', inputMode: 'text', textOnly: true, referenceMaterialIds: ['material-1'] },
    }), routeContext)
    expect(response.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
  })

  it('submits explicit pure text video with no media arrays', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate', method: 'POST',
      body: { projectId: 'project-1', type: 'video', title: '纯文生', prompt: '雨夜街头', modelKey: 'nori::norivideo2.5', inputMode: 'text', textOnly: true, options: { duration: 5, resolution: '720p' } },
    }), routeContext)
    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ referenceImages: [], referenceVideos: [], referenceAudios: [] }) }))
  })
  beforeEach(() => {
    vi.clearAllMocks()
    state.nextAsset = 1
    prismaMock.frameosMaterial.findMany.mockResolvedValue([
      { id: 'material-1', title: '苏晚卿', type: 'image', storageKey: 'images/su.png', resultUrl: null },
      { id: 'material-2', title: '柴房', type: 'image', storageKey: 'images/shed.png', resultUrl: null },
    ])
    prismaMock.frameosMaterial.findFirst.mockResolvedValue(null)
    prismaMock.frameosToolboxAsset.create.mockImplementation(async () => ({
      id: `toolbox-asset-${state.nextAsset++}`,
    }))
    prismaMock.frameosToolboxAsset.findUnique.mockResolvedValue(null)
    prismaMock.frameosToolboxAsset.upsert.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }))
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.canvasNode.findFirst.mockImplementation(async ({ where }: { where?: { id?: string } }) => ({
      id: where?.id || 'node-model3d-1',
      data: { title: '3D 模型' },
    }))
    submitTaskMock.mockImplementation(async () => ({
      taskId: `task-${submitTaskMock.mock.calls.length}`,
      async: true,
    }))
    generateAudioMock.mockResolvedValue({ success: true, audioUrl: 'data:audio/wav;base64,UklGRg==' })
    uploadObjectMock.mockResolvedValue('toolbox-audio/generated.wav')
    registerMaterialMock.mockResolvedValue({ id: 'material-audio-1' })
    prepareCanvasOutputsMock.mockResolvedValue({
      nodeIds: ['node-source', 'node-output-2'],
      canvasRevision: 12,
      created: true,
    })
  })

  it('submits each requested image as a toolbox image task with ordered references', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '角色概念图',
        prompt: '@苏晚卿 站在 @柴房 门前',
        modelKey: 'image-provider::model-1',
        assetCategory: 'character',
        referenceMaterialIds: ['material-2', 'material-1'],
        count: 2,
        inputMode: 'text',
        idempotencyKey: 'toolbox-images-request-1',
        options: { aspectRatio: '9:16', resolution: '2K', quality: 'high' },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledTimes(2)
    expect(submitTaskMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_IMAGE,
      projectId: 'project-1',
      targetType: 'FrameosToolboxAsset',
      targetId: expect.any(String),
      payload: expect.objectContaining({
        title: '角色概念图 · 1',
        ownerName: '资产师甲',
        imageModel: 'image-provider::model-1',
        assetCategory: 'character',
        referenceImages: ['images/shed.png', 'images/su.png'],
        referenceNames: ['柴房', '苏晚卿'],
        aspectRatio: '9:16',
        resolution: '2K',
        quality: 'high',
      }),
    }))
    expect(prismaMock.frameosToolboxAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        params: expect.objectContaining({ assetCategory: 'character' }),
      }),
    }))
  })

  it('keeps the panorama marker in the task, asset and durable canvas node', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'node-panorama',
        type: 'image',
        title: '柴房 · 720全景',
        prompt: '补全无缝衔接的 720° 全景空间',
        modelKey: 'image-provider::model-1',
        processType: 'panorama_720',
        referenceMaterialIds: ['material-2'],
        count: 3,
        inputMode: 'image',
        idempotencyKey: 'panorama-request-1',
        options: { aspectRatio: '21:9', resolution: '2K', quality: 'high' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })

    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledTimes(1)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_IMAGE,
      payload: expect.objectContaining({
        processType: 'panorama_720',
        aspectRatio: '21:9',
        count: 1,
      }),
    }))
    expect(prismaMock.frameosToolboxAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        params: expect.objectContaining({ processType: 'panorama_720' }),
      }),
    }))
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        data: expect.objectContaining({ processType: 'panorama_720' }),
      }),
    }))
  })

  it('returns a ready stable asset without creating a second paid task for the same idempotency key', async () => {
    prismaMock.frameosToolboxAsset.upsert.mockResolvedValueOnce({
      id: 'stable-ready-asset',
      status: 'ready',
      resultUrl: 'images/already-generated.png',
      materialId: 'material-ready-1',
      params: {},
    })
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'task-original-completed' })

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '角色概念图',
        prompt: '同一条不可重复计费的请求',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 1,
        inputMode: 'text',
        idempotencyKey: 'ready-request-1',
        options: { aspectRatio: '9:16' },
      },
    }), routeContext)
    const payload = await response.json() as { tasks?: Array<{ taskId: string; assetId: string }> }

    expect(response.status).toBe(200)
    expect(payload.tasks).toEqual([{ taskId: 'task-original-completed', assetId: 'stable-ready-asset' }])
    expect(submitTaskMock).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.updateMany).not.toHaveBeenCalled()
  })

  it('requires an idempotency key before creating any multi-output history', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '两张概念图',
        prompt: '同一场景的两个版本',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 2,
        inputMode: 'text',
        options: { aspectRatio: '9:16' },
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toMatch(/idempotencyKey|幂等键/)
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.upsert).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('drops injected and type-invalid options while writing trusted task fields last', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '可信标题',
        prompt: '可信提示词',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 1,
        inputMode: 'text',
        options: {
          aspectRatio: '1:1',
          prompt: '攻击者提示词',
          modelId: 'evil::model',
          imageModel: 'evil::model',
          canvasId: 'other-canvas',
          nodeId: 'other-node',
          inputMode: 'image',
          referenceImages: 'private/image.png',
          duration: 999,
          resolution: ['4K'],
          arbitraryProviderFlag: true,
        },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    const payload = submitTaskMock.mock.calls[0]?.[0]?.payload as Record<string, unknown>
    expect(payload).toMatchObject({
      title: '可信标题',
      prompt: '可信提示词',
      inputMode: 'text',
      imageModel: 'image-provider::model-1',
      modelId: 'image-provider::model-1',
      canvasId: null,
      nodeId: null,
      referenceImages: [],
      aspectRatio: '1:1',
    })
    expect(payload).not.toHaveProperty('duration')
    expect(payload).not.toHaveProperty('arbitraryProviderFlag')
    const created = prismaMock.frameosToolboxAsset.create.mock.calls[0]?.[0] as {
      data: { params: Record<string, unknown> }
    }
    expect(created.data.params).toMatchObject({
      prompt: '可信提示词',
      inputMode: 'text',
      canvasId: null,
      nodeId: null,
      aspectRatio: '1:1',
    })
    expect(created.data.params).not.toHaveProperty('imageModel')
    expect(created.data.params).not.toHaveProperty('arbitraryProviderFlag')
  })

  it('prepares and binds every canvas multi-image output before returning stable node identities', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'node-source',
        type: 'image',
        title: '角色概念图',
        prompt: '同一角色的两个镜头',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 2,
        inputMode: 'text',
        idempotencyKey: 'multi-request-1',
        expectedRevision: 11,
        clientId: 'browser-1',
        options: { aspectRatio: '9:16', resolution: '2K', quality: 'high' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })
    const body = await response.json() as {
      canvasRevision: number
      tasks: Array<{ taskId: string; assetId: string; nodeId: string }>
    }

    expect(response.status).toBe(200)
    expect(prepareCanvasOutputsMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      canvasId: 'canvas-1',
      sourceNodeId: 'node-source',
      idempotencyKey: 'multi-request-1',
      expectedRevision: 11,
      clientId: 'browser-1',
      count: 2,
    }))
    expect(submitTaskMock).toHaveBeenCalledTimes(2)
    expect(submitTaskMock.mock.calls.map((call) => call[0].payload.nodeId)).toEqual([
      'node-source',
      'node-output-2',
    ])
    expect(submitTaskMock.mock.calls.map((call) => call[0].payload.canvasId)).toEqual([
      'canvas-1',
      'canvas-1',
    ])
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledTimes(2)
    expect(body.canvasRevision).toBe(12)
    expect(body.tasks.map((task) => task.nodeId)).toEqual(['node-source', 'node-output-2'])
    expect(prismaMock.frameosToolboxAsset.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      create: expect.objectContaining({
        params: expect.objectContaining({ canvasId: 'canvas-1', nodeId: 'node-source' }),
      }),
    }))
    expect(prismaMock.frameosToolboxAsset.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      create: expect.objectContaining({
        params: expect.objectContaining({ canvasId: 'canvas-1', nodeId: 'node-output-2' }),
      }),
    }))
  })

  it('continues later outputs when one reserved multi-image submission fails', async () => {
    prepareCanvasOutputsMock.mockResolvedValueOnce({
      nodeIds: ['node-source', 'node-output-2', 'node-output-3'],
      canvasRevision: 12,
      created: true,
    })
    submitTaskMock
      .mockResolvedValueOnce({ taskId: 'task-first', async: true })
      .mockRejectedValueOnce(new Error('second queue unavailable'))
      .mockResolvedValueOnce({ taskId: 'task-third', async: true })

    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'node-source',
        type: 'image',
        title: '角色概念图',
        prompt: '三个互不覆盖的输出',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 3,
        inputMode: 'text',
        idempotencyKey: 'partial-request-1',
        expectedRevision: 11,
        clientId: 'browser-1',
        options: { aspectRatio: '9:16' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })

    const body = await response.json() as {
      success: boolean
      partial: boolean
      tasks: Array<{ taskId: string; nodeId: string }>
      failures: Array<{ index: number; nodeId: string; message: string }>
    }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: false, partial: true })
    expect(body.tasks.map((task) => task.nodeId)).toEqual(['node-source', 'node-output-3'])
    expect(body.failures).toEqual([{ index: 1, nodeId: 'node-output-2', assetId: expect.any(String), message: 'second queue unavailable' }])
    expect(submitTaskMock).toHaveBeenCalledTimes(3)
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledTimes(3)
    expect(prismaMock.canvasNode.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'node-source', canvasId: 'canvas-1' },
      data: expect.objectContaining({ status: 'RUNNING', taskId: 'task-first' }),
    }))
    expect(prismaMock.canvasNode.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        data: expect.objectContaining({ errorMessage: 'second queue unavailable' }),
      }),
    }))
    expect(prismaMock.canvasNode.updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: { id: 'node-output-3', canvasId: 'canvas-1' },
      data: expect.objectContaining({ status: 'RUNNING', taskId: 'task-third' }),
    }))
    expect(prismaMock.frameosToolboxAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: expect.any(String), status: { not: 'ready' } },
      data: { status: 'failed', errorMessage: 'second queue unavailable' },
    }))
  })

  it('returns non-canvas multi-output successes and failures without dropping later work', async () => {
    submitTaskMock
      .mockResolvedValueOnce({ taskId: 'task-first', async: true })
      .mockRejectedValueOnce(new Error('second queue unavailable'))
      .mockResolvedValueOnce({ taskId: 'task-third', async: true })

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '工具箱概念图',
        prompt: '生成三个版本',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 3,
        inputMode: 'text',
        idempotencyKey: 'non-canvas-partial-request',
        options: { aspectRatio: '9:16' },
      },
    }), routeContext)
    const body = await response.json() as {
      success: boolean
      partial: boolean
      tasks: Array<{ taskId: string; assetId: string }>
      failures: Array<{ index: number; assetId: string; message: string; nodeId?: string }>
    }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: false, partial: true })
    expect(body.tasks.map((task) => task.taskId)).toEqual(['task-first', 'task-third'])
    expect(body.failures).toEqual([{
      index: 1,
      assetId: expect.any(String),
      message: 'second queue unavailable',
    }])
    expect(body.failures[0]).not.toHaveProperty('nodeId')
    expect(submitTaskMock).toHaveBeenCalledTimes(3)
  })

  it('rejects changed content bound to an existing idempotency request hash', async () => {
    prismaMock.frameosToolboxAsset.findUnique.mockResolvedValueOnce({
      id: 'stable-asset',
      params: { requestHash: 'hash-for-another-request' },
    })

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '被修改的请求',
        prompt: '这次提示词已经变化',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 1,
        inputMode: 'text',
        idempotencyKey: 'already-bound-request-key',
        options: { aspectRatio: '9:16' },
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(409)
    expect(body.message).toMatch(/幂等键/)
    expect(prismaMock.frameosToolboxAsset.upsert).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('revives a failed idempotent asset before binding its replacement task', async () => {
    prismaMock.frameosToolboxAsset.upsert.mockResolvedValueOnce({
      id: 'failed-stable-asset',
      status: 'failed',
    })

    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'node-source',
        type: 'image',
        title: '重试图片',
        prompt: '重新提交失败的输出',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 1,
        inputMode: 'text',
        idempotencyKey: 'retry-failed-request',
        options: { aspectRatio: '9:16' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.frameosToolboxAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'failed-stable-asset', status: 'failed' },
      data: { status: 'pending', errorMessage: null },
    })
    expect(submitTaskMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RUNNING' }),
    }))
  })

  it('submits image_edit with one source image and a dedicated mask task field', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-source', title: '原始人物图', type: 'image', storageKey: 'images/source.png', resultUrl: null },
    ])
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({
      id: 'material-mask',
      title: '局部重绘蒙版',
      type: 'image',
      storageKey: 'images/source-mask.png',
      resultUrl: null,
    })

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '局部重绘结果',
        prompt: '只替换蒙版覆盖的窗户区域',
        modelKey: 'openai-compatible:oa-1::gpt-image-1',
        processType: 'image_edit',
        referenceMaterialIds: ['material-source'],
        maskMaterialId: 'material-mask',
        count: 1,
        inputMode: 'image',
        options: {
          editMode: 'normal',
          maskImage: 'images/attacker-mask.png',
          referenceImages: 'images/attacker-reference.png',
        },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['material-source'] },
        userId: 'user-1',
        type: 'image',
        status: 'ready',
      }),
    }))
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'material-mask',
        userId: 'user-1',
        type: 'image',
        status: 'ready',
      }),
    }))
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_IMAGE,
      payload: expect.objectContaining({
        processType: 'image_edit',
        editMode: 'inpaint',
        referenceMaterialIds: ['material-source'],
        referenceImages: ['images/source.png'],
        maskMaterialId: 'material-mask',
        maskImage: 'images/source-mask.png',
      }),
    }))

    const submitted = submitTaskMock.mock.calls[0]?.[0] as {
      payload?: { referenceImages?: string[] }
    } | undefined
    expect(submitted?.payload?.referenceImages).toEqual(['images/source.png'])
    expect(submitted?.payload?.referenceImages).not.toContain('images/source-mask.png')
  })

  it('rejects a mask material mixed into ordinary image references', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '错误混入蒙版的任务',
        prompt: '替换窗户区域',
        modelKey: 'openai-compatible:oa-1::gpt-image-1',
        processType: 'image_edit',
        referenceMaterialIds: ['material-1', 'material-mask'],
        maskMaterialId: 'material-mask',
        count: 1,
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toMatch(/不能混入|单独提交/i)
    expect(prismaMock.frameosMaterial.findMany).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('rejects image_edit without a mask before creating history or task records', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '缺少蒙版的局部重绘',
        prompt: '替换窗户区域',
        modelKey: 'openai-compatible:oa-1::gpt-image-1',
        processType: 'image_edit',
        referenceMaterialIds: ['material-1'],
        count: 1,
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toMatch(/mask|蒙版/i)
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.upsert).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'no source image', referenceMaterialIds: [] },
    { label: 'multiple source images', referenceMaterialIds: ['material-1', 'material-2'] },
  ])('rejects image_edit with $label before creating an asset', async ({ referenceMaterialIds }) => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({
      id: 'material-mask',
      title: '局部重绘蒙版',
      type: 'image',
      storageKey: 'images/source-mask.png',
      resultUrl: null,
    })

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '源图数量错误',
        prompt: '替换窗户区域',
        modelKey: 'openai-compatible:oa-1::gpt-image-1',
        processType: 'image_edit',
        referenceMaterialIds,
        maskMaterialId: 'material-mask',
        count: 1,
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toMatch(/1/)
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.upsert).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('rejects a model without supportsInpaint before creating an asset or task', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '不支持模型的局部重绘',
        prompt: '替换窗户区域',
        modelKey: 'fal::banana-2',
        processType: 'image_edit',
        referenceMaterialIds: ['material-1'],
        maskMaterialId: 'material-mask',
        count: 1,
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toMatch(/unsupported|不支持/i)
    expect(prismaMock.frameosMaterial.findMany).not.toHaveBeenCalled()
    expect(prismaMock.frameosMaterial.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.upsert).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('delegates idempotent active-task and orphan recovery to submitTask', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'existing-shot-task' })
    submitTaskMock.mockResolvedValueOnce({
      taskId: 'existing-shot-task',
      async: true,
      deduped: true,
    })

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '连续故事版 · 1',
        prompt: '雨夜车站的连续镜头',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 1,
        inputMode: 'text',
        idempotencyKey: 'planning-task-1:shot:1',
        options: { aspectRatio: '9:16' },
      },
    }), routeContext)
    const body = await response.json() as { tasks: Array<{ taskId: string; assetId: string }> }

    expect(response.status).toBe(200)
    expect(prismaMock.frameosToolboxAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: expect.any(String) },
      create: expect.objectContaining({ id: expect.any(String), projectId: 'project-1', type: 'image' }),
      update: {},
    }))
    expect(prismaMock.task.findFirst).not.toHaveBeenCalled()
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'FrameosToolboxAsset',
      type: TASK_TYPE.TOOLBOX_IMAGE,
      dedupeKey: expect.stringContaining(TASK_TYPE.TOOLBOX_IMAGE),
    }))
    expect(body.tasks).toEqual([{ taskId: 'existing-shot-task', assetId: expect.any(String) }])
  })

  it('submits first/last-frame video parameters through the video queue', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        title: '雨夜镜头',
        prompt: '@苏晚卿 跑入 @柴房',
        modelKey: 'ark::doubao-seedance-2-0',
        referenceMaterialIds: ['material-1', 'material-2'],
        referenceMaterials: [
          { materialId: 'material-1', role: 'FIRST_FRAME' },
          { materialId: 'material-2', role: 'LAST_FRAME' },
        ],
        inputMode: 'firstlastframe',
        options: { aspectRatio: '9:16', resolution: '1080p', duration: 5, generateAudio: true },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    expect(capabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      modelType: 'video',
      runtimeSelections: {
        resolution: '1080p',
        duration: 5,
        generateAudio: true,
        generationMode: 'firstlastframe',
      },
    }))
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_VIDEO,
      payload: expect.objectContaining({
        videoModel: 'ark::doubao-seedance-2-0',
        inputMode: 'firstlastframe',
        referenceImages: ['images/su.png', 'images/shed.png'],
        referenceImageRoles: ['FIRST_FRAME', 'LAST_FRAME'],
        referenceMaterials: [
          { materialId: 'material-1', role: 'FIRST_FRAME' },
          { materialId: 'material-2', role: 'LAST_FRAME' },
        ],
        referenceNames: ['苏晚卿', '柴房'],
        generationOptions: expect.objectContaining({ generationMode: 'firstlastframe' }),
      }),
    }))
  })

  it('rejects positional-only first/last-frame references without semantic roles', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        title: '旧式首尾帧请求',
        prompt: 'push in',
        modelKey: 'ark::doubao-seedance-2-0',
        referenceMaterialIds: ['material-1', 'material-2'],
        inputMode: 'firstlastframe',
        options: { resolution: '1080p', duration: 5 },
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toContain('FIRST_FRAME')
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('submits a persistent FrameOS 3D task and binds it to the canvas node before returning', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'node-model3d-1',
        type: 'model3d',
        title: '侦探角色',
        prompt: '年轻侦探，深色长风衣',
        modelKey: 'frameos3d::frameos-3d-v1',
        referenceMaterialIds: [],
        options: { topology: 'low_poly', generateTexture: true, pose: 'a_pose' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })

    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_MODEL_3D,
      projectId: 'project-1',
      targetType: 'FrameosToolboxAsset',
      targetId: 'toolbox-asset-1',
      payload: {
        title: '侦探角色',
        ownerName: '资产师甲',
        prompt: '年轻侦探，深色长风衣',
        model3dModel: 'frameos3d::frameos-3d-v1',
        topology: 'low_poly',
        generateTexture: true,
        pose: 'a_pose',
      },
      maxAttempts: 3,
    }))
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'node-model3d-1', canvasId: 'canvas-1' },
      data: expect.objectContaining({
        status: 'RUNNING',
        taskId: 'task-1',
        data: expect.objectContaining({
          mediaType: 'model3d',
          processType: 'model_3d',
          generation: expect.objectContaining({
            assetId: 'toolbox-asset-1',
            taskId: 'task-1',
            parameters: expect.objectContaining({ topology: 'low_poly', generateTexture: true, pose: 'a_pose' }),
          }),
        }),
      }),
    }))
  })

  it('submits ordered image, video, and audio references for all-reference video generation', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-image', title: '苏晚卿', type: 'image', storageKey: 'images/su.png', resultUrl: null },
      { id: 'material-video', title: '奔跑动作', type: 'video', storageKey: 'video/run.mp4', resultUrl: null, metadata: { durationSeconds: 6.5 } },
      { id: 'material-audio', title: '雨声', type: 'audio', storageKey: 'voice/rain.wav', resultUrl: null, metadata: { durationSeconds: 6 } },
    ])

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        title: '全能参考镜头',
        prompt: '@苏晚卿 按照 @奔跑动作 在 @雨声 中冲出门外',
        modelKey: 'hfsy::doubao-seedance-2-0',
        referenceMaterialIds: ['material-video', 'material-audio', 'material-image'],
        inputMode: 'text',
        options: { aspectRatio: '9:16', resolution: '1080p', duration: 6 },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['material-video', 'material-audio', 'material-image'] },
        userId: 'user-1',
        type: { in: ['image', 'video', 'audio'] },
        status: 'ready',
        deletedAt: null,
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
      },
    })
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_VIDEO,
      payload: expect.objectContaining({
        referenceImages: ['images/su.png'],
        referenceVideos: ['video/run.mp4'],
        inputVideoSeconds: 6.5,
        referenceAudios: ['voice/rain.wav'],
        referenceNames: ['奔跑动作', '雨声', '苏晚卿'],
        referenceImageNames: ['苏晚卿'],
        referenceVideoNames: ['奔跑动作'],
        referenceAudioNames: ['雨声'],
        referenceMaterialIds: ['material-video', 'material-audio', 'material-image'],
      }),
    }))
  })

  it('rejects standalone reference audio before creating a paid video task', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-audio', title: '角色音色', type: 'audio', storageKey: 'voice/character.wav', resultUrl: null, metadata: { durationSeconds: 6 } },
    ])

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        title: '只有音频的错误请求',
        prompt: '角色在雨中转身',
        modelKey: 'hfsy::doubao-seedance-2-0',
        referenceMaterialIds: ['material-audio'],
        inputMode: 'text',
        options: { aspectRatio: '9:16', resolution: '1080p', duration: 6 },
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toContain('参考音频不能单独提交')
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.upsert).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('allows prompt-backed standalone audio for Seedance 2.5', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-audio', title: '角色音色', type: 'audio', storageKey: 'voice/character.wav', resultUrl: null, metadata: { durationSeconds: 26 } },
    ])

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        title: '音频驱动镜头',
        prompt: '根据角色语气生成表演镜头',
        modelKey: 'nori::norivideo2.5',
        referenceMaterialIds: ['material-audio'],
        inputMode: 'text',
        options: { aspectRatio: 'adaptive', resolution: '720p', duration: 30 },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_VIDEO,
      payload: expect.objectContaining({
        referenceAudios: ['voice/character.wav'],
        generationOptions: expect.objectContaining({
          aspectRatio: 'adaptive',
          duration: 30,
        }),
      }),
    }))
  })

  it('does not validate a false audio default against models without an audio capability field', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        title: '无声普通镜头',
        prompt: 'locked camera, empty street',
        modelKey: 'ark::doubao-seedance-1-0-pro-fast-251015',
        referenceMaterialIds: [],
        inputMode: 'text',
        options: { aspectRatio: '16:9', resolution: '720p', duration: 5, generateAudio: false },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    expect(capabilityMock).toHaveBeenCalledWith(expect.objectContaining({
      modelType: 'video',
      runtimeSelections: {
        resolution: '720p',
        duration: 5,
        generationMode: 'normal',
      },
    }))
  })

  it('rejects an incomplete first/last-frame request before creating an asset', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([
      { id: 'material-1', title: '苏晚卿', type: 'image', storageKey: 'images/su.png', resultUrl: null },
    ])

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        title: '不完整镜头',
        prompt: 'push in',
        modelKey: 'ark::doubao-seedance-2-0',
        referenceMaterialIds: ['material-1'],
        referenceMaterials: [{ materialId: 'material-1', role: 'FIRST_FRAME' }],
        inputMode: 'firstlastframe',
        options: { resolution: '1080p', duration: 5 },
      },
    }), routeContext)
    const body = await response.json() as { message?: string }

    expect(response.status).toBe(400)
    expect(body.message).toContain('FIRST_FRAME')
    expect(prismaMock.frameosToolboxAsset.create).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('marks the created history record failed when queue submission fails', async () => {
    submitTaskMock.mockRejectedValueOnce(new Error('queue unavailable'))

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '失败样例',
        prompt: 'cinematic portrait',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 1,
        inputMode: 'text',
        options: { aspectRatio: '9:16' },
      },
    }), routeContext)

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(prismaMock.frameosToolboxAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'toolbox-asset-1', status: { not: 'ready' } },
      data: { status: 'failed', errorMessage: 'queue unavailable' },
    })
  })

  it('uses an atomic not-ready guard so compensation cannot downgrade a completed asset', async () => {
    prismaMock.frameosToolboxAsset.create.mockResolvedValueOnce({
      id: 'already-ready-asset',
      status: 'ready',
    })
    prismaMock.frameosToolboxAsset.updateMany.mockResolvedValueOnce({ count: 0 })
    submitTaskMock.mockRejectedValueOnce(new Error('late duplicate enqueue error'))

    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        title: '已完成图片',
        prompt: '不要回退完成状态',
        modelKey: 'image-provider::model-1',
        referenceMaterialIds: [],
        count: 1,
        inputMode: 'text',
        options: { aspectRatio: '1:1' },
      },
    }), routeContext)

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(prismaMock.frameosToolboxAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'already-ready-asset', status: { not: 'ready' } },
      data: { status: 'failed', errorMessage: 'late duplicate enqueue error' },
    })
    expect(prismaMock.frameosToolboxAsset.update).not.toHaveBeenCalled()
  })

  it('submits a persistent toolbox narration audio task', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([])
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'audio',
        title: '旁白',
        prompt: '雨夜里，她推开了柴房的门。',
        modelKey: 'nori::nori-audio',
        referenceMaterialIds: [],
        options: { mode: 'tts', voice: 'Cherry', duration: 8 },
      },
    }), routeContext)

    expect(response.status).toBe(200)
    expect(audioAvailabilityMock).toHaveBeenCalledWith({ userId: 'user-1', modelKey: 'nori::nori-audio' })
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.TOOLBOX_AUDIO,
      projectId: 'project-1',
      targetType: 'FrameosToolboxAsset',
      targetId: 'toolbox-asset-1',
      payload: expect.objectContaining({
        title: '旁白',
        prompt: '雨夜里，她推开了柴房的门。',
        audioModel: 'nori::nori-audio',
        mode: 'tts',
        voice: 'Cherry',
        duration: null,
      }),
      maxAttempts: 5,
    }))
    expect(generateAudioMock).not.toHaveBeenCalled()
    expect(uploadObjectMock).not.toHaveBeenCalled()
    expect(registerMaterialMock).not.toHaveBeenCalled()
  })
})
