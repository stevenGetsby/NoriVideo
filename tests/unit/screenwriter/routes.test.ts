import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const serviceMock = vi.hoisted(() => ({
  listScreenwriterTasks: vi.fn(),
  createVideoRepaintTask: vi.fn(),
  getVideoRepaintTaskDetail: vi.fn(),
  updateVideoRepaintRequirement: vi.fn(),
  runStage: vi.fn(),
  retryStage: vi.fn(),
  approveStage: vi.fn(),
  regenerateSettings: vi.fn(),
  listTargetScriptEpisodes: vi.fn(),
  updateTargetScriptEpisode: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/screenwriter/service', () => serviceMock)

describe('screenwriter API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({
      session: { user: { id: 'user-1' } },
    })
  })

  it('GET /api/screenwriter/tasks returns current user task summaries', async () => {
    serviceMock.listScreenwriterTasks.mockResolvedValue({
      tasks: [{ id: 'sw-task-1', title: 'Demo' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const { GET } = await import('@/app/api/screenwriter/tasks/route')

    const response = await GET(buildMockRequest({
      path: '/api/screenwriter/tasks?status=draft&taskKind=video_repaint_2&search=Demo&page=1&pageSize=20',
      method: 'GET',
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(serviceMock.listScreenwriterTasks).toHaveBeenCalledWith({
      userId: 'user-1',
      status: 'draft',
      taskKind: 'video_repaint_2',
      search: 'Demo',
      page: 1,
      pageSize: 20,
    })
    expect(payload.tasks).toEqual([{ id: 'sw-task-1', title: 'Demo' }])
  })

  it('POST /api/screenwriter/video-repaint creates a task', async () => {
    serviceMock.createVideoRepaintTask.mockResolvedValue({
      id: 'sw-task-1',
      title: 'Demo',
      nextRoute: '/screenwriter/video-repaint/sw-task-1',
    })
    const { POST } = await import('@/app/api/screenwriter/video-repaint/route')

    const response = await POST(buildMockRequest({
      path: '/api/screenwriter/video-repaint',
      method: 'POST',
      body: {
        title: 'Demo',
        transferForm: 'script',
        uploadMode: 'file',
        sourceAssetName: 'source.mp4',
        requirement: 'modern',
        checkpoints: { A: true, B: true },
      },
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(serviceMock.createVideoRepaintTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      title: 'Demo',
    }))
    expect(payload).toEqual({
      id: 'sw-task-1',
      title: 'Demo',
      nextRoute: '/screenwriter/video-repaint/sw-task-1',
    })
  })

  it('GET /api/screenwriter/video-repaint/:taskId returns detail or 404', async () => {
    serviceMock.getVideoRepaintTaskDetail.mockResolvedValue({ id: 'sw-task-1' })
    const { GET } = await import('@/app/api/screenwriter/video-repaint/[taskId]/route')

    const response = await GET(buildMockRequest({
      path: '/api/screenwriter/video-repaint/sw-task-1',
      method: 'GET',
    }) as never, { params: Promise.resolve({ taskId: 'sw-task-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(serviceMock.getVideoRepaintTaskDetail).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'sw-task-1',
    })
    expect(payload.task).toEqual({ id: 'sw-task-1' })
  })

  it('POST stage approve delegates to stage service', async () => {
    serviceMock.approveStage.mockResolvedValue({ id: 'sw-task-1', currentStage: 'episode_alignment' })
    const { POST } = await import('@/app/api/screenwriter/video-repaint/[taskId]/stages/[stage]/approve/route')

    const response = await POST(buildMockRequest({
      path: '/api/screenwriter/video-repaint/sw-task-1/stages/source_settings/approve',
      method: 'POST',
      body: { feedback: 'ok' },
    }) as never, { params: Promise.resolve({ taskId: 'sw-task-1', stage: 'source_settings' }) })

    expect(response.status).toBe(200)
    expect(serviceMock.approveStage).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'sw-task-1',
      stage: 'source_settings',
      feedback: 'ok',
    })
  })

  it('PATCH target script episode saves content', async () => {
    serviceMock.updateTargetScriptEpisode.mockResolvedValue({
      id: 'ep-1',
      content: 'updated',
      wordCount: 7,
    })
    const { PATCH } = await import('@/app/api/screenwriter/video-repaint/[taskId]/target-script/[episodeId]/route')

    const response = await PATCH(buildMockRequest({
      path: '/api/screenwriter/video-repaint/sw-task-1/target-script/ep-1',
      method: 'PATCH',
      body: { title: 'E1', content: 'updated' },
    }) as never, { params: Promise.resolve({ taskId: 'sw-task-1', episodeId: 'ep-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(serviceMock.updateTargetScriptEpisode).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'sw-task-1',
      episodeId: 'ep-1',
      title: 'E1',
      content: 'updated',
    })
    expect(payload.episode.wordCount).toBe(7)
  })
})
