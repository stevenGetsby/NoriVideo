import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const executePlanMock = vi.hoisted(() => vi.fn())
const reportTaskProgressMock = vi.hoisted(() => vi.fn())
const failAgentWorkflowRunMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/super-agent/orchestrator', () => ({
  SuperAgentOrchestrator: vi.fn(() => ({
    executePlan: executePlanMock,
  })),
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
}))

vi.mock('@/lib/super-agent/workflow-store', () => ({
  failAgentWorkflowRun: failAgentWorkflowRunMock,
}))

function buildPlan() {
  return {
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
    executionMode: 'live',
    creativeParameters: {
      durationSeconds: 30,
      shotCount: 5,
      panelsPerShot: 2,
      narration: 'auto',
    },
    stages: [
      {
        stageId: 'stage_1',
        stageNumber: 1,
        title: '项目初始化',
        description: '初始化',
        estimatedDuration: 1,
        status: 'pending',
      },
    ],
    estimatedDuration: 1,
  }
}

function buildJob(payload: Record<string, unknown>) {
  return {
    data: {
      taskId: 'task-super-agent-1',
      type: TASK_TYPE.SUPER_AGENT_EXECUTE,
      locale: 'zh',
      projectId: 'project-target-1',
      episodeId: null,
      targetType: 'project',
      targetId: 'project-target-1',
      payload,
      userId: 'user-1',
    } satisfies TaskJobData,
  }
}

describe('handleSuperAgentExecuteTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reportTaskProgressMock.mockResolvedValue(undefined)
    failAgentWorkflowRunMock.mockResolvedValue(undefined)
    executePlanMock.mockResolvedValue({
      projectId: 'project-target-1',
      episodeId: 'episode-1',
      workspaceUrl: '/zh/workspace/project-target-1?stage=videos',
      status: 'completed',
      errors: [],
    })
  })

  it('executes the Agent plan with the pre-created workflow run id', async () => {
    const { handleSuperAgentExecuteTask } = await import('@/lib/workers/handlers/super-agent-execute')
    const result = await handleSuperAgentExecuteTask(buildJob({
      plan: buildPlan(),
      userInput: '生成小兔子童话短片',
      targetProjectId: 'project-target-1',
      executionMode: 'live',
      runId: 'run-super-agent-1',
    }) as never)

    expect(reportTaskProgressMock).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({
      stage: 'super_agent_execute',
      runId: 'run-super-agent-1',
    }))
    expect(executePlanMock).toHaveBeenCalledWith(expect.objectContaining({
      executionMode: 'live',
    }), expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      userInput: '生成小兔子童话短片',
      targetProjectId: 'project-target-1',
      workflowRunId: 'run-super-agent-1',
    }))
    expect(result).toMatchObject({
      projectId: 'project-target-1',
      episodeId: 'episode-1',
      runId: 'run-super-agent-1',
    })
  })

  it('marks the Agent run failed when orchestration throws', async () => {
    executePlanMock.mockRejectedValueOnce(new Error('stage failed'))

    const { handleSuperAgentExecuteTask } = await import('@/lib/workers/handlers/super-agent-execute')
    await expect(handleSuperAgentExecuteTask(buildJob({
      plan: buildPlan(),
      userInput: '生成小兔子童话短片',
      targetProjectId: 'project-target-1',
      runId: 'run-super-agent-1',
    }) as never)).rejects.toThrow('stage failed')

    expect(failAgentWorkflowRunMock).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-super-agent-1',
      userId: 'user-1',
      projectId: 'project-target-1',
      errorMessage: 'stage failed',
    }))
  })
})
