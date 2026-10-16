import { cnyToPoints, GENERATION_CREDIT_FLOOR_CNY } from './credit-policy'

export class InsufficientBalanceError extends Error {
  public available: number
  public required: number

  constructor(required: number, available: number) {
    super(available <= GENERATION_CREDIT_FLOOR_CNY
      ? `积分已达到生成下限（当前 ${cnyToPoints(available).toFixed(2)} 积分），请补充积分后再生成`
      : `积分不足，本次需要 ${cnyToPoints(required).toFixed(2)} 积分，当前剩余 ${cnyToPoints(available).toFixed(2)} 积分`)
    this.name = 'InsufficientBalanceError'
    this.required = required
    this.available = available
  }
}

function formatLimitPoints(value: number) {
  return Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(2)
}

/**
 * 管理账号为该用户设置的每日用量上限已用尽。
 * 上限按上海自然日重置，因此这里提示的是「明日再试」而不是补充积分。
 */
export class DailyLimitExceededError extends Error {
  public readonly limitPoints: number
  public readonly usedPoints: number
  public readonly requestedPoints: number
  public readonly windowEnd: string | null

  constructor(params: {
    limitPoints: number
    usedPoints: number
    requestedPoints?: number
    windowEnd?: string | null
  }) {
    const requestedPoints = params.requestedPoints && params.requestedPoints > 0 ? params.requestedPoints : 0
    const limitText = formatLimitPoints(params.limitPoints)
    const usedText = formatLimitPoints(params.usedPoints)
    super(params.limitPoints === 0
      ? '管理账号已禁止该账号生成（每日上限为 0），请联系管理账号调整为正数或 unlimited'
      : requestedPoints > 0
      ? `今日用量已达上限（已用 ${usedText} / 上限 ${limitText} 积分），本次还需要 ${formatLimitPoints(requestedPoints)} 积分，请明日再试或联系管理账号调整上限`
      : `今日用量已达上限（已用 ${usedText} / 上限 ${limitText} 积分），请明日再试或联系管理账号调整上限`)
    this.name = 'DailyLimitExceededError'
    this.limitPoints = params.limitPoints
    this.usedPoints = params.usedPoints
    this.requestedPoints = requestedPoints
    this.windowEnd = params.windowEnd ?? null
  }
}

export type BillingOperationErrorCode =
  | 'BILLING_CONFIRM_FAILED'
  | 'BILLING_INVALID_FREEZE'
  | 'BILLING_INVALID_API_TYPE'
  | 'BILLING_FREEZE_NOT_PENDING'
  | 'BILLING_INVALID_CHARGED_AMOUNT'
  | 'BILLING_INVALID_DELTA'
  | 'BILLING_FREEZE_EXPAND_FAILED'
  | 'BILLING_UNKNOWN_MODEL'
  | 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION'
  | 'BILLING_UNKNOWN_VIDEO_RESOLUTION'
  | 'BILLING_CAPABILITY_PRICE_NOT_FOUND'
  | 'BILLING_PRICING_MODEL_AMBIGUOUS'
  | 'BILLING_IDEMPOTENT_ALREADY_CONFIRMED'
  | 'BILLING_IDEMPOTENT_IN_PROGRESS'
  | 'BILLING_IDEMPOTENT_ROLLED_BACK'
  | 'BILLING_INVALID_PROJECT'

export class BillingOperationError extends Error {
  public readonly code: BillingOperationErrorCode
  public readonly details?: Record<string, unknown>
  public readonly cause?: unknown

  constructor(
    code: BillingOperationErrorCode,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'BillingOperationError'
    this.code = code
    this.details = details
    this.cause = cause
  }
}
