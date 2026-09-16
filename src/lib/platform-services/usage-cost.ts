import { calcImage, calcText, calcVideoByDuration, calcVideoByTokens, calcVoice, isSeedance2TokenPricedModel } from '@/lib/billing/cost'

export interface UsageCostRecord {
  modelKey: string | null
  serviceType: string
  operation: string
  status: string
  inputTokens: number
  outputTokens: number
  units: number | { toString(): string }
  metadata?: unknown
}

export function calculateUsageCost(record: UsageCostRecord): number {
  if (record.status === 'failed' || !record.modelKey) return 0
  try {
    if (record.serviceType === 'llm' || record.serviceType === 'video-repaint') {
      return calcText(record.modelKey, record.inputTokens, record.outputTokens)
    }
    if (record.serviceType === 'video') {
      const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown> : {}
      if (isSeedance2TokenPricedModel(record.modelKey) && record.outputTokens > 0) {
        return calcVideoByTokens(record.modelKey, record.outputTokens, {
          ...metadata,
          containsVideoInput: record.operation.endsWith(':video-input'),
        })
      }
      const duration = Number(record.units)
      if (duration > 0) {
        const resolution = typeof metadata.resolution === 'string' ? metadata.resolution : '720p'
        return calcVideoByDuration(record.modelKey, duration, resolution, 1, metadata)
      }
      return 0
    }
    if (record.serviceType === 'image' && Number(record.units) > 0) {
      return calcImage(record.modelKey, Number(record.units))
    }
    if (record.serviceType === 'audio' && Number(record.units) > 0) {
      return calcVoice(Number(record.units), record.modelKey)
    }
  } catch {
    // Custom/代理别名没有经过管理员定价时保持 0，避免伪造成本。
  }
  return 0
}
