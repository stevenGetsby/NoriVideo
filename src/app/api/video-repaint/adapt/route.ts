import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import {
  adaptVideoScript,
  VIDEO_REPAINT_ADAPTATION_MODEL,
  VIDEO_REPAINT_PROJECT_ID,
} from '@/lib/video-repaint/adaptation'

export const runtime = 'nodejs'
export const maxDuration = 600

const MAX_SCRIPT_CHARS = 400_000
const MAX_BRIEF_CHARS = 2_000
const MAX_CONTRACT_BYTES = 2 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function actorId(session: { user: { id: string; actorId?: string } }): string {
  return session.user.actorId || session.user.id
}

function providerFailureDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return sanitizePublicError(raw)
    .replace(/\b(?:sk|ds)-[A-Za-z0-9_-]{8,}/gi, '[已隐藏密钥]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[已隐藏服务地址]')
    .slice(0, 240)
}

function rethrowAdaptationError(error: unknown): never {
  if (error instanceof ApiError) throw error
  const raw = error instanceof Error ? error.message : String(error)
  const normalized = raw.toUpperCase()
  if (error instanceof Error && error.name === 'AbortError') {
    throw new ApiError('NETWORK_ERROR', { message: '转绘剧本生成请求已取消' })
  }
  if (normalized.includes('MODEL_NOT_CONFIGURED') || normalized.includes('NO LLM MODEL IS ENABLED')) {
    throw new ApiError('MODEL_NOT_CONFIGURED', {
      message: '文本模型未配置，请先在账号设置中配置可用的文本模型',
    })
  }
  if (normalized.includes('EMPTY_RESPONSE')) {
    throw new ApiError('EMPTY_RESPONSE', { message: '文本模型未返回转绘剧本，请重试' })
  }
  if (normalized.includes('INSUFFICIENT_BALANCE') || normalized.includes('DAILY_LIMIT_EXCEEDED')) {
    throw error
  }
  if (normalized.includes('TEXT_PROVIDER_UNSUPPORTED')) {
    throw new ApiError('MODEL_NOT_CONFIGURED', {
      message: '当前平台未配置受支持的文本模型，请联系管理员',
    })
  }
  const detail = providerFailureDetail(error)
  throw new ApiError('EXTERNAL_ERROR', {
    message: detail ? `转绘剧本生成失败：${detail}` : '转绘剧本生成失败，请稍后重试',
    provider: 'text-llm',
  })
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
  if (adaptationContract !== undefined) {
    let contractLength = 0
    try {
      contractLength = JSON.stringify(adaptationContract).length
    } catch {
      throw new ApiError('INVALID_PARAMS', { message: '改编约束数据无法序列化' })
    }
    if (contractLength > MAX_CONTRACT_BYTES) {
      throw new ApiError('INVALID_PARAMS', { message: '改编约束数据过大' })
    }
  }

  const startedAt = Date.now()
  let result
  try {
    result = await adaptVideoScript({
      userId: authResult.session.user.id,
      sourceScript,
      adaptationBrief,
      adaptationContract,
      title,
      requestId: getRequestId(request),
      projectId: VIDEO_REPAINT_PROJECT_ID,
    })
  } catch (error) {
    rethrowAdaptationError(error)
  }

  if (result.mode === 'llm') {
    await recordServiceUsage({
      provider: 'text-llm',
      modelKey: VIDEO_REPAINT_ADAPTATION_MODEL,
      serviceType: 'video-repaint',
      operation: 'script-adaptation',
      userId: actorId(authResult.session),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    })
  }

  return NextResponse.json({
    success: true,
    result: {
      script: result.script,
      mode: result.mode,
      usage: result.usage,
    },
  })
})
