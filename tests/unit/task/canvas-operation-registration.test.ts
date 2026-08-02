import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const addMock = vi.hoisted(() => vi.fn(async () => ({ id: 'job-1' })))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) { void name }
    add = addMock
    async getJob() { return null }
  },
}))
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))

import { addTaskJob, getQueueTypeByTaskType } from '@/lib/task/queues'
import { resolveTaskIntent } from '@/lib/task/intent'
import { isAiTaskType } from '@/lib/run-runtime/workflow'

function data(type: TaskJobData['type']): TaskJobData {
  return {
    taskId: `task-${type}`,
    type,
    locale: 'zh',
    projectId: 'project-1',
    targetType: 'CanvasNode',
    targetId: 'node-1',
    payload: {},
    userId: 'user-1',
  }
}

describe('canvas operation task registration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes image and video operations to their media queues as non-AI processing tasks', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.CANVAS_IMAGE_OPERATION)).toBe('image')
    expect(getQueueTypeByTaskType(TASK_TYPE.CANVAS_VIDEO_OPERATION)).toBe('video')
    expect(resolveTaskIntent(TASK_TYPE.CANVAS_IMAGE_OPERATION)).toBe('process')
    expect(resolveTaskIntent(TASK_TYPE.CANVAS_VIDEO_OPERATION)).toBe('process')
    expect(isAiTaskType(TASK_TYPE.CANVAS_IMAGE_OPERATION)).toBe(false)
    expect(isAiTaskType(TASK_TYPE.CANVAS_VIDEO_OPERATION)).toBe(false)
  })

  it('uses one automatic attempt and leaves further retries to the scoped API', async () => {
    await addTaskJob(data(TASK_TYPE.CANVAS_IMAGE_OPERATION))
    await addTaskJob(data(TASK_TYPE.CANVAS_VIDEO_OPERATION))
    expect(addMock).toHaveBeenNthCalledWith(1, TASK_TYPE.CANVAS_IMAGE_OPERATION, expect.any(Object), expect.objectContaining({ attempts: 1 }))
    expect(addMock).toHaveBeenNthCalledWith(2, TASK_TYPE.CANVAS_VIDEO_OPERATION, expect.any(Object), expect.objectContaining({ attempts: 1 }))
  })
})
