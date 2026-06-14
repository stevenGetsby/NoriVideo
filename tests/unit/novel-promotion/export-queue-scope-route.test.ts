import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const scopeMock = vi.hoisted(() => ({
  resolveExportScope: vi.fn(),
}))

const queueStoreMock = vi.hoisted(() => ({
  readExportQueue: vi.fn(),
  updateExportQueueTask: vi.fn(),
  upsertExportQueueRecord: vi.fn(),
}))

const readinessMock = vi.hoisted(() => ({
  formatExportReadinessBlocker: vi.fn(() => 'ready'),
  normalizeExportReadinessCardId: vi.fn((value: unknown) => (
    value === 'final-video' ? 'final-video' : null
  )),
  resolveExportReadiness: vi.fn(),
}))

const taskMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/novel-promotion/export-scope', () => scopeMock)
vi.mock('@/lib/novel-promotion/export-queue-store', () => queueStoreMock)
vi.mock('@/lib/novel-promotion/export-readiness', () => readinessMock)
vi.mock('@/lib/task/submitter', () => taskMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveTaskLocale: () => 'zh',
}))
function request(path: string, body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: body ? 'POST' : 'GET',
    ...(body
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
}

describe('/api/novel-promotion/[projectId]/export-queue scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scopeMock.resolveExportScope.mockResolvedValue({ episodeId: 'episode-1', scopeId: 'episode-1' })
    queueStoreMock.readExportQueue.mockResolvedValue([])
    queueStoreMock.upsertExportQueueRecord.mockResolvedValue([])
    taskMock.submitTask.mockResolvedValue({ taskId: 'task-1' })
    readinessMock.resolveExportReadiness.mockResolvedValue({
      projectId: 'project-1',
      episodeId: 'episode-1',
      stats: { clips: 1, panels: 1, images: 1, videos: 1, voices: 0 },
      items: [{
        id: 'queue-final-video',
        cardId: 'final-video',
        title: 'Final Video',
        status: 'ready',
        blockerCode: 'ready',
        stats: { clips: 1, panels: 1, images: 1, videos: 1, voices: 0 },
      }],
    })
  })

  it('uses the validated trimmed episode id for queue reads', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/export-queue/route')

    const response = await GET(
      request('/api/novel-promotion/project-1/export-queue?episodeId=%20episode-1%20') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(scopeMock.resolveExportScope).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: ' episode-1 ',
    })
    expect(queueStoreMock.readExportQueue).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
    expect(readinessMock.resolveExportReadiness).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
    expect(payload.episodeId).toBe('episode-1')
  })

  it('returns not found before reading queue state for an episode outside the project', async () => {
    scopeMock.resolveExportScope.mockResolvedValue(null)
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/export-queue/route')

    const response = await GET(
      request('/api/novel-promotion/project-1/export-queue?episodeId=episode-other') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(queueStoreMock.readExportQueue).not.toHaveBeenCalled()
    expect(readinessMock.resolveExportReadiness).not.toHaveBeenCalled()
  })

  it('submits export tasks with the validated episode id', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/export-queue/route')

    const response = await POST(
      request('/api/novel-promotion/project-1/export-queue?episodeId=%20episode-1%20', { cardId: 'final-video' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(taskMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetId: 'episode-1:final-video',
      dedupeKey: 'export-delivery:user-1:project-1:episode-1:final-video',
    }))
    expect(queueStoreMock.updateExportQueueTask).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: 'episode-1',
      taskId: 'task-1',
    }))
  })
})
