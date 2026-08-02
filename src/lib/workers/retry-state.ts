import type { Job } from 'bullmq'
import { normalizeAnyError } from '@/lib/errors/normalize'
import type { TaskJobData } from '@/lib/task/types'

/** BullMQ increments attemptsMade after the current handler failure. */
export function workerTaskWillRetry(job: Job<TaskJobData>, error: unknown): boolean {
  const maxAttempts = Math.max(1, Number(job.opts?.attempts) || 1)
  const failedAttempt = Math.max(0, Number(job.attemptsMade) || 0) + 1
  return normalizeAnyError(error, { context: 'worker' }).retryable && failedAttempt < maxAttempts
}
