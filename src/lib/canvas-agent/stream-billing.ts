import { ApiError } from '@/lib/api-errors'
import { DailyLimitExceededError, InsufficientBalanceError } from '@/lib/billing/errors'
import { prepareStreamingTextBilling, rollbackStreamingTextBilling, settleStreamingTextBilling } from '@/lib/billing/service'
import { recordServiceUsage } from '@/lib/platform-services/usage'

export async function prepareCanvasAgentStreamBilling(input: {
  userId: string
  projectId: string
  canvasId: string
  threadId: string
  turnIndex: number
  modelKey: string
  providerId: string
  maxInputTokens: number
}) {
  const { userId, projectId, canvasId, threadId, turnIndex, modelKey, providerId, maxInputTokens } = input
  const prepared = await prepareStreamingTextBilling({
    userId, projectId, action: 'canvas_agent', model: modelKey,
    maxInputTokens, maxOutputTokens: 4096 * 4,
    metadata: { canvasId, threadId, turnIndex },
  }).catch((error: unknown) => {
    if (error instanceof InsufficientBalanceError) throw new ApiError('INSUFFICIENT_BALANCE', { message: error.message })
    if (error instanceof DailyLimitExceededError) throw new ApiError('RATE_LIMIT', { code: 'DAILY_LIMIT', message: error.message })
    throw error
  })
  const start = Date.now()
  let finalization: Promise<void> | undefined
  const usage = () => ({ provider: providerId, modelKey, serviceType: 'llm' as const, operation: 'canvas_agent', userId, projectId, latencyMs: Date.now() - start })
  const rollback = async (errorCode: string) => {
    await rollbackStreamingTextBilling(prepared)
    await recordServiceUsage({ ...usage(), status: 'failed', errorCode })
  }
  return {
    settle(totalUsage: { inputTokens?: number; outputTokens?: number }) {
      return finalization ??= Promise.resolve().then(async () => {
        const inputTokens = totalUsage.inputTokens ?? 0
        const outputTokens = totalUsage.outputTokens ?? 0
        try {
          await settleStreamingTextBilling(prepared, { model: modelKey, inputTokens, outputTokens })
        } catch (error) {
          await rollback('CANVAS_AGENT_BILLING_FAILED')
          throw error
        }
        await recordServiceUsage({ ...usage(), inputTokens, outputTokens })
      })
    },
    rollback(errorCode: string) {
      return finalization ??= Promise.resolve().then(() => rollback(errorCode))
    },
  }
}
