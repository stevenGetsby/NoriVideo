import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const persistMock = vi.hoisted(() => ({
  resolveAnalysisModel: vi.fn(),
}))
const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
  },
}))

const runtimeMock = vi.hoisted(() => ({
  runShotPromptCompletion: vi.fn(),
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))
const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'shot-final-prompt'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/shot-ai-persist', () => persistMock)
vi.mock('@/lib/workers/handlers/shot-ai-prompt-runtime', () => ({
  runShotPromptCompletion: runtimeMock.runShotPromptCompletion,
}))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: runtimeMock.reportTaskProgress,
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: runtimeMock.assertTaskActive,
}))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_IMAGE_PROMPT_MODIFY: 'np_image_prompt_modify' },
  buildPrompt: promptMock.buildPrompt,
}))

import { handleModifyShotPromptTask } from '@/lib/workers/handlers/shot-ai-prompt-shot'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-shot-prompt-1',
      type: TASK_TYPE.AI_MODIFY_SHOT_PROMPT,
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

describe('worker shot-ai-prompt-shot behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistMock.resolveAnalysisModel.mockResolvedValue({ id: 'np-1', analysisModel: 'llm::analysis' })
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue(null)
    promptMock.buildPrompt.mockReturnValue('shot-final-prompt')
    runtimeMock.runShotPromptCompletion.mockResolvedValue(
      '{"image_prompt":"updated image prompt","visual_prompt":"updated visual prompt","video_prompt":"updated video prompt","referenced_assets":{"characters":["Hero"],"location":"Hall","props":[]},"continuity_notes":"kept Hero in Hall","change_summary":"changed camera movement"}',
    )
  })

  it('missing currentPrompt -> explicit error', async () => {
    const payload = { modifyInstruction: 'new angle' }
    const job = buildJob(payload)

    await expect(handleModifyShotPromptTask(job, payload)).rejects.toThrow('currentPrompt is required')
  })

  it('success -> returns modified image/video prompts and passes referencedAssets', async () => {
    const payload = {
      currentPrompt: 'old image prompt',
      currentVideoPrompt: 'old video prompt',
      currentVisualPrompt: 'old visual prompt',
      modifyInstruction: 'new camera movement',
      referencedAssets: [{ name: 'Hero', description: 'black coat' }],
      sourceText: 'Hero enters the hall.',
      continuityNotes: 'Hero stays by the door.',
    }
    const job = buildJob(payload)

    const result = await handleModifyShotPromptTask(job, payload)

    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      promptId: 'np_image_prompt_modify',
      locale: 'zh',
      variables: expect.objectContaining({
        prompt_input: 'old image prompt',
        video_prompt_input: 'old video prompt',
        panel_context_json: expect.stringContaining('"visual_prompt": "old visual prompt"'),
        referenced_assets_json: expect.stringContaining('"name": "Hero"'),
        user_input: expect.stringContaining('引用的资产描述：Hero(black coat)'),
      }),
    }))
    expect(runtimeMock.runShotPromptCompletion).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ai_modify_shot_prompt',
      prompt: 'shot-final-prompt',
    }))
    expect(result).toEqual({
      success: true,
      modifiedImagePrompt: 'updated image prompt',
      modifiedVisualPrompt: 'updated visual prompt',
      modifiedVideoPrompt: 'updated video prompt',
      referencedAssets: { characters: ['Hero'], location: 'Hall', props: [] },
      continuityNotes: 'kept Hero in Hall',
      changeSummary: 'changed camera movement',
    })
  })

  it('uses persisted FrameOS panel metadata when modifying a panel prompt', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      imagePrompt: 'panel image prompt fallback',
      videoPrompt: 'panel video prompt from db',
      srtSegment: 'Hero reaches the Old Town gate.',
      photographyRules: 'Keep the gate behind Hero.',
      actingNotes: JSON.stringify({
        characters: [{ name: 'Hero', acting: 'focused face toward the gate' }],
        _frameosPanelMetadata: {
          panel_id: 'frameos-panel-1',
          source_text: 'Hero reaches the Old Town gate and raises the brass key.',
          source_anchor: {
            start: 'Hero reaches the Old Town gate',
            end: 'raises the brass key.',
          },
          referenced_assets: {
            characters: [{ name: 'Hero', appearance: 'black coat' }],
            location: 'Old Town gate',
            props: ['brass_key'],
          },
          visual_prompt: 'FrameOS visual prompt: Hero and the brass key at the Old Town gate.',
          visual_style: 'grounded suspense',
          visual_style_description: 'cool daylight with restrained contrast',
          continuity_notes: 'FrameOS continuity: brass key remains in Hero right hand.',
          voice_refs: [{ speaker: 'Hero', source_text: 'We open it now.' }],
        },
      }),
    })
    const payload = {
      panelId: 'panel-1',
      currentPrompt: 'old image prompt',
      modifyInstruction: 'make the angle lower',
    }
    const job = buildJob(payload)

    await handleModifyShotPromptTask(job, payload)

    expect(prismaMock.novelPromotionPanel.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'panel-1' },
    }))
    const promptCalls = promptMock.buildPrompt.mock.calls as unknown[][]
    const promptCall = promptCalls.at(-1)?.[0] as { variables?: Record<string, string> } | undefined
    expect(promptCall?.variables?.video_prompt_input).toBe('panel video prompt from db')
    expect(promptCall?.variables?.panel_context_json).toContain('"panel_id": "frameos-panel-1"')
    expect(promptCall?.variables?.panel_context_json).toContain('"source_anchor"')
    expect(promptCall?.variables?.panel_context_json).toContain('"referenced_assets"')
    expect(promptCall?.variables?.panel_context_json).toContain('"visual_prompt": "FrameOS visual prompt: Hero and the brass key at the Old Town gate."')
    expect(promptCall?.variables?.panel_context_json).toContain('"visual_style": "grounded suspense"')
    expect(promptCall?.variables?.panel_context_json).toContain('"visual_style_description": "cool daylight with restrained contrast"')
    expect(promptCall?.variables?.panel_context_json).toContain('FrameOS continuity: brass key remains in Hero right hand.')
    expect(promptCall?.variables?.panel_context_json).toContain('Keep the gate behind Hero.')
    expect(promptCall?.variables?.panel_context_json).toContain('"voice_refs"')
    expect(promptCall?.variables?.referenced_assets_json).toContain('"brass_key"')
  })
})
