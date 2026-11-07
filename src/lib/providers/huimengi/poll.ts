import { getProviderConfig } from '@/lib/api-config'
import type { PollResult } from '@/lib/async-poll'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import { pickVideoResultMetadata } from '@/lib/video-result'
import { asRecord, readFiniteNumber, readString, requestHuimengi } from './client'
import { decodeHuimengiExternalToken, type HuimengiAsyncType } from './external-id'
import type { JsonRecord } from './client'

function imageUrls(record: JsonRecord): string[] {
  const urls: string[] = []
  const direct = readString(record.image_url)
  if (direct) urls.push(direct)
  if (Array.isArray(record.image_urls)) {
    for (const item of record.image_urls) {
      const url = readString(item)
      if (url && !urls.includes(url)) urls.push(url)
    }
  }
  return urls
}

export async function queryHuimengiTaskStatus(input: {
  type: HuimengiAsyncType
  taskId: string
  apiKey: string
  baseUrl?: string
}): Promise<PollResult> {
  try {
    const payload = await requestHuimengi({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      path: `/api/v1/tasks/${encodeURIComponent(input.taskId)}`,
      method: 'GET',
    })
    const record = asRecord(payload)
    if (!record) throw new Error('HUIMENGI_STATUS_RESPONSE_INVALID')
    const status = readString(record.status).toLowerCase()
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'expired') {
      return {
        status: 'failed',
        error: sanitizePublicError(readString(record.error_message) || `HuiMeng task ${status || 'failed'}`),
      }
    }
    if (status !== 'completed' && status !== 'succeeded') return { status: 'pending' }

    const result = asRecord(record.result) || record
    if (input.type === 'IMAGE') {
      const urls = imageUrls(result)
      if (!urls.length) return { status: 'failed', error: 'HuiMeng image task completed without image URL' }
      return {
        status: 'completed',
        resultUrl: urls[0],
        imageUrl: urls[0],
        imageUrls: urls,
      }
    }

    const videoUrl = readString(result.video_url)
    if (!videoUrl) return { status: 'failed', error: 'HuiMeng video task completed without video URL' }
    const completionTokens = readFiniteNumber(result.completion_tokens)
    const totalTokens = readFiniteNumber(result.total_tokens)
    return {
      status: 'completed',
      resultUrl: videoUrl,
      videoUrl,
      ...pickVideoResultMetadata({
        actualVideoTokens: completionTokens ?? totalTokens,
        durationSeconds: readFiniteNumber(result.duration),
        resolution: readString(result.resolution),
        aspectRatio: readString(result.ratio),
        generateAudio: typeof result.generate_audio === 'boolean' ? result.generate_audio : undefined,
      }),
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'HuiMeng task query failed',
    }
  }
}

export async function pollHuimengiTask(input: {
  type: HuimengiAsyncType
  taskId: string
  userId: string
  providerToken: string
  modelToken: string
}): Promise<PollResult> {
  const providerId = decodeHuimengiExternalToken(input.providerToken)
  decodeHuimengiExternalToken(input.modelToken)
  const config = await getProviderConfig(input.userId, providerId)
  return await queryHuimengiTaskStatus({
    type: input.type,
    taskId: input.taskId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  })
}
