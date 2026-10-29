import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  frameosToolboxAsset: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}))
const providerMock = vi.hoisted(() => ({
  generateProviderAudio: vi.fn(),
}))
const persistMock = vi.hoisted(() => ({
  persistGeneratedAudio: vi.fn(async () => ({ storageKey: 'audio/result.mp3', durationSeconds: 12 })),
}))
const materialMock = vi.hoisted(() => ({
  registerFrameosMaterial: vi.fn(async (input: Record<string, unknown>) => ({ id: 'material-audio', metadata: input.metadata })),
}))
const bindingMock = vi.hoisted(() => ({
  projectCanvasToolboxTaskTerminal: vi.fn(async () => undefined),
}))
const workerUtilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getTaskExistingExternalId: vi.fn(async (): Promise<string | null> => null),
  waitExternalResult: vi.fn(async () => ({
    url: 'https://provider.example/audio.mp3',
    status: { status: 'completed', resultUrl: 'https://provider.example/audio.mp3' },
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/audio/provider', () => providerMock)
vi.mock('@/lib/audio/persist', () => persistMock)
vi.mock('@/lib/frameos/material-service', () => materialMock)
vi.mock('@/lib/canvas/toolbox-node-binding', () => bindingMock)
vi.mock('@/lib/workers/utils', () => workerUtilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))

import { handleToolboxAudioTask } from '@/lib/workers/handlers/toolbox-audio-task-handler'

function job(attemptsMade = 0): Job<TaskJobData> {
  return {
    attemptsMade,
    opts: { attempts: 5 },
    data: {
      taskId: 'task-audio',
      type: TASK_TYPE.TOOLBOX_AUDIO,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'FrameosToolboxAsset',
      targetId: 'asset-audio',
      userId: 'user-1',
      payload: {
        ownerName: '资产师甲',
        title: '雨夜氛围',
        prompt: 'dark rainy ambience',
        audioModel: 'nori::nori-audio',
        mode: 'tts',
        voice: 'kuaizi-voice:voice-1',
        duration: 12,
        genre: '电影配乐',
        canvasId: 'canvas-1',
        nodeId: 'node-audio',
      },
    },
  } as unknown as Job<TaskJobData>
}

describe('toolbox audio worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.frameosToolboxAsset.findFirst.mockResolvedValue({
      id: 'asset-audio',
      status: 'pending',
      resultUrl: null,
      materialId: null,
    })
    providerMock.generateProviderAudio.mockResolvedValue({
      kind: 'async',
      externalId: 'KUAIZI:AUDIO:kuaizi:speech-2.8-hd:req-1',
      requestId: 'req-1',
    })
  })

  it('rejects retired music tasks before submitting to a provider', async () => {
    const input = job()
    input.data.payload = { ...input.data.payload, audioModel: 'nori::nori-music', mode: 'music' }

    await expect(handleToolboxAudioTask(input)).rejects.toThrow('没有声明可执行的生成模式')
    expect(providerMock.generateProviderAudio).not.toHaveBeenCalled()
  })

  it('polls, persists, registers and projects a real async audio result', async () => {
    const result = await handleToolboxAudioTask(job())
    expect(providerMock.generateProviderAudio).toHaveBeenCalledOnce()
    expect(workerUtilsMock.waitExternalResult).toHaveBeenCalledWith(
      expect.anything(),
      'KUAIZI:AUDIO:kuaizi:speech-2.8-hd:req-1',
      'user-1',
      { progressStart: 20, progressEnd: 86 },
    )
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      ownerName: '资产师甲',
      type: 'audio',
      storageKey: 'audio/result.mp3',
      metadata: expect.objectContaining({ mode: 'tts' }),
    }))
    expect(bindingMock.projectCanvasToolboxTaskTerminal).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'ready',
      resultUrl: 'audio/result.mp3',
    }))
    expect(result).toMatchObject({ audioUrl: 'audio/result.mp3', actualDurationSeconds: 12 })
  })

  it('resumes an accepted provider request without submitting a duplicate', async () => {
    workerUtilsMock.getTaskExistingExternalId.mockResolvedValueOnce('KUAIZI:AUDIO:kuaizi:speech-2.8-hd:req-existing')
    await handleToolboxAudioTask(job())
    expect(providerMock.generateProviderAudio).not.toHaveBeenCalled()
    expect(workerUtilsMock.waitExternalResult).toHaveBeenCalledWith(
      expect.anything(),
      'KUAIZI:AUDIO:kuaizi:speech-2.8-hd:req-existing',
      'user-1',
      expect.anything(),
    )
  })

  it('keeps the canvas running for retryable attempts and only projects the final failure', async () => {
    providerMock.generateProviderAudio.mockRejectedValue(new TypeError('fetch failed'))
    await expect(handleToolboxAudioTask(job(0))).rejects.toThrow('fetch failed')
    expect(prismaMock.frameosToolboxAsset.update).toHaveBeenLastCalledWith({
      where: { id: 'asset-audio' },
      data: { status: 'processing', errorMessage: 'fetch failed' },
    })
    expect(bindingMock.projectCanvasToolboxTaskTerminal).not.toHaveBeenCalled()

    await expect(handleToolboxAudioTask(job(4))).rejects.toThrow('fetch failed')
    expect(prismaMock.frameosToolboxAsset.update).toHaveBeenLastCalledWith({
      where: { id: 'asset-audio' },
      data: { status: 'failed', errorMessage: 'fetch failed' },
    })
    expect(bindingMock.projectCanvasToolboxTaskTerminal).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }))
  })
})
