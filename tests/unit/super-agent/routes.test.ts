import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../integration/api/helpers/call-route'

const requireUserAuthMock = vi.hoisted(() => vi.fn(async () => ({
  session: {
    user: { id: 'route-user-1' },
  },
})))
const requireProjectAuthLightMock = vi.hoisted(() => vi.fn(async () => ({
  session: {
    user: { id: 'route-user-1' },
  },
  project: { id: 'project-1', userId: 'route-user-1' },
})))
const applyAgentChatEditMock = vi.hoisted(() => vi.fn(async () => ({
  runId: 'run-chat-edit-1',
  summary: 'ok',
})))

vi.mock('@/lib/api-auth', async () => {
  const { NextResponse } = await import('next/server')
  return {
    isErrorResponse: (value: unknown) => value instanceof NextResponse,
    requireUserAuth: requireUserAuthMock,
    requireProjectAuthLight: requireProjectAuthLightMock,
  }
})

vi.mock('@/lib/super-agent/chat-edit', () => ({
  applyAgentChatEdit: applyAgentChatEditMock,
}))

describe('super-agent routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
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

  it('hides plan, skills and chat-edit APIs unless server-side internal tools are enabled', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    const planRoute = await import('@/app/api/super-agent/plan/route')
    const skillsRoute = await import('@/app/api/super-agent/skills/route')
    const chatEditRoute = await import('@/app/api/super-agent/chat-edit/route')

    const planResponse = await callRoute(planRoute.POST, 'POST', {
      userInput: '制作一个商品宣传短片',
      locale: 'zh',
    })
    const skillsResponse = await callRoute(skillsRoute.GET, 'GET')
    const chatEditResponse = await callRoute(chatEditRoute.POST, 'POST', {
      projectId: 'project-1',
      episodeId: 'episode-1',
      instruction: '重写第一镜',
    })

    expect(planResponse.status).toBe(404)
    expect(skillsResponse.status).toBe(404)
    expect(chatEditResponse.status).toBe(404)
    expect(requireUserAuthMock).not.toHaveBeenCalled()
    expect(requireProjectAuthLightMock).not.toHaveBeenCalled()
    expect(applyAgentChatEditMock).not.toHaveBeenCalled()
  })

  it('returns skills when server-side internal tools are enabled', async () => {
    const mod = await import('@/app/api/super-agent/skills/route')
    const response = await callRoute(mod.GET, 'GET')
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(Array.isArray(payload.skills)).toBe(true)
    expect(requireUserAuthMock).toHaveBeenCalledTimes(1)
  })
})
