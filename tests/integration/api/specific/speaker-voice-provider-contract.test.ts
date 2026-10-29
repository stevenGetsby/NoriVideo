import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({ session: { user: { id: 'user-1' } } })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))
const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn(async () => ({ id: 'np-1' })) },
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({ id: 'episode-1', speakerVoices: '{}' })),
    update: vi.fn(),
  },
}))
const resolveStorageKeyMock = vi.hoisted(() => vi.fn(async () => 'voice/reference.wav'))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/service', () => ({ resolveStorageKeyFromMediaValue: resolveStorageKeyMock }))
vi.mock('@/lib/storage', () => ({ getSignedUrl: (key: string) => `signed://${key}` }))

describe('speaker voice Kuaizi provider contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['fal', 'bailian'])('rejects new %s bindings', async (provider) => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const res = await mod.PATCH(buildMockRequest({
      path: '/api/novel-promotion/project-1/speaker-voice', method: 'PATCH',
      body: { episodeId: 'episode-1', speaker: 'Narrator', provider, voiceId: 'legacy', audioUrl: '/m/reference' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(400)
    expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalled()
  })

  it('stores explicit Kuaizi reference audio and preserves private metadata', async () => {
    const metadata = { episode_id: 'episode_001' }
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: 'episode-1', speakerVoices: JSON.stringify({ _frameosEpisodeMetadata: metadata }),
    })
    const mod = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const res = await mod.PATCH(buildMockRequest({
      path: '/api/novel-promotion/project-1/speaker-voice', method: 'PATCH',
      body: { episodeId: 'episode-1', speaker: 'Narrator', provider: 'kuaizi', voiceType: 'uploaded', audioUrl: '/m/reference' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    const args = prismaMock.novelPromotionEpisode.update.mock.calls[0][0]
    expect(JSON.parse(args.data.speakerVoices)).toEqual({
      _frameosEpisodeMetadata: metadata,
      Narrator: { provider: 'kuaizi', voiceType: 'uploaded', audioUrl: 'voice/reference.wav', previewAudioUrl: 'voice/reference.wav' },
    })
  })

  it('does not convert a Kuaizi entry into Bailian when reading', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: 'episode-1', speakerVoices: JSON.stringify({ Narrator: { provider: 'kuaizi', voiceId: 'kz-voice', previewAudioUrl: 'voice/preview.wav' } }),
    })
    const mod = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const res = await mod.GET(buildMockRequest({ path: '/api/novel-promotion/project-1/speaker-voice?episodeId=episode-1', method: 'GET' }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()
    expect(body.speakerVoices.Narrator).toEqual({
      provider: 'kuaizi', voiceType: 'uploaded', voiceId: 'kz-voice', previewAudioUrl: 'signed://voice/preview.wav',
    })
  })
})
