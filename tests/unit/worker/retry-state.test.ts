import type { Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'
import { workerTaskWillRetry } from '@/lib/workers/retry-state'

function job(attemptsMade: number, attempts: number): Job<TaskJobData> {
  return { attemptsMade, opts: { attempts } } as unknown as Job<TaskJobData>
}

describe('worker retry state', () => {
  it('keeps a retryable network failure non-terminal while attempts remain', () => {
    expect(workerTaskWillRetry(job(0, 3), new TypeError('fetch failed'))).toBe(true)
    expect(workerTaskWillRetry(job(2, 3), new TypeError('fetch failed'))).toBe(false)
  })

  it('does not keep explicit invalid input errors in a retrying state', () => {
    const error = Object.assign(new Error('invalid request'), { code: 'INVALID_PARAMS', retryable: false })
    expect(workerTaskWillRetry(job(0, 5), error)).toBe(false)
  })
})
