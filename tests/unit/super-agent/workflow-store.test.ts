import { beforeEach, describe, expect, it, vi } from 'vitest'

const runRuntimeMock = vi.hoisted(() => ({
  createRun: vi.fn(),
  appendRunEventWithSeq: vi.fn(),
  createArtifact: vi.fn(),
  RUN_EVENT_TYPE: {
    RUN_START: 'run.start',
    STEP_START: 'step.start',
    STEP_COMPLETE: 'step.complete',
    STEP_ERROR: 'step.error',
    RUN_COMPLETE: 'run.complete',
    RUN_ERROR: 'run.error',
  },
}))

vi.mock('@/lib/run-runtime/service', () => ({
  createRun: runRuntimeMock.createRun,
  appendRunEventWithSeq: runRuntimeMock.appendRunEventWithSeq,
  createArtifact: runRuntimeMock.createArtifact,
}))

vi.mock('@/lib/run-runtime/types', () => ({
  RUN_EVENT_TYPE: runRuntimeMock.RUN_EVENT_TYPE,
}))

describe('super-agent workflow store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runRuntimeMock.createRun.mockResolvedValue({ id: 'run-1' })
    runRuntimeMock.appendRunEventWithSeq.mockResolvedValue({ id: 'event-1' })
    runRuntimeMock.createArtifact.mockResolvedValue({ id: 'artifact-1' })
  })

  it('records agent creation workflow input and final artifacts', async () => {
    const {
      SUPER_AGENT_WORKFLOW_TYPE,
      completeAgentWorkflowRun,
      startAgentWorkflowRun,
    } = await import('@/lib/super-agent/workflow-store')

    const plan = {
      projectConfig: {
        name: '商品宣传',
        videoRatio: '9:16' as const,
        artStyle: 'realistic',
      },
      episodeConfig: {
        name: '第1集',
        novelText: '狗狗布包宣传片',
      },
      selectedSkill: 'product-promo' as const,
      skillDescription: '商品宣传短片',
      executionMode: 'mock' as const,
      creativeParameters: { shotCount: 2 },
      stages: [{
        stageId: 'stage_1',
        stageNumber: 1,
        title: '项目初始化',
        description: '创建项目',
        estimatedDuration: 5,
        status: 'completed' as const,
      }],
      estimatedDuration: 5,
    }

    const run = await startAgentWorkflowRun({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetId: 'project-1',
      plan,
      userInput: '制作狗狗布包宣传片',
    })

    expect(run.id).toBe('run-1')
    expect(runRuntimeMock.createRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      workflowType: SUPER_AGENT_WORKFLOW_TYPE,
      targetType: 'project',
      targetId: 'project-1',
      input: expect.objectContaining({
        selectedSkill: 'product-promo',
        userInput: '制作狗狗布包宣传片',
      }),
    }))

    await completeAgentWorkflowRun({
      runId: 'run-1',
      userId: 'user-1',
      plan,
      result: {
        executionId: 'agent_exec_1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        status: 'completed',
        stageResults: {
          stage1: { projectId: 'project-1', episodeId: 'episode-1', hasStory: true },
        },
        workspaceUrl: '/zh/workspace/project-1?episode=episode-1',
        summary: 'done',
        errors: [],
      },
    })

    expect(runRuntimeMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      artifactType: 'super_agent.workflow_snapshot',
      refId: 'project-1',
      payload: expect.objectContaining({
        workspaceUrl: '/zh/workspace/project-1?episode=episode-1&stage=videos',
      }),
    }))
    expect(runRuntimeMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: 'episode',
      refId: 'episode-1',
    }))
    expect(runRuntimeMock.appendRunEventWithSeq).toHaveBeenLastCalledWith(expect.objectContaining({
      eventType: 'run.complete',
      projectId: 'project-1',
      payload: expect.objectContaining({
        workspaceUrl: '/zh/workspace/project-1?episode=episode-1&stage=videos',
      }),
    }))
  })

  it('records agent stage progress and marks failed runs', async () => {
    const {
      failAgentWorkflowRun,
      recordAgentWorkflowStage,
    } = await import('@/lib/super-agent/workflow-store')

    await recordAgentWorkflowStage({
      runId: 'run-1',
      userId: 'user-1',
      projectId: 'project-1',
      stage: {
        stageId: 'stage_5',
        stageNumber: 5,
        title: '精简分镜生成',
        description: '生成分镜',
        estimatedDuration: 180,
        status: 'running',
      },
      status: 'running',
      percent: 70,
      message: '正在按剧情片段生成分镜。',
    })

    expect(runRuntimeMock.appendRunEventWithSeq).toHaveBeenLastCalledWith(expect.objectContaining({
      eventType: 'step.start',
      stepKey: 'stage_5',
      payload: expect.objectContaining({
        stepId: 'stage_5',
        stepTitle: '精简分镜生成',
        percent: 70,
        artifactType: 'agent.stage.progress',
      }),
    }))

    await failAgentWorkflowRun({
      runId: 'run-1',
      userId: 'user-1',
      projectId: 'project-1',
      errorMessage: 'LLM JSON parse failed',
    })

    expect(runRuntimeMock.appendRunEventWithSeq).toHaveBeenLastCalledWith(expect.objectContaining({
      eventType: 'run.error',
      projectId: 'project-1',
      payload: expect.objectContaining({
        errorCode: 'SUPER_AGENT_EXECUTION_ERROR',
        errorMessage: 'LLM JSON parse failed',
      }),
    }))
  })
})
