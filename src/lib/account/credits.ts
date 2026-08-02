export const MAX_ACCOUNT_CREDITS = 2_000_000_000
// Generation is prepaid and may never settle below the zero-point gate, so display
// normalization must preserve the resulting negative balance.
export const MIN_ACCOUNT_POINT_CREDITS = -MAX_ACCOUNT_CREDITS

export interface AccountCredits {
  coins: number
  points: number
}

export const ZERO_ACCOUNT_CREDITS: AccountCredits = Object.freeze({
  coins: 0,
  points: 0,
})

export function isAccountCredit(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_ACCOUNT_CREDITS
}

export function normalizeAccountCredit(value: unknown): number {
  return isAccountCredit(value) ? value : 0
}

export function isAccountPointCredit(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_ACCOUNT_POINT_CREDITS
    && value <= MAX_ACCOUNT_CREDITS
}

export function normalizeAccountPointCredit(value: unknown): number {
  const numeric = Number(value)
  if (!isAccountPointCredit(numeric)) return 0
  return Math.round(numeric * 10_000) / 10_000
}
