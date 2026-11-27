import { parseModelKeyStrict, type UnifiedModelType } from '@/lib/model-config-contract'
import { getServiceLlmConfig } from '@/lib/service-config'
import { getAccountActorContext } from '@/lib/account/request-context'
import { getRawProviderKey } from '@/lib/model-provider-contract'
import { fixedPlatformModels, isPlatformVideoModelEnabled } from '@/lib/platform-services/config'
import { findBuiltinPricingCatalogEntry, type PricingApiType } from '@/lib/model-pricing/catalog'

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
    customerName: 'Nori GPT',
    description: '标准文本模型',
    type: 'llm',
    tier: 'standard',
    suggestedRoute: 'deepseek::deepseek-chat',
  },
  {
    key: 'nori::nori-gpt-max',
    modelId: 'nori-gpt-max',
    name: 'nori-gpt-max',
    customerName: 'Nori GPT Max',
    description: '高质量文本模型',
    type: 'llm',
    tier: 'pro',
    suggestedRoute: 'deepseek::deepseek-reasoner',
  },
  {
    key: 'nori::nori-gemini',
    modelId: 'nori-gemini',
    name: 'nori-gemini',
    customerName: 'Nori Gemini',
    description: 'Gemini 文本模型',
    type: 'llm',
    tier: 'pro',
    suggestedRoute: 'deepseek::deepseek-reasoner',
  },
  {
    key: 'nori::nori-deepseek',
    modelId: 'nori-deepseek',
    name: 'nori-deepseek',
    customerName: 'Nori DeepSeek',
    description: 'DeepSeek 文本模型',
    type: 'llm',
    tier: 'standard',
    suggestedRoute: 'deepseek::deepseek-chat',
  },
  {
    key: 'nori::nori-image-mini',
    modelId: 'nori-image-mini',
    name: 'nori-image-mini',
    customerName: 'GPT Image 2.5 Mini',
    description: '低成本草图与批量试验',
    type: 'image',
    tier: 'mini',
    suggestedRoute: 'openlux::gpt-image-2.5-flare',
  },
  {
    key: 'nori::nori-image-fast',
    modelId: 'nori-image-fast',
    name: 'nori-image-fast',
    customerName: 'GPT Image 2.5 Fast',
    description: '快速预览与提示词调试',
    type: 'image',
    tier: 'fast',
    suggestedRoute: 'openlux::gpt-image-2.5-flare',
  },
  {
    key: 'nori::nori-image',
    modelId: 'nori-image',
    name: 'nori-image',
    customerName: 'GPT Image 2.5',
    description: '标准图片模型',
    type: 'image',
    tier: 'standard',
    suggestedRoute: 'openlux::gpt-image-2.5-sunburst',
  },
  {
    key: 'nori::nori-image-pro',
    modelId: 'nori-image-pro',
    name: 'nori-image-pro',
    customerName: 'GPT Image 2.5 Pro',
    description: '高质量图片模型',
    type: 'image',
    tier: 'pro',
    suggestedRoute: 'openlux::gpt-image-2.5-sunburst',
  },
  {
    key: 'nori::nori-image-2.6',
    modelId: 'nori-image-2.6',
    name: 'nori-image-2.6',
    customerName: 'GPT Image 2.6',
    description: '新一代标准图片模型',
    type: 'image',
    tier: 'standard',
    suggestedRoute: 'openlux::gpt-image-2.6-flare-c',
  },
  {
    key: 'nori::nori-image-2.6-pro',
    modelId: 'nori-image-2.6-pro',
    name: 'nori-image-2.6-pro',
    customerName: 'GPT Image 2.6 Pro',
    description: '新一代高质量图片模型',
    type: 'image',
    tier: 'pro',
    suggestedRoute: 'openlux::gpt-image-2.6-sunburst-c',
  },
  {
    key: 'nori::norivideo2.5',
    modelId: 'norivideo2.5',
    name: 'LanMiaoTV 2.5',
    customerName: 'Seedance 2.5',
    description: 'Seedance 2.5 高质量视频（最长 30 秒，多模态参考）',
    type: 'video',
    tier: 'pro',
    suggestedRoute: 'kuaizi::doubao-seedance-2-5-260628',
  },
  {
    key: 'nori::norivideo2.5-intl',
    modelId: 'norivideo2.5-intl',
    name: 'Seedance 2.5 国际版',
    customerName: 'Seedance 2.5 国际版',
    description: 'Seedance 2.5 国际版高质量视频（最长 30 秒，多模态参考）',
    type: 'video',
    tier: 'pro',
    suggestedRoute: 'kuaizi::doubao-seedance-2-5-260628-intl',
  },
  {
    key: 'nori::seedance2.0-mini',
    modelId: 'seedance2.0-mini',
    name: 'seedance2.0-mini',
    customerName: 'Seedance 2.0 Mini',
    description: '低成本预演，适合快速验证镜头',
    type: 'video',
    tier: 'mini',
    suggestedRoute: 'kuaizi::doubao-seedance-2-0-mini-260615',
  },
  {
    key: 'nori::seedance2.0-fast',
    modelId: 'seedance2.0-fast',
    name: 'seedance2.0-fast',
    customerName: 'Seedance 2.0 Fast',
    description: '快速生成，适合镜头迭代',
    type: 'video',
    tier: 'fast',
    suggestedRoute: 'kuaizi::doubao-seedance-2-0-fast-260128',
  },
  {
    key: 'nori::seedance2.0',
    modelId: 'seedance2.0',
    name: 'seedance2.0-pro',
    customerName: 'Seedance 2.0',
    description: '正式成片与高质量交付',
    type: 'video',
    tier: 'pro',
    suggestedRoute: 'kuaizi::doubao-seedance-2-0-260128',
  },
  {
    key: 'nori::nori-audio',
    modelId: 'nori-audio',
    name: 'nori-audio',
    customerName: 'Nori Audio',
    description: '语音合成模型',
    type: 'audio',
    tier: 'standard',
    suggestedRoute: 'kuaizi::speech-2.8-hd',
  },
  {
    key: 'nori::nori-music',
    modelId: 'nori-music',
    name: 'nori-music',
    customerName: 'Nori Music',
    description: '音乐生成模型',
    type: 'audio',
    tier: 'standard',
    suggestedRoute: '',
  },
  {
    key: 'nori::nori-sfx',
    modelId: 'nori-sfx',
    name: 'nori-sfx',
    customerName: 'Nori SFX',
    description: '音效生成模型',
    type: 'audio',
    tier: 'standard',
    suggestedRoute: '',
  },
] as const satisfies ReadonlyArray<{
  key: string
  modelId: string
  name: string
  customerName: string
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
  video: 'nori::norivideo2.5',
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
export type NoriModelRouteViewer = {
  userId?: string | null
  actorId?: string | null
  workspaceOwnerId?: string | null
}

export function resolveNoriModelRoute(
  modelKey: string | null | undefined,
  viewer?: NoriModelRouteViewer | null,
): string | null {
  const businessModel = findNoriBusinessModel(modelKey)
  if (!businessModel) return null
  const llmConfig = getServiceLlmConfig()
  const routingOverrides = llmConfig?.customerModelRoutingOverrides
  const activeViewer = viewer === undefined ? getAccountActorContext() : viewer
  let overridden = ''
  if (activeViewer && routingOverrides) {
    const actorId = compact(activeViewer.actorId || activeViewer.userId)
    if (actorId && routingOverrides[actorId] && Object.hasOwn(routingOverrides[actorId], businessModel.key)) {
      overridden = compact(routingOverrides[actorId][businessModel.key])
    }
    if (!overridden) {
      const workspaceOwnerId = compact(activeViewer.workspaceOwnerId)
      if (workspaceOwnerId && routingOverrides[workspaceOwnerId] && Object.hasOwn(routingOverrides[workspaceOwnerId], businessModel.key)) {
        overridden = compact(routingOverrides[workspaceOwnerId][businessModel.key])
      }
    }
  }
  const routing = llmConfig?.modelRouting
  const configured = overridden
    || (routing && Object.hasOwn(routing, businessModel.key) ? routing[businessModel.key] : businessModel.suggestedRoute)
  const target = compact(configured)
  const parsed = parseModelKeyStrict(target)
  const provider = getRawProviderKey(parsed?.provider).toLowerCase()
  if (!parsed || parsed.provider === NORI_PROVIDER_ID) return null
  // Images may run on OpenLux or HuiMeng; video on Kuaizi or HuiMeng. The
  // administrator picks the upstream per business model and can switch freely.
  const allowedProviders = businessModel.type === 'llm'
    ? ['deepseek']
    : businessModel.type === 'image'
      ? ['openlux', 'huimengi']
      : businessModel.type === 'video'
        ? ['kuaizi', 'huimengi', 'ailink', 'topenrouter']
        : ['kuaizi']
  if (!allowedProviders.includes(provider)) return null
  const pricingType: PricingApiType = businessModel.type === 'llm'
    ? 'text'
    : businessModel.type === 'audio'
      ? 'voice'
      : businessModel.type
  if (!findBuiltinPricingCatalogEntry(pricingType, NORI_PROVIDER_ID, businessModel.modelId)
    && !findBuiltinPricingCatalogEntry(pricingType, parsed.provider, parsed.modelId)) return null
  return parsed.modelKey
}

export function resolveRuntimeModelKey(
  modelKey: string | null | undefined,
  viewer?: NoriModelRouteViewer | null,
): string | null {
  const compacted = compact(modelKey)
  if (!compacted) return null
  return resolveNoriModelRoute(compacted, viewer) || parseModelKeyStrict(compacted)?.modelKey || null
}

export function getNoriModelRouting(): Record<NoriBusinessModelKey, string> {
  return Object.fromEntries(
    NORI_BUSINESS_MODELS.map((model) => [model.key, resolveNoriModelRoute(model.key, null) || '']),
  ) as Record<NoriBusinessModelKey, string>
}

function inferLegacyBusinessModel(modelKey: string, type: NoriBusinessModelType): NoriBusinessModelKey {
  const lower = modelKey.toLowerCase()
  if (type === 'audio') return NORI_DEFAULT_MODEL_KEYS.audio
  if (type === 'video') {
    if (lower.includes('2-5-260628-intl') || lower.includes('2.5-intl')) return 'nori::norivideo2.5-intl'
    if (/(?:lite|mini)/.test(lower)) return 'nori::seedance2.0-mini'
    if (/(?:fast|flash|turbo)/.test(lower)) return 'nori::seedance2.0-fast'
    // Legacy keys keep their historical tier so a default change never silently reprices old projects.
    return /(?<!\d)2[.\-_]?5(?!\d)/.test(lower) ? 'nori::norivideo2.5' : 'nori::seedance2.0'
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
): string {
  const compacted = compact(modelKey)
  const businessModel = findNoriBusinessModel(compacted)
  if (businessModel?.type === type) return businessModel.key

  const parsed = parseModelKeyStrict(compacted)
  if (!compacted) return NORI_DEFAULT_MODEL_KEYS[type]
  if (!parsed) return inferLegacyBusinessModel(compacted, type)
  if (parsed.provider === NORI_PROVIDER_ID) return inferLegacyBusinessModel(parsed.modelKey, type)
  if (type === 'video' && isPlatformVideoModelEnabled(parsed.modelKey)) return parsed.modelKey
  const routedMatches = NORI_BUSINESS_MODELS.filter(
    (candidate) => candidate.type === type && resolveNoriModelRoute(candidate.key) === parsed.modelKey,
  )
  if (routedMatches.length === 1) return routedMatches[0].key
  if (routedMatches.length > 1) return '__ambiguous__'
  if (fixedPlatformModels().some((model) => (
    model.provider === parsed.provider
    && model.modelId === parsed.modelId
    && model.type === type
  ))) return '__unrouted__'

  return inferLegacyBusinessModel(parsed.modelKey, type)
}
