import { getProviderConfig } from '@/lib/api-config'
import type { PollResult } from '@/lib/async-poll'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import { pickVideoResultMetadata } from '@/lib/video-result'
import { asRecord, buildTggUrl, readFiniteNumber, readString, requestTgg, TGG_QUERY_TIMEOUT_MS } from './client'
import { decodeTggExternalToken, type TggAsyncType } from './external-id'

export async function queryTggTaskStatus(input: {
  taskId: string
  apiKey: string
  baseUrl?: string
  signal?: AbortSignal
}): Promise<PollResult> {
  try {
    const payload = await requestTgg({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      path: `/v1/videos/${encodeURIComponent(input.taskId)}`,
      method: 'GET',
      timeoutMs: TGG_QUERY_TIMEOUT_MS,
      signal: input.signal,
    })
    const record = asRecord(payload)
    if (!record) throw new Error('TGG_STATUS_RESPONSE_INVALID')
    const status = readString(record.status).toLowerCase()
    if (status === 'failed') {
      const error = asRecord(record.error)
      return {
        status: 'failed',
        error: sanitizePublicError(readString(error?.message) || readString(record.error) || 'TGG task failed'),
      }
    }
    if (status !== 'completed') return { status: 'pending' }
    if (readString(record.delivery_status).toLowerCase() === 'failed') {
      // Delivery failure must not recreate the task; only the download retries.
      return { status: 'failed', error: 'TGG_DELIVERY_FAILED' }
    }
    const resultUrl = buildTggUrl(
      input.baseUrl,
      readString(record.content_url) || `/v1/videos/${input.taskId}/content`,
    )
    return {
      status: 'completed',
      resultUrl,
      videoUrl: resultUrl,
      // The content endpoint is Bearer-protected. Node fetch drops the header
      // on cross-origin redirects, which matches TGG's delivery contract.
      downloadHeaders: { Authorization: `Bearer ${input.apiKey}` },
      ...pickVideoResultMetadata({
        durationSeconds: readFiniteNumber(record.seconds),
        resolution: readString(record.resolution),
        aspectRatio: readString(record.ratio),
      }),
    }
  } catch (error) {
    return {
      status: 'failed',
      error: sanitizePublicError(error instanceof Error ? error.message : 'TGG task query failed'),
    }
  }
}

export async function pollTggTask(input: {
  type: TggAsyncType
  taskId: string
  userId: string
  providerToken: string
  modelToken: string
  signal?: AbortSignal
}): Promise<PollResult> {
  const providerId = decodeTggExternalToken(input.providerToken)
  decodeTggExternalToken(input.modelToken)
  const config = await getProviderConfig(input.userId, providerId)
  return await queryTggTaskStatus({
    taskId: input.taskId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    signal: input.signal,
  })
}
