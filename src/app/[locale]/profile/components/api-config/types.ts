/**
 * API 配置类型定义和预设常量
 */
import {
    composeModelKey,
    parseModelKeyStrict,
    type ModelCapabilities,
    type UnifiedModelType,
} from '@/lib/model-config-contract'
import type {
    OpenAICompatMediaTemplate,
    OpenAICompatMediaTemplateSource,
} from '@/lib/openai-compat-media-template'
import {
    MODEL_PRESETS,
    MODEL_PROVIDER_NAME_ZH,
    MODEL_PROVIDER_PRESETS,
} from '@/lib/model-provider-contract'

// 统一提供商接口
export interface Provider {
    id: string
    name: string
    baseUrl?: string
    apiKey?: string
    hasApiKey?: boolean
    hidden?: boolean
    apiMode?: 'gemini-sdk' | 'openai-official'
    gatewayRoute?: 'official' | 'openai-compat'
}

export interface LlmCustomPricing {
    inputPerMillion?: number
    outputPerMillion?: number
}

export interface MediaCustomPricing {
    basePrice?: number
    optionPrices?: Record<string, Record<string, number>>
}

// 用户自定义定价 V2（能力参数可定价）
export interface CustomModelPricing {
    llm?: LlmCustomPricing
    image?: MediaCustomPricing
    video?: MediaCustomPricing
}

// 模型接口
export interface CustomModel {
    modelId: string       // 唯一标识符（如 anthropic/claude-sonnet-4.5）
    modelKey: string      // 唯一主键（provider::modelId）
    name: string          // 显示名称
    type: UnifiedModelType
    provider: string
    llmProtocol?: 'responses' | 'chat-completions'
    llmProtocolCheckedAt?: string
    compatMediaTemplate?: OpenAICompatMediaTemplate
    compatMediaTemplateCheckedAt?: string
    compatMediaTemplateSource?: OpenAICompatMediaTemplateSource
    price: number
    priceMin?: number
    priceMax?: number
    priceLabel?: string
    priceInput?: number
    priceOutput?: number
    enabled: boolean
    capabilities?: ModelCapabilities
    customPricing?: CustomModelPricing
}

export interface PricingDisplayItem {
    min: number
    max: number
    label: string
    input?: number
    output?: number
}

export type PricingDisplayMap = Record<string, PricingDisplayItem>

// API 配置响应
export interface ApiConfig {
    models: CustomModel[]
    providers: Provider[]
    workflowConcurrency?: {
        analysis: number
        image: number
        video: number
    }
    pricingDisplay?: PricingDisplayMap
}

type PresetModel = Omit<CustomModel, 'enabled' | 'modelKey' | 'price'>

// 预设模型
export const PRESET_MODELS: PresetModel[] = MODEL_PRESETS.map((model) => ({
    modelId: model.modelId,
    name: model.name,
    type: model.type,
    provider: model.provider,
}))
const PRESET_COMING_SOON_MODEL_KEYS = new Set<string>([])

export function isPresetComingSoonModel(provider: string, modelId: string): boolean {
    return PRESET_COMING_SOON_MODEL_KEYS.has(encodeModelKey(provider, modelId))
}

export function isPresetComingSoonModelKey(modelKey: string): boolean {
    return PRESET_COMING_SOON_MODEL_KEYS.has(modelKey)
}

// 预设提供商（API Key 唯一归属于 provider id）
export const PRESET_PROVIDERS: Omit<Provider, 'apiKey' | 'hasApiKey'>[] = MODEL_PROVIDER_PRESETS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
}))
const ZH_PROVIDER_NAME_MAP: Record<string, string> = {
    ...MODEL_PROVIDER_NAME_ZH,
}
function isZhLocale(locale?: string): boolean {
    return typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
}

export function resolvePresetProviderName(providerId: string, fallbackName: string, locale?: string): string {
    if (!isZhLocale(locale)) return fallbackName
    return ZH_PROVIDER_NAME_MAP[providerId] ?? fallbackName
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
 * 获取厂商的友好显示名称
 * @param providerId - 厂商ID（如 'ark', 'google'）
 * @returns 友好名称（如 '火山引擎(方舟)', 'Google AI Studio'）
 */
export function getProviderDisplayName(providerId?: string, locale?: string): string {
    if (!providerId) return ''
    const providerKey = getProviderKey(providerId)
    const provider = PRESET_PROVIDERS.find(p => p.id === providerKey)
    if (!provider) return providerId
    return resolvePresetProviderName(provider.id, provider.name, locale)
}

/**
 * 编码模型复合 Key（用于区分同名模型）
 * @param provider - 厂商 ID
 * @param modelId - 模型 ID
 * @returns 复合 Key，格式为 `provider::modelId`（使用双冒号避免与 provider ID 中的冒号冲突）
 */
export function encodeModelKey(provider: string, modelId: string): string {
    return composeModelKey(provider, modelId)
}

/**
 * 解析模型复合 Key
 * @param key - 复合 Key（provider::modelId）
 * @returns 解析后的 { provider, modelId }，如果无法解析返回 null
 */
export function parseModelKey(key: string | undefined | null): { provider: string, modelId: string } | null {
    const parsed = parseModelKeyStrict(key)
    if (!parsed) return null
    return {
        provider: parsed.provider,
        modelId: parsed.modelId,
    }
}

/**
 * 检查一个复合 Key 是否匹配指定的模型
 * @param key - 复合 Key（provider::modelId）
 * @param provider - 目标厂商 ID
 * @param modelId - 目标模型 ID
 * @returns 是否匹配
 */
export function matchesModelKey(key: string | undefined | null, provider: string, modelId: string): boolean {
    const parsed = parseModelKeyStrict(key)
    if (!parsed) return false
    return parsed.provider === provider && parsed.modelId === modelId
}

// 教程步骤接口
export interface TutorialStep {
    text: string           // 步骤描述 (i18n key)
    url?: string           // 可选的链接地址
}

// 厂商教程接口
export interface ProviderTutorial {
    providerId: string
    steps: TutorialStep[]
}

// 厂商开通教程配置
// 注意: text 字段使用 i18n key, 翻译在 apiConfig.tutorials 下
export const PROVIDER_TUTORIALS: ProviderTutorial[] = [
    {
        providerId: 'ark',
        steps: [
            {
                text: 'ark_step1',
                url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D'
            },
            {
                text: 'ark_step2',
                url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model'
            }
        ]
    },
    {
        providerId: 'hfsy',
        steps: [
            {
                text: 'hfsy_step1'
            }
        ]
    },
    {
        providerId: 'lumina',
        steps: [
            {
                text: 'lumina_step1'
            }
        ]
    },
]

/**
 * 根据厂商ID获取教程配置
 * @param providerId - 厂商ID
 * @returns 教程配置，如果不存在则返回 undefined
 */
export function getProviderTutorial(providerId: string): ProviderTutorial | undefined {
    const providerKey = getProviderKey(providerId)
    return PROVIDER_TUTORIALS.find(t => t.providerId === providerKey)
}
