import type { CanvasNodeData } from './types'

function durableContent(data: CanvasNodeData) {
  return Boolean(
    data.text?.trim()
    || data.contentUrl
    || data.imageUrl
    || data.videoUrl
    || data.audioUrl
    || data.modelUrl,
  )
}

/**
 * A duplicated node is a new document entity, never another observer of the
 * original node's in-flight task. Keep reusable content/history/config while
 * clearing execution ownership and remapping graph-local references.
 */
export function cloneCanvasNodeDataForNewNode(
  value: CanvasNodeData,
  remapId: (id: string) => string | undefined,
): CanvasNodeData {
  const data = structuredClone(value)
  const generation = data.generation ? { ...data.generation } : undefined
  if (generation) {
    delete generation.assetId
    delete generation.taskId
    if (generation.referenceNodeIds) {
      generation.referenceNodeIds = generation.referenceNodeIds.map((id) => remapId(id) || id)
    }
  }
  const hasContent = durableContent(data)
  const clonedServer = data.__server && typeof data.__server === 'object'
    ? data.__server as { parentNodeId?: unknown }
    : null
  const clonedParentNodeId = typeof clonedServer?.parentNodeId === 'string'
    ? clonedServer.parentNodeId
    : null
  return {
    ...data,
    generation,
    generationTask: null,
    memberIds: data.memberIds?.map((id) => remapId(id)).filter((id): id is string => Boolean(id)),
    playlistItems: data.playlistItems?.map((item) => ({
      ...item,
      sourceNodeId: item.sourceNodeId ? remapId(item.sourceNodeId) || item.sourceNodeId : null,
    })),
    progress: hasContent ? 100 : 0,
    errorMessage: null,
    pollErrorMessage: null,
    __server: {
      status: hasContent ? 'SUCCEEDED' : 'IDLE',
      taskId: null,
      runId: null,
      mediaObjectId: null,
      parentNodeId: clonedParentNodeId
        ? remapId(clonedParentNodeId) || null
        : null,
    },
  }
}
