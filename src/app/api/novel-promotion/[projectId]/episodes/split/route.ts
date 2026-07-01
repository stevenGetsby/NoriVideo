import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'

/**
 * 规则分集 API（任务化）：只按“第一集/第二集...”等显式标题切分。
 */
export const POST = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const content = typeof body?.content === 'string' ? body.content : ''

  if (!content) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (content.length < 100) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await submitTask({
    userId: session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    projectId,
    type: TASK_TYPE.EPISODE_SPLIT_LLM,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    payload: {
      content,
      displayMode: 'loading',
      flowId: 'single:episode_split_rule',
      flowStageIndex: 1,
      flowStageTotal: 1,
      flowStageTitle: '规则分集',
    },
    dedupeKey: `episode_split_rule:${projectId}:${content.length}`,
    requestId: getRequestId(request),
  })

  return NextResponse.json(result)
})
