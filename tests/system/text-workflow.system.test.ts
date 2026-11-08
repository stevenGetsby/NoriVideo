import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../integration/api/helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../helpers/auth'
import { resetSystemState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'
import { seedMinimalDomainState } from './helpers/seed'
import { seedBalance } from '../helpers/billing-fixtures'
import { expectLifecycleEvents, listTaskEventTypes, waitForTaskTerminalState } from './helpers/tasks'
import { startSystemWorkers, stopSystemWorkers, type SystemWorkers } from './helpers/workers'
import { createFixtureEpisode, createFixtureNovelProject, createFixtureProject, createFixtureUser } from '../helpers/fixtures'

type FakeAiResult = {
  text: string
  reasoning?: string
}

type FakeVoiceLineRow = {
  lineIndex: number
  speaker: string
  content: string
  emotionStrength: number
  matchedPanel: {
    storyboardId?: string
    panelIndex: number
  }
}

const textState = vi.hoisted(() => ({
  aiResults: [] as FakeAiResult[],
  voiceLineResults: [] as FakeVoiceLineRow[],
  parseFailureCount: 0,
}))

function cinematicPlanJson() {
  return JSON.stringify({
    segments: [{
      functionLabel: '开场钩子',
      sourceText: 'test novel text',
      location: 'Office',
      durationSeconds: 6,
      emotionalIntent: '用朗读建立测试场景。',
      storyQuestion: '测试剧情如何展开？',
      transitionOut: '停在朗读结束的状态。',
      characterNames: ['Narrator'],
      onScreenCharacterNames: ['Narrator'],
      propNames: [],
      narrativeEntry: 'Narrator 开始朗读测试剧本。',
      narrativeExit: 'Narrator 读完测试剧本。',
      shotBeats: ['Narrator 朗读测试剧本。'],
    }],
  })
}

vi.mock('@/lib/ai-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-runtime')>('@/lib/ai-runtime')
  return {
    ...actual,
    executeAiTextStep: vi.fn(async () => {
      const next = textState.aiResults.shift()
      if (!next) {
        return {
          text: '{"ok":true}',
          reasoning: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          completion: { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
        }
      }
      return {
        text: next.text,
        reasoning: next.reasoning || '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        completion: { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
      }
    }),
  }
})

vi.mock('@/lib/workers/handlers/script-to-storyboard-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/script-to-storyboard-helpers')>(
    '@/lib/workers/handlers/script-to-storyboard-helpers',
  )
  return {
    ...actual,
    parseVoiceLinesJson: vi.fn(() => {
      if (textState.parseFailureCount > 0) {
        textState.parseFailureCount -= 1
        throw new Error('invalid voice json')
      }
      return textState.voiceLineResults
    }),
    persistStoryboardOutputs: vi.fn(async (input: Parameters<typeof actual.persistStoryboardOutputs>[0]) => {
      const clipId = input.clipPanels[0]?.clipId
      if (!clipId) throw new Error(`TEST_CLIP_NOT_FOUND: ${input.episodeId}`)
      const voiceLineRows = input.voiceLineRows?.map((line) => ({
        ...line,
        matchedPanel: line.matchedPanel
          ? { ...line.matchedPanel, storyboardId: clipId }
          : line.matchedPanel,
      })) ?? null
      return actual.persistStoryboardOutputs({ ...input, voiceLineRows })
    }),
  }
})

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))

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

async function seedScriptToStoryboardState() {
  const user = await createFixtureUser()
  await seedBalance(user.id, 100)
  const project = await createFixtureProject(user.id)
  const novelProject = await createFixtureNovelProject(project.id)
  const episode = await createFixtureEpisode(novelProject.id)
  await prisma.novelPromotionCharacter.create({
    data: {
      novelPromotionProjectId: novelProject.id,
      name: 'Narrator',
    },
  })
  await prisma.novelPromotionLocation.create({
    data: {
      novelPromotionProjectId: novelProject.id,
      name: 'Office',
      summary: 'Office',
    },
  })
  return { user, project, novelProject, episode }
}

describe('system - text workflows', () => {
  let workers: SystemWorkers = {}

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    textState.aiResults = []
    textState.voiceLineResults = []
    textState.parseFailureCount = 0
    await resetSystemState()
    installAuthMocks()
  })

  afterEach(async () => {
    await stopSystemWorkers(workers)
    workers = {}
    resetAuthMockState()
  })

  it('script-to-storyboard success -> persists storyboard/panel/voiceLine and completes task', async () => {
    const seeded = await seedScriptToStoryboardState()
    mockAuthenticated(seeded.user.id)
    textState.aiResults = [{ text: cinematicPlanJson() }, { text: 'voice-lines-json' }]
    textState.voiceLineResults = [
      {
        lineIndex: 1,
        speaker: 'Narrator',
        content: 'Hello world',
        emotionStrength: 0.8,
        matchedPanel: {
          panelIndex: 0,
        },
      },
    ]
    workers = await startSystemWorkers(['text'])

    const mod = await import('@/app/api/novel-promotion/[projectId]/script-to-storyboard-stream/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      { locale: 'zh', episodeId: seeded.episode.id },
      { params: { projectId: seeded.project.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId, { timeoutMs: 20_000 })
    expect(task.status).toBe('completed')
    expect(task.type).toBe('script_to_storyboard_run')
    expect(task.result).toEqual(expect.objectContaining({
      episodeId: seeded.episode.id,
      panelCount: 1,
      voiceLineCount: 1,
    }))

    const storyboards = await prisma.novelPromotionStoryboard.findMany({
      where: { episodeId: seeded.episode.id },
      select: { id: true, panelCount: true },
    })
    expect(storyboards.length).toBeGreaterThan(0)

    const persistedVoiceLines = await prisma.novelPromotionVoiceLine.findMany({
      where: { episodeId: seeded.episode.id },
      orderBy: { lineIndex: 'asc' },
      select: {
        lineIndex: true,
        speaker: true,
        content: true,
        matchedPanelId: true,
        matchedPanelIndex: true,
      },
    })
    expect(persistedVoiceLines).toEqual([
      {
        lineIndex: 1,
        speaker: 'Narrator',
        content: 'Hello world',
        matchedPanelId: expect.any(String),
        matchedPanelIndex: 0,
      },
    ])

    const eventTypes = await listTaskEventTypes(json.taskId)
    expectLifecycleEvents(eventTypes, 'completed')
  })

  it('script-to-storyboard parse retry -> second attempt succeeds', async () => {
    const seeded = await seedScriptToStoryboardState()
    mockAuthenticated(seeded.user.id)
    textState.aiResults = [
      { text: cinematicPlanJson() },
      { text: 'invalid-voice-json' },
      { text: 'valid-voice-json' },
    ]
    textState.voiceLineResults = [
      {
        lineIndex: 1,
        speaker: 'Narrator',
        content: 'Retry success',
        emotionStrength: 0.4,
        matchedPanel: {
          panelIndex: 0,
        },
      },
    ]
    textState.parseFailureCount = 1
    workers = await startSystemWorkers(['text'])

    const mod = await import('@/app/api/novel-promotion/[projectId]/script-to-storyboard-stream/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      { locale: 'zh', episodeId: seeded.episode.id },
      { params: { projectId: seeded.project.id } },
    )

    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId, { timeoutMs: 20_000 })
    expect(task.status).toBe('completed')
    expect(task.result).toEqual(expect.objectContaining({
      voiceLineCount: 1,
    }))

    const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
      where: { episodeId: seeded.episode.id },
      select: { content: true },
    })
    expect(voiceLines).toEqual([{ content: 'Retry success' }])
  })

  it('insert-panel invalid ai payload -> task fails and no dirty panel remains', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)
    textState.aiResults = [{ text: 'not-json' }]
    workers = await startSystemWorkers(['text'])

    const beforeCount = await prisma.novelPromotionPanel.count({
      where: { storyboardId: seeded.storyboard.id },
    })

    const mod = await import('@/app/api/novel-promotion/[projectId]/insert-panel/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        locale: 'zh',
        storyboardId: seeded.storyboard.id,
        insertAfterPanelId: seeded.panel.id,
      },
      { params: { projectId: seeded.project.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId, { timeoutMs: 20_000 })
    expect(task.status).toBe('failed')

    const afterCount = await prisma.novelPromotionPanel.count({
      where: { storyboardId: seeded.storyboard.id },
    })
    expect(afterCount).toBe(beforeCount)

    const eventTypes = await listTaskEventTypes(json.taskId)
    expectLifecycleEvents(eventTypes, 'failed')
  })
})
