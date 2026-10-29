import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_PROMPT_SUFFIX, CHARACTER_IMAGE_BANANA_RATIO } from '@/lib/constants'
import { TASK_TYPE, type TaskJobData, type TaskType } from '@/lib/task/types'

const sharpMock = vi.hoisted(() =>
  vi.fn(() => {
    const chain = {
      metadata: vi.fn(async () => ({ width: 2160, height: 2160 })),
      extend: vi.fn(() => chain),
      composite: vi.fn(() => chain),
      jpeg: vi.fn(() => chain),
      toBuffer: vi.fn(async () => Buffer.from('processed-image')),
    }
    return chain
  }),
)

const fetchWithRetryMock = vi.hoisted(() => ({
  fetchWithTimeoutAndRetry: vi.fn(async () => ({
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  })),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'character-model-1',
    analysisModel: 'analysis-model-1',
  })),
}))

const llmClientMock = vi.hoisted(() => ({
  getCompletionContent: vi.fn(() => 'AI_EXTRACTED_DESCRIPTION'),
}))
const aiRuntimeMock = vi.hoisted(() => ({
  executeAiVisionStep: vi.fn(async () => ({
    text: 'AI_EXTRACTED_DESCRIPTION', reasoning: '',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  })),
}))

const cosMock = vi.hoisted(() => {
  let keyIndex = 0
  return {
    generateUniqueKey: vi.fn(() => `reference-key-${++keyIndex}.jpg`),
    getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
    uploadObject: vi.fn(async (_buffer: Buffer, key: string) => `cos/${key}`),
  }
})

const fontsMock = vi.hoisted(() => ({
  initializeFonts: vi.fn(async () => {}),
  createLabelSVG: vi.fn(async () => Buffer.from('<svg />')),
}))

const workersSharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => {}),
}))

const workersUtilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
  resolveImageSourceFromGeneration: vi.fn<(_job: unknown, params: { prompt: string; options?: Record<string, unknown> }) => Promise<string>>(
    async () => 'https://example.com/generated.jpg',
  ),
}))

const promptI18nMock = vi.hoisted(() => ({
  PROMPT_IDS: {
    CHARACTER_IMAGE_TO_DESCRIPTION: 'character_image_to_description',
    CHARACTER_REFERENCE_TO_SHEET: 'character_reference_to_sheet',
  },
  buildPrompt: vi.fn((input: { promptId: string }) => (
    input.promptId === 'character_reference_to_sheet'
      ? 'BASE_REFERENCE_PROMPT'
      : 'ANALYSIS_PROMPT'
  )),
}))

const prismaMock = vi.hoisted(() => ({
  globalCharacterAppearance: {
    update: vi.fn<(input: { data?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<Record<string, never>>>(
      async () => ({}),
    ),
  },
  characterAppearance: {
    update: vi.fn(async () => ({})),
  },
}))

vi.mock('sharp', () => ({
  default: sharpMock,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/fetch-with-retry', () => fetchWithRetryMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/llm-client', () => llmClientMock)
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/storage', () => cosMock)
vi.mock('@/lib/fonts', () => fontsMock)
vi.mock('@/lib/workers/shared', () => workersSharedMock)
vi.mock('@/lib/workers/utils', () => workersUtilsMock)
vi.mock('@/lib/prompt-i18n', () => promptI18nMock)
vi.mock('@/lib/frameos/material-service', () => ({
  registerFrameosMaterial: vi.fn(async () => ({ id: 'material-1' })),
}))

import { handleReferenceToCharacterTask } from '@/lib/workers/handlers/reference-to-character'

function buildJob(payload: Record<string, unknown>, type: TaskType): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'GlobalCharacter',
      targetId: 'target-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function readGenerateCall(index: number) {
  const call = workersUtilsMock.resolveImageSourceFromGeneration.mock.calls[index]
  if (!call) return { prompt: '', options: {} as Record<string, unknown> }
  const params = call[1]
  return { prompt: params.prompt, options: params.options || {} }
}

describe('worker reference-to-character', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails fast when reference images are missing', async () => {
    const job = buildJob({}, TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER)
    await expect(handleReferenceToCharacterTask(job)).rejects.toThrow('Missing referenceImageUrl or referenceImageUrls')
  })

  it('fails fast on unsupported task type', async () => {
    const job = buildJob(
      { referenceImageUrl: 'https://example.com/ref.png' },
      'unsupported-task' as TaskType,
    )
    await expect(handleReferenceToCharacterTask(job)).rejects.toThrow('Unsupported task type')
  })

  it('uses suffix prompt and disables reference-image injection when customDescription is provided', async () => {
    const job = buildJob(
      {
        referenceImageUrls: ['https://example.com/ref-a.png', 'https://example.com/ref-b.png'],
        customDescription: '冷静黑发角色',
        characterName: 'Hero',
      },
      TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER,
    )

    const result = await handleReferenceToCharacterTask(job)

    expect(result).toEqual(expect.objectContaining({ success: true }))
    expect(workersUtilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(3)
    expect(fontsMock.initializeFonts).not.toHaveBeenCalled()
    expect(fontsMock.createLabelSVG).not.toHaveBeenCalled()

    const { prompt, options } = readGenerateCall(0)
    expect(prompt).toContain('冷静黑发角色')
    expect(prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(options.aspectRatio).toBe(CHARACTER_IMAGE_BANANA_RATIO)
    expect(options.referenceImages).toBeUndefined()
  })

  it('keeps three-view suffix in template flow and writes extracted description in background mode', async () => {
    const job = buildJob(
      {
        referenceImageUrls: [' https://example.com/ref-a.png ', 'https://example.com/ref-b.png'],
        isBackgroundJob: true,
        characterId: 'character-1',
        appearanceId: 'appearance-1',
        characterName: 'Hero',
      },
      TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER,
    )

    const result = await handleReferenceToCharacterTask(job)

    expect(result).toEqual(expect.objectContaining({ success: true }))
    expect(workersUtilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(3)
    expect(fontsMock.initializeFonts).not.toHaveBeenCalled()
    expect(fontsMock.createLabelSVG).not.toHaveBeenCalled()

    const { prompt, options } = readGenerateCall(0)
    expect(prompt).toContain('BASE_REFERENCE_PROMPT')
    expect(prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(options.referenceImages).toEqual(['https://example.com/ref-a.png', 'https://example.com/ref-b.png'])
    expect(options.aspectRatio).toBe(CHARACTER_IMAGE_BANANA_RATIO)

    const updateArg = prismaMock.globalCharacterAppearance.update.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>
      where?: Record<string, unknown>
    } | undefined
    const updateData = updateArg?.data || {}
    expect(updateArg?.where).toEqual({ id: 'appearance-1' })
    expect(updateData.description).toBe('AI_EXTRACTED_DESCRIPTION')
    expect(typeof updateData.imageUrls).toBe('string')
    expect(updateData.imageUrl).toMatch(/^cos\/reference-key-\d+\.jpg$/)
  })

  it('uses requested count when generating reference character sheets', async () => {
    const job = buildJob(
      {
        referenceImageUrls: ['https://example.com/ref-a.png'],
        characterName: 'Hero',
        count: 5,
      },
      TASK_TYPE.REFERENCE_TO_CHARACTER,
    )

    const result = await handleReferenceToCharacterTask(job)

    expect(result).toEqual(expect.objectContaining({ success: true }))
    expect(workersUtilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(5)
    const cosKeys = (result as { cosKeys?: string[] }).cosKeys
    expect(cosKeys).toHaveLength(5)
    expect(cosKeys?.every((item) => item.startsWith('cos/reference-key-'))).toBe(true)
  })

  it('adds project label bars only for project reference generation', async () => {
    const job = buildJob(
      {
        referenceImageUrls: ['https://example.com/ref-a.png'],
        characterName: 'Hero',
        count: 1,
      },
      TASK_TYPE.REFERENCE_TO_CHARACTER,
    )

    await handleReferenceToCharacterTask(job)

    expect(fontsMock.initializeFonts).toHaveBeenCalledTimes(1)
    expect(fontsMock.createLabelSVG).toHaveBeenCalledTimes(1)
  })
})
