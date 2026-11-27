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
  keepExternalReferences = true,
): CanvasNodeData {
  const data = structuredClone(value)
  const generation = data.generation ? { ...data.generation } : undefined
  if (generation) {
    delete generation.assetId
    delete generation.taskId
    if (generation.referenceNodeIds) {
      generation.referenceNodeIds = generation.referenceNodeIds
        .map((id) => remapId(id) ?? (keepExternalReferences ? id : null))
        .filter((id): id is string => Boolean(id))
    }
    if (generation.pausedReferenceNodeIds) {
      generation.pausedReferenceNodeIds = generation.pausedReferenceNodeIds
        .map((id) => remapId(id) ?? (keepExternalReferences ? id : null))
        .filter((id): id is string => Boolean(id))
    }
    if (generation.referenceSummary) {
      generation.referenceSummary = generation.referenceSummary
        .map((item) => ({ ...item, id: remapId(item.id) ?? (keepExternalReferences ? item.id : null) }))
        .filter((item): item is typeof item & { id: string } => Boolean(item.id))
    }
    if (generation.referenceMentionNames) {
      const entries = Object.entries(generation.referenceMentionNames).flatMap(([id, names]) => {
        const mapped = remapId(id) ?? (keepExternalReferences ? id : null)
        return mapped ? [[mapped, names] as const] : []
      })
      generation.referenceMentionNames = Object.fromEntries(entries)
    }
    if (generation.referenceMentionSelections) {
      generation.referenceMentionSelections = generation.referenceMentionSelections
        .map((item) => ({ ...item, nodeId: remapId(item.nodeId) ?? (keepExternalReferences ? item.nodeId : null) }))
        .filter((item): item is typeof item & { nodeId: string } => Boolean(item.nodeId))
    }
  }
  const videoEdit = data.videoEdit ? { ...data.videoEdit } : undefined
  if (!keepExternalReferences && videoEdit?.sourceKind === 'node' && videoEdit.sourceNodeId && !remapId(videoEdit.sourceNodeId)) {
    videoEdit.sourceKind = 'none'
    videoEdit.sourceNodeId = null
  } else if (videoEdit?.sourceNodeId) {
    videoEdit.sourceNodeId = remapId(videoEdit.sourceNodeId) ?? videoEdit.sourceNodeId
  }
  if (!keepExternalReferences && videoEdit?.references) {
    videoEdit.references = videoEdit.references
      .map((item) => ({ ...item, id: remapId(item.id) ?? null }))
      .filter((item): item is typeof item & { id: string } => Boolean(item.id))
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
    // The global style and video prefix prompts are unique per canvas; a
    // duplicate must not silently compete with the original text node.
    globalStylePrompt: false,
    videoPrefixPrompt: false,
    generation,
    videoEdit,
    generationTask: null,
    memberIds: data.memberIds?.map((id) => remapId(id)).filter((id): id is string => Boolean(id)),
    playlistItems: data.playlistItems?.map((item) => ({
      ...item,
      sourceNodeId: item.sourceNodeId ? remapId(item.sourceNodeId) ?? (keepExternalReferences ? item.sourceNodeId : null) : null,
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
