import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { readEpisodeRebuildImpact } from '@/lib/novel-promotion/rebuild-impact'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim() || ''

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const impact = await readEpisodeRebuildImpact({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
  })

  if (!impact) {
    throw new ApiError('NOT_FOUND')
  }

  return NextResponse.json(impact)
})
