import type { CanvasFlowNode, CanvasReplaceableMediaType } from './editor-types'
import type { CanvasGenerateRequest } from './generation/generate-request-core'
import type { CanvasGenerationHistoryItem } from './types'

export function nodeSize(node: CanvasFlowNode) {
  return { width: node.width || node.measured?.width || 300, height: node.height || node.measured?.height || 200 }
}

export function getMediaType(node: CanvasFlowNode) {
  return node.data.mediaType || (node.type === 'note' ? 'text' : node.type === 'model_3d' ? 'model3d' : node.type) || 'image'
}

export function minimapNodeColor(node: CanvasFlowNode) {
  const type = getMediaType(node)
  if (node.type === 'group') return 'rgba(121, 139, 184, .34)'
  if (type === 'video') return '#c25591'
  if (type === 'audio') return '#d99a38'
  if (type === 'image') return '#4b84db'
  if (type === 'model3d') return '#45a77e'
  return '#8a76d8'
}

export function getReplaceableMediaType(node: CanvasFlowNode): CanvasReplaceableMediaType | null {
  const type = getMediaType(node)
  return type === 'image' || type === 'video' || type === 'audio' || type === 'model3d' ? type : null
}

export function safeFileName(value: string, fallback: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback
}

export function extensionForNode(node: CanvasFlowNode) {
  const type = getMediaType(node)
  if (type === 'text') return 'txt'
  if (type === 'video') return 'mp4'
  if (type === 'audio') return 'mp3'
  if (type === 'model3d') return 'glb'
  return 'jpg'
}

export function extraReferenceMaterialIds(node: CanvasFlowNode) {
  const parameters = node.data.generation?.parameters
  // maskMaterialId has dedicated inpaint semantics and must never be sent as
  // an ordinary reference image.
  const values = [parameters?.referenceMaterialId]
  return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
}

export function imageEditMaskMaterialId(node: CanvasFlowNode) {
  if (node.data.processType !== 'image_edit') return ''
  const value = node.data.generation?.parameters?.maskMaterialId
  return typeof value === 'string' ? value.trim() : ''
}

export function createHistoryItem(request: CanvasGenerateRequest, assetId?: string, taskId?: string): CanvasGenerationHistoryItem {
  return {
    id: crypto.randomUUID(),
    assetId,
    taskId,
    prompt: request.prompt,
    modelKey: request.modelKey,
    quotedCostPoints: request.quotedCostPoints ?? null,
    parameters: {
      inputMode: request.inputMode,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      quality: request.quality,
      duration: request.duration,
      ...(request.fps ? { fps: request.fps } : {}),
      generateAudio: request.generateAudio,
      count: request.count,
      ...(request.type === 'audio' ? { audioMode: request.audioMode, voice: request.audioVoice } : {}),
    },
    references: request.referenceSummary || [],
    source: 'generation',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
}

// Latest-first: the current task id survives success (only failures delete
// it); history[0] is the most recent entry when the node was restored from
// a revision or server snapshot that dropped generation.taskId.
export function readNodeGenerationTaskId(node: CanvasFlowNode): string {
  const data = node.data
  const direct = data.generation?.taskId || data.generationTask?.taskId || data.__server?.taskId
  if (direct) return direct
  for (const item of data.history || []) if (item.taskId) return item.taskId
  return ''
}
