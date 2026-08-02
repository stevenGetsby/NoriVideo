import { getProviderConfig } from '@/lib/api-config'
import type { PollResult } from '@/lib/async-poll'
import { getKuaiziModelDefinition } from './catalog'
import {
  asRecord,
  postKuaiziApiKey,
  readString,
  requestKuaiziBearer,
  type JsonRecord,
} from './client'
import { decodeKuaiziExternalToken, type KuaiziAsyncType } from './external-id'

function standardStatusPath(family: string): string {
  if (family === 'gpt-image') return '/ai-open-platform-api/v1/chatgpt/image/task/status'
  if (family === 'seedream') return '/ai-open-platform-api/v1/seedream/image/task/status'
  if (family === 'kling') return '/ai-open-platform-api/v1/kling/video/task/status'
  if (family === 'happyhorse') return '/ai-open-platform-api/v1/happyhorse/video/task/status'
  if (family === 'seed-audio') return '/ai-open-platform-api/v1/seed_audio/task/status'
  if (family === 'minimax-tts') return '/ai-open-platform-api/v1/minimax_t2a_async/task/status'
  throw new Error(`KUAIZI_STATUS_FAMILY_UNSUPPORTED: ${family}`)
}

function mediaUrlFromStandardPayload(record: JsonRecord, type: KuaiziAsyncType): string {
  if (type === 'IMAGE') {
    const direct = readString(record.image_url)
    if (direct) return direct
    if (Array.isArray(record.image_urls)) {
      return record.image_urls.map(readString).find(Boolean) || ''
    }
  }
  if (type === 'VIDEO') return readString(record.video_url)
  return readString(record.audio_url)
}

function mediaUrlFromSeedanceContent(content: unknown): string {
  const direct = asRecord(content)
  const directUrl = readString(direct?.video_url)
  if (directUrl) return directUrl
  if (!Array.isArray(content)) return ''
  for (const item of content) {
    const record = asRecord(item)
    const videoUrl = asRecord(record?.video_url)
    const url = readString(videoUrl?.url) || readString(record?.video_url)
    if (url) return url
  }
  return ''
}

function completed(type: KuaiziAsyncType, url: string, actualVideoTokens?: number): PollResult {
  return {
    status: 'completed',
    resultUrl: url,
    ...(type === 'IMAGE' ? { imageUrl: url } : {}),
    ...(type === 'VIDEO' ? { videoUrl: url } : {}),
    ...(type === 'AUDIO' ? { audioUrl: url } : {}),
    ...(typeof actualVideoTokens === 'number' ? { actualVideoTokens } : {}),
  }
}

export async function queryKuaiziTaskStatus(input: {
  type: KuaiziAsyncType
  modelId: string
  taskId: string
  apiKey: string
  baseUrl?: string
}): Promise<PollResult> {
  try {
    const modality = input.type === 'IMAGE' ? 'image' : input.type === 'VIDEO' ? 'video' : 'audio'
    const model = getKuaiziModelDefinition(input.modelId, modality)
    if (model.family === 'seedance') {
      const payload = await requestKuaiziBearer({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        path: `/ai-open-platform-api/api/v3/contents/generations/tasks/${encodeURIComponent(input.taskId)}`,
        method: 'GET',
      })
      const record = asRecord(payload)
      if (!record) throw new Error('KUAIZI_SEEDANCE_STATUS_RESPONSE_INVALID')
      const status = readString(record.status).toLowerCase()
      if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
        const error = asRecord(record.error)
        return { status: 'failed', error: readString(error?.message) || readString(record.message) || 'Kuaizi Seedance task failed' }
      }
      if (status !== 'succeeded' && status !== 'completed') return { status: 'pending' }
      const url = mediaUrlFromSeedanceContent(record.content)
      if (!url) return { status: 'failed', error: 'Kuaizi Seedance task completed without video URL' }
      const usage = asRecord(record.usage)
      const actualVideoTokens = typeof usage?.completion_tokens === 'number'
        ? usage.completion_tokens
        : typeof usage?.total_tokens === 'number'
          ? usage.total_tokens
          : undefined
      return completed(input.type, url, actualVideoTokens)
    }

    const payload = await postKuaiziApiKey({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      path: standardStatusPath(model.family),
      body: { task_id: input.taskId },
    })
    const record = asRecord(payload)
    if (!record) throw new Error('KUAIZI_STATUS_RESPONSE_INVALID')
    const status = readString(record.status).toLowerCase()
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      return { status: 'failed', error: readString(record.error) || readString(record.message) || 'Kuaizi task failed' }
    }
    if (status !== 'succeeded' && status !== 'completed' && status !== 'success') {
      return { status: 'pending' }
    }
    const url = mediaUrlFromStandardPayload(record, input.type)
    if (!url) return { status: 'failed', error: 'Kuaizi task completed without result URL' }
    return completed(input.type, url)
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Kuaizi task query failed',
    }
  }
}

export async function pollKuaiziTask(input: {
  type: KuaiziAsyncType
  taskId: string
  userId: string
  providerToken: string
  modelToken: string
}): Promise<PollResult> {
  const providerId = decodeKuaiziExternalToken(input.providerToken)
  const modelId = decodeKuaiziExternalToken(input.modelToken)
  const config = await getProviderConfig(input.userId, providerId)
  return await queryKuaiziTaskStatus({
    type: input.type,
    modelId,
    taskId: input.taskId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  })
}
