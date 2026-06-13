import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  appendFeedbackRecord,
  isFeedbackStatus,
  isFeedbackType,
  readFeedbackRecords,
  updateFeedbackRecordStatus,
} from '@/lib/workspace/feedback-store'

function trimText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const records = await readFeedbackRecords(authResult.session.user.id)
  return NextResponse.json({
    success: true,
    records,
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const type = isFeedbackType(body.type) ? body.type : 'bug'
  const title = trimText(body.title, 80)
  const description = trimText(body.description, 1200)
  const route = trimText(body.route, 240)
  const userAgent = trimText(body.userAgent, 320)

  if (!title || !description) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'Feedback title and description are required',
    })
  }

  const createdAt = new Date().toISOString()
  const records = await appendFeedbackRecord(authResult.session.user.id, {
    id: trimText(body.id, 80) || makeId(),
    type,
    title,
    description,
    route,
    userAgent,
    createdAt,
    status: 'open',
  })

  return NextResponse.json({
    success: true,
    records,
  })
})

export const PATCH = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const id = trimText(body.id, 80)
  const status = body.status

  if (!id || !isFeedbackStatus(status)) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'Feedback id and status are required',
    })
  }

  const records = await updateFeedbackRecordStatus(authResult.session.user.id, id, status)
  return NextResponse.json({
    success: true,
    records,
  })
})
