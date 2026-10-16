import type { DailyUsagePayload } from './daily-limit'

/** A changed limit must never erase the usage ledger already shown today. */
export function updateDailyUsageLimit(usage: DailyUsagePayload | null | undefined, value: number | null) {
  if (!usage) return usage
  const limitPoints = value !== null && value >= 0 ? value : null
  return {
    ...usage,
    limitPoints,
    remainingPoints: limitPoints === null ? null : Math.max(0, limitPoints - usage.usedPoints),
    exceeded: limitPoints !== null && usage.usedPoints + 1e-6 >= limitPoints,
  }
}
