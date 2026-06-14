import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const serviceMock = vi.hoisted(() => ({
  getRunSnapshot: vi.fn(),
  listRunEventsAfterSeq: vi.fn(),
  listArtifacts: vi.fn(),
  listCheckpoints: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)

vi.mock('@/lib/run-runtime/service', () => serviceMock)

describe('/api/runs/[runId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    vi.stubEnv('NEXT_PUBLIC_NORI_INTERNAL_AGENT_TOOLS', 'false')
    authMock.requireUserAuth.mockResolvedValue({
      session: {
        user: { id: 'user-1' },
      },
    })
    serviceMock.getRunSnapshot.mockResolvedValue({
      run: {
        id: 'run-1',
        userId: 'user-1',
        projectId: 'project-1',
        workflowType: 'story_to_script_run',
      },
      steps: [],
    })
    serviceMock.listRunEventsAfterSeq.mockResolvedValue([{ id: '1', seq: 1, eventType: 'run.start' }])
    serviceMock.listArtifacts.mockResolvedValue([{ id: 'artifact-1', artifactType: 'episode', refId: 'episode-1' }])
    serviceMock.listCheckpoints.mockResolvedValue([{ id: 'checkpoint-1', nodeKey: 'stage_1', version: 1 }])
  })

  it('returns run snapshot with events, artifacts and checkpoints', async () => {
    const { GET } = await import('@/app/api/runs/[runId]/route')

    const response = await GET(
      new NextRequest('http://localhost/api/runs/run-1') as never,
      { params: Promise.resolve({ runId: 'run-1' }) },
    )
    const payload = await response.json()

    expect(payload).toMatchObject({
      run: {
        id: 'run-1',
        workflowType: 'story_to_script_run',
      },
      steps: [],
      events: [{ id: '1', seq: 1, eventType: 'run.start' }],
      artifacts: [{ id: 'artifact-1', artifactType: 'episode', refId: 'episode-1' }],
      checkpoints: [{ id: 'checkpoint-1', nodeKey: 'stage_1', version: 1 }],
    })
    expect(serviceMock.listRunEventsAfterSeq).toHaveBeenCalledWith({
      runId: 'run-1',
      userId: 'user-1',
      afterSeq: 0,
      limit: 500,
    })
    expect(serviceMock.listArtifacts).toHaveBeenCalledWith({
      runId: 'run-1',
      limit: 500,
    })
  })

  it('hides internal agent run detail by default', async () => {
    serviceMock.getRunSnapshot.mockResolvedValue({
      run: {
        id: 'run-agent-1',
        userId: 'user-1',
        projectId: 'project-1',
        workflowType: 'super_agent_creation',
      },
      steps: [],
    })
    const { GET } = await import('@/app/api/runs/[runId]/route')

    const response = await GET(
      new NextRequest('http://localhost/api/runs/run-agent-1') as never,
      { params: Promise.resolve({ runId: 'run-agent-1' }) },
    )

    expect(response.status).toBe(404)
    expect(serviceMock.listRunEventsAfterSeq).not.toHaveBeenCalled()
    expect(serviceMock.listArtifacts).not.toHaveBeenCalled()
  })

  it('allows internal agent run detail when internal tools are enabled', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
    serviceMock.getRunSnapshot.mockResolvedValue({
      run: {
        id: 'run-agent-1',
        userId: 'user-1',
        projectId: 'project-1',
        workflowType: 'super_agent_creation',
      },
      steps: [],
    })
    const { GET } = await import('@/app/api/runs/[runId]/route')

    const response = await GET(
      new NextRequest('http://localhost/api/runs/run-agent-1') as never,
      { params: Promise.resolve({ runId: 'run-agent-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.run).toMatchObject({
      id: 'run-agent-1',
      workflowType: 'super_agent_creation',
    })
  })
})
