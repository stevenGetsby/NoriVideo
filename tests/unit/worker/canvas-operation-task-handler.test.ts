import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasPlaylistFingerprint } from '@/lib/canvas/playlist'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  canvasNode: {
    findFirst: vi.fn(async (): Promise<{ id: string; data?: unknown }> => ({ id: 'node-1' })),
    update: vi.fn(async () => ({ id: 'node-1' })),
  },
  user: { findUnique: vi.fn(async () => ({ name: '测试用户' })) },
}))
const imageOperationsMock = vi.hoisted(() => ({
  upscaleCanvasImage: vi.fn(async () => ({ body: Buffer.from('image-output'), width: 200, height: 120, row: 0, col: 0 })),
}))
const videoOperationsMock = vi.hoisted(() => ({
  trimCanvasVideo: vi.fn(async () => ({ body: Buffer.from('trimmed'), width: 1280, height: 720, duration: 5, fps: 24 })),
  enhanceCanvasVideo: vi.fn(async (_input: Buffer, _options: unknown, hooks?: { onProgress?: (value: number) => Promise<void> }) => {
    await hooks?.onProgress?.(0.5)
    return { body: Buffer.from('video-output'), width: 1920, height: 1080, duration: 6, fps: 30 }
  }),
  eraseCanvasVideoRegion: vi.fn(async () => ({ body: Buffer.from('erase-output'), width: 1080, height: 1920, duration: 5, fps: 25 })),
  renderCanvasPlaylistVideo: vi.fn(async () => ({ body: Buffer.from('playlist-output'), width: 1920, height: 1080, duration: 3, fps: 30 })),
}))
const storageMock = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(async () => Buffer.from('source')),
  uploadObject: vi.fn(async () => undefined),
  extractStorageKey: vi.fn((value: string) => value),
  getSignedUrl: vi.fn((value: string) => `https://media.example/${value}`),
  getSignedObjectUrl: vi.fn(async (value: string) => `https://media.example/${value}`),
}))
const materialMock = vi.hoisted(() => ({
  registerFrameosMaterial: vi.fn(async (input: Record<string, unknown>) => ({
    id: input.type === 'image' ? 'material-image-1' : 'material-video-1',
    title: input.title,
    resultUrl: input.storageKey,
    storageKey: input.storageKey,
  })),
}))
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => undefined))
const externalMock = vi.hoisted(() => ({
  getTaskExistingExternalId: vi.fn<() => Promise<string | null>>(async () => null),
  waitExternalResult: vi.fn(async () => ({
    url: 'https://result.test/edited.mp4', durationSeconds: 6.25, resolution: '720p',
    actualVideoTokens: 120000, fps: 24,
  })),
  generateKuaiziVideo: vi.fn(async () => ({ success: true, externalId: 'KUAIZI:VIDEO:new-task' })),
}))
const materializeResultMock = vi.hoisted(() => vi.fn(async (input: { taskId: string }) => ({
  materialized: true,
  outputNodeId: `output-${input.taskId}`,
  canvasRevision: 2,
  reason: 'created',
})))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/canvas/image-operations', () => imageOperationsMock)
vi.mock('@/lib/canvas/video-operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/canvas/video-operations')>()),
  ...videoOperationsMock,
}))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/frameos/material-service', () => materialMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: assertTaskActiveMock, ...externalMock }))
vi.mock('@/lib/providers/kuaizi', () => ({ generateKuaiziVideo: externalMock.generateKuaiziVideo }))
vi.mock('@/lib/canvas/operation-output-nodes', () => ({
  materializeCanvasAsyncOperationResult: materializeResultMock,
}))

import {
  handleCanvasImageOperationTask,
  handleCanvasVideoOperationTask,
} from '@/lib/workers/handlers/canvas-operation-task-handler'

function job(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: type === TASK_TYPE.CANVAS_IMAGE_OPERATION ? 'task-image' : 'task-video',
      type,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'CanvasNode',
      targetId: 'node-1',
      payload: {
        canvasId: 'canvas-1',
        sourceNodeId: 'node-1',
        sourceStorageKey: type === TASK_TYPE.CANVAS_IMAGE_OPERATION ? 'images/source.jpg' : 'video/source.mp4',
        sourceTitle: type === TASK_TYPE.CANVAS_IMAGE_OPERATION ? '源图' : '源视频',
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('canvas operation task handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.canvasNode.findFirst.mockResolvedValue({ id: 'node-1' })
    externalMock.getTaskExistingExternalId.mockResolvedValue(null)
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])('video edit returns actual output duration and resumes without resubmission (resume=%s)', async (resume) => {
    if (resume) externalMock.getTaskExistingExternalId.mockResolvedValue('KUAIZI:VIDEO:existing-task')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('edited-video')))
    const result = await handleCanvasVideoOperationTask(job(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      operation: 'video_edit', engineKey: 'kuaizi-seedance25', modelKey: 'doubao-seedance-2-5-260628',
      parameters: { startMs: 0, endMs: 5000, prompt: 'change color', generateAudio: false },
    }))
    expect(result).toMatchObject({ durationSeconds: 6.25, resolution: '720p', actualVideoTokens: 120000 })
    expect(externalMock.generateKuaiziVideo).toHaveBeenCalledTimes(resume ? 0 : 1)
    expect(externalMock.waitExternalResult).toHaveBeenCalledWith(expect.anything(),
      resume ? 'KUAIZI:VIDEO:existing-task' : 'KUAIZI:VIDEO:new-task', 'user-1', expect.anything())
  })

  it('executes image superresolve and persists an idempotent task-keyed material', async () => {
    const taskJob = job(TASK_TYPE.CANVAS_IMAGE_OPERATION, {
      operation: 'superresolve',
      engineKey: 'local-sharp',
      modelKey: 'local-sharp',
      parameters: { scale: 2 },
    })
    const result = await handleCanvasImageOperationTask(taskJob)

    expect(imageOperationsMock.upscaleCanvasImage).toHaveBeenCalledWith(Buffer.from('source'), 2)
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      Buffer.from('image-output'),
      'canvas-operations/user-1/task-image.jpg',
      undefined,
      'image/jpeg',
    )
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      type: 'image',
      storageKey: 'canvas-operations/user-1/task-image.jpg',
      metadata: expect.objectContaining({ engineKey: 'local-sharp', taskId: 'task-image' }),
    }))
    expect(result).toMatchObject({
      operation: 'superresolve',
      engineKey: 'local-sharp',
      results: [{ materialId: 'material-image-1', width: 200, height: 120 }],
      materialization: { materialized: true, outputNodeId: 'output-task-image' },
    })
    expect(materializeResultMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-image',
      canvasId: 'canvas-1',
      sourceNodeId: 'node-1',
      operation: 'superresolve',
      result: expect.objectContaining({ materialId: 'material-image-1' }),
    }))
  })

  it('executes video enhancement with progress and cancellation hooks', async () => {
    const taskJob = job(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      operation: 'video_superresolve',
      engineKey: 'local-ffmpeg',
      modelKey: 'local-ffmpeg',
      parameters: { target: '1080p', interpolate: true },
    })
    const result = await handleCanvasVideoOperationTask(taskJob)

    expect(videoOperationsMock.enhanceCanvasVideo).toHaveBeenCalledWith(
      Buffer.from('source'),
      { target: '1080p', interpolate: true },
      expect.objectContaining({ assertActive: expect.any(Function), onProgress: expect.any(Function) }),
    )
    expect(reportTaskProgressMock).toHaveBeenCalledWith(taskJob, 55, expect.objectContaining({
      stage: 'canvas_operation_process',
    }))
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      Buffer.from('video-output'),
      'canvas-operations/user-1/task-video.mp4',
      undefined,
      'video/mp4',
    )
    expect(result).toMatchObject({
      operation: 'video_superresolve',
      modelKey: 'local-ffmpeg',
      results: [{ materialId: 'material-video-1', duration: 6, fps: 30 }],
      materialization: { materialized: true, outputNodeId: 'output-task-video' },
    })
  })

  it('passes the normalized erase region to the local ffmpeg engine', async () => {
    const taskJob = job(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      operation: 'subtitle_erase',
      engineKey: 'local-ffmpeg',
      modelKey: 'local-ffmpeg',
      parameters: { mode: 'subtitle', region: { x: 0.1, y: 0.5, width: 0.8, height: 0.2 } },
    })
    await handleCanvasVideoOperationTask(taskJob)
    expect(videoOperationsMock.eraseCanvasVideoRegion).toHaveBeenCalledWith(
      Buffer.from('source'),
      { x: 0.1, y: 0.5, width: 0.8, height: 0.2 },
      'subtitle',
      expect.objectContaining({ assertActive: expect.any(Function) }),
    )
  })

  it('renders a playlist MP4 and writes it back only for the matching edit fingerprint', async () => {
    const playlistItems = [
      { id: 'clip-a', materialId: 'material-a', title: 'A', sourceInMs: 500, sourceOutMs: 1_500, durationMs: 2_000 },
      { id: 'clip-b', materialId: 'material-b', title: 'B', sourceInMs: 0, sourceOutMs: 2_000, durationMs: 2_000 },
    ]
    const fingerprint = canvasPlaylistFingerprint(playlistItems)
    prismaMock.canvasNode.findFirst.mockResolvedValueOnce({ id: 'node-1', data: { playlistItems } })
    const taskJob = job(TASK_TYPE.CANVAS_VIDEO_OPERATION, {
      kind: 'canvas_playlist_render',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      title: '第一集终剪',
      fingerprint,
      durationMs: 3_000,
      segments: [
        { clipId: 'clip-a', title: 'A', storageKey: 'video/a.mp4', trimStartMs: 500, trimEndMs: 1_500 },
        { clipId: 'clip-b', title: 'B', storageKey: 'video/b.mp4', trimStartMs: 0, trimEndMs: 2_000 },
      ],
    })

    const result = await handleCanvasVideoOperationTask(taskJob)

    expect(storageMock.getObjectBuffer).toHaveBeenCalledTimes(2)
    expect(videoOperationsMock.renderCanvasPlaylistVideo).toHaveBeenCalledWith([
      { body: Buffer.from('source'), trimStartMs: 500, trimEndMs: 1_500 },
      { body: Buffer.from('source'), trimStartMs: 0, trimEndMs: 2_000 },
    ], expect.objectContaining({ assertActive: expect.any(Function), onProgress: expect.any(Function) }))
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      Buffer.from('playlist-output'),
      'canvas-playlists/user-1/task-video.mp4',
      undefined,
      'video/mp4',
    )
    expect(prismaMock.canvasNode.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'node-1' },
      data: expect.objectContaining({ status: 'SUCCEEDED', mediaObjectId: 'material-video-1' }),
    }))
    expect(result).toMatchObject({
      kind: 'canvas_playlist_render',
      fingerprint,
      materialId: 'material-video-1',
      durationMs: 3_000,
      stale: false,
    })
  })
})
