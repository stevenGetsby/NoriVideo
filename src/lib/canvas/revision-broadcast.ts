export interface CanvasRevisionTarget {
  projectId: string
  canvasId: string
  revision: number
}

export function canvasRevisionChannelName(accountId: string, projectId: string, canvasId: string) {
  return `nori-canvas:${accountId.trim()}:${projectId}:${canvasId}`
}

/**
 * Tells editors that already have these canvases open (this tab or others)
 * that the server moved to a newer revision, so they reload instead of
 * overwriting the change on their next save.
 */
export function notifyCanvasRevisions(accountId: string, targets: readonly CanvasRevisionTarget[] | null | undefined) {
  if (!accountId.trim() || !targets?.length || typeof BroadcastChannel === 'undefined') return
  for (const target of targets) {
    if (!Number.isSafeInteger(target.revision) || target.revision < 0) continue
    const channel = new BroadcastChannel(canvasRevisionChannelName(accountId, target.projectId, target.canvasId))
    channel.postMessage({ type: 'canvas-revision', source: 'server-sync', revision: target.revision })
    setTimeout(() => channel.close(), 1_000)
  }
}
