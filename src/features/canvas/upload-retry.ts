export const CANVAS_UPLOAD_MAX_ATTEMPTS = 5
export const CANVAS_UPLOAD_RETRY_BASE_MS = 1000
export const CANVAS_UPLOAD_RETRY_MAX_MS = 8000

export function canvasUploadRetryDelay(attempt: number, retryAfterSeconds?: number | null): number {
  const exponential = Math.min(CANVAS_UPLOAD_RETRY_MAX_MS, CANVAS_UPLOAD_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1))
  return Number.isFinite(retryAfterSeconds) && Number(retryAfterSeconds) > 0
    ? Math.min(CANVAS_UPLOAD_RETRY_MAX_MS, Math.max(exponential, Number(retryAfterSeconds) * 1000))
    : exponential
}
