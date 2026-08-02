import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getProviderConfig } from '@/lib/api-config'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import {
  getArkVideoUnderstandingConfig,
  understandSourceStoryboardWithArk,
  understandVideoWithArk,
  type VideoUnderstandingMode,
} from '@/lib/volcengine/video-understanding'
import { requireGenerationCredit } from '@/lib/billing'

export const runtime = 'nodejs'
export const maxDuration = 600

function isVideoUnderstandingMode(value: unknown): value is VideoUnderstandingMode {
  return value === 'script' || value === 'board'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function rethrowVideoUnderstandingError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  if (normalized.includes('status 401') || normalized.includes('invalid api key')) {
    throw new ApiError('MISSING_CONFIG', {
      message: '火山方舟 API Key 无效，请在 .env.local 中更换有效的方舟 API Key',
      provider: 'ark',
    })
  }
  throw error
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  await getProviderConfig(authResult.session.user.id, 'ark')
  const config = getArkVideoUnderstandingConfig()
  return NextResponse.json({
    success: true,
    configured: true,
    model: config.model,
    fps: config.fps,
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  await requireGenerationCredit(authResult.session.user.id)

  if (request.headers.get('content-type')?.includes('application/json')) {
    const payload: unknown = await request.json().catch(() => null)
    if (!isRecord(payload) || payload.stage !== 'storyboard') {
      throw new ApiError('INVALID_PARAMS', { message: '无法读取分镜阶段参数' })
    }
    const fileId = typeof payload.fileId === 'string' ? payload.fileId.trim() : ''
    const sourceAnalysis = isRecord(payload.sourceAnalysis) ? payload.sourceAnalysis : null
    const durationSeconds = typeof payload.durationSeconds === 'number' ? payload.durationSeconds : Number.NaN
    const rawEpisodeNumber = typeof payload.episodeNumber === 'number' ? payload.episodeNumber : 1
    const episodeNumber = Number.isInteger(rawEpisodeNumber)
      ? Math.max(1, Math.min(999, rawEpisodeNumber))
      : 1
    if (!fileId || fileId.length > 500 || !sourceAnalysis) {
      throw new ApiError('INVALID_PARAMS', { message: '缺少已确认的源剧本或视频文件标识' })
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 6 * 60 * 60) {
      throw new ApiError('INVALID_PARAMS', { message: '视频时长无效' })
    }

    const { apiKey } = await getProviderConfig(authResult.session.user.id, 'ark')
    const startedAt = Date.now()
    let storyboardResult
    try {
      storyboardResult = await understandSourceStoryboardWithArk({
        apiKey,
        fileId,
        sourceAnalysis,
        durationSeconds,
        episodeNumber,
      })
    } catch (error) {
      rethrowVideoUnderstandingError(error)
    }
    await recordServiceUsage({
      provider: 'ark',
      modelKey: `ark::${storyboardResult.model}`,
      serviceType: 'video-repaint',
      operation: 'source-storyboard',
      userId: authResult.session.user.actorId || authResult.session.user.id,
      inputTokens: storyboardResult.usage.inputTokens,
      outputTokens: storyboardResult.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    })
    return NextResponse.json({
      success: true,
      result: {
        model: storyboardResult.model,
        storyboard: storyboardResult.formattedStoryboard,
        analysis: storyboardResult.storyboard,
        usage: storyboardResult.usage,
        validation: storyboardResult.validation,
      },
    })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) throw new ApiError('INVALID_PARAMS', { message: '无法读取视频上传内容' })

  const fileValue = formData.get('file')
  const modeValue = formData.get('mode')
  const episodeNumberValue = formData.get('episodeNumber')
  const adaptationBriefValue = formData.get('adaptationBrief')
  if (!(fileValue instanceof File)) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择要反译的视频文件' })
  }
  const mode = typeof modeValue === 'string' && isVideoUnderstandingMode(modeValue)
    ? modeValue
    : 'script'
  const parsedEpisodeNumber = typeof episodeNumberValue === 'string'
    ? Number.parseInt(episodeNumberValue, 10)
    : 1
  const episodeNumber = Number.isInteger(parsedEpisodeNumber)
    ? Math.max(1, Math.min(999, parsedEpisodeNumber))
    : 1
  const adaptationBrief = typeof adaptationBriefValue === 'string'
    ? adaptationBriefValue.trim().slice(0, 2_000)
    : ''

  const { apiKey } = await getProviderConfig(authResult.session.user.id, 'ark')
  const startedAt = Date.now()
  let result
  try {
    result = await understandVideoWithArk({
      apiKey,
      file: fileValue,
      mode,
      episodeNumber,
      adaptationBrief,
    })
  } catch (error) {
    rethrowVideoUnderstandingError(error)
  }

  await recordServiceUsage({
    provider: 'ark',
    modelKey: `ark::${result.model}`,
    serviceType: 'video-repaint',
    operation: mode === 'board' ? 'video-understanding-board' : 'video-understanding-script',
    userId: authResult.session.user.actorId || authResult.session.user.id,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: Date.now() - startedAt,
  })

  return NextResponse.json({
    success: true,
    result: {
      fileId: result.fileId,
      model: result.model,
      script: result.episodeScript,
      storyboard: result.sourceStoryboard,
      text: result.text,
      analysis: result.analysis,
      usage: result.usage,
      validation: result.validation,
    },
  })
})
