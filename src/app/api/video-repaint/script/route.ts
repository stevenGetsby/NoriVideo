import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import { VIDEO_REPAINT_PROJECT_ID } from '@/lib/video-repaint/contract'
import { VIDEO_REPAINT_OUTLINE_MODEL } from '@/lib/video-repaint/outline'
import { generateTargetScript } from '@/lib/video-repaint/target-script'

export const runtime = 'nodejs'
export const maxDuration = 600

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rethrowScriptError(error: unknown): never {
  if (error instanceof ApiError) throw error
  const raw = error instanceof Error ? error.message : String(error)
  const normalized = raw.toUpperCase()
  if (error instanceof Error && error.name === 'AbortError') {
    throw new ApiError('NETWORK_ERROR', { message: '目标剧本生成请求已取消' })
  }
  if (normalized.includes('MODEL_NOT_CONFIGURED') || normalized.includes('NO LLM MODEL IS ENABLED')) {
    throw new ApiError('MODEL_NOT_CONFIGURED', { message: '文本模型未配置，请先在账号设置中配置可用的文本模型' })
  }
  if (normalized.includes('EMPTY_RESPONSE')) {
    throw new ApiError('EMPTY_RESPONSE', { message: '文本模型未返回目标剧本，请重试' })
  }
  if (normalized.includes('DIALOGUE_MISSING')) {
    throw new ApiError('EMPTY_RESPONSE', { message: '目标剧本漏掉了源视频台词，请重新生成', retryable: true })
  }
  if (normalized.includes('INSUFFICIENT_BALANCE') || normalized.includes('DAILY_LIMIT_EXCEEDED')) throw error
  if (normalized.includes('TEXT_PROVIDER_UNSUPPORTED')) {
    throw new ApiError('MODEL_NOT_CONFIGURED', { message: '当前平台未配置受支持的文本模型，请联系管理员' })
  }
  const detail = sanitizePublicError(raw)
    .replace(/\b(?:sk|ds)-[A-Za-z0-9_-]{8,}/gi, '[已隐藏密钥]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[已隐藏服务地址]')
    .slice(0, 240)
  throw new ApiError('EXTERNAL_ERROR', {
    message: detail ? `目标剧本生成失败：${detail}` : '目标剧本生成失败，请稍后重试',
    provider: 'text-llm',
  })
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const payload: unknown = await request.json().catch(() => null)
  if (!isRecord(payload)) throw new ApiError('INVALID_PARAMS', { message: '无法读取目标剧本参数' })

  const sourceScript = cleanText(payload.sourceScript)
  const outline = cleanText(payload.outline)
  if (!sourceScript) throw new ApiError('INVALID_PARAMS', { message: '源剧本为空，请先完成视频反译' })
  if (!outline) throw new ApiError('INVALID_PARAMS', { message: '目标设定总纲为空，请先生成总纲' })
  if (sourceScript.length > 400_000 || outline.length > 400_000) {
    throw new ApiError('INVALID_PARAMS', { message: '剧本或总纲内容过长，请拆分后重试' })
  }
  const sourceAnalysis = isRecord(payload.sourceAnalysis) ? payload.sourceAnalysis : undefined
  let analysisLength = 0
  try {
    analysisLength = sourceAnalysis ? JSON.stringify(sourceAnalysis).length : 0
  } catch {
    throw new ApiError('INVALID_PARAMS', { message: '视频理解数据无法序列化' })
  }
  if (analysisLength > 2 * 1024 * 1024) {
    throw new ApiError('INVALID_PARAMS', { message: '视频理解数据过大' })
  }

  const startedAt = Date.now()
  let result
  try {
    result = await generateTargetScript({
      userId: authResult.session.user.id,
      title: cleanText(payload.title).slice(0, 200),
      brief: cleanText(payload.adaptationBrief).slice(0, 2_000),
      sourceScript,
      sourceAnalysis,
      durationSeconds: typeof payload.durationSeconds === 'number' && payload.durationSeconds > 0 ? payload.durationSeconds : undefined,
      outline,
      requestId: getRequestId(request),
      projectId: VIDEO_REPAINT_PROJECT_ID,
    })
  } catch (error) {
    rethrowScriptError(error)
  }
  await recordServiceUsage({
    provider: 'text-llm',
    modelKey: VIDEO_REPAINT_OUTLINE_MODEL,
    serviceType: 'video-repaint',
    operation: 'target-script',
    userId: authResult.session.user.actorId || authResult.session.user.id,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: Date.now() - startedAt,
  })
  return NextResponse.json({
    success: true,
    result: { targetScript: result.targetScript, usage: result.usage },
  })
})
