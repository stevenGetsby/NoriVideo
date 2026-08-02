import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  frameosToolboxAsset: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  task: {
    findUnique: vi.fn(),
  },
}))

const providerMock = vi.hoisted(() => ({
  resolveFrameos3DProviderConfig: vi.fn(() => ({
    protocol: 'tripo-v2',
    baseUrl: 'https://model.example',
    apiKey: 'test-token',
    modelVersion: 'v3-test',
    createPath: '/task',
    taskPath: '/task/{taskId}',
    pollIntervalMs: 1,
    timeoutMs: 1_000,
  })),
  normalizeFrameos3DTopology: vi.fn((value: unknown) => value === 'low_poly' ? 'low_poly' : 'standard'),
  normalizeFrameos3DPose: vi.fn((value: unknown) => value === 'a_pose' || value === 't_pose' ? value : 'none'),
  submitFrameos3DGeneration: vi.fn(),
  waitForFrameos3DGeneration: vi.fn(),
}))

const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn((prefix: string, extension: string) => `${prefix}/generated.${extension}`),
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
}))

const registerMaterialMock = vi.hoisted(() => vi.fn(async () => ({ id: 'material-model-1' })))
const trySetTaskExternalIdMock = vi.hoisted(() => vi.fn(async () => true))
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/model3d/frameos-3d-provider', () => providerMock)
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial: registerMaterialMock }))
vi.mock('@/lib/task/service', () => ({ trySetTaskExternalId: trySetTaskExternalIdMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: assertTaskActiveMock }))

import {
  assertGlbBuffer,
  handleToolboxModel3DTask,
} from '@/lib/workers/handlers/toolbox-model3d-task-handler'

function glbBuffer() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 }))
  const jsonLength = Math.ceil(json.length / 4) * 4
  const body = Buffer.alloc(12 + 8 + jsonLength, 0x20)
  body.write('glTF', 0, 'ascii')
  body.writeUInt32LE(2, 4)
  body.writeUInt32LE(body.length, 8)
  body.writeUInt32LE(jsonLength, 12)
  body.writeUInt32LE(0x4e4f534a, 16)
  json.copy(body, 20)
  return body
}

function job(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-model3d-1',
      type: TASK_TYPE.TOOLBOX_MODEL_3D,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'FrameosToolboxAsset',
      targetId: 'asset-model3d-1',
      userId: 'user-1',
      payload: {
        ownerName: '资产师甲',
        title: '侦探角色',
        prompt: '年轻侦探，深色长风衣',
        model3dModel: 'frameos3d::frameos-3d-v1',
        topology: 'low_poly',
        generateTexture: true,
        pose: 'a_pose',
      },
    },
  } as unknown as Job<TaskJobData>
}

describe('toolbox 3D task handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.frameosToolboxAsset.findFirst.mockResolvedValue({ id: 'asset-model3d-1', params: {} })
    prismaMock.task.findUnique.mockResolvedValue({ externalId: null })
    providerMock.submitFrameos3DGeneration.mockResolvedValue({ externalTaskId: 'external-3d-1', result: null })
    providerMock.waitForFrameos3DGeneration.mockImplementation(async (_config, _id, onProgress) => {
      await onProgress?.(60, 'running')
      return {
        modelUrl: 'https://cdn.example/model.glb',
        thumbnailUrl: 'https://cdn.example/model.png',
      }
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('.glb')
      ? (() => { const body = glbBuffer(); return new Response(body, { status: 200, headers: { 'Content-Type': 'model/gltf-binary', 'Content-Length': String(body.length) } }) })()
      : new Response(Buffer.from('thumbnail'), { status: 200, headers: { 'Content-Type': 'image/png' } })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resumes an async provider task, validates GLB, stores it, and registers model3d material', async () => {
    const result = await handleToolboxModel3DTask(job())

    expect(providerMock.submitFrameos3DGeneration).toHaveBeenCalledWith(expect.any(Object), {
      prompt: '年轻侦探，深色长风衣',
      topology: 'low_poly',
      generateTexture: true,
      pose: 'a_pose',
    })
    expect(trySetTaskExternalIdMock).toHaveBeenCalledWith('task-model3d-1', 'external-3d-1')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      expect.any(Buffer),
      'toolbox-model3d/project-1/generated.glb',
      3,
      'model/gltf-binary',
    )
    expect(registerMaterialMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      ownerName: '资产师甲',
      title: '侦探角色',
      type: 'model3d',
      source: 'toolbox',
      metadata: expect.objectContaining({ topology: 'low_poly', generateTexture: true, pose: 'a_pose' }),
    }))
    expect(result).toEqual({
      assetId: 'asset-model3d-1',
      materialId: 'material-model-1',
      modelUrl: 'toolbox-model3d/project-1/generated.glb',
      thumbnailUrl: 'toolbox-model3d-thumbnail/project-1/generated.png',
    })
    expect(prismaMock.frameosToolboxAsset.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'asset-model3d-1' },
      data: expect.objectContaining({
        status: 'ready',
        resultUrl: 'toolbox-model3d/project-1/generated.glb',
        materialId: 'material-model-1',
      }),
    }))
  })

  it('continues polling the persisted task external ID without submitting a duplicate model', async () => {
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId: 'existing-external-3d' })

    await handleToolboxModel3DTask(job())

    expect(providerMock.submitFrameos3DGeneration).not.toHaveBeenCalled()
    expect(providerMock.waitForFrameos3DGeneration).toHaveBeenCalledWith(
      expect.any(Object),
      'existing-external-3d',
      expect.any(Function),
    )
  })

  it('rejects malformed provider output before uploading it', () => {
    expect(() => assertGlbBuffer(Buffer.from('not-a-glb'))).toThrow('不是有效的 GLB 2.0')

    const headerOnly = Buffer.alloc(12)
    headerOnly.write('glTF', 0, 'ascii')
    headerOnly.writeUInt32LE(2, 4)
    headerOnly.writeUInt32LE(headerOnly.length, 8)
    expect(() => assertGlbBuffer(headerOnly)).toThrow('不是有效的 GLB 2.0')
  })
})
