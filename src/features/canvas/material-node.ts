import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { createFlowNode, type CanvasFlowNode } from './editor-types'

export function createMaterialFlowNode(material: FrameosMaterialItem, position: { x: number; y: number }): CanvasFlowNode | null {
  if (!material?.id || !material.url || !['image', 'video', 'audio', 'model3d'].includes(material.type)) return null
  const type = material.type
  const node = createFlowNode(type === 'model3d' ? 'model_3d' : type, position)
  node.position = {
    x: position.x - (node.width || 300) / 2,
    y: position.y - (node.height || 200) / 2,
  }
  node.data = {
    ...node.data,
    title: material.title || '作品资产',
    mediaType: type,
    origin: material.source === 'upload' ? 'upload' : 'project',
    contentUrl: material.url,
    imageUrl: type === 'image' ? material.url : null,
    videoUrl: type === 'video' ? material.url : null,
    audioUrl: type === 'audio' ? material.url : null,
    modelUrl: type === 'model3d' ? material.url : null,
    materialId: material.id,
    sourceMetadata: material.metadata || null,
    __server: { ...node.data.__server!, status: 'SUCCEEDED' },
  }
  return node
}
