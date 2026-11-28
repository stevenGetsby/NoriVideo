import type { NoriBusinessModelType } from '@/lib/nori-model-catalog'
import { composeModelKey } from '@/lib/model-config-contract'
import { getRawProviderKey } from '@/lib/model-provider-contract'
import { resolveOpenLuxKeyGroupForModel } from '@/lib/providers/openlux/groups'
import type { PlatformServiceConfigResponse } from './config'

// Kept inline (no server-module runtime imports) because client admin components
// import PROVIDER_DISPLAY_NAMES from this module.
const KUAIZI_SEEDANCE_25_INTL_MODEL_ID = 'doubao-seedance-2-5-260628-intl'
const KUAIZI_SEEDANCE_25_INTL_MODEL_KEY = `kuaizi::${KUAIZI_SEEDANCE_25_INTL_MODEL_ID}`

const CUSTOMER_BUSINESS_MODEL_NAMES: Readonly<Record<string, string>> = {
  'nori::nori-gpt': 'Nori GPT',
  'nori::nori-gpt-max': 'Nori GPT Max',
  'nori::nori-gemini': 'Nori Gemini',
  'nori::nori-deepseek': 'Nori DeepSeek',
  'nori::nori-deepseek-pro': 'Nori DeepSeek Pro',
  'nori::nori-kimi': 'Nori Kimi',
  'nori::nori-image-mini': 'GPT Image 2.5 Mini',
  'nori::nori-image-fast': 'GPT Image 2.5 Fast',
  'nori::nori-image': 'GPT Image 2.5',
  'nori::nori-image-pro': 'GPT Image 2.5 Pro',
  'nori::nori-image-2.6': 'GPT Image 2.6',
  'nori::nori-image-2.6-pro': 'GPT Image 2.6 Pro',
  'nori::norivideo2.5': 'Seedance 2.5',
  'nori::norivideo2.5-intl': 'Seedance 2.5 国际版',
  'nori::seedance2.0-mini': 'Seedance 2.0 Mini',
  'nori::seedance2.0-fast': 'Seedance 2.0 Fast',
  'nori::seedance2.0': 'Seedance 2.0',
  'nori::nori-audio': 'Nori Audio',
  'nori::nori-music': 'Nori Music',
  'nori::nori-sfx': 'Nori SFX',
}

export type SelectableModelType = NoriBusinessModelType

export const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  openlux: 'OpenLux',
  kuaizi: 'Kuaizi',
  huimengi: '绘梦工坊',
  ailink: 'AILink',
  topenrouter: 'TopenRouter',
}

const PROVIDER_MODEL_DISPLAY_OVERRIDES: Readonly<Record<string, string>> = {
  [KUAIZI_SEEDANCE_25_INTL_MODEL_KEY]: 'Kuaizi · Seedance 2.5 国际版',
  'openlux::gemini-3.8-flash': 'OpenLux · Gemini 3.8 Flash',
  'openlux::deepseek-v4.1-flash': 'OpenLux · DeepSeek V4.1 Flash',
  'openlux::deepseek-v4-pro': 'OpenLux · DeepSeek V4 Pro',
  'openlux::qwen3.8-max': 'OpenLux · Qwen 3.8 Max',
  'openlux::kimi-k2.6': 'OpenLux · Kimi K2.6',
  'openlux::claude-sonnet-5': 'OpenLux · Claude Sonnet 5',
}

export function providerModelDisplayName(runtimeModelKey: string, modelId: string): string {
  if (PROVIDER_MODEL_DISPLAY_OVERRIDES[runtimeModelKey]) {
    return PROVIDER_MODEL_DISPLAY_OVERRIDES[runtimeModelKey]
  }
  const provider = getRawProviderKey(runtimeModelKey).toLowerCase()
  return `${PROVIDER_DISPLAY_NAMES[provider] || provider} · ${modelId}`
}

export interface ModelViewerContext {
  userId?: string | null
  actorId?: string | null
  workspaceOwnerId?: string | null
}

export function viewerContextFromSession(session: {
  user: {
    id: string
    actorId?: string | null
    workspaceOwnerId?: string | null
  }
}): ModelViewerContext {
  return {
    userId: session.user.id,
    actorId: session.user.actorId || session.user.id,
    workspaceOwnerId: session.user.workspaceOwnerId || session.user.id,
  }
}

/**
 * Internal full-catalog view matches either the actor's own user ID OR their
 * workspaceOwnerId, so sub-accounts under an internal main account
 * automatically inherit the internal full view.
 */
export function isInternalModelViewer(
  config: Pick<PlatformServiceConfigResponse, 'internalModelViewUserIds'>,
  viewer?: ModelViewerContext | string | null,
): boolean {
  if (!Array.isArray(config.internalModelViewUserIds) || config.internalModelViewUserIds.length === 0) {
    return false
  }
  if (typeof viewer === 'string') {
    const id = viewer.trim()
    return Boolean(id && config.internalModelViewUserIds.includes(id))
  }
  const actorId = (viewer?.actorId || viewer?.userId)?.trim() || ''
  if (actorId && config.internalModelViewUserIds.includes(actorId)) return true
  const workspaceOwnerId = viewer?.workspaceOwnerId?.trim() || ''
  if (workspaceOwnerId && config.internalModelViewUserIds.includes(workspaceOwnerId)) return true
  return false
}

export function isCustomerModelVisibleForViewer(
  config: Pick<PlatformServiceConfigResponse, 'customerVisibleModels' | 'customerModelOverrides'>,
  businessModelKey: string,
  viewer?: ModelViewerContext | null,
): boolean {
  const overrides = config.customerModelOverrides || {}
  const actorId = viewer?.actorId?.trim() || viewer?.userId?.trim() || ''
  if (actorId && overrides[actorId] && Object.hasOwn(overrides[actorId], businessModelKey)) {
    return overrides[actorId][businessModelKey] === true
  }
  const workspaceOwnerId = viewer?.workspaceOwnerId?.trim() || ''
  if (workspaceOwnerId && overrides[workspaceOwnerId] && Object.hasOwn(overrides[workspaceOwnerId], businessModelKey)) {
    return overrides[workspaceOwnerId][businessModelKey] === true
  }
  return config.customerVisibleModels?.[businessModelKey] === true
}

/**
 * Returns the explicit per-customer provider route override (actorId -> workspaceOwnerId)
 * for a Nori business model, or '' when the customer inherits the global default route.
 */
export function resolveCustomerModelRoutingOverride(
  config: Pick<PlatformServiceConfigResponse, 'customerModelRoutingOverrides'>,
  businessModelKey: string,
  viewer?: ModelViewerContext | null,
): string {
  const overrides = config.customerModelRoutingOverrides || {}
  const actorId = viewer?.actorId?.trim() || viewer?.userId?.trim() || ''
  if (actorId && overrides[actorId] && Object.hasOwn(overrides[actorId], businessModelKey)) {
    const target = (overrides[actorId][businessModelKey] || '').trim()
    if (target) return target
  }
  const workspaceOwnerId = viewer?.workspaceOwnerId?.trim() || ''
  if (workspaceOwnerId && overrides[workspaceOwnerId] && Object.hasOwn(overrides[workspaceOwnerId], businessModelKey)) {
    const target = (overrides[workspaceOwnerId][businessModelKey] || '').trim()
    if (target) return target
  }
  return ''
}

/**
 * Resolves the authoritative runtime provider model behind a Nori business model
 * for a viewer: actor override -> workspaceOwner override -> global modelRouting.
 */
export function resolveBusinessModelRouteForViewer(
  config: Pick<PlatformServiceConfigResponse, 'modelRouting' | 'customerModelRoutingOverrides'>,
  businessModelKey: string,
  viewer?: ModelViewerContext | null,
): string {
  const overridden = resolveCustomerModelRoutingOverride(config, businessModelKey, viewer)
  if (overridden) return overridden
  return (config.modelRouting?.[businessModelKey as keyof typeof config.modelRouting] || '').trim()
}

export function customerModelDisplayName(modelKey: string, fallbackModelId?: string): string {
  if (CUSTOMER_BUSINESS_MODEL_NAMES[modelKey]) return CUSTOMER_BUSINESS_MODEL_NAMES[modelKey]
  const raw = (fallbackModelId || modelKey.split('::').slice(1).join('::') || modelKey).trim()
  if (raw === KUAIZI_SEEDANCE_25_INTL_MODEL_ID || raw === 'norivideo2.5-intl') return 'Seedance 2.5 国际版'
  if (raw === 'doubao-seedance-2-5-260628' || raw === 'norivideo2.5') return 'Seedance 2.5'
  return raw
}

function isUsableRuntimeModel(
  config: PlatformServiceConfigResponse,
  providerId: string,
  modelId: string,
): boolean {
  const provider = config.providers.find((item) => item.id === providerId)
  if (!provider) return false
  if (providerId === 'openlux') {
    const group = resolveOpenLuxKeyGroupForModel(modelId)
    const hasKey = provider.hasApiKey === true || (group !== 'default' && provider.groupApiKeyStatus?.[group] === true)
    if (!hasKey) return false
  } else if (!provider.hasApiKey) {
    return false
  }
  if (providerId === 'kuaizi' && modelId === KUAIZI_SEEDANCE_25_INTL_MODEL_ID && !provider.seedance25IntlKzep?.trim()) {
    return false
  }
  return true
}

/** 旧版业务键（nori::*）映射到当前可选的直连模型键；无法映射时原样返回。 */
export function resolveSelectableModelKey(
  config: PlatformServiceConfigResponse,
  modelKey: string,
  type: SelectableModelType,
): string {
  if (type !== 'video' || !modelKey) return modelKey
  const business = config.businessModels.find((model) => model.key === modelKey && model.type === 'video')
  if (!business) return modelKey
  const target = config.modelRouting[business.key as keyof typeof config.modelRouting]
  return target && listConfiguredSelectableModels(config, 'video').some((model) => model.modelKey === target) ? target : modelKey
}

export function listSelectableModelAliases(config: PlatformServiceConfigResponse): Record<string, string> {
  return Object.fromEntries(config.businessModels
    .filter((model) => model.type === 'video')
    .map((model) => [model.key, resolveSelectableModelKey(config, model.key, 'video')])
    .filter(([key, value]) => key !== value))
}

export interface ConfiguredSelectableModel {
  modelKey: string
  modelId: string
  name: string
  type: SelectableModelType
  runtimeModelKey: string
}

export function listConfiguredSelectableModels(
  config: PlatformServiceConfigResponse,
  type: SelectableModelType,
): ConfiguredSelectableModel[] {
  const providers = new Map(config.providers.map((provider) => [provider.id, provider.hasApiKey]))
  const providerById = new Map(config.providers.map((provider) => [provider.id, provider]))
  // 视频模型由管理员只做开关：开启且服务商已配置密钥的模型直接可选。
  if (type === 'video') {
    return config.models
      .filter((model) => {
        if (model.type !== 'video' || providers.get(model.provider) !== true) return false
        const key = composeModelKey(model.provider, model.modelId)
        if (config.modelEnabled?.[key] !== true) return false
        if (key === KUAIZI_SEEDANCE_25_INTL_MODEL_KEY && !providerById.get('kuaizi')?.seedance25IntlKzep?.trim()) {
          return false
        }
        return true
      })
      .map((model) => {
        const modelKey = composeModelKey(model.provider, model.modelId)
        return { modelKey, modelId: model.modelId, name: model.modelId, type, runtimeModelKey: modelKey }
      })
  }
  const models = new Map(config.models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  return config.businessModels.filter((business) => {
    if (business.type !== type) return false
    const runtimeModelKey = config.modelRouting[business.key as keyof typeof config.modelRouting]
    const runtime = runtimeModelKey ? models.get(runtimeModelKey) : null
    return runtime?.type === type && isUsableRuntimeModel(config, runtime.provider, runtime.modelId)
  }).map((business) => {
    const runtimeModelKey = config.modelRouting[business.key as keyof typeof config.modelRouting]
    return {
      modelKey: business.key,
      modelId: runtimeModelKey.split('::').slice(1).join('::'),
      name: runtimeModelKey.split('::').slice(1).join('::'),
      type,
      runtimeModelKey,
    }
  })
}

export function listSelectableModelsForViewer(
  config: PlatformServiceConfigResponse,
  type: SelectableModelType,
  viewer?: ModelViewerContext | null,
): ConfiguredSelectableModel[] {
  const internalViewer = isInternalModelViewer(config, viewer)
  const modelsByKey = new Map(config.models.map((model) => [composeModelKey(model.provider, model.modelId), model]))

  if (internalViewer) {
    // Internal operators see configured usable provider models for video,
    // image & llm (even models hidden from customers) so they can compare providers.
    // For video models, respect the administrator's global modelEnabled switch:
    // turning a video model OFF hides it from internal accounts as well.
    if (type === 'video' || type === 'image' || type === 'llm') {
      return config.models
        .filter((model) => {
          if (model.type !== type || !isUsableRuntimeModel(config, model.provider, model.modelId)) return false
          if (type === 'video') {
            const key = composeModelKey(model.provider, model.modelId)
            if (config.modelEnabled?.[key] !== true) return false
          }
          return true
        })
        .map((model) => {
          const modelKey = composeModelKey(model.provider, model.modelId)
          return {
            modelKey,
            modelId: model.modelId,
            name: providerModelDisplayName(modelKey, model.modelId),
            type,
            runtimeModelKey: modelKey,
          }
        })
    }
    return config.businessModels
      .filter((business) => {
        if (business.type !== type) return false
        const runtimeModelKey = config.modelRouting[business.key as keyof typeof config.modelRouting]
        const runtime = runtimeModelKey ? modelsByKey.get(runtimeModelKey) : null
        return runtime?.type === type && isUsableRuntimeModel(config, runtime.provider, runtime.modelId)
      })
      .map((business) => {
        const runtimeModelKey = config.modelRouting[business.key as keyof typeof config.modelRouting]
        const runtimeModelId = runtimeModelKey.split('::').slice(1).join('::')
        return {
          modelKey: business.key,
          modelId: runtimeModelId,
          name: providerModelDisplayName(runtimeModelKey, runtimeModelId),
          type,
          runtimeModelKey,
        }
      })
  }

  // Customer white-label view: ONLY customer-visible nori::* business models
  // with clean model names, zero upstream provider identifiers, and per-customer
  // provider routing applied (actor -> workspaceOwner -> global default).
  return config.businessModels
    .filter((business) => {
      if (business.type !== type) return false
      if (!isCustomerModelVisibleForViewer(config, business.key, viewer)) return false
      const runtimeModelKey = resolveBusinessModelRouteForViewer(config, business.key, viewer)
      const runtime = runtimeModelKey ? modelsByKey.get(runtimeModelKey) : null
      return runtime?.type === type && isUsableRuntimeModel(config, runtime.provider, runtime.modelId)
    })
    .map((business) => {
      const runtimeModelKey = resolveBusinessModelRouteForViewer(config, business.key, viewer)
      const businessModelId = business.key.split('::').slice(1).join('::')
      return {
        modelKey: business.key,
        modelId: businessModelId,
        name: business.customerName || customerModelDisplayName(business.key, businessModelId),
        type,
        runtimeModelKey,
      }
    })
}

export function resolveSelectableModelKeyForViewer(
  config: PlatformServiceConfigResponse,
  modelKey: string,
  type: SelectableModelType,
  viewer?: ModelViewerContext | null,
): string {
  if (!modelKey) return ''
  const selectable = listSelectableModelsForViewer(config, type, viewer)
  if (selectable.some((model) => model.modelKey === modelKey)) return modelKey
  if (isInternalModelViewer(config, viewer)) {
    const business = config.businessModels.find((model) => model.key === modelKey && model.type === type)
    if (business) {
      const target = config.modelRouting[business.key as keyof typeof config.modelRouting]
      if (target && selectable.some((model) => model.modelKey === target)) return target
    }
    return selectable[0]?.modelKey || ''
  }
  // Customer compatibility: map a legacy direct provider::modelId key to the
  // customer-visible nori::* model currently routed to it.
  const matchedByRuntime = selectable.find((model) => model.runtimeModelKey === modelKey)
  if (matchedByRuntime) return matchedByRuntime.modelKey
  return selectable[0]?.modelKey || ''
}

export function listSelectableModelAliasesForViewer(
  config: PlatformServiceConfigResponse,
  viewer?: ModelViewerContext | null,
): Record<string, string> {
  if (!isInternalModelViewer(config, viewer)) return {}
  const selectableVideo = listSelectableModelsForViewer(config, 'video', viewer)
  const selectableImage = listSelectableModelsForViewer(config, 'image', viewer)
  const selectableLlm = listSelectableModelsForViewer(config, 'llm', viewer)
  const selectableKeys = new Set([...selectableVideo, ...selectableImage, ...selectableLlm].map((model) => model.modelKey))
  return Object.fromEntries(config.businessModels
    .filter((model) => model.type === 'video' || model.type === 'image' || model.type === 'llm')
    .map((model) => {
      const target = config.modelRouting[model.key as keyof typeof config.modelRouting] || ''
      return [model.key, selectableKeys.has(target) ? target : '']
    })
    .filter(([key, value]) => Boolean(value) && key !== value))
}

export function resolveModelKeyForViewer(
  config: PlatformServiceConfigResponse,
  requestedModelKey: string,
  type: SelectableModelType,
  viewer?: ModelViewerContext | null,
): { allowed: true; modelKey: string; runtimeModelKey: string } | { allowed: false; reason: string } {
  const normalized = requestedModelKey.trim()
  if (!normalized) return { allowed: false, reason: '模型参数不能为空。' }
  const selectable = listSelectableModelsForViewer(config, type, viewer)
  const direct = selectable.find((model) => model.modelKey === normalized)
  if (direct) {
    return { allowed: true, modelKey: direct.modelKey, runtimeModelKey: direct.runtimeModelKey }
  }
  if (isInternalModelViewer(config, viewer)) {
    const business = config.businessModels.find((model) => model.key === normalized && model.type === type)
    if (business) {
      const target = config.modelRouting[business.key as keyof typeof config.modelRouting]
      const matched = selectable.find((model) => model.modelKey === target)
      if (matched) return { allowed: true, modelKey: matched.modelKey, runtimeModelKey: matched.runtimeModelKey }
    }
    return { allowed: false, reason: '所选模型当前已关闭、不可用或未配置密钥。' }
  }
  // Customer compatibility: allow a legacy saved canvas node pointing at a
  // direct provider::modelId ONLY when it is the active routed target of a
  // customer-visible nori::* model, transparently upgrading it to nori::*.
  const compat = selectable.find((model) => model.runtimeModelKey === normalized)
  if (compat) {
    return { allowed: true, modelKey: compat.modelKey, runtimeModelKey: compat.runtimeModelKey }
  }
  return { allowed: false, reason: '当前账号无权使用该模型，请选择可用模型。' }
}
