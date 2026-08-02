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
import {
  findNoriBusinessModel,
  getNoriModelRouting,
  listNoriBusinessModels,
  type NoriBusinessModelKey,
  type NoriModelTier,
} from '@/lib/nori-model-catalog'

const MODEL_TYPES = new Set<UnifiedModelType>(['llm', 'image', 'video', 'audio', 'lipsync'])
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
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,127}$/
const MAX_PROVIDERS = 50
const MAX_MODELS = 300

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
  videoRepaint: {
    providerId: string
    understandingModel: string
    adaptationModel: string
    fps: number
  }
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
  if (providerKey === 'ark') return string(process.env.ARK_API_KEY)
  if (providerKey === 'hfsy') return string(process.env.HFSY_API_KEY)
  if (providerKey === 'ghc') return string(process.env.GHC_API_KEY) || string(process.env.DEV_TEXT_LLM_API_KEY)
  if (providerKey === 'deepseek') return string(process.env.DEEPSEEK_API_KEY)
  return ''
}

function materializeEnvironmentConfig(raw: ServiceConfig): ServiceConfig {
  const config = cloneConfig(raw)
  config.llm ||= {}
  config.llm.providers = Array.isArray(config.llm.providers) ? config.llm.providers : []
  const hasArk = config.llm.providers.some((provider) => getRawProviderKey(provider.id).toLowerCase() === 'ark')
  const arkApiKey = string(process.env.ARK_API_KEY)
  if (!hasArk && arkApiKey) {
    config.llm.providers.push({ id: 'ark', name: 'Volcengine Ark', apiKey: arkApiKey, gatewayRoute: 'official' })
  }
  for (const provider of config.llm.providers) {
    const environmentKey = environmentProviderKey(provider.id)
    if (!isUsableServiceSecret(provider.apiKey) && isUsableServiceSecret(environmentKey)) {
      provider.apiKey = environmentKey
    }
  }

  const understandingModel = string(config.videoRepaint?.understandingModel)
    || string(process.env.ARK_VIDEO_UNDERSTANDING_MODEL)
    || 'doubao-seed-2-1-pro-260628'
  const adaptationModel = string(config.videoRepaint?.adaptationModel)
    || string(process.env.ARK_VIDEO_ADAPTATION_MODEL)
    || understandingModel
  const envFps = Number.parseFloat(string(process.env.ARK_VIDEO_UNDERSTANDING_FPS))
  config.videoRepaint = {
    providerId: string(config.videoRepaint?.providerId) || 'ark',
    understandingModel,
    adaptationModel,
    fps: typeof config.videoRepaint?.fps === 'number' && Number.isFinite(config.videoRepaint.fps)
      ? config.videoRepaint.fps
      : (Number.isFinite(envFps) ? envFps : 0.5),
  }

  config.llm.models = Array.isArray(config.llm.models) ? config.llm.models : []
  const understandingKey = composeModelKey(config.videoRepaint.providerId || 'ark', understandingModel)
  if (understandingKey && !config.llm.models.some((model) => composeModelKey(model.provider, model.modelId) === understandingKey)) {
    config.llm.models.push({
      modelId: understandingModel,
      modelKey: understandingKey,
      name: 'Doubao Seed 2.1 Pro',
      type: 'llm',
      provider: config.videoRepaint.providerId || 'ark',
    })
  }

  const providerIds = new Set(config.llm.providers.map((provider) => provider.id))
  for (const businessModel of listNoriBusinessModels()) {
    const configuredRoute = string(config.llm.modelRouting?.[businessModel.key]) || businessModel.suggestedRoute
    const parsed = parseModelKeyStrict(configuredRoute)
    if (!parsed || !providerIds.has(parsed.provider)) continue
    if (config.llm.models.some((model) => composeModelKey(model.provider, model.modelId) === parsed.modelKey)) continue
    const providerKey = getRawProviderKey(parsed.provider).toLowerCase()
    config.llm.models.push({
      modelId: parsed.modelId,
      modelKey: parsed.modelKey,
      name: parsed.modelId,
      type: businessModel.type,
      provider: parsed.provider,
      ...(businessModel.type === 'llm' && ['ghc', 'hfsy', 'deepseek'].includes(providerKey)
        ? { llmProtocol: providerKey === 'ghc' ? 'responses' as const : 'chat-completions' as const }
        : {}),
    })
  }
  return config
}

export function readMaterializedPlatformServiceConfig(): ServiceConfig {
  return materializeEnvironmentConfig(readServiceConfig())
}

function normalizeProvider(
  raw: unknown,
  index: number,
  currentById: Map<string, ServiceConfigProvider>,
): ServiceConfigProvider {
  if (!isRecord(raw)) throw new Error(`SERVICE_CONFIG_INVALID: providers[${index}]`)
  const id = requiredString(raw.id, `providers[${index}].id`, 128).toLowerCase()
  if (!PROVIDER_ID_PATTERN.test(id) || !isSupportedModelProvider(id)) {
    throw new Error(`SERVICE_CONFIG_INVALID: unsupported provider ${id}`)
  }
  const name = requiredString(raw.name, `providers[${index}].name`, 128)
  const existing = currentById.get(id)
  const apiKey = [raw.apiKey, existing?.apiKey, environmentProviderKey(id)]
    .map(string)
    .find(isUsableServiceSecret) || ''

  const providerKey = getRawProviderKey(id).toLowerCase()
  const baseUrl = optionalUrl(raw.baseUrl, `providers[${index}].baseUrl`)
    || string(existing?.baseUrl)
    || (providerKey === 'kuaizi' ? 'https://aiopenapi.kuaizi.cn' : '')
    || undefined
  if (providerKey !== 'ark' && !baseUrl && providerKey !== 'lumina') {
    throw new Error(`SERVICE_CONFIG_INVALID: provider ${id} is missing base URL`)
  }

  const rawGatewayRoute = string(raw.gatewayRoute)
  const gatewayRoute = rawGatewayRoute === 'official' || rawGatewayRoute === 'openai-compat'
    ? rawGatewayRoute
    : existing?.gatewayRoute
  const rawApiMode = string(raw.apiMode)
  const apiMode = rawApiMode === 'gemini-sdk' || rawApiMode === 'openai-official'
    ? rawApiMode
    : existing?.apiMode
  const assetGroupId = string(raw.assetGroupId) || string(existing?.assetGroupId)
  if (assetGroupId.length > 191) {
    throw new Error(`SERVICE_CONFIG_INVALID: providers[${index}].assetGroupId`)
  }

  return {
    id,
    name,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(providerKey === 'kuaizi' && assetGroupId ? { assetGroupId } : {}),
    ...(apiMode ? { apiMode } : {}),
    gatewayRoute: gatewayRoute || (providerKey === 'ark' ? 'official' : 'openai-compat'),
  }
}

function normalizeModel(
  raw: unknown,
  index: number,
  providerIds: Set<string>,
  existingByKey: Map<string, ServiceConfigModel>,
): ServiceConfigModel {
  if (!isRecord(raw)) throw new Error(`SERVICE_CONFIG_INVALID: models[${index}]`)
  const provider = requiredString(raw.provider, `models[${index}].provider`, 128).toLowerCase()
  const modelId = requiredString(raw.modelId, `models[${index}].modelId`, 191)
  if (!providerIds.has(provider)) throw new Error(`SERVICE_CONFIG_INVALID: model provider ${provider} is missing`)
  if (!MODEL_TYPES.has(raw.type as UnifiedModelType)) {
    throw new Error(`SERVICE_CONFIG_INVALID: models[${index}].type`)
  }
  const type = raw.type as UnifiedModelType
  const modelKey = composeModelKey(provider, modelId)
  if (!modelKey) throw new Error(`SERVICE_CONFIG_INVALID: models[${index}].modelKey`)
  const existing = existingByKey.get(modelKey)
  const protocolInput = string(raw.llmProtocol)
  const llmProtocol = protocolInput === 'responses' || protocolInput === 'chat-completions'
    ? protocolInput
    : existing?.llmProtocol
  const requiresProtocol = type === 'llm' && (
    getRawProviderKey(provider).toLowerCase() === 'openai-compatible'
    || ['ghc', 'hfsy', 'deepseek'].includes(getRawProviderKey(provider).toLowerCase())
  )

  return {
    ...(existing || {}),
    modelId,
    modelKey,
    name: string(raw.name) || existing?.name || modelId,
    type,
    provider,
    ...(requiresProtocol ? { llmProtocol: llmProtocol || 'chat-completions' } : llmProtocol ? { llmProtocol } : {}),
  }
}

function normalizeDefaults(raw: unknown, models: ServiceConfigModel[]): ServiceConfigDefaultModels {
  const record = isRecord(raw) ? raw : {}
  const byKey = new Map(models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const defaults: ServiceConfigDefaultModels = {}
  for (const [field, expectedType] of Object.entries(DEFAULT_MODEL_TYPES) as Array<[keyof ServiceConfigDefaultModels, UnifiedModelType]>) {
    const value = string(record[field])
    if (!value) continue
    const businessModel = findNoriBusinessModel(value)
    if (businessModel) {
      if (businessModel.type !== expectedType) {
        throw new Error(`SERVICE_CONFIG_INVALID: defaultModels.${field}`)
      }
      defaults[field] = businessModel.key
      continue
    }
    const parsed = parseModelKeyStrict(value)
    const model = parsed ? byKey.get(parsed.modelKey) : null
    if (!model || model.type !== expectedType) {
      throw new Error(`SERVICE_CONFIG_INVALID: defaultModels.${field}`)
    }
    defaults[field] = parsed!.modelKey
  }
  return defaults
}

function normalizeModelRouting(
  raw: unknown,
  models: ServiceConfigModel[],
): Partial<Record<NoriBusinessModelKey, string>> {
  const record = isRecord(raw) ? raw : {}
  const modelByKey = new Map(models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const routing: Partial<Record<NoriBusinessModelKey, string>> = {}

  for (const businessModel of listNoriBusinessModels()) {
    const value = string(record[businessModel.key])
    if (!value) continue
    const parsed = parseModelKeyStrict(value)
    const targetModel = parsed ? modelByKey.get(parsed.modelKey) : null
    if (!parsed || parsed.provider === 'nori' || !targetModel || targetModel.type !== businessModel.type) {
      throw new Error(`SERVICE_CONFIG_INVALID: modelRouting.${businessModel.key}`)
    }
    routing[businessModel.key] = parsed.modelKey
  }

  for (const key of Object.keys(record)) {
    if (!findNoriBusinessModel(key)) {
      throw new Error(`SERVICE_CONFIG_INVALID: modelRouting.${key}`)
    }
  }
  return routing
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

function normalizeVideoRepaint(raw: unknown, current: ServiceConfig, providerIds: Set<string>) {
  const record = isRecord(raw) ? raw : {}
  const currentConfig = current.videoRepaint || {}
  const providerId = string(record.providerId) || string(currentConfig.providerId) || 'ark'
  if (!providerIds.has(providerId)) throw new Error('SERVICE_CONFIG_INVALID: videoRepaint.providerId')
  const understandingModel = requiredString(
    record.understandingModel || currentConfig.understandingModel || 'doubao-seed-2-1-pro-260628',
    'videoRepaint.understandingModel',
    191,
  )
  const adaptationModel = requiredString(
    record.adaptationModel || currentConfig.adaptationModel || understandingModel,
    'videoRepaint.adaptationModel',
    191,
  )
  const fpsValue = typeof record.fps === 'number' ? record.fps : Number(record.fps ?? currentConfig.fps ?? 0.5)
  if (!Number.isFinite(fpsValue) || fpsValue < 0.1 || fpsValue > 10) {
    throw new Error('SERVICE_CONFIG_INVALID: videoRepaint.fps')
  }
  return { providerId, understandingModel, adaptationModel, fps: fpsValue }
}

export async function savePlatformServiceConfig(input: unknown): Promise<PlatformServiceConfigResponse> {
  if (!isRecord(input)) throw new Error('SERVICE_CONFIG_INVALID: payload')
  const current = readMaterializedPlatformServiceConfig()
  const rawProviders = Array.isArray(input.providers) ? input.providers : []
  if (rawProviders.length === 0 || rawProviders.length > MAX_PROVIDERS) {
    throw new Error('SERVICE_CONFIG_INVALID: providers')
  }
  const currentById = new Map((current.llm?.providers || []).map((provider) => [provider.id.toLowerCase(), provider]))
  const providers = rawProviders.map((provider, index) => normalizeProvider(provider, index, currentById))
  const providerIds = new Set(providers.map((provider) => provider.id))
  if (providerIds.size !== providers.length) throw new Error('SERVICE_CONFIG_INVALID: duplicate provider id')

  const rawModels = Array.isArray(input.models) ? input.models : []
  if (rawModels.length === 0 || rawModels.length > MAX_MODELS) throw new Error('SERVICE_CONFIG_INVALID: models')
  const existingByKey = new Map((current.llm?.models || []).map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const models = rawModels.map((model, index) => normalizeModel(model, index, providerIds, existingByKey))
  const modelKeys = models.map((model) => composeModelKey(model.provider, model.modelId))
  if (new Set(modelKeys).size !== modelKeys.length) throw new Error('SERVICE_CONFIG_INVALID: duplicate model key')

  const next: ServiceConfig = {
    storage: normalizeStorage(input.storage, current),
    ...(current.seedanceAssets ? { seedanceAssets: current.seedanceAssets } : {}),
    llm: {
      providers,
      models,
      defaultModels: normalizeDefaults(input.defaultModels, models),
      modelRouting: normalizeModelRouting(input.modelRouting, models),
    },
    ...(current.image ? { image: current.image } : {}),
    ...(current.model3d ? { model3d: current.model3d } : {}),
    videoRepaint: normalizeVideoRepaint(input.videoRepaint, current, providerIds),
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
  const effectiveRouting = getNoriModelRouting()
  const modelRouting = Object.fromEntries(listNoriBusinessModels().map((businessModel) => {
    const targetKey = effectiveRouting[businessModel.key]
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
      ...(provider.apiMode ? { apiMode: provider.apiMode } : {}),
      ...(provider.gatewayRoute ? { gatewayRoute: provider.gatewayRoute } : {}),
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
    videoRepaint: {
      providerId: string(config.videoRepaint?.providerId) || 'ark',
      understandingModel: string(config.videoRepaint?.understandingModel) || 'doubao-seed-2-1-pro-260628',
      adaptationModel: string(config.videoRepaint?.adaptationModel)
        || string(config.videoRepaint?.understandingModel)
        || 'doubao-seed-2-1-pro-260628',
      fps: typeof config.videoRepaint?.fps === 'number' ? config.videoRepaint.fps : 0.5,
    },
  }
}
