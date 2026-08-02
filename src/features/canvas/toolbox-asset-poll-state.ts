export const CANVAS_TOOLBOX_ASSET_POLL_BATCH_SIZE = 100

/**
 * Poll the exact assets bound to running canvas nodes.  The toolbox history
 * endpoint is ordered and paginated, so using its newest-N view can strand an
 * older long-running node once enough newer assets have been created.
 */
export function chunkCanvasToolboxAssetIds(
  values: Iterable<string>,
  batchSize = CANVAS_TOOLBOX_ASSET_POLL_BATCH_SIZE,
): string[][] {
  const size = Number.isSafeInteger(batchSize) && batchSize > 0
    ? Math.min(200, batchSize)
    : CANVAS_TOOLBOX_ASSET_POLL_BATCH_SIZE
  const ids = Array.from(new Set(Array.from(values)
    .map((value) => value.trim())
    .filter((value) => Boolean(value) && value.length <= 191)))
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size))
  }
  return batches
}

export function isCanvasToolboxAssetMissingTerminal(misses: number, limit: number): boolean {
  return Number.isFinite(misses) && Number.isFinite(limit) && limit > 0 && misses >= limit
}

export function resolveCanvasToolboxAssetPollState(input: {
  assetStatus: string | null | undefined
  hasResult: boolean
  taskStatus: string | null | undefined
}) {
  const assetStatus = input.assetStatus?.trim().toLowerCase() || ''
  const taskStatus = input.taskStatus?.trim().toLowerCase() || ''
  const ready = assetStatus === 'ready' && input.hasResult
  const active = taskStatus === 'queued' || taskStatus === 'processing'
  const terminalTaskFailure = taskStatus === 'failed'
    || taskStatus === 'canceled'
    || taskStatus === 'dismissed'
  const completedWithoutMedia = taskStatus === 'completed' && !ready
  const invalidReady = assetStatus === 'ready' && !input.hasResult
  const failed = !ready
    && !active
    && (assetStatus === 'failed' || terminalTaskFailure || completedWithoutMedia || invalidReady)
  return { ready, active, failed }
}
