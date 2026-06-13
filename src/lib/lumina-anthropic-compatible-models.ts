import type { UnifiedModelType } from '@/lib/model-config-contract'

export type LuminaAnthropicCompatibleModelGroup = 'text' | 'vision'

export interface LuminaAnthropicCompatibleModelPreset {
  type: UnifiedModelType
  modelId: string
  name: string
  group: LuminaAnthropicCompatibleModelGroup
}

export const LUMINA_ANTHROPIC_COMPATIBLE_TEXT_MODELS: LuminaAnthropicCompatibleModelPreset[] = [
  { type: 'llm', modelId: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', group: 'text' },
  { type: 'llm', modelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', group: 'text' },
  { type: 'llm', modelId: 'claude-opus-4-6', name: 'Claude Opus 4.6', group: 'text' },
  { type: 'llm', modelId: 'claude-opus-4-7', name: 'Claude Opus 4.7', group: 'text' },
  { type: 'llm', modelId: 'claude-opus-4-8', name: 'Claude Opus 4.8', group: 'text' },
  { type: 'llm', modelId: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', group: 'text' },
  { type: 'llm', modelId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', group: 'text' },
  { type: 'llm', modelId: 'kimi-k2.5', name: 'Kimi K2.5', group: 'text' },
]

export const LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODELS: LuminaAnthropicCompatibleModelPreset[] = [
  { type: 'llm', modelId: 'gpt-5.5', name: 'GPT-5.5', group: 'vision' },
  { type: 'llm', modelId: 'gpt-5.4', name: 'GPT-5.4', group: 'vision' },
  { type: 'llm', modelId: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', group: 'vision' },
  { type: 'llm', modelId: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', group: 'vision' },
  { type: 'llm', modelId: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', group: 'vision' },
  { type: 'llm', modelId: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', group: 'vision' },
  { type: 'llm', modelId: 'gemini-3-flash', name: 'Gemini 3 Flash', group: 'vision' },
]

export const LUMINA_ANTHROPIC_COMPATIBLE_MODELS: LuminaAnthropicCompatibleModelPreset[] = [
  ...LUMINA_ANTHROPIC_COMPATIBLE_TEXT_MODELS,
  ...LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODELS,
]

const LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODEL_ID_SET = new Set(
  LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODELS.map((model) => model.modelId),
)
const LUMINA_ANTHROPIC_COMPATIBLE_TEXT_MODEL_ID_SET = new Set(
  LUMINA_ANTHROPIC_COMPATIBLE_TEXT_MODELS.map((model) => model.modelId),
)
const LUMINA_ANTHROPIC_COMPATIBLE_MODEL_NAME_BY_ID = new Map(
  LUMINA_ANTHROPIC_COMPATIBLE_MODELS.map((model) => [model.modelId, model.name] as const),
)

export function getLuminaAnthropicCompatibleModelGroup(
  modelId: string,
): LuminaAnthropicCompatibleModelGroup {
  return LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODEL_ID_SET.has(modelId) ? 'vision' : 'text'
}

export function isLuminaAnthropicCompatibleTextCapableModel(modelId: string): boolean {
  const normalizedModelId = normalizeLuminaAnthropicCompatibleModelId(modelId)
  return (
    LUMINA_ANTHROPIC_COMPATIBLE_TEXT_MODEL_ID_SET.has(normalizedModelId)
    || LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODEL_ID_SET.has(normalizedModelId)
  )
}

export function isLuminaAnthropicCompatibleVisionCapableModel(modelId: string): boolean {
  return LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODEL_ID_SET.has(
    normalizeLuminaAnthropicCompatibleModelId(modelId),
  )
}

const LEGACY_LUMINA_MODEL_ID_MAP: Record<string, string> = {
  'deepseek-v4-flash[1M]': 'deepseek-v4-flash',
  'deepseek-v4-flash-openai': 'deepseek-v4-flash',
  'deepseek-v4-flash-anthropic': 'deepseek-v4-flash',
  'deepseek-v4-pro-openai': 'deepseek-v4-pro',
  'deepseek-v4-pro-anthropic': 'deepseek-v4-pro',
}

export function normalizeLuminaAnthropicCompatibleModelId(modelId: string): string {
  return LEGACY_LUMINA_MODEL_ID_MAP[modelId] || modelId
}

export function getLuminaAnthropicCompatibleModelName(modelId: string): string | null {
  return LUMINA_ANTHROPIC_COMPATIBLE_MODEL_NAME_BY_ID.get(
    normalizeLuminaAnthropicCompatibleModelId(modelId),
  ) || null
}
