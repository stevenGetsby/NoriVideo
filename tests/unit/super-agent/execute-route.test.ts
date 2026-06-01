import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../integration/api/helpers/call-route'

const executePlanMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', async () => {
  const { NextResponse } = await import('next/server')
  return {
    isErrorResponse: (value: unknown) => value instanceof NextResponse,
    requireUserAuth: vi.fn(async () => ({
      session: {
        user: { id: 'execute-user-1' },
      },
    })),
  }
})

vi.mock('@/lib/super-agent/orchestrator', () => ({
  SuperAgentOrchestrator: vi.fn(() => ({
    executePlan: executePlanMock,
  })),
}))

describe('super-agent execute route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executePlanMock.mockResolvedValue({
      executionId: 'exec-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      status: 'completed',
      stageResults: {
        stage1: { projectId: 'project-1', episodeId: 'episode-1', hasStory: true },
      },
      workspaceUrl: '/zh/workspace/project-1?episode=episode-1',
      summary: 'ok',
      errors: [],
    })
  })

  it('normalizes execution mode and missing creative parameters before execution', async () => {
    const mod = await import('@/app/api/super-agent/execute/route')
    const response = await callRoute(mod.POST, 'POST', {
      userInput: '制作一个商品短片',
      locale: 'zh',
      plan: {
        projectConfig: {
          name: '旧计划',
          videoRatio: '9:16',
          artStyle: 'realistic',
        },
        episodeConfig: {
          name: '第1集',
          novelText: '旧计划文本',
        },
        selectedSkill: 'generic',
        skillDescription: '通用视频制作',
        stages: [],
        estimatedDuration: 1,
      },
    })

    expect(response.status).toBe(200)
    expect(executePlanMock).toHaveBeenCalledTimes(1)
    const [planArg, contextArg] = executePlanMock.mock.calls[0]
    expect(planArg.executionMode).toBe('mock')
    expect(planArg.creativeParameters).toMatchObject({
      durationSeconds: 30,
      shotCount: 3,
      panelsPerShot: 3,
      narration: 'auto',
    })
    expect(contextArg).toMatchObject({
      userId: 'execute-user-1',
      locale: 'zh',
      userInput: '制作一个商品短片',
    })
  })
})
