import { redis } from '@/lib/redis'
import { appendRunEventWithSeq } from './service'
import type { RunEventInput } from './types'
import { recordWorkflowStageProgressFromRunEvent } from '@/lib/workspace/workflow-stage-state-store'

const RUN_CHANNEL_PREFIX = 'run-events:project:'

export function getProjectRunChannel(projectId: string) {
  return `${RUN_CHANNEL_PREFIX}${projectId}`
}

export async function publishRunEvent(input: RunEventInput) {
  const event = await appendRunEventWithSeq(input)
  await recordWorkflowStageProgressFromRunEvent(input).catch((error) => {
    console.warn('[workflow-stage-state] failed to project run event', {
      runId: input.runId,
      projectId: input.projectId,
      eventType: input.eventType,
      stepKey: input.stepKey || null,
      error,
    })
  })
  const message = {
    id: event.id,
    type: 'run.event',
    runId: event.runId,
    projectId: event.projectId,
    userId: event.userId,
    seq: event.seq,
    eventType: event.eventType,
    stepKey: event.stepKey || null,
    attempt: event.attempt || null,
    lane: event.lane || null,
    payload: event.payload || null,
    ts: event.createdAt,
  }
  await redis.publish(getProjectRunChannel(event.projectId), JSON.stringify(message))
  return message
}
