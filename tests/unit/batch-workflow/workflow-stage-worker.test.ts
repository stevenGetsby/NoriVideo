import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const runBatchItemStageMock = vi.hoisted(() => vi.fn())
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const flushMock = vi.hoisted(() => vi.fn(async () => undefined))
const callbacksMock = vi.hoisted(() => vi.fn(() => ({ flush: flushMock })))

vi.mock('@/lib/batch-workflow/executor', () => ({ runBatchItemStage: runBatchItemStageMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'stream-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: callbacksMock,
}))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks, run: () => Promise<unknown>) => await run()),
}))

import { handleBatchWorkflowStageTask } from '@/lib/workers/handlers/batch-workflow'

function buildJob(payload?: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.WORKFLOW_STAGE_RUN,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'BatchItem',
      targetId: 'item-1',
      userId: 'workspace-owner-1',
      payload: payload ?? {
        batchRunId: 'run-1',
        executionKey: 'execution-1',
        actorId: 'member-1',
        stage: 'script_rewrite',
        stageParamsOverride: { temperature: 0.3 },
      },
    },
  } as Job<TaskJobData>
}

function result(outcome: string, overrides: Record<string, unknown> = {}) {
  return {
    item: {
      id: 'item-1',
      errorMessage: null,
      stageStates: { script_rewrite: { status: 'waiting_review', qcStatus: 'passed' } },
      ...overrides,
    },
    run: { id: 'run-1' },
    stage: 'script_rewrite',
    outcome,
  }
}

describe('handleBatchWorkflowStageTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores workspace owner and actor from the trusted task data', async () => {
    runBatchItemStageMock.mockResolvedValue(result('waiting_review'))
    const job = buildJob()
    await expect(handleBatchWorkflowStageTask(job)).resolves.toMatchObject({
      itemId: 'item-1',
      batchRunId: 'run-1',
      outcome: 'waiting_review',
    })
    expect(runBatchItemStageMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceOwnerId: 'workspace-owner-1',
      actorId: 'member-1',
      itemId: 'item-1',
      executionKey: 'execution-1',
      taskId: 'task-1',
      stageParamsOverride: { temperature: 0.3 },
    }))
    expect(flushMock).toHaveBeenCalledTimes(1)
    expect(reportTaskProgressMock).toHaveBeenLastCalledWith(job, 100, expect.objectContaining({
      stage: 'batch_workflow_stage_finished',
      outcome: 'waiting_review',
    }))
  })

  it('treats a duplicate execution as skipped without throwing or writing results', async () => {
    runBatchItemStageMock.mockResolvedValue(result('skipped'))
    const job = buildJob()
    await expect(handleBatchWorkflowStageTask(job)).resolves.toEqual({
      itemId: 'item-1', batchRunId: 'run-1', stage: 'script_rewrite', outcome: 'skipped',
    })
    expect(reportTaskProgressMock).toHaveBeenCalledTimes(2)
    expect(reportTaskProgressMock).toHaveBeenLastCalledWith(job, 100, expect.objectContaining({
      stage: 'batch_workflow_stage_skipped', executionKey: 'execution-1',
    }))
  })

  it('maps QC failures to QC_FAILED', async () => {
    runBatchItemStageMock.mockResolvedValue(result('failed', {
      errorMessage: '质检未通过：缺少必需关键词',
      stageStates: { script_rewrite: { status: 'failed', qcStatus: 'failed' } },
    }))
    await expect(handleBatchWorkflowStageTask(buildJob())).rejects.toMatchObject({
      code: 'QC_FAILED', message: '质检未通过：缺少必需关键词',
    })
  })

  it('maps model resolution failures to MODEL_UNAVAILABLE', async () => {
    runBatchItemStageMock.mockResolvedValue(result('failed', {
      errorMessage: '无法解析文本模型（gpt-test），请检查后台模型路由与 API Key 配置',
      stageStates: { script_rewrite: { status: 'failed', qcStatus: undefined } },
    }))
    await expect(handleBatchWorkflowStageTask(buildJob())).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
  })

  it('maps other stage failures to EXTERNAL_ERROR', async () => {
    runBatchItemStageMock.mockResolvedValue(result('failed', {
      errorMessage: '网络连接中断',
      stageStates: { script_rewrite: { status: 'failed', qcStatus: undefined } },
    }))
    await expect(handleBatchWorkflowStageTask(buildJob())).rejects.toMatchObject({ code: 'EXTERNAL_ERROR' })
  })

  it.each([
    ['batchRunId', { executionKey: 'execution-1', stage: 'script_rewrite' }],
    ['executionKey', { batchRunId: 'run-1', stage: 'script_rewrite' }],
    ['stage', { batchRunId: 'run-1', executionKey: 'execution-1' }],
  ])('rejects a missing %s as INVALID_PARAMS', async (_name, payload) => {
    await expect(handleBatchWorkflowStageTask(buildJob(payload))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(runBatchItemStageMock).not.toHaveBeenCalled()
  })
})
