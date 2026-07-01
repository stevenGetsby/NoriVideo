import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { runProjectImportPipeline } from '@/lib/novel-promotion/project-import-pipeline'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const content = typeof body.content === 'string' ? body.content : null
  const result = await runProjectImportPipeline({
    userId: session.user.id,
    projectId,
    content,
  })

  return NextResponse.json(result)
})
