import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getProviderConfig } from '@/lib/api-config'
import { adaptVideoScriptWithArk } from '@/lib/volcengine/video-script-adaptation'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import { requireGenerationCredit } from '@/lib/billing'

export const runtime = 'nodejs'
export const maxDuration = 600

const MAX_SCRIPT_CHARS = 400_000
const MAX_BRIEF_CHARS = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const payload: unknown = await request.json().catch(() => null)
  if (!isRecord(payload)) {
    throw new ApiError('INVALID_PARAMS', { message: '无法读取转绘剧本参数' })
  }
  const sourceScript = cleanText(payload.sourceScript)
  const adaptationBrief = cleanText(payload.adaptationBrief).slice(0, MAX_BRIEF_CHARS)
  const title = cleanText(payload.title).slice(0, 200)
  if (!sourceScript) {
    throw new ApiError('INVALID_PARAMS', { message: '源剧本为空，请先完成视频反译' })
  }
  if (sourceScript.length > MAX_SCRIPT_CHARS) {
    throw new ApiError('INVALID_PARAMS', { message: '源剧本内容过长，请拆分后重试' })
  }

  if (adaptationBrief) await requireGenerationCredit(authResult.session.user.id)

  const adaptationContract = isRecord(payload.sourceAnalysis)
    ? payload.sourceAnalysis.adaptation_contract
    : payload.adaptationContract
  const apiKey = adaptationBrief
    ? (await getProviderConfig(authResult.session.user.id, 'ark')).apiKey
    : ''
  const startedAt = Date.now()
  const result = await adaptVideoScriptWithArk({
    apiKey,
    sourceScript,
    adaptationBrief,
    adaptationContract,
    title,
  })

  if (result.mode === 'llm') {
    await recordServiceUsage({
      provider: 'ark',
      modelKey: `ark::${result.model}`,
      serviceType: 'video-repaint',
      operation: 'script-adaptation',
      userId: authResult.session.user.actorId || authResult.session.user.id,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    })
  }

  return NextResponse.json({ success: true, result })
})
