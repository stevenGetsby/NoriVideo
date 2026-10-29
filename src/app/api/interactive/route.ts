import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, requireUserPermission } from '@/lib/api-auth'
import { createInteractiveStory, findInteractiveStoryByProject, listInteractiveStories } from '@/lib/interactive/service'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const projectId = request.nextUrl.searchParams.get('projectId')
  if (projectId) return NextResponse.json({ story: await findInteractiveStoryByProject(authResult.session, projectId) })
  return NextResponse.json({ stories: await listInteractiveStories(authResult.session) })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserPermission(['projectCreate', 'canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const story = await createInteractiveStory(authResult.session, {
    name: body.name,
    aspectRatio: body.aspectRatio,
    resolution: body.resolution,
  })
  return NextResponse.json({ story }, { status: 201 })
})
