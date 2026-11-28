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
const service = vi.hoisted(() => ({
  getBatchRunById: vi.fn(),
  getBatchRunWithStatusSync: vi.fn(),
}))
const executor = vi.hoisted(() => ({
  runBatchItemStage: vi.fn(),
  syncBatchItemTaskStatuses: vi.fn(async () => ({ changed: false, hasPendingAsyncTasks: false })),
  reviewBatchItemStage: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/collaboration/access', () => access)
vi.mock('@/lib/batch-workflow/service', () => service)
vi.mock('@/lib/batch-workflow/executor', () => executor)
vi.mock('@/lib/account/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/account/request-context')>()),
  setAccountActorContext: vi.fn(),
}))

import { POST as stepPOST } from '@/app/api/batch-workflow/runs/[runId]/items/[itemId]/step/route'
import { POST as syncPOST } from '@/app/api/batch-workflow/runs/[runId]/sync/route'
import { POST as reviewPOST } from '@/app/api/batch-workflow/runs/[runId]/items/[itemId]/review/route'

const runResult = { id: 'run-1', projectId: 'project-1' }
const itemResult = { id: 'item-1', revision: 3 }
const stepContext = { params: Promise.resolve({ runId: 'run-1', itemId: 'item-1' }) }
const syncContext = { params: Promise.resolve({ runId: 'run-1' }) }

function request(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireUserAuth.mockResolvedValue({ session: { user: { id: 'u-1', role: 'owner', permissions: ['admin'] } } })
  access.getWorkspaceActor.mockReturnValue({ actorId: 'u-1', workspaceOwnerId: 'ws-1' })
  service.getBatchRunById.mockResolvedValue(runResult)
  executor.runBatchItemStage.mockResolvedValue({ run: runResult, item: itemResult, stage: 'script_rewrite', outcome: 'running' })
})

describe('POST step async contract', () => {
  it('returns queued/running immediately and forwards expectedRevision', async () => {
    const res = await stepPOST(request('/api/batch-workflow/runs/run-1/items/item-1/step', {
      stage: 'script_rewrite', expectedRevision: 2,
    }), stepContext)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      queued: true, run: runResult, item: itemResult, stage: 'script_rewrite',
      outcome: 'running', stageOutcome: 'running',
    })
    expect(executor.runBatchItemStage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceOwnerId: 'ws-1', actorId: 'u-1', expectedRevision: 2, stage: 'script_rewrite',
    }))
  })

  it('keeps legacy result fields for synchronous terminal outcomes', async () => {
    executor.runBatchItemStage.mockResolvedValue({ run: runResult, item: itemResult, stage: 'video_gen', outcome: 'waiting_review' })
    const res = await stepPOST(request('/api/batch-workflow/runs/run-1/items/item-1/step', { stage: 'video_gen' }), stepContext)
    await expect(res.json()).resolves.toMatchObject({ queued: false, outcome: 'waiting_review', stageOutcome: 'waiting_review' })
  })

  it('maps duplicate submissions to 409 STAGE_ALREADY_RUNNING', async () => {
    const { ApiError } = await import('@/lib/api-errors')
    executor.runBatchItemStage.mockRejectedValue(new ApiError('STAGE_ALREADY_RUNNING'))
    const res = await stepPOST(request('/api/batch-workflow/runs/run-1/items/item-1/step', { stage: 'script_rewrite' }), stepContext)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'STAGE_ALREADY_RUNNING' })
  })

  it('maps revision conflicts to 409 STALE_REVISION', async () => {
    const { ApiError } = await import('@/lib/api-errors')
    executor.runBatchItemStage.mockRejectedValue(new ApiError('STALE_REVISION'))
    const res = await stepPOST(request('/api/batch-workflow/runs/run-1/items/item-1/step', { stage: 'script_rewrite', expectedRevision: 1 }), stepContext)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'STALE_REVISION' })
  })

  it('rejects a hidden project before scheduling', async () => {
    access.isProjectHiddenFromActor.mockResolvedValueOnce(true)
    const res = await stepPOST(request('/api/batch-workflow/runs/run-1/items/item-1/step', { stage: 'script_rewrite' }), stepContext)
    expect(res.status).toBe(403)
    expect(executor.runBatchItemStage).not.toHaveBeenCalled()
  })

  it('rejects a negative or fractional expectedRevision', async () => {
    const res = await stepPOST(request('/api/batch-workflow/runs/run-1/items/item-1/step', { stage: 'script_rewrite', expectedRevision: 1.5 }), stepContext)
    expect(res.status).toBe(400)
    expect(executor.runBatchItemStage).not.toHaveBeenCalled()
  })
})

describe('POST sync write-only status reconciliation', () => {
  it('calls executor sync and returns the complete run from the read accessor', async () => {
    const fullRun = {
      id: 'run-1',
      items: [{ id: 'item-1', stageOutputs: { script_analysis: { fullScriptText: '完整剧本' } } }],
    }
    service.getBatchRunById.mockResolvedValueOnce(runResult).mockResolvedValueOnce(fullRun)
    const res = await syncPOST(request('/api/batch-workflow/runs/run-1/sync', {}), syncContext)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ run: fullRun })
    expect(executor.syncBatchItemTaskStatuses).toHaveBeenCalledWith({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1' })
    expect(service.getBatchRunWithStatusSync).not.toHaveBeenCalled()
    expect(service.getBatchRunById).toHaveBeenLastCalledWith({ workspaceOwnerId: 'ws-1', runId: 'run-1', includeItems: true })
  })

  it('rejects cross-workspace runs without syncing', async () => {
    service.getBatchRunById.mockResolvedValue(null)
    const res = await syncPOST(request('/api/batch-workflow/runs/run-1/sync', {}), syncContext)
    expect(res.status).toBe(404)
    expect(executor.syncBatchItemTaskStatuses).not.toHaveBeenCalled()
  })

  it('rejects hidden projects without syncing', async () => {
    access.isProjectHiddenFromActor.mockResolvedValueOnce(true)
    const res = await syncPOST(request('/api/batch-workflow/runs/run-1/sync', {}), syncContext)
    expect(res.status).toBe(403)
    expect(executor.syncBatchItemTaskStatuses).not.toHaveBeenCalled()
  })
})

describe('POST review revision forwarding', () => {
  it('passes expectedRevision to the executor', async () => {
    executor.reviewBatchItemStage.mockResolvedValue({ run: runResult, item: itemResult })
    const res = await reviewPOST(request('/api/batch-workflow/runs/run-1/items/item-1/review', {
      stage: 'script_rewrite', action: 'approve', expectedRevision: 7,
    }), stepContext)
    expect(res.status).toBe(200)
    expect(executor.reviewBatchItemStage).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 7 }))
  })
})
