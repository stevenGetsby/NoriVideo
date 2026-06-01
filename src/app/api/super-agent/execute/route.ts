/**
 * API Route: /api/super-agent/execute
 * 执行计划
 */

import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { SuperAgentOrchestrator } from '@/lib/super-agent/orchestrator'
import type { AgentExecutionPlan } from '@/lib/super-agent/types'
import { normalizeCreativeParameters, normalizeExecutionMode } from '@/lib/super-agent/plan-utils'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { plan, userInput, locale, executionMode } = body

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

  try {
    const result = await orchestrator.executePlan(
      {
        ...executionPlan,
        executionMode: normalizeExecutionMode(executionMode ?? executionPlan.executionMode),
        creativeParameters: normalizeCreativeParameters(executionPlan.creativeParameters),
      },
      {
        userId: authResult.session.user.id,
        locale: locale || 'zh',
        userInput: userInput.trim(),
      }
    )

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
