export type ProviderUsageTypeRow = {
  serviceType: string
  calls: number
  cost: number
  units: number
}

export type ProviderUsageSummary = {
  provider: string
  calls: number
  success: number
  failed: number
  cost: number
  byType: ProviderUsageTypeRow[]
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** 按上游服务商汇总用量行，供管理页对着各家后台账单核对成本。 */
export function summarizeUsageRowsByProvider(
  rows: Array<{
    provider: string
    serviceType: string
    calls: number
    success: number
    failed: number
    cost: number
    units: number
  }>,
): ProviderUsageSummary[] {
  const grouped = new Map<string, ProviderUsageSummary>()
  for (const row of rows) {
    const entry = grouped.get(row.provider) || {
      provider: row.provider,
      calls: 0,
      success: 0,
      failed: 0,
      cost: 0,
      byType: [],
    }
    entry.calls += row.calls
    entry.success += row.success
    entry.failed += row.failed
    entry.cost += row.cost
    const typeRow = entry.byType.find((item) => item.serviceType === row.serviceType)
    if (typeRow) {
      typeRow.calls += row.calls
      typeRow.cost += row.cost
      typeRow.units += row.units
    } else {
      entry.byType.push({ serviceType: row.serviceType, calls: row.calls, cost: row.cost, units: row.units })
    }
    grouped.set(row.provider, entry)
  }
  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      cost: roundCost(entry.cost),
      byType: entry.byType
        .map((item) => ({ ...item, cost: roundCost(item.cost) }))
        .sort((left, right) => right.cost - left.cost),
    }))
    .sort((left, right) => right.cost - left.cost)
}
