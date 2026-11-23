import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { assertCanvasAgentProjectSupported } from '@/lib/canvas-agent/project-scope'
import { deleteCanvasAgentThread, getCanvasAgentThread } from '@/lib/canvas-agent/threads'
import { requireCanvasInProject } from '@/lib/canvas/access'

type Params = { params: Promise<{ projectId: string; canvasId: string; threadId: string }> }
const headers = { 'Cache-Control': 'no-store' }

export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const { projectId, canvasId, threadId } = await params
  const auth = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(auth)) return auth
  await requireCanvasInProject(canvasId, projectId)
  await assertCanvasAgentProjectSupported(projectId)

  const userId = auth.session.user.actorId || auth.session.user.id
  const thread = await getCanvasAgentThread({ projectId, canvasId, threadId, userId })
  return NextResponse.json({ thread }, { headers })
})

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const { projectId, canvasId, threadId } = await params
  const auth = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(auth)) return auth
  await requireCanvasInProject(canvasId, projectId)
  await assertCanvasAgentProjectSupported(projectId)

  const userId = auth.session.user.actorId || auth.session.user.id
  await deleteCanvasAgentThread({ projectId, canvasId, threadId, userId })
  return NextResponse.json({ ok: true }, { headers })
})
