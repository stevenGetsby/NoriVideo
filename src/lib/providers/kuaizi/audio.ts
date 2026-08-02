import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import { normalizeToOriginalMediaUrl } from '@/lib/media/outbound-image'
import { getKuaiziModelDefinition } from './catalog'
import { asRecord, postKuaiziApiKey, readString } from './client'
import { formatKuaiziExternalId } from './external-id'
import type { KuaiziGenerateRequestOptions } from './types'

export interface KuaiziAudioGenerateParams {
  userId: string
  text: string
  voice?: string
  rate?: number
  options: KuaiziGenerateRequestOptions
}

function seedAudioReferences(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10)
}

async function publicAudioUrl(value: string): Promise<string> {
  const normalized = await normalizeToOriginalMediaUrl(value)
  if (!/^https?:\/\//i.test(normalized)) throw new Error('KUAIZI_AUDIO_REFERENCE_PUBLIC_URL_REQUIRED')
  return normalized
}

export async function generateKuaiziAudio(params: KuaiziAudioGenerateParams): Promise<GenerateResult> {
  const model = getKuaiziModelDefinition(params.options.modelId, 'audio')
  const text = params.text.trim()
  const voice = readString(params.voice)
  if (!text) throw new Error('KUAIZI_AUDIO_TEXT_REQUIRED')
  if (!voice) throw new Error('KUAIZI_AUDIO_VOICE_REQUIRED')

  let path: string
  let body: Record<string, unknown>
  if (model.family === 'seed-audio') {
    const referenceUrls = seedAudioReferences(voice)
    if (referenceUrls.length === 0) throw new Error('KUAIZI_SEED_AUDIO_REFERENCE_REQUIRED')
    const references = await Promise.all(referenceUrls.map(async (audioUrl) => ({
      audio_url: await publicAudioUrl(audioUrl),
    })))
    path = '/ai-open-platform-api/v1/seed_audio/task/create'
    body = {
      text,
      references,
      options: {
        format: readString(params.options.outputFormat) || 'mp3',
        ...(typeof params.rate === 'number' ? { speed: params.rate } : {}),
      },
    }
  } else if (model.family === 'minimax-tts') {
    path = '/ai-open-platform-api/v1/minimax_t2a_async/task/create'
    body = {
      text,
      model: model.modelId,
      voice_setting: {
        voice_id: voice,
        ...(typeof params.rate === 'number' ? { speed: params.rate } : {}),
      },
      audio_setting: {
        format: readString(params.options.outputFormat) || 'mp3',
      },
      ...(readString(params.options.languageBoost) ? { language_boost: readString(params.options.languageBoost) } : {}),
    }
  } else {
    throw new Error(`KUAIZI_AUDIO_MODEL_UNSUPPORTED: ${model.modelId}`)
  }

  const config = await getProviderConfig(params.userId, params.options.provider)
  const payload = await postKuaiziApiKey({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    path,
    body,
  })
  const taskId = readString(asRecord(payload)?.task_id)
  if (!taskId) throw new Error('KUAIZI_AUDIO_TASK_ID_MISSING')
  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: formatKuaiziExternalId({
      type: 'AUDIO',
      providerId: params.options.provider,
      modelId: model.modelId,
      taskId,
    }),
  }
}
