/**
 * API Route: /api/super-agent/plan
 * 生成执行计划
 */

import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { SuperAgentOrchestrator } from '@/lib/super-agent/orchestrator'
import { normalizeExecutionMode } from '@/lib/super-agent/plan-utils'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { userInput, locale, executionMode, parameters } = body

  if (!userInput || typeof userInput !== 'string' || !userInput.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_USER_INPUT',
      field: 'userInput',
      message: 'userInput is required and must be a non-empty string',
    })
  }

  const orchestrator = new SuperAgentOrchestrator()

  try {
    const plan = await orchestrator.createExecutionPlan({
      userId: authResult.session.user.id,
      locale: locale || 'zh',
      userInput: userInput.trim(),
      executionMode: normalizeExecutionMode(executionMode),
      parameters: parameters && typeof parameters === 'object' && !Array.isArray(parameters)
        ? parameters
        : undefined,
    })

    return Response.json({ plan })
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'PLAN_GENERATION_FAILED',
        message: error.message,
      })
    }
    throw error
  }
})
