import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTE_CATALOG } from '../../../contracts/route-catalog'
import { buildMockRequest } from '../../../helpers/request'

const requireUserAuthMock = vi.hoisted(() => vi.fn())
const assignmentServiceMock = vi.hoisted(() => ({
  getAssignmentCounts: vi.fn(),
  getAssignmentDetail: vi.fn(),
  getProjectAssignmentOverview: vi.fn(),
  listAssignmentCandidates: vi.fn(),
  listMyAssignments: vi.fn(),
  listPendingReviewAssignments: vi.fn(),
  listProjectAssignments: vi.fn(),
  mutateAssignment: vi.fn(),
  mutateAssignmentsBatch: vi.fn(),
  parseAssignmentFilters: vi.fn(() => ({})),
}))
const videoReviewServiceMock = vi.hoisted(() => ({
  getVideoReviewContext: vi.fn(),
}))
const storyboardReviewServiceMock = vi.hoisted(() => ({
  getStoryboardReviewContext: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: requireUserAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/collaboration/assignments', () => assignmentServiceMock)
vi.mock('@/lib/collaboration/video-review', () => videoReviewServiceMock)
vi.mock('@/lib/collaboration/storyboard-review', () => storyboardReviewServiceMock)

const session = {
  user: {
    id: 'workspace-1',
    actorId: 'actor-1',
    workspaceOwnerId: 'workspace-1',
    role: 'storyboard',
  },
}

const assignment = {
  id: 'assignment-1',
  projectId: 'project-1',
  projectName: '作品一',
  workId: 'work-1',
  workName: '项目一',
  stage: 'storyboard',
  status: 'in_progress',
  assigneeUserId: 'actor-1',
  assigneeName: '分镜师',
  assigneeDisabled: false,
  assigneeKind: 'member',
  episodeId: 'episode-1',
  episodeNumber: 1,
  assignedAt: '2026-07-18T00:00:00.000Z',
  submittedAt: null,
  completedAt: null,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  lastReviewNote: null,
  matched: true,
  canSubmit: true,
  canAssign: false,
  canMarkComplete: false,
  canReview: false,
  canReopen: false,
  submitCompletesDirectly: false,
}

const emptyContext = { params: Promise.resolve({}) }

describe('collaboration assignment canonical and FrameOS-compatible routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserAuthMock.mockResolvedValue({ session })
    assignmentServiceMock.listMyAssignments.mockResolvedValue({
      assignments: [assignment],
      total: 1,
      page: 1,
      pageSize: 10,
      showPendingReviewTab: false,
    })
    assignmentServiceMock.listPendingReviewAssignments.mockResolvedValue({
      assignments: [],
      total: 0,
      page: 1,
      pageSize: 10,
      showPendingReviewTab: true,
    })
    assignmentServiceMock.getAssignmentCounts.mockResolvedValue({
      counts: { todo: 1, inReview: 0, done: 0, pendingReview: 0 },
      showPendingReviewTab: false,
    })
    assignmentServiceMock.getProjectAssignmentOverview.mockResolvedValue({
      assignments: [assignment],
      canManageAssignments: false,
      canReviewAssignments: false,
    })
    assignmentServiceMock.listAssignmentCandidates.mockResolvedValue([])
    assignmentServiceMock.getAssignmentDetail.mockResolvedValue({ assignment, events: [] })
    assignmentServiceMock.mutateAssignment.mockResolvedValue(assignment)
    assignmentServiceMock.mutateAssignmentsBatch.mockResolvedValue({
      results: [
        { assignmentId: 'assignment-1', ok: true },
        { assignmentId: 'assignment-2', ok: false, error: '无权分配' },
      ],
      total: 2,
      okCount: 1,
    })
    videoReviewServiceMock.getVideoReviewContext.mockResolvedValue({
      assignment: { id: 'assignment-1', status: 'pending_review', canAnnotate: true },
      sources: [],
      durationMs: 0,
      annotations: [],
    })
    storyboardReviewServiceMock.getStoryboardReviewContext.mockResolvedValue({
      assignment: { id: 'assignment-1', status: 'pending_review', canReview: true },
      panels: [],
      totalPanelCount: 0,
    })
  })

  it('returns the canonical personal-list envelope and forwards paging/filter inputs', async () => {
    const { GET } = await import('@/app/api/collaboration/assignments/my/route')
    const response = await GET(buildMockRequest({
      path: '/api/collaboration/assignments/my',
      method: 'GET',
      query: { tab: 'todo', page: '2', pageSize: '5', stage: 'storyboard' },
    }), emptyContext)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ assignments: [{ id: 'assignment-1' }], total: 1, pageSize: 10 })
    expect(assignmentServiceMock.parseAssignmentFilters).toHaveBeenCalledWith(expect.objectContaining({ stage: 'storyboard' }))
    expect(assignmentServiceMock.listMyAssignments).toHaveBeenCalledWith(session, expect.objectContaining({
      tab: 'todo',
      page: '2',
      pageSize: '5',
    }))
  })

  it('returns canonical detail and audit events by assignment id', async () => {
    const { GET } = await import('@/app/api/collaboration/assignments/[assignmentId]/route')
    const response = await GET(
      buildMockRequest({ path: '/api/collaboration/assignments/assignment-1', method: 'GET' }),
      { params: Promise.resolve({ assignmentId: 'assignment-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ assignment: { id: 'assignment-1' }, events: [] })
    expect(assignmentServiceMock.getAssignmentDetail).toHaveBeenCalledWith(session, 'assignment-1')
  })

  it('returns the dedicated video review context by assignment id', async () => {
    const { GET } = await import('@/app/api/collaboration/assignments/[assignmentId]/video-review/route')
    const response = await GET(
      buildMockRequest({ path: '/api/collaboration/assignments/assignment-1/video-review', method: 'GET' }),
      { params: Promise.resolve({ assignmentId: 'assignment-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ assignment: { id: 'assignment-1', canAnnotate: true } })
    expect(videoReviewServiceMock.getVideoReviewContext).toHaveBeenCalledWith(session, 'assignment-1')
  })

  it('returns the dedicated storyboard review context by assignment id', async () => {
    const { GET } = await import('@/app/api/collaboration/assignments/[assignmentId]/storyboard-review/route')
    const response = await GET(
      buildMockRequest({ path: '/api/collaboration/assignments/assignment-1/storyboard-review', method: 'GET' }),
      { params: Promise.resolve({ assignmentId: 'assignment-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ assignment: { id: 'assignment-1', canReview: true } })
    expect(storyboardReviewServiceMock.getStoryboardReviewContext).toHaveBeenCalledWith(session, 'assignment-1')
  })

  it('accepts canonical single-action camelCase bodies', async () => {
    const { POST } = await import('@/app/api/collaboration/assignments/submit/route')
    const response = await POST(buildMockRequest({
      path: '/api/collaboration/assignments/submit',
      method: 'POST',
      body: { assignmentId: 'assignment-1', note: '请审核' },
    }), emptyContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ assignment: { id: 'assignment-1' } })
    expect(assignmentServiceMock.mutateAssignment).toHaveBeenCalledWith(session, 'submit', {
      assignmentId: 'assignment-1',
      assigneeUserId: undefined,
      note: '请审核',
    })
  })

  it('forwards video time annotations with a reject action', async () => {
    const { POST } = await import('@/app/api/collaboration/assignments/reject/route')
    const videoAnnotations = [{ panelId: 'panel-1', startMs: 1_200, endMs: 3_400, note: '口型不同步' }]
    const response = await POST(buildMockRequest({
      path: '/api/collaboration/assignments/reject',
      method: 'POST',
      body: { assignmentId: 'assignment-1', note: '请按时段修改', videoAnnotations },
    }), emptyContext)

    expect(response.status).toBe(200)
    expect(assignmentServiceMock.mutateAssignment).toHaveBeenCalledWith(session, 'reject', {
      assignmentId: 'assignment-1',
      assigneeUserId: undefined,
      note: '请按时段修改',
      videoAnnotations,
    })
  })

  it('preserves canonical batch partial-success results', async () => {
    const { POST } = await import('@/app/api/collaboration/assignments/batch-assign/route')
    const response = await POST(buildMockRequest({
      path: '/api/collaboration/assignments/batch-assign',
      method: 'POST',
      body: {
        assignmentIds: ['assignment-1', 'assignment-2'],
        assigneeUserId: 'asset-1',
      },
    }), emptyContext)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      results: [
        { assignmentId: 'assignment-1', ok: true },
        { assignmentId: 'assignment-2', ok: false, error: '无权分配' },
      ],
      total: 2,
      okCount: 1,
    })
    expect(assignmentServiceMock.mutateAssignmentsBatch).toHaveBeenCalledWith(session, 'assign', {
      assignmentIds: ['assignment-1', 'assignment-2'],
      assigneeUserId: 'asset-1',
      note: undefined,
    })
  })

  it('maps legacy GET responses to the FrameOS snake_case data envelope', async () => {
    const { GET } = await import('@/app/api/creative/projects/collaboration/assignments/[action]/route')
    const response = await GET(
      buildMockRequest({
        path: '/api/creative/projects/collaboration/assignments/my',
        method: 'GET',
        query: { tab: 'todo', page_size: '10' },
      }),
      { params: Promise.resolve({ action: 'my' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      data: {
        items: [{
          uuid: 'assignment-1',
          project_id: 'project-1',
          assignee_uid: 'actor-1',
          can_submit: true,
        }],
        total: 1,
        page_size: 10,
      },
    })
  })

  it('accepts legacy snake_case writes and returns a legacy assignment envelope', async () => {
    const { POST } = await import('@/app/api/creative/projects/collaboration/assignments/[action]/route')
    const response = await POST(
      buildMockRequest({
        path: '/api/creative/projects/collaboration/assignments/submit',
        method: 'POST',
        body: { assignment_uuid: 'assignment-1', note: 'legacy submit' },
      }),
      { params: Promise.resolve({ action: 'submit' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { uuid: 'assignment-1', project_id: 'project-1' } })
    expect(assignmentServiceMock.mutateAssignment).toHaveBeenCalledWith(session, 'submit', {
      assignmentId: 'assignment-1',
      assigneeUserId: undefined,
      note: 'legacy submit',
    })
  })

  it('rejects unknown legacy actions with a stable 404 error contract', async () => {
    const { GET } = await import('@/app/api/creative/projects/collaboration/assignments/[action]/route')
    const response = await GET(
      buildMockRequest({ path: '/api/creative/projects/collaboration/assignments/not-real', method: 'GET' }),
      { params: Promise.resolve({ action: 'not-real' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })

  it('auth-gates every route registered in the assignment contract group', async () => {
    requireUserAuthMock.mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ))
    const routeFiles = ROUTE_CATALOG
      .filter((entry) => entry.contractGroup === 'assignment-routes')
      .map((entry) => entry.routeFile)
    expect(routeFiles.length).toBeGreaterThan(10)

    for (const routeFile of routeFiles) {
      const modulePath = `@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
      const route = await import(modulePath)
      const method = typeof route.GET === 'function' ? 'GET' : 'POST'
      const handler = route[method] as (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>
      const legacy = routeFile.includes('/creative/projects/collaboration/assignments/')
      const detail = routeFile.includes('/[assignmentId]/')
      const params: Record<string, string> = legacy
        ? { action: 'my' }
        : detail ? { assignmentId: 'assignment-1' } : {}
      const response = await handler(buildMockRequest({
        path: legacy
          ? '/api/creative/projects/collaboration/assignments/my'
          : detail
            ? '/api/collaboration/assignments/assignment-1'
            : '/api/collaboration/assignments/test',
        method,
        ...(method === 'POST' ? { body: {} } : {}),
      }), {
        params: Promise.resolve(params),
      })
      expect(response.status, routeFile).toBe(401)
    }
  })
})
