export type CanvasSyncDecision = 'open' | 'offerSync' | 'offerNew' | 'create'

export function decideCanvasAction(input: {
  hasCanvas: boolean
  checkStatus?: number
  stale?: boolean
}): CanvasSyncDecision {
  if (!input.hasCanvas || input.checkStatus === 404) return 'create'
  if (input.checkStatus && input.checkStatus >= 400) return 'open'
  return input.stale ? 'offerSync' : 'open'
}

export function decideCanvasSyncConflict(status: number): 'offerNew' | 'throw' {
  return status === 409 ? 'offerNew' : 'throw'
}

export function isLegacyCanvasSyncConflict(error: unknown): boolean {
  return error instanceof Error
    && error.name === 'WorkflowMutationError'
    && 'code' in error
    && error.code === 'CONFLICT'
}

export function describeSkippedCanvasShots(count: number): string | null {
  return count > 0 ? `${count} 个镜头尚未生成完成，已跳过。` : null
}
