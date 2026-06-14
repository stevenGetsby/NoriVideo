import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  userPreference: {
    findUnique: vi.fn(async () => null),
  },
}))

const resolveAnalysisModelMock = vi.hoisted(() => vi.fn(async () => 'lumina::gpt-5.5'))
const runExportPreflightReviewMock = vi.hoisted(() => vi.fn(async () => ({
  promptPayload: {
    export_target: 'Episode delivery package',
    episodes_json: '{}',
    assets_json: '{}',
    storyboard_json: '{}',
    voice_json: '{}',
  },
  review: {
    status: 'needs_work',
    issues: [],
  },
  text: '{"status":"needs_work","issues":[]}',
  reasoning: 'checked',
})))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: resolveAnalysisModelMock,
}))
vi.mock('@/lib/novel-promotion/export-preflight-review', () => ({
  runExportPreflightReview: runExportPreflightReviewMock,
}))

describe('api specific - export preflight review route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'lumina::gpt-5.5',
      characters: [
        {
          id: 'character-1',
          name: 'Ari',
          aliases: JSON.stringify(['A']),
          profileData: JSON.stringify({ role_type: 'protagonist' }),
          voiceId: 'voice-ari',
          voiceType: 'qwen-designed',
          customVoiceUrl: null,
        },
      ],
      locations: [
        {
          id: 'location-1',
          name: 'Workshop',
          assetKind: 'location',
          images: [{ id: 'location-image-1', imageIndex: 0, imageUrl: 'cos://location' }],
        },
      ],
      episodes: [
        {
          id: 'episode-1',
          episodeNumber: 1,
          name: 'Episode 1',
          description: 'Opening beat',
          novelText: 'source exists',
          speakerVoices: '{}',
          storyboards: [
            {
              id: 'storyboard-1',
              clipId: 'clip-1',
              clip: { id: 'clip-1', summary: 'Workshop opening.' },
              panels: [{ id: 'panel-1', panelIndex: 0, imagePrompt: 'image prompt' }],
            },
          ],
          voiceLines: [{ id: 'voice-line-1', lineIndex: 1, speaker: 'Ari', content: 'Line.' }],
        },
      ],
    })
  })

  it('collects project snapshot, resolves analysis model, and returns LLM review JSON', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/export-preflight-review/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/export-preflight-review?locale=en',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        exportTarget: 'Episode delivery package',
        model: 'lumina::gpt-5.5',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(prismaMock.novelPromotionProject.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1' },
      include: expect.objectContaining({
        characters: true,
        locations: expect.any(Object),
        episodes: expect.objectContaining({
          where: { id: 'episode-1' },
        }),
      }),
    }))
    expect(resolveAnalysisModelMock).toHaveBeenCalledWith({
      userId: 'user-1',
      inputModel: 'lumina::gpt-5.5',
      projectAnalysisModel: 'lumina::gpt-5.5',
    })
    expect(runExportPreflightReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'lumina::gpt-5.5',
      locale: 'en',
      input: expect.objectContaining({
        exportTarget: 'Episode delivery package',
        episodes: [expect.objectContaining({ id: 'episode-1' })],
        characters: [expect.objectContaining({ id: 'character-1' })],
        locations: [expect.objectContaining({ id: 'location-1' })],
      }),
    }))
    expect(body).toEqual({
      success: true,
      model: 'lumina::gpt-5.5',
      review: { status: 'needs_work', issues: [] },
      promptPayload: {
        export_target: 'Episode delivery package',
        episodes_json: '{}',
        assets_json: '{}',
        storyboard_json: '{}',
        voice_json: '{}',
      },
      reasoning: 'checked',
    })
  })

  it('returns not found when a requested episode is absent from the project snapshot', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'lumina::gpt-5.5',
      characters: [],
      locations: [],
      episodes: [],
    })
    const mod = await import('@/app/api/novel-promotion/[projectId]/export-preflight-review/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/export-preflight-review',
      method: 'POST',
      body: {
        episodeId: 'episode-missing',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(runExportPreflightReviewMock).not.toHaveBeenCalled()
  })
})

