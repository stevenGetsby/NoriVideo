import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authState = vi.hoisted(() => ({ authenticated: true }))
const getRunByIdMock = vi.hoisted(() => vi.fn())
const listRunEventsAfterSeqMock = vi.hoisted(() => vi.fn())

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
  }
})

vi.mock('@/lib/run-runtime/service', () => ({
  getRunById: getRunByIdMock,
  listRunEventsAfterSeq: listRunEventsAfterSeqMock,
}))

describe('/api/runs/[runId]/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    vi.stubEnv('NEXT_PUBLIC_NORI_INTERNAL_AGENT_TOOLS', 'false')
    authState.authenticated = true
    getRunByIdMock.mockResolvedValue({
      id: 'run-1',
      userId: 'user-1',
      projectId: 'project-1',
      workflowType: 'story_to_script_run',
    })
    listRunEventsAfterSeqMock.mockResolvedValue([
      { id: 'event-1', runId: 'run-1', seq: 1, eventType: 'run.start' },
    ])
  })

  it('returns public run events after ownership and visibility checks', async () => {
    const { GET } = await import('@/app/api/runs/[runId]/events/route')

    const req = buildMockRequest({
      path: '/api/runs/run-1/events?afterSeq=2&limit=5',
      method: 'GET',
    })
    const res = await GET(req, {
      params: Promise.resolve({ runId: 'run-1' }),
    })
    const payload = await res.json() as {
      runId: string
      afterSeq: number
      events: unknown[]
    }

    expect(res.status).toBe(200)
    expect(payload.runId).toBe('run-1')
    expect(payload.afterSeq).toBe(2)
    expect(payload.events).toHaveLength(1)
    expect(listRunEventsAfterSeqMock).toHaveBeenCalledWith({
      runId: 'run-1',
      userId: 'user-1',
      afterSeq: 2,
      limit: 5,
    })
  })

  it('does not expose internal agent run events by default', async () => {
    getRunByIdMock.mockResolvedValue({
      id: 'run-agent-1',
      userId: 'user-1',
      projectId: 'project-1',
      workflowType: 'super_agent_creation',
    })
    const { GET } = await import('@/app/api/runs/[runId]/events/route')

    const req = buildMockRequest({
      path: '/api/runs/run-agent-1/events',
      method: 'GET',
    })
    const res = await GET(req, {
      params: Promise.resolve({ runId: 'run-agent-1' }),
    })

    expect(res.status).toBe(404)
    expect(listRunEventsAfterSeqMock).not.toHaveBeenCalled()
  })
})
