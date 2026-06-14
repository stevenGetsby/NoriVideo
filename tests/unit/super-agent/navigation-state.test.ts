import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_STATUS } from '@/lib/run-runtime/types'

const serviceMock = vi.hoisted(() => ({
  listRuns: vi.fn(),
  createRun: vi.fn(),
  appendRunEventWithSeq: vi.fn(),
  createArtifact: vi.fn(),
}))

vi.mock('@/lib/run-runtime/service', () => serviceMock)

describe('super-agent navigation state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('locks navigation when a recoverable super-agent graph run is active', async () => {
    const {
      ACTIVE_SUPER_AGENT_NAVIGATION_STATUSES,
      readSuperAgentNavigationState,
    } = await import('@/lib/super-agent/navigation-state')
    const { SUPER_AGENT_WORKFLOW_TYPE } = await import('@/lib/super-agent/workflow-store')

    serviceMock.listRuns.mockResolvedValue([{
      id: 'run-1',
      status: RUN_STATUS.RUNNING,
      updatedAt: '2026-06-14T02:00:00.000Z',
    }])

    const state = await readSuperAgentNavigationState({
      userId: 'user-1',
      projectId: 'project-1',
    })

    expect(serviceMock.listRuns).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      workflowType: SUPER_AGENT_WORKFLOW_TYPE,
      targetType: 'project',
      targetId: 'project-1',
      statuses: ACTIVE_SUPER_AGENT_NAVIGATION_STATUSES,
      recoverableOnly: true,
      latestOnly: true,
      limit: 8,
    })
    expect(state).toEqual({
      projectId: 'project-1',
      locked: true,
      source: 'graph-run',
      runId: 'run-1',
      status: RUN_STATUS.RUNNING,
      updatedAt: '2026-06-14T02:00:00.000Z',
    })
  })

  it('does not lock navigation when no active graph run remains', async () => {
    const { readSuperAgentNavigationState } = await import('@/lib/super-agent/navigation-state')

    serviceMock.listRuns.mockResolvedValue([])

    await expect(readSuperAgentNavigationState({
      userId: 'user-1',
      projectId: 'project-1',
    })).resolves.toEqual({
      projectId: 'project-1',
      locked: false,
      source: 'graph-run',
      runId: null,
      status: null,
      updatedAt: null,
    })
  })
})
