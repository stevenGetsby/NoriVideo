import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  firstLastFrameInputSchema,
  imageToVideoInputSchema,
  resolveCanvasGenerationInputSchema,
  type CanvasGenerationInputSchema,
} from '@/lib/canvas/generation-input-schema'

export type MaterialReferenceTargetType = 'image' | 'video' | 'audio'

export type MaterialReferenceTarget = {
  type: MaterialReferenceTargetType
  modelKey?: string | null
  inputMode?: 'text' | 'image' | 'firstlastframe' | null
  inputSchema?: CanvasGenerationInputSchema | null
}

export function resolveMaterialReferenceSchema(target: MaterialReferenceTarget) {
  if (target.type === 'video' && target.inputMode === 'firstlastframe') {
    return firstLastFrameInputSchema()
  }
  if (target.type === 'video' && target.inputMode === 'image') {
    const maxImages = target.inputSchema?.image.max
    return imageToVideoInputSchema(typeof maxImages === 'number' ? maxImages : 9)
  }
  return target.inputSchema || resolveCanvasGenerationInputSchema(target.type)
}

/**
 * Keep bulk drag-and-drop within the same model limits as the reference
 * picker. Existing references are supplied as material media types because the
 * target node may contain references that are not connected by an edge.
 */
export function selectMaterialsForReferenceLimits(
  materials: FrameosMaterialItem[],
  target: MaterialReferenceTarget,
  existingTypes: Array<'image' | 'video' | 'audio'> = [],
): FrameosMaterialItem[] {
  const schema = resolveMaterialReferenceSchema(target)
  const remaining: Record<'image' | 'video' | 'audio', number> = {
    image: Math.max(0, schema.image.max - existingTypes.filter((type) => type === 'image').length),
    video: Math.max(0, schema.video.max - existingTypes.filter((type) => type === 'video').length),
    audio: Math.max(0, schema.audio.max - existingTypes.filter((type) => type === 'audio').length),
  }
  return materials.filter((material) => {
    if (material.type !== 'image' && material.type !== 'video' && material.type !== 'audio') return false
    if (remaining[material.type] <= 0) return false
    remaining[material.type] -= 1
    return true
  })
}
