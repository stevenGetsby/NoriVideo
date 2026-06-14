import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const createPanelMock = vi.hoisted(() => vi.fn())
const updatePanelMock = vi.hoisted(() => vi.fn())

const prismaMock = vi.hoisted(() => ({
  novelPromotionStoryboard: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionPanel: {
    findMany: vi.fn(),
    update: updatePanelMock,
    create: createPanelMock,
  },
  $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prismaMock)),
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'insert panel prompt'),
}))

vi.mock('bullmq', () => ({
  Worker: class {},
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: 'lumina::gpt-5.5' })),
}))
vi.mock('@/lib/task/queues', () => ({ QUEUE_NAME: { TEXT: 'text' } }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: vi.fn(async () => undefined),
  reportTaskStreamChunk: vi.fn(async () => undefined),
  withTaskLifecycle: vi.fn(async (_job, handler) => handler(_job)),
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: vi.fn(async () => undefined),
}))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks, run) => run()),
}))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_AGENT_STORYBOARD_INSERT: 'np_agent_storyboard_insert' },
  buildPrompt: promptMock.buildPrompt,
}))
vi.mock('@/lib/workers/handlers/story-to-script', () => ({ handleStoryToScriptTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/script-to-storyboard', () => ({ handleScriptToStoryboardTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/voice-analyze', () => ({ handleVoiceAnalyzeTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/asset-hub-ai-design', () => ({ handleAssetHubAIDesignTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/ai-story-expand', () => ({ handleAiStoryExpandTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/clips-build', () => ({ handleClipsBuildTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/analyze-novel', () => ({ handleAnalyzeNovelTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/screenplay-convert', () => ({ handleScreenplayConvertTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/episode-split', () => ({ handleEpisodeSplitTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/analyze-global', () => ({ handleAnalyzeGlobalTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/asset-hub-ai-modify', () => ({ handleAssetHubAIModifyTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/reference-to-character', () => ({ handleReferenceToCharacterTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/shot-ai-tasks', () => ({ handleShotAITask: vi.fn() }))
vi.mock('@/lib/workers/handlers/character-profile', () => ({ handleCharacterProfileTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/super-agent-execute', () => ({ handleSuperAgentExecuteTask: vi.fn() }))

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-insert-panel',
      type: TASK_TYPE.INSERT_PANEL,
      locale: 'en',
      projectId: 'project-1',
      userId: 'user-1',
      targetId: 'storyboard-1',
      payload: {
        storyboardId: 'storyboard-1',
        insertAfterPanelId: 'panel-prev',
        userInput: 'Bridge the movement.',
      },
    },
  } as unknown as Job<TaskJobData>
}

describe('insert panel FrameOS metadata persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({
      id: 'storyboard-1',
      panels: [
        {
          id: 'panel-prev',
          panelIndex: 0,
          shotType: 'medium shot',
          cameraMove: 'slow push in',
          description: 'Ari lifts the brass key.',
          videoPrompt: 'A young woman lifts the brass key.',
          location: 'workshop_day',
          characters: JSON.stringify([{ name: 'Ari' }]),
          props: JSON.stringify(['brass_key']),
          srtSegment: 'Ari lifts the brass key.',
          imagePrompt: 'Legacy image prompt prev.',
          actingNotes: JSON.stringify({
            _frameosPanelMetadata: {
              panel_id: 'frameos-prev',
              panel_number: 1,
              source_anchor: { start: 'FrameOS prev start', end: 'FrameOS prev end' },
              referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
              visual_prompt: 'FrameOS visual prompt prev.',
              visual_style: 'FrameOS workshop style',
              visual_style_description: 'FrameOS warm practical light.',
              continuity_notes: 'FrameOS prev continuity: brass key in right hand.',
              voice_refs: [{ speaker: 'Ari', source_text: 'We start here.' }],
            },
          }),
        },
        {
          id: 'panel-next',
          panelIndex: 1,
          shotType: 'medium shot',
          cameraMove: 'tracking',
          description: 'Ari walks toward the workbench.',
          videoPrompt: 'A young woman walks toward the workbench.',
          location: 'workshop_day',
          characters: JSON.stringify([{ name: 'Ari' }]),
          props: JSON.stringify(['brass_key']),
          srtSegment: 'Ari walks toward the workbench.',
          imagePrompt: 'Legacy image prompt next.',
          actingNotes: JSON.stringify({
            _frameosPanelMetadata: {
              panel_id: 'frameos-next',
              panel_number: 2,
              source_anchor: { start: 'FrameOS next start', end: 'FrameOS next end' },
              referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
              visual_prompt: 'FrameOS visual prompt next.',
              continuity_notes: 'FrameOS next continuity: Ari reaches the workbench.',
              voice_refs: [],
            },
          }),
        },
      ],
    })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      characters: [
        {
          name: 'Ari',
          appearances: [
            {
              changeReason: 'default',
              descriptions: JSON.stringify(['short black hair, navy jacket']),
              selectedIndex: 0,
            },
          ],
        },
      ],
      locations: [
        {
          name: 'workshop_day',
          assetKind: 'location',
          images: [{ isSelected: true, description: 'central workbench', availableSlots: '[]' }],
        },
        {
          name: 'brass_key',
          assetKind: 'prop',
          summary: 'small brass key',
        },
      ],
    })
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([])
    createPanelMock.mockResolvedValue({ id: 'panel-inserted', panelIndex: 1 })
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        panel_id: 'inserted-transition',
        panel_number: 0,
        description: 'Ari crosses the short path with the brass key visible.',
        characters: [{ name: 'Ari', appearance: 'default' }],
        location: 'workshop_day',
        props: ['brass_key'],
        scene_type: 'daily',
        visual_style: 'cinematic realism',
        visual_style_description: 'warm workshop continuity',
        source_text: 'Ari moves from the doorway toward the workbench.',
        source_anchor: { start: 'Ari lifts', end: 'workbench.' },
        referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
        shot_type: 'medium tracking shot',
        camera_move: 'slow follow',
        image_prompt: 'Ari crosses the workshop path with the brass key.',
        visual_prompt: 'Ari crosses the workshop path with the brass key.',
        video_prompt: 'A young woman crosses the workshop path with the brass key, slow follow camera, starts at the rear doorway and ends near the workbench.',
        continuity_notes: 'Keeps Ari moving from rear doorway to workbench with brass key visible.',
        voice_refs: [],
        duration: 3,
      }),
    })
  })

  it('persists generated FrameOS panel metadata into actingNotes', async () => {
    const { handleInsertPanelTask } = await import('@/lib/workers/text.worker')

    await handleInsertPanelTask(buildJob())

    const createArg = createPanelMock.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined
    expect(createArg?.data?.actingNotes).toContain('_frameosPanelMetadata')
    expect(createArg?.data?.actingNotes).toContain('inserted-transition')
    expect(createArg?.data?.actingNotes).toContain('Ari crosses the workshop path with the brass key.')
    expect(createArg?.data?.actingNotes).toContain('Keeps Ari moving from rear doorway to workbench')
    expect(createArg?.data?.actingNotes).toContain('brass_key')
  })

  it('restores neighboring FrameOS metadata into insert prompt context', async () => {
    const { handleInsertPanelTask } = await import('@/lib/workers/text.worker')

    await handleInsertPanelTask(buildJob())

    const promptCalls = (promptMock.buildPrompt as unknown as {
      mock: { calls: Array<Array<{ variables?: Record<string, string> }>> }
    }).mock.calls
    const promptVariables = promptCalls[0]?.[0]?.variables
    expect(promptVariables?.prev_panel_json).toContain('"panel_id": "frameos-prev"')
    expect(promptVariables?.prev_panel_json).toContain('"visual_prompt": "FrameOS visual prompt prev."')
    expect(promptVariables?.prev_panel_json).toContain('"source_anchor"')
    expect(promptVariables?.prev_panel_json).toContain('FrameOS prev continuity: brass key in right hand.')
    expect(promptVariables?.prev_panel_json).toContain('"voice_refs"')
    expect(promptVariables?.next_panel_json).toContain('"panel_id": "frameos-next"')
    expect(promptVariables?.next_panel_json).toContain('"visual_prompt": "FrameOS visual prompt next."')
    expect(promptVariables?.next_panel_json).toContain('FrameOS next continuity: Ari reaches the workbench.')
  })
})
