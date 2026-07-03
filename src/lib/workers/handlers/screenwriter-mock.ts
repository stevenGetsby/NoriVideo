import type { Job } from 'bullmq'
import { reportTaskProgress } from '@/lib/workers/shared'
import type { TaskJobData } from '@/lib/task/types'
import {
  completeAutoSplitMockStage,
  completeEpisodeRepaintMockStage,
  completeFactExtractMockStage,
  completeTargetSettingsMockStage,
} from '@/lib/screenwriter/workflow'
import { enqueueScreenwriterMockStage, type ScreenwriterMockStage } from '@/lib/screenwriter/task-producer'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readPayload(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const screenwriterTaskId = typeof payload.screenwriterTaskId === 'string' && payload.screenwriterTaskId.trim()
    ? payload.screenwriterTaskId.trim()
    : job.data.targetId
  const stage = typeof payload.stage === 'string' ? payload.stage : ''
  const sleepMs = typeof payload.sleepMs === 'number' && Number.isFinite(payload.sleepMs)
    ? Math.max(0, Math.floor(payload.sleepMs))
    : 10_000
  if (!screenwriterTaskId) throw new Error('screenwriter_mock requires screenwriterTaskId')
  if (stage !== 'auto_split' && stage !== 'fact_extract' && stage !== 'target_settings' && stage !== 'episode_repaint') {
    throw new Error(`Unsupported screenwriter mock stage: ${stage}`)
  }
  return {
    screenwriterTaskId,
    stage: stage as ScreenwriterMockStage,
    sleepMs,
  }
}

export async function handleScreenwriterMockTask(job: Job<TaskJobData>) {
  const payload = readPayload(job)
  await reportTaskProgress(job, 10, {
    stage: `screenwriter_mock:${payload.stage}`,
    screenwriterTaskId: payload.screenwriterTaskId,
  })
  await sleep(payload.sleepMs)

  if (payload.stage === 'auto_split') {
    const result = await completeAutoSplitMockStage({
      screenwriterTaskId: payload.screenwriterTaskId,
      workerTaskId: job.data.taskId,
    })
    if (!result.skipped) {
      await enqueueScreenwriterMockStage({
        userId: job.data.userId,
        taskId: payload.screenwriterTaskId,
        stage: 'fact_extract',
        requestId: job.data.trace?.requestId || null,
        locale: job.data.locale,
      })
    }
    return { stage: payload.stage, nextStage: 'fact_extract', ...result }
  }

  if (payload.stage === 'fact_extract') {
    const result = await completeFactExtractMockStage({
      screenwriterTaskId: payload.screenwriterTaskId,
      workerTaskId: job.data.taskId,
    })
    return { stage: payload.stage, ...result }
  }

  if (payload.stage === 'target_settings') {
    const result = await completeTargetSettingsMockStage({
      screenwriterTaskId: payload.screenwriterTaskId,
      workerTaskId: job.data.taskId,
    })
    return { stage: payload.stage, ...result }
  }

  const result = await completeEpisodeRepaintMockStage({
    screenwriterTaskId: payload.screenwriterTaskId,
    workerTaskId: job.data.taskId,
  })
  return { stage: payload.stage, ...result }
}
