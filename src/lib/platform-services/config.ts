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
import { getRawProviderKey, isSupportedModelProvider } from '@/lib/model-provider-contract'
import { listKuaiziCatalogModels } from '@/lib/providers/kuaizi/catalog'
import {
  findNoriBusinessModel,
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
  kuaizi: 'https://aiopenapi.kuaizi.cn',
} as const

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
    description: string
    type: 'llm' | 'image' | 'video' | 'audio'
    tier: NoriModelTier
  }>
  modelRouting: Record<NoriBusinessModelKey, string>
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

function environmentProviderKey(providerId: string): string {
  const providerKey = getRawProviderKey(providerId).toLowerCase()
  if (providerKey === 'deepseek') return string(process.env.DEEPSEEK_API_KEY)
  if (providerKey === 'kuaizi') return string(process.env.KUAIZI_API_KEY)
  return ''
}

export function fixedPlatformModels(): ServiceConfigModel[] {
  return [
    { modelId: 'deepseek-chat', name: 'DeepSeek Chat', type: 'llm', provider: 'deepseek', modelKey: 'deepseek::deepseek-chat', llmProtocol: 'chat-completions' },
    { modelId: 'deepseek-reasoner', name: 'DeepSeek Reasoner', type: 'llm', provider: 'deepseek', modelKey: 'deepseek::deepseek-reasoner', llmProtocol: 'chat-completions' },
    ...listKuaiziCatalogModels().filter((model) => model.modality !== 'llm').map((model): ServiceConfigModel => ({
      modelId: model.modelId,
      name: model.name,
      type: model.modality,
      provider: 'kuaizi',
      modelKey: `kuaizi::${model.modelId}`,
    })),
  ]
}

function materializeEnvironmentConfig(raw: ServiceConfig): ServiceConfig {
  const config = cloneConfig(raw)
  const currentProviders = new Map((config.llm?.providers || []).map((provider) => [provider.id, provider]))
  config.llm ||= {}
  config.llm.providers = ['deepseek', 'kuaizi'].map((id) => {
    const current = currentProviders.get(id)
    return {
      id,
      name: id === 'deepseek' ? 'DeepSeek 官方' : 'Kuaizi API',
      baseUrl: PROVIDER_BASE_URLS[id as keyof typeof PROVIDER_BASE_URLS],
      ...(current?.assetGroupId && id === 'kuaizi' ? { assetGroupId: current.assetGroupId } : {}),
      apiKey: [current?.apiKey, environmentProviderKey(id)].map(string).find(isUsableServiceSecret) || '',
    }
  })
  config.llm.models = fixedPlatformModels()
  const modelByKey = new Map(config.llm.models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  config.llm.modelRouting = Object.fromEntries(listNoriBusinessModels().map((businessModel) => {
    const currentRouting = config.llm!.modelRouting || {}
    const hasConfigured = Object.hasOwn(currentRouting, businessModel.key)
    const configured = hasConfigured ? string(currentRouting[businessModel.key]) : ''
    const suggested = string(businessModel.suggestedRoute)
    // An explicit empty route is an administrator decision to disable this
    // capability. Never replace it with the suggested route.
    if (hasConfigured && !configured) return [businessModel.key, '']
    const candidate = configured || suggested
    const routed = Boolean(suggested) && modelByKey.get(candidate)?.type === businessModel.type
    return [businessModel.key, routed ? candidate : suggested]
  }))
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
  if (!['deepseek', 'kuaizi'].includes(id) || !isSupportedModelProvider(id)) {
    throw new Error(`SERVICE_CONFIG_INVALID: unsupported provider ${id}`)
  }
  const existing = currentById.get(id)
  const apiKey = [raw.apiKey, existing?.apiKey, environmentProviderKey(id)].map(string).find(isUsableServiceSecret) || ''
  const suppliedBaseUrl = optionalUrl(raw.baseUrl, `providers[${index}].baseUrl`)
  const baseUrl = PROVIDER_BASE_URLS[id as keyof typeof PROVIDER_BASE_URLS]
  if (suppliedBaseUrl && suppliedBaseUrl !== baseUrl) throw new Error(`SERVICE_CONFIG_INVALID: ${id} must use the official base URL`)
  const assetGroupId = string(raw.assetGroupId) || string(existing?.assetGroupId)
  if (assetGroupId.length > 191) throw new Error(`SERVICE_CONFIG_INVALID: providers[${index}].assetGroupId`)
  return {
    id,
    name: id === 'deepseek' ? 'DeepSeek 官方' : 'Kuaizi API',
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(id === 'kuaizi' && assetGroupId ? { assetGroupId } : {}),
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
  if (!isRecord(input)) return current
  const next = { ...current }
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
  return next
}

export async function savePlatformServiceConfig(input: unknown): Promise<PlatformServiceConfigResponse> {
  if (!isRecord(input)) throw new Error('SERVICE_CONFIG_INVALID: payload')
  const current = readMaterializedPlatformServiceConfig()
  const rawProviders = Array.isArray(input.providers) ? input.providers : []
  if (rawProviders.length !== 2) {
    throw new Error('SERVICE_CONFIG_INVALID: providers')
  }
  const currentById = new Map((current.llm?.providers || []).map((provider) => [provider.id.toLowerCase(), provider]))
  const providers = rawProviders.map((provider, index) => normalizeProvider(provider, index, currentById))
  const providerIds = new Set(providers.map((provider) => provider.id))
  if (providerIds.size !== providers.length || !providerIds.has('deepseek') || !providerIds.has('kuaizi')) throw new Error('SERVICE_CONFIG_INVALID: both DeepSeek and Kuaizi are required')

  const models = fixedPlatformModels()

  const next: ServiceConfig = {
    storage: normalizeStorage(input.storage, current),
    llm: {
      providers,
      models,
      defaultModels: isRecord(input.defaultModels) ? input.defaultModels : current.llm?.defaultModels || {},
      modelRouting: normalizeRoutingInput(input.modelRouting, current.llm?.modelRouting || {}, models),
    },
  }

  const targetPath = resolveWritablePath()
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await fsp.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fsp.rename(temporaryPath, targetPath)
  await fsp.chmod(targetPath, 0o600)
  resetServiceConfigCache()
  resetStorageProvider()
  return getPlatformServiceConfigResponse()
}

export function getPlatformServiceConfigResponse(): PlatformServiceConfigResponse {
  const config = readMaterializedPlatformServiceConfig()
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
      hasApiKey: isUsableServiceSecret(provider.apiKey) || isUsableServiceSecret(environmentProviderKey(provider.id)),
    })),
    models,
    defaultModels: config.llm?.defaultModels || {},
    businessModels: listNoriBusinessModels().map((model) => ({
      key: model.key,
      name: model.name,
      description: model.description,
      type: model.type,
      tier: model.tier,
    })),
    modelRouting,
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
