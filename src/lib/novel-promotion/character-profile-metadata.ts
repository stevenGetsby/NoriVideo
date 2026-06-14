export type CoverageEpisode = string | number

export type CharacterExpectedAppearance = {
  id?: string | number
  change_reason?: string
  coverage_episodes?: CoverageEpisode[]
}

export type CharacterAssetVariant = {
  variant_id?: string | number
  label?: string
  variant_type?: string
  prompt?: string
  coverage_scenes?: string[]
  coverage_episodes?: CoverageEpisode[]
}

export function normalizeCoverageEpisodes(value: unknown): CoverageEpisode[] {
  if (!Array.isArray(value)) return []
  const episodes: CoverageEpisode[] = []
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      episodes.push(item)
      continue
    }
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed) episodes.push(trimmed)
    }
  }
  return episodes
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readId(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  return undefined
}

export function normalizeExpectedAppearances(value: unknown): CharacterExpectedAppearance[] {
  if (!Array.isArray(value)) return []
  const appearances: CharacterExpectedAppearance[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const appearance: CharacterExpectedAppearance = {}
    const id = readId(source.id)
    const changeReason = readText(source.change_reason)
    const coverageEpisodes = normalizeCoverageEpisodes(source.coverage_episodes)

    if (id !== undefined) appearance.id = id
    if (changeReason) appearance.change_reason = changeReason
    if (coverageEpisodes.length > 0) appearance.coverage_episodes = coverageEpisodes

    if (appearance.id !== undefined || appearance.change_reason || appearance.coverage_episodes) {
      appearances.push(appearance)
    }
  }

  return appearances
}

export function normalizeAssetVariants(value: unknown): CharacterAssetVariant[] {
  if (!Array.isArray(value)) return []
  const variants: CharacterAssetVariant[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const variant: CharacterAssetVariant = {}
    const id = readId(source.variant_id)
    const label = readText(source.label)
    const variantType = readText(source.variant_type)
    const prompt = readText(source.prompt)
    const coverageScenes = Array.isArray(source.coverage_scenes)
      ? source.coverage_scenes.map((scene) => readText(scene)).filter(Boolean)
      : []
    const coverageEpisodes = normalizeCoverageEpisodes(source.coverage_episodes)

    if (id !== undefined) variant.variant_id = id
    if (label) variant.label = label
    if (variantType) variant.variant_type = variantType
    if (prompt) variant.prompt = prompt
    if (coverageScenes.length > 0) variant.coverage_scenes = coverageScenes
    if (coverageEpisodes.length > 0) variant.coverage_episodes = coverageEpisodes

    if (
      variant.variant_id !== undefined ||
      variant.label ||
      variant.variant_type ||
      variant.prompt ||
      variant.coverage_scenes ||
      variant.coverage_episodes
    ) {
      variants.push(variant)
    }
  }

  return variants
}
