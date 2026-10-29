import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, requireUserPermission } from '@/lib/api-auth'
import { getInteractiveStory, updateInteractiveStory } from '@/lib/interactive/service'

type RouteContext = { params: Promise<{ workId: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  return NextResponse.json(await getInteractiveStory(authResult.session, workId))
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  return NextResponse.json(await updateInteractiveStory(authResult.session, workId, {
    name: body.name,
    aspectRatio: body.aspectRatio,
    resolution: body.resolution,
    config: body.config,
  }))
})
