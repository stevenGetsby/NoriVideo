import { parseModelKeyStrict, type UnifiedModelType } from '@/lib/model-config-contract'
import { getServiceLlmConfig } from '@/lib/service-config'
import { getRawProviderKey } from '@/lib/model-provider-contract'

export const NORI_PROVIDER_ID = 'nori'

export const NORI_MODEL_TIERS = ['mini', 'fast', 'standard', 'pro'] as const
export type NoriModelTier = typeof NORI_MODEL_TIERS[number]

export const NORI_MODEL_TIER_LABELS: Record<NoriModelTier, string> = {
  mini: 'Mini',
  fast: 'Fast',
  standard: '标准',
  pro: 'Pro',
}

export const NORI_BUSINESS_MODELS = [
  {
    key: 'nori::nori-gpt',
    modelId: 'nori-gpt',
    name: 'nori-gpt',
    description: '标准文本模型',
    type: 'llm',
    tier: 'standard',
    suggestedRoute: 'deepseek::deepseek-chat',
  },
  {
    key: 'nori::nori-gpt-max',
    modelId: 'nori-gpt-max',
    name: 'nori-gpt-max',
    description: '高质量文本模型',
    type: 'llm',
    tier: 'pro',
    suggestedRoute: 'deepseek::deepseek-reasoner',
  },
  {
    key: 'nori::nori-gemini',
    modelId: 'nori-gemini',
    name: 'nori-gemini',
    description: 'Gemini 文本模型',
    type: 'llm',
    tier: 'pro',
    suggestedRoute: 'deepseek::deepseek-reasoner',
  },
  {
    key: 'nori::nori-deepseek',
    modelId: 'nori-deepseek',
    name: 'nori-deepseek',
    description: 'DeepSeek 文本模型',
    type: 'llm',
    tier: 'standard',
    suggestedRoute: 'deepseek::deepseek-chat',
  },
  {
    key: 'nori::nori-image-mini',
    modelId: 'nori-image-mini',
    name: 'nori-image-mini',
    description: '低成本草图与批量试验',
    type: 'image',
    tier: 'mini',
    suggestedRoute: 'kuaizi::seedream5.0lite',
  },
  {
    key: 'nori::nori-image-fast',
    modelId: 'nori-image-fast',
    name: 'nori-image-fast',
    description: '快速预览与提示词调试',
    type: 'image',
    tier: 'fast',
    suggestedRoute: 'kuaizi::kz_gpt_image2',
  },
  {
    key: 'nori::nori-image',
    modelId: 'nori-image',
    name: 'nori-image',
    description: '标准图片模型',
    type: 'image',
    tier: 'standard',
    suggestedRoute: 'kuaizi::seedream5.0lite',
  },
  {
    key: 'nori::nori-image-pro',
    modelId: 'nori-image-pro',
    name: 'nori-image-pro',
    description: '高质量图片模型',
    type: 'image',
    tier: 'pro',
    suggestedRoute: 'kuaizi::seedream5.0pro',
  },
  {
    key: 'nori::seedance2.0-mini',
    modelId: 'seedance2.0-mini',
    name: 'seedance2.0-mini',
    description: '低成本预演，适合快速验证镜头',
    type: 'video',
    tier: 'mini',
    suggestedRoute: 'kuaizi::doubao-seedance-2-0-mini-260615',
  },
  {
    key: 'nori::seedance2.0-fast',
    modelId: 'seedance2.0-fast',
    name: 'seedance2.0-fast',
    description: '快速生成，适合镜头迭代',
    type: 'video',
    tier: 'fast',
    suggestedRoute: 'kuaizi::doubao-seedance-2-0-fast-260128',
  },
  {
    key: 'nori::seedance2.0',
    modelId: 'seedance2.0',
    name: 'seedance2.0-pro',
    description: '正式成片与高质量交付',
    type: 'video',
    tier: 'pro',
    suggestedRoute: 'kuaizi::doubao-seedance-2-0-260128',
  },
  {
    key: 'nori::norivideo2.5',
    modelId: 'norivideo2.5',
    name: 'LanmiaoTV 2.5',
    description: 'Seedance 2.5 高质量视频（最长 30 秒，多模态参考）',
    type: 'video',
    tier: 'pro',
    suggestedRoute: 'kuaizi::doubao-seedance-2-5-260628',
  },
  {
    key: 'nori::nori-audio',
    modelId: 'nori-audio',
    name: 'nori-audio',
    description: '语音合成模型',
    type: 'audio',
    tier: 'standard',
    suggestedRoute: 'kuaizi::speech-2.8-hd',
  },
  {
    key: 'nori::nori-music',
    modelId: 'nori-music',
    name: 'nori-music',
    description: '音乐生成模型',
    type: 'audio',
    tier: 'standard',
    suggestedRoute: '',
  },
  {
    key: 'nori::nori-sfx',
    modelId: 'nori-sfx',
    name: 'nori-sfx',
    description: '音效生成模型',
    type: 'audio',
    tier: 'standard',
    suggestedRoute: '',
  },
] as const satisfies ReadonlyArray<{
  key: string
  modelId: string
  name: string
  description: string
  type: Extract<UnifiedModelType, 'llm' | 'image' | 'video' | 'audio'>
  tier: NoriModelTier
  suggestedRoute: string
}>

export type NoriBusinessModel = typeof NORI_BUSINESS_MODELS[number]
export type NoriBusinessModelKey = NoriBusinessModel['key']
export type NoriBusinessModelType = NoriBusinessModel['type']

export const NORI_DEFAULT_MODEL_KEYS = {
  llm: 'nori::nori-gpt',
  image: 'nori::nori-image',
  video: 'nori::seedance2.0',
  audio: 'nori::nori-audio',
} as const satisfies Record<NoriBusinessModelType, NoriBusinessModelKey>

const CATALOG_BY_KEY = new Map<string, NoriBusinessModel>(
  NORI_BUSINESS_MODELS.map((model) => [model.key, model]),
)

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function findNoriBusinessModel(modelKey: string | null | undefined): NoriBusinessModel | null {
  return CATALOG_BY_KEY.get(compact(modelKey)) || null
}

export function isNoriBusinessModelKey(modelKey: string | null | undefined): modelKey is NoriBusinessModelKey {
  return Boolean(findNoriBusinessModel(modelKey))
}

export function listNoriBusinessModels(type?: NoriBusinessModelType): NoriBusinessModel[] {
  return NORI_BUSINESS_MODELS
    .filter((model) => !type || model.type === type)
    .map((model) => ({ ...model }))
}

/**
 * Returns the administrator-controlled provider model behind a stable Nori model key.
 * Suggested routes keep existing installations working until their first admin save.
 */
export function resolveNoriModelRoute(modelKey: string | null | undefined): string | null {
  const businessModel = findNoriBusinessModel(modelKey)
  if (!businessModel) return null
  const routing = getServiceLlmConfig()?.modelRouting
  const configured = routing && Object.hasOwn(routing, businessModel.key) ? routing[businessModel.key] : businessModel.suggestedRoute
  const target = compact(configured)
  const parsed = parseModelKeyStrict(target)
  const provider = getRawProviderKey(parsed?.provider).toLowerCase()
  if (!parsed || parsed.provider === NORI_PROVIDER_ID) return null
  if (businessModel.type === 'llm' ? provider !== 'deepseek' : provider !== 'kuaizi') return null
  return parsed.modelKey
}

export function resolveRuntimeModelKey(modelKey: string | null | undefined): string | null {
  const compacted = compact(modelKey)
  if (!compacted) return null
  return resolveNoriModelRoute(compacted) || parseModelKeyStrict(compacted)?.modelKey || null
}

export function getNoriModelRouting(): Record<NoriBusinessModelKey, string> {
  return Object.fromEntries(
    NORI_BUSINESS_MODELS.map((model) => [model.key, resolveNoriModelRoute(model.key) || '']),
  ) as Record<NoriBusinessModelKey, string>
}

function inferLegacyBusinessModel(modelKey: string, type: NoriBusinessModelType): NoriBusinessModelKey {
  const lower = modelKey.toLowerCase()
  if (type === 'audio') return NORI_DEFAULT_MODEL_KEYS.audio
  if (type === 'video') {
    if (/(?:lite|mini)/.test(lower)) return 'nori::seedance2.0-mini'
    if (/(?:fast|flash|turbo)/.test(lower)) return 'nori::seedance2.0-fast'
    return NORI_DEFAULT_MODEL_KEYS.video
  }
  if (type === 'image') {
    if (/(?:mini|2\.5-flash)/.test(lower)) return 'nori::nori-image-mini'
    if (/(?:fast|flash)/.test(lower)) return 'nori::nori-image-fast'
    return /(?:image[-_ ]?2pro|image[-_ ]?pro|pro)/.test(lower)
      ? 'nori::nori-image-pro'
      : NORI_DEFAULT_MODEL_KEYS.image
  }
  if (lower.includes('deepseek')) return 'nori::nori-deepseek'
  if (lower.includes('gemini')) return 'nori::nori-gemini'
  if (/(?:5\.6|terra|gpt[-_ ]?max)/.test(lower)) return 'nori::nori-gpt-max'
  return NORI_DEFAULT_MODEL_KEYS.llm
}

/**
 * Converts legacy project/provider keys to stable business keys so future route changes
 * also affect projects created before the platform model layer was introduced.
 */
export function normalizeProjectBusinessModelKey(
  modelKey: string | null | undefined,
  type: NoriBusinessModelType,
): NoriBusinessModelKey {
  const compacted = compact(modelKey)
  const businessModel = findNoriBusinessModel(compacted)
  if (businessModel?.type === type) return businessModel.key

  const parsed = parseModelKeyStrict(compacted)
  if (parsed) {
    const routedMatch = NORI_BUSINESS_MODELS.find(
      (candidate) => candidate.type === type && resolveNoriModelRoute(candidate.key) === parsed.modelKey,
    )
    if (routedMatch) return routedMatch.key
    return inferLegacyBusinessModel(parsed.modelKey, type)
  }
  return NORI_DEFAULT_MODEL_KEYS[type]
}
