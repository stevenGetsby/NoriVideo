import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { createVideoRepaintTask } from '@/lib/screenwriter/service'
import { normalizeCheckpoints, readJsonObject, readString } from '../_utils'
import type { VideoRepaintTransferForm, VideoRepaintUploadMode } from '@/lib/screenwriter/types'

function normalizeTransferForm(value: unknown): VideoRepaintTransferForm {
  const form = readString(value)
  if (form === 'script' || form === 'board') return form
  throw new ApiError('INVALID_PARAMS', { field: 'transferForm' })
}

function normalizeUploadMode(value: unknown): VideoRepaintUploadMode {
  const mode = readString(value)
  if (mode === 'file' || mode === 'folder') return mode
  throw new ApiError('INVALID_PARAMS', { field: 'uploadMode' })
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const body = await readJsonObject(request)

  const title = readString(body.title)
  const sourceAssetName = readString(body.sourceAssetName)
  const requirement = readString(body.requirement)
  if (!title || !sourceAssetName || !requirement) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await createVideoRepaintTask({
    userId,
    title,
    transferForm: normalizeTransferForm(body.transferForm),
    uploadMode: normalizeUploadMode(body.uploadMode),
    sourceAssetName,
    requirement,
    checkpoints: normalizeCheckpoints(body.checkpoints),
  })

  return NextResponse.json(result)
})
