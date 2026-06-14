import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(async () => ({ id: 'project-1' })),
  },
  novelPromotionProject: {
    findFirst: vi.fn(async () => ({ id: 'np-project-1' })),
  },
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: JSON.stringify({
    episodes: [
      {
        number: 1,
        title: '第一集',
        summary: '开端',
        startMarker: 'START_MARKER',
        endMarker: 'END_MARKER',
      },
    ],
  }) })),
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'llm::analysis-model',
  })),
}))

const internalStreamMock = vi.hoisted(() => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => {}),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
}))

const llmStreamMock = vi.hoisted(() => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamId: 'stream-1' })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    flush: vi.fn(async () => {}),
  })),
}))

const promptMock = vi.hoisted(() => ({
  PROMPT_IDS: { NP_EPISODE_SPLIT: 'np_episode_split' },
  buildPrompt: vi.fn(() => 'EPISODE_SPLIT_PROMPT'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => internalStreamMock)
vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/handlers/llm-stream', () => llmStreamMock)
vi.mock('@/lib/prompt-i18n', () => promptMock)
vi.mock('@/lib/novel-promotion/story-to-script/clip-matching', () => ({
  createTextMarkerMatcher: (content: string) => ({
    matchMarker: (marker: string, fromIndex = 0) => {
      const startIndex = content.indexOf(marker, fromIndex)
      if (startIndex === -1) return null
      return {
        startIndex,
        endIndex: startIndex + marker.length,
      }
    },
  }),
}))

import { handleEpisodeSplitTask } from '@/lib/workers/handlers/episode-split'

function buildJob(content: string): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-episode-split-1',
      type: TASK_TYPE.EPISODE_SPLIT_LLM,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'NovelPromotionProject',
      targetId: 'project-1',
      payload: { content },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker episode-split', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails fast when content is too short', async () => {
    const job = buildJob('short text')
    await expect(handleEpisodeSplitTask(job)).rejects.toThrow('文本太短，至少需要 100 字')
  })

  it('returns matched episodes when ai boundaries are valid', async () => {
    const content = [
      '前置内容用于凑长度，确保文本超过一百字。这一段会重复两次以保证长度满足阈值。',
      '前置内容用于凑长度，确保文本超过一百字。这一段会重复两次以保证长度满足阈值。',
      'START_MARKER',
      '这里是第一集的正文内容，包含角色冲突与场景推进，长度足够用于单元测试验证。',
      'END_MARKER',
      '后置内容用于确保边界外还有文本，并继续补足长度。',
    ].join('')

    const job = buildJob(content)
    const result = await handleEpisodeSplitTask(job)

    expect(result.success).toBe(true)
    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0]?.number).toBe(1)
    expect(result.episodes[0]?.title).toBe('第一集')
    expect(result.episodes[0]?.content).toContain('START_MARKER')
    expect(result.episodes[0]?.content).toContain('END_MARKER')
  })

  it('accepts FrameOS items payload when episodes alias is absent', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({ text: JSON.stringify({
      status: 'draft',
      steps: [{ step: 1, name: 'episode_split', status: 'done', time: '' }],
      default_visual_style: null,
      script_kilo: 0.2,
      adapted_kilo: 0.2,
      items: [
        {
          number: 1,
          episode_id: 'episode_001',
          episode_number: 1,
          title: '第一集',
          summary: '开端',
          content: 'START_MARKER 这里是第一集的正文内容 END_MARKER',
          estimatedWords: 200,
          content_kilo: 0.2,
          startMarker: 'START_MARKER',
          endMarker: 'END_MARKER',
          source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
          info_points: 'Ari enters the workshop; Mika gives Ari the brass key.',
          reasoning: { diagnosis: 'one episode', key_decisions: ['keep together'] },
          status: 'draft',
          scenes: [],
        },
      ],
      analysis: { totalWords: 200, episodeCount: 1 },
      validation: { maxWords: 200, minWords: 200, variance: 0, isBalanced: true },
    }) })
    const content = [
      '前置内容用于凑长度，确保文本超过一百字。这一段会重复两次以保证长度满足阈值。',
      '前置内容用于凑长度，确保文本超过一百字。这一段会重复两次以保证长度满足阈值。',
      'START_MARKER',
      '这里是第一集的正文内容，包含角色冲突与场景推进，长度足够用于单元测试验证。',
      'END_MARKER',
      '后置内容用于确保边界外还有文本，并继续补足长度。',
    ].join('')

    const job = buildJob(content)
    const result = await handleEpisodeSplitTask(job)

    expect(result.success).toBe(true)
    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0]?.title).toBe('第一集')
    expect(result.episodes[0]?.content).toContain('START_MARKER')
    expect(result.episodes[0]?.content).toContain('END_MARKER')
    expect(result.episodes[0]?.frameosMetadata).toEqual({
      episode_id: 'episode_001',
      episode_number: 1,
      status: 'draft',
      content_kilo: 0.2,
      estimatedWords: 200,
      source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
      info_points: 'Ari enters the workshop; Mika gives Ari the brass key.',
      reasoning: { diagnosis: 'one episode', key_decisions: ['keep together'] },
      scenes: [],
      analysis: { totalWords: 200, episodeCount: 1 },
      validation: { maxWords: 200, minWords: 200, variance: 0, isBalanced: true },
    })
  })
})
