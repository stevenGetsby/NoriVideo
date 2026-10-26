import type { FrameosMaterialItem } from './contracts'
import { characterVoiceMaterialId } from '@/lib/frameos/character-voice-reference'
import { frameosAssetCategoryFromMetadata } from '@/lib/frameos/material-category'

export type CharacterVoiceBindingState = 'bound' | 'missing' | null

export function characterVoiceBindingState(
  material: Pick<FrameosMaterialItem, 'type' | 'metadata' | 'voice'>,
): CharacterVoiceBindingState {
  if (material.type !== 'image') return null
  if (frameosAssetCategoryFromMetadata(material.metadata) !== 'character') return null
  return material.voice || characterVoiceMaterialId(material.metadata) ? 'bound' : 'missing'
}

export function characterVoiceBindingStats(
  materials: Array<Pick<FrameosMaterialItem, 'type' | 'metadata' | 'voice'>>,
) {
  const characterMaterials = materials.filter((material) => characterVoiceBindingState(material) !== null)
  const bound = characterMaterials.filter((material) => characterVoiceBindingState(material) === 'bound').length
  return {
    total: characterMaterials.length,
    bound,
    missing: characterMaterials.length - bound,
  }
}
