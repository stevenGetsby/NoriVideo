import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { deleteInteractiveChapter } from '@/lib/interactive/service'

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ workId: string; projectId: string }> },
) => {
  const authResult = await requireUserPermission(['projectCreate', 'canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId, projectId } = await context.params
  return NextResponse.json(await deleteInteractiveChapter(authResult.session, workId, projectId))
})
