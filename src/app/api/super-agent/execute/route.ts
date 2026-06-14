/**
 * API Route: /api/super-agent/execute
 * 执行计划
 */

import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { SuperAgentOrchestrator } from '@/lib/super-agent/orchestrator'
import type { AgentExecutionPlan } from '@/lib/super-agent/types'
import { normalizeAgentExecutionPlan, normalizeCreativeParameters, normalizeExecutionMode } from '@/lib/super-agent/plan-utils'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { failAgentWorkflowRun, startAgentWorkflowRun } from '@/lib/super-agent/workflow-store'
import { attachTaskToRun } from '@/lib/run-runtime/service'
import { assertInternalAgentApiEnabled } from '@/lib/super-agent/internal-api-guard'

export const POST = apiHandler(async (request: NextRequest) => {
  assertInternalAgentApiEnabled()

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { plan, userInput, locale, executionMode, targetProjectId, responseMode } = body

  if (!plan || typeof plan !== 'object') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_PLAN',
      field: 'plan',
      message: 'plan is required and must be an object',
    })
  }

  if (!userInput || typeof userInput !== 'string') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_USER_INPUT',
      field: 'userInput',
      message: 'userInput is required',
    })
  }

  const orchestrator = new SuperAgentOrchestrator()
  const executionPlan = plan as AgentExecutionPlan
  const normalizedPlan = normalizeAgentExecutionPlan({
    ...executionPlan,
    executionMode: normalizeExecutionMode(executionMode ?? executionPlan.executionMode),
    creativeParameters: normalizeCreativeParameters(executionPlan.creativeParameters),
  })
  const executionContext = {
    userId: authResult.session.user.id,
    locale: locale || 'zh',
    userInput: userInput.trim(),
    targetProjectId: typeof targetProjectId === 'string' && targetProjectId.trim()
      ? targetProjectId.trim()
      : undefined,
  }

  if (responseMode === 'background') {
    if (!executionContext.targetProjectId) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'TARGET_PROJECT_REQUIRED',
        field: 'targetProjectId',
        message: 'targetProjectId is required for background Agent execution',
      })
    }
    const targetProject = await prisma.project.findFirst({
      where: {
        id: executionContext.targetProjectId,
        userId: executionContext.userId,
      },
      select: { id: true },
    })
    if (!targetProject) {
      throw new ApiError('NOT_FOUND', {
        code: 'TARGET_PROJECT_NOT_FOUND',
        field: 'targetProjectId',
        message: 'Target project not found',
      })
    }
  }

  try {
    if (responseMode === 'background') {
      const workflowRun = await startAgentWorkflowRun({
        userId: executionContext.userId,
        projectId: executionContext.targetProjectId!,
        episodeId: null,
        targetId: executionContext.targetProjectId!,
        plan: normalizedPlan,
        userInput: executionContext.userInput,
      })
      try {
        const submitResult = await submitTask({
          userId: executionContext.userId,
          locale: executionContext.locale,
          projectId: executionContext.targetProjectId!,
          episodeId: null,
          type: TASK_TYPE.SUPER_AGENT_EXECUTE,
          targetType: 'project',
          targetId: executionContext.targetProjectId!,
          payload: {
            plan: normalizedPlan,
            userInput: executionContext.userInput,
            targetProjectId: executionContext.targetProjectId!,
            executionMode: normalizedPlan.executionMode,
            runId: workflowRun.id,
            meta: {
              runId: workflowRun.id,
            },
          },
        })
        await attachTaskToRun(workflowRun.id, submitResult.taskId)
        return Response.json({
          async: true,
          status: 'accepted',
          targetProjectId: executionContext.targetProjectId || null,
          runId: workflowRun.id,
          taskId: submitResult.taskId,
        }, { status: 202 })
      } catch (submitError) {
        await failAgentWorkflowRun({
          runId: workflowRun.id,
          userId: executionContext.userId,
          projectId: executionContext.targetProjectId!,
          errorMessage: submitError instanceof Error ? submitError.message : String(submitError),
          details: { phase: 'submit_task' },
        }).catch(() => undefined)
        throw submitError
      }
    }

    const result = await orchestrator.executePlan(normalizedPlan, executionContext)

    return Response.json({ result })
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'EXECUTION_FAILED',
        message: error.message,
      })
    }
    throw error
  }
})
