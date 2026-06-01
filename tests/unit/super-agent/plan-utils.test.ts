import { describe, expect, it } from 'vitest'
import {
  createDeterministicAnalysis,
  normalizeCreativeParameters,
  normalizeExecutionMode,
} from '@/lib/super-agent/plan-utils'

describe('super-agent plan utils', () => {
  it('defaults to mock mode unless live is explicitly requested', () => {
    expect(normalizeExecutionMode(undefined)).toBe('mock')
    expect(normalizeExecutionMode('mock')).toBe('mock')
    expect(normalizeExecutionMode('live')).toBe('live')
  })

  it('normalizes optional creative parameters with bounded numbers', () => {
    const params = normalizeCreativeParameters({
      durationSeconds: 999,
      shotCount: 0,
      panelsPerShot: 99,
      targetAudience: ' 创作者 ',
      narration: 'on',
    })

    expect(params.durationSeconds).toBe(300)
    expect(params.shotCount).toBe(1)
    expect(params.panelsPerShot).toBe(8)
    expect(params.targetAudience).toBe('创作者')
    expect(params.narration).toBe('on')
    expect(params.mockPrompt).toContain('Mock prompt')
  })

  it('creates deterministic mock analysis without external model calls', () => {
    const analysis = createDeterministicAnalysis('制作一个16:9的智能手表商品宣传短片')

    expect(analysis.videoType).toBe('product-promo')
    expect(analysis.videoRatio).toBe('16:9')
    expect(analysis.projectName).toContain('智能手表')
    expect(analysis.confidence).toBe(1)
  })
})
