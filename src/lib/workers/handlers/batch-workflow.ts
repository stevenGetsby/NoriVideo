import type { Job } from 'bullmq'
import { ApiError } from '@/lib/api-errors'
import { runBatchItemStage } from '@/lib/batch-workflow/executor'
import { isWorkflowStage, type StageParams, type WorkflowStage } from '@/lib/batch-workflow/types'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

export async function handleBatchWorkflowStageTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const stage = payload.stage
  const batchRunId = typeof payload.batchRunId === 'string' ? payload.batchRunId : ''
  const executionKey = typeof payload.executionKey === 'string' ? payload.executionKey : ''
  const actorId = typeof payload.actorId === 'string' ? payload.actorId : job.data.userId
  if (!batchRunId || !executionKey || !isWorkflowStage(stage)) {
    throw new ApiError('INVALID_PARAMS', { message: 'workflow_stage_run requires batchRunId, executionKey and a valid stage.' })
  }

  await reportTaskProgress(job, 20, { stage: 'batch_workflow_stage_start', workflowStage: stage, executionKey })
  const streamContext = createWorkerLLMStreamContext(job, `batch_workflow_${stage}`)
  const callbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const { withInternalLLMStreamCallbacks } = await import('@/lib/llm-observe/internal-stream-context')
  const result = await withInternalLLMStreamCallbacks(callbacks, async () => await runBatchItemStage({
    workspaceOwnerId: job.data.userId,
    actorId,
    batchRunId,
    itemId: job.data.targetId,
    stage: stage as WorkflowStage,
    skillIdOverride: typeof payload.skillIdOverride === 'string' ? payload.skillIdOverride : null,
    skillSlugOverride: typeof payload.skillSlugOverride === 'string' ? payload.skillSlugOverride : null,
    stageParamsOverride: (payload.stageParamsOverride || null) as StageParams | null,
    targetStage: typeof payload.targetStage === 'string' && isWorkflowStage(payload.targetStage) ? payload.targetStage : null,
    locale: job.data.locale,
    executionKey,
    taskId: job.data.taskId,
  }))
  await callbacks.flush()

  if (result.outcome === 'skipped') {
    await reportTaskProgress(job, 100, {
      stage: 'batch_workflow_stage_skipped',
      workflowStage: stage,
      executionKey,
    })
    return { itemId: result.item.id, batchRunId, stage, outcome: 'skipped' }
  }

  if (result.outcome === 'failed') {
    const stageState = result.item.stageStates[stage]
    const errorMessage = result.item.errorMessage || `工作流阶段 ${stage} 执行失败。`
    const code = stageState.qcStatus === 'failed'
      ? 'QC_FAILED'
      : /模型.*(不可用|失败)|无法解析.*模型|调用文本大模型失败/.test(errorMessage)
        ? 'MODEL_UNAVAILABLE'
        : 'EXTERNAL_ERROR'
    throw new ApiError(code, { message: errorMessage })
  }
  await reportTaskProgress(job, 100, { stage: 'batch_workflow_stage_finished', workflowStage: stage, outcome: result.outcome })
  return { itemId: result.item.id, batchRunId, stage, outcome: result.outcome }
}
