import { createHash } from 'crypto'
import { existsSync } from 'fs'
import os from 'os'
import path from 'path'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'
import type { StoryIssue, StorySceneNode } from '@/lib/interactive/types'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const sha1Id = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 16)
const VIDEO_ID = sha1Id('videos/a.mp4')
const POSTER_ID = sha1Id('images/a-poster.jpg')
const TMP_DIR = path.join(os.tmpdir(), 'mp-build', 'r1')

const loadStoryMock = vi.hoisted(() => vi.fn())
const preflightMock = vi.hoisted(() => vi.fn())
const processVideoMock = vi.hoisted(() => vi.fn())
const processImageMock = vi.hoisted(() => vi.fn())
const buildTrailerMock = vi.hoisted(() => vi.fn())
const reportProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertActiveMock = vi.hoisted(() => vi.fn(async () => undefined))
const sleepMock = vi.hoisted(() => vi.fn(async () => undefined))
const uploadObjectMock = vi.hoisted(() => vi.fn())
const getObjectBufferMock = vi.hoisted(() => vi.fn())
const loggerMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }))
const prismaMock = vi.hoisted(() => ({
  storyRelease: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  mpWork: { findUnique: vi.fn() },
}))
const redisMock = vi.hoisted(() => ({ set: vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => 'OK'), eval: vi.fn(async () => 1) }))
const requireCreditMock = vi.hoisted(() => vi.fn(async () => undefined))
const createTaskMock = vi.hoisted(() => vi.fn())
const markTaskFailedMock = vi.hoisted(() => vi.fn(async () => undefined))
const addTaskJobMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/storage', () => ({
  getObjectBuffer: getObjectBufferMock,
  uploadObject: uploadObjectMock,
  extractStorageKey: (input: string | null | undefined) => {
    if (!input) return null
    if (input.startsWith('/api/files/')) return decodeURIComponent(input.slice('/api/files/'.length))
    if (!input.startsWith('http') && !input.startsWith('/')) return input
    try {
      return new URL(input).pathname.replace(/^\/+/, '') || null
    } catch {
      return null
    }
  },
}))
const mediaByPublicIdMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/media/service', () => ({ getMediaObjectByPublicId: mediaByPublicIdMock }))
vi.mock('@/lib/interactive/service', () => ({ loadStoryForRelease: loadStoryMock }))
vi.mock('@/lib/mp/release/preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mp/release/preflight')>()),
  preflightRelease: preflightMock,
}))
vi.mock('@/lib/mp/release/transcode', () => ({
  processVideo: processVideoMock,
  processImage: processImageMock,
  withAigcExif: vi.fn(async (buffer: Buffer) => buffer),
}))
vi.mock('@/lib/mp/release/trailer', () => ({ buildTrailer: buildTrailerMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportProgressMock }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: assertActiveMock, sleep: sleepMock }))
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: () => loggerMock }))
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => null),
  requireGenerationCredit: requireCreditMock,
  requiresTaskBilling: vi.fn(() => false),
  getBillingMode: vi.fn(async () => 'ENFORCE'),
  prepareTaskBilling: vi.fn(),
  InsufficientBalanceError: class extends Error {},
  DailyLimitExceededError: class extends Error {},
}))
vi.mock('@/lib/task/service', () => ({
  createTask: createTaskMock,
  getTaskById: vi.fn(async () => null),
  markTaskEnqueued: vi.fn(async () => undefined),
  markTaskFailed: markTaskFailedMock,
  markTaskEnqueueFailed: vi.fn(async () => undefined),
  rollbackTaskBillingForTask: vi.fn(async () => ({ attempted: false, rolledBack: false })),
  updateTaskBillingInfo: vi.fn(async () => undefined),
  updateTaskPayload: vi.fn(async () => undefined),
}))
vi.mock('@/lib/task/queues', () => ({ addTaskJob: addTaskJobMock }))
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/run-runtime/service', () => ({
  attachTaskToRun: vi.fn(async () => undefined),
  createRun: vi.fn(async () => ({ id: 'run1' })),
  findReusableActiveRun: vi.fn(async () => null),
}))
vi.mock('@/lib/run-runtime/workflow', () => ({
  isAiTaskType: vi.fn((type: string) => type === 'image_panel'),
  workflowTypeFromTaskType: vi.fn(() => 'image'),
}))
vi.mock('@/lib/llm-observe/stage-pipeline', () => ({
  getTaskFlowMeta: vi.fn(() => ({ flowId: 'flow', flowStageTitle: '阶段', flowStageIndex: 1, flowStageTotal: 1 })),
}))
vi.mock('@/lib/workspace/workflow-stage-state-store', () => ({
  invalidateDownstreamWorkflowStagesForTask: vi.fn(async () => ({ staleStages: [] })),
}))
vi.mock('@/lib/account/request-context', () => ({
  buildTrustedTaskQuotaMeta: vi.fn((_userId: string, meta: Record<string, unknown>) => meta),
}))

import { handleStoryReleaseBuildTask } from '@/lib/mp/release/build'
import { submitTask } from '@/lib/task/submitter'

const SYNOPSIS = '这是一个足够长的详细介绍内容'

function storyData() {
  return {
    story: {
      workId: 'w1',
      name: '雨夜',
      aspectRatio: '9:16',
      resolution: '1080p',
      config: {
        version: 1 as const,
        variables: [],
        chapters: [{ projectId: 'p1', order: 0, position: { x: 0, y: 0 }, status: 'final' as const }],
        links: [],
        start: { projectId: 'p1', entryNodeId: 'e1' },
        sequence: null,
      },
    },
    chapters: [{
      projectId: 'p1',
      name: '雨夜',
      canvasId: 'cv1',
      nodeCount: 3,
      runningCount: 0,
      updatedAt: '2026-11-16T00:00:00.000Z',
      graph: {
        projectId: 'p1',
        title: '雨夜',
        nodes: [
          { id: 'e1', kind: 'entry' as const, title: '入口' },
          {
            id: 's1', kind: 'scene' as const, title: '巷口', lines: '雨夜。', effects: [], beats: [],
            media: { kind: 'video' as const, url: 'videos/a.mp4', posterUrl: 'images/a-poster.jpg', durationSec: 10 },
          },
          { id: 'end1', kind: 'ending' as const, title: '结局', endingType: 'good' as const, description: '雨停了。' },
        ],
        flows: [
          { id: 'f1', from: 'e1', handle: 'next', to: 's1' },
          { id: 'f2', from: 's1', handle: 'next', to: 'end1' },
        ],
      },
    }],
  }
}

const sceneOf = (data: ReturnType<typeof storyData>) => data.chapters[0].graph.nodes[1] as StorySceneNode

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'Ab12Cd34',
    status: 'draft',
    title: '雨夜',
    tagline: '一句话勾住观众',
    synopsis: SYNOPSIS,
    tags: ['悬疑'],
    creatorName: '蓝喵工作室',
    coverKey: null,
    shareCoverKey: null,
    trailerEnabled: false,
    reservable: true,
    scheduledAt: null,
    firstLiveAt: null,
    bannedReason: null,
    ...overrides,
  }
}

const releaseRow = (overrides: Record<string, unknown> = {}) => ({ id: 'r1', workId: 'w1', status: 'building', version: 1, pipelineVersion: 1, ...overrides })
const job = { id: 'j1', data: { taskId: 't1', projectId: 'p1', payload: { releaseId: 'r1' } } } as unknown as Job<TaskJobData>

const videoResult = () => ({
  files: {
    v720: `mp/releases/r1/m/${VIDEO_ID}/720.mp4`,
    v480: `mp/releases/r1/m/${VIDEO_ID}/480.mp4`,
    poster: `mp/releases/r1/m/${VIDEO_ID}/poster.jpg`,
    last: `mp/releases/r1/m/${VIDEO_ID}/last.jpg`,
    sheet: `mp/releases/r1/m/${VIDEO_ID}/sheet.jpg`,
  },
  w: 720, h: 1280, durationSec: 10, hasAudio: true, bytes: 1000,
})
const imageResult = () => ({ files: { img: `mp/releases/r1/m/${POSTER_ID}/img.jpg` }, w: 100, h: 100, bytes: 500 })

const finalUpdate = () => {
  const call = prismaMock.storyRelease.update.mock.calls.find((args) => args[0]?.data?.status === 'reviewing')
  return call?.[0]?.data
}
const failedUpdate = () => {
  const call = prismaMock.storyRelease.update.mock.calls.find((args) => args[0]?.data?.status === 'build_failed')
  return call?.[0]?.data
}
const uploadedKeys = () => uploadObjectMock.mock.calls.map((call) => call[1])
const programBody = () => {
  const call = uploadObjectMock.mock.calls.find((args) => args[1] === 'mp/releases/r1/program.json')
  return (call?.[0] as Buffer).toString()
}

let jpegBuffer: Buffer
let nowSpy: { mockRestore: () => void } | null = null

beforeAll(async () => {
  jpegBuffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 100, g: 150, b: 200 } } }).jpeg().toBuffer()
})

beforeEach(() => {
  vi.clearAllMocks()
  loadStoryMock.mockResolvedValue(storyData())
  preflightMock.mockResolvedValue({ issues: [], errors: 0, warnings: 0 })
  prismaMock.storyRelease.findUnique.mockResolvedValue(releaseRow())
  prismaMock.storyRelease.findMany.mockResolvedValue([])
  prismaMock.storyRelease.update.mockImplementation(async () => ({}))
  prismaMock.mpWork.findUnique.mockResolvedValue(listingRow())
  redisMock.set.mockResolvedValue('OK')
  mediaByPublicIdMock.mockResolvedValue(null)
  processVideoMock.mockImplementation(async () => videoResult())
  processImageMock.mockImplementation(async () => imageResult())
  buildTrailerMock.mockResolvedValue(null)
  getObjectBufferMock.mockResolvedValue(jpegBuffer)
  uploadObjectMock.mockImplementation(async () => undefined)
})

afterEach(() => {
  nowSpy?.mockRestore()
  nowSpy = null
  vi.unstubAllGlobals()
})

describe('handleStoryReleaseBuildTask', () => {
  it('runs the pipeline in order and writes the release exactly once', async () => {
    const steps: string[] = []
    loadStoryMock.mockImplementation(async () => { steps.push('load'); return storyData() })
    preflightMock.mockImplementation(async () => { steps.push('preflight'); return { issues: [], errors: 0, warnings: 0 } })
    processVideoMock.mockImplementation(async () => { steps.push('video'); return videoResult() })
    processImageMock.mockImplementation(async () => { steps.push('image'); return imageResult() })
    prismaMock.mpWork.findUnique.mockImplementation(async () => { steps.push('listing'); return listingRow() })
    uploadObjectMock.mockImplementation(async (_buffer: Buffer, key: string) => { steps.push(`upload:${key}`) })
    prismaMock.storyRelease.update.mockImplementation(async (args: { data: { status: string } }) => { steps.push(`update:${args.data.status}`); return {} })

    const result = await handleStoryReleaseBuildTask(job)
    expect(result).toEqual({ releaseId: 'r1', status: 'reviewing' })
    expect(preflightMock).toHaveBeenCalledWith('w1', 'r1')
    expect(steps).toEqual([
      'load',
      'preflight',
      'video',
      'image',
      'listing',
      'upload:mp/releases/r1/cover.jpg',
      'upload:mp/releases/r1/share.jpg',
      'upload:mp/releases/r1/program.json',
      'update:reviewing',
    ])
    expect(reportProgressMock).toHaveBeenCalledWith(job, 2, { stage: 'mp_release_load', message: '读取作品内容' })
    expect(reportProgressMock).toHaveBeenCalledWith(job, 5, { stage: 'mp_release_media', message: '处理素材 1/2' })
    expect(reportProgressMock).toHaveBeenCalledWith(job, 45, { stage: 'mp_release_media', message: '处理素材 2/2' })
    expect(reportProgressMock).toHaveBeenCalledWith(job, 86, { stage: 'mp_release_listing', message: '生成上架素材' })
    expect(reportProgressMock).toHaveBeenCalledWith(job, 92, { stage: 'mp_release_program', message: '写入版本文件' })

    expect(prismaMock.storyRelease.update).toHaveBeenCalledTimes(1)
    const data = finalUpdate()
    expect(data).toMatchObject({
      status: 'reviewing', progress: 100, failure: null, issues: [],
      chapterCount: 1, endingCount: 1, totalDurationSec: 10,
      programKey: 'mp/releases/r1/program.json',
    })
    expect(data.program.chapters[0].nodes[1].media.url).toBe(`mp:${VIDEO_ID}`)
    expect(data.program.chapters[0].nodes[1].media.posterUrl).toBe(`mp:${POSTER_ID}`)
    expect(data.manifest.pipelineVersion).toBe(1)
    expect(data.manifest.media[VIDEO_ID]).toEqual({
      id: VIDEO_ID, kind: 'video', source: 'videos/a.mp4', w: 720, h: 1280, durationSec: 10, hasAudio: true,
      bytes: 1000, files: videoResult().files, refs: ['/chapters/0/nodes/1/media/url'],
    })
    expect(data.manifest.media[POSTER_ID]).toMatchObject({ kind: 'image', source: 'images/a-poster.jpg', refs: ['/chapters/0/nodes/1/media/posterUrl'] })
    expect(data.meta).toMatchObject({
      title: '雨夜',
      tagline: '一句话勾住观众',
      synopsis: SYNOPSIS,
      tags: ['悬疑'],
      creatorName: '蓝喵工作室',
      cover: 'mp/releases/r1/cover.jpg',
      shareCover: 'mp/releases/r1/share.jpg',
      trailer: null,
      trailerPoster: null,
      chapters: [{ projectId: 'p1', order: 0, title: '雨夜', durationSec: 10 }],
      endings: [{ projectId: 'p1', nodeId: 'end1', title: '结局', endingType: 'good', chapterOrder: 0 }],
      segmentCount: 1,
      achievements: [],
    })
    expect(data.meta.accentColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(data.meta.texts).toEqual(expect.arrayContaining([{ where: '第 1 章「雨夜」·「巷口」', text: '雨夜。' }]))

    const body = programBody()
    expect(JSON.parse(body)).toMatchObject({ v: 1, releaseId: 'r1', aspectRatio: '9:16' })
    expect(JSON.parse(body).program.chapters[0].nodes[1].media.url).toBe(`mp:${VIDEO_ID}`)
    expect(data.programHash).toBe(createHash('sha256').update(body).digest('hex'))
    expect(data.sizeBytes).toBe(BigInt(1500 + Buffer.byteLength(body)))
    const programUpload = uploadObjectMock.mock.calls.find((call) => call[1] === 'mp/releases/r1/program.json')
    expect(programUpload?.[3]).toBe('application/json')
    expect(uploadObjectMock.mock.calls.find((call) => call[1] === 'mp/releases/r1/cover.jpg')?.[3]).toBe('image/jpeg')

    expect(redisMock.set).toHaveBeenCalledWith('mp:build:lock', expect.any(String), 'EX', 900, 'NX')
    const token = redisMock.set.mock.calls[0][1]
    expect(redisMock.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('del'"), 1, 'mp:build:lock', token)
    expect(existsSync(TMP_DIR)).toBe(false)
  })

  it('skips releases that are not building', async () => {
    prismaMock.storyRelease.findUnique.mockResolvedValue(releaseRow({ status: 'reviewing' }))
    expect(await handleStoryReleaseBuildTask(job)).toEqual({ releaseId: 'r1', skipped: true })
    prismaMock.storyRelease.findUnique.mockResolvedValue(null)
    expect(await handleStoryReleaseBuildTask(job)).toEqual({ releaseId: 'r1', skipped: true })
    expect(redisMock.set).not.toHaveBeenCalled()
    expect(prismaMock.storyRelease.update).not.toHaveBeenCalled()
    expect(loadStoryMock).not.toHaveBeenCalled()
  })

  it('requires releaseId in the payload', async () => {
    const badJob = { id: 'j1', data: { taskId: 't1', projectId: 'p1', payload: {} } } as unknown as Job<TaskJobData>
    await expect(handleStoryReleaseBuildTask(badJob)).rejects.toThrow('releaseId is required for story release build task')
    expect(prismaMock.storyRelease.update).not.toHaveBeenCalled()
  })

  it('fails with the full preflight issue list when preflight has errors', async () => {
    const issues: StoryIssue[] = [{ level: 'error', code: 'mp_no_endings', message: '至少需要一个结局', projectId: null, nodeId: null }]
    preflightMock.mockResolvedValue({ issues, errors: 1, warnings: 0 })
    await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('发布前检查未通过')
    expect(failedUpdate()).toEqual({ status: 'build_failed', failure: '发布前检查未通过', issues })
    expect(redisMock.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('del'"), 1, 'mp:build:lock', expect.any(String))
  })

  it('fails with the creator-facing pointer when media processing fails', async () => {
    processVideoMock.mockRejectedValue(new Error('ffmpeg exited with 1'))
    await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('素材处理失败：第 1 章「雨夜」·「巷口」')
    expect(failedUpdate()).toMatchObject({ status: 'build_failed', failure: '素材处理失败：第 1 章「雨夜」·「巷口」' })
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mp.release.media_failed',
      error: expect.objectContaining({ message: 'ffmpeg exited with 1', stack: expect.any(String) }),
    }))
    expect(failedUpdate().failure).not.toContain('ffmpeg')
  })

  it('writes 生成已取消 when the task is terminated', async () => {
    assertActiveMock.mockRejectedValueOnce(new TaskTerminatedError('t1'))
    await expect(handleStoryReleaseBuildTask(job)).rejects.toBeInstanceOf(TaskTerminatedError)
    expect(failedUpdate()).toMatchObject({ status: 'build_failed', failure: '生成已取消' })
  })

  it('writes the generic failure for unexpected errors and keeps stacks in logs only', async () => {
    loadStoryMock.mockRejectedValue(new Error('db down'))
    await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('db down')
    expect(failedUpdate()).toMatchObject({ status: 'build_failed', failure: '版本生成失败，请稍后重试' })
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mp.release.build_failed',
      error: expect.objectContaining({ stack: expect.any(String) }),
    }))
  })

  it('fails when the listing has not been saved', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('上架信息不存在，请先保存上架信息')
    expect(failedUpdate()).toMatchObject({ status: 'build_failed', failure: '上架信息不存在，请先保存上架信息' })
  })

  it('reuses prior manifest entries with the same source without transcoding', async () => {
    const priorEntry = {
      id: VIDEO_ID, kind: 'video', source: 'videos/a.mp4', w: 720, h: 1280, durationSec: 10, hasAudio: true,
      bytes: 1000, files: { v720: 'mp/releases/r0/m/old/720.mp4', poster: 'mp/releases/r0/m/old/poster.jpg' }, refs: ['/old'],
    }
    prismaMock.storyRelease.findMany.mockResolvedValue([{ manifest: { pipelineVersion: 1, media: { [VIDEO_ID]: priorEntry } } }])
    await handleStoryReleaseBuildTask(job)
    expect(prismaMock.storyRelease.findMany).toHaveBeenCalledWith({
      where: { workId: 'w1', pipelineVersion: 1, manifest: { not: Prisma.DbNull } },
      select: { manifest: true },
    })
    expect(processVideoMock).not.toHaveBeenCalled()
    expect(processImageMock).toHaveBeenCalledTimes(1)
    expect(reportProgressMock).toHaveBeenCalledWith(job, 5, { stage: 'mp_release_media', message: '处理素材 1/1' })
    const data = finalUpdate()
    expect(data.manifest.media[VIDEO_ID]).toEqual({ ...priorEntry, refs: ['/chapters/0/nodes/1/media/url'] })
    expect(data.totalDurationSec).toBe(10)
    expect(uploadedKeys().some((key) => String(key).includes(`/m/${VIDEO_ID}/`))).toBe(false)
  })

  it('reuses URL media by stable id without downloading again', async () => {
    const url = 'https://cdn.example.com/videos/remote.mp4'
    const urlId = sha1Id(url)
    const data = storyData()
    sceneOf(data).media = { kind: 'video', url, posterUrl: null }
    loadStoryMock.mockResolvedValue(data)
    const priorEntry = {
      id: urlId, kind: 'video', source: 'mp/releases/r0/src/old.mp4', w: 720, h: 1280, durationSec: 8, hasAudio: false,
      bytes: 900, files: { v720: 'mp/releases/r0/m/old/720.mp4' }, refs: ['/old'],
    }
    prismaMock.storyRelease.findMany.mockResolvedValue([{ manifest: { pipelineVersion: 1, media: { [urlId]: priorEntry } } }])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await handleStoryReleaseBuildTask(job)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(processVideoMock).not.toHaveBeenCalled()
    expect(finalUpdate().manifest.media[urlId]).toEqual({ ...priorEntry, refs: ['/chapters/0/nodes/1/media/url'] })
  })

  describe('absolute URL sources', () => {
    const url = 'https://cdn.example.com/videos/remote.mp4'
    const urlId = sha1Id(url)
    const srcKey = `mp/releases/r1/src/${urlId}.mp4`

    function urlStory() {
      const data = storyData()
      sceneOf(data).media = { kind: 'video', url, posterUrl: null }
      return data
    }

    function stubFetch(response: Record<string, unknown>) {
      vi.stubGlobal('fetch', vi.fn(async () => response))
    }

    function streamResponse(chunks: Uint8Array[], contentType = 'video/mp4', contentLength: string | null = '100') {
      let index = 0
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'content-length' ? contentLength : contentType) },
        body: {
          getReader: () => ({
            read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }),
          }),
        },
      }
    }

    it('downloads, stores under the release src prefix and transcodes the copy', async () => {
      loadStoryMock.mockResolvedValue(urlStory())
      stubFetch(streamResponse([new Uint8Array(100)]))
      await handleStoryReleaseBuildTask(job)
      expect(uploadObjectMock).toHaveBeenCalledWith(expect.any(Buffer), srcKey, undefined, 'video/mp4')
      expect(processVideoMock).toHaveBeenCalledWith(srcKey, { releaseId: 'r1', mediaId: urlId, tmpDir: TMP_DIR })
      const entry = finalUpdate().manifest.media[urlId]
      expect(entry).toMatchObject({ kind: 'video', source: srcKey, durationSec: 10 })
      expect(entry.refs).toEqual(['/chapters/0/nodes/1/media/url'])
    })

    it('fails the media when the download response is not ok', async () => {
      loadStoryMock.mockResolvedValue(urlStory())
      stubFetch({ ok: false, status: 404, headers: { get: () => null }, body: null })
      await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('素材处理失败：第 1 章「雨夜」·「巷口」')
      expect(failedUpdate()).toMatchObject({ status: 'build_failed' })
    })

    it('rejects a declared source over 1GB', async () => {
      loadStoryMock.mockResolvedValue(urlStory())
      stubFetch(streamResponse([], 'video/mp4', String(2 * 1024 * 1024 * 1024)))
      await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('素材处理失败：第 1 章「雨夜」·「巷口」')
    })

    it('rejects a streamed source over 1GB', async () => {
      loadStoryMock.mockResolvedValue(urlStory())
      const oversized = { byteLength: 1024 * 1024 * 1024 + 1 } as unknown as Uint8Array
      stubFetch(streamResponse([oversized], 'video/mp4', null))
      await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('素材处理失败：第 1 章「雨夜」·「巷口」')
    })
  })

  describe('/m/ short-link sources', () => {
    const shortLink = '/m/m_cd498fd2551623e8'
    const linkId = sha1Id(shortLink)

    function shortLinkStory() {
      const data = storyData()
      sceneOf(data).media = { kind: 'video', url: shortLink, posterUrl: null, durationSec: 10 }
      return data
    }

    it('resolves the storage key from the media table without fetching', async () => {
      loadStoryMock.mockResolvedValue(shortLinkStory())
      mediaByPublicIdMock.mockResolvedValue({ storageKey: 'videos/short-linked.mp4', mimeType: 'video/mp4' })
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const result = await handleStoryReleaseBuildTask(job)
      expect(result).toEqual({ releaseId: 'r1', status: 'reviewing' })
      expect(mediaByPublicIdMock).toHaveBeenCalledWith('m_cd498fd2551623e8')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(processVideoMock).toHaveBeenCalledWith('videos/short-linked.mp4', { releaseId: 'r1', mediaId: linkId, tmpDir: TMP_DIR })
      const entry = finalUpdate().manifest.media[linkId]
      expect(entry).toMatchObject({ kind: 'video', source: 'videos/short-linked.mp4', durationSec: 10 })
      expect(finalUpdate().program.chapters[0].nodes[1].media.url).toBe(`mp:${linkId}`)
    })

    it('fails the media when the short link has no media object', async () => {
      loadStoryMock.mockResolvedValue(shortLinkStory())
      mediaByPublicIdMock.mockResolvedValue(null)
      await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('素材处理失败：第 1 章「雨夜」·「巷口」')
      expect(failedUpdate()).toMatchObject({ status: 'build_failed' })
    })
  })

  describe('global build lock', () => {
    it('queues at progress 0 while the lock is held, then proceeds', async () => {
      let clock = 0
      nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
      sleepMock.mockImplementation(async () => { clock += 10_000 })
      redisMock.set.mockResolvedValueOnce(null).mockResolvedValue('OK')
      const result = await handleStoryReleaseBuildTask(job)
      expect(result).toEqual({ releaseId: 'r1', status: 'reviewing' })
      expect(redisMock.set).toHaveBeenCalledTimes(2)
      expect(reportProgressMock).toHaveBeenCalledWith(job, 0, { stage: 'mp_release_queued', message: '排队中，等待其他版本生成完成' })
      expect(assertActiveMock).toHaveBeenCalledWith(job, 'mp_release_queued')
    })

    it('fails after 30 minutes of queueing', async () => {
      let clock = 0
      nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
      sleepMock.mockImplementation(async () => { clock += 10_000 })
      redisMock.set.mockResolvedValue(null)
      await expect(handleStoryReleaseBuildTask(job)).rejects.toThrow('生成排队超时，请稍后重试')
      expect(redisMock.set.mock.calls.length).toBeGreaterThan(180)
      expect(failedUpdate()).toMatchObject({ status: 'build_failed', failure: '生成排队超时，请稍后重试' })
      expect(loadStoryMock).not.toHaveBeenCalled()
    })
  })

  describe('listing assets', () => {
    it('prefers listing.coverKey over the opening poster', async () => {
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ coverKey: 'images/listing-cover.jpg' }))
      await handleStoryReleaseBuildTask(job)
      expect(getObjectBufferMock.mock.calls[0][0]).toBe('images/listing-cover.jpg')
    })

    it('falls back to the opening video poster', async () => {
      await handleStoryReleaseBuildTask(job)
      expect(getObjectBufferMock.mock.calls[0][0]).toBe(`mp/releases/r1/m/${POSTER_ID}/img.jpg`)
    })

    it('uses shareCoverKey for the share image', async () => {
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ shareCoverKey: 'images/share-src.jpg' }))
      await handleStoryReleaseBuildTask(job)
      expect(getObjectBufferMock.mock.calls[1][0]).toBe('images/share-src.jpg')
    })

    it('renders a placeholder cover when the story has no media', async () => {
      const data = storyData()
      sceneOf(data).media = null
      loadStoryMock.mockResolvedValue(data)
      await handleStoryReleaseBuildTask(job)
      expect(getObjectBufferMock).not.toHaveBeenCalled()
      expect(processVideoMock).not.toHaveBeenCalled()
      expect(processImageMock).not.toHaveBeenCalled()
      expect(uploadedKeys()).toEqual([
        'mp/releases/r1/cover.jpg',
        'mp/releases/r1/share.jpg',
        'mp/releases/r1/program.json',
      ])
      expect(finalUpdate().meta.cover).toBe('mp/releases/r1/cover.jpg')
    })

    it('only adds a warning when the trailer fails', async () => {
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ trailerEnabled: true }))
      buildTrailerMock.mockRejectedValue(new Error('concat failed'))
      const result = await handleStoryReleaseBuildTask(job)
      expect(result).toEqual({ releaseId: 'r1', status: 'reviewing' })
      expect(finalUpdate().issues).toEqual([
        { level: 'warning', code: 'mp_trailer', message: '预告片生成失败，已跳过', projectId: null, nodeId: null },
      ])
      expect(finalUpdate().meta.trailer).toBeNull()
      expect(loggerMock.warn).toHaveBeenCalled()
    })

    it('stores trailer keys in meta when the trailer succeeds', async () => {
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ trailerEnabled: true }))
      buildTrailerMock.mockResolvedValue({ trailer: 'mp/releases/r1/trailer.mp4', trailerPoster: 'mp/releases/r1/trailer_poster.jpg' })
      await handleStoryReleaseBuildTask(job)
      expect(buildTrailerMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ releaseId: 'r1', aspectRatio: '9:16', tmpDir: TMP_DIR }))
      expect(finalUpdate().meta).toMatchObject({ trailer: 'mp/releases/r1/trailer.mp4', trailerPoster: 'mp/releases/r1/trailer_poster.jpg' })
    })

    it('keeps preflight warnings in the release issues', async () => {
      const warning: StoryIssue = { level: 'warning', code: 'mp_video_duration_unknown', message: '「巷口」的视频时长未知，生成版本时会自动检测', projectId: 'p1', nodeId: 's1' }
      preflightMock.mockResolvedValue({ issues: [warning], errors: 0, warnings: 1 })
      await handleStoryReleaseBuildTask(job)
      expect(finalUpdate().issues).toEqual([warning])
    })
  })
})

describe('submitTask credit gate', () => {
  beforeEach(() => {
    createTaskMock.mockResolvedValue({ task: { id: 't1', status: 'queued', priority: 0, payload: {}, billingInfo: null }, deduped: false })
    requireCreditMock.mockResolvedValue(undefined)
  })

  const baseParams = { userId: 'u1', locale: 'zh' as const, projectId: 'p1', targetType: 'work', targetId: 'w1' }

  it('does not require generation credit for story_release_build', async () => {
    const result = await submitTask({ ...baseParams, type: TASK_TYPE.STORY_RELEASE_BUILD, payload: { releaseId: 'r1' } })
    expect(requireCreditMock).not.toHaveBeenCalled()
    expect(addTaskJobMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true, taskId: 't1', deduped: false })
  })

  it('still requires generation credit for image_panel', async () => {
    await submitTask({ ...baseParams, type: TASK_TYPE.IMAGE_PANEL })
    expect(requireCreditMock).toHaveBeenCalledWith('u1')
  })

  it('blocks image_panel and marks the task failed when credit is insufficient', async () => {
    requireCreditMock.mockRejectedValue(new ApiError('INSUFFICIENT_BALANCE', { message: '积分不足' }))
    await expect(submitTask({ ...baseParams, type: TASK_TYPE.IMAGE_PANEL })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
    expect(markTaskFailedMock).toHaveBeenCalledWith('t1', 'INSUFFICIENT_BALANCE', '积分不足')
    expect(addTaskJobMock).not.toHaveBeenCalled()
  })
})
