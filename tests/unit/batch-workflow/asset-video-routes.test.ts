import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const auth = vi.hoisted(() => ({ requireUserAuth: vi.fn(), isErrorResponse: (value: unknown) => value instanceof Response }))
const access = vi.hoisted(() => ({ getWorkspaceActor: vi.fn(), isProjectHiddenFromActor: vi.fn(async () => false) }))
const service = vi.hoisted(() => ({ getBatchRunById: vi.fn() }))
const executor = vi.hoisted(() => ({ generateBatchItemAssets: vi.fn(), bindBatchItemAssetMaterial: vi.fn(), generateBatchItemVideos: vi.fn(), selectShotTake: vi.fn(), runStageSkillTrial: vi.fn() }))
vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/collaboration/access', () => access)
vi.mock('@/lib/batch-workflow/service', () => service)
vi.mock('@/lib/batch-workflow/executor', () => executor)
vi.mock('@/lib/account/request-context', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/account/request-context')>()), setAccountActorContext: vi.fn() }))
import { POST as assetsPOST } from '@/app/api/batch-workflow/runs/[runId]/items/[itemId]/assets/route'
import { POST as videosPOST } from '@/app/api/batch-workflow/runs/[runId]/items/[itemId]/videos/route'
import { POST as trialPOST } from '@/app/api/batch-workflow/runs/[runId]/items/[itemId]/trial/route'
const context = { params: Promise.resolve({ runId: 'run', itemId: 'item' }) }
function request(body: Record<string, unknown>) { return new NextRequest('http://localhost/api/batch-workflow/runs/run/items/item', { method: 'POST', body: JSON.stringify(body) }) }
beforeEach(() => {
  vi.clearAllMocks()
  auth.requireUserAuth.mockResolvedValue({ session: { user: { id: 'u', role: 'owner', permissions: ['admin'] } } })
  access.getWorkspaceActor.mockReturnValue({ actorId: 'u', workspaceOwnerId: 'ws' }); service.getBatchRunById.mockResolvedValue({ id: 'run', projectId: 'p' })
  executor.generateBatchItemAssets.mockResolvedValue({ run: {}, item: {}, taskIds: [], submittedCount: 0, failedCount: 0 })
  executor.bindBatchItemAssetMaterial.mockResolvedValue({ run: {}, item: {} }); executor.selectShotTake.mockResolvedValue({ run: {}, item: {} })
  executor.generateBatchItemVideos.mockResolvedValue({ run: {}, item: {}, stage: 'video_gen', outcome: 'running' }); executor.runStageSkillTrial.mockResolvedValue({ trialOutput: {} })
})
describe('asset video route revision and trial contracts', () => {
  it('passes expectedRevision for asset generation and bind', async () => {
    await assetsPOST(request({ action: 'generate', expectedRevision: 4 }), context)
    expect(executor.generateBatchItemAssets).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }))
    await assetsPOST(request({ action: 'bind', assetItemId: 'a', expectedRevision: 5 }), context)
    expect(executor.bindBatchItemAssetMaterial).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5 }))
  })
  it('maps asset revision conflicts to STALE_REVISION 409', async () => {
    const { ApiError } = await import('@/lib/api-errors'); executor.bindBatchItemAssetMaterial.mockRejectedValue(new ApiError('STALE_REVISION'))
    const response = await assetsPOST(request({ action: 'bind', assetItemId: 'a', expectedRevision: 1 }), context)
    expect(response.status).toBe(409); await expect(response.json()).resolves.toMatchObject({ code: 'STALE_REVISION' })
  })
  it('passes single-shot overrides, regenerateAll and take revision', async () => {
    await videosPOST(request({ action: 'generate', shotIds: ['s1'], shotOverrides: { s1: { prompt: 'new', durationSeconds: 10 } }, regenerateAll: true, expectedRevision: 7 }), context)
    expect(executor.generateBatchItemVideos).toHaveBeenCalledWith(expect.objectContaining({ shotIds: ['s1'], shotOverrides: { s1: { prompt: 'new', durationSeconds: 10 } }, regenerateAll: true, expectedRevision: 7 }))
    await videosPOST(request({ action: 'select_take', shotId: 's1', takeIndex: 0, expectedRevision: 8 }), context)
    expect(executor.selectShotTake).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 8 }))
  })
  it('passes trial cost and shot confirmation and preserves admin gate', async () => {
    await trialPOST(request({ stage: 'video_gen', confirmCost: true, shotId: 's1' }), context)
    expect(executor.runStageSkillTrial).toHaveBeenCalledWith(expect.objectContaining({ confirmCost: true, shotId: 's1' }))
    auth.requireUserAuth.mockResolvedValueOnce({ session: { user: { id: 'u', role: 'member', permissions: [] } } })
    const response = await trialPOST(request({ stage: 'video_gen' }), context)
    expect(response.status).toBe(403)
  })
  it('rejects real trial without a shotId before calling executor', async () => {
    const response = await trialPOST(request({ stage: 'video_gen', confirmCost: true }), context)
    expect(response.status).toBe(400); expect(executor.runStageSkillTrial).not.toHaveBeenCalled()
  })
})
