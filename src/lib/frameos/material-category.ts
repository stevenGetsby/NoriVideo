export const FRAMEOS_ASSET_CATEGORIES = ['character', 'location', 'prop', 'shot', 'other'] as const

export type FrameosAssetCategory = typeof FRAMEOS_ASSET_CATEGORIES[number]

export const FRAMEOS_ASSET_CATEGORY_LABELS: Record<FrameosAssetCategory, string> = {
  character: '角色资产',
  location: '场景资产',
  prop: '道具资产',
  shot: '镜头素材',
  other: '普通素材',
}

export function isFrameosAssetCategory(value: unknown): value is FrameosAssetCategory {
  return typeof value === 'string' && FRAMEOS_ASSET_CATEGORIES.includes(value as FrameosAssetCategory)
}

export function normalizeFrameosAssetCategory(value: unknown): FrameosAssetCategory {
  return isFrameosAssetCategory(value)
    ? value
    : 'other'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function frameosAssetCategoryFromMetadata(metadata: unknown): FrameosAssetCategory {
  const source = record(metadata)
  if (typeof source.assetCategory === 'string') {
    return normalizeFrameosAssetCategory(source.assetCategory)
  }
  const originType = typeof source.originType === 'string' ? source.originType.toLowerCase() : ''
  if (originType.includes('character')) return 'character'
  if (originType.includes('prop') || originType.includes('item')) return 'prop'
  if (originType.includes('location') || originType.includes('environment')) return 'location'
  if (originType.includes('panel') || originType.includes('shot') || originType.includes('video')) return 'shot'
  return 'other'
}

export function withFrameosAssetCategory(
  metadata: unknown,
  category: unknown,
): Record<string, unknown> {
  return {
    ...record(metadata),
    assetCategory: normalizeFrameosAssetCategory(category),
  }
}

export type FrameosCharacterBinding = {
  characterId: string
  characterName: string | null
}

export function frameosCharacterBindingFromMetadata(metadata: unknown): FrameosCharacterBinding | null {
  const source = record(metadata)
  const characterId = typeof source.characterId === 'string' ? source.characterId.trim() : ''
  if (!characterId) return null
  const characterName = typeof source.characterName === 'string' && source.characterName.trim()
    ? source.characterName.trim()
    : null
  return { characterId, characterName }
}

export function withFrameosCharacterBinding(
  metadata: unknown,
  binding: FrameosCharacterBinding | null,
): Record<string, unknown> {
  const next = { ...record(metadata) }
  if (!binding?.characterId.trim()) {
    delete next.characterId
    delete next.characterName
    return next
  }
  next.characterId = binding.characterId.trim()
  if (binding.characterName?.trim()) next.characterName = binding.characterName.trim()
  else delete next.characterName
  return next
}
