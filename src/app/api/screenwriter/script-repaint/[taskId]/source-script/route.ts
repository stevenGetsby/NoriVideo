import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getSourceScript, updateSourceScript } from '@/lib/screenwriter/service'
import { ensureFound, readJsonObject, readOptionalString, readString } from '../../../_utils'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId } = await context.params
  const sourceScript = ensureFound(await getSourceScript({ userId, taskId }))
  return NextResponse.json({ sourceScript })
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
  const sourceScriptText = readString(body.sourceScriptText)
  if (!sourceScriptText) {
    throw new ApiError('INVALID_PARAMS', { field: 'sourceScriptText' })
  }
  const sourceScript = ensureFound(await updateSourceScript({
    userId,
    taskId,
    sourceInputMode: readOptionalString(body.sourceInputMode),
    sourceScriptName: readOptionalString(body.sourceScriptName) || null,
    sourceScriptText,
  }))
  return NextResponse.json({ success: true, sourceScript })
})
