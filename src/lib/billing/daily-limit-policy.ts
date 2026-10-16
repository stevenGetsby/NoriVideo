export const MAX_DAILY_POINT_LIMIT = 100_000_000

/** null is the persisted representation of the explicit "unlimited" mode. */
export function normalizeDailyPointLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === 'unlimited') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= MAX_DAILY_POINT_LIMIT ? numeric : null
}

export function isValidDailyPointLimitInput(value: unknown): boolean {
  if (value === null || value === undefined || value === 'unlimited') return true
  return normalizeDailyPointLimit(value) !== null
}

export function dailyLimitSaveMessage(limit: number | null) {
  return limit === null
    ? '已保存：unlimited（不限量）。今日已用积分保留。'
    : limit === 0
      ? '已保存：上限 0，已禁止该账号发起生成任务。'
      : `已保存：每日上限 ${limit} 积分。`
}
