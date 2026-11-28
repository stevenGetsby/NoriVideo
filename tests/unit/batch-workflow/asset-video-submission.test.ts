import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ items: [] as any[], assets: [] as any[], tasks: [] as any[], run: {} as any }))
const prismaMock = vi.hoisted(() => ({
  batchRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, batchItem: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  task: { findUnique: vi.fn(), findMany: vi.fn() }, user: { findMany: vi.fn() }, frameosMaterial: { findMany: vi.fn() },
  frameosToolboxAsset: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
}))
const submitMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const serviceMock = vi.hoisted(() => ({ resolveWorkflowSkill: vi.fn() }))
const llmMock = vi.hoisted(() => ({ runModelGatewayTextCompletion: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/model-gateway/llm', () => llmMock)
vi.mock('@/lib/batch-workflow/service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/batch-workflow/service')>()), resolveWorkflowSkill: serviceMock.resolveWorkflowSkill }))
vi.mock('@/lib/platform-services/config', () => ({ getPlatformServiceConfigResponse: () => ({ models: [], defaults: {} }) }))
vi.mock('@/lib/platform-services/model-selection', () => ({ resolveModelKeyForViewer: vi.fn(), listSelectableModelsForViewer: vi.fn(() => [{ modelKey: 'fallback', runtimeModelKey: 'fallback' }]) }))
vi.mock('@/lib/api-config', () => ({ resolveModelSelection: vi.fn(async (_u: string, key: string) => ({ modelKey: key })) }))
vi.mock('@/lib/llm-client', () => ({ getCompletionContent: (value: any) => value?.content ?? '' }))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  getCapabilityOptionFields: () => ({ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 15], resolution: ['480p', '720p', '1080p'] }),
  resolveBuiltinCapabilitiesByModelKey: () => ({}),
}))
import { generateBatchItemAssets, generateBatchItemVideos, runBatchItemStage, runStageSkillTrial, syncBatchItemTaskStatuses } from '@/lib/batch-workflow/executor'
import { resolveModelKeyForViewer } from '@/lib/platform-services/model-selection'
import { BUILTIN_WORKFLOW_SKILLS } from '@/lib/batch-workflow/builtin-presets'
import { WORKFLOW_STAGES, type WorkflowSkillDTO } from '@/lib/batch-workflow/types'

const now = new Date().toISOString()
function shot(index: number) { return { shotId: `s${index}`, shotIndex: index, sceneIndex: 1, title: `S${index}`, durationSec: 7, shotType: '近景', cameraMovement: '固定', visualDescription: '视觉', videoPrompt: `prompt-${index}`, referencedAssetIds: [], referencedAssetNames: [], inputMode: 'text', negativeConstraints: '' } }
function skill(modelPreferences: Record<string, unknown> = {}) { return { id: 'skill', userId: null, isBuiltin: true, slug: 'skill', name: 'S', track: 'short_drama_commerce', stage: 'video_gen', version: 1, parentSkillId: null, changeNote: null, isDefault: true, description: null, systemPrompt: '', fewShotExamples: [], outputSchema: null, modelPreferences, qcRules: null, createdAt: now, updatedAt: now } as WorkflowSkillDTO }
function setup(count = 1, output?: Record<string, unknown>, skillPrefs?: Record<string, unknown>) {
  db.items = [{ id: 'item', batchRunId: 'run', revision: 0, executionKey: null, index: 0, title: 'Item', inputPayload: {}, currentStage: 'video_gen', status: 'queued', stageStates: Object.fromEntries(WORKFLOW_STAGES.map((s) => [s, { status: 'pending', skillSlug: '' }])), stageOutputs: output || { storyboard: { aspectRatio: '9:16', totalDurationSec: count * 5, pacingStyle: '', videoModelKey: '', supportsFirstLastFrame: true, allowedDurationRange: { min: 4, max: 15 }, shots: Array.from({ length: count }, (_, i) => shot(i + 1)) } }, errorMessage: null, createdAt: new Date(now), updatedAt: new Date(now) }]
  db.run = {
    id: 'run', userId: 'ws', createdById: 'ws', workId: null, projectId: 'p', templateId: 't',
    templateSnapshot: {
      id: 't', modelConfig: { videoModelKey: 'run-video', videoDurationSeconds: 5, videoAspectRatio: '16:9' },
      stageParams: { video_gen: { resolution: '480p' } },
      stages: WORKFLOW_STAGES.map((stage) => ({
        stage, label: stage, skillSlug: '', gateMode: 'manual_review', enabled: true,
        ...(stage === 'video_gen' ? { options: { aspectRatio: '1:1' } } : {}),
      })),
    },
    title: 'R', track: 'short_drama_commerce', runMode: 'gated', status: 'running', totalItems: 1, completedItems: 0, failedItems: 0,
    createdAt: new Date(now), updatedAt: new Date(now), items: db.items,
  }
  db.assets = []; db.tasks = []
  serviceMock.resolveWorkflowSkill.mockResolvedValue(skill(skillPrefs || { videoModelKey: 'skill-video', durationSeconds: 8, generateAudio: true, defaultStageParams: { resolution: '1080p', generateAudio: true } }))
}
beforeEach(() => {
  vi.clearAllMocks(); setup()
  prismaMock.batchRun.findFirst.mockImplementation(async () => db.run); prismaMock.batchRun.findUnique.mockImplementation(async () => db.run); prismaMock.batchRun.update.mockImplementation(async ({ data }: any) => ({ ...db.run, ...data }))
  prismaMock.batchItem.findUnique.mockImplementation(async () => db.items[0]); prismaMock.batchItem.findFirst.mockImplementation(async () => db.items[0])
  prismaMock.batchItem.updateMany.mockImplementation(async ({ where, data }: any) => { if (db.items[0].revision !== where.revision) return { count: 0 }; const { revision, ...patch } = data; Object.assign(db.items[0], patch, { revision: db.items[0].revision + 1 }); return { count: 1 } })
  prismaMock.task.findUnique.mockResolvedValue(null); prismaMock.task.findMany.mockResolvedValue([]); prismaMock.user.findMany.mockResolvedValue([]); prismaMock.frameosMaterial.findMany.mockResolvedValue([])
  prismaMock.frameosToolboxAsset.create.mockImplementation(async ({ data }: any) => { const row = { id: `asset-${db.assets.length + 1}`, ...data, updatedAt: new Date(now) }; db.assets.push(row); return row })
  prismaMock.frameosToolboxAsset.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([])
  submitMock.submitTask.mockImplementation(async ({ targetId }: any) => ({ taskId: `task-${targetId}` }))
  vi.mocked(resolveModelKeyForViewer).mockImplementation((_c, key) => ({ allowed: true, modelKey: key, runtimeModelKey: key }))
})
function videos(overrides: Record<string, unknown> = {}) { return generateBatchItemVideos({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', ...overrides }) }

describe('S5 skill precedence and bounded submission', () => {
  it('applies skill < run/stage < per-shot override and clamps durations', async () => {
    const result = await videos({ shotIds: ['s1'], shotOverrides: { s1: { prompt: 'override', durationSeconds: 99, inputMode: 'firstlastframe' } } })
    expect(result.outcome).toBe('running')
    expect(submitMock.submitTask).toHaveBeenCalledOnce()
    const request = submitMock.submitTask.mock.calls[0][0]
    expect(request.payload).toMatchObject({ prompt: 'override', aspectRatio: '1:1', resolution: '480p', inputMode: 'text', videoModel: 'skill-video', duration: 15 })
    expect(result.item.stageOutputs.video_gen?.shots[0]).toMatchObject({ durationSec: 15, prompt: 'override' })
  })
  it('does not silently fall back when a skill model is unavailable', async () => {
    vi.mocked(resolveModelKeyForViewer).mockReturnValue({ allowed: false, reason: 'disabled' })
    const result = await videos()
    expect(result.outcome).toBe('failed'); expect(result.item.errorMessage).toContain('不可用'); expect(submitMock.submitTask).not.toHaveBeenCalled()
  })
  it('submits only explicit shotIds and rejects unconfirmed full regeneration', async () => {
    setup(2, { storyboard: { shots: [shot(1), shot(2)], aspectRatio: '9:16' }, video_gen: { shots: [{ shotId: 's1', takes: [{ takeIndex: 0, status: 'ready', videoUrl: 'old' }], selectedTakeIndex: 0 }, { shotId: 's2', takes: [], selectedTakeIndex: -1 }] } })
    await expect(videos()).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    const result = await videos({ shotIds: ['s1'] })
    expect(submitMock.submitTask).toHaveBeenCalledOnce(); expect(submitMock.submitTask.mock.calls[0][0].payload.prompt).toBe('prompt-1')
    expect(result.item.stageOutputs.video_gen?.shots[0].takes).toHaveLength(2)
  })
  it('passes regenerateAll to the S5 core when ready takes exist, while the default remains rejected', async () => {
    setup(1, { storyboard: { shots: [shot(1)] }, video_gen: { shots: [{ shotId: 's1', takes: [{ takeIndex: 0, status: 'ready', videoUrl: 'old' }], selectedTakeIndex: 0 }] } })
    await expect(videos()).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    const result = await videos({ regenerateAll: true })
    expect(result.outcome).toBe('running')
    expect(submitMock.submitTask).toHaveBeenCalledOnce()
    expect(result.item.stageOutputs.video_gen?.shots[0].takes).toHaveLength(2)
  })
  it('bounds concurrent submits to four, isolates failures and reports partial failure', async () => {
    setup(6); let active = 0, peak = 0, calls = 0
    submitMock.submitTask.mockImplementation(async ({ payload }: any) => {
      calls += 1
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      if (payload.prompt === 'prompt-2') throw new Error('one failure')
      db.tasks.push({})
      return { taskId: `task-${calls}` }
    })
    const result = await videos()
    expect(peak).toBe(4); expect(submitMock.submitTask).toHaveBeenCalledTimes(6)
    expect(result.item.stageOutputs.video_gen?.shots.map((entry) => entry.takes.at(-1)!.status)).toContain('failed')
    expect(result.item.stageOutputs.video_gen?.shots.filter((entry) => entry.takes.at(-1)!.status === 'queued')).toHaveLength(5)
    expect(result.item.stageStates.video_gen.status).toBe('running')
    const synced = await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws', batchRunId: 'run', itemId: 'item' })
    expect(synced.hasPendingAsyncTasks).toBe(true)
    expect(result.item.stageOutputs.video_gen?.shots.map((entry) => entry.takes.at(-1)!.status)).toContain('failed')
  })
  it('late-registers a paid S5 take after executionKey replacement without changing state or selection', async () => {
    db.items[0].executionKey = 'exec'; db.items[0].status = 'running'
    db.items[0].stageStates.video_gen = { status: 'running', taskIds: ['worker'], startedAt: now }
    db.tasks = [{ id: 'worker', status: 'processing' }]
    submitMock.submitTask.mockImplementationOnce(async ({ targetId }: any) => {
      db.items[0].executionKey = 'replacement'; db.items[0].status = 'queued'; db.items[0].currentStage = 'storyboard'
      db.items[0].stageOutputs.video_gen = { modelKey: 'v', aspectRatio: '9:16', resolution: '720p', generateAudio: false, inputMode: 'text', readyCount: 0, totalCount: 1, pendingCount: 0, failedCount: 0, shots: [{ shotId: 's1', shotIndex: 1, title: 'S1', durationSec: 5, prompt: 'p', referencedAssetIds: [], takes: [], selectedTakeIndex: 0 }] }
      return { taskId: `task-${targetId}` }
    })
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'video_gen', executionKey: 'exec', taskId: 'worker' })
    expect(result.outcome).toBe('skipped')
    expect(db.items[0]).toMatchObject({ status: 'queued', currentStage: 'storyboard', executionKey: 'replacement' })
    expect(db.items[0].stageOutputs.video_gen.shots[0].selectedTakeIndex).toBe(0)
    expect(db.items[0].stageOutputs.video_gen.shots[0].takes).toHaveLength(1)
    expect(db.items[0].stageStates.video_gen.taskIds).toEqual(['worker', 'task-asset-1'])
  })
  it('late-registers a submitted S3 version after executionKey replacement without changing item state', async () => {
    setup(1, { asset_extraction: { styleBible: 'style', colorPalette: 'blue', lightingDirection: 'soft', items: [{ id: 'a1', kind: 'character', name: 'A', description: 'd', imagePrompt: 'p', aspectRatio: '1:1', status: 'pending', versions: [], selectedVersionIndex: -1 }] } })
    db.items[0].currentStage = 'asset_extraction'; db.items[0].status = 'running'; db.items[0].executionKey = 'exec'
    db.items[0].stageStates.asset_extraction = { status: 'running', taskIds: ['worker'], startedAt: now }
    db.items[0].stageOutputs.script_analysis = { fullScriptText: 'source', beats: [] }
    db.tasks = [{ id: 'worker', status: 'processing' }]
    llmMock.runModelGatewayTextCompletion.mockResolvedValue({ content: JSON.stringify({ items: [{ id: 'a1', kind: 'character', name: 'A', imagePrompt: 'p' }] }) })
    db.run.runMode = 'auto'
    db.run.templateSnapshot.stageParams = { asset_extraction: { autoGenerateImages: true } }
    submitMock.submitTask.mockImplementationOnce(async ({ targetId }: any) => {
      db.items[0].executionKey = 'replacement'; db.items[0].status = 'queued'
      db.items[0].stageOutputs.asset_extraction = { ...db.items[0].stageOutputs.asset_extraction, items: [{ id: 'a1', kind: 'character', name: 'A', description: 'd', imagePrompt: 'p', aspectRatio: '1:1', status: 'pending', versions: [], selectedVersionIndex: -1 }] }
      return { taskId: `task-${targetId}` }
    })
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'asset_extraction', executionKey: 'exec', taskId: 'worker' })
    expect(result.item.errorMessage).toBeNull()
    expect(result.outcome).toBe('skipped')
    expect(db.items[0]).toMatchObject({ status: 'queued', executionKey: 'replacement' })
    expect(db.items[0].stageOutputs.asset_extraction.items[0].versions).toHaveLength(1)
    expect(db.items[0].stageOutputs.asset_extraction.items[0].versions[0]).toMatchObject({ taskId: 'task-asset-1', status: 'queued' })
    expect(db.items[0].stageStates.asset_extraction.taskIds).toEqual(['worker', 'task-asset-1'])
  })
  it('deduplicates active shots on repeated submission', async () => {
    setup(1, { storyboard: { shots: [shot(1)], aspectRatio: '9:16' }, video_gen: { shots: [{ shotId: 's1', shotIndex: 1, takes: [{ takeIndex: 0, status: 'queued', taskId: 'old-task', videoUrl: null }], selectedTakeIndex: 0 }] } })
    const result = await videos()
    expect(submitMock.submitTask).not.toHaveBeenCalled(); expect(result.item.stageStates.video_gen.taskIds).toContain('old-task')
  })
})

describe('S3 bounded prompts and trial', () => {
  it('injects the shared style anchor into every bounded asset prompt', async () => {
    setup(1, { asset_extraction: { styleBible: 'ink-style', colorPalette: 'blue', lightingDirection: 'soft', items: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, kind: 'character', name: `A${i}`, description: 'x', imagePrompt: 'original', aspectRatio: i % 2 ? '1:1' : '3:4', status: 'pending', versions: [], selectedVersionIndex: -1 })) } })
    const result = await generateBatchItemAssets({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item' })
    expect(result.submittedCount).toBe(5)
    for (const call of submitMock.submitTask.mock.calls) { expect(call[0].payload.prompt).toContain('ink-style'); expect(call[0].payload.prompt).toContain('blue'); expect(call[0].payload.prompt.length).toBeLessThanOrEqual(900) }
    expect(new Set(submitMock.submitTask.mock.calls.map((call) => call[0].payload.aspectRatio))).toEqual(new Set(['1:1', '3:4']))
  })
  it('dry-runs normalized S5 parameters without submitting', async () => {
    const result = await runStageSkillTrial({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'video_gen' })
    expect(result.trialOutput).toMatchObject({ dryRun: true, modelKey: 'skill-video', aspectRatio: '1:1', resolution: '480p', durationSeconds: 5, shotCount: 1 })
    expect(submitMock.submitTask).not.toHaveBeenCalled(); expect(db.items[0].revision).toBe(0)
  })
  it('requires explicit single-shot confirmation before real trial', async () => {
    await expect(runStageSkillTrial({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'video_gen', shotId: 's1' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(runStageSkillTrial({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'video_gen', confirmCost: true })).rejects.toThrow()
    const result = await runStageSkillTrial({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'video_gen', confirmCost: true, shotId: 's1' })
    expect(result.trialOutput).toMatchObject({ dryRun: false, shotCount: 1, shotId: 's1' }); expect(submitMock.submitTask).toHaveBeenCalledOnce()
  })
  it('registers a real trial take without selecting it and rejects a double submission', async () => {
    setup(1, { storyboard: { shots: [shot(1)] }, video_gen: {
      modelKey: 'video', aspectRatio: '9:16', resolution: '720p', generateAudio: false, inputMode: 'text', readyCount: 1, totalCount: 1, pendingCount: 0, failedCount: 0,
      shots: [{ shotId: 's1', shotIndex: 1, title: 'S1', durationSec: 7, prompt: 'prompt-1', referencedAssetIds: [], takes: [{ takeIndex: 0, status: 'ready', videoUrl: 'old', taskId: 'old-task' }], selectedTakeIndex: 0 }],
    } })
    db.items[0].status = 'waiting_review'
    const trial = { workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'video_gen' as const, confirmCost: true, shotId: 's1' }
    const result = await runStageSkillTrial(trial)
    expect(result.trialOutput).toMatchObject({ dryRun: false, shotCount: 1 })
    expect(db.items[0].stageOutputs.video_gen.shots[0].takes).toHaveLength(2)
    expect(db.items[0].stageOutputs.video_gen.shots[0].selectedTakeIndex).toBe(0)
    expect(db.items[0].stageStates.video_gen.taskIds).toEqual(['task-asset-1'])
    expect(db.items[0]).toMatchObject({ status: 'waiting_review', currentStage: 'video_gen', executionKey: null })

    await expect(runStageSkillTrial(trial)).rejects.toMatchObject({ code: 'STAGE_ALREADY_RUNNING', message: '该镜头正在生成，请稍候。' })
    expect(submitMock.submitTask).toHaveBeenCalledOnce()
  })
  it('preserves concurrent shots and selections when registering the trial take', async () => {
    setup(2, { storyboard: { shots: [shot(1), shot(2)] } })
    submitMock.submitTask.mockImplementationOnce(async ({ targetId }: any) => {
      db.items[0].stageOutputs.video_gen = { shots: [
        { shotId: 's1', shotIndex: 1, takes: [], selectedTakeIndex: 0 },
        { shotId: 's2', shotIndex: 2, takes: [{ takeIndex: 0, taskId: 'other', status: 'ready', videoUrl: 'other-url' }], selectedTakeIndex: 0 },
      ] }
      return { taskId: `task-${targetId}` }
    })
    await runStageSkillTrial({ workspaceOwnerId: 'ws', actorId: 'ws', batchRunId: 'run', itemId: 'item', stage: 'video_gen', confirmCost: true, shotId: 's1' })
    const video = db.items[0].stageOutputs.video_gen
    expect(video.shots[0].selectedTakeIndex).toBe(0)
    expect(video.shots[0].takes.at(-1)).toMatchObject({ taskId: 'task-asset-1', status: 'queued' })
    expect(video.shots[1]).toMatchObject({ selectedTakeIndex: 0 })
    expect(video.shots[1].takes).toHaveLength(1)
  })
  it('adds an immutable built-in S5 variant without replacing the default', () => {
    const variants = BUILTIN_WORKFLOW_SKILLS.filter((entry) => entry.stage === 'video_gen')
    expect(variants.length).toBeGreaterThanOrEqual(2); expect(variants.every((entry) => entry.version === 1)).toBe(true)
    expect(new Set(variants.map((entry) => entry.slug)).size).toBe(variants.length)
  })
  it('keeps concurrently saved unrelated stage data during sync', async () => {
    setup(1, { storyboard: { shots: [shot(1)] }, video_gen: { shots: [{ shotId: 's1', takes: [{ takeIndex: 0, taskId: 't', assetId: 'a', status: 'queued' }], selectedTakeIndex: 0 }] } })
    prismaMock.batchItem.findFirst.mockImplementationOnce(async () => { db.items[0].stageOutputs.script_rewrite = { title: 'concurrent' }; return db.items[0] })
    prismaMock.task.findMany.mockResolvedValue([{ id: 't', status: 'processing', errorMessage: null }])
    await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws', batchRunId: 'run', itemId: 'item' })
    expect(db.items[0].stageOutputs.script_rewrite.title).toBe('concurrent')
  })
})
