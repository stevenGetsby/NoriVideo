import type { CanvasFlowNode } from './editor-types'

function hasDownloadableContent(node: CanvasFlowNode) {
  if (node.type === 'studio_3d') return true
  const data = node.data
  return Boolean(
    data.text?.trim()
    || data.contentUrl
    || data.imageUrl
    || data.videoUrl
    || data.audioUrl
    || data.modelUrl,
  )
}

/** Nodes a shared multi-selection download should pack, expanding groups to their members once. */
export function collectSelectionDownloadNodes(
  allNodes: readonly CanvasFlowNode[],
  selectedNodes: readonly CanvasFlowNode[],
): CanvasFlowNode[] {
  const ids = new Set<string>()
  for (const node of selectedNodes) {
    if (node.type === 'group') for (const id of node.data.memberIds || []) ids.add(id)
    else ids.add(node.id)
  }
  return allNodes.filter((node) => node.type !== 'group' && ids.has(node.id) && hasDownloadableContent(node))
}
