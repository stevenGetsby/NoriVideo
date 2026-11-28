import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ items: [] as any[], assets: [] as any[], tasks: [] as any[], materials: [] as any[] }))
const prismaMock = vi.hoisted(() => ({
  batchRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  batchItem: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  frameosToolboxAsset: { findMany: vi.fn(), updateMany: vi.fn() },
  task: { findMany: vi.fn(), findUnique: vi.fn() },
  user: { findMany: vi.fn() },
  frameosMaterial: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/platform-services/config', () => ({ getPlatformServiceConfigResponse: () => ({ models: [], defaults: {} }) }))
vi.mock('@/lib/platform-services/model-selection', () => ({
  resolveModelKeyForViewer: (_c: unknown, key: string) => ({ allowed: true, modelKey: key, runtimeModelKey: key }),
  listSelectableModelsForViewer: () => [],
}))
vi.mock('@/lib/api-config', () => ({ resolveModelSelection: vi.fn(async (_u: string, key: string) => ({ modelKey: key })) }))
import { bindBatchItemAssetMaterial, selectShotTake, syncBatchItemTaskStatuses } from '@/lib/batch-workflow/executor'
import { WORKFLOW_STAGES } from '@/lib/batch-workflow/types'

const now = new Date().toISOString()
function take(status: string, videoUrl: string | null = 'video.mp4') {
  return { takeIndex: 0, taskId: 'task-1', assetId: 'toolbox-1', videoUrl, prompt: 'p', modelKey: 'm', inputMode: 'text', aspectRatio: '9:16', resolution: '720p', durationSec: 5, generateAudio: false, status, submittedAt: now }
}
function version(status: string, imageUrl: string | null = 'image.png') {
  return { versionIndex: 1, toolboxAssetId: 'toolbox-1', taskId: 'task-1', imageUrl, storageKey: imageUrl, materialId: 'mat-1', prompt: 'p', aspectRatio: '3:4', source: 'generated', status, createdAt: now }
}
function setup(output: Record<string, unknown>) {
  db.items = [{ id: 'item-1', batchRunId: 'run-1', revision: 2, executionKey: null, index: 0, title: 'I', inputPayload: {}, currentStage: 'video_gen', status: 'waiting_review', stageStates: Object.fromEntries(WORKFLOW_STAGES.map((s) => [s, { status: 'pending', skillSlug: '' }])), stageOutputs: output, errorMessage: null, createdAt: new Date(now), updatedAt: new Date(now) }]
}
function run() {
  return { id: 'run-1', userId: 'ws', createdById: 'ws', workId: null, projectId: 'p', templateId: 't', templateSnapshot: { id: 't', stages: WORKFLOW_STAGES.map((stage) => ({ stage, gateMode: 'manual_review', enabled: true })) }, title: 'R', track: 'commerce', runMode: 'gated', status: 'running', totalItems: 1, completedItems: 0, failedItems: 0, createdAt: new Date(now), updatedAt: new Date(now), items: db.items }
}
beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.batchRun.findFirst.mockImplementation(async () => run())
  prismaMock.batchRun.findUnique.mockImplementation(async () => run())
  prismaMock.batchRun.update.mockImplementation(async ({ data }: any) => run())
  prismaMock.batchItem.findUnique.mockImplementation(async () => db.items[0])
  prismaMock.batchItem.findFirst.mockImplementation(async () => db.items[0])
  prismaMock.batchItem.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (db.items[0].revision !== where.revision) return { count: 0 }
    const { revision, ...patch } = data
    Object.assign(db.items[0], patch, { revision: db.items[0].revision + 1 })
    return { count: 1 }
  })
  prismaMock.frameosToolboxAsset.findMany.mockImplementation(async () => db.assets)
  prismaMock.task.findMany.mockImplementation(async () => db.tasks)
  prismaMock.user.findMany.mockResolvedValue([])
  prismaMock.frameosMaterial.findFirst.mockImplementation(async ({ where }: any) => db.materials.find((m) => m.id === where.id && m.userId === 'ws') || null)
})

describe('asset and take readiness', () => {
  it.each(['queued', 'processing', 'failed', 'pending'])('rejects %s takes without changing selection', async (status) => {
    setup({ video_gen: { shots: [{ shotId: 's1', takes: [take(status)], selectedTakeIndex: -1 }] } })
    await expect(selectShotTake({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1', shotId: 's1', takeIndex: 0 })).rejects.toMatchObject({ code: 'ASSET_NOT_READY', status: 409 })
    expect(db.items[0].stageOutputs.video_gen.shots[0].selectedTakeIndex).toBe(-1)
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
  })
  it('rejects a ready take with an empty URL and accepts a ready URL', async () => {
    setup({ video_gen: { shots: [{ shotId: 's1', takes: [take('ready', '')], selectedTakeIndex: -1 }] } })
    await expect(selectShotTake({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1', shotId: 's1', takeIndex: 0 })).rejects.toMatchObject({ code: 'ASSET_NOT_READY' })
    db.items[0].stageOutputs.video_gen.shots[0].takes[0].videoUrl = 'ok.mp4'
    const result = await selectShotTake({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1', shotId: 's1', takeIndex: 0 })
    expect(result.item.stageOutputs.video_gen?.shots[0].selectedTakeIndex).toBe(0)
  })
  it.each(['queued', 'processing', 'failed', 'pending'])('rejects adopting %s image versions', async (status) => {
    setup({ asset_extraction: { items: [{ id: 'a', kind: 'character', name: 'A', versions: [version(status)], selectedVersionIndex: -1 }] } })
    await expect(bindBatchItemAssetMaterial({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1', assetItemId: 'a', selectVersionIndex: 0 })).rejects.toMatchObject({ code: 'ASSET_NOT_READY' })
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
  })
  it.each(['ready', 'reused'])('adopts %s image versions', async (status) => {
    setup({ asset_extraction: { items: [{ id: 'a', kind: 'character', name: 'A', versions: [version(status)], selectedVersionIndex: -1 }] } })
    const result = await bindBatchItemAssetMaterial({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1', assetItemId: 'a', selectVersionIndex: 0 })
    expect(result.item.stageOutputs.asset_extraction?.items[0]).toMatchObject({ selectedVersionIndex: 0, imageUrl: 'image.png', status })
  })
  it('rejects missing and cross-workspace materials without revealing them', async () => {
    setup({ asset_extraction: { items: [{ id: 'a', kind: 'character', name: 'A', versions: [], selectedVersionIndex: -1 }] } })
    db.materials = [{ id: 'other', userId: 'someone-else' }]
    await expect(bindBatchItemAssetMaterial({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1', assetItemId: 'a', materialId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(bindBatchItemAssetMaterial({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1', assetItemId: 'a', materialId: 'other' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('keeps a previous ready URL when sync receives a failed empty result', async () => {
    setup({ asset_extraction: { items: [{ id: 'a', kind: 'character', name: 'A', versions: [version('ready')], selectedVersionIndex: 0, status: 'ready', imageUrl: 'old.png', storageKey: 'old.png', materialId: 'old-mat' }] }, video_gen: { shots: [{ shotId: 's1', takes: [take('ready', 'old.mp4')], selectedTakeIndex: 0 }] } })
    db.assets = [{ id: 'toolbox-1', status: 'failed', resultUrl: null, materialId: null, errorMessage: 'late failure', params: {}, updatedAt: new Date(now) }]
    db.tasks = [{ id: 'task-1', status: 'failed', errorMessage: 'late failure', finishedAt: new Date(now) }]
    await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws', batchRunId: 'run-1', itemId: 'item-1' })
    expect(db.items[0].stageOutputs.asset_extraction.items[0].imageUrl).toBe('image.png')
    expect(db.items[0].stageOutputs.video_gen.shots[0].takes[0].videoUrl).toBe('old.mp4')
  })
})
