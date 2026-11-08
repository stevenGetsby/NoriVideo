import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { withTextBilling } from '@/lib/billing'
import { recordTextUsage } from '@/lib/billing/runtime-usage'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import {
  createVideoRepaintFileHandle,
  isVideoRepaintFileHandleConfigured,
  verifyVideoRepaintFileHandle,
} from '@/lib/video-repaint/file-handle'
import { VIDEO_REPAINT_PROJECT_ID } from '@/lib/video-repaint/adaptation'
import {
  assertSupportedVideoFile,
  getArkVideoUnderstandingConfig,
  getVideoUnderstandingApiKey,
  understandSourceStoryboardWithArk,
  understandVideoWithArk,
  type VideoUnderstandingMode,
} from '@/lib/volcengine/video-understanding'
import { validateVideoRepaintAnalysis } from '@/lib/volcengine/video-understanding-contract'

export const runtime = 'nodejs'
export const maxDuration = 600

const MAX_UNDERSTANDING_INPUT_TOKENS = 256_000
const MAX_UNDERSTANDING_OUTPUT_TOKENS = 32_000
const MAX_VIDEO_BYTES = 512 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_VIDEO_BYTES + 8 * 1024 * 1024
const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024
const MAX_EPISODE_SECONDS = 6 * 60 * 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isVideoUnderstandingMode(value: unknown): value is VideoUnderstandingMode {
  return value === 'script' || value === 'board'
}

function clampEpisodeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.NaN
  return Number.isInteger(parsed) ? Math.max(1, Math.min(999, parsed)) : 1
}

function actorId(session: { user: { id: string; actorId?: string } }): string {
  return session.user.actorId || session.user.id
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const normalized = error.message.toUpperCase()
  return error.name === 'AbortError' || normalized.includes('ABORTED') || normalized.includes('ABORT')
}

function providerFailureDetail(error: unknown, secret = ''): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = secret ? raw.split(secret).join('[已隐藏密钥]') : raw
  return sanitizePublicError(redacted)
    .replace(/\bark-[A-Za-z0-9-]{8,}/gi, '[已隐藏密钥]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[已隐藏服务地址]')
    .slice(0, 240)
}

function rethrowVideoUnderstandingError(error: unknown, secret = ''): never {
  if (error instanceof ApiError) throw error
  const normalized = (error instanceof Error ? error.message : String(error)).toUpperCase()
  if (isAbortError(error)) {
    throw new ApiError('NETWORK_ERROR', { message: '视频反译请求已取消' })
  }
  if (normalized.includes('ARK_VIDEO_UNDERSTANDING_FILE_TOO_LARGE')) {
    throw new ApiError('INVALID_PARAMS', { message: '视频不能超过 512 MB' })
  }
  if (normalized.includes('ARK_VIDEO_UNDERSTANDING_FILE_INVALID')) {
    throw new ApiError('INVALID_PARAMS', { message: '仅支持 mp4 / mov / avi 视频文件' })
  }
  if (normalized.includes('VIDEO_REPAINT_FILE_HANDLE_SECRET_MISSING')) {
    throw new ApiError('MISSING_CONFIG', { message: '视频转绘会话签名密钥未配置，请联系管理员' })
  }
  if (normalized.includes('PROVIDER_API_KEY_MISSING')) {
    throw new ApiError('MISSING_CONFIG', { message: '视频理解服务未配置服务端密钥，请联系管理员' })
  }
  if (normalized.includes('STATUS 401') || normalized.includes('STATUS 403') || normalized.includes('INVALID API KEY')) {
    throw new ApiError('MISSING_CONFIG', { message: '视频理解服务鉴权失败，请联系管理员检查服务端配置' })
  }
  if (normalized.includes('PROCESS_TIMEOUT') || normalized.includes('TIMEOUT')) {
    throw new ApiError('GENERATION_TIMEOUT', { message: '视频理解超时，请稍后重试' })
  }
  if (normalized.includes('EMPTY_RESPONSE')) {
    throw new ApiError('EMPTY_RESPONSE', { message: '视频理解服务未返回有效结果，请重试' })
  }

  const detail = providerFailureDetail(error, secret)
  throw new ApiError('EXTERNAL_ERROR', {
    message: detail ? `视频理解服务暂时不可用：${detail}` : '视频理解服务暂时不可用，请稍后重试',
    provider: 'video-understanding',
  })
}

function readUploadDuration(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(typeof value === 'string' ? value : '')
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_EPISODE_SECONDS ? parsed : null
}

function readAnalyzedDuration(analysis: Record<string, unknown>): number | null {
  const episode = isRecord(analysis.source_episode) ? analysis.source_episode : {}
  return readUploadDuration(episode.duration_seconds)
}

function assertAnalysisSize(analysis: Record<string, unknown>) {
  let serialized = ''
  try {
    serialized = JSON.stringify(analysis)
  } catch {
    throw new ApiError('INVALID_PARAMS', { message: '源剧本数据无法序列化' })
  }
  if (!serialized || serialized.length > MAX_ANALYSIS_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '源剧本数据无效或过大' })
  }
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const config = getArkVideoUnderstandingConfig()
  return NextResponse.json({
    success: true,
    configured: config.configured && isVideoRepaintFileHandleConfigured(),
    fps: config.fps,
    maxFileBytes: MAX_VIDEO_BYTES,
    supportedExtensions: ['mp4', 'mov', 'avi'],
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const ownerId = actorId(authResult.session)
  const requestId = getRequestId(request)
  const config = getArkVideoUnderstandingConfig()
  if (!config.configured) {
    throw new ApiError('MISSING_CONFIG', { message: '视频理解服务未配置，请联系管理员' })
  }
  if (!isVideoRepaintFileHandleConfigured()) {
    throw new ApiError('MISSING_CONFIG', { message: '视频转绘会话签名密钥未配置，请联系管理员' })
  }
  const apiKey = getVideoUnderstandingApiKey()
  const billingModel = `ark::${config.model}`

  if (request.headers.get('content-type')?.includes('application/json')) {
    const payload: unknown = await request.json().catch(() => null)
    if (!isRecord(payload) || payload.stage !== 'storyboard') {
      throw new ApiError('INVALID_PARAMS', { message: '无法读取分镜阶段参数' })
    }
    const handle = verifyVideoRepaintFileHandle(payload.fileHandle, ownerId)
    if (!handle) {
      throw new ApiError('INVALID_PARAMS', {
        message: '视频会话已失效或不属于当前账号，请重新上传视频反译',
      })
    }
    const sourceAnalysis = isRecord(payload.sourceAnalysis) ? payload.sourceAnalysis : null
    if (!sourceAnalysis) {
      throw new ApiError('INVALID_PARAMS', { message: '缺少已确认的源剧本数据' })
    }
    assertAnalysisSize(sourceAnalysis)
    const sourceValidation = validateVideoRepaintAnalysis(sourceAnalysis)
    if (!sourceValidation.valid) {
      throw new ApiError('INVALID_PARAMS', {
        message: `源剧本结构校验未通过：${sourceValidation.errors.slice(0, 3).join('；') || '未知错误'}`,
      })
    }

    const startedAt = Date.now()
    let storyboardResult
    try {
      storyboardResult = await withTextBilling(
        userId,
        billingModel,
        MAX_UNDERSTANDING_INPUT_TOKENS,
        MAX_UNDERSTANDING_OUTPUT_TOKENS,
        {
          projectId: VIDEO_REPAINT_PROJECT_ID,
          action: 'video_repaint_source_storyboard',
          requestId,
          metadata: {
            operation: 'source-storyboard',
            durationSeconds: handle.durationSeconds,
            episodeNumber: handle.episodeNumber,
          },
        },
        async () => {
          const generated = await understandSourceStoryboardWithArk({
            apiKey,
            fileId: handle.fileId,
            sourceAnalysis,
            durationSeconds: handle.durationSeconds,
            episodeNumber: handle.episodeNumber,
            model: config.model,
            signal: request.signal,
          })
          recordTextUsage({
            model: billingModel,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
          })
          return generated
        },
      )
    } catch (error) {
      rethrowVideoUnderstandingError(error, apiKey)
    }

    await recordServiceUsage({
      provider: 'video-understanding',
      modelKey: billingModel,
      serviceType: 'video-repaint',
      operation: 'source-storyboard',
      userId: ownerId,
      inputTokens: storyboardResult.usage.inputTokens,
      outputTokens: storyboardResult.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    })
    return NextResponse.json({
      success: true,
      result: {
        fileHandle: payload.fileHandle,
        storyboard: storyboardResult.formattedStoryboard,
        analysis: {
          ...sourceAnalysis,
          source_storyboard: storyboardResult.storyboard
            ? {
                shots: storyboardResult.storyboard.shots ?? [],
                excluded_ranges: storyboardResult.storyboard.excluded_ranges ?? [],
              }
            : sourceAnalysis.source_storyboard,
        },
        usage: storyboardResult.usage,
        validation: storyboardResult.validation,
      },
    })
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '视频不能超过 512 MB' })
  }
  const formData = await request.formData().catch(() => null)
  if (!formData) throw new ApiError('INVALID_PARAMS', { message: '无法读取视频上传内容' })

  const fileValue = formData.get('file')
  if (!(fileValue instanceof File)) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择要反译的视频文件' })
  }
  try {
    assertSupportedVideoFile(fileValue)
  } catch (error) {
    rethrowVideoUnderstandingError(error, apiKey)
  }

  const modeValue = formData.get('mode')
  const mode = typeof modeValue === 'string' && isVideoUnderstandingMode(modeValue) ? modeValue : 'script'
  const episodeNumber = clampEpisodeNumber(Number.parseInt(String(formData.get('episodeNumber') ?? '1'), 10))
  const adaptationBrief = typeof formData.get('adaptationBrief') === 'string'
    ? String(formData.get('adaptationBrief')).trim().slice(0, 2_000)
    : ''
  const uploadDuration = readUploadDuration(formData.get('durationSeconds'))

  const startedAt = Date.now()
  let result
  try {
    result = await withTextBilling(
      userId,
      billingModel,
      MAX_UNDERSTANDING_INPUT_TOKENS,
      MAX_UNDERSTANDING_OUTPUT_TOKENS,
      {
        projectId: VIDEO_REPAINT_PROJECT_ID,
        action: mode === 'board'
          ? 'video_repaint_understanding_board'
          : 'video_repaint_understanding_script',
        requestId,
        metadata: {
          operation: mode === 'board' ? 'video-understanding-board' : 'video-understanding-script',
          episodeNumber,
        },
      },
      async () => {
        const generated = await understandVideoWithArk({
          apiKey,
          file: fileValue,
          mode,
          episodeNumber,
          adaptationBrief,
          model: config.model,
          signal: request.signal,
        })
        recordTextUsage({
          model: billingModel,
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
        })
        return generated
      },
    )
  } catch (error) {
    rethrowVideoUnderstandingError(error, apiKey)
  }

  if (!result.analysis) {
    throw new ApiError('EMPTY_RESPONSE', {
      message: '视频理解未返回可用的结构化剧本，请重试或更换视频',
    })
  }
  const durationSeconds = uploadDuration || readAnalyzedDuration(result.analysis)
  if (!durationSeconds) {
    throw new ApiError('INVALID_PARAMS', {
      message: '无法读取视频时长，请更换视频后重试',
    })
  }

  await recordServiceUsage({
    provider: 'video-understanding',
    modelKey: billingModel,
    serviceType: 'video-repaint',
    operation: mode === 'board' ? 'video-understanding-board' : 'video-understanding-script',
    userId: ownerId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: Date.now() - startedAt,
  })

  let fileHandle: string
  try {
    fileHandle = createVideoRepaintFileHandle({
      userId: ownerId,
      fileId: result.fileId,
      durationSeconds,
      episodeNumber,
    })
  } catch (error) {
    rethrowVideoUnderstandingError(error, apiKey)
  }

  return NextResponse.json({
    success: true,
    result: {
      fileHandle,
      script: result.episodeScript,
      storyboard: result.sourceStoryboard,
      analysis: result.analysis,
      durationSeconds,
      usage: result.usage,
      validation: result.validation,
    },
  })
})
