import {
  normalizeAssetVariants,
  normalizeCoverageEpisodes,
  type CharacterAssetVariant,
  type CoverageEpisode,
} from './character-profile-metadata'

export const CHARACTER_APPEARANCE_FRAMEOS_METADATA_KEY = '_frameosAppearanceMetadata'

export type CharacterAppearanceFrameOSMetadata = {
  appearance_id?: string | number
  appearance_index?: number
  change_reason?: string
  coverage_episodes?: CoverageEpisode[]
  variant_id?: string | number
  variant_type?: string
  label?: string
  prompt?: string
  coverage_scenes?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readId(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = readText(value)
  return text || undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readText(item)).filter(Boolean)
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export function parseCharacterDescriptionValues(value: unknown): string[] {
  const parsed = parseMaybeJson(value)
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === 'string')
  }
  if (isRecord(parsed) && Array.isArray(parsed.values)) {
    return parsed.values.filter((item): item is string => typeof item === 'string')
  }
  return []
}

export function readFrameOSAppearanceMetadataFromDescriptions(value: unknown): CharacterAppearanceFrameOSMetadata | null {
  const parsed = parseMaybeJson(value)
  if (!isRecord(parsed)) return null
  const metadata = parsed[CHARACTER_APPEARANCE_FRAMEOS_METADATA_KEY]
  return isRecord(metadata) ? (metadata as CharacterAppearanceFrameOSMetadata) : null
}

export function stringifyCharacterDescriptionsWithFrameOSMetadata(
  values: string[],
  metadata: CharacterAppearanceFrameOSMetadata | null,
): string {
  const cleanValues = values.map((item) => item.trim()).filter(Boolean)
  if (!metadata || Object.keys(metadata).length === 0) return JSON.stringify(cleanValues)
  return JSON.stringify({
    values: cleanValues,
    [CHARACTER_APPEARANCE_FRAMEOS_METADATA_KEY]: metadata,
  })
}

export function buildCharacterAppearanceFrameOSMetadata(input: {
  appearance: Record<string, unknown>
  profile: Record<string, unknown>
  appearanceIndex: number
}): CharacterAppearanceFrameOSMetadata | null {
  const appearanceId = readId(input.appearance.id)
  const changeReason = readText(input.appearance.change_reason)
  const expectedAppearances = Array.isArray(input.profile.expected_appearances)
    ? input.profile.expected_appearances.filter(isRecord)
    : []
  const variants = normalizeAssetVariants(input.profile.variants)

  const expected = expectedAppearances.find((item) => {
    const expectedId = readId(item.id)
    if (appearanceId !== undefined && expectedId !== undefined && String(appearanceId) === String(expectedId)) return true
    return changeReason && readText(item.change_reason) === changeReason
  }) ?? expectedAppearances[input.appearanceIndex]

  const variant = variants.find((item: CharacterAssetVariant) => {
    if (appearanceId !== undefined && item.variant_id !== undefined && String(item.variant_id) === String(appearanceId)) return true
    return changeReason && (item.label === changeReason || item.variant_type === changeReason)
  }) ?? variants[input.appearanceIndex]

  const metadata: CharacterAppearanceFrameOSMetadata = {}
  if (appearanceId !== undefined) metadata.appearance_id = appearanceId
  const outputIndex = readNumber(input.appearance.id) ?? input.appearanceIndex
  metadata.appearance_index = outputIndex
  if (changeReason) metadata.change_reason = changeReason

  const expectedCoverageEpisodes = expected ? normalizeCoverageEpisodes(expected.coverage_episodes) : []
  if (expectedCoverageEpisodes.length > 0) metadata.coverage_episodes = expectedCoverageEpisodes

  if (variant?.variant_id !== undefined) metadata.variant_id = variant.variant_id
  if (variant?.variant_type) metadata.variant_type = variant.variant_type
  if (variant?.label) metadata.label = variant.label
  if (variant?.prompt) metadata.prompt = variant.prompt
  const variantCoverageScenes = variant?.coverage_scenes ?? []
  if (variantCoverageScenes.length > 0) metadata.coverage_scenes = variantCoverageScenes
  if (!metadata.coverage_episodes && variant?.coverage_episodes && variant.coverage_episodes.length > 0) {
    metadata.coverage_episodes = variant.coverage_episodes
  }

  const profileCoverageScenes = toStringArray(input.profile.coverage_scenes)
  if (!metadata.coverage_scenes && profileCoverageScenes.length > 0) metadata.coverage_scenes = profileCoverageScenes
  const profileCoverageEpisodes = normalizeCoverageEpisodes(input.profile.coverage_episodes)
  if (!metadata.coverage_episodes && profileCoverageEpisodes.length > 0) metadata.coverage_episodes = profileCoverageEpisodes

  return Object.keys(metadata).length > 0 ? metadata : null
}
