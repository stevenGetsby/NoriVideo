import { parseModelKeyStrict, type UnifiedModelType } from '@/lib/model-config-contract'
import { findNoriBusinessModel } from '@/lib/nori-model-catalog'
import type { PlatformServiceConfigResponse } from './config'

export type CachedProviderHealth = {
  targetType: string
  targetId: string
  status: string
  message?: string | null
  checkedAt?: string | Date
}

export type ConfiguredModelAvailability = {
  configured: boolean
  available: boolean
  runtimeModelKey: string | null
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
  healthMessage: string | null
  healthCheckedAt: string | null
  unavailableReason: string | null
}

const MODEL_HEALTH_FRESH_MS = 15 * 60 * 1000

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function checkedAt(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

/**
 * Resolve generation availability from the administrator-owned service config
 * and the latest persisted health probe. This is intentionally read-only: a
 * creative-surface request must never trigger a paid or high-latency probe.
 */
export function resolveConfiguredModelAvailability(input: {
  modelKey: string
  type: Extract<UnifiedModelType, 'llm' | 'image' | 'video' | 'audio'>
  config: PlatformServiceConfigResponse
  health: readonly CachedProviderHealth[]
  now?: Date
}): ConfiguredModelAvailability {
  const businessModel = findNoriBusinessModel(input.modelKey)
  const runtimeModelKey = businessModel
    ? compact(input.config.modelRouting[businessModel.key])
    : parseModelKeyStrict(input.modelKey)?.modelKey || ''
  if (!runtimeModelKey) {
    return {
      configured: false,
      available: false,
      runtimeModelKey: null,
      healthStatus: 'unknown',
      healthMessage: null,
      healthCheckedAt: null,
      unavailableReason: '管理员尚未为该模型配置运行模型。',
    }
  }

  const runtime = parseModelKeyStrict(runtimeModelKey)
  const configuredModel = runtime
    ? input.config.models.find((model) => (
        model.provider === runtime.provider
        && model.modelId === runtime.modelId
        && model.type === input.type
      ))
    : null
  if (!runtime || !configuredModel) {
    return {
      configured: false,
      available: false,
      runtimeModelKey,
      healthStatus: 'unknown',
      healthMessage: null,
      healthCheckedAt: null,
      unavailableReason: '模型路由未指向一个已配置的同类型模型。',
    }
  }

  const provider = input.config.providers.find((item) => item.id === runtime.provider)
  if (!provider?.hasApiKey) {
    return {
      configured: false,
      available: false,
      runtimeModelKey,
      healthStatus: 'unknown',
      healthMessage: null,
      healthCheckedAt: null,
      unavailableReason: `服务 ${provider?.name || runtime.provider} 尚未配置有效 API Key。`,
    }
  }

  const latestHealth = input.health.find((item) => (
    item.targetType === 'provider' && item.targetId === runtime.provider
  ))
  const healthCheckedAt = checkedAt(latestHealth?.checkedAt)
  const checkedTime = healthCheckedAt ? new Date(healthCheckedAt).getTime() : Number.NaN
  const nowTime = (input.now || new Date()).getTime()
  const configTime = input.config.updatedAt ? new Date(input.config.updatedAt).getTime() : Number.NaN
  const freshByAge = Number.isFinite(checkedTime)
    && checkedTime <= nowTime + 60_000
    && nowTime - checkedTime <= MODEL_HEALTH_FRESH_MS
  const freshForConfig = !Number.isFinite(configTime) || checkedTime >= configTime
  const healthIsFresh = freshByAge && freshForConfig
  const healthStatus = healthIsFresh && latestHealth?.status === 'healthy'
    ? 'healthy'
    : healthIsFresh && latestHealth?.status === 'unhealthy'
      ? 'unhealthy'
      : 'unknown'
  const cachedMessage = compact(latestHealth?.message)
  const healthMessage = !healthIsFresh && latestHealth
    ? `上次检测结果已过期${cachedMessage ? `：${cachedMessage}` : ''}`
    : cachedMessage || null
  if (healthStatus === 'unhealthy') {
    return {
      configured: true,
      available: false,
      runtimeModelKey,
      healthStatus,
      healthMessage,
      healthCheckedAt,
      unavailableReason: healthMessage || `服务 ${provider.name} 最近一次健康检测失败。`,
    }
  }

  return {
    configured: true,
    available: true,
    runtimeModelKey,
    healthStatus,
    healthMessage,
    healthCheckedAt,
    unavailableReason: null,
  }
}
