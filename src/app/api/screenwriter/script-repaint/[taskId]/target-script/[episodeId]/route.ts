import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { updateTargetScriptEpisode } from '@/lib/screenwriter/service'
import { ensureFound, readJsonObject, readOptionalString, readString } from '../../../../_utils'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string; episodeId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId, episodeId } = await context.params
  const body = await readJsonObject(request)
  const content = readString(body.content)
  if (!content) {
    throw new ApiError('INVALID_PARAMS', { field: 'content' })
  }
  const episode = ensureFound(await updateTargetScriptEpisode({
    userId,
    taskId,
    episodeId,
    title: readOptionalString(body.title),
    content,
  }))
  return NextResponse.json({ success: true, episode })
})
