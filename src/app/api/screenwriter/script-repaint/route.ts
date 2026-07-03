import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { createScriptRepaintTask } from '@/lib/screenwriter/service'
import { normalizeCheckpoints, readJsonObject, readOptionalString, readString } from '../_utils'
import type { ScriptRepaintSourceInputMode } from '@/lib/screenwriter/types'

function normalizeSourceInputMode(value: unknown): ScriptRepaintSourceInputMode {
  const mode = readString(value)
  if (mode === 'paste' || mode === 'file' || mode === 'workspace') return mode
  throw new ApiError('INVALID_PARAMS', { field: 'sourceInputMode' })
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const body = await readJsonObject(request)

  const title = readString(body.title)
  const sourceScriptText = readString(body.sourceScriptText)
  const requirement = readString(body.requirement)
  if (!title || !sourceScriptText || !requirement) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await createScriptRepaintTask({
    userId,
    title,
    sourceInputMode: normalizeSourceInputMode(body.sourceInputMode),
    sourceScriptName: readOptionalString(body.sourceScriptName) || null,
    sourceScriptText,
    requirement,
    checkpoints: normalizeCheckpoints(body.checkpoints),
  })

  return NextResponse.json(result)
})
