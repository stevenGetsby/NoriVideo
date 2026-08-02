import { describe, expect, it } from 'vitest'
import {
  isAccountCredit,
  MAX_ACCOUNT_CREDITS,
  normalizeAccountCredit,
  ZERO_ACCOUNT_CREDITS,
} from '@/lib/account/credits'

describe('account credits', () => {
  it('uses zero for both new account credit types', () => {
    expect(ZERO_ACCOUNT_CREDITS).toEqual({ coins: 0, points: 0 })
  })

  it('accepts only bounded non-negative integers', () => {
    expect(isAccountCredit(0)).toBe(true)
    expect(isAccountCredit(MAX_ACCOUNT_CREDITS)).toBe(true)
    expect(isAccountCredit(-1)).toBe(false)
    expect(isAccountCredit(1.5)).toBe(false)
    expect(isAccountCredit(MAX_ACCOUNT_CREDITS + 1)).toBe(false)
  })

  it('normalizes missing or invalid persisted values to zero', () => {
    expect(normalizeAccountCredit(undefined)).toBe(0)
    expect(normalizeAccountCredit(Number.NaN)).toBe(0)
    expect(normalizeAccountCredit(25)).toBe(25)
  })
})
