import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { assertCanvasAgentProjectSupported } from '@/lib/canvas-agent/project-scope'
import { listCanvasAgentThreads } from '@/lib/canvas-agent/threads'
import { requireCanvasInProject } from '@/lib/canvas/access'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const auth = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(auth)) return auth
  await requireCanvasInProject(canvasId, projectId)
  await assertCanvasAgentProjectSupported(projectId)

  const userId = auth.session.user.actorId || auth.session.user.id
  const threads = await listCanvasAgentThreads({ projectId, canvasId, userId })
  return NextResponse.json({ threads }, { headers: { 'Cache-Control': 'no-store' } })
})
