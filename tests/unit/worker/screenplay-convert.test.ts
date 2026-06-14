import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionEpisode: { findUnique: vi.fn() },
  novelPromotionClip: { update: vi.fn(async () => ({})) },
}))

const llmMock = vi.hoisted(() => ({
  chatCompletion: vi.fn(async () => ({ id: 'completion-1' })),
  getCompletionContent: vi.fn(() => '{"scenes":[{"index":1}]}'),
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: '{"scenes":[{"index":1}]}' })),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const helpersMock = vi.hoisted(() => ({
  parseScreenplayPayload: vi.fn(() => ({
    status: 'draft',
    steps: ['script_parse', 'scene_split'],
    script_kilo: 1,
    strategy_thinking: '忠实转换并保留场景边界',
    style_reasoning: '根据夜景和动作选择冷色短剧质感',
    default_visual_style: {
      name: '冷色短剧',
      description: '低饱和夜景与清晰人物调度',
    },
    worlds: [
      {
        world_label: '现代城市',
        world_background: '普通现代空间',
        representative_frame: 'START one',
        candidates: ['冷色短剧'],
        selected_style_anchor: '冷色短剧',
        preview_materials: [],
      },
    ],
    scenes: [{ index: 1 }],
  })),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(({ variables }: { variables: Record<string, string> }) => [
    'screenplay-template',
    `clip:${variables.clip_content}`,
    `id:${variables.clip_id}`,
    `locations:${variables.locations_lib_name}`,
    `characters:${variables.characters_lib_name}`,
    `props:${variables.props_lib_name}`,
    `intro:${variables.characters_introduction}`,
  ].join('\n')),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-client', () => llmMock)
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/constants', () => ({
  buildCharactersIntroduction: vi.fn(() => 'characters introduction'),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/logging/semantic', () => ({ logAIAnalysis: vi.fn() }))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: vi.fn() }))
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
vi.mock('@/lib/workers/handlers/screenplay-convert-helpers', () => ({
  readText: (value: unknown) => (typeof value === 'string' ? value : ''),
  parseScreenplayPayload: helpersMock.parseScreenplayPayload,
}))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_SCREENPLAY_CONVERSION: 'np_screenplay_conversion' },
  buildPrompt: promptMock.buildPrompt,
}))

import { handleScreenplayConvertTask } from '@/lib/workers/handlers/screenplay-convert'

function buildJob(payload: Record<string, unknown>, episodeId: string | null = 'episode-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-screenplay-1',
      type: TASK_TYPE.SCREENPLAY_CONVERT,
      locale: 'zh',
      projectId: 'project-1',
      episodeId,
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker screenplay-convert behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
    })

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      characters: [{ name: 'Hero' }],
      locations: [
        { name: 'Old Town', assetKind: 'location' },
        { name: 'Magic Watch', assetKind: 'prop' },
      ],
    })

    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'np-project-1',
      clips: [
        {
          id: 'clip-1',
          startText: 'START one',
          endText: 'END',
          summary: 'first clip',
          content: 'clip 1 content',
        },
      ],
    })
  })

  it('missing episodeId -> explicit error', async () => {
    const job = buildJob({}, null)
    await expect(handleScreenplayConvertTask(job)).rejects.toThrow('episodeId is required')
  })

  it('success path -> writes screenplay json to clip row', async () => {
    const job = buildJob({ episodeId: 'episode-1' })
    const result = await handleScreenplayConvertTask(job)

    expect(result).toEqual(expect.objectContaining({
      episodeId: 'episode-1',
      total: 1,
      successCount: 1,
      failCount: 0,
      totalScenes: 1,
    }))

    expect(prismaMock.novelPromotionClip.update).toHaveBeenCalledWith({
      where: { id: 'clip-1' },
      data: {
        screenplay: JSON.stringify({
          status: 'draft',
          steps: ['script_parse', 'scene_split'],
          script_kilo: 1,
          strategy_thinking: '忠实转换并保留场景边界',
          style_reasoning: '根据夜景和动作选择冷色短剧质感',
          default_visual_style: {
            name: '冷色短剧',
            description: '低饱和夜景与清晰人物调度',
          },
          worlds: [
            {
              world_label: '现代城市',
              world_background: '普通现代空间',
              representative_frame: 'START one',
              candidates: ['冷色短剧'],
              selected_style_anchor: '冷色短剧',
              preview_materials: [],
            },
          ],
          scenes: [{ index: 1 }],
          clip_id: 'clip-1',
          original_text: 'clip 1 content',
          art_direction: {
            flow_status: 'draft',
            flow_id: 'clip-1',
            current_label: '冷色短剧',
            derived_phase: 'screenplay_conversion',
            default_world_label: '现代城市',
            worlds: [
              {
                world_label: '现代城市',
                world_background: '普通现代空间',
                representative_frame: 'START one',
                candidates: ['冷色短剧'],
                selected_style_anchor: '冷色短剧',
                preview_materials: [],
              },
            ],
          },
          source_anchor: { start: 'START one', end: 'END' },
          info_points: ['first clip'],
        }),
      },
    })

    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        locations_lib_name: 'Old Town',
        props_lib_name: 'Magic Watch',
      }),
    }))
    const aiRuntimeCalls = (aiRuntimeMock.executeAiTextStep as unknown as {
      mock: { calls: Array<[unknown]> }
    }).mock.calls
    const aiInput = aiRuntimeCalls[0]?.[0] as {
      messages: Array<{ content: string }>
    }
    expect(aiInput.messages[0].content).toContain('locations:Old Town')
    expect(aiInput.messages[0].content).toContain('props:Magic Watch')
  })

  it('clip parse failed -> throws partial failure error with code prefix', async () => {
    helpersMock.parseScreenplayPayload.mockImplementation(() => {
      throw new Error('invalid screenplay payload')
    })

    const job = buildJob({ episodeId: 'episode-1' })
    await expect(handleScreenplayConvertTask(job)).rejects.toThrow('SCREENPLAY_CONVERT_PARTIAL_FAILED')
  })
})
