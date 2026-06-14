import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { queryTasks } from '@/lib/task/service'
import { type TaskStatus } from '@/lib/task/types'
import { normalizeTaskError } from '@/lib/errors/normalize'
import {
  isInternalAgentTaskType,
  isPublicTaskApiVisible,
} from '@/lib/super-agent/internal-run-visibility'

function withTaskError(task: Awaited<ReturnType<typeof queryTasks>>[number]) {
  const error = normalizeTaskError(task.errorCode, task.errorMessage)
  return {
    ...task,
    error,
  }
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const searchParams = request.nextUrl.searchParams
  const projectId = searchParams.get('projectId') || undefined
  const targetType = searchParams.get('targetType') || undefined
  const targetId = searchParams.get('targetId') || undefined
  const status = searchParams.getAll('status')
  const type = searchParams.getAll('type')
  const limit = Number.parseInt(searchParams.get('limit') || '50', 10)
  const responseLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50
  const readLimit = type.length > 0 ? responseLimit : Math.min(Math.max(responseLimit * 5, responseLimit), 500)
  const visibleTypes = type.filter((item) => !isInternalAgentTaskType(item) || isPublicTaskApiVisible({ type: item }))
  if (type.length > 0 && visibleTypes.length === 0) {
    return NextResponse.json({ tasks: [] })
  }

  const tasks = await queryTasks({
    userId: session.user.id,
    projectId,
    targetType,
    targetId,
    status: status.length ? (status as TaskStatus[]) : undefined,
    type: visibleTypes.length ? visibleTypes : undefined,
    limit: readLimit,
  })

  const filtered = tasks.filter(isPublicTaskApiVisible).slice(0, responseLimit).map(withTaskError)
  return NextResponse.json({ tasks: filtered })
})
