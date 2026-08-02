export type PanoramaCaptureUploadFailure = {
  index: number
  message: string
}

export type PanoramaCaptureUploadSuccess<T> = {
  index: number
  value: T
}

export type PanoramaCaptureUploadBatch<T> = {
  successes: PanoramaCaptureUploadSuccess<T>[]
  failures: PanoramaCaptureUploadFailure[]
}

export type PanoramaCaptureCommitResult = {
  created: number
  failed: number
  errors: string[]
}

function failureMessage(reason: unknown, index: number) {
  return reason instanceof Error && reason.message.trim()
    ? reason.message.trim()
    : `视角 ${index + 1} 上传失败`
}

/**
 * Upload every capture independently. Stable source indexes are retained so
 * a partial batch does not relabel later views as the failed view's slot.
 */
export async function settlePanoramaCaptureUploads<T>(
  count: number,
  upload: (index: number) => Promise<T>,
): Promise<PanoramaCaptureUploadBatch<T>> {
  const settled = await settleWithConcurrency(
    Array.from({ length: count }, (_, index) => index),
    2,
    async (index) => await upload(index),
  )
  const successes: PanoramaCaptureUploadSuccess<T>[] = []
  const failures: PanoramaCaptureUploadFailure[] = []
  settled.forEach((result) => {
    if (result.status === 'fulfilled') successes.push({ index: result.index, value: result.value })
    else failures.push({ index: result.index, message: failureMessage(result.reason, result.index) })
  })
  return { successes, failures }
}

export function panoramaCaptureResultMessage(result: PanoramaCaptureCommitResult) {
  if (result.failed === 0) return `已发送 ${result.created} 张全景视角截图到画布`
  const detail = result.errors.slice(0, 3).join('；')
  const omitted = Math.max(0, result.errors.length - 3)
  return `成功 ${result.created} 张，失败 ${result.failed} 张${detail ? `：${detail}` : ''}${omitted > 0 ? `；另有 ${omitted} 项失败` : ''}`
}
import { settleWithConcurrency } from '@/lib/async/settle-with-concurrency'
