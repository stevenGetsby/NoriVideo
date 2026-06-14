import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { RUN_EVENT_TYPE } from '@/lib/run-runtime/types'
import {
  buildWorkflowStageInvalidationPlan,
  resolveNextWorkflowStageProgress,
  resolveRunRuntimeState,
  resolveWorkflowStageKeyFromTaskType,
  shouldApplyWorkflowStageRuntimeUpdate,
} from '@/lib/workspace/workflow-stage-state-store'

describe('workflow stage runtime state store', () => {
  it('maps production task types to visible workflow stages', () => {
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.STORY_TO_SCRIPT_RUN)).toBe('script')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.CLIPS_BUILD)).toBe('script')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.IMAGE_CHARACTER)).toBe('script')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.IMAGE_LOCATION)).toBe('script')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)).toBe('storyboard')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.IMAGE_PANEL)).toBe('storyboard')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.VIDEO_PANEL)).toBe('videos')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.LIP_SYNC)).toBe('videos')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.VOICE_LINE)).toBe('voice')
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.EXPORT_DELIVERY)).toBe('editor')
  })

  it('skips tasks that should not drive FrameOS stage status', () => {
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.ASSET_HUB_IMAGE)).toBeNull()
    expect(resolveWorkflowStageKeyFromTaskType(TASK_TYPE.SUPER_AGENT_EXECUTE)).toBeNull()
    expect(resolveWorkflowStageKeyFromTaskType('unknown')).toBeNull()
    expect(resolveWorkflowStageKeyFromTaskType(null)).toBeNull()
  })

  it('prevents old active events from downgrading a terminal stage for the same execution', () => {
    expect(shouldApplyWorkflowStageRuntimeUpdate({
      existingStatus: 'completed',
      existingLastRunId: 'run-1',
      nextStatus: 'running',
      nextLastRunId: 'run-1',
    })).toBe(false)

    expect(shouldApplyWorkflowStageRuntimeUpdate({
      existingStatus: 'completed',
      existingLastRunId: 'run-1',
      nextStatus: 'running',
      nextLastRunId: 'run-2',
    })).toBe(true)

    expect(shouldApplyWorkflowStageRuntimeUpdate({
      existingStatus: 'failed',
      existingLastTaskId: 'task-1',
      nextStatus: 'completed',
      nextLastTaskId: 'task-1',
    })).toBe(true)
  })

  it('prevents stale active events from overwriting review-controlled terminal states', () => {
    expect(shouldApplyWorkflowStageRuntimeUpdate({
      existingStatus: 'approved',
      existingLastRunId: 'run-1',
      nextStatus: 'running',
      nextLastRunId: 'run-1',
    })).toBe(false)

    expect(shouldApplyWorkflowStageRuntimeUpdate({
      existingStatus: 'stale',
      existingLastTaskId: 'task-1',
      nextStatus: 'running',
      nextLastTaskId: 'task-1',
    })).toBe(false)

    expect(shouldApplyWorkflowStageRuntimeUpdate({
      existingStatus: 'pending_review',
      existingLastRunId: 'run-1',
      nextStatus: 'running',
      nextLastRunId: 'run-2',
    })).toBe(true)
  })

  it('keeps progress monotonic within the same execution', () => {
    expect(resolveNextWorkflowStageProgress({
      existingProgress: 80,
      nextProgress: 20,
      sameExecution: true,
    })).toBe(80)

    expect(resolveNextWorkflowStageProgress({
      existingProgress: 80,
      nextProgress: 20,
      sameExecution: false,
    })).toBe(20)

    expect(resolveNextWorkflowStageProgress({
      existingProgress: 80,
      nextProgress: null,
      sameExecution: true,
    })).toBe(80)
  })

  it('does not treat an individual run step completion as a finished stage', () => {
    expect(resolveRunRuntimeState(RUN_EVENT_TYPE.STEP_COMPLETE)).toBe('running')
    expect(resolveRunRuntimeState(RUN_EVENT_TYPE.RUN_COMPLETE)).toBe('completed')
  })

  it('builds downstream invalidation plan from the submitted production task type', () => {
    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.STORY_TO_SCRIPT_RUN)).toMatchObject({
      sourceStage: 'script',
      staleStages: ['storyboard', 'videos', 'voice', 'editor'],
    })
    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.STORY_TO_SCRIPT_RUN)?.cancelTaskTypes).toEqual(
      expect.arrayContaining([
        TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
        TASK_TYPE.IMAGE_PANEL,
        TASK_TYPE.VIDEO_PANEL,
        TASK_TYPE.VOICE_LINE,
        TASK_TYPE.EXPORT_DELIVERY,
      ]),
    )

    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)).toMatchObject({
      sourceStage: 'storyboard',
      staleStages: ['videos', 'voice', 'editor'],
    })
    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)?.cancelTaskTypes).not.toContain(
      TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
    )

    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.VIDEO_PANEL)).toMatchObject({
      sourceStage: 'videos',
      staleStages: ['voice', 'editor'],
    })
    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.VIDEO_PANEL)?.cancelTaskTypes).toEqual(
      expect.arrayContaining([TASK_TYPE.VOICE_LINE, TASK_TYPE.EXPORT_DELIVERY]),
    )
    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.EXPORT_DELIVERY)).toBeNull()
    expect(buildWorkflowStageInvalidationPlan(TASK_TYPE.SUPER_AGENT_EXECUTE)).toBeNull()
  })
})
