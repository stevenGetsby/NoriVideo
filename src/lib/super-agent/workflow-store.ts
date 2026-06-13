import {
  appendRunEventWithSeq,
  createArtifact,
  createRun,
} from '@/lib/run-runtime/service'
import { RUN_EVENT_TYPE } from '@/lib/run-runtime/types'
import type { AgentExecutionPlan, AgentExecutionResult, SkillId } from './types'
import { normalizeAgentWorkspaceVideoUrl } from './workspace-url'

export const SUPER_AGENT_WORKFLOW_TYPE = 'super_agent_creation'
export const SUPER_AGENT_CHAT_EDIT_WORKFLOW_TYPE = 'super_agent_chat_edit'

type JsonRecord = Record<string, unknown>

function toPlainStage(stage: AgentExecutionPlan['stages'][number]) {
  return {
    stageId: stage.stageId,
    stageNumber: stage.stageNumber,
    title: stage.title,
    description: stage.description,
    estimatedDuration: stage.estimatedDuration,
    status: stage.status,
  }
}

export async function startAgentWorkflowRun(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  targetId: string
  plan: AgentExecutionPlan
  userInput: string
}) {
  const run = await createRun({
    userId: params.userId,
    projectId: params.projectId,
    episodeId: params.episodeId || null,
    workflowType: SUPER_AGENT_WORKFLOW_TYPE,
    taskType: SUPER_AGENT_WORKFLOW_TYPE,
    targetType: 'project',
    targetId: params.targetId,
    input: {
      userInput: params.userInput,
      selectedSkill: params.plan.selectedSkill,
      skillDescription: params.plan.skillDescription,
      executionMode: params.plan.executionMode,
      creativeParameters: params.plan.creativeParameters as JsonRecord,
      projectConfig: params.plan.projectConfig,
      episodeConfig: params.plan.episodeConfig,
      stages: params.plan.stages.map(toPlainStage),
    },
  })

  await appendRunEventWithSeq({
    runId: run.id,
    projectId: params.projectId,
    userId: params.userId,
    eventType: RUN_EVENT_TYPE.RUN_START,
    payload: {
      selectedSkill: params.plan.selectedSkill,
      executionMode: params.plan.executionMode,
    },
  })

  return run
}

export async function completeAgentWorkflowRun(params: {
  runId: string
  userId: string
  result: AgentExecutionResult
  plan: AgentExecutionPlan
}) {
  const workspaceUrl = normalizeAgentWorkspaceVideoUrl(params.result.workspaceUrl, params.result.episodeId)
  const artifactPayload = {
    workflowType: SUPER_AGENT_WORKFLOW_TYPE,
    selectedSkill: params.plan.selectedSkill,
    skillDescription: params.plan.skillDescription,
    executionMode: params.plan.executionMode,
    creativeParameters: params.plan.creativeParameters as JsonRecord,
    projectId: params.result.projectId,
    episodeId: params.result.episodeId,
    workspaceUrl,
    stageResults: params.result.stageResults as JsonRecord,
    summary: params.result.summary,
    errors: params.result.errors,
  }

  await createArtifact({
    runId: params.runId,
    stepKey: '__run__',
    artifactType: 'super_agent.workflow_snapshot',
    refId: params.result.projectId,
    payload: artifactPayload,
  })
  await createArtifact({
    runId: params.runId,
    stepKey: 'stage_1',
    artifactType: 'project',
    refId: params.result.projectId,
    payload: {
      projectId: params.result.projectId,
      episodeId: params.result.episodeId,
      selectedSkill: params.plan.selectedSkill,
    },
  })
  await createArtifact({
    runId: params.runId,
    stepKey: 'stage_1',
    artifactType: 'episode',
    refId: params.result.episodeId,
    payload: {
      projectId: params.result.projectId,
      episodeId: params.result.episodeId,
      selectedSkill: params.plan.selectedSkill,
    },
  })

  await appendRunEventWithSeq({
    runId: params.runId,
    projectId: params.result.projectId,
    userId: params.userId,
    eventType: RUN_EVENT_TYPE.RUN_COMPLETE,
    payload: artifactPayload,
  })
}

export async function failAgentWorkflowRun(params: {
  runId: string
  userId: string
  projectId: string
  errorMessage: string
  details?: JsonRecord
}) {
  await appendRunEventWithSeq({
    runId: params.runId,
    projectId: params.projectId,
    userId: params.userId,
    eventType: RUN_EVENT_TYPE.RUN_ERROR,
    payload: {
      errorCode: 'SUPER_AGENT_EXECUTION_ERROR',
      errorMessage: params.errorMessage,
      message: params.errorMessage,
      ...(params.details ? { details: params.details } : {}),
    },
  })
}

export async function recordAgentWorkflowStage(params: {
  runId: string
  userId: string
  projectId: string
  stage: AgentExecutionPlan['stages'][number]
  status: 'running' | 'completed' | 'failed'
  percent: number
  message?: string
  details?: JsonRecord
}) {
  const eventType = params.status === 'failed'
    ? RUN_EVENT_TYPE.STEP_ERROR
    : params.status === 'completed'
      ? RUN_EVENT_TYPE.STEP_COMPLETE
      : RUN_EVENT_TYPE.STEP_START
  await appendRunEventWithSeq({
    runId: params.runId,
    projectId: params.projectId,
    userId: params.userId,
    eventType,
    stepKey: params.stage.stageId,
    payload: {
      stepId: params.stage.stageId,
      stepTitle: params.stage.title,
      stepIndex: params.stage.stageNumber,
      stepTotal: 7,
      status: params.status,
      percent: Math.max(0, Math.min(100, Math.round(params.percent))),
      message: params.message || params.stage.description,
      artifactType: params.status === 'failed' ? 'agent.stage.error' : 'agent.stage.progress',
      artifactRefId: params.stage.stageId,
      artifactPayload: {
        stageId: params.stage.stageId,
        title: params.stage.title,
        description: params.stage.description,
        status: params.status,
        percent: Math.max(0, Math.min(100, Math.round(params.percent))),
        message: params.message || params.stage.description,
        ...(params.details ? { details: params.details } : {}),
      },
      ...(params.details ? { details: params.details } : {}),
    },
  })
}

export async function recordAgentChatEditWorkflow(params: {
  userId: string
  projectId: string
  episodeId: string
  selectedSkill?: SkillId | null
  instruction: string
  appliedChanges: JsonRecord
}) {
  const run = await createRun({
    userId: params.userId,
    projectId: params.projectId,
    episodeId: params.episodeId,
    workflowType: SUPER_AGENT_CHAT_EDIT_WORKFLOW_TYPE,
    taskType: SUPER_AGENT_CHAT_EDIT_WORKFLOW_TYPE,
    targetType: 'episode',
    targetId: params.episodeId,
    input: {
      instruction: params.instruction,
      selectedSkill: params.selectedSkill || null,
    },
  })

  await appendRunEventWithSeq({
    runId: run.id,
    projectId: params.projectId,
    userId: params.userId,
    eventType: RUN_EVENT_TYPE.RUN_START,
    payload: {
      instruction: params.instruction,
      selectedSkill: params.selectedSkill || null,
    },
  })

  await createArtifact({
    runId: run.id,
    stepKey: '__run__',
    artifactType: 'super_agent.chat_edit',
    refId: params.episodeId,
    payload: {
      instruction: params.instruction,
      selectedSkill: params.selectedSkill || null,
      appliedChanges: params.appliedChanges,
    },
  })

  await appendRunEventWithSeq({
    runId: run.id,
    projectId: params.projectId,
    userId: params.userId,
    eventType: RUN_EVENT_TYPE.RUN_COMPLETE,
    payload: {
      instruction: params.instruction,
      selectedSkill: params.selectedSkill || null,
      appliedChanges: params.appliedChanges,
    },
  })

  return run
}
