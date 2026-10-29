/**
 * API 配置读取器（配置中心严格模式）
 *
 * 规则：
 * 1) 模型唯一键必须是 provider::modelId
 * 2) 禁止 provider 猜测、静态映射、默认降级
 * 3) 运行时只从配置中心读取 provider 与密钥
 */

import { decryptApiKey, encryptApiKey } from './crypto-utils'
import {
  composeModelKey,
  parseModelKeyStrict,
  type UnifiedModelType,
} from './model-config-contract'
import {
  MODEL_PROVIDER_PRESETS,
  isOpenAICompatLlmProviderId,
  isSupportedModelProvider,
  normalizeModelProviderKey,
  normalizeProviderModelId,
} from './model-provider-contract'
import {
  getServiceLlmConfig,
  type ServiceConfigProvider,
} from './service-config'
import {
  fixedPlatformModels,
} from './platform-services/config'
import {
  findNoriBusinessModel,
  normalizeProjectBusinessModelKey,
  resolveRuntimeModelKey,
} from './nori-model-catalog'

export interface CustomModel {
  modelId: string
  modelKey: string
  name: string
  type: UnifiedModelType
  provider: string
  llmProtocol?: 'responses' | 'chat-completions'
  llmProtocolCheckedAt?: string
  // Non-authoritative display field; billing uses unified server pricing catalog.
  price: number
}

export type ModelMediaType = 'llm' | 'image' | 'video' | 'audio' | 'lipsync'

export interface ModelSelection {
  provider: string
  modelId: string
  modelKey: string
  mediaType: ModelMediaType
  llmProtocol?: 'responses' | 'chat-completions'
}

interface CustomProvider {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  assetGroupId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}







type LlmProtocolType = 'responses' | 'chat-completions'

function isLlmProtocol(value: unknown): value is LlmProtocolType {
  return value === 'chat-completions'
}

function assertModelKey(value: string, field: string) {
  const parsed = parseModelKeyStrict(value)
  if (!parsed) throw new Error(`MODEL_KEY_INVALID: ${field} must be provider::modelId`)
  return parsed
}

function normalizeProviderBaseUrl(providerId: string): string {
  const key = normalizeModelProviderKey(providerId)
  const preset = MODEL_PROVIDER_PRESETS.find((provider) => provider.id === key)
  if (!preset) throw new Error(`PROVIDER_NOT_FOUND: ${providerId} is not supported`)
  return preset.baseUrl
}

function isUnifiedModelType(value: unknown): value is UnifiedModelType {
  return (
    value === 'llm'
    || value === 'image'
    || value === 'video'
    || value === 'audio'
    || value === 'lipsync'
  )
}

function normalizeStoredModel(raw: unknown, index: number): CustomModel {
  if (!isRecord(raw)) {
    throw new Error(`MODEL_PAYLOAD_INVALID: models[${index}] must be an object`)
  }

  if (!isUnifiedModelType(raw.type)) {
    throw new Error(`MODEL_TYPE_INVALID: models[${index}].type is invalid`)
  }

  const providerFromField = readTrimmedString(raw.provider)
  const modelIdFromField = readTrimmedString(raw.modelId)
  const modelKeyFromField = readTrimmedString(raw.modelKey)

  const parsedFromKey = modelKeyFromField ? parseModelKeyStrict(modelKeyFromField) : null
  const provider = providerFromField || parsedFromKey?.provider || ''
  const rawModelId = modelIdFromField || parsedFromKey?.modelId || ''
  const modelId = normalizeProviderModelId(provider, rawModelId)
  const modelKey = composeModelKey(provider, modelId)

  if (!modelKey) {
    throw new Error(`MODEL_KEY_INVALID: models[${index}] must include provider and modelId`)
  }

  if (parsedFromKey && parsedFromKey.modelKey !== modelKey) {
    const normalizedParsedModelId = normalizeProviderModelId(parsedFromKey.provider, parsedFromKey.modelId)
    const normalizedParsedModelKey = composeModelKey(parsedFromKey.provider, normalizedParsedModelId)
    if (normalizedParsedModelKey !== modelKey) {
      throw new Error(`MODEL_KEY_MISMATCH: models[${index}].modelKey conflicts with provider/modelId`)
    }
  }

  const llmProtocolRaw = raw.llmProtocol
  let llmProtocol: LlmProtocolType | undefined
  if (llmProtocolRaw !== undefined && llmProtocolRaw !== null) {
    if (!isLlmProtocol(llmProtocolRaw)) {
      throw new Error(`MODEL_LLM_PROTOCOL_INVALID: models[${index}].llmProtocol`)
    }
    llmProtocol = llmProtocolRaw
  }
  const llmProtocolCheckedAt = readTrimmedString(raw.llmProtocolCheckedAt) || undefined

  return {
    modelId,
    modelKey,
    provider,
    type: raw.type,
    name: readTrimmedString(raw.name)
      || modelId,
    ...(llmProtocol ? { llmProtocol } : {}),
    ...(llmProtocolCheckedAt ? { llmProtocolCheckedAt } : {}),
    price: 0,
  }
}

function parseServiceModels(): CustomModel[] {
  const rawModels = fixedPlatformModels()
  if (!Array.isArray(rawModels)) return []
  return rawModels.map((model, index) => normalizeStoredModel(model, index))
}

function normalizeServiceProvider(raw: ServiceConfigProvider, index: number): CustomProvider {
  const id = readTrimmedString(raw.id)
  const name = readTrimmedString(raw.name)
  if (!id || !name) {
    throw new Error(`SERVICE_PROVIDER_INVALID: providers[${index}] missing id or name`)
  }
  if (!isSupportedModelProvider(id)) {
    throw new Error(`SERVICE_PROVIDER_INVALID: providers[${index}].id is unsupported`)
  }
  const apiKey = readTrimmedString(raw.apiKey)
  return {
    id,
    name,
    baseUrl: readTrimmedString(raw.baseUrl) || undefined,
    assetGroupId: readTrimmedString(raw.assetGroupId) || undefined,
    ...(apiKey ? { apiKey: encryptApiKey(apiKey) } : {}),
  }
}

function prependServiceProviders(userProviders: CustomProvider[]): CustomProvider[] {
  const serviceProviders = getServiceLlmConfig()?.providers
  if (!Array.isArray(serviceProviders) || serviceProviders.length === 0) return userProviders
  const normalized = serviceProviders.filter((provider) => isSupportedModelProvider(provider.id)).map(normalizeServiceProvider)
  const serviceIds = new Set(normalized.map((provider) => provider.id))
  return [
    ...normalized,
    ...userProviders.filter((provider) => !serviceIds.has(provider.id)),
  ]
}



function pickProviderStrict(
  providers: CustomProvider[],
  providerId: string,
): CustomProvider {
  const matched = providers.find((provider) => provider.id === providerId)
  if (matched) return matched

  throw new Error(`PROVIDER_NOT_FOUND: ${providerId} is not configured`)
}

async function readUserConfig(userId: string): Promise<{ models: CustomModel[]; providers: CustomProvider[] }> {
  const models = parseServiceModels()

  return {
    models,
    providers: prependServiceProviders([]),
  }
}

function findModelByKey(models: CustomModel[], modelKey: string): CustomModel | null {
  const parsed = assertModelKey(modelKey, 'model')
  const parsedModelId = normalizeProviderModelId(parsed.provider, parsed.modelId)
  return models.find((model) => model.modelId === parsedModelId && model.provider === parsed.provider) || null
}

/**
 * 提取提供商主键（用于多实例场景，如 gemini-compatible:uuid）
 */
export function getProviderKey(providerId?: string): string {
  if (!providerId) return ''
  const colonIndex = providerId.indexOf(':')
  return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
}

/**
 * 统一模型选择解析（严格模式）
 */
export async function resolveModelSelection(
  userId: string,
  model: string,
  mediaType: ModelMediaType,
): Promise<ModelSelection> {
  const requested = assertModelKey(model, `${mediaType} model`)
  const businessModel = findNoriBusinessModel(requested.modelKey)
  if (businessModel && businessModel.type !== mediaType) {
    throw new Error(`MODEL_TYPE_MISMATCH: ${requested.modelKey} is not a ${mediaType} model`)
  }
  const controlledModelKey = mediaType === 'llm' || mediaType === 'image' || mediaType === 'video'
    ? normalizeProjectBusinessModelKey(requested.modelKey, mediaType)
    : requested.modelKey
  const runtimeModelKey = resolveRuntimeModelKey(controlledModelKey)
  if (!runtimeModelKey) {
    throw new Error(`MODEL_ROUTE_NOT_CONFIGURED: ${requested.modelKey}`)
  }
  const parsed = assertModelKey(runtimeModelKey, `${mediaType} routed model`)
  const { models } = await readUserConfig(userId)

  const exact = findModelByKey(models, parsed.modelKey)
  if (!exact) {
    throw new Error(`MODEL_NOT_FOUND: ${parsed.modelKey} is not enabled for ${mediaType}`)
  }

  const llmProtocol = mediaType === 'llm' && isOpenAICompatLlmProviderId(exact.provider)
    ? (exact.llmProtocol || 'chat-completions')
    : undefined
  return {
    provider: exact.provider,
    modelId: exact.modelId,
    modelKey: composeModelKey(exact.provider, exact.modelId),
    mediaType,
    ...(llmProtocol ? { llmProtocol } : {}),
  }
}

async function resolveSingleModelSelection(
  userId: string,
  mediaType: ModelMediaType,
): Promise<ModelSelection> {
  const models = await getModelsByType(userId, mediaType)
  if (models.length === 0) {
    throw new Error(`MODEL_NOT_CONFIGURED: no ${mediaType} model is enabled`)
  }
  if (models.length > 1) {
    throw new Error(`MODEL_SELECTION_REQUIRED: multiple ${mediaType} models are enabled, provide model_key explicitly`)
  }

  const model = models[0]
  const llmProtocol = mediaType === 'llm' && isOpenAICompatLlmProviderId(model.provider)
    ? (model.llmProtocol || 'chat-completions')
    : undefined
  return {
    provider: model.provider,
    modelId: model.modelId,
    modelKey: composeModelKey(model.provider, model.modelId),
    mediaType,
    ...(llmProtocol ? { llmProtocol } : {}),
  }
}

/**
 * 统一模型选择解析（允许显式 model_key；未传时仅允许单模型）
 */
export async function resolveModelSelectionOrSingle(
  userId: string,
  model: string | null | undefined,
  mediaType: ModelMediaType,
): Promise<ModelSelection> {
  const modelKey = readTrimmedString(model)
  if (!modelKey) {
    return await resolveSingleModelSelection(userId, mediaType)
  }
  return await resolveModelSelection(userId, modelKey, mediaType)
}

/**
 * Provider 配置
 *
 * 返回 provider 的完整连接信息（apiKey 已解密）。
 * baseUrl 为可选——不同 provider 需求不同，由调用方自行校验。
 *
 * ⚠️ 调用方必须先通过 resolveModelSelection 校验模型归属，
 * 再使用 selection.provider 调用本函数，禁止直接传入未校验的 providerId。
 */
export interface ProviderConfig {
  id: string
  name: string
  apiKey: string
  baseUrl?: string
  assetGroupId?: string
}

export async function getProviderConfig(userId: string, providerId: string): Promise<ProviderConfig> {
  const { providers } = await readUserConfig(userId)
  const provider = pickProviderStrict(providers, providerId)

  if (!provider.apiKey) {
    throw new Error(`PROVIDER_API_KEY_MISSING: ${provider.id}`)
  }

  return {
    id: provider.id,
    name: provider.name,
    apiKey: decryptApiKey(provider.apiKey),
    baseUrl: normalizeProviderBaseUrl(provider.id),
    assetGroupId: provider.assetGroupId,
  }
}

/**
 * 获取用户自定义模型列表
 */
export async function getUserModels(userId: string): Promise<CustomModel[]> {
  const { models } = await readUserConfig(userId)
  return models
}

/**
 * 获取模型关联 provider
 */
export async function getModelProvider(userId: string, model: string): Promise<string | null> {
  const { models } = await readUserConfig(userId)
  const runtimeModelKey = resolveRuntimeModelKey(model)
  const matched = runtimeModelKey ? findModelByKey(models, runtimeModelKey) : null
  return matched?.provider || null
}

/**
 * 获取指定类型模型列表
 */
export async function getModelsByType(userId: string, type: ModelMediaType): Promise<CustomModel[]> {
  const models = await getUserModels(userId)
  return models.filter((model) => model.type === type)
}

/**
 * 解析模型 ID（严格从 model_key 提取）
 */
export async function resolveModelId(userId: string, model: string): Promise<string> {
  const selection = await resolveModelSelection(userId, model, 'llm')
  return selection.modelId
}

/**
 * 获取模型价格
 */
export async function getModelPrice(userId: string, model: string): Promise<number> {
  const { models } = await readUserConfig(userId)
  const runtimeModelKey = resolveRuntimeModelKey(model)
  const matched = runtimeModelKey ? findModelByKey(models, runtimeModelKey) : null
  if (!matched) {
    throw new Error(`MODEL_NOT_FOUND: ${model}`)
  }
  return matched.price
}

/**
 * 根据音频模型键获取音频 API Key（未传模型时要求仅存在单一音频模型）
 */
export async function getAudioApiKey(userId: string, model?: string | null): Promise<string> {
  const selection = await resolveModelSelectionOrSingle(userId, model, 'audio')
  return (await getProviderConfig(userId, selection.provider)).apiKey
}

/**
 * 根据口型同步模型键获取 API Key（未传模型时要求仅存在单一 lipsync 模型）
 */
export async function getLipSyncApiKey(userId: string, model?: string | null): Promise<string> {
  const selection = await resolveModelSelectionOrSingle(userId, model, 'lipsync')
  return (await getProviderConfig(userId, selection.provider)).apiKey
}

/**
 * 检查用户是否有任意 API 配置
 */
export async function hasApiConfig(userId: string): Promise<boolean> {
  const { providers } = await readUserConfig(userId)
  return providers.some((provider) => !!provider.apiKey)
}
