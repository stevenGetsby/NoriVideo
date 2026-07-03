import { describe, expect, it } from 'vitest'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { TASK_TYPE } from '@/lib/task/types'

describe('screenwriter mock task queue', () => {
  it('routes screenwriter mock tasks to the text queue', () => {
    expect(TASK_TYPE.SCREENWRITER_MOCK).toBe('screenwriter_mock')
    expect(getQueueTypeByTaskType(TASK_TYPE.SCREENWRITER_MOCK)).toBe('text')
  })
})
