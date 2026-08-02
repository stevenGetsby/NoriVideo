/**
 * Wallet amounts are persisted in CNY. Product-facing balances are points.
 * Keeping the conversion here avoids mixing points into model price math.
 */
export const POINTS_PER_CNY = 100
export const CNY_PER_POINT = 1 / POINTS_PER_CNY
// Generation is prepaid. A task may start only while the wallet is positive,
// and every priced call must be fully reservable before contacting a provider.
export const GENERATION_CREDIT_FLOOR_POINTS = 0
export const GENERATION_CREDIT_FLOOR_CNY = GENERATION_CREDIT_FLOOR_POINTS * CNY_PER_POINT

/** @deprecated Prefer GENERATION_CREDIT_FLOOR_CNY when comparing wallet values. */
export const GENERATION_CREDIT_FLOOR = GENERATION_CREDIT_FLOOR_CNY

export function cnyToPoints(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * POINTS_PER_CNY * 10_000) / 10_000
}

export function pointsToCny(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * CNY_PER_POINT * 1_000_000) / 1_000_000
}

export function canStartGeneration(balance: number): boolean {
  // At the exact floor there is no remaining generation credit. Using a
  // strict comparison also blocks unpriced/new task types at the same hard
  // gate instead of letting them bypass a zero-cost quote.
  return Number.isFinite(balance) && balance > GENERATION_CREDIT_FLOOR_CNY
}
