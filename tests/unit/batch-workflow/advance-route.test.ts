import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const access = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(),
  isProjectHiddenFromActor: vi.fn(async () => false),
}))
const service = vi.hoisted(() => ({ getBatchRunById: vi.fn() }))
const executor = vi.hoisted(() => ({ advanceBatchRun: vi.fn() }))

vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/collaboration/access', () => access)
vi.mock('@/lib/batch-workflow/service', () => service)
vi.mock('@/lib/batch-workflow/executor', () => executor)
vi.mock('@/lib/account/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/account/request-context')>()),
  setAccountActorContext: vi.fn(),
}))

import { POST } from '@/app/api/batch-workflow/runs/[runId]/advance/route'

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireUserAuth.mockResolvedValue({ session: { user: { id: 'u-1', role: 'owner', permissions: ['admin'] } } })
  access.getWorkspaceActor.mockReturnValue({ actorId: 'u-1', workspaceOwnerId: 'ws-1' })
  service.getBatchRunById.mockResolvedValue({ id: 'run-1', projectId: 'project-1' })
})

describe('POST advance scheduling contract', () => {
  it('returns scheduling results without changing auto approval semantics', async () => {
    const run = { id: 'run-1', hasPendingAsyncTasks: true }
    const executedSteps = [{ itemId: 'item-1', stage: 'script_analysis', outcome: 'running' }]
    executor.advanceBatchRun.mockResolvedValue({ run, hasPendingAsyncTasks: true, executedSteps })
    const request = new NextRequest('http://localhost/api/batch-workflow/runs/run-1/advance', {
      method: 'POST', body: JSON.stringify({ maxSteps: 2 }),
    })
    const res = await POST(request, { params: Promise.resolve({ runId: 'run-1' }) })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      result: { run, hasPendingAsyncTasks: true, executedSteps },
      run, hasPendingAsyncTasks: true, executedSteps,
    })
    const args = executor.advanceBatchRun.mock.calls[0][0]
    expect(args).toMatchObject({ workspaceOwnerId: 'ws-1', actorId: 'u-1', maxSteps: 2 })
    expect(args).not.toHaveProperty('approveWaitingReview')
  })

  it('rejects inaccessible runs before scheduling', async () => {
    service.getBatchRunById.mockResolvedValue(null)
    const res = await POST(new NextRequest('http://localhost/api/batch-workflow/runs/run-1/advance', { method: 'POST' }), {
      params: Promise.resolve({ runId: 'run-1' }),
    })
    expect(res.status).toBe(404)
    expect(executor.advanceBatchRun).not.toHaveBeenCalled()
  })
})
