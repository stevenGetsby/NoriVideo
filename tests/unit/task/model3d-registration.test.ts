import { describe, expect, it } from 'vitest'
import { isBillableTaskType } from '@/lib/billing/task-policy'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { resolveTaskIntent } from '@/lib/task/intent'
import { getTaskStageLabel, getTaskTypeLabel } from '@/lib/task/progress-message'
import { TASK_TYPE } from '@/lib/task/types'
import { TASK_TYPE_CATALOG } from '../../contracts/task-type-catalog'
import { TASKTYPE_BEHAVIOR_MATRIX } from '../../contracts/tasktype-behavior-matrix'

describe('toolbox model3d task registration', () => {
  it('routes the task through the durable image worker lane with localized progress', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.TOOLBOX_MODEL_3D)).toBe('image')
    expect(resolveTaskIntent(TASK_TYPE.TOOLBOX_MODEL_3D)).toBe('generate')
    expect(getTaskTypeLabel(TASK_TYPE.TOOLBOX_MODEL_3D)).toBe('progress.taskType.toolboxModel3D')
    expect(getTaskStageLabel('model3d_prepare')).toBe('progress.stage.model3dPrepare')
    expect(getTaskStageLabel('model3d_generate')).toBe('progress.stage.model3dGenerate')
    expect(getTaskStageLabel('model3d_persist')).toBe('progress.stage.model3dPersist')
  })

  it('keeps pricing disabled until a 3D unit price is configured', () => {
    expect(isBillableTaskType(TASK_TYPE.TOOLBOX_MODEL_3D)).toBe(false)
  })

  it('registers worker and API coverage ownership', () => {
    expect(TASK_TYPE_CATALOG.find((entry) => entry.taskType === TASK_TYPE.TOOLBOX_MODEL_3D)).toMatchObject({
      owner: 'tests/unit/worker/toolbox-model3d-task-handler.test.ts',
    })
    expect(TASKTYPE_BEHAVIOR_MATRIX.find((entry) => entry.taskType === TASK_TYPE.TOOLBOX_MODEL_3D)).toMatchObject({
      chainTest: 'tests/integration/chain/image.chain.test.ts',
      apiContractTest: 'tests/integration/api/specific/frameos-toolbox-generate-route.test.ts',
    })
  })
})
