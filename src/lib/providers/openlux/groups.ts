export type OpenLuxKeyGroup = 'default' | 'aistudio-gemini-3' | 'self-deployed' | 'claude'

export type OpenLuxTextKeyGroup = Exclude<OpenLuxKeyGroup, 'default'>

export interface OpenLuxKeyGroupSpec {
  id: OpenLuxTextKeyGroup
  label: string
  description: string
  envKey: string
  models: readonly string[]
}

export const OPENLUX_TEXT_KEY_GROUPS: readonly OpenLuxKeyGroupSpec[] = [
  {
    id: 'aistudio-gemini-3',
    label: 'Aistudio-Gemini-3 分组 Key',
    description: '用于 Gemini 3.8 Flash（留空则沿用 OpenLux 主 Key）',
    envKey: 'OPENLUX_GEMINI_API_KEY',
    models: ['gemini-3.8-flash'],
  },
  {
    id: 'self-deployed',
    label: 'Self-Deployed 分组 Key',
    description: '用于 DeepSeek V4.1 Flash / DeepSeek V4 Pro / Qwen 3.8 Max / Kimi K2.6（留空则沿用主 Key）',
    envKey: 'OPENLUX_SELF_DEPLOYED_API_KEY',
    models: ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'qwen3.8-max', 'kimi-k2.6'],
  },
  {
    id: 'claude',
    label: 'Claude 分组 Key',
    description: '用于 Claude Sonnet 5（Claude-Code / Kiro-Claude 组；留空则沿用主 Key）',
    envKey: 'OPENLUX_CLAUDE_API_KEY',
    models: ['claude-sonnet-5'],
  },
] as const

export const OPENLUX_TEXT_KEY_GROUP_IDS: readonly OpenLuxTextKeyGroup[] = OPENLUX_TEXT_KEY_GROUPS.map((g) => g.id)

export function isOpenLuxTextKeyGroup(value: string): value is OpenLuxTextKeyGroup {
  return OPENLUX_TEXT_KEY_GROUP_IDS.includes(value as OpenLuxTextKeyGroup)
}

export function resolveOpenLuxKeyGroupForModel(modelId?: string | null): OpenLuxKeyGroup {
  const normalized = typeof modelId === 'string' ? modelId.trim().toLowerCase() : ''
  if (!normalized) return 'default'
  if (normalized.startsWith('gemini-')) return 'aistudio-gemini-3'
  if (normalized.startsWith('claude-')) return 'claude'
  if (
    normalized.startsWith('deepseek-')
    || normalized.startsWith('qwen')
    || normalized.startsWith('kimi-')
  ) {
    return 'self-deployed'
  }
  return 'default'
}

export function resolveOpenLuxKeyFromMap(input: {
  apiKey?: string | null
  groupApiKeys?: Readonly<Record<string, string | undefined>> | null
  modelId?: string | null
}): string {
  const group = resolveOpenLuxKeyGroupForModel(input.modelId)
  if (group !== 'default') {
    const groupKey = typeof input.groupApiKeys?.[group] === 'string' ? input.groupApiKeys[group]!.trim() : ''
    if (groupKey) return groupKey
  }
  return typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
}
