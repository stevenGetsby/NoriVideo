const INTERNAL_TASK_PATTERN = /(?:^|[^A-Za-z0-9])(?:NORI_AGENT[\w-]*|super[_\s-]?agent[\w-]*)|自动创作模式/i

export function containsInternalRecordMarker(...values: Array<unknown>) {
  return values.some((value) => typeof value === 'string' && INTERNAL_TASK_PATTERN.test(value))
}

export function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function recordContainsInternalRecordMarker(value: Record<string, unknown> | null): boolean {
  if (!value) return false
  return Object.values(value).some((item) => {
    if (containsInternalRecordMarker(item)) return true
    if (Array.isArray(item)) {
      return item.some((entry) => {
        if (containsInternalRecordMarker(entry)) return true
        if (entry && typeof entry === 'object') {
          return recordContainsInternalRecordMarker(entry as Record<string, unknown>)
        }
        return false
      })
    }
    if (item && typeof item === 'object') {
      return recordContainsInternalRecordMarker(item as Record<string, unknown>)
    }
    return false
  })
}

export function isInternalUsageCostRecord(row: {
  action?: string | null
  apiType?: string | null
  model?: string | null
  metadata?: string | null
}) {
  return containsInternalRecordMarker(row.action, row.apiType, row.model, row.metadata)
    || recordContainsInternalRecordMarker(parseJsonRecord(row.metadata))
}

export function isInternalBalanceTransactionRecord(row: {
  taskType?: string | null
  description?: string | null
  billingMeta?: string | null
}) {
  return containsInternalRecordMarker(row.taskType, row.description, row.billingMeta)
    || recordContainsInternalRecordMarker(parseJsonRecord(row.billingMeta))
}
