import { ApiError } from '@/lib/api-errors'
import { canStartGeneration, cnyToPoints } from './credit-policy'
import { getBalance } from './ledger'

/**
 * Hard preflight for generation paths that do not yet have a priced freeze.
 * Priced task/synchronous billing still performs its stricter atomic reserve,
 * so passing this check never substitutes for reserving the full quote.
 */
export async function requireGenerationCredit(userId: string) {
  const credit = await getBalance(userId)
  if (canStartGeneration(credit.balance)) return credit
  const availablePoints = cnyToPoints(credit.balance)
  throw new ApiError('INSUFFICIENT_BALANCE', {
    message: `积分不足（当前 ${availablePoints.toFixed(2)} 积分），所有生成服务已暂停`,
    required: 0,
    available: availablePoints,
  })
}
