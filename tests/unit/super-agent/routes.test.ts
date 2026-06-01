import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../integration/api/helpers/call-route'

vi.mock('@/lib/api-auth', async () => {
  const { NextResponse } = await import('next/server')
  return {
    isErrorResponse: (value: unknown) => value instanceof NextResponse,
    requireUserAuth: vi.fn(async () => ({
      session: {
        user: { id: 'route-user-1' },
      },
    })),
  }
})

describe('super-agent routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('plans a mock intelligent creation flow with visible parameters', async () => {
    const mod = await import('@/app/api/super-agent/plan/route')
    const response = await callRoute(mod.POST, 'POST', {
      userInput: '制作一个16:9智能手表商品宣传短片',
      locale: 'zh',
      executionMode: 'mock',
      parameters: {
        durationSeconds: 45,
        shotCount: 4,
        panelsPerShot: 2,
        targetAudience: '年轻用户',
        tone: '清晰、有活力',
        sellingPoints: '长续航、健康监测、防水',
        callToAction: '立即了解新品',
        mockPrompt: 'route mock prompt',
      },
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.plan.executionMode).toBe('mock')
    expect(payload.plan.projectConfig.videoRatio).toBe('16:9')
    expect(payload.plan.selectedSkill).toBe('product-promo')
    expect(payload.plan.creativeParameters).toMatchObject({
      durationSeconds: 45,
      shotCount: 4,
      panelsPerShot: 2,
      targetAudience: '年轻用户',
      mockPrompt: 'route mock prompt',
    })
  })
})
