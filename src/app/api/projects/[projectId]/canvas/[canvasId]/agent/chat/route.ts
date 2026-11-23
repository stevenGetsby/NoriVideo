import type { NextRequest } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { enforceCanvasAgentRateLimit, readCanvasAgentChatBody } from '@/lib/canvas-agent/chat-request'
import { assertCanvasAgentProjectSupported } from '@/lib/canvas-agent/project-scope'
import { createCanvasAgentChatResponse } from '@/lib/canvas-agent/runtime'
import { requireCanvasInProject } from '@/lib/canvas/access'

export const runtime = 'nodejs'
export const maxDuration = 60

export const POST = apiHandler(async (request: NextRequest, { params }: { params: Promise<{ projectId: string; canvasId: string }> }) => {
  const { projectId, canvasId } = await params
  const auth = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(auth)) return auth
  await requireCanvasInProject(canvasId, projectId)
  await assertCanvasAgentProjectSupported(projectId)
  const userId = auth.session.user.actorId || auth.session.user.id
  await enforceCanvasAgentRateLimit(userId)
  const body = await readCanvasAgentChatBody(request)
  return createCanvasAgentChatResponse({ userId, projectId, canvasId, signal: request.signal, ...body })
})
