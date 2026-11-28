import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const auth = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const access = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(),
  isProjectHiddenFromActor: vi.fn(async () => false),
  findHiddenProjectIds: vi.fn(async () => new Set<string>()),
}))
const service = vi.hoisted(() => ({
  getBatchRunById: vi.fn(),
  getBatchRunWithStatusSync: vi.fn(),
  updateBatchRun: vi.fn(),
  updateBatchRunModelConfig: vi.fn(),
  updateBatchRunStageConfig: vi.fn(),
  deleteBatchRun: vi.fn(),
}))
const executor = vi.hoisted(() => ({
  syncBatchItemTaskStatuses: vi.fn(async () => undefined),
}))

vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/collaboration/access', () => access)
vi.mock('@/lib/batch-workflow/service', () => service)
vi.mock('@/lib/batch-workflow/executor', () => executor)
vi.mock('@/lib/account/request-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/account/request-context')>()
  return {
    ...actual,
    setAccountActorContext: vi.fn(),
    withAccountPermissionContext: vi.fn((_perms: unknown, fn: () => unknown) => fn()),
  }
})

import { GET as runByIdGET } from '@/app/api/batch-workflow/runs/[runId]/route'

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireUserAuth.mockResolvedValue({ session: { user: { id: 'u-1', role: 'owner', permissions: ['admin'] } } })
  access.getWorkspaceActor.mockReturnValue({ actorId: 'u-1', workspaceOwnerId: 'ws-1' })
})

describe('GET /api/batch-workflow/runs/[runId] read-only contract', () => {
  it('returns the run via the read-only accessor without calling executor.syncBatchItemTaskStatuses', async () => {
    service.getBatchRunById.mockResolvedValue({
      id: 'run-1',
      projectId: 'proj-1',
    })
    service.getBatchRunWithStatusSync.mockResolvedValue({
      id: 'run-1',
      projectId: 'proj-1',
      items: [{ id: 'item-1', stageOutputs: { script_analysis: { fullScriptText: 'X' } } }],
    })

    const res = await runByIdGET(new NextRequest('http://localhost/api/batch-workflow/runs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.run.id).toBe('run-1')
    // Must go through the read-only service accessor and never call executor sync directly.
    expect(service.getBatchRunWithStatusSync).toHaveBeenCalledWith({
      workspaceOwnerId: 'ws-1',
      runId: 'run-1',
    })
    expect(executor.syncBatchItemTaskStatuses).not.toHaveBeenCalled()
  })

  it('returns 404 when the run is not visible to the workspace', async () => {
    service.getBatchRunById.mockResolvedValue(null)
    const res = await runByIdGET(new NextRequest('http://localhost/api/batch-workflow/runs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })
    expect(res.status).toBe(404)
    expect(service.getBatchRunWithStatusSync).not.toHaveBeenCalled()
  })

  it('returns 403 when project is hidden from actor', async () => {
    service.getBatchRunById.mockResolvedValue({ id: 'run-1', projectId: 'proj-hidden' })
    access.isProjectHiddenFromActor.mockResolvedValueOnce(true)
    const res = await runByIdGET(new NextRequest('http://localhost/api/batch-workflow/runs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })
    expect(res.status).toBe(403)
    expect(service.getBatchRunWithStatusSync).not.toHaveBeenCalled()
  })
})
