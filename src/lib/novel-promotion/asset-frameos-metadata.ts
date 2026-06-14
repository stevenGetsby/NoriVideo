import {
  normalizeAssetVariants,
  normalizeCoverageEpisodes,
  type CharacterAssetVariant,
  type CoverageEpisode,
} from './character-profile-metadata'

export const ASSET_FRAMEOS_METADATA_KEY = '_frameosAssetMetadata'

export type AssetFrameOSMetadata = {
  asset_kind: 'environment' | 'item'
  environment_id?: string
  item_id?: string
  item_type?: string
  name?: string
  int_ext?: string
  summary?: string
  description?: string
  background?: string
  entrance?: string
  mood?: string
  base_ambience?: string
  significance?: string
  coverage_scenes?: string[]
  coverage_episodes?: CoverageEpisode[]
  prompt?: string
  variants?: CharacterAssetVariant[]
  design_image?: unknown
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readText(item)).filter(Boolean)
}

export function buildEnvironmentFrameOSMetadata(input: Record<string, unknown>): AssetFrameOSMetadata | null {
  const metadata: AssetFrameOSMetadata = { asset_kind: 'environment' }
  const environmentId = readText(input.environment_id)
  if (environmentId) metadata.environment_id = environmentId
  const name = readText(input.name)
  if (name) metadata.name = name
  const intExt = readText(input.int_ext)
  if (intExt) metadata.int_ext = intExt
  const summary = readText(input.summary)
  if (summary) metadata.summary = summary
  const description = readText(input.description)
  if (description) metadata.description = description
  const background = readText(input.background)
  if (background) metadata.background = background
  const entrance = readText(input.entrance)
  if (entrance) metadata.entrance = entrance
  const mood = readText(input.mood)
  if (mood) metadata.mood = mood
  const baseAmbience = readText(input.base_ambience)
  if (baseAmbience) metadata.base_ambience = baseAmbience
  const coverageScenes = toStringArray(input.coverage_scenes)
  if (coverageScenes.length > 0) metadata.coverage_scenes = coverageScenes
  const coverageEpisodes = normalizeCoverageEpisodes(input.coverage_episodes)
  if (coverageEpisodes.length > 0) metadata.coverage_episodes = coverageEpisodes
  const prompt = readText(input.prompt)
  if (prompt) metadata.prompt = prompt
  const variants = normalizeAssetVariants(input.variants)
  if (variants.length > 0) metadata.variants = variants
  if (input.design_image !== undefined) metadata.design_image = input.design_image

  return Object.keys(metadata).length > 1 ? metadata : null
}

export function buildItemFrameOSMetadata(input: Record<string, unknown>): AssetFrameOSMetadata | null {
  const metadata: AssetFrameOSMetadata = { asset_kind: 'item' }
  const itemId = readText(input.item_id)
  if (itemId) metadata.item_id = itemId
  const name = readText(input.name)
  if (name) metadata.name = name
  const itemType = readText(input.item_type)
  if (itemType) metadata.item_type = itemType
  const summary = readText(input.summary)
  if (summary) metadata.summary = summary
  const description = readText(input.description)
  if (description) metadata.description = description
  const background = readText(input.background)
  if (background) metadata.background = background
  const significance = readText(input.significance)
  if (significance) metadata.significance = significance
  const coverageScenes = toStringArray(input.coverage_scenes)
  if (coverageScenes.length > 0) metadata.coverage_scenes = coverageScenes
  const coverageEpisodes = normalizeCoverageEpisodes(input.coverage_episodes)
  if (coverageEpisodes.length > 0) metadata.coverage_episodes = coverageEpisodes
  const prompt = readText(input.prompt)
  if (prompt) metadata.prompt = prompt
  const variants = normalizeAssetVariants(input.variants)
  if (variants.length > 0) metadata.variants = variants
  if (input.design_image !== undefined) metadata.design_image = input.design_image

  return Object.keys(metadata).length > 1 ? metadata : null
}
