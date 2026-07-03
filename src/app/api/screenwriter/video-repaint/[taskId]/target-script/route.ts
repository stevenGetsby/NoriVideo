import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { listTargetScriptEpisodes } from '@/lib/screenwriter/service'
import { ensureFound } from '../../../_utils'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId } = await context.params
  const episodeNumberRaw = Number.parseInt(request.nextUrl.searchParams.get('episodeNumber') || '', 10)
  const episodes = ensureFound(await listTargetScriptEpisodes({
    userId,
    taskId,
    episodeNumber: Number.isFinite(episodeNumberRaw) ? episodeNumberRaw : null,
  }))
  return NextResponse.json({ episodes })
})
