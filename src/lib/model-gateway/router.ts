import { getProviderKey } from '@/lib/api-config'
import type { ModelGatewayRoute } from './types'

export function isCompatibleProvider(providerId: string): boolean {
  return getProviderKey(providerId).toLowerCase() === 'openlux'
}

export function resolveModelGatewayRoute(providerId: string): ModelGatewayRoute {
  return isCompatibleProvider(providerId) ? 'openai-compat' : 'official'
}
