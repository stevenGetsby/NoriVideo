import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import {
  getVideoRepaintTaskDetail,
  updateVideoRepaintRequirement,
} from '@/lib/screenwriter/service'
import {
  ensureFound,
  normalizeCheckpoints,
  readJsonObject,
  readOptionalString,
} from '../../_utils'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId } = await context.params
  const task = ensureFound(await getVideoRepaintTaskDetail({ userId, taskId }))
  return NextResponse.json({ task })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId } = await context.params
  const body = await readJsonObject(request)
  const task = ensureFound(await updateVideoRepaintRequirement({
    userId,
    taskId,
    title: readOptionalString(body.title),
    requirement: readOptionalString(body.requirement),
    checkpoints: body.checkpoints ? normalizeCheckpoints(body.checkpoints) : undefined,
  }))
  return NextResponse.json({ success: true, task })
})
