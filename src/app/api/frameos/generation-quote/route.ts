import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { calcImage, calcVideo, calcVoice } from '@/lib/billing/cost'
import { BillingOperationError } from '@/lib/billing/errors'
import { cnyToPoints } from '@/lib/billing/credit-policy'

type QuoteType = 'image' | 'video' | 'audio'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(maximum, Math.floor(parsed)))
}

function positiveNumber(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(maximum, parsed))
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const type = text(request.nextUrl.searchParams.get('type'))
  const model = text(request.nextUrl.searchParams.get('model'))
  if (type !== 'image' && type !== 'video' && type !== 'audio') {
    throw new ApiError('INVALID_PARAMS', { message: '生成报价类型无效。' })
  }

  try {
    let costCny = 0
    if (type === 'image') {
      costCny = calcImage(model, positiveInteger(request.nextUrl.searchParams.get('count'), 1, 100), {
        resolution: text(request.nextUrl.searchParams.get('resolution')) || '2K',
        quality: text(request.nextUrl.searchParams.get('quality')) || 'high',
      })
    } else if (type === 'video') {
      const containsVideoInput = request.nextUrl.searchParams.get('containsVideoInput') === 'true'
      costCny = calcVideo(
        model,
        text(request.nextUrl.searchParams.get('resolution')) || '720p',
        1,
        {
          resolution: text(request.nextUrl.searchParams.get('resolution')) || '720p',
          duration: positiveInteger(request.nextUrl.searchParams.get('duration'), 5, 60),
          generationMode: text(request.nextUrl.searchParams.get('generationMode')) || 'normal',
          generateAudio: request.nextUrl.searchParams.get('generateAudio') !== 'false',
          ...(containsVideoInput ? {
            containsVideoInput,
            inputVideoSeconds: positiveNumber(request.nextUrl.searchParams.get('inputVideoSeconds'), 5, 3600),
          } : {}),
        },
      )
    } else {
      costCny = calcVoice(positiveNumber(request.nextUrl.searchParams.get('duration'), 15, 600), model)
    }

    return NextResponse.json({
      success: true,
      costCny,
      points: cnyToPoints(costCny),
    })
  } catch (error) {
    if (error instanceof BillingOperationError) {
      throw new ApiError('INVALID_PARAMS', { message: error.message, code: error.code, details: error.details })
    }
    throw error
  }
})
