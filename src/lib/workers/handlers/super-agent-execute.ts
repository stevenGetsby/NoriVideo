import type { Job } from 'bullmq'
import { SuperAgentOrchestrator } from '@/lib/super-agent/orchestrator'
import type { AgentContext, AgentExecutionMode, AgentExecutionPlan } from '@/lib/super-agent/types'
import { failAgentWorkflowRun } from '@/lib/super-agent/workflow-store'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readExecutionMode(value: unknown): AgentExecutionMode | undefined {
  return value === 'live' || value === 'mock' ? value : undefined
}

function readPlan(value: unknown): AgentExecutionPlan {
  const plan = asRecord(value)
  if (!plan.projectConfig || !plan.episodeConfig || !Array.isArray(plan.stages)) {
    throw new Error('super_agent_execute requires a valid AgentExecutionPlan payload')
  }
  return plan as unknown as AgentExecutionPlan
}

export async function handleSuperAgentExecuteTask(job: Job<TaskJobData>) {
  const payload = asRecord(job.data.payload)
  const runId = readString(payload.runId) || readString(asRecord(payload.meta).runId)
  const userInput = readString(payload.userInput)
  const targetProjectId = readString(payload.targetProjectId) || job.data.projectId
  const plan = readPlan(payload.plan)

  if (!userInput) {
    throw new Error('super_agent_execute requires userInput')
  }
  if (!runId) {
    throw new Error('super_agent_execute requires runId')
  }

  const context: AgentContext = {
    userId: job.data.userId,
    locale: job.data.locale,
    userInput,
    targetProjectId,
    workflowRunId: runId,
    executionMode: readExecutionMode(payload.executionMode),
  }

  try {
    await reportTaskProgress(job, 10, {
      stage: 'super_agent_execute',
      message: 'Agent 自动创作任务已进入后台队列，开始执行完整成片工作流。',
      runId,
    })
    const result = await new SuperAgentOrchestrator().executePlan(plan, context)
    return {
      projectId: result.projectId,
      episodeId: result.episodeId,
      workspaceUrl: result.workspaceUrl,
      status: result.status,
      errors: result.errors,
      runId,
    }
  } catch (error) {
    await failAgentWorkflowRun({
      runId,
      userId: job.data.userId,
      projectId: targetProjectId,
      errorMessage: error instanceof Error ? error.message : String(error),
      details: {
        taskId: job.data.taskId,
      },
    }).catch(() => undefined)
    throw error
  }
}
