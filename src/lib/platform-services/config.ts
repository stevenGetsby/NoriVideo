import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  readServiceConfig,
  resetServiceConfigCache,
  resolveServiceConfigPath,
  type ServiceConfig,
  type ServiceConfigDefaultModels,
  type ServiceConfigModel,
  type ServiceConfigProvider,
} from '@/lib/service-config'
import { resetStorageProvider } from '@/lib/storage'
import { composeModelKey, parseModelKeyStrict, type UnifiedModelType } from '@/lib/model-config-contract'
import { getRawProviderKey } from '@/lib/model-provider-contract'
import { CANVAS_AGENT_SELECTION_KEY, type CanvasAgentModelCatalog, type CanvasAgentModelSettings } from '@/lib/canvas-agent/model-catalog'
import { getCanvasAgentModelCatalog } from '@/lib/canvas-agent/model-runtime'
import { CANVAS_AGENT_MODEL_CANDIDATES, CANVAS_AGENT_PROVIDER_PRESETS } from '@/lib/canvas-agent/provider-registry'
import { listHuimengiCatalogModels } from '@/lib/providers/huimengi/catalog'
import { KUAIZI_SEEDANCE_25_INTL_MODEL_KEY, listKuaiziCatalogModels } from '@/lib/providers/kuaizi/catalog'
import { listOpenLuxSelectableModels } from '@/lib/providers/openlux/catalog'
import { listAilinkSelectableModels } from '@/lib/providers/ailink/catalog'
import { listTopenrouterSelectableModels } from '@/lib/providers/topenrouter/catalog'
import {
  listNoriBusinessModels,
  type NoriBusinessModelKey,
  type NoriModelTier,
} from '@/lib/nori-model-catalog'

const DEFAULT_MODEL_TYPES: Record<keyof ServiceConfigDefaultModels, UnifiedModelType> = {
  analysisModel: 'llm',
  characterModel: 'image',
  locationModel: 'image',
  storyboardModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  audioModel: 'audio',
  lipSyncModel: 'lipsync',
}
const PROVIDER_BASE_URLS = {
  deepseek: 'https://api.deepseek.com/v1',
  openlux: 'https://api.openlux.ai/v1',
  kuaizi: 'https://aiopenapi.kuaizi.cn',
  huimengi: 'https://api.huimengi.com',
  ailink: 'https://ailink.jinghua.security',
  topenrouter: 'https://tp-api.chinadatapay.com:8000',
  kimi: CANVAS_AGENT_PROVIDER_PRESETS.kimi.baseURL,
  openai: CANVAS_AGENT_PROVIDER_PRESETS.openai.baseURL,
} as const
const BASE_PLATFORM_PROVIDER_IDS = ['deepseek', 'openlux', 'kuaizi', 'huimengi', 'ailink', 'topenrouter'] as const
const PLATFORM_PROVIDER_IDS = [...BASE_PLATFORM_PROVIDER_IDS, 'kimi', 'openai'] as const
const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  deepseek: 'DeepSeek 官方',
  openlux: 'OpenLux API',
  kuaizi: 'Kuaizi API',
  huimengi: '绘梦工坊 API',
  ailink: 'AILink API',
  topenrouter: 'TopenRouter API',
  kimi: CANVAS_AGENT_PROVIDER_PRESETS.kimi.name,
  openai: CANVAS_AGENT_PROVIDER_PRESETS.openai.name,
}

type JsonRecord = Record<string, unknown>

export interface PlatformServiceProvider extends Omit<ServiceConfigProvider, 'apiKey'> {
  hasApiKey: boolean
}

export interface PlatformStorageConfig {
  type: 'tos'
  endpoint: string
  publicEndpoint: string
  region: string
  bucket: string
  forcePathStyle: boolean
  hasAccessKey: boolean
  hasSecretKey: boolean
}

export interface PlatformServiceConfigResponse {
  sourceFile: string
  updatedAt: string | null
  providers: PlatformServiceProvider[]
  models: ServiceConfigModel[]
  defaultModels: ServiceConfigDefaultModels
  businessModels: Array<{
    key: NoriBusinessModelKey
    name: string
    customerName: string
    description: string
    type: 'llm' | 'image' | 'video' | 'audio'
    tier: NoriModelTier
  }>
  modelRouting: Record<NoriBusinessModelKey | typeof CANVAS_AGENT_SELECTION_KEY, string>
  modelEnabled: Record<string, boolean>
  internalModelViewUserIds: string[]
  customerVisibleModels: Record<string, boolean>
  customerModelOverrides: Record<string, Record<string, boolean>>
  customerModelRoutingOverrides: Record<string, Record<string, string>>
  agentModels: Record<string, CanvasAgentModelSettings>
  canvasAgentModelCatalog: CanvasAgentModelCatalog
  storage: PlatformStorageConfig
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isUsableServiceSecret(value: unknown): boolean {
  const normalized = string(value)
  if (!normalized || !/^[\x20-\x7E]+$/.test(normalized)) return false
  return !/^(?:your[-_ ]|placeholder$|replace[-_ ]?me$)/i.test(normalized)
}

function requiredString(value: unknown, field: string, max = 255): string {
  const normalized = string(value)
  if (!normalized || normalized.length > max) throw new Error(`SERVICE_CONFIG_INVALID: ${field}`)
  return normalized
}

function optionalUrl(value: unknown, field: string): string | undefined {
  const normalized = string(value)
  if (!normalized) return undefined
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`SERVICE_CONFIG_INVALID: ${field} must be a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SERVICE_CONFIG_INVALID: ${field} must use http or https`)
  }
  return normalized.replace(/\/+$/, '')
}

function cloneConfig(config: ServiceConfig): ServiceConfig {
  return JSON.parse(JSON.stringify(config)) as ServiceConfig
}

function resolveWritablePath(): string {
  const existing = resolveServiceConfigPath()
  if (existing) return existing
  const configured = string(process.env.NORI_SERVICE_CONFIG)
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured || 'config/services.json')
}

export function isUsableKuaiziKzep(value: unknown): boolean {
  const normalized = string(value)
  return normalized.length > 0 && normalized.length <= 191 && /^kzep_[A-Za-z0-9_-]+$/.test(normalized)
}

export function environmentKuaiziIntlKzep(): string {
  const value = string(process.env.KUAIZI_SEEDANCE_25_INTL_KZEP)
  return isUsableKuaiziKzep(value) ? value : ''
}

export function environmentProviderKey(providerId: string): string {
  const providerKey = getRawProviderKey(providerId).toLowerCase()
  if (providerKey === 'deepseek') return string(process.env.DEEPSEEK_API_KEY)
  if (providerKey === 'openlux') return string(process.env.OPENLUX_API_KEY)
  if (providerKey === 'kuaizi') return string(process.env.KUAIZI_API_KEY)
  if (providerKey === 'huimengi') return string(process.env.HUIMENGI_API_KEY)
  if (providerKey === 'ailink') return string(process.env.AILINK_API_KEY)
  if (providerKey === 'topenrouter') return string(process.env.TOPENROUTER_API_KEY)
  if (providerKey === 'kimi' || providerKey === 'openai') {
    return string(process.env[CANVAS_AGENT_PROVIDER_PRESETS[providerKey].envKey])
  }
  return ''
}

export function fixedPlatformModels(): ServiceConfigModel[] {
  return [
    { modelId: 'deepseek-chat', name: 'DeepSeek Chat', type: 'llm', provider: 'deepseek', modelKey: 'deepseek::deepseek-chat', llmProtocol: 'chat-completions' },
    { modelId: 'deepseek-reasoner', name: 'DeepSeek Reasoner', type: 'llm', provider: 'deepseek', modelKey: 'deepseek::deepseek-reasoner', llmProtocol: 'chat-completions' },
    // Only models with a verified pricing entry are selectable. Registered
    // models without a deterministic price stay visible in the discovery
    // catalog but cannot be routed to a paying workflow.
    ...listOpenLuxSelectableModels().map((model): ServiceConfigModel => ({
      modelId: model.modelId,
      name: model.name,
      type: model.modality,
      provider: 'openlux',
      modelKey: `openlux::${model.modelId}`,
    })),
    // Images now run on OpenLux only; Kuaizi keeps video and speech.
    ...listKuaiziCatalogModels()
      .filter((model) => model.modality !== 'llm' && model.modality !== 'image')
      .map((model): ServiceConfigModel => ({
        modelId: model.modelId,
        name: model.name,
        type: model.modality,
        provider: 'kuaizi',
        modelKey: `kuaizi::${model.modelId}`,
      })),
    ...listHuimengiCatalogModels().map((model): ServiceConfigModel => ({
      modelId: model.modelId,
      name: model.name,
      type: model.modality,
      provider: 'huimengi',
      modelKey: `huimengi::${model.modelId}`,
    })),
    ...listAilinkSelectableModels().map((model): ServiceConfigModel => ({
      modelId: model.modelId,
      name: model.name,
      type: 'video',
      provider: 'ailink',
      modelKey: `ailink::${model.modelId}`,
    })),
    ...listTopenrouterSelectableModels().map((model): ServiceConfigModel => ({
      modelId: model.modelId,
      name: model.name,
      type: 'video',
      provider: 'topenrouter',
      modelKey: `topenrouter::${model.modelId}`,
    })),
  ]
}

// 视频模型由管理员逐个开关；未保存过开关时，沿用当前路由指向的模型保持开启。
function materializeModelEnabled(
  models: ServiceConfigModel[],
  stored: Record<string, boolean> | undefined,
  routing: Record<string, string>,
): Record<string, boolean> {
  const routed = new Set(listNoriBusinessModels('video').map((model) => string(routing[model.key])).filter(Boolean))
  return Object.fromEntries(models.filter((model) => model.type === 'video').map((model) => {
    const key = composeModelKey(model.provider, model.modelId)
    return [key, stored && Object.hasOwn(stored, key) ? stored[key] === true : routed.has(key)]
  }))
}

function normalizeInternalModelViewUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(
    raw
      .map((item) => string(item))
      .filter((item) => item.length > 0 && item.length <= 191),
  )).slice(0, 100)
}

function materializeCustomerVisibleModels(
  stored: Record<string, boolean> | undefined,
  routing: Record<string, string>,
  modelEnabled: Record<string, boolean>,
  providers: ServiceConfigProvider[],
): Record<string, boolean> {
  const kuaiziKzep = providers.find((provider) => provider.id === 'kuaizi')?.seedance25IntlKzep
  return Object.fromEntries(listNoriBusinessModels().map((business) => {
    if (stored && Object.hasOwn(stored, business.key)) {
      return [business.key, stored[business.key] === true]
    }
    const target = string(routing[business.key])
    if (!target) return [business.key, false]
    if (business.type === 'video') {
      if (target === KUAIZI_SEEDANCE_25_INTL_MODEL_KEY && !isUsableKuaiziKzep(kuaiziKzep)) {
        return [business.key, false]
      }
      return [business.key, modelEnabled[target] === true]
    }
    return [business.key, true]
  }))
}

function normalizeCustomerModelOverrides(raw: unknown): Record<string, Record<string, boolean>> {
  if (!isRecord(raw)) return {}
  const validBusinessKeys = new Set<string>(listNoriBusinessModels().map((model) => model.key))
  const output: Record<string, Record<string, boolean>> = {}
  for (const [rawUserId, rawMap] of Object.entries(raw).slice(0, 500)) {
    const userId = string(rawUserId)
    if (!userId || userId.length > 191 || !isRecord(rawMap)) continue
    const inner: Record<string, boolean> = {}
    for (const [modelKey, flag] of Object.entries(rawMap)) {
      if (!validBusinessKeys.has(modelKey) || typeof flag !== 'boolean') continue
      inner[modelKey] = flag
    }
    if (Object.keys(inner).length > 0) output[userId] = inner
  }
  return output
}

function normalizeCustomerModelRoutingOverrides(
  raw: unknown,
  models: ServiceConfigModel[],
): Record<string, Record<string, string>> {
  if (!isRecord(raw)) return {}
  const businessByKey = new Map<string, ReturnType<typeof listNoriBusinessModels>[number]>(
    listNoriBusinessModels().map((model) => [model.key, model]),
  )
  const modelByKey = new Map(models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const output: Record<string, Record<string, string>> = {}
  for (const [rawUserId, rawMap] of Object.entries(raw).slice(0, 500)) {
    const userId = string(rawUserId)
    if (!userId || userId.length > 191 || !isRecord(rawMap)) continue
    const inner: Record<string, string> = {}
    for (const [modelKey, rawTarget] of Object.entries(rawMap)) {
      const business = businessByKey.get(modelKey)
      const target = string(rawTarget)
      if (!business || !target) continue
      const runtimeModel = modelByKey.get(target)
      if (!runtimeModel || runtimeModel.type !== business.type) continue
      inner[modelKey] = target
    }
    if (Object.keys(inner).length > 0) output[userId] = inner
  }
  return output
}

export function isPlatformVideoModelEnabled(modelKey: string): boolean {
  const enabled = materializeEnvironmentConfig(readServiceConfig()).llm?.modelEnabled
  return enabled?.[modelKey] === true
}

export function isPlatformVideoModel(modelKey: string): boolean {
  return fixedPlatformModels().some((model) => model.type === 'video' && composeModelKey(model.provider, model.modelId) === modelKey)
}

function materializeEnvironmentConfig(raw: ServiceConfig): ServiceConfig {
  const config = cloneConfig(raw)
  const currentProviders = new Map((config.llm?.providers || []).map((provider) => [provider.id, provider]))
  config.llm ||= {}
  config.llm.providers = PLATFORM_PROVIDER_IDS.map((id) => {
    const current = currentProviders.get(id)
    return {
      id,
      name: PROVIDER_NAMES[id],
      baseUrl: PROVIDER_BASE_URLS[id],
      ...(current?.assetGroupId && id === 'kuaizi' ? { assetGroupId: current.assetGroupId } : {}),
      ...(id === 'kuaizi' && (string(current?.seedance25IntlKzep) || environmentKuaiziIntlKzep()) ? { seedance25IntlKzep: string(current?.seedance25IntlKzep) || environmentKuaiziIntlKzep() } : {}),
      apiKey: [current?.apiKey, environmentProviderKey(id)].map(string).find(isUsableServiceSecret) || '',
    }
  })
  config.llm.models = fixedPlatformModels()
  const modelByKey = new Map(config.llm.models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const canvasAgentDefault = string(config.llm.modelRouting?.[CANVAS_AGENT_SELECTION_KEY])
  config.llm.modelRouting = Object.fromEntries(listNoriBusinessModels().map((businessModel) => {
    const currentRouting = config.llm!.modelRouting || {}
    const hasConfigured = Object.hasOwn(currentRouting, businessModel.key)
    const configured = hasConfigured ? string(currentRouting[businessModel.key]) : ''
    // An explicit empty route is an administrator decision to disable this
    // capability. Never replace it with the suggested route.
    if (hasConfigured && !configured) return [businessModel.key, '']
    const suggested = string(businessModel.suggestedRoute)
    const routed = Boolean(suggested)
      && modelByKey.get(configured)?.type === businessModel.type
    return [businessModel.key, routed ? configured : suggested]
  }))
  config.llm.modelRouting[CANVAS_AGENT_SELECTION_KEY] = canvasAgentDefault
  config.llm.modelEnabled = materializeModelEnabled(config.llm.models, config.llm.modelEnabled, config.llm.modelRouting)
  config.llm.internalModelViewUserIds = normalizeInternalModelViewUserIds(config.llm.internalModelViewUserIds)
  config.llm.customerVisibleModels = materializeCustomerVisibleModels(
    config.llm.customerVisibleModels,
    config.llm.modelRouting,
    config.llm.modelEnabled,
    config.llm.providers,
  )
  config.llm.customerModelOverrides = normalizeCustomerModelOverrides(config.llm.customerModelOverrides)
  config.llm.customerModelRoutingOverrides = normalizeCustomerModelRoutingOverrides(config.llm.customerModelRoutingOverrides, config.llm.models)
  const defaultModels = { ...(config.llm.defaultModels || {}) }
  for (const [field, expectedType] of Object.entries(DEFAULT_MODEL_TYPES) as Array<[keyof ServiceConfigDefaultModels, UnifiedModelType]>) {
    const current = parseModelKeyStrict(defaultModels[field])
    if (current && modelByKey.has(current.modelKey) && config.llm.models.some((model) => composeModelKey(model.provider, model.modelId) === current.modelKey && model.type === expectedType)) continue
    delete defaultModels[field]
  }
  config.llm.defaultModels = defaultModels
  return config
}

export function readMaterializedPlatformServiceConfig(): ServiceConfig {
  return materializeEnvironmentConfig(readServiceConfig())
}

function normalizeProvider(raw: unknown, index: number, currentById: Map<string, ServiceConfigProvider>): ServiceConfigProvider {
  if (!isRecord(raw)) throw new Error(`SERVICE_CONFIG_INVALID: providers[${index}]`)
  const id = requiredString(raw.id, `providers[${index}].id`, 128).toLowerCase()
  if (!PLATFORM_PROVIDER_IDS.includes(id as typeof PLATFORM_PROVIDER_IDS[number])) {
    throw new Error(`SERVICE_CONFIG_INVALID: unsupported provider ${id}`)
  }
  const existing = currentById.get(id)
  const apiKey = [raw.apiKey, existing?.apiKey, environmentProviderKey(id)].map(string).find(isUsableServiceSecret) || ''
  const suppliedBaseUrl = optionalUrl(raw.baseUrl, `providers[${index}].baseUrl`)
  const baseUrl = PROVIDER_BASE_URLS[id as keyof typeof PROVIDER_BASE_URLS]
  if (suppliedBaseUrl && suppliedBaseUrl !== baseUrl) throw new Error(`SERVICE_CONFIG_INVALID: ${id} must use the official base URL`)
  const assetGroupId = string(raw.assetGroupId) || string(existing?.assetGroupId)
  if (assetGroupId.length > 191) throw new Error(`SERVICE_CONFIG_INVALID: providers[${index}].assetGroupId`)
  const seedance25IntlKzep = id === 'kuaizi'
    ? (Object.hasOwn(raw, 'seedance25IntlKzep') ? string(raw.seedance25IntlKzep) : string(existing?.seedance25IntlKzep))
    : ''
  if (seedance25IntlKzep && !isUsableKuaiziKzep(seedance25IntlKzep)) {
    throw new Error(`SERVICE_CONFIG_INVALID: providers[${index}].seedance25IntlKzep 格式无效（需以 kzep_ 开头）`)
  }
  return {
    id,
    name: PROVIDER_NAMES[id],
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(id === 'kuaizi' && assetGroupId ? { assetGroupId } : {}),
    ...(id === 'kuaizi' && seedance25IntlKzep ? { seedance25IntlKzep } : {}),
  }
}







function normalizeStorage(raw: unknown, current: ServiceConfig): NonNullable<ServiceConfig['storage']> {
  if (!isRecord(raw)) throw new Error('SERVICE_CONFIG_INVALID: storage')
  const currentTos = current.storage?.tos
  const endpoint = optionalUrl(raw.endpoint, 'storage.endpoint')
    || string(currentTos?.endpoint)
    || 'https://tos-cn-beijing.volces.com'
  const publicEndpoint = optionalUrl(raw.publicEndpoint, 'storage.publicEndpoint')
    || string(currentTos?.publicEndpoint)
    || endpoint
  const accessKey = [raw.accessKey, currentTos?.accessKey, process.env.TOS_ACCESS_KEY]
    .map(string)
    .find(isUsableServiceSecret) || ''
  const secretKey = [raw.secretKey, currentTos?.secretKey, process.env.TOS_SECRET_KEY]
    .map(string)
    .find(isUsableServiceSecret) || ''
  if (!accessKey || !secretKey) throw new Error('SERVICE_CONFIG_INVALID: TOS credentials are required')
  return {
    type: 'tos',
    tos: {
      endpoint,
      publicEndpoint,
      region: requiredString(raw.region || currentTos?.region || 'cn-beijing', 'storage.region', 64),
      bucket: requiredString(raw.bucket || currentTos?.bucket, 'storage.bucket', 128),
      accessKey,
      secretKey,
      forcePathStyle: raw.forcePathStyle === true,
    },
  }
}




function normalizeRoutingInput(
  input: unknown,
  current: Record<string, string>,
  models: ServiceConfigModel[],
): Record<string, string> {
  const next = { ...current }
  if (isRecord(input)) {
    const modelByKey = new Map(models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
    for (const model of listNoriBusinessModels()) {
      if (!Object.hasOwn(input, model.key)) continue
      const value = string(input[model.key])
      if (!value) {
        // Persist the explicit disable instead of deleting the key, otherwise a
        // missing route would be treated as "unconfigured" and resurrect the
        // suggested route on the next read.
        next[model.key] = ''
        continue
      }
      if (string(model.suggestedRoute) && modelByKey.get(value)?.type === model.type) {
        next[model.key] = value
        continue
      }
      if (string(model.suggestedRoute)) next[model.key] = model.suggestedRoute
      else delete next[model.key]
    }
  }
  return next
}

function normalizeAgentModels(raw: unknown): Record<string, CanvasAgentModelSettings> {
  if (!isRecord(raw)) throw new Error('SERVICE_CONFIG_INVALID: 喵导模型设置格式无效')
  const known = new Set(CANVAS_AGENT_MODEL_CANDIDATES.map((model) => `${model.providerId}::${model.modelId}`))
  return Object.fromEntries(Object.entries(raw).map(([key, flags]) => {
    if (!known.has(key) || !isRecord(flags) || Object.entries(flags).some(([flag, value]) =>
      !['canvasAgent', 'supportsTemperature'].includes(flag) || typeof value !== 'boolean'
    )) throw new Error('SERVICE_CONFIG_INVALID: 喵导模型设置包含未登记模型或非法能力')
    return [key, {
      canvasAgent: flags.canvasAgent === true,
      supportsTemperature: flags.supportsTemperature === true,
    }]
  }))
}

export async function savePlatformServiceConfig(input: unknown): Promise<PlatformServiceConfigResponse> {
  if (!isRecord(input)) throw new Error('SERVICE_CONFIG_INVALID: payload')
  const current = readMaterializedPlatformServiceConfig()
  const rawProviders = (Array.isArray(input.providers) ? input.providers : [])
    .filter((provider) => !(isRecord(provider) && string(provider.id).toLowerCase() === 'tgg'))
  for (const provider of rawProviders) {
    const id = isRecord(provider) ? string(provider.id).toLowerCase() : ''
    if (id && !PLATFORM_PROVIDER_IDS.includes(id as typeof PLATFORM_PROVIDER_IDS[number])) {
      throw new Error(`SERVICE_CONFIG_INVALID: unsupported provider ${id}`)
    }
  }
  const currentById = new Map((current.llm?.providers || []).map((provider) => [provider.id.toLowerCase(), provider]))
  const providers = rawProviders.map((provider, index) => normalizeProvider(provider, index, currentById))
  const providerIds = new Set(providers.map((provider) => provider.id))
  if (
    providerIds.size !== providers.length
    || !BASE_PLATFORM_PROVIDER_IDS.every((providerId) => providerIds.has(providerId))
  ) {
    throw new Error('SERVICE_CONFIG_INVALID: providers must include DeepSeek, OpenLux, Kuaizi, HuiMeng, AILink and TopenRouter exactly once')
  }
  // Older config clients can continue saving the original five providers.
  for (const provider of ['kimi', 'openai'] as const) {
    if (!providerIds.has(provider)) providers.push(normalizeProvider({ id: provider }, providers.length, currentById))
  }

  const models = fixedPlatformModels()
  const modelRouting = normalizeRoutingInput(input.modelRouting, current.llm?.modelRouting || {}, models)
  const routing = isRecord(input.modelRouting) ? input.modelRouting : {}
  const hasAgentDefault = Object.hasOwn(routing, CANVAS_AGENT_SELECTION_KEY)
  if (hasAgentDefault) {
    if (typeof routing[CANVAS_AGENT_SELECTION_KEY] !== 'string') throw new Error('SERVICE_CONFIG_INVALID: 喵导默认模型格式无效')
    modelRouting[CANVAS_AGENT_SELECTION_KEY] = string(routing[CANVAS_AGENT_SELECTION_KEY])
  }
  const modelEnabled = { ...(current.llm?.modelEnabled || {}) }
  if (input.modelEnabled !== undefined) {
    if (!isRecord(input.modelEnabled)) throw new Error('SERVICE_CONFIG_INVALID: modelEnabled')
    const videoKeys = new Set(models.filter((model) => model.type === 'video').map((model) => composeModelKey(model.provider, model.modelId)))
    for (const [key, value] of Object.entries(input.modelEnabled)) {
      if (!videoKeys.has(key) || typeof value !== 'boolean') throw new Error(`SERVICE_CONFIG_INVALID: modelEnabled.${key}`)
      const targetProvider = providers.find((provider) => provider.id === getRawProviderKey(key).toLowerCase())
      if (value && !isUsableServiceSecret(targetProvider?.apiKey)) {
        throw new Error(`SERVICE_CONFIG_INVALID: ${PROVIDER_NAMES[getRawProviderKey(key).toLowerCase()] || key} 尚未配置 API Key，不能开启其模型`)
      }
      if (value && key === KUAIZI_SEEDANCE_25_INTL_MODEL_KEY && !isUsableKuaiziKzep(targetProvider?.seedance25IntlKzep || environmentKuaiziIntlKzep())) {
        throw new Error('SERVICE_CONFIG_INVALID: Kuaizi 尚未配置 Seedance 2.5 国际版 EP (kzep)，不能开启该模型')
      }
      modelEnabled[key] = value
    }
  }
  const validBusinessKeys = new Set<string>(listNoriBusinessModels().map((model) => model.key))
  let internalModelViewUserIds = current.llm?.internalModelViewUserIds || []
  if (input.internalModelViewUserIds !== undefined) {
    if (!Array.isArray(input.internalModelViewUserIds)) {
      throw new Error('SERVICE_CONFIG_INVALID: internalModelViewUserIds 必须是数组')
    }
    const normalizedIds: string[] = []
    for (const item of input.internalModelViewUserIds) {
      if (typeof item !== 'string' || !item.trim() || item.trim().length > 191) {
        throw new Error('SERVICE_CONFIG_INVALID: internalModelViewUserIds 包含无效账号 ID')
      }
      if (!normalizedIds.includes(item.trim())) normalizedIds.push(item.trim())
    }
    if (normalizedIds.length > 100) {
      throw new Error('SERVICE_CONFIG_INVALID: internalModelViewUserIds 最多支持 100 个账号')
    }
    internalModelViewUserIds = normalizedIds
  }
  const customerVisibleModels = { ...(current.llm?.customerVisibleModels || {}) }
  if (input.customerVisibleModels !== undefined) {
    if (!isRecord(input.customerVisibleModels)) {
      throw new Error('SERVICE_CONFIG_INVALID: customerVisibleModels')
    }
    for (const [key, value] of Object.entries(input.customerVisibleModels)) {
      if (!validBusinessKeys.has(key) || typeof value !== 'boolean') {
        throw new Error(`SERVICE_CONFIG_INVALID: customerVisibleModels.${key}`)
      }
      customerVisibleModels[key] = value
    }
  }
  let customerModelOverrides = current.llm?.customerModelOverrides || {}
  if (input.customerModelOverrides !== undefined) {
    if (!isRecord(input.customerModelOverrides)) {
      throw new Error('SERVICE_CONFIG_INVALID: customerModelOverrides')
    }
    const nextOverrides: Record<string, Record<string, boolean>> = {}
    const entries = Object.entries(input.customerModelOverrides)
    if (entries.length > 500) {
      throw new Error('SERVICE_CONFIG_INVALID: customerModelOverrides 最多支持 500 个客户配置')
    }
    for (const [rawUserId, rawMap] of entries) {
      const userId = string(rawUserId)
      if (!userId || userId.length > 191 || !isRecord(rawMap)) {
        throw new Error(`SERVICE_CONFIG_INVALID: customerModelOverrides.${rawUserId}`)
      }
      const inner: Record<string, boolean> = {}
      for (const [modelKey, flag] of Object.entries(rawMap)) {
        if (!validBusinessKeys.has(modelKey) || typeof flag !== 'boolean') {
          throw new Error(`SERVICE_CONFIG_INVALID: customerModelOverrides.${userId}.${modelKey}`)
        }
        inner[modelKey] = flag
      }
      if (Object.keys(inner).length > 0) nextOverrides[userId] = inner
    }
    customerModelOverrides = nextOverrides
  }
  let customerModelRoutingOverrides = current.llm?.customerModelRoutingOverrides || {}
  if (input.customerModelRoutingOverrides !== undefined) {
    if (!isRecord(input.customerModelRoutingOverrides)) {
      throw new Error('SERVICE_CONFIG_INVALID: customerModelRoutingOverrides')
    }
    const businessByKey = new Map<string, ReturnType<typeof listNoriBusinessModels>[number]>(
      listNoriBusinessModels().map((model) => [model.key, model]),
    )
    const modelByKey = new Map(models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
    const nextRoutingOverrides: Record<string, Record<string, string>> = {}
    const entries = Object.entries(input.customerModelRoutingOverrides)
    if (entries.length > 500) {
      throw new Error('SERVICE_CONFIG_INVALID: customerModelRoutingOverrides 最多支持 500 个客户配置')
    }
    for (const [rawUserId, rawMap] of entries) {
      const userId = string(rawUserId)
      if (!userId || userId.length > 191 || !isRecord(rawMap)) {
        throw new Error(`SERVICE_CONFIG_INVALID: customerModelRoutingOverrides.${rawUserId}`)
      }
      const inner: Record<string, string> = {}
      for (const [modelKey, rawTarget] of Object.entries(rawMap)) {
        const business = businessByKey.get(modelKey)
        if (!business || typeof rawTarget !== 'string') {
          throw new Error(`SERVICE_CONFIG_INVALID: customerModelRoutingOverrides.${userId}.${modelKey}`)
        }
        const target = string(rawTarget)
        if (!target) continue
        const runtimeModel = modelByKey.get(target)
        if (!runtimeModel || runtimeModel.type !== business.type) {
          throw new Error(`SERVICE_CONFIG_INVALID: customerModelRoutingOverrides.${userId}.${modelKey} 必须指向同类型的已登记模型`)
        }
        inner[modelKey] = target
      }
      if (Object.keys(inner).length > 0) nextRoutingOverrides[userId] = inner
    }
    customerModelRoutingOverrides = nextRoutingOverrides
  }
  const agentModels = input.agentModels === undefined ? current.llm?.agentModels ?? {} : normalizeAgentModels(input.agentModels)

  const next: ServiceConfig = {
    storage: normalizeStorage(input.storage, current),
    llm: {
      providers,
      models,
      defaultModels: isRecord(input.defaultModels) ? input.defaultModels : current.llm?.defaultModels || {},
      modelRouting,
      modelEnabled,
      internalModelViewUserIds,
      customerVisibleModels,
      customerModelOverrides,
      customerModelRoutingOverrides,
      agentModels,
    },
  }
  if (input.agentModels !== undefined || hasAgentDefault) {
    const catalog = getCanvasAgentModelCatalog(next)
    if (Object.entries(agentModels).some(([key, flags]) =>
      flags.canvasAgent === true && !catalog.models.some((entry) => entry.modelKey === key && entry.enabled)
    )) throw new Error('SERVICE_CONFIG_INVALID: 喵导只能开放已配置密钥和价格且通过工具流验证的模型')
    const anyEnabled = catalog.models.some((entry) => entry.enabled)
    if ((anyEnabled || modelRouting[CANVAS_AGENT_SELECTION_KEY]) && !catalog.defaultModelKey) {
      throw new Error('SERVICE_CONFIG_INVALID: 喵导默认模型必须在已开放列表中')
    }
  }

  await writeServiceConfigFile(next)
  return getPlatformServiceConfigResponse()
}

async function writeServiceConfigFile(next: ServiceConfig): Promise<void> {
  const targetPath = resolveWritablePath()
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await fsp.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fsp.rename(temporaryPath, targetPath)
  await fsp.chmod(targetPath, 0o600)
  resetServiceConfigCache()
  resetStorageProvider()
}

export function getPlatformServiceConfigResponse(): PlatformServiceConfigResponse {
  // Direct call instead of readMaterializedPlatformServiceConfig() to avoid
  // a webpack scope-hoisting bug that turns the intermediate export into a
  // factory returning the inner function instead of invoking it.
  const config = materializeEnvironmentConfig(readServiceConfig())
  const targetPath = resolveWritablePath()
  let updatedAt: string | null = null
  try {
    updatedAt = fs.statSync(targetPath).mtime.toISOString()
  } catch {
    updatedAt = null
  }
  const tos = config.storage?.tos || {}
  const providers = config.llm?.providers || []
  const models = config.llm?.models || []
  const modelByKey = new Map(models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const canvasAgentModelCatalog = getCanvasAgentModelCatalog(config)
  const modelRouting = Object.fromEntries(listNoriBusinessModels().map((businessModel) => {
    const targetKey = string(config.llm?.modelRouting?.[businessModel.key])
    const targetModel = modelByKey.get(targetKey)
    return [businessModel.key, targetModel?.type === businessModel.type ? targetKey : '']
  })) as Record<NoriBusinessModelKey, string>
  return {
    sourceFile: path.basename(targetPath),
    updatedAt,
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      ...(provider.assetGroupId ? { assetGroupId: provider.assetGroupId } : {}),
      ...(provider.seedance25IntlKzep ? { seedance25IntlKzep: provider.seedance25IntlKzep } : {}),
      hasApiKey: isUsableServiceSecret(provider.apiKey) || isUsableServiceSecret(environmentProviderKey(provider.id)),
    })),
    models,
    defaultModels: config.llm?.defaultModels || {},
    businessModels: listNoriBusinessModels().map((model) => ({
      key: model.key,
      name: model.name,
      customerName: model.customerName,
      description: model.description,
      type: model.type,
      tier: model.tier,
    })),
    modelRouting: { ...modelRouting, [CANVAS_AGENT_SELECTION_KEY]: canvasAgentModelCatalog.defaultModelKey ?? '' },
    modelEnabled: config.llm?.modelEnabled || {},
    internalModelViewUserIds: config.llm?.internalModelViewUserIds || [],
    customerVisibleModels: config.llm?.customerVisibleModels || {},
    customerModelOverrides: config.llm?.customerModelOverrides || {},
    customerModelRoutingOverrides: config.llm?.customerModelRoutingOverrides || {},
    agentModels: config.llm?.agentModels || {},
    canvasAgentModelCatalog,
    storage: {
      type: 'tos',
      endpoint: string(tos.endpoint),
      publicEndpoint: string(tos.publicEndpoint) || string(tos.endpoint),
      region: string(tos.region),
      bucket: string(tos.bucket),
      forcePathStyle: tos.forcePathStyle === true,
      hasAccessKey: isUsableServiceSecret(tos.accessKey) || isUsableServiceSecret(process.env.TOS_ACCESS_KEY),
      hasSecretKey: isUsableServiceSecret(tos.secretKey) || isUsableServiceSecret(process.env.TOS_SECRET_KEY),
    },

  }
}
