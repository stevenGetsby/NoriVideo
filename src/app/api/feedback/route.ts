import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  appendFeedbackRecord,
  isFeedbackStatus,
  isFeedbackType,
  normalizeFeedbackAttachments,
  normalizeFeedbackContext,
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

  const userId = authResult.session.user.id
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const type = isFeedbackType(body.type) ? body.type : 'bug'
  const attachments = normalizeFeedbackAttachments(body.attachments, userId)
  const rawDescription = trimText(body.description, 2000)
  const rawTitle = trimText(body.title, 80)
  const description = rawDescription || (attachments.length > 0 ? '（附图反馈）' : '')
  const title = rawTitle || (rawDescription ? rawDescription.split('\n')[0].slice(0, 40) : (attachments.length > 0 ? `截图反馈（${attachments.length} 张）` : ''))
  const route = trimText(body.route, 240)
  const userAgent = trimText(body.userAgent, 320)
  const context = normalizeFeedbackContext(body.context)

  if (!title || !description) {
    throw new ApiError('INVALID_PARAMS', {
      message: '请填写问题描述或粘贴截图后再提交',
    })
  }

  const createdAt = new Date().toISOString()
  const records = await appendFeedbackRecord(userId, {
    id: trimText(body.id, 80) || makeId(),
    type,
    title,
    description,
    route,
    userAgent,
    attachments,
    context,
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
