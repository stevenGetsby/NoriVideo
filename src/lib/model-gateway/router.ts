import { getProviderKey } from '@/lib/api-config'
import { isHfsyProviderId } from '@/lib/model-provider-contract'
import type { ModelGatewayRoute } from './types'

const COMPATIBLE_PROVIDER_KEYS = new Set([
  'openai-compatible',
  'hfsy',
])
const OFFICIAL_ONLY_PROVIDER_KEYS = new Set([
  'bailian',
  'siliconflow',
])

export function isCompatibleProvider(providerId: string): boolean {
  if (isHfsyProviderId(providerId)) return true
  const providerKey = getProviderKey(providerId).toLowerCase()
  return COMPATIBLE_PROVIDER_KEYS.has(providerKey)
}

export function resolveModelGatewayRoute(providerId: string): ModelGatewayRoute {
  const providerKey = getProviderKey(providerId).toLowerCase()
  if (OFFICIAL_ONLY_PROVIDER_KEYS.has(providerKey)) return 'official'
  return isCompatibleProvider(providerId) ? 'openai-compat' : 'official'
}
