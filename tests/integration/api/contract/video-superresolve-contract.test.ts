import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildMockRequest } from '../../../helpers/request'
import { getCapabilityOptionFields, resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { calcVideo } from '@/lib/billing/cost'

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({ taskId: 'task-1', async: true })))
const capabilityMock = vi.hoisted(() => vi.fn(async () => ({ resolution: '480p' })))
const prismaMock = vi.hoisted(() => ({
  frameosMaterial: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  frameosToolboxAsset: {
    create: vi.fn(async () => ({ id: 'asset-1' })),
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => ({ id: 'asset-1' })),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  task: { findFirst: vi.fn(async () => null) },
  canvasNode: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: vi.fn(async () => ({ session: { user: { id: 'user-1' } } })),
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } }, project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/api-config', () => ({ resolveModelSelection: vi.fn(async () => ({ modelKey: 'provider::model' })) }))
vi.mock('@/lib/config-service', () => ({ resolveProjectModelCapabilityGenerationOptions: capabilityMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/canvas/toolbox-output-nodes', () => ({ prepareCanvasToolboxImageOutputs: vi.fn() }))
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial: vi.fn() }))
vi.mock('@/lib/storage', () => ({ toFetchableUrl: vi.fn((value: string) => value) }))
vi.mock('@/lib/audio/provider', () => ({ resolveAudioGenerationAvailability: vi.fn() }))
vi.mock('@/lib/model3d/frameos-3d-provider', () => ({
  FRAMEOS_3D_MODEL_KEY: 'frameos3d::frameos-3d-v1',
  getFrameos3DModelAvailability: vi.fn(),
  normalizeFrameos3DTopology: vi.fn(),
  normalizeFrameos3DPose: vi.fn(),
}))

import { GET } from '@/app/api/frameos/generation-quote/route'
import { POST } from '@/app/api/frameos/toolbox/generate/route'

const model = 'nori::norivideo2.5'
const body = {
  projectId: 'project-1', type: 'video', title: '超分', prompt: '雨夜', modelKey: model,
  inputMode: 'text', textOnly: true, referenceMaterialIds: [],
  options: { duration: 5, resolution: '1080p', superresolveTarget: '720p', generateAudio: true },
}
const request = () => buildMockRequest({
  path: '/api/frameos/toolbox/generate', method: 'POST', body,
})

describe('视频超分 API 契约', () => {
  it('报价与实际生成任务都使用模型支持的 480p，保留 720p 输出目标', async () => {
    const capabilities = getCapabilityOptionFields('video', resolveBuiltinCapabilitiesByModelKey('video', model))
    expect(capabilities.resolution).toContain('480p')
    const quoteResponse = await GET(new NextRequest(`http://localhost/api/frameos/generation-quote?type=video&model=${model}&resolution=1080p&superresolveTarget=720p&duration=5`), { params: Promise.resolve({}) })
    expect(quoteResponse.status).toBe(200)
    expect(await quoteResponse.json()).toMatchObject({
      costCny: calcVideo(model, '480p', 1, { resolution: '480p', duration: 5, generationMode: 'normal', generateAudio: true }),
    })

    const response = await POST(request(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({
      resolution: '480p', superresolveTarget: '720p',
      generationOptions: expect.objectContaining({ resolution: '480p', superresolveTarget: '720p' }),
    }) }))
    expect(capabilityMock).toHaveBeenCalledWith(expect.objectContaining({ runtimeSelections: expect.objectContaining({ resolution: '480p' }) }))
  })

  it('拒绝未知目标，不能创建收费任务', async () => {
    submitTaskMock.mockClear()
    const response = await POST(buildMockRequest({
      path: '/api/frameos/toolbox/generate', method: 'POST',
      body: { ...body, options: { ...body.options, superresolveTarget: '8k' } },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
})
