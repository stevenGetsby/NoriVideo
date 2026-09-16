import { getProviderConfig, getProviderKey, resolveModelSelection } from '@/lib/api-config'
import { submitFalTask } from '@/lib/async-submit'
import { formatExternalId } from '@/lib/async-poll'
import { generateAudio } from '@/lib/generator-api'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveRuntimeModelKey } from '@/lib/nori-model-catalog'
import { recordServiceUsageInBackground } from '@/lib/platform-services/usage'
import {
  audioCapabilitiesForModel,
  declaredAudioModes,
  type AudioGenerationMode,
  type AudioGenerationRequest,
} from './generation-contract'

export type ProviderAudioGenerationResult =
  | { kind: 'ready'; audioUrl: string; requestId: string | null }
  | { kind: 'async'; externalId: string; requestId: string }

type FalAudioAdapter = {
  modes: readonly AudioGenerationMode[]
  buildInput(request: AudioGenerationRequest): Record<string, unknown>
}

const FAL_AUDIO_ADAPTERS: Readonly<Record<string, FalAudioAdapter>> = {
  'fal-ai/stable-audio-25/text-to-audio': {
    modes: ['music', 'sfx'],
    buildInput: (request) => {
      if (!Number.isInteger(request.durationSeconds)) throw new Error('FAL_STABLE_AUDIO_DURATION_INTEGER_REQUIRED')
      return {
        prompt: [request.genre, request.sfxKind, request.prompt].filter(Boolean).join('，'),
        seconds_total: request.durationSeconds,
      }
    },
  },
  'fal-ai/elevenlabs/sound-effects/v2': {
    modes: ['sfx'],
    buildInput: (request) => ({
      text: [request.sfxKind, request.prompt].filter(Boolean).join('，'),
      duration_seconds: request.durationSeconds,
      prompt_influence: 0.3,
    }),
  },
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function implementedAudioModes(provider: string, modelId: string): AudioGenerationMode[] {
  const providerKey = getProviderKey(provider).toLowerCase()
  if (providerKey === 'bailian') return ['tts']
  if (providerKey === 'kuaizi') return ['tts']
  if (providerKey === 'fal' && provider === 'fal') return [...(FAL_AUDIO_ADAPTERS[modelId]?.modes || [])]
  return []
}

export async function resolveAudioGenerationAvailability(params: {
  userId: string
  modelKey: string
}): Promise<{
  available: boolean
  modes: AudioGenerationMode[]
  runtimeModelKey: string | null
  unavailableReason: string | null
}> {
  try {
    const selection = await resolveModelSelection(params.userId, params.modelKey, 'audio')
    const capabilities = audioCapabilitiesForModel(params.modelKey)
    const declared = declaredAudioModes(capabilities)
    const implemented = implementedAudioModes(selection.provider, selection.modelId)
    const modes = declared.filter((mode) => implemented.includes(mode))
    if (modes.length === 0) {
      return {
        available: false,
        modes: [],
        runtimeModelKey: selection.modelKey,
        unavailableReason: declared.length === 0
          ? '当前路由模型没有声明音频生成能力。'
          : '当前路由模型尚未接入匹配的音频执行适配器。',
      }
    }
    const provider = await getProviderConfig(params.userId, selection.provider)
    if (!compact(provider.apiKey)) {
      return { available: false, modes: [], runtimeModelKey: selection.modelKey, unavailableReason: '音频服务密钥未配置。' }
    }
    return { available: true, modes, runtimeModelKey: selection.modelKey, unavailableReason: null }
  } catch (error) {
    return {
      available: false,
      modes: [],
      runtimeModelKey: parseModelKeyStrict(resolveRuntimeModelKey(params.modelKey) || '')?.modelKey || null,
      unavailableReason: error instanceof Error ? error.message : '音频服务不可用。',
    }
  }
}

/** Submit to an implemented provider. Async providers return a durable external id. */
export async function generateProviderAudio(params: {
  userId: string
  modelKey: string
  request: AudioGenerationRequest
}): Promise<ProviderAudioGenerationResult> {
  const selection = await resolveModelSelection(params.userId, params.modelKey, 'audio')
  const implementedModes = implementedAudioModes(selection.provider, selection.modelId)
  if (!implementedModes.includes(params.request.mode)) {
    throw new Error(`AUDIO_PROVIDER_MODE_NOT_IMPLEMENTED: ${selection.modelKey} ${params.request.mode}`)
  }

  const providerKey = getProviderKey(selection.provider).toLowerCase()
  if (providerKey === 'bailian') {
    if (params.request.mode !== 'tts' || !params.request.voice) {
      throw new Error('BAILIAN_AUDIO_MODE_UNSUPPORTED')
    }
    const generated = await generateAudio(params.userId, params.modelKey, params.request.prompt, {
      voice: params.request.voice,
    })
    if (!generated.success || !compact(generated.audioUrl) || generated.async) {
      throw new Error(generated.error || '音频服务没有返回可保存的音频结果。')
    }
    return {
      kind: 'ready',
      audioUrl: generated.audioUrl!,
      requestId: compact(generated.requestId) || null,
    }
  }

  if (providerKey === 'kuaizi') {
    if (params.request.mode !== 'tts' || !params.request.voice) {
      throw new Error('KUAIZI_AUDIO_MODE_UNSUPPORTED')
    }
    const generated = await generateAudio(params.userId, params.modelKey, params.request.prompt, {
      voice: params.request.voice,
    })
    const requestId = compact(generated.requestId)
    const externalId = compact(generated.externalId)
    if (!generated.success || !generated.async || !requestId || !externalId) {
      throw new Error(generated.error || '筷子音频服务没有返回可轮询的任务。')
    }
    return { kind: 'async', requestId, externalId }
  }

  if (providerKey === 'fal' && selection.provider === 'fal') {
    const adapter = FAL_AUDIO_ADAPTERS[selection.modelId]
    if (!adapter) throw new Error(`FAL_AUDIO_MODEL_UNSUPPORTED: ${selection.modelId}`)
    const config = await getProviderConfig(params.userId, selection.provider)
    const startedAt = Date.now()
    try {
      const requestId = await submitFalTask(selection.modelId, adapter.buildInput(params.request), config.apiKey)
      return {
        kind: 'async',
        requestId,
        externalId: formatExternalId('FAL', 'AUDIO', requestId, selection.modelId),
      }
    } catch (error) {
      recordServiceUsageInBackground({
        provider: selection.provider,
        modelKey: selection.modelKey,
        serviceType: 'audio',
        operation: `generate-audio-${params.request.mode}`,
        status: 'failed',
        userId: params.userId,
        units: 0,
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.name : 'AUDIO_GENERATION_ERROR',
      })
      throw error
    }
  }

  throw new Error(`AUDIO_PROVIDER_NOT_IMPLEMENTED: ${selection.provider}`)
}
