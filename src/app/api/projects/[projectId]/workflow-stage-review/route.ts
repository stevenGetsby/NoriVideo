import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import {
  readWorkflowStageReview,
  writeWorkflowStageReview,
  type WorkflowStageReviewMap,
} from '@/lib/workspace/workflow-stage-review-store'

function normalizeStates(value: unknown): WorkflowStageReviewMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, state]) => state === 'confirmed' || state === 'review'),
  ) as WorkflowStageReviewMap
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const states = await readWorkflowStageReview({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
  })

  return NextResponse.json({
    projectId,
    episodeId: episodeId || null,
    source: 'persistent',
    states,
  })
})

export const PUT = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const payload = await writeWorkflowStageReview({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
    states: normalizeStates((body as { states?: unknown }).states),
  })

  return NextResponse.json({
    projectId,
    episodeId: episodeId || null,
    source: 'persistent',
    updatedAt: payload.updatedAt,
    states: payload.states,
  })
})
