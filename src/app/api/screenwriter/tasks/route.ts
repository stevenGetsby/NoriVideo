import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { listScreenwriterTasks } from '@/lib/screenwriter/service'
import type { ScreenwriterTaskKind, ScreenwriterTaskStatus } from '@/lib/screenwriter/types'
import { parsePositiveInt, readOptionalString } from '../_utils'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id

  const query = request.nextUrl.searchParams
  const result = await listScreenwriterTasks({
    userId,
    status: readOptionalString(query.get('status')) as ScreenwriterTaskStatus | undefined,
    taskKind: readOptionalString(query.get('taskKind')) as ScreenwriterTaskKind | undefined,
    search: readOptionalString(query.get('search')),
    page: parsePositiveInt(query.get('page'), 1),
    pageSize: parsePositiveInt(query.get('pageSize'), 50),
  })

  return NextResponse.json(result)
})
