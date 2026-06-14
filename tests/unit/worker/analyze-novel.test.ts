import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { ASSET_FRAMEOS_METADATA_KEY } from '@/lib/novel-promotion/asset-frameos-metadata'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  novelPromotionProject: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionCharacter: {
    create: vi.fn(async () => ({ id: 'char-new-1' })),
    update: vi.fn(async () => ({})),
  },
  novelPromotionLocation: { create: vi.fn(async () => ({ id: 'loc-new-1' })) },
  locationImage: {
    create: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({ count: 1 })),
  },
}))

const llmMock = vi.hoisted(() => ({
  chatCompletion: vi.fn(async () => ({ id: 'completion-1' })),
  getCompletionContent: vi.fn(),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-client', () => llmMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/constants')>()
  return {
    ...actual,
    getArtStylePrompt: vi.fn(() => 'cinematic style'),
    removeLocationPromptSuffix: vi.fn((text: string) => text.replace(' [SUFFIX]', '')),
    removePropPromptSuffix: vi.fn((text: string) => text),
  }
})
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    onStage: vi.fn(),
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    flush: vi.fn(async () => undefined),
  })),
}))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: {
    NP_AGENT_CHARACTER_PROFILE: 'char',
    NP_SELECT_LOCATION: 'loc',
    NP_SELECT_PROP: 'prop',
  },
  buildPrompt: vi.fn(() => 'analysis-prompt'),
}))

import { handleAnalyzeNovelTask } from '@/lib/workers/handlers/analyze-novel'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-analyze-novel-1',
      type: TASK_TYPE.ANALYZE_NOVEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionProject',
      targetId: 'np-project-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker analyze-novel behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.novelPromotionLocation.create
      .mockResolvedValueOnce({ id: 'loc-new-1' })
      .mockResolvedValueOnce({ id: 'prop-new-1' })

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
    })

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '全局设定文本',
      characters: [{ id: 'char-existing', name: '已有角色' }],
      locations: [{ id: 'loc-existing', name: '已有场景', summary: 'old' }],
    })

    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      novelText: '首集内容',
    })

    llmMock.getCompletionContent
      .mockReturnValueOnce(JSON.stringify({
        characters: [
          {
            name: '新角色',
            aliases: ['别名A'],
            role_level: 'main',
            personality_tags: ['冷静'],
            visual_keywords: ['黑发'],
            background: '急诊科医生',
            identity_lock: ['黑框眼镜'],
            coverage_episodes: ['第1集'],
            voice_trait: '低沉克制',
            representative_line: '我来负责',
            voice_audition_prompt: '低沉克制地说：我来负责',
            expected_appearances: [
              { id: 1, change_reason: '初始形象', coverage_episodes: ['第1集'] },
            ],
          },
        ],
      }))
      .mockReturnValueOnce(JSON.stringify({
        status: 'draft',
        extraction_status: 'completed',
        has_deprecated_environments: false,
        environments: [
          {
            environment_id: 'environment_001',
            name: '新地点',
            int_ext: 'EXT',
            summary: '雨夜街道',
            background: 'A rain street for the opening exchange.',
            entrance: 'street corner',
            mood: 'tense',
            base_ambience: 'wet asphalt and neon reflection',
            coverage_scenes: ['scene_1'],
            coverage_episodes: ['episode_1'],
            prompt: 'Wide empty rainy street plate.',
            descriptions: ['雨夜街道 [SUFFIX]'],
            variants: [
              {
                variant_id: 'variant_1',
                label: 'rain default',
                variant_type: 'default',
                prompt: 'Rainy street default background.',
                coverage_scenes: ['scene_1'],
                coverage_episodes: ['episode_1'],
              },
            ],
          },
        ],
      }))
      .mockReturnValueOnce(JSON.stringify({
        status: 'draft',
        extraction_status: 'completed',
        has_deprecated_items: false,
        items: [
          {
            item_id: 'item_001',
            name: '金箍棒',
            item_type: 'weapon',
            summary: '孙悟空随身铁棍法器',
            description: '一根黑铁长棍，两端包裹金色金属箍，表面磨损发亮，杆身笔直厚重',
            background: 'Signature weapon prop.',
            significance: 'recurring combat prop',
            coverage_scenes: ['scene_1'],
            coverage_episodes: ['episode_1'],
            prompt: 'Standalone black iron staff with gold hoops.',
            variants: [
              {
                variant_id: 'variant_1',
                label: 'default',
                variant_type: 'default',
                prompt: 'Default staff prop.',
                coverage_scenes: ['scene_1'],
                coverage_episodes: ['episode_1'],
              },
            ],
          },
        ],
      }))
  })

  it('no global text and no episode text -> explicit error', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '',
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ novelText: '' })

    await expect(handleAnalyzeNovelTask(buildJob())).rejects.toThrow('请先填写全局资产设定或剧本内容')
  })

  it('success path -> creates character/location and persists cleaned location descriptions', async () => {
    const result = await handleAnalyzeNovelTask(buildJob())

    expect(result).toEqual({
      success: true,
      characters: [{ id: 'char-new-1' }],
      locations: [{ id: 'loc-new-1' }],
      props: [{ id: 'prop-new-1' }],
      characterCount: 1,
      locationCount: 1,
      propCount: 1,
    })

    expect(prismaMock.novelPromotionCharacter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: '新角色',
          aliases: JSON.stringify(['别名A']),
          profileData: expect.stringContaining('"voice_trait":"低沉克制"'),
        }),
      }),
    )
    expect(prismaMock.novelPromotionCharacter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profileData: expect.stringContaining('"coverage_episodes":["第1集"]'),
        }),
      }),
    )
    expect(prismaMock.novelPromotionCharacter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profileData: expect.stringContaining('"expected_appearances":[{"id":1,"change_reason":"初始形象","coverage_episodes":["第1集"]}]'),
        }),
      }),
    )

    expect(prismaMock.novelPromotionLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: '新地点',
          summary: '雨夜街道',
        }),
      }),
    )

    expect(prismaMock.locationImage.create).not.toHaveBeenCalled()
    const createManyCalls = prismaMock.locationImage.createMany.mock.calls as unknown as Array<[{
      data: Array<{ availableSlots: string }>
    }]>
    const locationCreateManyCall = createManyCalls[0]?.[0]
    if (!locationCreateManyCall) throw new Error('expected location createMany call')
    const locationAvailableSlots = JSON.parse(locationCreateManyCall.data[0].availableSlots) as Record<string, unknown>
    expect(locationAvailableSlots[ASSET_FRAMEOS_METADATA_KEY]).toEqual(expect.objectContaining({
      asset_kind: 'environment',
      environment_id: 'environment_001',
      int_ext: 'EXT',
      background: 'A rain street for the opening exchange.',
      entrance: 'street corner',
      mood: 'tense',
      base_ambience: 'wet asphalt and neon reflection',
      coverage_scenes: ['scene_1'],
      coverage_episodes: ['episode_1'],
      prompt: 'Wide empty rainy street plate.',
      variants: [expect.objectContaining({ variant_id: 'variant_1' })],
    }))
    expect(prismaMock.locationImage.createMany).toHaveBeenNthCalledWith(1, {
      data: [
        {
          locationId: 'loc-new-1',
          imageIndex: 0,
          description: '雨夜街道',
          availableSlots: expect.any(String),
        },
      ],
    })
    const propCreateManyCall = createManyCalls[1]?.[0]
    if (!propCreateManyCall) throw new Error('expected prop createMany call')
    const propAvailableSlots = JSON.parse(propCreateManyCall.data[0].availableSlots) as Record<string, unknown>
    expect(propAvailableSlots[ASSET_FRAMEOS_METADATA_KEY]).toEqual(expect.objectContaining({
      asset_kind: 'item',
      item_id: 'item_001',
      item_type: 'weapon',
      background: 'Signature weapon prop.',
      significance: 'recurring combat prop',
      coverage_scenes: ['scene_1'],
      coverage_episodes: ['episode_1'],
      prompt: 'Standalone black iron staff with gold hoops.',
      variants: [expect.objectContaining({ variant_id: 'variant_1' })],
    }))
    expect(prismaMock.locationImage.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        {
          locationId: 'prop-new-1',
          imageIndex: 0,
          description: '一根黑铁长棍，两端包裹金色金属箍，表面磨损发亮，杆身笔直厚重',
          availableSlots: expect.any(String),
        },
      ],
    })

    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'np-project-1' },
      data: { artStylePrompt: 'cinematic style' },
    })

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      60,
      expect.objectContaining({
        stepId: 'analyze_characters',
        done: true,
        output: expect.stringContaining('"characters"'),
      }),
    )

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      70,
      expect.objectContaining({
        stepId: 'analyze_locations',
        done: true,
        output: expect.stringContaining('"environments"'),
      }),
    )
  })

  it('applies FrameOS voice_mapping output to character voice fields', async () => {
    llmMock.getCompletionContent
      .mockReset()
      .mockReturnValueOnce(JSON.stringify({
        characters: [
          {
            name: 'Ari',
            aliases: ['A'],
            role_level: 'S',
            personality_tags: ['focused'],
            visual_keywords: ['navy jacket'],
            voice_trait: 'calm and quick',
            voice_id: '',
            voice_raw_file: '',
          },
          {
            name: 'Nia',
            aliases: [],
            role_level: 'B',
            personality_tags: ['steady'],
            visual_keywords: ['gray coat'],
            voice_trait: 'low and direct',
            voice_id: '',
            voice_raw_file: '',
          },
        ],
        voice_mapping: [
          {
            character: 'Ari',
            character_id: 'character_1',
            voice_source: 'library_match',
            voice_raw_file: '',
            candidates: [
              {
                rank: 1,
                voice_id: 'voice-ari',
                voice_name: 'Clear Young Adult',
                reason: 'Matches calm focused delivery.',
                is_selected: true,
                reference_audio_id: null,
              },
            ],
          },
          {
            character: 'Nia',
            character_id: 'character_3',
            voice_source: 'custom_upload',
            voice_raw_file: 'uploaded_voice_nia_1',
            candidates: [],
          },
        ],
      }))
      .mockReturnValueOnce(JSON.stringify({ environments: [] }))
      .mockReturnValueOnce(JSON.stringify({ items: [] }))

    prismaMock.novelPromotionCharacter.create
      .mockResolvedValueOnce({ id: 'char-ari' })
      .mockResolvedValueOnce({ id: 'char-nia' })

    await handleAnalyzeNovelTask(buildJob())

    expect(prismaMock.novelPromotionCharacter.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'char-ari' },
      data: {
        voiceId: 'voice-ari',
        voiceType: 'qwen-designed',
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
    expect(prismaMock.novelPromotionCharacter.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'char-nia' },
      data: {
        voiceId: null,
        voiceType: 'uploaded',
        customVoiceUrl: 'uploaded_voice_nia_1',
        customVoiceMediaId: null,
      },
    })
  })
})
