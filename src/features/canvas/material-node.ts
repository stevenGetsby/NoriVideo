import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { createFlowNode, type CanvasFlowNode } from './editor-types'
import { readComparisonIndex, restoreComparisonTitle, stripComparisonTitleSuffix } from './comparison-title'

export function createMaterialFlowNode(material: FrameosMaterialItem, position: { x: number; y: number }): CanvasFlowNode | null {
  if (!material?.id || !material.url || !['image', 'video', 'audio', 'model3d'].includes(material.type)) return null
  const type = material.type
  const node = createFlowNode(type === 'model3d' ? 'model_3d' : type, position)
  const title = material.title || ''
  const explicitIndex = readComparisonIndex(material.metadata?.comparisonIndex)
  const comparison = type !== 'video'
    ? { title, comparisonIndex: 0 }
    : explicitIndex
      ? { title: stripComparisonTitleSuffix(title), comparisonIndex: explicitIndex }
      : restoreComparisonTitle({ title, comparisonIndex: material.source === 'upload' ? 0 : material.metadata?.comparisonIndex })
  node.position = {
    x: position.x - (node.width || 300) / 2,
    y: position.y - (node.height || 200) / 2,
  }
  node.data = {
    ...node.data,
    title: comparison.title || '作品资产',
    ...(comparison.comparisonIndex > 0 ? { comparisonIndex: comparison.comparisonIndex } : {}),
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
