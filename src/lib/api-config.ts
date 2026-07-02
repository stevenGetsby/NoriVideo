/**
 * API 配置读取器（配置中心严格模式）
 *
 * 规则：
 * 1) 模型唯一键必须是 provider::modelId
 * 2) 禁止 provider 猜测、静态映射、默认降级
 * 3) 运行时只从配置中心读取 provider 与密钥
 */

import { prisma } from './prisma'
import { decryptApiKey, encryptApiKey } from './crypto-utils'
import {
  composeModelKey,
  parseModelKeyStrict,
  type UnifiedModelType,
} from './model-config-contract'
import type {
  OpenAICompatMediaTemplate,
  OpenAICompatMediaTemplateSource,
} from './openai-compat-media-template'
import { validateOpenAICompatMediaTemplate } from './user-api/model-template/validator'
import {
  getLuminaAnthropicCompatibleModelName,
} from './lumina-anthropic-compatible-models'
import {
  isHfsyProviderId,
  isOpenAICompatLlmProviderId,
  isLuminaProviderId,
  isSupportedModelProvider,
  normalizeProviderModelId,
} from './model-provider-contract'
import {
  HFSY_IMAGE_MODEL_ID,
  HFSY_IMAGE_MODEL_KEY,
  HFSY_PROVIDER_ID,
} from './hfsy-fixed-models'
import {
  getServiceImageConfig,
  getServiceLlmConfig,
  type ServiceConfigProvider,
} from './service-config'

export interface CustomModel {
  modelId: string
  modelKey: string
  name: string
  type: UnifiedModelType
  provider: string
  llmProtocol?: 'responses' | 'chat-completions'
  llmProtocolCheckedAt?: string
  compatMediaTemplate?: OpenAICompatMediaTemplate
  compatMediaTemplateCheckedAt?: string
  compatMediaTemplateSource?: OpenAICompatMediaTemplateSource
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
  compatMediaTemplate?: OpenAICompatMediaTemplate
}

type GatewayRouteType = 'official' | 'openai-compat'

interface CustomProvider {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  apiMode?: 'gemini-sdk' | 'openai-official'
  gatewayRoute?: GatewayRouteType
}

type LlmProtocolType = 'responses' | 'chat-completions'

const DEFAULT_MODEL_FIELD_TO_TYPE = {
  analysisModel: 'llm',
  characterModel: 'image',
  locationModel: 'image',
  storyboardModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  audioModel: 'audio',
  lipSyncModel: 'lipsync',
} as const satisfies Record<string, UnifiedModelType>

type DefaultModelField = keyof typeof DEFAULT_MODEL_FIELD_TO_TYPE

function normalizeProviderBaseUrl(providerId: string, rawBaseUrl?: string): string | undefined {
  const providerKey = getProviderKey(providerId)
  if (isHfsyProviderId(providerId)) {
    const baseUrl = readTrimmedString(rawBaseUrl) || 'https://www.hfsyapi.cn/v1'
    return baseUrl.replace(/\/+$/, '').endsWith('/v1')
      ? baseUrl.replace(/\/+$/, '')
      : `${baseUrl.replace(/\/+$/, '')}/v1`
  }
  if (getProviderKey(providerId).toLowerCase() === 'ghc') {
    return readTrimmedString(rawBaseUrl) || 'http://localhost:8313/v1'
  }
  if (getProviderKey(providerId).toLowerCase() === 'deepseek') {
    const baseUrl = readTrimmedString(rawBaseUrl) || 'https://api.deepseek.com/v1'
    return baseUrl.replace(/\/+$/, '')
  }
  if (providerKey === 'minimax') {
    return 'https://api.minimaxi.com/v1'
  }

  const baseUrl = readTrimmedString(rawBaseUrl)
  if (!baseUrl) return undefined
  if (providerKey !== 'openai-compatible') return baseUrl

  try {
    const parsed = new URL(baseUrl)
    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    const hasV1 = pathSegments.includes('v1')
    if (hasV1) return baseUrl

    const trimmedPath = parsed.pathname.replace(/\/+$/, '')
    parsed.pathname = `${trimmedPath === '' || trimmedPath === '/' ? '' : trimmedPath}/v1`
    return parsed.toString()
  } catch {
    // Keep original value to avoid hiding invalid-config errors.
    return baseUrl
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEnvHfsyApiKey(): string {
  return readTrimmedString(getServiceImageConfig()?.hfsy?.apiKey)
    || readTrimmedString(process.env.HFSY_API_KEY)
    || readTrimmedString(process.env.NORI_TEST_HFSY_API_KEY)
    || readTrimmedString(process.env.NORI_TEST_IMAGE_API_KEY)
}

function buildHfsyGptImage2Template(): OpenAICompatMediaTemplate {
  return {
    version: 1,
    mediaType: 'image',
    mode: 'sync',
    create: {
      method: 'POST',
      path: '/images/generations',
      contentType: 'application/json',
      bodyTemplate: {
        model: '{{model}}',
        prompt: '{{prompt}}',
        size: '{{size}}',
        reference_images: '{{images}}',
        n: 1,
        response_format: 'b64_json',
      },
    },
    response: {
      outputB64JsonPath: '$.data[0].b64_json',
      outputUrlPath: '$.data[0].url',
      outputUrlsPath: '$.data',
      errorPath: '$.error.message',
    },
  }
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

function isGatewayRoute(value: unknown): value is GatewayRouteType {
  return value === 'official' || value === 'openai-compat'
}

function isLlmProtocol(value: unknown): value is LlmProtocolType {
  return value === 'responses' || value === 'chat-completions'
}

function assertModelKey(value: string, field: string): { provider: string; modelId: string; modelKey: string } {
  const parsed = parseModelKeyStrict(value)
  if (!parsed) {
    throw new Error(`MODEL_KEY_INVALID: ${field} must be provider::modelId`)
  }
  return parsed
}

function parseCustomProviders(rawProviders: string | null | undefined): CustomProvider[] {
  if (!rawProviders) return []

  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawProviders)
  } catch {
    throw new Error('PROVIDER_PAYLOAD_INVALID: customProviders is not valid JSON')
  }

  if (!Array.isArray(parsedUnknown)) {
    throw new Error('PROVIDER_PAYLOAD_INVALID: customProviders must be an array')
  }

  const providers: CustomProvider[] = []
  for (let index = 0; index < parsedUnknown.length; index += 1) {
    const raw = parsedUnknown[index]
    if (!isRecord(raw)) {
      throw new Error(`PROVIDER_PAYLOAD_INVALID: providers[${index}] must be an object`)
    }

    const id = readTrimmedString(raw.id)
    const name = readTrimmedString(raw.name)
    if (!id || !name) {
      throw new Error(`PROVIDER_PAYLOAD_INVALID: providers[${index}] missing id or name`)
    }
    const normalizedId = id.toLowerCase()
    if (providers.some((provider) => provider.id.toLowerCase() === normalizedId)) {
      throw new Error(`PROVIDER_DUPLICATE: providers[${index}].id duplicates id ${id}`)
    }

    const providerKey = getProviderKey(id).toLowerCase()
    if (!isSupportedModelProvider(id)) {
      continue
    }
    const apiModeRaw = raw.apiMode
    let apiMode: 'gemini-sdk' | 'openai-official' | undefined
    if (apiModeRaw === undefined) {
      apiMode = undefined
    } else if (apiModeRaw === 'gemini-sdk' || apiModeRaw === 'openai-official') {
      if ((providerKey === 'gemini-compatible' || isLuminaProviderId(id)) && apiModeRaw === 'openai-official') {
        throw new Error(`PROVIDER_API_MODE_INVALID: providers[${index}].apiMode`)
      }
      apiMode = apiModeRaw
    } else {
      throw new Error(`PROVIDER_API_MODE_INVALID: providers[${index}].apiMode`)
    }

    const gatewayRouteRaw = raw.gatewayRoute
    let gatewayRoute: GatewayRouteType | undefined
    if (gatewayRouteRaw === undefined) {
      gatewayRoute = undefined
    } else if (!isGatewayRoute(gatewayRouteRaw)) {
      throw new Error(`PROVIDER_GATEWAY_ROUTE_INVALID: providers[${index}].gatewayRoute`)
    } else if (isHfsyProviderId(id) && gatewayRouteRaw === 'official') {
      throw new Error(`PROVIDER_GATEWAY_ROUTE_INVALID: providers[${index}].gatewayRoute`)
    } else if (gatewayRouteRaw === 'openai-compat' && !isOpenAICompatLlmProviderId(id)) {
      throw new Error(`PROVIDER_GATEWAY_ROUTE_INVALID: providers[${index}].gatewayRoute`)
    } else {
      gatewayRoute = gatewayRouteRaw
    }

    providers.push({
      id,
      name,
      baseUrl: readTrimmedString(raw.baseUrl) || undefined,
      apiKey: readTrimmedString(raw.apiKey) || undefined,
      apiMode,
      gatewayRoute,
    })
  }

  return providers
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
  const isLuminaProvider = isLuminaProviderId(provider)
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

  const compatMediaTemplateRaw = raw.compatMediaTemplate
  let compatMediaTemplate: OpenAICompatMediaTemplate | undefined
  if (compatMediaTemplateRaw !== undefined && compatMediaTemplateRaw !== null) {
    const validated = validateOpenAICompatMediaTemplate(compatMediaTemplateRaw)
    if (!validated.ok || !validated.template) {
      throw new Error(`MODEL_COMPAT_MEDIA_TEMPLATE_INVALID: models[${index}].compatMediaTemplate`)
    }
    compatMediaTemplate = validated.template
  }
  const compatMediaTemplateCheckedAt = readTrimmedString(raw.compatMediaTemplateCheckedAt) || undefined
  const compatMediaTemplateSourceRaw = readTrimmedString(raw.compatMediaTemplateSource)
  const compatMediaTemplateSource = compatMediaTemplateSourceRaw === 'ai' || compatMediaTemplateSourceRaw === 'manual'
    ? compatMediaTemplateSourceRaw
    : undefined

  return {
    modelId,
    modelKey,
    provider,
    type: raw.type,
    name: (isLuminaProvider ? getLuminaAnthropicCompatibleModelName(modelId) : null)
      || readTrimmedString(raw.name)
      || modelId,
    ...(llmProtocol ? { llmProtocol } : {}),
    ...(llmProtocolCheckedAt ? { llmProtocolCheckedAt } : {}),
    ...(compatMediaTemplate ? { compatMediaTemplate } : {}),
    ...(compatMediaTemplateCheckedAt ? { compatMediaTemplateCheckedAt } : {}),
    ...(compatMediaTemplateSource ? { compatMediaTemplateSource } : {}),
    price: 0,
  }
}

function parseCustomModels(rawModels: string | null | undefined): CustomModel[] {
  if (!rawModels) return []

  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawModels)
  } catch {
    throw new Error('MODEL_PAYLOAD_INVALID: customModels is not valid JSON')
  }

  if (!Array.isArray(parsedUnknown)) {
    throw new Error('MODEL_PAYLOAD_INVALID: customModels must be an array')
  }

  const models: CustomModel[] = []
  for (let index = 0; index < parsedUnknown.length; index += 1) {
    models.push(normalizeStoredModel(parsedUnknown[index], index))
  }

  return models
}

function parseServiceModels(): CustomModel[] {
  const rawModels = getServiceLlmConfig()?.models
  if (!Array.isArray(rawModels)) return []
  return rawModels.map((model, index) => normalizeStoredModel(model, index))
}

function appendMissingModels(models: CustomModel[], additions: CustomModel[]): CustomModel[] {
  const seen = new Set(models.map((model) => composeModelKey(model.provider, model.modelId)))
  const merged = [...models]
  for (const model of additions) {
    const key = composeModelKey(model.provider, model.modelId)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(model)
  }
  return merged
}

function appendDefaultModelSelections(
  models: CustomModel[],
  defaults: Partial<Record<DefaultModelField, string | null | undefined>>,
): CustomModel[] {
  const seen = new Set(models.map((model) => composeModelKey(model.provider, model.modelId)).filter(Boolean))
  const merged = [...models]

  for (const [field, modelKey] of Object.entries(defaults) as Array<[DefaultModelField, string | null | undefined]>) {
    const parsed = parseModelKeyStrict(readTrimmedString(modelKey))
    if (!parsed || seen.has(parsed.modelKey)) continue

    seen.add(parsed.modelKey)
    const modelType = DEFAULT_MODEL_FIELD_TO_TYPE[field]
    const defaultLlmProtocol = modelType === 'llm' && isOpenAICompatLlmProviderId(parsed.provider)
      ? (getProviderKey(parsed.provider).toLowerCase() === 'ghc' ? 'responses' : 'chat-completions')
      : undefined
    merged.push({
      modelId: parsed.modelId,
      modelKey: parsed.modelKey,
      name: (isLuminaProviderId(parsed.provider)
        ? getLuminaAnthropicCompatibleModelName(parsed.modelId)
        : null) || parsed.modelId,
      type: modelType,
      provider: parsed.provider,
      ...(defaultLlmProtocol ? { llmProtocol: defaultLlmProtocol } : {}),
      price: 0,
    })
  }

  return merged
}

function appendEnvHfsyProvider(providers: CustomProvider[]): CustomProvider[] {
  if (providers.some((provider) => provider.id === HFSY_PROVIDER_ID)) return providers
  const apiKey = readEnvHfsyApiKey()
  if (!apiKey) return providers
  const hfsyConfig = getServiceImageConfig()?.hfsy
  return [
    ...providers,
    {
      id: HFSY_PROVIDER_ID,
      name: 'HFSY API',
      baseUrl: readTrimmedString(hfsyConfig?.baseUrl) || 'https://www.hfsyapi.cn/v1',
      apiKey: encryptApiKey(apiKey),
      gatewayRoute: 'openai-compat',
    },
  ]
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
  const apiMode = raw.apiMode === 'gemini-sdk' || raw.apiMode === 'openai-official'
    ? raw.apiMode
    : undefined
  const gatewayRoute = raw.gatewayRoute === 'official' || raw.gatewayRoute === 'openai-compat'
    ? raw.gatewayRoute
    : undefined
  const apiKey = readTrimmedString(raw.apiKey)
  return {
    id,
    name,
    baseUrl: readTrimmedString(raw.baseUrl) || undefined,
    ...(apiKey ? { apiKey: encryptApiKey(apiKey) } : {}),
    ...(apiMode ? { apiMode } : {}),
    ...(gatewayRoute ? { gatewayRoute } : {}),
  }
}

function prependServiceProviders(userProviders: CustomProvider[]): CustomProvider[] {
  const serviceProviders = getServiceLlmConfig()?.providers
  if (!Array.isArray(serviceProviders) || serviceProviders.length === 0) return userProviders
  const normalized = serviceProviders.map(normalizeServiceProvider)
  const userIds = new Set(userProviders.map((provider) => provider.id))
  return [
    ...userProviders,
    ...normalized.filter((provider) => !userIds.has(provider.id)),
  ]
}

function ensureHfsyImageModelTemplate(models: CustomModel[]): CustomModel[] {
  const template = buildHfsyGptImage2Template()
  const now = new Date().toISOString()
  let hasImageModel = false
  const nextModels = models.map((model) => {
    if (model.modelKey !== HFSY_IMAGE_MODEL_KEY || model.type !== 'image') return model
    hasImageModel = true
    return {
      ...model,
      name: model.name || 'HFSY GPT Image 2',
      compatMediaTemplate: model.compatMediaTemplate || template,
      compatMediaTemplateCheckedAt: model.compatMediaTemplateCheckedAt || now,
      compatMediaTemplateSource: model.compatMediaTemplateSource || 'manual',
    }
  })
  if (hasImageModel) return nextModels
  return [
    ...nextModels,
    {
      modelId: HFSY_IMAGE_MODEL_ID,
      modelKey: HFSY_IMAGE_MODEL_KEY,
      name: 'HFSY GPT Image 2',
      type: 'image',
      provider: HFSY_PROVIDER_ID,
      compatMediaTemplate: template,
      compatMediaTemplateCheckedAt: now,
      compatMediaTemplateSource: 'manual',
      price: 0,
    },
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
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      customModels: true,
      customProviders: true,
      analysisModel: true,
      characterModel: true,
      locationModel: true,
      storyboardModel: true,
      editModel: true,
      videoModel: true,
      audioModel: true,
      lipSyncModel: true,
    },
  })

  const serviceDefaults = getServiceLlmConfig()?.defaultModels || {}
  const userModels = appendMissingModels(parseCustomModels(pref?.customModels), parseServiceModels())
  const models = ensureHfsyImageModelTemplate(appendDefaultModelSelections(
    userModels,
    {
      analysisModel: pref?.analysisModel || serviceDefaults.analysisModel,
      characterModel: pref?.characterModel || serviceDefaults.characterModel,
      locationModel: pref?.locationModel || serviceDefaults.locationModel,
      storyboardModel: pref?.storyboardModel || serviceDefaults.storyboardModel,
      editModel: pref?.editModel || serviceDefaults.editModel,
      videoModel: pref?.videoModel || serviceDefaults.videoModel,
      audioModel: pref?.audioModel || serviceDefaults.audioModel,
      lipSyncModel: pref?.lipSyncModel || serviceDefaults.lipSyncModel,
    },
  ))

  return {
    models,
    providers: appendEnvHfsyProvider(prependServiceProviders(parseCustomProviders(pref?.customProviders))),
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
  const parsed = assertModelKey(model, `${mediaType} model`)
  const models = await getModelsByType(userId, mediaType)

  const exact = findModelByKey(models, parsed.modelKey)
  if (!exact) {
    throw new Error(`MODEL_NOT_FOUND: ${parsed.modelKey} is not enabled for ${mediaType}`)
  }

  const providerKey = getProviderKey(exact.provider).toLowerCase()
  const llmProtocol = mediaType === 'llm' && isOpenAICompatLlmProviderId(exact.provider)
    ? (exact.llmProtocol || 'chat-completions')
    : undefined
  const compatMediaTemplate = (mediaType === 'image' || mediaType === 'video') && exact.compatMediaTemplate
    ? exact.compatMediaTemplate
    : undefined

  return {
    provider: exact.provider,
    modelId: exact.modelId,
    modelKey: composeModelKey(exact.provider, exact.modelId),
    mediaType,
    ...(llmProtocol ? { llmProtocol } : {}),
    ...(compatMediaTemplate ? { compatMediaTemplate } : {}),
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
  const providerKey = getProviderKey(model.provider).toLowerCase()
  const llmProtocol = mediaType === 'llm' && isOpenAICompatLlmProviderId(model.provider)
    ? (model.llmProtocol || 'chat-completions')
    : undefined
  const compatMediaTemplate = (mediaType === 'image' || mediaType === 'video') && model.compatMediaTemplate
    ? model.compatMediaTemplate
    : undefined

  return {
    provider: model.provider,
    modelId: model.modelId,
    modelKey: composeModelKey(model.provider, model.modelId),
    mediaType,
    ...(llmProtocol ? { llmProtocol } : {}),
    ...(compatMediaTemplate ? { compatMediaTemplate } : {}),
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
 * baseUrl 和 apiMode 为可选——不同 provider 需求不同，由调用方自行校验。
 *
 * ⚠️ 调用方必须先通过 resolveModelSelection 校验模型归属，
 * 再使用 selection.provider 调用本函数，禁止直接传入未校验的 providerId。
 */
export interface ProviderConfig {
  id: string
  name: string
  apiKey: string
  baseUrl?: string
  apiMode?: 'gemini-sdk' | 'openai-official'
  gatewayRoute?: GatewayRouteType
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
    baseUrl: normalizeProviderBaseUrl(provider.id, provider.baseUrl),
    apiMode: provider.apiMode,
    gatewayRoute: provider.gatewayRoute,
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
  const matched = findModelByKey(models, model)
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
  const matched = findModelByKey(models, model)
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
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customProviders: true },
  })

  const providers = parseCustomProviders(pref?.customProviders)
  return providers.some((provider) => !!provider.apiKey)
}
