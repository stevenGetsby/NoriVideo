import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
  },
}))

const taskServiceMock = vi.hoisted(() => ({
  isTaskActive: vi.fn(async () => true),
  trySetTaskExternalId: vi.fn(async () => true),
}))

const asyncPollMock = vi.hoisted(() => ({
  pollAsyncTask: vi.fn(),
}))

const generatorApiMock = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/async-poll', () => asyncPollMock)
vi.mock('@/lib/generator-api', () => generatorApiMock)
vi.mock('@/lib/lipsync', () => ({ generateLipSync: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((value: string) => value),
  toFetchableUrl: vi.fn((value: string) => value),
}))
vi.mock('@/lib/fonts', () => ({ initializeFonts: vi.fn(), createLabelSVG: vi.fn() }))
vi.mock('@/lib/media-process', () => ({ processMediaResult: vi.fn() }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(),
}))

import { resolveImageSourceFromGeneration, resolveVideoSourceFromGeneration } from '@/lib/workers/utils'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: 'VIDEO_PANEL',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker utils video generation resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('continues polling from existing externalId without re-submitting generation', async () => {
    const externalId = 'OPENAI:VIDEO:b3BlbmFpLWNvbXBhdGlibGU6b2EtMQ:vid_123'
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId })
    asyncPollMock.pollAsyncTask.mockResolvedValueOnce({
      status: 'completed',
      resultUrl: 'https://oa.test/v1/videos/vid_123/content',
      durationSeconds: 6.25,
      resolution: '480p',
      lastFrameUrl: 'https://oa.test/last.png',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'openai-compatible:oa-1::sora-2',
      imageUrl: 'data:image/png;base64,QQ==',
      options: {
        prompt: 'animate this frame',
      },
    })

    expect(result).toEqual({
      url: 'https://oa.test/v1/videos/vid_123/content',
      durationSeconds: 6.25,
      resolution: '480p',
      lastFrameUrl: 'https://oa.test/last.png',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })
    expect(asyncPollMock.pollAsyncTask).toHaveBeenCalledWith(externalId, 'user-1', expect.any(AbortSignal))
    expect(generatorApiMock.generateVideo).not.toHaveBeenCalled()
  })

  it('times out a hung status query and resumes polling without resubmitting', async () => {
    vi.useFakeTimers()
    try {
      const externalId = 'KUAIZI:VIDEO:provider-token:model-token:task-1'
      prismaMock.task.findUnique.mockResolvedValueOnce({ externalId })
      const signals: AbortSignal[] = []
      asyncPollMock.pollAsyncTask
        .mockImplementationOnce((_externalId: string, _userId: string, signal: AbortSignal) => {
          signals.push(signal)
          return new Promise(() => undefined)
        })
        .mockResolvedValueOnce({
          status: 'completed',
          resultUrl: 'https://provider.example/video.mp4',
        })

      const resultPromise = resolveVideoSourceFromGeneration(buildJob(), {
        userId: 'user-1',
        modelId: 'kuaizi::doubao-seedance-2-5-260628',
        imageUrl: 'data:image/png;base64,QQ==',
      })
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(3_000)

      await expect(resultPromise).resolves.toEqual({ url: 'https://provider.example/video.mp4' })
      expect(signals[0].aborted).toBe(true)
      expect(asyncPollMock.pollAsyncTask).toHaveBeenCalledTimes(2)
      expect(generatorApiMock.generateVideo).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('prevents duplicate panel candidates by skipping task externalId resume when requested', async () => {
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId: 'FAL:IMAGE:fal-ai/nano-banana-pro:req_1' })
    generatorApiMock.generateImage.mockResolvedValueOnce({
      success: true,
      imageUrl: 'https://fal.test/new-image.png',
      requestId: 'image-request-1',
    })

    const result = await resolveImageSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'fal::banana',
      prompt: 'a cinematic portrait',
      options: {
        aspectRatio: '16:9',
      },
      allowTaskExternalIdResume: false,
    })

    expect(result).toBe('https://fal.test/new-image.png')
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
    expect(asyncPollMock.pollAsyncTask).not.toHaveBeenCalled()
    expect(generatorApiMock.generateImage).toHaveBeenCalledTimes(1)
    expect(taskServiceMock.trySetTaskExternalId).toHaveBeenCalledWith('task-1', 'image-request-1')
  })
})
