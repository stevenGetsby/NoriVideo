import { getProviderConfig } from '@/lib/api-config'
import type { PollResult } from '@/lib/async-poll'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import { pickVideoResultMetadata } from '@/lib/video-result'
import { asRecord, readFiniteNumber, readString, requestAilink } from './client'
import { decodeAilinkExternalToken } from './external-id'

export async function queryAilinkTaskStatus(input: {
  taskId: string
  apiKey: string
  baseUrl?: string
  signal?: AbortSignal
}): Promise<PollResult> {
  try {
    const payload = await requestAilink({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      path: `/api/v3/contents/generations/tasks/${encodeURIComponent(input.taskId)}`,
      method: 'GET',
      signal: input.signal,
    })
    const record = asRecord(payload)
    if (!record) throw new Error('AILINK_STATUS_RESPONSE_INVALID')
    const status = readString(record.status).toLowerCase()
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'expired') {
      const error = asRecord(record.error)
      return {
        status: 'failed',
        error: sanitizePublicError(readString(error?.message) || `AILink task ${status}`),
      }
    }
    if (status !== 'succeeded') return { status: 'pending' }

    const content = asRecord(record.content)
    const videoUrl = readString(content?.video_url)
    if (!videoUrl) return { status: 'failed', error: 'AILink video task succeeded without video URL' }
    const usage = asRecord(record.usage)
    const totalTokens = readFiniteNumber(usage?.total_tokens)
    const completionTokens = readFiniteNumber(usage?.completion_tokens)
    return {
      status: 'completed',
      resultUrl: videoUrl,
      videoUrl,
      ...pickVideoResultMetadata({
        actualVideoTokens: completionTokens ?? totalTokens,
        durationSeconds: readFiniteNumber(record.duration),
        resolution: readString(record.resolution),
      }),
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'AILink task query failed',
    }
  }
}

export async function pollAilinkTask(input: {
  taskId: string
  userId: string
  providerToken: string
  modelToken: string
  signal?: AbortSignal
}): Promise<PollResult> {
  const providerId = decodeAilinkExternalToken(input.providerToken)
  decodeAilinkExternalToken(input.modelToken)
  const config = await getProviderConfig(input.userId, providerId)
  return await queryAilinkTaskStatus({
    taskId: input.taskId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    signal: input.signal,
  })
}
