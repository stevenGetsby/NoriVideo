import { describe, expect, it } from 'vitest'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'
import { resolveTaskIntent } from '@/lib/task/intent'
import { getTaskStageLabel, getTaskTypeLabel } from '@/lib/task/progress-message'
import { TASK_TYPE } from '@/lib/task/types'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { TASK_TYPE_CATALOG } from '../../contracts/task-type-catalog'
import { TASKTYPE_BEHAVIOR_MATRIX } from '../../contracts/tasktype-behavior-matrix'

const CANVAS_GENERATION_TYPES = [
  TASK_TYPE.CANVAS_TEXT_GENERATION,
  TASK_TYPE.CANVAS_STORYBOARD_PLAN,
] as const

describe('canvas generation task registration', () => {
  it('registers intents and localized progress keys', () => {
    expect(resolveTaskIntent(TASK_TYPE.CANVAS_TEXT_GENERATION)).toBe('generate')
    expect(resolveTaskIntent(TASK_TYPE.CANVAS_STORYBOARD_PLAN)).toBe('build')
    expect(getTaskTypeLabel(TASK_TYPE.CANVAS_TEXT_GENERATION)).toBe('progress.taskType.canvasTextGeneration')
    expect(getTaskTypeLabel(TASK_TYPE.CANVAS_STORYBOARD_PLAN)).toBe('progress.taskType.canvasStoryboardPlan')

    expect(getTaskStageLabel('canvas_text_prepare')).toBe('progress.stage.canvasTextPrepare')
    expect(getTaskStageLabel('canvas_text_generate')).toBe('progress.stage.canvasTextGenerate')
    expect(getTaskStageLabel('canvas_text_done')).toBe('progress.stage.canvasTextDone')
    expect(getTaskStageLabel('canvas_storyboard_prepare')).toBe('progress.stage.canvasStoryboardPrepare')
    expect(getTaskStageLabel('canvas_storyboard_plan')).toBe('progress.stage.canvasStoryboardPlan')
    expect(getTaskStageLabel('canvas_storyboard_done')).toBe('progress.stage.canvasStoryboardDone')
  })

  it.each(CANVAS_GENERATION_TYPES)('bills %s as a text task using frozen token limits', (taskType) => {
    expect(isBillableTaskType(taskType)).toBe(true)

    const info = buildDefaultTaskBillingInfo(taskType, {
      analysisModel: 'anthropic/claude-sonnet-4',
      maxInputTokens: 2400,
      maxOutputTokens: 600,
    })

    expect(info).toMatchObject({
      billable: true,
      taskType,
      apiType: 'text',
      model: 'anthropic/claude-sonnet-4',
      quantity: 3000,
      unit: 'token',
      metadata: {
        inputTokens: 2400,
        outputTokens: 600,
      },
    })
  })

  it.each(CANVAS_GENERATION_TYPES)('keeps %s in the task coverage matrix', (taskType) => {
    expect(getQueueTypeByTaskType(taskType)).toBe('text')
    expect(TASK_TYPE_CATALOG.find((entry) => entry.taskType === taskType)).toMatchObject({
      owner: 'tests/unit/worker/canvas-generation-task-handler.test.ts',
    })
    expect(TASKTYPE_BEHAVIOR_MATRIX.find((entry) => entry.taskType === taskType)).toMatchObject({
      chainTest: 'tests/integration/chain/text.chain.test.ts',
      apiContractTest: 'tests/integration/api/specific/canvas-generation-tasks-route.test.ts',
    })
  })
})
