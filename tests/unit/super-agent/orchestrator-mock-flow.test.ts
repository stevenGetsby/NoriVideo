import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPreciseBeatVideoPrompt } from '@/lib/novel-promotion/short-drama-video-prompt'

const getUserModelConfigMock = vi.hoisted(() => vi.fn())
const getProjectModelConfigMock = vi.hoisted(() => vi.fn())
const resolveProjectModelCapabilityGenerationOptionsMock = vi.hoisted(() => vi.fn())
const buildImageBillingPayloadMock = vi.hoisted(() => vi.fn(async ({ imageModel, basePayload }) => ({
  ...basePayload,
  ...(imageModel ? { imageModel } : {}),
})))
const resolveModelSelectionMock = vi.hoisted(() => vi.fn())
const submitTaskMock = vi.hoisted(() => vi.fn())
const workflowStoreMock = vi.hoisted(() => ({
  startAgentWorkflowRun: vi.fn(),
  completeAgentWorkflowRun: vi.fn(),
  recordAgentWorkflowStage: vi.fn(),
  failAgentWorkflowRun: vi.fn(),
}))
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  graphRun: {
    findUnique: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
  project: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionProject: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionEpisode: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionCharacter: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  novelPromotionLocation: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  characterAppearance: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  locationImage: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  novelPromotionClip: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  novelPromotionStoryboard: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionPanel: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionVoiceLine: {
    create: vi.fn(),
  },
}))

vi.mock('@/lib/config-service', () => ({
  buildImageBillingPayload: buildImageBillingPayloadMock,
  getUserModelConfig: getUserModelConfigMock,
  getProjectModelConfig: getProjectModelConfigMock,
  resolveProjectModelCapabilityGenerationOptions: resolveProjectModelCapabilityGenerationOptionsMock,
}))

vi.mock('@/lib/api-config', () => ({
  resolveModelSelection: resolveModelSelectionMock,
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

vi.mock('@/lib/super-agent/workflow-store', () => workflowStoreMock)

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

function preciseAgentPanelPrompt(action: string): string {
  return buildPreciseBeatVideoPrompt({
    segmentId: 'S01-SEG01',
    location: '现代美国私立医院',
    beat: action,
    durationSeconds: 4,
    characters: [{ name: 'Ava' }, { name: 'Dr. Grayson' }],
    props: [{ name: '手术安排文件' }],
  })
}

describe('SuperAgentOrchestrator mock flow', () => {
  let createdClips: Array<Record<string, unknown>>
  let createdStoryboards: Array<Record<string, unknown> & { panels: Array<Record<string, unknown>> }>
  let createdVoiceLines: Array<Record<string, unknown>>
  let createdCharacters: Array<Record<string, unknown>>
  let createdLocations: Array<Record<string, unknown>>

  beforeEach(() => {
    vi.clearAllMocks()

    createdClips = []
    createdStoryboards = []
    createdVoiceLines = []
    createdCharacters = []
    createdLocations = []

    getUserModelConfigMock.mockResolvedValue({
      analysisModel: 'openai-compatible::analysis',
      characterModel: 'image::character',
      locationModel: 'image::location',
      storyboardModel: 'image::storyboard',
      editModel: 'image::edit',
      videoModel: 'video::model',
      audioModel: 'audio::model',
    })
    getProjectModelConfigMock.mockResolvedValue({
      characterModel: 'image::character',
      locationModel: 'image::location',
      storyboardModel: 'image::storyboard',
      videoModel: 'video::model',
    })
    resolveProjectModelCapabilityGenerationOptionsMock.mockResolvedValue({})
    resolveModelSelectionMock.mockResolvedValue({
      provider: 'image',
      modelId: 'storyboard',
      modelKey: 'image::storyboard',
      mediaType: 'image',
    })

    prismaMock.project.create.mockResolvedValue({ id: 'project-1' })
    prismaMock.project.findFirst.mockResolvedValue(null)
    prismaMock.project.update.mockResolvedValue({})
    prismaMock.novelPromotionProject.create.mockResolvedValue({ id: 'novel-project-1' })
    prismaMock.novelPromotionProject.findUnique.mockImplementation(async () => ({
      id: 'novel-project-1',
      globalAssetText: null,
      characters: createdCharacters,
      locations: createdLocations,
    }))
    prismaMock.novelPromotionProject.update.mockResolvedValue({})
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionEpisode.create.mockResolvedValue({ id: 'episode-1' })
    prismaMock.novelPromotionEpisode.update.mockResolvedValue({ id: 'episode-1' })
    prismaMock.novelPromotionEpisode.findUnique.mockImplementation(async ({ include }) => {
      if (include?.storyboards) {
        return {
          id: 'episode-1',
          storyboards: createdStoryboards,
          voiceLines: createdVoiceLines,
        }
      }
      return {
        id: 'episode-1',
        clips: createdClips,
      }
    })
    prismaMock.novelPromotionCharacter.create.mockImplementation(async ({ data }) => {
      const character = { id: `character-${createdCharacters.length + 1}`, appearances: [], ...data }
      createdCharacters.push(character)
      return character
    })
    prismaMock.novelPromotionCharacter.findMany.mockImplementation(async () => createdCharacters)
    prismaMock.novelPromotionLocation.create.mockImplementation(async ({ data }) => {
      const location = { id: `location-${createdLocations.length + 1}`, assetKind: 'location', images: [], ...data }
      createdLocations.push(location)
      return location
    })
    prismaMock.novelPromotionLocation.update.mockImplementation(async ({ where, data }) => {
      const location = createdLocations.find((item) => item.id === where.id)
      if (location) Object.assign(location, data)
      return location || { id: where.id, ...data }
    })
    prismaMock.novelPromotionLocation.findMany.mockImplementation(async () => createdLocations)
    prismaMock.characterAppearance.create.mockImplementation(async ({ data }) => {
      const appearance = { id: `appearance-${data.characterId}-${data.appearanceIndex}`, imageUrl: null, imageMediaId: null, ...data }
      const character = createdCharacters.find((item) => item.id === data.characterId)
      if (character) {
        const appearances = Array.isArray(character.appearances) ? character.appearances : []
        appearances.push(appearance)
        character.appearances = appearances
      }
      return appearance
    })
    prismaMock.characterAppearance.findUnique.mockImplementation(async ({ where }) => (
      createdCharacters
        .flatMap((character) => Array.isArray(character.appearances) ? character.appearances : [])
        .find((appearance) => appearance.id === where.id) || null
    ))
    prismaMock.characterAppearance.findMany.mockImplementation(async ({ where }) => {
      const ids = new Set(where?.id?.in || [])
      return createdCharacters
        .flatMap((character) => Array.isArray(character.appearances) ? character.appearances : [])
        .filter((appearance) => ids.size === 0 || ids.has(appearance.id))
    })
    prismaMock.locationImage.create.mockImplementation(async ({ data }) => {
      const image = { id: `location-image-${data.locationId}-${data.imageIndex}`, imageUrl: null, imageMediaId: null, ...data }
      const location = createdLocations.find((item) => item.id === data.locationId)
      if (location) {
        const images = Array.isArray(location.images) ? location.images : []
        images.push(image)
        location.images = images
      }
      return image
    })
    prismaMock.locationImage.findUnique.mockImplementation(async ({ where }) => (
      createdLocations
        .flatMap((location) => Array.isArray(location.images) ? location.images : [])
        .find((image) => image.id === where.id) || null
    ))
    prismaMock.locationImage.findMany.mockImplementation(async ({ where }) => {
      const ids = new Set(where?.id?.in || [])
      return createdLocations
        .flatMap((location) => Array.isArray(location.images) ? location.images : [])
        .filter((image) => ids.size === 0 || ids.has(image.id))
    })
    prismaMock.novelPromotionClip.create.mockImplementation(async ({ data }) => {
      const clip = { id: `clip-${createdClips.length + 1}`, ...data }
      createdClips.push(clip)
      return clip
    })
    prismaMock.novelPromotionClip.findMany.mockImplementation(async () => createdClips)
    prismaMock.novelPromotionStoryboard.create.mockImplementation(async ({ data }) => {
      const storyboard = { id: `storyboard-${createdStoryboards.length + 1}`, panels: [], ...data }
      createdStoryboards.push(storyboard)
      return storyboard
    })
    prismaMock.novelPromotionPanel.create.mockImplementation(async ({ data }) => {
      const panel = { id: `panel-${createdStoryboards.reduce((sum, storyboard) => sum + storyboard.panels.length, 0) + 1}`, ...data }
      const storyboard = createdStoryboards.find((item) => item.id === data.storyboardId)
      storyboard?.panels.push(panel)
      return panel
    })
    prismaMock.novelPromotionVoiceLine.create.mockImplementation(async ({ data }) => {
      const voiceLine = { id: `voice-line-${createdVoiceLines.length + 1}`, ...data }
      createdVoiceLines.push(voiceLine)
      return voiceLine
    })
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([])
    prismaMock.novelPromotionPanel.deleteMany.mockResolvedValue({})
    prismaMock.novelPromotionPanel.findMany.mockImplementation(async ({ where }) => {
      const ids = new Set(where?.id?.in || [])
      return createdStoryboards
        .flatMap((storyboard) => storyboard.panels)
        .filter((panel) => ids.size === 0 || ids.has(panel.id))
    })
    prismaMock.novelPromotionPanel.findUnique.mockImplementation(async ({ where }) => (
      createdStoryboards
        .flatMap((storyboard) => storyboard.panels)
        .find((panel) => panel.id === where.id) || null
    ))
    prismaMock.novelPromotionPanel.update.mockResolvedValue({})
    prismaMock.novelPromotionStoryboard.update.mockResolvedValue({})
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
    prismaMock.graphRun.findUnique.mockResolvedValue({ id: 'run-1', status: 'completed' })
    prismaMock.task.findMany.mockImplementation(async ({ where }) => {
      const ids = where?.id?.in || []
      return ids.map((id: string) => ({
        id,
        status: 'completed',
      }))
    })
    submitTaskMock
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-story', runId: 'run-story', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-storyboard', runId: 'run-storyboard', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-image-panel-1', runId: 'run-image-panel-1', status: 'queued', deduped: false })
    workflowStoreMock.startAgentWorkflowRun.mockResolvedValue({ id: 'agent-workflow-run-1' })
    workflowStoreMock.completeAgentWorkflowRun.mockResolvedValue(undefined)
    workflowStoreMock.recordAgentWorkflowStage.mockResolvedValue(undefined)
    workflowStoreMock.failAgentWorkflowRun.mockResolvedValue(undefined)
  })

  it('creates a complete editable mock project from prompt to workspace url', async () => {
    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const context = {
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个16:9智能手表商品宣传短片，面向年轻用户，强调续航和防水。',
      executionMode: 'mock' as const,
      parameters: {
        durationSeconds: 24,
        targetAudience: '年轻用户',
        tone: '清晰、有活力',
        sellingPoints: '长续航、防水',
        callToAction: '立即了解新品',
        narration: 'off' as const,
        shotCount: 2,
        panelsPerShot: 2,
        mockPrompt: 'Mock prompt: 生成可编辑的智能手表广告项目。',
      },
    }

    const plan = await orchestrator.createExecutionPlan(context)
    expect(plan.executionMode).toBe('mock')
    expect(plan.selectedSkill).toBe('product-promo')
    expect(plan.projectConfig.videoRatio).toBe('16:9')
    expect(plan.creativeParameters).toMatchObject({
      durationSeconds: 24,
      shotCount: 2,
      panelsPerShot: 2,
      narration: 'off',
      mockPrompt: 'Mock prompt: 生成可编辑的智能手表广告项目。',
    })

    const onProgress = vi.fn()
    const result = await orchestrator.executePlan(plan, context, onProgress)
    const { resolveEpisodeStageArtifacts } = await import('@/lib/novel-promotion/stage-readiness')

    expect(result).toMatchObject({
      projectId: 'project-1',
      episodeId: 'episode-1',
      status: 'completed',
      workspaceUrl: '/zh/workspace/project-1?episode=episode-1&stage=videos',
      stageResults: {
        stage1: { projectId: 'project-1', episodeId: 'episode-1', hasStory: true },
        stage2: { characterCount: 1, locationCount: 1, clipCount: 2, hasScript: true },
        assetConsistency: { characterCount: 1, locationCount: 1, clipCount: 2, hasConsistencyBrief: true },
        stage3: { storyboardCount: 2, panelCount: 4, voiceLineCount: 0, hasStoryboard: true },
      },
    })
    expect(prismaMock.project.create).toHaveBeenCalledWith({
      data: {
        name: expect.stringContaining('智能手表'),
        description: 'Created by Super Agent (mock)',
        userId: 'user-1',
      },
    })
    expect(prismaMock.novelPromotionProject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        workflowMode: 'agent',
        importStatus: 'completed',
      }),
    })
    expect(prismaMock.novelPromotionPanel.create).toHaveBeenCalledTimes(4)
    expect(prismaMock.novelPromotionVoiceLine.create).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'novel-project-1' },
      data: {
        globalAssetText: expect.stringContaining('【Agent 资产一致性简报】'),
      },
    })
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'novel-project-1' },
      data: {
        globalAssetText: expect.stringContaining('中国故事必须使用中国场景'),
      },
    })
    expect(prismaMock.novelPromotionLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: {
        summary: expect.stringContaining('中国故事必须使用中国场景'),
      },
    })
    expect(resolveEpisodeStageArtifacts({
      novelText: plan.episodeConfig.novelText,
      clips: createdClips,
      storyboards: createdStoryboards,
      voiceLines: createdVoiceLines,
    })).toMatchObject({
      hasStory: true,
      hasScript: true,
      hasStoryboard: true,
      hasVoice: false,
    })
    expect(onProgress).toHaveBeenLastCalledWith('完成', 100)
    expect(workflowStoreMock.startAgentWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetId: 'project-1',
      userInput: context.userInput,
    }))
    expect(workflowStoreMock.completeAgentWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'agent-workflow-run-1',
      userId: 'user-1',
      result: expect.objectContaining({ projectId: 'project-1', episodeId: 'episode-1' }),
    }))
  })

  it('defaults product promo to concise script-first keyframes', async () => {
    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const context = {
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个商品宣传短片：浅色狗狗图案帆布包，突出通勤购物和环保大容量。',
      executionMode: 'mock' as const,
    }

    const plan = await orchestrator.createExecutionPlan(context)

    expect(plan.selectedSkill).toBe('product-promo')
    expect(plan.creativeParameters).toMatchObject({
      durationSeconds: 18,
      shotCount: 3,
      panelsPerShot: 1,
    })
    expect(plan.stages.map((stage) => stage.title)).toEqual([
      '项目初始化',
      '故事扩写与剧本锁定',
      '资产一致性核对',
      '资产图生成',
      '精简分镜生成',
      '视频资产引用准备',
      '视频生成',
    ])

    const result = await orchestrator.executePlan(plan, context)

    expect(result.stageResults.stage2).toMatchObject({
      clipCount: 3,
      hasScript: true,
    })
    expect(result.stageResults.assetConsistency).toMatchObject({
      characterCount: 1,
      locationCount: 1,
      clipCount: 3,
      hasConsistencyBrief: true,
    })
    expect(result.stageResults.stage3).toMatchObject({
      storyboardCount: 3,
      panelCount: 3,
      hasStoryboard: true,
    })
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'novel-project-1' },
      data: {
        globalAssetText: expect.stringContaining('分镜约束：宣发短片只保留'),
      },
    })
  })

  it('submits live story, asset image, storyboard, and direct video stages to the worker queue', async () => {
    submitTaskMock.mockReset()
    getProjectModelConfigMock.mockResolvedValue({
      characterModel: 'image::character',
      locationModel: 'image::location',
      storyboardModel: 'image::storyboard',
      videoModel: 'ark::doubao-seedance-2-0-260128',
    })
    submitTaskMock
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-story', runId: 'run-story', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-character-image', runId: 'run-character-image', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-location-image', runId: 'run-location-image', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-storyboard', runId: 'run-storyboard', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-video-panel-1', runId: 'run-video-panel-1', status: 'queued', deduped: false })

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      globalAssetText: null,
      characters: [{
        id: 'character-1',
        appearances: [{
          id: 'appearance-1',
          imageUrl: null,
          imageUrls: '[]',
          imageMediaId: null,
        }],
      }],
      locations: [{
        id: 'location-1',
        assetKind: 'location',
        images: [{
          id: 'location-image-1',
          locationId: 'location-1',
          imageIndex: 0,
          imageUrl: null,
          imageMediaId: null,
        }],
      }],
    })
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-1',
      imageUrl: null,
      imageUrls: '[]',
      imageMediaId: null,
    })
    prismaMock.characterAppearance.findMany.mockResolvedValue([{
      id: 'appearance-1',
      imageUrl: 'cos://character',
      imageUrls: '["cos://character"]',
      imageMediaId: null,
    }])
    prismaMock.locationImage.findUnique.mockResolvedValue({
      id: 'location-image-1',
      imageUrl: null,
      imageMediaId: null,
    })
    prismaMock.locationImage.findMany.mockResolvedValue([{
      id: 'location-image-1',
      imageUrl: 'cos://location',
      imageMediaId: null,
    }])
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      { id: 'storyboard-1', panels: [{ id: 'panel-1', panelIndex: 0 }] },
    ])
    prismaMock.novelPromotionEpisode.findUnique.mockImplementation(async ({ include }) => {
      if (include?.storyboards) {
        return {
          id: 'episode-1',
          storyboards: [{ id: 'storyboard-1', panels: [{ id: 'panel-1' }] }],
          voiceLines: [{ id: 'voice-line-1' }],
        }
      }
      return {
        id: 'episode-1',
        clips: [{ id: 'clip-1', screenplay: '{"scenes":[]}' }],
      }
    })
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      { id: 'panel-1', videoUrl: 'cos://video-1', videoMediaId: null },
    ])

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个口播视频介绍我们的UGC平台',
      executionMode: 'mock',
    })
    const result = await orchestrator.executePlan(
      { ...plan, executionMode: 'live' },
      {
        userId: 'user-1',
        locale: 'zh',
        userInput: '制作一个口播视频介绍我们的UGC平台',
      },
    )

    expect(submitTaskMock).toHaveBeenCalledTimes(5)
    expect(submitTaskMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'story_to_script_run',
      targetType: 'episode',
      targetId: 'episode-1',
      payload: { episodeId: 'episode-1' },
    }))
    expect(submitTaskMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'image_character',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      payload: expect.objectContaining({
        appearanceId: 'appearance-1',
        imageModel: 'image::character',
      }),
    }))
    expect(submitTaskMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'image_location',
      targetType: 'LocationImage',
      targetId: 'location-image-1',
      payload: expect.objectContaining({
        id: 'location-1',
        locationId: 'location-1',
        imageModel: 'image::location',
      }),
    }))
    expect(submitTaskMock).toHaveBeenNthCalledWith(4, expect.objectContaining({
      type: 'script_to_storyboard_run',
      payload: { episodeId: 'episode-1' },
    }))
    expect(submitTaskMock).toHaveBeenNthCalledWith(5, expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'video_panel',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: expect.objectContaining({
        panelId: 'panel-1',
        videoModel: 'ark::doubao-seedance-2-0-260128',
      }),
      dedupeKey: 'video_panel:panel-1',
    }))
    expect(prismaMock.graphRun.findUnique).toHaveBeenCalledWith({ where: { id: 'run-story' } })
    expect(prismaMock.graphRun.findUnique).toHaveBeenCalledWith({ where: { id: 'run-storyboard' } })
    expect(result.stageResults.stage2).toMatchObject({
      characterCount: 1,
      locationCount: 1,
      clipCount: 1,
      hasScript: true,
    })
    expect(result.stageResults.stage3).toMatchObject({
      storyboardCount: 1,
      panelCount: 1,
      voiceLineCount: 1,
      hasStoryboard: true,
    })
    expect(result.stageResults.assetImageGeneration).toMatchObject({
      characterAppearanceCount: 1,
      locationImageCount: 1,
      submittedTaskCount: 2,
      completedTaskCount: 2,
      failedTaskCount: 0,
      hasAssetImages: true,
      taskIds: ['task-character-image', 'task-location-image'],
    })
    expect(result.stageResults.imageGeneration).toMatchObject({
      panelCount: 1,
      skippedExistingImageCount: 0,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      hasImages: false,
      taskIds: [],
    })
    expect(result.stageResults.videoGeneration).toMatchObject({
      panelCount: 1,
      skippedMissingImageCount: 0,
      submittedTaskCount: 1,
      completedTaskCount: 1,
      failedTaskCount: 0,
      hasVideos: true,
      taskIds: ['task-video-panel-1'],
    })
    expect(result).toMatchObject({
      status: 'completed',
      errors: [],
    })
  })

  it('submits live video tasks after storyboard images are ready', async () => {
    submitTaskMock.mockReset()
    submitTaskMock
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-story', runId: 'run-story', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-storyboard', runId: 'run-storyboard', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-video-panel-1', runId: 'run-video-panel-1', status: 'queued', deduped: false })

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      globalAssetText: null,
      characters: [{ id: 'character-1' }],
      locations: [{ id: 'location-1', assetKind: 'location' }],
    })
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      { id: 'storyboard-1', panels: [{ id: 'panel-1', panelIndex: 0 }] },
    ])
    prismaMock.novelPromotionEpisode.findUnique.mockImplementation(async ({ include }) => {
      if (include?.storyboards) {
        return {
          id: 'episode-1',
          storyboards: [{
            id: 'storyboard-1',
            panels: [{
              id: 'panel-1',
              imageUrl: 'cos://panel-image',
              imageMediaId: null,
              videoUrl: null,
              videoMediaId: null,
            }],
          }],
          voiceLines: [{ id: 'voice-line-1' }],
        }
      }
      return {
        id: 'episode-1',
        clips: [{ id: 'clip-1', screenplay: '{"scenes":[]}' }],
      }
    })
    prismaMock.novelPromotionPanel.findMany.mockImplementation(async ({ select }) => {
      if (select?.videoUrl) {
        return [{
          id: 'panel-1',
          videoUrl: 'cos://panel-video',
          videoMediaId: null,
        }]
      }
      return [{
        id: 'panel-1',
        imageUrl: 'cos://panel-image',
        imageMediaId: null,
      }]
    })
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      imageUrl: 'cos://panel-image',
      imageMediaId: null,
      videoUrl: null,
      videoMediaId: null,
    })

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个口播视频介绍我们的UGC平台',
      executionMode: 'mock',
    })
    const result = await orchestrator.executePlan(
      { ...plan, executionMode: 'live' },
      {
        userId: 'user-1',
        locale: 'zh',
        userInput: '制作一个口播视频介绍我们的UGC平台',
      },
    )

    expect(submitTaskMock).toHaveBeenCalledTimes(3)
    expect(submitTaskMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'video_panel',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: expect.objectContaining({
        panelId: 'panel-1',
        videoModel: 'video::model',
      }),
      dedupeKey: 'video_panel:panel-1',
    }))
    expect(result.stageResults.imageGeneration).toMatchObject({
      panelCount: 1,
      skippedExistingImageCount: 0,
      submittedTaskCount: 0,
      failedTaskCount: 0,
      hasImages: false,
    })
    expect(result.stageResults.videoGeneration).toMatchObject({
      panelCount: 1,
      skippedMissingImageCount: 0,
      submittedTaskCount: 1,
      completedTaskCount: 1,
      failedTaskCount: 0,
      hasVideos: true,
      taskIds: ['task-video-panel-1'],
    })
  })

  it('submits panel image tasks for every Agent panel that has no image yet', async () => {
    submitTaskMock.mockReset()
    submitTaskMock
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-image-panel-1', runId: 'run-image-panel-1', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-image-panel-2', runId: 'run-image-panel-2', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-image-panel-3', runId: 'run-image-panel-3', status: 'queued', deduped: false })

    const panels = [
      { id: 'agent-panel-1', imageUrl: null, imageMediaId: null, videoPrompt: preciseAgentPanelPrompt('建立场景') },
      { id: 'agent-panel-2', imageUrl: null, imageMediaId: null, videoPrompt: preciseAgentPanelPrompt('角色说话') },
      { id: 'agent-panel-3', imageUrl: null, imageMediaId: null, videoPrompt: preciseAgentPanelPrompt('特写反应') },
    ]
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      storyboards: [{ id: 'storyboard-1', panels }],
    })
    prismaMock.novelPromotionPanel.findUnique.mockImplementation(async ({ where }) => (
      panels.find((panel) => panel.id === where.id) || null
    ))
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      { id: 'agent-panel-1', imageUrl: 'cos://panel-1', imageMediaId: null },
      { id: 'agent-panel-2', imageUrl: 'cos://panel-2', imageMediaId: null },
      { id: 'agent-panel-3', imageUrl: 'cos://panel-3', imageMediaId: null },
    ])

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator() as unknown as {
      executeImageGenerationStage: (projectId: string, episodeId: string, context: { userId: string; locale: string; userInput: string }) => Promise<{
        panelCount: number
        submittedTaskCount: number
        completedTaskCount: number
        failedTaskCount: number
        hasImages: boolean
        taskIds: string[]
      }>
    }
    const result = await orchestrator.executeImageGenerationStage('project-1', 'episode-1', {
      userId: 'user-1',
      locale: 'zh',
      userInput: 'Agent 多分镜测试',
    })

    expect(submitTaskMock).toHaveBeenCalledTimes(3)
    expect(submitTaskMock.mock.calls.map((call) => call[0].targetId)).toEqual([
      'agent-panel-1',
      'agent-panel-2',
      'agent-panel-3',
    ])
    for (let index = 0; index < 3; index += 1) {
      expect(submitTaskMock).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        type: 'image_panel',
        targetType: 'NovelPromotionPanel',
        payload: expect.objectContaining({
          panelId: `agent-panel-${index + 1}`,
          candidateCount: 1,
          imageModel: 'image::storyboard',
        }),
        dedupeKey: `image_panel:agent-panel-${index + 1}:1`,
      }))
    }
    expect(result).toMatchObject({
      panelCount: 3,
      submittedTaskCount: 3,
      completedTaskCount: 3,
      failedTaskCount: 0,
      hasImages: true,
      taskIds: ['task-image-panel-1', 'task-image-panel-2', 'task-image-panel-3'],
    })
  })

  it('submits video tasks for every image-ready Agent panel with each panel duration', async () => {
    submitTaskMock.mockReset()
    submitTaskMock
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-video-panel-1', runId: 'run-video-panel-1', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-video-panel-2', runId: 'run-video-panel-2', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-video-panel-3', runId: 'run-video-panel-3', status: 'queued', deduped: false })

    const panels = [
      {
        id: 'agent-panel-1',
        imageUrl: 'cos://panel-1',
        imageMediaId: null,
        videoUrl: null,
        videoMediaId: null,
        duration: 2,
        description: '建立医院走廊空间和人物站位',
        videoPrompt: preciseAgentPanelPrompt('Ava 站在 Dr. Grayson 面前'),
        firstLastFramePrompt: null,
        srtSegment: null,
        shotType: '中景',
        cameraMove: '固定镜头',
      },
      {
        id: 'agent-panel-2',
        imageUrl: 'cos://panel-2',
        imageMediaId: null,
        videoUrl: null,
        videoMediaId: null,
        duration: 5,
        description: 'Ava 说出请求',
        videoPrompt: preciseAgentPanelPrompt('Ava 英文口型同步，说：Please help my grandma.'),
        firstLastFramePrompt: null,
        srtSegment: 'Ava: Please help my grandma.',
        shotType: '近景',
        cameraMove: '固定镜头',
      },
      {
        id: 'agent-panel-3',
        imageUrl: 'cos://panel-3',
        imageMediaId: null,
        videoUrl: null,
        videoMediaId: null,
        duration: 8,
        description: 'Dr. Grayson 冷静回应并转场',
        videoPrompt: preciseAgentPanelPrompt('Dr. Grayson 转身安排手术'),
        firstLastFramePrompt: null,
        srtSegment: null,
        shotType: '中景',
        cameraMove: '轻微推近',
      },
    ]
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      storyboards: [{ id: 'storyboard-1', panels }],
    })
    prismaMock.novelPromotionPanel.findUnique.mockImplementation(async ({ where }) => (
      panels.find((panel) => panel.id === where.id) || null
    ))
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      { id: 'agent-panel-1', videoUrl: 'cos://video-1', videoMediaId: null },
      { id: 'agent-panel-2', videoUrl: 'cos://video-2', videoMediaId: null },
      { id: 'agent-panel-3', videoUrl: 'cos://video-3', videoMediaId: null },
    ])

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator() as unknown as {
      executeVideoGenerationStage: (projectId: string, episodeId: string, context: { userId: string; locale: string; userInput: string }) => Promise<{
        panelCount: number
        submittedTaskCount: number
        completedTaskCount: number
        failedTaskCount: number
        hasVideos: boolean
        taskIds: string[]
      }>
    }
    const result = await orchestrator.executeVideoGenerationStage('project-1', 'episode-1', {
      userId: 'user-1',
      locale: 'zh',
      userInput: 'Agent 多分镜测试',
    })

    expect(submitTaskMock).toHaveBeenCalledTimes(3)
    expect(submitTaskMock.mock.calls.map((call) => call[0].targetId)).toEqual([
      'agent-panel-1',
      'agent-panel-2',
      'agent-panel-3',
    ])
    expect(submitTaskMock.mock.calls.map((call) => call[0].payload.generationOptions.duration)).toEqual([2, 5, 8])
    for (let index = 0; index < 3; index += 1) {
      expect(submitTaskMock).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        type: 'video_panel',
        targetType: 'NovelPromotionPanel',
        targetId: `agent-panel-${index + 1}`,
        payload: expect.objectContaining({
          panelId: `agent-panel-${index + 1}`,
          videoModel: 'video::model',
          generationOptions: expect.objectContaining({
            duration: panels[index].duration,
          }),
        }),
        dedupeKey: `video_panel:agent-panel-${index + 1}`,
      }))
    }
    expect(result).toMatchObject({
      panelCount: 3,
      submittedTaskCount: 3,
      completedTaskCount: 3,
      failedTaskCount: 0,
      hasVideos: true,
      taskIds: ['task-video-panel-1', 'task-video-panel-2', 'task-video-panel-3'],
    })
  })

  it('submits Seedance video tasks from Agent panels even when storyboard images were skipped', async () => {
    submitTaskMock.mockReset()
    submitTaskMock
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-video-panel-1', runId: 'run-video-panel-1', status: 'queued', deduped: false })
      .mockResolvedValueOnce({ success: true, async: true, taskId: 'task-video-panel-2', runId: 'run-video-panel-2', status: 'queued', deduped: false })
    getProjectModelConfigMock.mockResolvedValueOnce({
      characterModel: 'image::character',
      locationModel: 'image::location',
      storyboardModel: 'image::storyboard',
      videoModel: 'ark::doubao-seedance-2-0-260128',
    })

    const panels = [
      {
        id: 'agent-panel-1',
        imageUrl: null,
        imageMediaId: null,
        videoUrl: null,
        videoMediaId: null,
        duration: 8,
        description: 'Ava 请求帮助',
        videoPrompt: preciseAgentPanelPrompt('Ava 请求 Dr. Grayson 帮外婆安排手术'),
        firstLastFramePrompt: null,
        srtSegment: null,
        shotType: '中景',
        cameraMove: '固定镜头',
      },
      {
        id: 'agent-panel-2',
        imageUrl: null,
        imageMediaId: null,
        videoUrl: null,
        videoMediaId: null,
        duration: 6,
        description: '医生回应',
        videoPrompt: preciseAgentPanelPrompt('Dr. Grayson 冷静回应并安排手术'),
        firstLastFramePrompt: null,
        srtSegment: null,
        shotType: '近景',
        cameraMove: '轻微推近',
      },
    ]
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      storyboards: [{ id: 'storyboard-1', panels }],
    })
    prismaMock.novelPromotionPanel.findUnique.mockImplementation(async ({ where }) => (
      panels.find((panel) => panel.id === where.id) || null
    ))
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      { id: 'agent-panel-1', videoUrl: 'cos://video-1', videoMediaId: null },
      { id: 'agent-panel-2', videoUrl: 'cos://video-2', videoMediaId: null },
    ])

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator() as unknown as {
      executeVideoGenerationStage: (projectId: string, episodeId: string, context: { userId: string; locale: string; userInput: string }) => Promise<{
        panelCount: number
        skippedMissingImageCount: number
        submittedTaskCount: number
        completedTaskCount: number
        failedTaskCount: number
        hasVideos: boolean
        taskIds: string[]
      }>
    }
    const result = await orchestrator.executeVideoGenerationStage('project-1', 'episode-1', {
      userId: 'user-1',
      locale: 'zh',
      userInput: 'Agent Seedance 直出视频测试',
    })

    expect(submitTaskMock).toHaveBeenCalledTimes(2)
    expect(submitTaskMock.mock.calls.map((call) => call[0].targetId)).toEqual([
      'agent-panel-1',
      'agent-panel-2',
    ])
    expect(submitTaskMock.mock.calls.map((call) => call[0].payload.videoModel)).toEqual([
      'ark::doubao-seedance-2-0-260128',
      'ark::doubao-seedance-2-0-260128',
    ])
    expect(result).toMatchObject({
      panelCount: 2,
      skippedMissingImageCount: 0,
      submittedTaskCount: 2,
      completedTaskCount: 2,
      failedTaskCount: 0,
      hasVideos: true,
      taskIds: ['task-video-panel-1', 'task-video-panel-2'],
    })
  })

  it('does not truncate Agent timed panels when enforcing storyboard budget', async () => {
    const agentPanels = [
      { id: 'agent-panel-1', panelIndex: 0, videoPrompt: preciseAgentPanelPrompt('建立场景') },
      { id: 'agent-panel-2', panelIndex: 1, videoPrompt: preciseAgentPanelPrompt('角色说话') },
      { id: 'agent-panel-3', panelIndex: 2, videoPrompt: preciseAgentPanelPrompt('特写反应') },
      { id: 'agent-panel-4', panelIndex: 3, videoPrompt: preciseAgentPanelPrompt('转场收束') },
    ]
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValueOnce([
      { id: 'storyboard-agent-1', panels: agentPanels },
    ])

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator() as unknown as {
      enforceStoryboardBudget: (episodeId: string, panelsPerShot: number | undefined) => Promise<void>
    }
    await orchestrator.enforceStoryboardBudget('episode-1', 2)

    expect(prismaMock.novelPromotionPanel.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionStoryboard.update).not.toHaveBeenCalled()
  })

  it('still truncates ordinary storyboard panels to the requested budget', async () => {
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValueOnce([
      {
        id: 'storyboard-normal-1',
        panels: [
          { id: 'normal-panel-1', panelIndex: 0, videoPrompt: '普通分镜 1' },
          { id: 'normal-panel-2', panelIndex: 1, videoPrompt: '普通分镜 2' },
          { id: 'normal-panel-3', panelIndex: 2, videoPrompt: '普通分镜 3' },
        ],
      },
    ])

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator() as unknown as {
      enforceStoryboardBudget: (episodeId: string, panelsPerShot: number | undefined) => Promise<void>
    }
    await orchestrator.enforceStoryboardBudget('episode-1', 2)

    expect(prismaMock.novelPromotionPanel.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['normal-panel-3'] } },
    })
    expect(prismaMock.novelPromotionStoryboard.update).toHaveBeenCalledWith({
      where: { id: 'storyboard-normal-1' },
      data: { panelCount: 2 },
    })
  })

  it('can execute into an existing target project instead of creating a new project', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'target-project-1',
      name: '首页创建的项目',
      novelPromotionData: { id: 'target-novel-project-1' },
    })
    prismaMock.novelPromotionProject.update.mockResolvedValue({ id: 'target-novel-project-1' })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'target-episode-1',
      episodeNumber: 1,
      novelText: '',
      clips: [],
      storyboards: [],
    })
    prismaMock.novelPromotionEpisode.update.mockResolvedValue({ id: 'target-episode-1' })

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个商品宣传短片：一个带着狗狗图案的布包。',
      executionMode: 'mock',
    })

    const result = await orchestrator.executePlan(plan, {
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个商品宣传短片：一个带着狗狗图案的布包。',
      executionMode: 'mock',
      targetProjectId: 'target-project-1',
    })

    expect(prismaMock.project.create).not.toHaveBeenCalled()
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'target-project-1',
        userId: 'user-1',
      },
      include: {
        novelPromotionData: true,
      },
    })
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'target-project-1' },
      data: expect.objectContaining({
        description: 'Created by Super Agent (mock)',
      }),
    })
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'target-novel-project-1' },
      data: expect.objectContaining({
        workflowMode: 'agent',
        importStatus: 'completed',
      }),
    })
    expect(prismaMock.novelPromotionEpisode.create).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledWith({
      where: { id: 'target-episode-1' },
      data: expect.objectContaining({
        novelText: expect.stringContaining('狗狗图案'),
      }),
    })
    expect(result).toMatchObject({
      projectId: 'target-project-1',
      episodeId: 'target-episode-1',
      workspaceUrl: '/zh/workspace/target-project-1?episode=target-episode-1&stage=videos',
    })
    expect(workflowStoreMock.startAgentWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'target-project-1',
      episodeId: null,
      targetId: 'target-project-1',
    }))
  })

  it('creates the next episode number when the existing target project already has story content', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'target-project-1',
      name: '已有内容项目',
      novelPromotionData: { id: 'target-novel-project-1' },
    })
    prismaMock.novelPromotionProject.update.mockResolvedValue({ id: 'target-novel-project-1' })
    prismaMock.novelPromotionEpisode.findFirst
      .mockResolvedValueOnce({
        id: 'target-episode-1',
        episodeNumber: 1,
        novelText: '已有故事内容',
        clips: [{ id: 'existing-clip-1' }],
        storyboards: [],
      })
      .mockResolvedValueOnce({
        id: 'target-episode-3',
        episodeNumber: 3,
      })
    prismaMock.novelPromotionEpisode.create.mockResolvedValueOnce({ id: 'target-episode-4' })

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput: '生成一个森林小兔子的温馨动画故事。',
      executionMode: 'mock',
    })

    const result = await orchestrator.executePlan(plan, {
      userId: 'user-1',
      locale: 'zh',
      userInput: '生成一个森林小兔子的温馨动画故事。',
      executionMode: 'mock',
      targetProjectId: 'target-project-1',
    })

    expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'target-episode-1' },
    }))
    expect(prismaMock.novelPromotionEpisode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        novelPromotionProjectId: 'target-novel-project-1',
        episodeNumber: 4,
        name: plan.episodeConfig.name,
        novelText: plan.episodeConfig.novelText,
      }),
    })
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'target-novel-project-1' },
      data: { lastEpisodeId: 'target-episode-4' },
    })
    expect(result).toMatchObject({
      projectId: 'target-project-1',
      episodeId: 'target-episode-4',
      workspaceUrl: '/zh/workspace/target-project-1?episode=target-episode-4&stage=videos',
    })
  })
})
