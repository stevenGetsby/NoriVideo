import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
  },
}))

const llmMock = vi.hoisted(() => ({
  chatCompletionWithVision: vi.fn(),
  getCompletionContent: vi.fn(),
}))

const cosMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
}))

const streamCtxMock = vi.hoisted(() => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const llmStreamMock = vi.hoisted(() => {
  const flush = vi.fn(async () => undefined)
  return {
    flush,
    createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
    createWorkerLLMStreamCallbacks: vi.fn(() => ({
      onStage: vi.fn(),
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
      flush,
    })),
  }
})

const persistMock = vi.hoisted(() => ({
  resolveAnalysisModel: vi.fn(),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'shot-variants-prompt'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-client', () => llmMock)
vi.mock('@/lib/storage', () => cosMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => streamCtxMock)
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: workerMock.reportTaskProgress,
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: workerMock.assertTaskActive,
}))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: llmStreamMock.createWorkerLLMStreamContext,
  createWorkerLLMStreamCallbacks: llmStreamMock.createWorkerLLMStreamCallbacks,
}))
vi.mock('@/lib/workers/handlers/shot-ai-persist', () => persistMock)
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_AGENT_SHOT_VARIANT_ANALYSIS: 'np_agent_shot_variant_analysis' },
  buildPrompt: promptMock.buildPrompt,
}))

import { handleAnalyzeShotVariantsTask } from '@/lib/workers/handlers/shot-ai-variants'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-shot-variants-1',
      type: TASK_TYPE.ANALYZE_SHOT_VARIANTS,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker shot-ai-variants behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistMock.resolveAnalysisModel.mockResolvedValue({ id: 'np-1', analysisModel: 'llm::analysis-1' })
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      panelNumber: 3,
      imageUrl: 'images/panel-1.png',
      description: 'panel desc',
      shotType: 'medium',
      cameraMove: 'static',
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'black coat' }]),
      props: JSON.stringify(['brass_key']),
      srtSegment: 'Hero opens the old town gate.',
      imagePrompt: 'Hero at the old town gate.',
      videoPrompt: 'Hero opens the old town gate while the camera holds steady.',
      sceneType: 'transition',
      duration: 4,
      photographyRules: 'Keep Hero at the gate entrance with the key visible.',
      actingNotes: JSON.stringify({
        characters: [{ name: 'Hero', acting: 'clear speaking face' }],
        _frameosPanelMetadata: {
          panel_id: 'frameos-panel-3',
          panel_number: 33,
          source_text: 'Hero studies the gate before turning the brass key.',
          source_anchor: {
            episode_id: 'episode-demo',
            start: 'Hero studies the gate.',
            end: 'turning the brass key.',
          },
          referenced_assets: {
            characters: [{ name: 'Hero', appearance: 'black coat' }],
            location: 'Old Town gate',
            props: ['brass_key'],
          },
          visual_prompt: 'FrameOS visual prompt: Hero framed beside the Old Town gate.',
          visual_style: 'grounded suspense',
          visual_style_description: 'cool daylight with restrained contrast',
          continuity_notes: 'FrameOS continuity: keep the brass key in Hero right hand.',
          voice_refs: [{ speaker: 'Hero', source_text: 'We open it now.' }],
        },
      }),
    })
    cosMock.getSignedUrl.mockReturnValue('https://signed.example/panel-1.png')
    llmMock.chatCompletionWithVision.mockResolvedValue({ id: 'vision-1' })
    llmMock.getCompletionContent.mockReturnValue('[{"name":"v1"},{"name":"v2"},{"name":"v3"}]')
  })

  it('panel not found -> explicit error', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(null)
    const job = buildJob({ panelId: 'panel-404' })

    await expect(handleAnalyzeShotVariantsTask(job, job.data.payload as Record<string, unknown>)).rejects.toThrow('Panel not found')
  })

  it('success -> returns suggestions and signed panel image', async () => {
    const payload = { panelId: 'panel-1' }
    const job = buildJob(payload)

    const result = await handleAnalyzeShotVariantsTask(job, payload)

    expect(llmMock.chatCompletionWithVision).toHaveBeenCalledWith(
      'user-1',
      'llm::analysis-1',
      'shot-variants-prompt',
      ['https://signed.example/panel-1.png'],
      expect.objectContaining({
        projectId: 'project-1',
        action: 'analyze_shot_variants',
      }),
    )

    expect(result).toEqual(expect.objectContaining({
      success: true,
      suggestions: [{ name: 'v1' }, { name: 'v2' }, { name: 'v3' }],
      panelInfo: expect.objectContaining({
        panelNumber: 3,
        imageUrl: 'https://signed.example/panel-1.png',
      }),
    }))
    expect(llmStreamMock.flush).toHaveBeenCalled()
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      promptId: 'np_agent_shot_variant_analysis',
      variables: expect.objectContaining({
        panel_context_json: expect.stringContaining('"source_text": "Hero studies the gate before turning the brass key."'),
      }),
    }))
    const promptCalls = promptMock.buildPrompt.mock.calls as unknown[][]
    const promptCall = promptCalls.at(-1)?.[0] as { variables?: Record<string, string> } | undefined
    expect(promptCall?.variables?.panel_context_json).toContain('"panel_id": "frameos-panel-3"')
    expect(promptCall?.variables?.panel_context_json).toContain('"panel_number": 33')
    expect(promptCall?.variables?.panel_context_json).toContain('"episode_id": "episode-demo"')
    expect(promptCall?.variables?.panel_context_json).toContain('"referenced_assets"')
    expect(promptCall?.variables?.panel_context_json).toContain('"characters": [')
    expect(promptCall?.variables?.panel_context_json).toContain('"appearance": "black coat"')
    expect(promptCall?.variables?.panel_context_json).toContain('"props": [')
    expect(promptCall?.variables?.panel_context_json).toContain('"brass_key"')
    expect(promptCall?.variables?.panel_context_json).toContain('"visual_prompt": "FrameOS visual prompt: Hero framed beside the Old Town gate."')
    expect(promptCall?.variables?.panel_context_json).toContain('"visual_style": "grounded suspense"')
    expect(promptCall?.variables?.panel_context_json).toContain('"visual_style_description": "cool daylight with restrained contrast"')
    expect(promptCall?.variables?.panel_context_json).toContain('FrameOS continuity: keep the brass key in Hero right hand.')
    expect(promptCall?.variables?.panel_context_json).toContain('Keep Hero at the gate entrance with the key visible.')
    expect(promptCall?.variables?.panel_context_json).toContain('"voice_refs"')
    expect(promptCall?.variables?.panel_context_json).toContain('"speaker": "Hero"')
  })

  it('suggestions fewer than 3 -> explicit error', async () => {
    llmMock.getCompletionContent.mockReturnValueOnce('[{"name":"only-one"}]')
    const payload = { panelId: 'panel-1' }
    const job = buildJob(payload)

    await expect(handleAnalyzeShotVariantsTask(job, payload)).rejects.toThrow('生成的变体数量不足')
  })
})
