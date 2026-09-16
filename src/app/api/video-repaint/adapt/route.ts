import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getProviderConfig } from '@/lib/api-config'
import {
  adaptVideoScriptWithArk,
  getVideoScriptAdaptationModel,
} from '@/lib/volcengine/video-script-adaptation'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import { withTextBilling } from '@/lib/billing'
import { recordTextUsage } from '@/lib/billing/runtime-usage'

export const runtime = 'nodejs'
export const maxDuration = 600

const MAX_SCRIPT_CHARS = 400_000
const MAX_BRIEF_CHARS = 2_000
const VIDEO_REPAINT_PROJECT_ID = 'video-repaint'

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

  const adaptationContract = isRecord(payload.sourceAnalysis)
    ? payload.sourceAnalysis.adaptation_contract
    : payload.adaptationContract
  const apiKey = adaptationBrief
    ? (await getProviderConfig(authResult.session.user.id, 'ark')).apiKey
    : ''
  const startedAt = Date.now()
  const adaptationModel = getVideoScriptAdaptationModel()
  const runAdaptation = async () => await adaptVideoScriptWithArk({
    apiKey,
    sourceScript,
    adaptationBrief,
    adaptationContract,
    title,
    model: adaptationModel,
  })
  const result = adaptationBrief
    ? await withTextBilling(
        authResult.session.user.id,
        `ark::${adaptationModel}`,
        Math.min(512_000, Math.max(4_000, Math.ceil((sourceScript.length + adaptationBrief.length) * 1.25))),
        Math.min(256_000, Math.max(4_000, Math.ceil(sourceScript.length * 1.25))),
        {
          projectId: VIDEO_REPAINT_PROJECT_ID,
          action: 'video_repaint_script_adaptation',
          requestId: getRequestId(request),
          metadata: {
            operation: 'script-adaptation',
            sourceCharacters: sourceScript.length,
          },
        },
        async () => {
          const generated = await runAdaptation()
          recordTextUsage({
            model: `ark::${generated.model}`,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
          })
          return generated
        },
      )
    : await runAdaptation()

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
