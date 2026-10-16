import { ApiError } from '@/lib/api-errors'
import { canStartGeneration, cnyToPoints } from './credit-policy'
import { assertDailyLimit } from './daily-limit'
import { DailyLimitExceededError } from './errors'
import { getBalance } from './ledger'

/**
 * Hard preflight for generation paths that do not yet have a priced freeze.
 * Priced task/synchronous billing still performs its stricter atomic reserve,
 * so passing this check never substitutes for reserving the full quote.
 */
export async function requireGenerationCredit(userId: string) {
  const credit = await getBalance(userId)
  if (!canStartGeneration(credit.balance)) {
    const availablePoints = cnyToPoints(credit.balance)
    throw new ApiError('INSUFFICIENT_BALANCE', {
      message: `积分不足（当前 ${availablePoints.toFixed(2)} 积分），所有生成服务已暂停`,
      required: 0,
      available: availablePoints,
    })
  }

  // 管理账号配置的每日用量上限与余额无关：余额充足但今日额度用尽时同样拦截。
  try {
    await assertDailyLimit(userId)
  } catch (error) {
    if (error instanceof DailyLimitExceededError) {
      throw new ApiError('DAILY_LIMIT_EXCEEDED', {
        message: error.message,
        limitPoints: error.limitPoints,
        usedPoints: error.usedPoints,
        requestedPoints: error.requestedPoints,
        resetsAt: error.windowEnd,
      })
    }
    throw error
  }

  return credit
}
