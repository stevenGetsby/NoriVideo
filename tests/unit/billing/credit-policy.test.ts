import { describe, expect, it } from 'vitest'
import {
  GENERATION_CREDIT_FLOOR_CNY,
  GENERATION_CREDIT_FLOOR_POINTS,
  POINTS_PER_CNY,
  canStartGeneration,
  cnyToPoints,
  pointsToCny,
} from '@/lib/billing/credit-policy'

describe('generation credit policy', () => {
  it('allows generation only while the account has positive points', () => {
    expect(canStartGeneration(0)).toBe(false)
    expect(canStartGeneration(GENERATION_CREDIT_FLOOR_CNY + 0.000001)).toBe(true)
    expect(canStartGeneration(GENERATION_CREDIT_FLOOR_CNY)).toBe(false)
  })

  it('blocks every new generation at or below zero points', () => {
    expect(canStartGeneration(GENERATION_CREDIT_FLOOR_CNY - 0.000001)).toBe(false)
    expect(canStartGeneration(Number.NaN)).toBe(false)
  })

  it('uses 100 points per CNY without changing wallet cost units', () => {
    expect(POINTS_PER_CNY).toBe(100)
    expect(GENERATION_CREDIT_FLOOR_POINTS).toBe(0)
    expect(GENERATION_CREDIT_FLOOR_CNY).toBe(0)
    expect(cnyToPoints(12.345678)).toBe(1234.5678)
    expect(pointsToCny(1234)).toBe(12.34)
  })
})
