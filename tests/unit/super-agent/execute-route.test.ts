import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../integration/api/helpers/call-route'

const executePlanMock = vi.hoisted(() => vi.fn())
const submitTaskMock = vi.hoisted(() => vi.fn())
const startAgentWorkflowRunMock = vi.hoisted(() => vi.fn())
const failAgentWorkflowRunMock = vi.hoisted(() => vi.fn())
const attachTaskToRunMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(),
  },
}))

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

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

vi.mock('@/lib/super-agent/workflow-store', () => ({
  startAgentWorkflowRun: startAgentWorkflowRunMock,
  failAgentWorkflowRun: failAgentWorkflowRunMock,
}))

vi.mock('@/lib/run-runtime/service', () => ({
  attachTaskToRun: attachTaskToRunMock,
}))

describe('super-agent execute route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-target-1' })
    submitTaskMock.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'task-super-agent-1',
      status: 'queued',
      deduped: false,
    })
    startAgentWorkflowRunMock.mockResolvedValue({ id: 'run-super-agent-1' })
    attachTaskToRunMock.mockResolvedValue({ id: 'run-super-agent-1' })
    failAgentWorkflowRunMock.mockResolvedValue(undefined)
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

  it('does not expose execution API unless server-side internal tools are enabled', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    const mod = await import('@/app/api/super-agent/execute/route')
    const response = await callRoute(mod.POST, 'POST', {
      userInput: '生成小兔子童话短片',
      locale: 'zh',
      plan: {
        projectConfig: { name: '月亮灯', videoRatio: '9:16', artStyle: '可爱童话风' },
        episodeConfig: { name: '第1集', novelText: '小兔子救萤火虫' },
        selectedSkill: 'generic',
        skillDescription: '通用视频制作',
        stages: [],
        estimatedDuration: 1,
      },
    })

    expect(response.status).toBe(404)
    expect(executePlanMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
    expect(startAgentWorkflowRunMock).not.toHaveBeenCalled()
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
      shotCount: 6,
      panelsPerShot: 3,
      narration: 'auto',
    })
    expect(contextArg).toMatchObject({
      userId: 'execute-user-1',
      locale: 'zh',
      userInput: '制作一个商品短片',
    })
  })

  it('enqueues background execution for workspace agent mode without waiting for final generation', async () => {
    const mod = await import('@/app/api/super-agent/execute/route')
    const response = await callRoute(mod.POST, 'POST', {
      userInput: '生成小兔子童话短片',
      locale: 'zh',
      targetProjectId: 'project-target-1',
      responseMode: 'background',
      executionMode: 'live',
      plan: {
        projectConfig: {
          name: '月亮灯',
          videoRatio: '9:16',
          artStyle: '可爱童话风',
        },
        episodeConfig: {
          name: '第1集',
          novelText: '小兔子救萤火虫',
        },
        selectedSkill: 'generic',
        skillDescription: '通用视频制作',
        creativeParameters: {
          durationSeconds: 30,
          shotCount: 5,
          panelsPerShot: 2,
          narration: 'auto',
        },
        stages: [],
        estimatedDuration: 1,
      },
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      async: true,
      status: 'accepted',
      targetProjectId: 'project-target-1',
      runId: 'run-super-agent-1',
      taskId: 'task-super-agent-1',
    })
    expect(executePlanMock).not.toHaveBeenCalled()
    expect(startAgentWorkflowRunMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-target-1',
      targetId: 'project-target-1',
      userInput: '生成小兔子童话短片',
    }))
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'super_agent_execute',
      projectId: 'project-target-1',
      targetType: 'project',
      targetId: 'project-target-1',
      payload: expect.objectContaining({
        userInput: '生成小兔子童话短片',
        targetProjectId: 'project-target-1',
        executionMode: 'live',
        runId: 'run-super-agent-1',
        meta: expect.objectContaining({
          runId: 'run-super-agent-1',
        }),
      }),
    }))
    const submitArg = submitTaskMock.mock.calls[0]?.[0] as { payload?: { plan?: { stages?: unknown[] } } } | undefined
    expect(submitArg?.payload?.plan?.stages).toHaveLength(7)
    expect(submitArg?.payload?.plan?.stages?.[0]).toMatchObject({
      stageId: 'stage_1',
      title: '项目初始化',
      status: 'pending',
    })
    expect(attachTaskToRunMock).toHaveBeenCalledWith('run-super-agent-1', 'task-super-agent-1')
  })

  it('marks the pre-created Agent run failed when background enqueue fails', async () => {
    submitTaskMock.mockRejectedValueOnce(new Error('queue unavailable'))

    const mod = await import('@/app/api/super-agent/execute/route')
    const response = await callRoute(mod.POST, 'POST', {
      userInput: '生成小兔子童话短片',
      locale: 'zh',
      targetProjectId: 'project-target-1',
      responseMode: 'background',
      executionMode: 'live',
      plan: {
        projectConfig: {
          name: '月亮灯',
          videoRatio: '9:16',
          artStyle: '可爱童话风',
        },
        episodeConfig: {
          name: '第1集',
          novelText: '小兔子救萤火虫',
        },
        selectedSkill: 'generic',
        skillDescription: '通用视频制作',
        creativeParameters: {
          durationSeconds: 30,
          shotCount: 5,
          panelsPerShot: 2,
          narration: 'auto',
        },
        stages: [],
        estimatedDuration: 1,
      },
    })

    expect(response.status).toBe(502)
    expect(failAgentWorkflowRunMock).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-super-agent-1',
      projectId: 'project-target-1',
      errorMessage: 'queue unavailable',
    }))
  })

  it('rejects background execution when target project cannot be polled by the user', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const mod = await import('@/app/api/super-agent/execute/route')
    const response = await callRoute(mod.POST, 'POST', {
      userInput: '生成小兔子童话短片',
      locale: 'zh',
      targetProjectId: 'missing-project',
      responseMode: 'background',
      executionMode: 'live',
      plan: {
        projectConfig: {
          name: '月亮灯',
          videoRatio: '9:16',
          artStyle: '可爱童话风',
        },
        episodeConfig: {
          name: '第1集',
          novelText: '小兔子救萤火虫',
        },
        selectedSkill: 'generic',
        skillDescription: '通用视频制作',
        creativeParameters: {
          durationSeconds: 30,
          shotCount: 5,
          panelsPerShot: 2,
          narration: 'auto',
        },
        stages: [],
        estimatedDuration: 1,
      },
    })

    expect(response.status).toBe(404)
    expect(executePlanMock).not.toHaveBeenCalled()
  })
})
