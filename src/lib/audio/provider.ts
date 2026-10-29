import { getProviderConfig, getProviderKey, resolveModelSelection } from '@/lib/api-config'
import { generateAudio } from '@/lib/generator-api'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getKuaiziModelDefinition } from '@/lib/providers/kuaizi/catalog'
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

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function implementedAudioModes(provider: string, _modelId: string): AudioGenerationMode[] {
  const providerKey = getProviderKey(provider).toLowerCase()
  if (providerKey === 'kuaizi') return ['tts']
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
  if (providerKey === 'kuaizi') {
    if (params.request.mode !== 'tts' || !params.request.voice) {
      throw new Error('KUAIZI_AUDIO_MODE_UNSUPPORTED')
    }
    const definition = getKuaiziModelDefinition(selection.modelId, 'audio')
    if (definition.family === 'seed-audio' && !params.request.voice.startsWith('kuaizi-audio:')) {
      throw new Error('请先选择上传的参考音频')
    }
    if (definition.family === 'minimax-tts' && !params.request.voice.startsWith('kuaizi-voice:')) {
      throw new Error('请先选择 Kuaizi 音色 ID')
    }
    const voice = params.request.voice.replace(/^kuaizi-(?:audio|voice):/, '')
    const generated = await generateAudio(params.userId, params.modelKey, params.request.prompt, { voice })
    const requestId = compact(generated.requestId)
    const externalId = compact(generated.externalId)
    if (!generated.success || !generated.async || !requestId || !externalId) {
      throw new Error(generated.error || '筷子音频服务没有返回可轮询的任务。')
    }
    return { kind: 'async', requestId, externalId }
  }

  throw new Error(`AUDIO_PROVIDER_NOT_IMPLEMENTED: ${selection.provider}`)
}
