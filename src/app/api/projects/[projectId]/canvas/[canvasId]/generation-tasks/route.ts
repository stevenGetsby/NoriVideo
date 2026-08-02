import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  canvasGenerationTaskLinks,
  findLatestCanvasGenerationTask,
  serializeCanvasGenerationTask,
} from '@/lib/canvas/generation-task'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const nodeId = request.nextUrl.searchParams.get('nodeId')?.trim().slice(0, 191) || ''
  if (!nodeId) throw new ApiError('INVALID_PARAMS', { message: 'nodeId 为必填项。' })
  const task = await findLatestCanvasGenerationTask({ projectId, canvasId, nodeId })
  return NextResponse.json({
    task: task ? serializeCanvasGenerationTask(task) : null,
    links: task ? canvasGenerationTaskLinks(projectId, canvasId, task.id) : null,
  })
})
