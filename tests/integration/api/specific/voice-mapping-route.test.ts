import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { VOICE_MAPPING_FRAMEOS_METADATA_KEY } from '@/lib/novel-promotion/voice-mapping-metadata'

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
  globalVoice: {
    findMany: vi.fn(),
  },
  novelPromotionCharacter: {
    update: vi.fn(async () => ({ id: 'character-1' })),
  },
  novelPromotionEpisode: {
    update: vi.fn(async () => ({ id: 'episode-1' })),
  },
}))

const resolveAnalysisModelMock = vi.hoisted(() => vi.fn(async () => 'lumina::gpt-5.5'))
const runVoiceMappingReviewMock = vi.hoisted(() => vi.fn(async () => ({
  promptPayload: {
    characters_json: '{}',
    dialogue_samples_json: '{}',
    voice_library_json: '{}',
  },
  mapping: {
    status: 'draft',
    voice_mapping: [],
    auditions: [],
  },
  plan: {
    updates: [
      {
        characterId: 'character-1',
        characterName: 'Ari',
        source: 'library_match',
        data: {
          voiceId: 'voice-1',
          voiceType: 'qwen-designed',
          customVoiceUrl: null,
          customVoiceMediaId: null,
        },
      },
    ],
    skipped: [],
  },
  text: '{"status":"draft","voice_mapping":[],"auditions":[]}',
  reasoning: 'matched',
})))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: resolveAnalysisModelMock,
}))
vi.mock('@/lib/novel-promotion/voice-mapping-runtime', () => ({
  runVoiceMappingReview: runVoiceMappingReviewMock,
}))

describe('api specific - voice mapping route', () => {
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
          profileData: JSON.stringify({ voice_trait: 'calm and focused' }),
          voiceId: null,
          voiceType: null,
          customVoiceUrl: null,
        },
      ],
      episodes: [
        {
          id: 'episode-1',
          episodeNumber: 1,
          name: 'Episode 1',
          speakerVoices: JSON.stringify({
            _frameosEpisodeMetadata: {
              episode_id: 'episode_001',
              source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
            },
            Existing: {
              provider: 'bailian',
              voiceType: 'qwen-designed',
              voiceId: 'voice-existing',
            },
          }),
          voiceLines: [
            {
              id: 'voice-line-1',
              lineIndex: 1,
              speaker: 'Ari',
              content: 'We can finish this.',
            },
          ],
        },
      ],
    })
    prismaMock.globalVoice.findMany.mockResolvedValue([
      {
        id: 'global-voice-1',
        name: 'Clear Young Adult',
        voiceId: 'voice-1',
        voiceType: 'qwen-designed',
      },
    ])
  })

  it('runs voice mapping with project characters, dialogue samples, and user voice library', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-mapping/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-mapping?locale=en',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
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
        episodes: expect.objectContaining({
          where: { id: 'episode-1' },
        }),
      }),
    }))
    expect(prismaMock.globalVoice.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    })
    expect(resolveAnalysisModelMock).toHaveBeenCalledWith({
      userId: 'user-1',
      inputModel: 'lumina::gpt-5.5',
      projectAnalysisModel: 'lumina::gpt-5.5',
    })
    expect(runVoiceMappingReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'lumina::gpt-5.5',
      locale: 'en',
      input: expect.objectContaining({
        characters: [expect.objectContaining({ id: 'character-1' })],
        episodes: [expect.objectContaining({ id: 'episode-1' })],
        voiceLibrary: [expect.objectContaining({ id: 'global-voice-1' })],
      }),
    }))
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
    expect(body).toEqual(expect.objectContaining({
      success: true,
      applied: false,
      model: 'lumina::gpt-5.5',
      mapping: expect.objectContaining({ status: 'draft' }),
      plan: expect.objectContaining({ updates: expect.any(Array) }),
    }))
  })

  it('applies selected voice updates when requested', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-mapping/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-mapping',
      method: 'POST',
      body: {
        apply: true,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.applied).toBe(true)
    expect(prismaMock.novelPromotionCharacter.update).toHaveBeenCalledWith({
      where: { id: 'character-1' },
      data: {
        voiceId: 'voice-1',
        voiceType: 'qwen-designed',
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
  })

  it('applies speaker voice bindings while preserving private episode metadata', async () => {
    runVoiceMappingReviewMock.mockResolvedValueOnce({
      promptPayload: {
        characters_json: '{}',
        dialogue_samples_json: '{}',
        voice_library_json: '{}',
      },
      mapping: {
        status: 'draft',
        voice_mapping: [
          {
            character: 'Ari',
            character_id: 'character-1',
            voice_source: 'library_match',
            voice_raw_file: '',
            candidates: [
              {
                rank: 1,
                voice_id: 'voice-1',
                voice_name: 'Clear Young Adult',
                is_selected: true,
                reference_audio_id: null,
              },
            ],
          },
        ],
        auditions: [],
      },
      plan: { updates: [], skipped: [] },
      text: '{"status":"draft"}',
      reasoning: 'matched',
    } as never)
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-mapping/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-mapping',
      method: 'POST',
      body: {
        applySpeakerVoices: true,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.speakerVoicesApplied).toBe(true)
    expect(body.mappingMetadataStored).toBe(true)
    expect(body.speakerVoicePlans).toEqual([
      expect.objectContaining({
        episodeId: 'episode-1',
        applied: true,
        metadataStored: true,
        speakerVoices: {
          Ari: {
            provider: 'bailian',
            voiceType: 'qwen-designed',
            voiceId: 'voice-1',
          },
        },
      }),
    ])
    const updateCall = (prismaMock.novelPromotionEpisode.update.mock.calls[0] as unknown) as
      | [{ data?: { speakerVoices?: string } }]
      | undefined
    expect(updateCall).toBeTruthy()
    if (!updateCall) throw new Error('expected episode update')
    const saved = JSON.parse(updateCall[0].data?.speakerVoices || '{}') as Record<string, unknown>
    expect(saved._frameosEpisodeMetadata).toEqual({
      episode_id: 'episode_001',
      source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
    })
    expect(saved.Existing).toEqual({
      provider: 'bailian',
      voiceType: 'qwen-designed',
      voiceId: 'voice-existing',
    })
    expect(saved.Ari).toEqual({
      provider: 'bailian',
      voiceType: 'qwen-designed',
      voiceId: 'voice-1',
    })
    expect(saved[VOICE_MAPPING_FRAMEOS_METADATA_KEY]).toEqual({
      status: 'draft',
      voice_mapping: [
        {
          character: 'Ari',
          character_id: 'character-1',
          voice_source: 'library_match',
          voice_raw_file: '',
          candidates: [
            {
              rank: 1,
              voice_id: 'voice-1',
              voice_name: 'Clear Young Adult',
              is_selected: true,
              reference_audio_id: null,
            },
          ],
        },
      ],
      auditions: [],
      plan: { updates: [], skipped: [] },
      reasoning: 'matched',
    })
  })

  it('stores voice mapping metadata without applying speaker bindings', async () => {
    runVoiceMappingReviewMock.mockResolvedValueOnce({
      promptPayload: {
        characters_json: '{}',
        dialogue_samples_json: '{}',
        voice_library_json: '{}',
      },
      mapping: {
        status: 'draft',
        voice_mapping: [
          {
            character: 'Ari',
            character_id: 'character-1',
            voice_source: 'library_match',
            candidates: [
              {
                rank: 1,
                voice_id: 'voice-1',
                is_selected: true,
              },
            ],
          },
        ],
        auditions: [{ character: 'Ari', status: 'pending' }],
      },
      plan: { updates: [], skipped: [] },
      text: '{"status":"draft"}',
      reasoning: 'matched',
    } as never)
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-mapping/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-mapping',
      method: 'POST',
      body: {
        storeMappingMetadata: true,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.speakerVoicesApplied).toBe(false)
    expect(body.mappingMetadataStored).toBe(true)
    expect(body.speakerVoicePlans).toEqual([
      expect.objectContaining({
        episodeId: 'episode-1',
        applied: false,
        metadataStored: true,
        speakerVoices: {},
        skipped: [],
      }),
    ])
    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledTimes(1)
    const updateCall = (prismaMock.novelPromotionEpisode.update.mock.calls[0] as unknown) as
      | [{ data?: { speakerVoices?: string } }]
      | undefined
    expect(updateCall).toBeTruthy()
    if (!updateCall) throw new Error('expected episode update')
    const saved = JSON.parse(updateCall[0].data?.speakerVoices || '{}') as Record<string, unknown>
    expect(saved._frameosEpisodeMetadata).toEqual({
      episode_id: 'episode_001',
      source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
    })
    expect(saved.Existing).toEqual({
      provider: 'bailian',
      voiceType: 'qwen-designed',
      voiceId: 'voice-existing',
    })
    expect(saved.Ari).toBeUndefined()
    expect(saved[VOICE_MAPPING_FRAMEOS_METADATA_KEY]).toEqual({
      status: 'draft',
      voice_mapping: [
        {
          character: 'Ari',
          character_id: 'character-1',
          voice_source: 'library_match',
          candidates: [
            {
              rank: 1,
              voice_id: 'voice-1',
              is_selected: true,
            },
          ],
        },
      ],
      auditions: [{ character: 'Ari', status: 'pending' }],
      plan: { updates: [], skipped: [] },
      reasoning: 'matched',
    })
  })

  it('returns not found when a requested episode is absent', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'lumina::gpt-5.5',
      characters: [],
      episodes: [],
    })
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-mapping/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-mapping',
      method: 'POST',
      body: {
        episodeId: 'episode-missing',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(runVoiceMappingReviewMock).not.toHaveBeenCalled()
  })
})
