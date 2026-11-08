import { parseModelKeyStrict } from '@/lib/model-config-contract'

export function publicHistoryModelId(modelKey: string | null | undefined): string | null {
  const requested = typeof modelKey === 'string' ? modelKey.trim() : ''
  if (!requested || requested.split('::')[0] === 'nori') return null
  return parseModelKeyStrict(requested)?.modelId || null
}
