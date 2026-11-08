import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const defaultsMock = vi.hoisted(() => vi.fn())
const configMock = vi.hoisted(() => vi.fn())
const audioAvailabilityMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireUserAuth: async () => ({ session: { user: { id: 'user-1' } } }),
  requireProjectAuthLight: async () => ({ session: { user: { id: 'user-1' } } }),
}))
vi.mock('@/lib/config-service', () => ({
  getUserModelConfig: defaultsMock,
  getProjectModelConfig: defaultsMock,
}))
vi.mock('@/lib/platform-services/config', () => ({ getPlatformServiceConfigResponse: configMock }))
vi.mock('@/lib/platform-services/health', () => ({ getLatestServiceHealth: async () => [] }))
vi.mock('@/lib/audio/provider', () => ({ resolveAudioGenerationAvailability: audioAvailabilityMock }))
vi.mock('@/lib/model3d/frameos-3d-provider', () => ({
  getFrameos3DModelAvailability: () => ({ modelKey: 'nori::model3d', name: 'model3d', available: false }),
}))

const storage = { type: 'tos', endpoint: '', publicEndpoint: '', region: '', bucket: '', forcePathStyle: false, hasAccessKey: false, hasSecretKey: false }

describe('/api/frameos/generation-config real model names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('KUAIZI_API_KEY', 'test-key')
    vi.stubEnv('OPENLUX_API_KEY', 'test-key')
    configMock.mockReturnValue({
      sourceFile: 'fixture.json',
      updatedAt: null,
      providers: [{ id: 'kuaizi', name: 'provider', hasApiKey: true }, { id: 'openlux', name: 'provider', hasApiKey: true }],
      models: [],
      defaultModels: {},
      businessModels: [],
      modelRouting: {
        'nori::norivideo2.5': 'kuaizi::doubao-seedance-2-5-260628',
        'nori::nori-image-pro': 'openlux::gpt-image-2.5-sunburst',
      },
      storage,
    })
    defaultsMock.mockResolvedValue({
      analysisModel: null,
      characterModel: 'nori::nori-image-pro',
      locationModel: null,
      editModel: null,
      storyboardModel: null,
      videoModel: 'nori::norivideo2.5',
      audioModel: null,
      videoRatio: '16:9',
      videoResolution: '720p',
    })
    audioAvailabilityMock.mockResolvedValue({ modes: ['tts'], available: false, unavailableReason: 'not under test', runtimeModelKey: null })
  })

  it('keeps historical saved keys while displaying their actual routed model ids', async () => {
    const { GET } = await import('@/app/api/frameos/generation-config/route')
    const response = await GET(buildMockRequest({ path: '/api/frameos/generation-config', method: 'GET' }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const body = await response.json() as { videoModels: Array<Record<string, unknown>>; imageModels: Array<Record<string, unknown>> }
    expect(body.videoModels).toHaveLength(1)
    expect(body.videoModels[0]).toMatchObject({
      modelKey: 'nori::norivideo2.5',
      name: 'doubao-seedance-2-5-260628',
      runtimeModelKey: 'kuaizi::doubao-seedance-2-5-260628',
    })
    expect(body.imageModels[0]).toMatchObject({
      modelKey: 'nori::nori-image-pro',
      name: 'gpt-image-2.5-sunburst',
      runtimeModelKey: 'openlux::gpt-image-2.5-sunburst',
    })
    for (const model of [...body.videoModels, ...body.imageModels]) {
      expect(model).not.toHaveProperty('provider')
      expect(model).not.toHaveProperty('tier')
      expect(model.name).not.toMatch(/LanMiaoTV|nori-image-pro|kuaizi|openlux| · (?:Mini|Fast|标准|Pro)/i)
    }
  })
})
