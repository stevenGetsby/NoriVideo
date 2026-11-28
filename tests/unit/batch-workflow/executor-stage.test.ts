import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  items: [] as any[], runs: [] as any[], tasks: [] as any[],
}))
const prismaMock = vi.hoisted(() => ({
  batchRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  batchItem: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  task: { findUnique: vi.fn(), findMany: vi.fn() },
  user: { findMany: vi.fn() },
  frameosMaterial: { findFirst: vi.fn(), findMany: vi.fn() },
  frameosToolboxAsset: { findMany: vi.fn() },
}))
const serviceMock = vi.hoisted(() => ({ resolveWorkflowSkill: vi.fn() }))
const llmMock = vi.hoisted(() => ({ runModelGatewayTextCompletion: vi.fn() }))
const submitMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const videoMock = vi.hoisted(() => ({ understandStorageVideoWithSkill: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/batch-workflow/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/batch-workflow/service')>()
  return { ...actual, resolveWorkflowSkill: serviceMock.resolveWorkflowSkill }
})
vi.mock('@/lib/model-gateway/llm', () => llmMock)
vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/volcengine/video-understanding', () => videoMock)
vi.mock('@/lib/platform-services/config', () => ({ getPlatformServiceConfigResponse: () => ({ models: [], defaults: {} }) }))
vi.mock('@/lib/platform-services/model-selection', () => ({
  resolveModelKeyForViewer: (_c: unknown, key: string) => ({ allowed: true, modelKey: key, runtimeModelKey: key }),
  listSelectableModelsForViewer: () => [{ modelKey: 'fallback', runtimeModelKey: 'fallback' }],
}))
vi.mock('@/lib/api-config', () => ({ resolveModelSelection: vi.fn(async (_u: string, key: string) => ({ modelKey: key })) }))
vi.mock('@/lib/llm-client', () => ({ getCompletionContent: (value: any) => value?.content ?? '' }))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  getCapabilityOptionFields: () => ({ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 15], resolution: ['480p', '720p', '1080p'] }),
  resolveBuiltinCapabilitiesByModelKey: () => ({}),
}))

import { advanceBatchRun, reviewBatchItemStage, runBatchItemStage, selectShotTake, syncBatchItemTaskStatuses } from '@/lib/batch-workflow/executor'
import { WORKFLOW_STAGES, type WorkflowStage } from '@/lib/batch-workflow/types'

function itemRow(index = 0, overrides: Record<string, unknown> = {}) {
  return {
    id: `item-${index}`, batchRunId: 'run-1', revision: 0, executionKey: null, index,
    title: `Item ${index}`, inputPayload: {}, currentStage: 'script_rewrite', status: 'queued',
    stageStates: Object.fromEntries(WORKFLOW_STAGES.map((stage) => [stage, { status: 'pending', skillSlug: '' }])),
    stageOutputs: { script_analysis: { fullScriptText: '原始文本', beats: [] } },
    errorMessage: null, createdAt: new Date('2026-11-28T00:00:00.000Z'), updatedAt: new Date('2026-11-28T00:00:00.000Z'),
    ...overrides,
  }
}
function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1', userId: 'ws-1', createdById: 'ws-1', workId: null, projectId: 'proj-1', templateId: 'tpl-1',
    templateSnapshot: { id: 'tpl-1', name: 'Template', slug: 'tpl', stages: WORKFLOW_STAGES.map((stage) => ({
      stage, label: stage, skillSlug: '', gateMode: 'manual_review', enabled: true,
    })) }, title: 'Run', track: 'short_drama_commerce', runMode: 'gated', status: 'running',
    totalItems: 0, completedItems: 0, failedItems: 0,
    createdAt: new Date('2026-11-28T00:00:00.000Z'), updatedAt: new Date('2026-11-28T00:00:00.000Z'),
    items: db.items, ...overrides,
  }
}
function scene(text = 'correct') {
  return { sceneIndex: 1, location: '店', beat: '开场', visualAction: text, dialogue: text, durationSec: 5 }
}
function skill(stage: WorkflowStage = 'script_rewrite', qcRules: Record<string, unknown> | null = null) {
  return { id: 'skill-1', slug: 'skill', name: 'Skill', version: 3, stage, track: 'short_drama_commerce',
    systemPrompt: 'prompt', fewShotExamples: [], modelPreferences: { llmModelKey: 'model-1' }, qcRules }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  db.items = [itemRow()]
  db.runs = [runRow()]
  db.tasks = []
  prismaMock.batchRun.findFirst.mockImplementation(async () => runRow())
  prismaMock.batchRun.findUnique.mockImplementation(async () => runRow())
  prismaMock.batchRun.update.mockImplementation(async ({ data }: any) => runRow(data))
  prismaMock.batchItem.findFirst.mockImplementation(async ({ where }: any) => db.items.find((row) => row.id === where.id) ?? null)
  prismaMock.batchItem.findUnique.mockImplementation(async ({ where }: any) => db.items.find((row) => row.id === where.id) ?? null)
  prismaMock.batchItem.updateMany.mockImplementation(async ({ where, data }: any) => {
    const row = db.items.find((entry) => entry.id === where.id && (entry.revision ?? 0) === where.revision)
    if (!row) return { count: 0 }
    const { revision: _revision, ...patch } = data
    Object.assign(row, patch, { revision: (row.revision ?? 0) + 1, updatedAt: new Date() })
    return { count: 1 }
  })
  prismaMock.task.findUnique.mockImplementation(async ({ where }: any) => db.tasks.find((task) => task.id === where.id) ?? null)
  prismaMock.task.findMany.mockImplementation(async () => db.tasks)
  prismaMock.user.findMany.mockResolvedValue([])
  prismaMock.frameosMaterial.findFirst.mockResolvedValue(null)
  prismaMock.frameosMaterial.findMany.mockResolvedValue([])
  prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([])
  serviceMock.resolveWorkflowSkill.mockImplementation(async ({ stage }: any) => skill(stage))
  submitMock.submitTask.mockImplementation(async ({ targetId, payload }: any) => {
    const task = { id: `task-${db.tasks.length + 1}`, status: 'queued', targetId, payload }
    db.tasks.push(task)
    return { taskId: task.id }
  })
  llmMock.runModelGatewayTextCompletion.mockImplementation(async () => ({
    content: JSON.stringify({ scenes: [scene()] }),
  }))
})

describe('workflow execution queue and recovery', () => {
  function runningItemForRace() {
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running', stageStates: { script_rewrite: { status: 'running', taskIds: ['task-1'], startedAt: new Date().toISOString() } } })]
    db.tasks = [{ id: 'task-1', status: 'processing' }]
  }
  function runWorkerForRace() {
    return runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite', executionKey: 'exec', taskId: 'task-1' })
  }

  it('queues S1-S4 and returns before invoking the LLM', async () => {
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite' })
    expect(result.outcome).toBe('running')
    expect(submitMock.submitTask).toHaveBeenCalledOnce()
    expect(llmMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
    expect(db.items[0]).toMatchObject({ status: 'running', revision: 2 })
  })

  it('discards a duplicate worker job whose executionKey is stale', async () => {
    db.items = [itemRow(0, { executionKey: 'current', status: 'running', stageStates: { script_rewrite: { status: 'running', taskIds: ['task-current'] } } })]
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite', executionKey: 'old', taskId: 'task-old' })
    expect(result.outcome).toBe('skipped')
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
    expect(llmMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('rejects an active non-expired run and recovers a timed-out run without an active task', async () => {
    db.tasks = [{ id: 'active', status: 'processing', targetId: 'item-0' }]
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running', stageStates: { script_rewrite: { status: 'running', taskIds: ['active'], startedAt: new Date().toISOString() } } })]
    await expect(runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite' })).rejects.toMatchObject({ code: 'STAGE_ALREADY_RUNNING' })
    db.tasks = []
    db.items[0].stageStates.script_rewrite.startedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString()
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite' })
    expect(result.outcome).toBe('running')
    expect(db.items[0].executionKey).not.toBe('exec')
  })

  it('skips a worker whose executionKey changed while its LLM call was in flight', async () => {
    runningItemForRace()
    llmMock.runModelGatewayTextCompletion.mockImplementation(async () => {
      db.items[0].executionKey = 'replacement'
      return { content: JSON.stringify({ scenes: [scene()] }) }
    })
    const result = await runWorkerForRace()
    expect(result.outcome).toBe('skipped')
    expect(db.items[0].stageOutputs.script_rewrite).toBeUndefined()
    expect(db.items[0].executionKey).toBe('replacement')
  })

  it('marks a disabled stage skipped without invoking the LLM', async () => {
    db.runs = [runRow()]
    const templateSnapshot = { ...runRow().templateSnapshot, stages: WORKFLOW_STAGES.map((stage) => ({ stage, label: stage, skillSlug: '', gateMode: 'manual_review', enabled: stage !== 'script_rewrite' })) }
    prismaMock.batchRun.findFirst.mockResolvedValue(runRow({ templateSnapshot }))
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite' })
    expect(result.outcome).toBe('skipped')
    expect(db.items[0].stageStates.script_rewrite.status).toBe('skipped')
    expect(llmMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('executes a legacy template snapshot with missing QC and stage params', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running', stageStates: { script_rewrite: { status: 'running', taskIds: ['task-1'], startedAt: new Date().toISOString() } } })]
    db.tasks = [{ id: 'task-1', status: 'processing' }]
    const templateSnapshot = { id: 'legacy', stages: [{ stage: 'script_rewrite', skillSlug: '', gateMode: 'manual_review' }] }
    prismaMock.batchRun.findFirst.mockResolvedValue(runRow({ templateSnapshot }))
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite', executionKey: 'exec', taskId: 'task-1' })
    expect(result.outcome).toBe('waiting_review')
    expect(db.items[0].stageOutputs.script_rewrite.scenes).toHaveLength(1)
  })
})

describe('workflow QC correction and model failures', () => {
  function runningItem(previous?: Record<string, unknown>) {
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running',
      stageOutputs: { script_analysis: { fullScriptText: '原始文本', beats: [] }, ...(previous ? { script_rewrite: previous } : {}) },
      stageStates: { script_rewrite: { status: 'running', taskIds: ['task-1'], startedAt: new Date().toISOString() } },
    })]
    db.tasks = [{ id: 'task-1', status: 'processing' }]
  }
  function runWorker() {
    return runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite', executionKey: 'exec', taskId: 'task-1' })
  }

  it('invokes the LLM exactly twice and attaches passed QC after one correction', async () => {
    runningItem()
    serviceMock.resolveWorkflowSkill.mockResolvedValue(skill('script_rewrite', { requiredKeywords: ['required'] }))
    llmMock.runModelGatewayTextCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ scenes: [scene('wrong')] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ scenes: [scene('required')] }) })
    const result = await runWorker()
    expect(llmMock.runModelGatewayTextCompletion).toHaveBeenCalledTimes(2)
    const correctionPrompt = llmMock.runModelGatewayTextCompletion.mock.calls[1][0].messages.at(-1).content
    expect(correctionPrompt).toContain('requiredKeywords')
    expect(result.outcome).toBe('waiting_review')
    expect(db.items[0].stageOutputs.script_rewrite.qc).toMatchObject({ status: 'passed', retryCount: 1 })
    expect(db.items[0].stageStates.script_rewrite).toMatchObject({ qcStatus: 'passed', attempt: 2, skillVersion: 3, modelKey: 'model-1' })
  })

  it('keeps the prior approved artifact and uses the worker QC failure sentinel after two failures', async () => {
    const previous = { scenes: [scene('approved')], fullScriptText: 'approved' }
    runningItem(previous)
    serviceMock.resolveWorkflowSkill.mockResolvedValue(skill('script_rewrite', { forbiddenKeywords: ['wrong'] }))
    llmMock.runModelGatewayTextCompletion.mockResolvedValue({ content: JSON.stringify({ scenes: [scene('wrong')] }) })
    const result = await runWorker()
    expect(llmMock.runModelGatewayTextCompletion).toHaveBeenCalledTimes(2)
    expect(result.outcome).toBe('failed')
    expect(result.item.errorMessage).toBe('质量检查失败')
    expect(db.items[0].stageOutputs.script_rewrite).toEqual(previous)
    expect(db.items[0].stageStates.script_rewrite).toMatchObject({ qcStatus: 'failed', attempt: 2, skillVersion: 3 })
  })

  it('uses edited S1 text and preserves sourceBeatId during worker normalization', async () => {
    runningItem()
    db.items[0].stageOutputs.script_analysis = { fullScriptText: 'old source', editedScriptText: 'edited source', beats: [] }
    llmMock.runModelGatewayTextCompletion.mockResolvedValue({ content: JSON.stringify({ scenes: [{ ...scene(), sourceBeatId: 'beat-7' }] }) })
    const result = await runWorker()
    expect(result.outcome).toBe('waiting_review')
    const prompt = llmMock.runModelGatewayTextCompletion.mock.calls[0][0].messages.at(-1).content
    expect(prompt).toContain('edited source')
    expect(prompt).not.toContain('old source')
    expect(db.items[0].stageOutputs.script_rewrite.scenes[0].sourceBeatId).toBe('beat-7')
  })

  it('fails instead of accepting a repaired but incomplete S2 JSON response', async () => {
    runningItem()
    llmMock.runModelGatewayTextCompletion.mockResolvedValue({ content: '{"scenes":[{"sceneIndex":1,"location":"店"}]}' })
    const result = await runWorker()
    expect(result.outcome).toBe('failed')
    expect(result.item.errorMessage).toBe('质量检查失败')
    expect(llmMock.runModelGatewayTextCompletion).toHaveBeenCalledTimes(2)
    expect(db.items[0].stageOutputs.script_rewrite).toBeUndefined()
  })

  it('retries S1 video analysis once with concrete QC violations', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', currentStage: 'script_analysis', status: 'running', inputPayload: { sourceVideoStorageKey: 'video.mp4' }, stageStates: { script_analysis: { status: 'running', taskIds: ['task-1'], startedAt: new Date().toISOString() } } })]
    db.tasks = [{ id: 'task-1', status: 'processing' }]
    serviceMock.resolveWorkflowSkill.mockResolvedValue(skill('script_analysis', { requiredKeywords: ['corrected'] }))
    videoMock.understandStorageVideoWithSkill
      .mockResolvedValueOnce({ json: { fullScriptText: 'wrong', beats: [] }, text: 'wrong', durationSeconds: 30, cutHints: [] })
      .mockResolvedValueOnce({ json: { fullScriptText: 'corrected', beats: [] }, text: 'corrected', durationSeconds: 30, cutHints: [] })
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_analysis', executionKey: 'exec', taskId: 'task-1' })
    expect(result.outcome).toBe('waiting_review')
    expect(videoMock.understandStorageVideoWithSkill).toHaveBeenCalledTimes(2)
    expect(videoMock.understandStorageVideoWithSkill.mock.calls[1][0].userPrompt).toContain('requiredKeywords')
    expect(db.items[0].stageOutputs.script_analysis.qc.retryCount).toBe(1)
  })

  it('fails without a provider fallback when the selected text model is unavailable', async () => {
    runningItem()
    llmMock.runModelGatewayTextCompletion.mockRejectedValue(new Error('provider offline'))
    const result = await runWorker()
    expect(result.outcome).toBe('failed')
    expect(llmMock.runModelGatewayTextCompletion).toHaveBeenCalledOnce()
    expect(db.items[0].errorMessage).toContain('不会自动切换模型')
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('normalizes saved S4 durations and rejects stale user revision', async () => {
    db.items = [itemRow(0, { revision: 2, currentStage: 'storyboard', stageOutputs: { script_analysis: { fullScriptText: 'edited', beats: [] } } })]
    const editedOutput = { shots: [{ shotId: 's1', durationSec: 7, videoPrompt: '近景', visualDescription: '近景', referencedAssetIds: [] }] }
    const result = await reviewBatchItemStage({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'storyboard', action: 'save_draft', editedOutput, expectedRevision: 2 })
    expect(result.item.revision).toBe(3)
    expect([4, 5, 6, 7, 8, 9, 10, 11, 12, 15]).toContain(db.items[0].stageOutputs.storyboard.shots[0].durationSec)
    expect(db.items[0].stageOutputs.storyboard.totalDurationSec).toBe(db.items[0].stageOutputs.storyboard.shots[0].durationSec)
    await expect(reviewBatchItemStage({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'storyboard', action: 'save_draft', editedOutput: { shots: [] }, expectedRevision: 3 })).rejects.toThrow('非空 shots')
    db.items[0].stageOutputs = { video_gen: {
      modelKey: 'video', aspectRatio: '9:16', resolution: '720p', generateAudio: false, inputMode: 'text', readyCount: 0, totalCount: 1, pendingCount: 0, failedCount: 0,
      shots: [{ shotId: 's1', takes: [{ takeIndex: 0, status: 'ready', videoUrl: 'url', prompt: 'p', modelKey: 'm', inputMode: 'text', aspectRatio: '9:16', resolution: '720p', durationSec: 5, generateAudio: false, submittedAt: new Date().toISOString() }], selectedTakeIndex: 0 }],
    } }
    await expect(selectShotTake({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', shotId: 's1', takeIndex: 0, expectedRevision: 1 })).rejects.toMatchObject({ code: 'STALE_REVISION', status: 409 })
    expect(db.items[0].stageOutputs.video_gen.shots[0].selectedTakeIndex).toBe(0)
  })
})

describe('workflow advance and sync concurrency', () => {
  it('schedules all candidates in batches with an in-flight peak of at most four', async () => {
    db.items = Array.from({ length: 6 }, (_, index) => itemRow(index))
    let active = 0
    let peak = 0
    submitMock.submitTask.mockImplementation(async ({ targetId, payload }: any) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      const task = { id: `task-${db.tasks.length + 1}`, status: 'queued', targetId, payload }
      db.tasks.push(task)
      return { taskId: task.id }
    })
    const result = await advanceBatchRun({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1' })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBe(4)
    expect(result.executedSteps).toHaveLength(6)
    expect(db.items.every((item) => item.status === 'running')).toBe(true)
  })

  it('does not reschedule non-expired running items during advance', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running', stageStates: { script_rewrite: { status: 'running', taskIds: ['task-1'], startedAt: new Date().toISOString() } } })]
    db.tasks = [{ id: 'task-1', status: 'processing' }]
    const result = await advanceBatchRun({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1' })
    expect(result.executedSteps).toEqual([])
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('clears a text worker executionKey when async S3 output is saved', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running' })]
    db.tasks = [{ id: 'task-1', status: 'processing' }]
    db.items[0].currentStage = 'asset_extraction'
    db.items[0].stageStates = { asset_extraction: { status: 'running', taskIds: ['task-1'], startedAt: new Date().toISOString() } }
    serviceMock.resolveWorkflowSkill.mockResolvedValue(skill('asset_extraction'))
    llmMock.runModelGatewayTextCompletion.mockResolvedValue({ content: JSON.stringify({ items: [{ id: 'asset-1', kind: 'character', name: '主角', imagePrompt: 'portrait' }] }) })
    const result = await runBatchItemStage({ workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'asset_extraction', executionKey: 'exec', taskId: 'task-1' })
    expect(result.outcome).toBe('waiting_review')
    expect(db.items[0].executionKey).toBeNull()
    expect(db.items[0].stageOutputs.asset_extraction.items).toHaveLength(1)
  })

  it('recomputes the latest row after a sync CAS conflict without losing another stage save', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', currentStage: 'script_rewrite', status: 'running', stageStates: {
      script_analysis: { status: 'completed' },
      script_rewrite: { status: 'running', taskIds: ['task-1'], startedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() },
    }, stageOutputs: {
      script_analysis: { sourceMode: 'pasted_script', title: 'old', summary: '', estimatedDurationSec: 30, characters: [], locations: [], props: [], beats: [], fullScriptText: 'old' },
      script_rewrite: { scenes: [scene('keep')] },
    } })]
    const firstUpdate = prismaMock.batchItem.updateMany.getMockImplementation()!
    let injectedSave = false
    prismaMock.batchItem.updateMany.mockImplementation(async (args: any) => {
      if (!injectedSave && args.data.status === 'failed') {
        injectedSave = true
        db.items[0].revision += 1
        db.items[0].stageOutputs.script_rewrite = { scenes: [scene('latest-save')] }
        return { count: 0 }
      }
      return await firstUpdate(args)
    })
    const saved = await reviewBatchItemStage({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'storyboard', action: 'save_draft', editedOutput: { shots: [{ shotId: 's1', durationSec: 5, videoPrompt: 'x', visualDescription: 'x', referencedAssetIds: [] }] } })
    const syncResult = await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1' })
    expect(injectedSave).toBe(true)
    expect(syncResult.changed).toBe(true)
    expect(db.items[0].stageOutputs.script_rewrite.scenes[0].visualAction).toBe('latest-save')
    expect(saved.item.stageOutputs.storyboard?.shots).toHaveLength(1)
  })
})

describe('S1-S4 timeout recovery during sync', () => {
  it('leaves an unexpired text-stage execution completely unchanged', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running', stageStates: { script_rewrite: { status: 'running', taskIds: [], startedAt: new Date().toISOString() } } })]
    const before = JSON.stringify(db.items[0])
    const result = await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1' })
    expect(result.changed).toBe(false)
    expect(JSON.stringify(db.items[0])).toBe(before)
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
  })

  it('fails a timed-out text stage without media changes and clears executionKey', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', status: 'running', stageStates: { script_rewrite: { status: 'running', taskIds: ['gone'], startedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() } } })]
    const result = await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1' })
    expect(result.changed).toBe(true)
    expect(db.items[0]).toMatchObject({ status: 'failed', executionKey: null, currentStage: 'script_rewrite' })
    expect(db.items[0].stageStates.script_rewrite).toMatchObject({ status: 'failed', error: '执行超时或中断，可重试。' })
  })

  it('recovers an expired S5 stage only after its async task has disappeared', async () => {
    db.items = [itemRow(0, { executionKey: 'exec', currentStage: 'video_gen', status: 'running', stageStates: { video_gen: { status: 'running', taskIds: ['video-task'], startedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() } }, stageOutputs: { video_gen: { shots: [{ shotId: 's1', takes: [{ takeIndex: 0, taskId: 'video-task', status: 'queued' }], selectedTakeIndex: 0 }] } } })]
    db.tasks = [{ id: 'video-task', status: 'processing' }]
    await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1' })
    expect(db.items[0]).toMatchObject({ status: 'running', executionKey: 'exec' })
    expect(db.items[0].stageOutputs.video_gen.shots[0].takes[0].status).toBe('processing')
    db.tasks = []
    expect((await syncBatchItemTaskStatuses({ workspaceOwnerId: 'ws-1', batchRunId: 'run-1' })).changed).toBe(true)
    expect(db.items[0]).toMatchObject({ status: 'failed', executionKey: null })
  })
})

describe('step revision guard and stageState traceability fields', () => {
  const stepParams = { workspaceOwnerId: 'ws-1', actorId: 'ws-1', batchRunId: 'run-1', itemId: 'item-0', stage: 'script_rewrite' as const }

  it('rejects a step whose expectedRevision is older than the stored revision without queueing anything', async () => {
    db.items = [itemRow(0, { revision: 5 })]
    await expect(runBatchItemStage({ ...stepParams, expectedRevision: 4 })).rejects.toMatchObject({ code: 'STALE_REVISION', status: 409 })
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
    expect(submitMock.submitTask).not.toHaveBeenCalled()
    expect(db.items[0]).toMatchObject({ revision: 5, status: 'queued', executionKey: null })
  })

  it('queues normally when expectedRevision matches, and when no expectedRevision is supplied', async () => {
    db.items = [itemRow(0, { revision: 5 })]
    const matched = await runBatchItemStage({ ...stepParams, expectedRevision: 5 })
    expect(matched.outcome).toBe('running')
    expect(submitMock.submitTask).toHaveBeenCalledOnce()

    db.items = [itemRow(0, { revision: 9 })]
    db.tasks = []
    submitMock.submitTask.mockClear()
    const legacy = await runBatchItemStage(stepParams)
    expect(legacy.outcome).toBe('running')
    expect(submitMock.submitTask).toHaveBeenCalledOnce()
  })

  it('does not report a spurious conflict after timeout recovery bumps the revision', async () => {
    db.items = [itemRow(0, {
      revision: 3, executionKey: 'exec', status: 'running',
      stageStates: { script_rewrite: { status: 'running', taskIds: ['gone'], startedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() } },
    })]
    const result = await runBatchItemStage({ ...stepParams, expectedRevision: 3 })
    expect(result.outcome).toBe('running')
    expect(db.items[0].executionKey).not.toBe('exec')
  })

  it('keeps qcStatus, attempt and modelKey when mapping a row, and adds no keys for legacy rows', async () => {
    const { mapBatchItemRow } = await import('@/lib/batch-workflow/service')
    const traced = mapBatchItemRow(itemRow(0, {
      stageStates: { script_rewrite: { status: 'waiting_review', skillSlug: 's', qcStatus: 'failed', attempt: 2, modelKey: 'model-1' } },
    }) as any)
    expect(traced.stageStates.script_rewrite).toMatchObject({ qcStatus: 'failed', attempt: 2, modelKey: 'model-1' })

    const legacy = mapBatchItemRow(itemRow(0, {
      stageStates: { script_rewrite: { status: 'completed', skillSlug: 's', qcStatus: 'bogus', attempt: 'x' } },
    }) as any)
    expect(legacy.stageStates.script_rewrite).not.toHaveProperty('qcStatus')
    expect(legacy.stageStates.script_rewrite).not.toHaveProperty('attempt')
    expect(legacy.stageStates.script_rewrite).not.toHaveProperty('modelKey')
  })
})
