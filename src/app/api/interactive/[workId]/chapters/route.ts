import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { createInteractiveChapter } from '@/lib/interactive/service'

export const POST = apiHandler(async (request: NextRequest, context: { params: Promise<{ workId: string }> }) => {
  const authResult = await requireUserPermission(['projectCreate', 'canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const chapter = await createInteractiveChapter(authResult.session, workId, { name: body.name })
  return NextResponse.json({ chapter }, { status: 201 })
})
