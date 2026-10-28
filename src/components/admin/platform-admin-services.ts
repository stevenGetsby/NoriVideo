export type ModelType = 'llm' | 'image' | 'video' | 'audio' | 'lipsync'
export type DefaultField = 'analysisModel' | 'characterModel' | 'locationModel' | 'storyboardModel' | 'editModel' | 'videoModel' | 'audioModel' | 'lipSyncModel'

export interface BusinessModelDraft {
  key: string
  name: string
  description: string
  type: 'llm' | 'image' | 'video' | 'audio'
  tier: 'mini' | 'fast' | 'standard' | 'pro'
}

export interface ProviderDraft {
  id: string
  name: string
  baseUrl?: string
  assetGroupId?: string
  gatewayRoute?: 'official' | 'openai-compat'
  apiMode?: 'gemini-sdk' | 'openai-official'
  hasApiKey: boolean
}

export interface ModelDraft {
  modelId: string
  modelKey?: string
  name?: string
  type: ModelType
  provider: string
  llmProtocol?: 'responses' | 'chat-completions'
}

export interface ServiceConfig {
  sourceFile: string
  updatedAt: string | null
  providers: ProviderDraft[]
  models: ModelDraft[]
  defaultModels: Partial<Record<DefaultField, string>>
  businessModels: BusinessModelDraft[]
  modelRouting: Record<string, string>
  storage: {
    type: 'tos'
    endpoint: string
    publicEndpoint: string
    region: string
    bucket: string
    forcePathStyle: boolean
    hasAccessKey: boolean
    hasSecretKey: boolean
  }
  videoRepaint: {
    providerId: string
    understandingModel: string
    adaptationModel: string
    fps: number
  }
}

export interface HealthRow {
  targetType: 'provider' | 'storage'
  targetId: string
  status: 'healthy' | 'unhealthy'
  latencyMs: number | null
  message: string | null
  checkedAt: string
}

export interface UsageRow {
  provider: string
  modelKey: string | null
  serviceType: string
  operation: string
  calls: number
  success: number
  failed: number
  inputTokens: number
  outputTokens: number
  units: number
  averageLatencyMs: number | null
  lastUsedAt: string
  cost: number
}

export interface UsageTypeAmount {
  type: string
  label: string
  calls: number
  cost: number
  lastUsedAt: string | null
}

export interface UsageOverview {
  rangeDays: number
  collectedSince: string
  summary: {
    calls: number
    success: number
    failed: number
    cost: number
    averageLatencyMs: number | null
    byType: UsageTypeAmount[]
  }
  rows: UsageRow[]
  storage: { objectCount: number; knownBytes: number }
}

export interface ServicesPayload {
  config: ServiceConfig
  health: HealthRow[]
  usage: UsageOverview
}

export interface ModelDiscoveryPayload {
  providerId: string
  availableCount: number
  models: ModelDraft[]
}

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  llm: '文本 LLM',
  image: '图片',
  video: '视频',
  audio: '语音',
  lipsync: '口型同步',
}

export const MODEL_TIER_LABELS: Record<BusinessModelDraft['tier'], string> = {
  mini: 'Mini',
  fast: 'Fast',
  standard: '标准',
  pro: 'Pro',
}

export const MODEL_TIER_TONES: Record<BusinessModelDraft['tier'], string> = {
  mini: 'border-white/[0.24] bg-white/[.08] text-neutral-200',
  fast: 'border-white/[0.24] bg-white/[.08] text-neutral-200',
  standard: 'border-white/[0.24] bg-white/[.08] text-neutral-200',
  pro: 'border-white/[0.24] bg-white/[.09] text-neutral-200',
}

export function modelKey(model: ModelDraft) {
  return `${model.provider}::${model.modelId}`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export function formatBytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

export function formatDate(value: string | null) {
  if (!value) return '尚未检测'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
  })
}

export function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
