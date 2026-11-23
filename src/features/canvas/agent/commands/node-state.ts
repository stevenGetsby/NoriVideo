import type { CanvasFlowNode } from '../../editor-types'

export function isNodeBusy(node: CanvasFlowNode): boolean {
  return Boolean(node.data.generationTask && !node.data.generationTask.completed)
    || node.data.__server?.status === 'RUNNING'
}

export function nodeMedia(node: CanvasFlowNode): 'image' | 'video' | 'audio' | 'model3d' | undefined {
  const data = node.data
  if (data.videoUrl) return 'video'
  if (data.imageUrl) return 'image'
  if (data.audioUrl) return 'audio'
  if (data.modelUrl) return 'model3d'
  const type = data.mediaType || node.type
  if (data.materialId || data.contentUrl) {
    if (type === 'model_3d' || type === 'model3d') return 'model3d'
    if (type === 'image' || type === 'video' || type === 'audio') return type
  }
}

export function hasNodeMedia(node: CanvasFlowNode): boolean {
  const data = node.data
  return Boolean(data.contentUrl || data.imageUrl || data.videoUrl || data.audioUrl || data.modelUrl || data.materialId)
}
