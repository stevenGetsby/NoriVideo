import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({ authenticated: true }))
const listRunsMock = vi.hoisted(() => vi.fn())
const createRunMock = vi.hoisted(() => vi.fn())
const prismaTaskFindFirstMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findFirst: prismaTaskFindFirstMock,
    },
  },
}))

vi.mock('@/lib/run-runtime/service', () => ({
  listRuns: listRunsMock,
  createRun: createRunMock,
}))

describe('api contract - runs list route', () => {
  const emptyRouteContext = {
    params: Promise.resolve({}),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    vi.stubEnv('NEXT_PUBLIC_NORI_INTERNAL_AGENT_TOOLS', 'false')
    authState.authenticated = true
    createRunMock.mockResolvedValue({
      id: 'run-created-1',
      userId: 'user-1',
      projectId: 'project-1',
      workflowType: 'story_to_script_run',
    })
    prismaTaskFindFirstMock.mockResolvedValue({ id: 'task-1' })
    listRunsMock.mockResolvedValue([
      {
        id: 'run-1',
        status: 'running',
        workflowType: 'story_to_script_run',
      },
    ])
  })

  it('tightens scoped active run queries to the latest recoverable run', async () => {
    const { GET } = await import('@/app/api/runs/route')

    const req = buildMockRequest({
      path: '/api/runs?projectId=project-1&workflowType=story_to_script_run&targetType=NovelPromotionEpisode&targetId=episode-1&episodeId=episode-1&status=queued&status=running&status=canceling&limit=20',
      method: 'GET',
    })
    const res = await GET(req, emptyRouteContext)

    expect(res.status).toBe(200)
    expect(listRunsMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      workflowType: 'story_to_script_run',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      episodeId: 'episode-1',
      statuses: ['queued', 'running', 'canceling'],
      limit: 20,
      recoverableOnly: true,
      latestOnly: true,
    }))
  })

  it('keeps non-active queries as normal list requests', async () => {
    const { GET } = await import('@/app/api/runs/route')

    const req = buildMockRequest({
      path: '/api/runs?projectId=project-1&workflowType=story_to_script_run&targetType=NovelPromotionEpisode&targetId=episode-1&status=completed&limit=20',
      method: 'GET',
    })
    const res = await GET(req, emptyRouteContext)

    expect(res.status).toBe(200)
    expect(listRunsMock).toHaveBeenCalledWith(expect.objectContaining({
      statuses: ['completed'],
      recoverableOnly: false,
      latestOnly: false,
    }))
  })

  it('filters internal agent runs out of ordinary list responses', async () => {
    listRunsMock.mockResolvedValue([
      { id: 'run-public-1', status: 'running', workflowType: 'story_to_script_run' },
      { id: 'run-agent-1', status: 'running', workflowType: 'super_agent_creation' },
      { id: 'run-agent-2', status: 'completed', workflowType: 'super_agent_chat_edit' },
    ])
    const { GET } = await import('@/app/api/runs/route')

    const req = buildMockRequest({
      path: '/api/runs?projectId=project-1&limit=20',
      method: 'GET',
    })
    const res = await GET(req, emptyRouteContext)
    const payload = await res.json() as { runs: Array<{ id: string }> }

    expect(res.status).toBe(200)
    expect(payload.runs).toEqual([{ id: 'run-public-1', status: 'running', workflowType: 'story_to_script_run' }])
  })

  it('does not expose explicit internal agent run queries unless internal tools are enabled', async () => {
    const { GET } = await import('@/app/api/runs/route')

    const req = buildMockRequest({
      path: '/api/runs?projectId=project-1&workflowType=super_agent_creation&limit=20',
      method: 'GET',
    })
    const res = await GET(req, emptyRouteContext)
    const payload = await res.json() as { runs: unknown[] }

    expect(res.status).toBe(200)
    expect(payload.runs).toEqual([])
    expect(listRunsMock).not.toHaveBeenCalled()
  })

  it('allows internal agent run queries when internal tools are enabled', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
    listRunsMock.mockResolvedValue([
      { id: 'run-agent-1', status: 'running', workflowType: 'super_agent_creation' },
    ])
    const { GET } = await import('@/app/api/runs/route')

    const req = buildMockRequest({
      path: '/api/runs?projectId=project-1&workflowType=super_agent_creation&limit=20',
      method: 'GET',
    })
    const res = await GET(req, emptyRouteContext)
    const payload = await res.json() as { runs: Array<{ id: string }> }

    expect(res.status).toBe(200)
    expect(payload.runs).toEqual([{ id: 'run-agent-1', status: 'running', workflowType: 'super_agent_creation' }])
    expect(listRunsMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowType: 'super_agent_creation',
    }))
  })

  it('rejects public creation of internal agent runs', async () => {
    const { POST } = await import('@/app/api/runs/route')

    const req = buildMockRequest({
      path: '/api/runs',
      method: 'POST',
      body: {
        projectId: 'project-1',
        workflowType: 'super_agent_creation',
        targetType: 'project',
        targetId: 'project-1',
      },
    })
    const res = await POST(req, emptyRouteContext)

    expect(res.status).toBe(400)
    expect(createRunMock).not.toHaveBeenCalled()
  })

  it('rejects attaching a run to a task outside the current user/project scope', async () => {
    prismaTaskFindFirstMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/runs/route')

    const req = buildMockRequest({
      path: '/api/runs',
      method: 'POST',
      body: {
        projectId: 'project-1',
        workflowType: 'story_to_script_run',
        targetType: 'NovelPromotionEpisode',
        targetId: 'episode-1',
        taskId: 'task-foreign-1',
      },
    })
    const res = await POST(req, emptyRouteContext)

    expect(res.status).toBe(400)
    expect(createRunMock).not.toHaveBeenCalled()
  })
})
