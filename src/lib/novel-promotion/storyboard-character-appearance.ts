import {
  readFrameOSAppearanceMetadataFromDescriptions,
} from './character-appearance-frameos-metadata'

export type StoryboardAppearanceOption = {
  id?: string | null
  label: string
  isPrimary?: boolean
  coverageEpisodes?: Array<string | number>
  coverageScenes?: string[]
}

export type StoryboardAppearanceSelectionContext = {
  episodeNumber: number
  sceneId?: string | null
  requestedAppearance?: string | null
  sourceText?: string | null
  preferScopedCoverageOverPrimaryRequest?: boolean
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function normalize(value: unknown): string {
  return compact(value).toLocaleLowerCase('zh-CN').replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function episodeNumbers(value: string | number): number[] {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return [value]
  const text = compact(value)
  const numbers = new Set(Array.from(text.matchAll(/\d+/g))
    .map((matched) => Number(matched[0]))
    .filter((parsed) => Number.isInteger(parsed) && parsed > 0))
  for (const matched of text.matchAll(/(\d+)\s*(?:-|—|–|~|～|至|到)\s*(?:E|第)?\s*(\d+)/gi)) {
    const start = Number(matched[1])
    const end = Number(matched[2])
    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start || end - start > 500) continue
    for (let episode = start; episode <= end; episode += 1) numbers.add(episode)
  }
  return Array.from(numbers)
}

function episodeHit(option: StoryboardAppearanceOption, target: number): boolean {
  return (option.coverageEpisodes || []).some((item) => episodeNumbers(item).includes(target))
}

function sceneHit(option: StoryboardAppearanceOption, sceneId: string): boolean {
  const target = normalize(sceneId)
  return Boolean(target) && (option.coverageScenes || []).some((item) => {
    const candidate = normalize(item)
    return candidate === target || candidate.includes(target) || target.includes(candidate)
  })
}

/**
 * Selects an appearance without guessing from array order. Explicit storyboard
 * binding wins, then scene coverage, then episode coverage, and finally the
 * primary appearance. An unscoped variant is never selected implicitly.
 */
export function selectStoryboardCharacterAppearance<T extends StoryboardAppearanceOption>(
  options: readonly T[],
  context: StoryboardAppearanceSelectionContext,
): T | null {
  if (options.length === 0) return null
  const requested = normalize(context.requestedAppearance)
  const source = normalize(context.sourceText)
  const sceneId = compact(context.sceneId)

  const ranked = options.map((option, index) => {
    const label = normalize(option.label)
    const id = normalize(option.id)
    const matchesEpisode = episodeHit(option, context.episodeNumber)
    const hasEpisodeScope = (option.coverageEpisodes || []).length > 0
    const matchesScene = Boolean(sceneId)
      && sceneHit(option, sceneId)
      && (!hasEpisodeScope || matchesEpisode)
    let score = option.isPrimary ? 100 : 0
    if (requested && (requested === label || requested === id)) {
      score = context.preferScopedCoverageOverPrimaryRequest && option.isPrimary ? 500 : 1_000
    } else if (requested && label && (requested.includes(label) || label.includes(requested))) {
      score = context.preferScopedCoverageOverPrimaryRequest && option.isPrimary ? 500 : 950
    }
    else if (source && label && source.includes(label)) score = 900
    else if (matchesScene) score = 700
    else if (matchesEpisode) score = 600

    // The primary appearance usually carries the character's broad valid range,
    // while variants describe a narrower state inside that range. When both
    // cover the same scene/episode, the scoped variant is therefore the more
    // specific binding. Do not let the generic primary win that tie.
    const scopedVariant = !option.isPrimary && (score === 700 || score === 600)
    const scopeBreadth = score === 700
      ? (option.coverageScenes || []).length
      : score === 600
        ? (option.coverageEpisodes || []).flatMap(episodeNumbers).length
        : Number.POSITIVE_INFINITY
    return { option, index, score, scopedVariant, scopeBreadth }
  }).sort((left, right) => (
    right.score - left.score
    || Number(right.scopedVariant) - Number(left.scopedVariant)
    || left.scopeBreadth - right.scopeBreadth
    || Number(Boolean(right.option.isPrimary)) - Number(Boolean(left.option.isPrimary))
    || left.index - right.index
  ))

  const winner = ranked[0]
  if (!winner || winner.score <= 0) {
    return options.find((option) => option.isPrimary) || null
  }
  return winner.option
}

export function databaseAppearanceOptions(appearances: ReadonlyArray<{
  id?: string | null
  appearanceIndex?: number | null
  changeReason?: string | null
  descriptions?: string | null
}>): StoryboardAppearanceOption[] {
  if (appearances.length === 0) return []
  const ordered = appearances
    .map((appearance, originalIndex) => ({ appearance, originalIndex }))
    .sort((left, right) => (
      (left.appearance.appearanceIndex ?? left.originalIndex)
      - (right.appearance.appearanceIndex ?? right.originalIndex)
    ))
  return ordered.map(({ appearance, originalIndex }, orderedIndex) => {
    const metadata = readFrameOSAppearanceMetadataFromDescriptions(appearance.descriptions)
    return {
      id: appearance.id,
      label: compact(metadata?.label) || compact(appearance.changeReason) || `形象 ${(appearance.appearanceIndex ?? originalIndex) + 1}`,
      isPrimary: orderedIndex === 0,
      coverageEpisodes: metadata?.coverage_episodes || [],
      coverageScenes: metadata?.coverage_scenes || [],
    }
  })
}
