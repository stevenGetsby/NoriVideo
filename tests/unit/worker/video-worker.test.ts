import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

type PanelRow = {
  id: string
  videoUrl: string | null
  imageUrl: string | null
  imageMediaId: string | null
  videoPrompt: string | null
  description: string | null
  firstLastFramePrompt: string | null
  srtSegment?: string | null
  shotType?: string | null
  cameraMove?: string | null
  duration: number | null
}

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const withTaskLifecycleMock = vi.hoisted(() =>
  vi.fn(async (job: Job<TaskJobData>, handler: WorkerProcessor) => await handler(job)),
)

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9' })),
  resolveLipSyncVideoSource: vi.fn(async () => 'https://provider.example/lipsync.mp4'),
  resolveVideoSourceFromGeneration: vi.fn<(...args: unknown[]) => Promise<{ url: string; actualVideoTokens?: number; downloadHeaders?: Record<string, string> }>>(async () => ({ url: 'https://provider.example/video.mp4' })),
  toSignedUrlIfCos: vi.fn((url: string | null) => (url ? `https://signed.example/${url}` : null)),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/lip-sync/video.mp4'),
  waitExternalResult: vi.fn(async () => ({ url: 'https://provider.example/fallback-video.mp4', actualVideoTokens: 88000 })),
}))
const arkApiMock = vi.hoisted(() => ({
  arkCreateVideoTask: vi.fn(async () => ({ id: 'ark-fallback-task-1' })),
}))
const configServiceMock = vi.hoisted(() => ({
  getUserWorkflowConcurrencyConfig: vi.fn(async () => ({
    analysis: 5,
    image: 5,
    video: 5,
  })),
}))
const concurrencyGateMock = vi.hoisted(() => ({
  withUserConcurrencyGate: vi.fn(async <T>(input: {
    run: () => Promise<T>
  }) => await input.run()),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  novelPromotionVoiceLine: {
    findUnique: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      void name
    }

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(name: string, processor: WorkerProcessor) {
      void name
      workerState.processor = processor
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: withTaskLifecycleMock,
}))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => input),
}))
const mediaServiceMock = vi.hoisted(() => ({
  resolveMediaRef: vi.fn(async (mediaId: unknown, legacyValue: unknown) => {
    if (typeof mediaId === 'string' && mediaId) {
      return {
        id: mediaId,
        publicId: 'media-panel-image',
        url: '/m/media-panel-image',
        mimeType: 'image/png',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: null,
        sha256: null,
        updatedAt: null,
        storageKey: 'images/media-panel-image.png',
      }
    }
    if (typeof legacyValue === 'string' && legacyValue) {
      return {
        id: 'legacy-media',
        publicId: 'legacy-media',
        url: legacyValue,
        mimeType: 'image/png',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: null,
        sha256: null,
        updatedAt: null,
        storageKey: legacyValue,
      }
    }
    return null
  }),
  mediaUrlFromRef: vi.fn((ref: { url?: string } | null | undefined, fallback: string | null | undefined) => ref?.url || fallback || null),
}))
vi.mock('@/lib/media/service', () => mediaServiceMock)
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-config-contract', () => ({
  parseModelKeyStrict: vi.fn(() => ({ provider: 'fal' })),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'api-key' })),
}))
vi.mock('@/lib/ark-api', () => arkApiMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/workers/user-concurrency-gate', () => concurrencyGateMock)

function buildPanel(overrides?: Partial<PanelRow>): PanelRow {
  return {
    id: 'panel-1',
    videoUrl: 'cos/base-video.mp4',
    imageUrl: 'cos/panel-image.png',
    imageMediaId: null,
    videoPrompt: 'panel prompt',
    description: 'panel description',
    firstLastFramePrompt: null,
    duration: 5,
    ...(overrides || {}),
  }
}

function buildJob(params: {
  type: TaskJobData['type']
  payload?: Record<string, unknown>
  targetType?: string
  targetId?: string
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: params.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: params.targetType ?? 'NovelPromotionPanel',
      targetId: params.targetId ?? 'panel-1',
      payload: params.payload ?? {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker video processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1',
      audioUrl: 'cos/line-1.mp3',
      audioDuration: 1200,
    })

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_PANEL: 缺少 payload.videoModel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {},
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  })

  it('VIDEO_PANEL: 透传异步轮询返回的下载头到 COS 上传', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/video.mp4',
      'panel-video',
      'panel-1',
      {
        Authorization: 'Bearer oa-key',
      },
    )
  })

  it('VIDEO_PANEL: 将 Ark 返回的实际视频 token 用量透传到任务结果', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      actualVideoTokens: 108000,
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    const result = await processor!(job) as { panelId: string; videoUrl: string; actualVideoTokens: number }
    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/lip-sync/video.mp4',
      actualVideoTokens: 108000,
    })
  })

  it('VIDEO_PANEL: uses panel recommended duration instead of a fixed default payload duration', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      duration: 7,
      srtSegment: '小兔子说别怕，我来帮你，然后伸出树叶救起萤火虫。',
      videoPrompt: '小兔子伸出树叶救起萤火虫，镜头轻轻跟随',
    } as Partial<PanelRow>))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-1-0-pro-fast-251015',
        generationOptions: {
          duration: 2,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          duration: 7,
          resolution: '720p',
        }),
      }),
    )
  })

  it('VIDEO_PANEL: Agent no-music prompt forces Seedance generateAudio=false even when the payload requested audio', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      duration: 8,
      videoPrompt: '【Agent 视频分镜提示词】禁止生成背景音乐。Ava 英文口型同步说台词，Dr. Grayson 冷静回应。',
      srtSegment: 'Ava says: Please help me.',
    } as Partial<PanelRow>))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
          generateAudio: true,
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          duration: 8,
          resolution: '720p',
          generateAudio: false,
        }),
      }),
    )
  })

  it('VIDEO_PANEL: resolves imageMediaId when the legacy imageUrl field is empty', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      imageUrl: null,
      imageMediaId: 'media-panel-1',
      duration: 6,
    }))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(mediaServiceMock.resolveMediaRef).toHaveBeenCalledWith('media-panel-1', null)
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageUrl: 'https://signed.example//m/media-panel-image',
        options: expect.objectContaining({
          duration: 6,
          resolution: '720p',
        }),
      }),
    )
  })

  it('VIDEO_PANEL: Seedance can generate directly from video prompt and asset references without a panel image', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      imageUrl: null,
      imageMediaId: null,
      duration: 8,
      videoPrompt: '场景：现代美国私立医院。\n剧情片段：Ava 请求 Dr. Grayson 帮外婆安排手术。',
    }))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageUrl: '',
        options: expect.objectContaining({
          prompt: expect.stringContaining('Ava 请求 Dr. Grayson'),
          duration: 8,
          resolution: '720p',
          referenceImages: [],
        }),
      }),
    )
  })

  it('VIDEO_PANEL: falls back to Ark text-only generation when panel image is rejected by input-image moderation', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockRejectedValueOnce(
      new Error('InputImageSensitiveContentDetected.PrivacyInformation: input image may contain real person'),
    )
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      duration: 9,
      videoPrompt: '【Agent 视频分镜提示词】本分镜使用资产：角色=Ava；场景=现代美国私立医院。本 panel 动作/台词：0-9s：Ava 英文口型同步说台词。',
    }))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
          generateAudio: false,
        },
      },
    })

    const result = await processor!(job) as {
      panelId: string
      videoUrl: string
      fallbackMode: string
      actualVideoTokens: number
    }

    expect(arkApiMock.arkCreateVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'doubao-seedance-2-0-260128',
        content: [
          {
            type: 'text',
            text: expect.stringContaining('改用纯文本视频生成'),
          },
        ],
        resolution: '720p',
        ratio: '16:9',
        duration: 9,
        generate_audio: false,
      }),
      expect.objectContaining({
        apiKey: 'api-key',
      }),
    )
    const fallbackCalls = arkApiMock.arkCreateVideoTask.mock.calls as unknown as Array<[{
      content: Array<{ text?: string }>
    }]>
    const fallbackRequest = fallbackCalls[0]?.[0]
    expect(fallbackRequest?.content[0]?.text).toContain('本分镜使用资产：角色=Ava')
    expect(utilsMock.waitExternalResult).toHaveBeenCalledWith(
      expect.anything(),
      'ARK:VIDEO:ark-fallback-task-1',
      'user-1',
      expect.objectContaining({
        progressStart: 45,
        progressEnd: 94,
      }),
    )
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/fallback-video.mp4',
      'panel-video',
      'panel-1',
      undefined,
    )
    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/lip-sync/video.mp4',
      fallbackMode: 'ark_text_only_after_input_image_moderation',
      actualVideoTokens: 88000,
    })
  })

  it('LIP_SYNC: 缺少 panel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(null)
    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: { voiceLineId: 'line-1' },
      targetId: 'panel-missing',
    })

    await expect(processor!(job)).rejects.toThrow('Lip-sync panel not found')
  })

  it('LIP_SYNC: 正常路径写回 lipSyncVideoUrl 并清理 lipSyncTaskId', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: {
        voiceLineId: 'line-1',
        lipSyncModel: 'fal::lipsync-model',
      },
      targetId: 'panel-1',
    })

    const result = await processor!(job) as { panelId: string; voiceLineId: string; lipSyncVideoUrl: string }
    expect(result).toEqual({
      panelId: 'panel-1',
      voiceLineId: 'line-1',
      lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
    })

    expect(utilsMock.resolveLipSyncVideoSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        modelKey: 'fal::lipsync-model',
        audioDurationMs: 1200,
        videoDurationMs: 5000,
      }),
    )

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
        lipSyncTaskId: null,
      },
    })
  })

  it('未知任务类型: 显式报错', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('Unsupported video task type')
  })
})
