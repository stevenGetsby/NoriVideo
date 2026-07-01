import type {
  AssetExtractionPackage,
  CharacterAsset,
  CharacterImportance,
  CharacterMainAppearance,
  CharacterPeriodFacts,
  CharacterVariant,
  CharacterVisualProfile,
  EnvironmentAsset,
  ExtractionWarning,
  PropAsset,
  SourceEvidence,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  }
  return 0
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueStrings(value.map(readString).filter(Boolean))
}

function readIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return uniqueNumbers(value.map(readInt).filter((item) => item > 0))
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function normalizeImportance(value: unknown): CharacterImportance {
  if (value === 'lead' || value === 'core_supporting' || value === 'supporting') return value
  return 'supporting'
}

function normalizeEvidence(value: unknown): SourceEvidence[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): SourceEvidence | null => {
      if (!isRecord(item)) return null
      const episodeNumber = readInt(item.episodeNumber)
      const quote = readString(item.quote)
      if (!episodeNumber || !quote) return null
      return { episodeNumber, quote }
    })
    .filter((item): item is SourceEvidence => !!item)
}

function normalizeVisualProfile(value: unknown): CharacterVisualProfile {
  const record = isRecord(value) ? value : {}
  return {
    subject: readString(record.subject),
    face: readString(record.face),
    clothing: readString(record.clothing),
    accessories: readString(record.accessories),
  }
}

function mergeProfileFallback(
  value: CharacterVisualProfile,
  fallback: CharacterVisualProfile,
): CharacterVisualProfile {
  return {
    subject: value.subject || fallback.subject,
    face: value.face || fallback.face,
    clothing: value.clothing || fallback.clothing,
    accessories: value.accessories || fallback.accessories,
  }
}

function normalizeProfileOverride(value: unknown): Partial<CharacterVisualProfile> {
  const record = isRecord(value) ? value : {}
  return {
    ...(readString(record.subject) ? { subject: readString(record.subject) } : {}),
    ...(readString(record.face) ? { face: readString(record.face) } : {}),
    ...(readString(record.clothing) ? { clothing: readString(record.clothing) } : {}),
    ...(readString(record.accessories) ? { accessories: readString(record.accessories) } : {}),
  }
}

function normalizePeriodFacts(value: unknown, fallback: {
  identity?: string
  socialStatus?: string
  plotState?: string
  explicitVisualCues?: string[]
} = {}): CharacterPeriodFacts {
  const record = isRecord(value) ? value : {}
  const explicitVisualCues = readStringArray(record.explicitVisualCues)
  return {
    identity: readString(record.identity) || fallback.identity || '',
    socialStatus: readString(record.socialStatus) || fallback.socialStatus || '',
    plotState: readString(record.plotState) || fallback.plotState || '',
    explicitVisualCues: explicitVisualCues.length > 0
      ? explicitVisualCues
      : (fallback.explicitVisualCues || []),
  }
}

function ensureDraftVisualProfile(
  profile: CharacterVisualProfile,
  facts: CharacterPeriodFacts,
  periodName: string,
): CharacterVisualProfile {
  const identity = facts.identity || periodName
  const cues = facts.explicitVisualCues.slice(0, 3).join('、') || '无明确视觉线索'
  return {
    subject: profile.subject || `主体初稿：${identity}。`,
    face: profile.face || `面部初稿：保留原文线索：${cues}。`,
    clothing: profile.clothing || `服装初稿：按${identity}身份在视觉设定阶段补全。`,
    accessories: profile.accessories || `配饰初稿：保留原文线索：${cues}。`,
  }
}

function normalizeVariants(value: unknown, characterId: string): CharacterVariant[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index): CharacterVariant | null => {
      if (!isRecord(item)) return null
      const name = readString(item.name)
      const range = isRecord(item.episodeRange) ? item.episodeRange : {}
      const start = readInt(range.start)
      const end = readInt(range.end) || start
      if (!name || !start) return null
      return {
        id: readString(item.id) || `${characterId}-variant-${slug(name, String(index + 1))}`,
        name,
        episodeRange: { start, end: Math.max(start, end) },
        facts: normalizePeriodFacts(item.facts, {
          identity: name,
          socialStatus: readString(item.backgroundDelta),
          plotState: readString(item.reason),
          explicitVisualCues: normalizeEvidence(item.evidence).map((evidence) => evidence.quote),
        }),
        backgroundDelta: readString(item.backgroundDelta),
        profileOverride: normalizeProfileOverride(item.profileOverride),
        reason: readString(item.reason),
        evidence: normalizeEvidence(item.evidence),
      }
    })
    .filter((item): item is CharacterVariant => !!item)
}

function readEpisodeRange(value: unknown, fallbackEpisodes: number[]) {
  const range = isRecord(value) ? value : {}
  const fallbackStart = fallbackEpisodes[0] || 1
  const fallbackEnd = fallbackEpisodes.at(-1) || fallbackStart
  const start = readInt(range.start) || fallbackStart
  const end = readInt(range.end) || fallbackEnd || start
  return {
    start,
    end: Math.max(start, end),
  }
}

function normalizeMainAppearance(input: {
  value: unknown
  characterId: string
  profile: CharacterVisualProfile
  relatedEpisodes: number[]
  evidence: SourceEvidence[]
}): CharacterMainAppearance {
  const record = isRecord(input.value) ? input.value : {}
  const name = readString(record.name) || '主形象时期'
  const facts = normalizePeriodFacts(record.facts, {
    identity: name,
    socialStatus: readString(record.reason),
    plotState: readString(record.reason),
    explicitVisualCues: input.evidence.map((evidence) => evidence.quote),
  })
  const profile = ensureDraftVisualProfile(
    mergeProfileFallback(
      normalizeVisualProfile(record.profile),
      input.profile,
    ),
    facts,
    name,
  )
  return {
    id: readString(record.id) || `${input.characterId}-main-appearance`,
    name,
    episodeRange: readEpisodeRange(record.episodeRange, input.relatedEpisodes),
    facts,
    profile,
    reason: readString(record.reason) || '角色默认主形象，用于资产定稿图和多数常规镜头复用。',
    evidence: normalizeEvidence(record.evidence).length > 0
      ? normalizeEvidence(record.evidence)
      : input.evidence,
  }
}

function normalizeCharacters(value: unknown): CharacterAsset[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index): CharacterAsset | null => {
      if (!isRecord(item)) return null
      const name = readString(item.name)
      if (!name) return null
      const id = readString(item.id) || `character-${slug(name, String(index + 1))}`
      const profile = normalizeVisualProfile(item.profile)
      const relatedEpisodes = readIntArray(item.relatedEpisodes)
      const evidence = normalizeEvidence(item.evidence)
      const mainAppearance = normalizeMainAppearance({
        value: item.mainAppearance,
        characterId: id,
        profile,
        relatedEpisodes,
        evidence,
      })
      return {
        id,
        name,
        aliases: readStringArray(item.aliases),
        importance: normalizeImportance(item.importance),
        background: readString(item.background),
        mainAppearance,
        profile: mainAppearance.profile,
        variants: normalizeVariants(item.variants, id),
        relatedEpisodes,
        evidence,
      }
    })
    .filter((item): item is CharacterAsset => !!item)
}

function normalizeEnvironments(value: unknown): EnvironmentAsset[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index): EnvironmentAsset | null => {
      if (!isRecord(item)) return null
      const name = readString(item.name)
      if (!name) return null
      const profile = isRecord(item.profile) ? item.profile : {}
      return {
        id: readString(item.id) || `environment-${slug(name, String(index + 1))}`,
        name,
        background: readString(item.background),
        profile: {
          subject: readString(profile.subject),
          layout: readString(profile.layout),
          atmosphere: readString(profile.atmosphere),
          visualDetails: readString(profile.visualDetails),
        },
        relatedEpisodes: readIntArray(item.relatedEpisodes),
        evidence: normalizeEvidence(item.evidence),
      }
    })
    .filter((item): item is EnvironmentAsset => !!item)
}

function normalizeProps(value: unknown): PropAsset[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index): PropAsset | null => {
      if (!isRecord(item)) return null
      const name = readString(item.name)
      if (!name) return null
      const profile = isRecord(item.profile) ? item.profile : {}
      const owner = readString(item.owner)
      return {
        id: readString(item.id) || `prop-${slug(name, String(index + 1))}`,
        name,
        background: readString(item.background),
        profile: {
          subject: readString(profile.subject),
          material: readString(profile.material),
          shape: readString(profile.shape),
          visualDetails: readString(profile.visualDetails),
        },
        ...(owner ? { owner } : {}),
        relatedEpisodes: readIntArray(item.relatedEpisodes),
        evidence: normalizeEvidence(item.evidence),
      }
    })
    .filter((item): item is PropAsset => !!item)
}

function normalizeWarnings(value: unknown): ExtractionWarning[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): ExtractionWarning | null => {
      if (typeof item === 'string') {
        const message = readString(item)
        return message ? { code: 'LOW_CONFIDENCE', message } : null
      }
      if (!isRecord(item)) return null
      const message = readString(item.message)
      if (!message) return null
      const code = item.code === 'EMPTY_SECTION' || item.code === 'LOW_CONFIDENCE' || item.code === 'NORMALIZED_FIELD'
        ? item.code
        : 'LOW_CONFIDENCE'
      const targetId = readString(item.targetId)
      return {
        code,
        message,
        ...(targetId ? { targetId } : {}),
      }
    })
    .filter((item): item is ExtractionWarning => !!item)
}

export function normalizeAssetExtractionPackage(raw: unknown): AssetExtractionPackage {
  const record = isRecord(raw) ? raw : {}
  const pkg: AssetExtractionPackage = {
    version: 'asset-extraction-v1',
    worldBackground: readString(record.worldBackground),
    characters: normalizeCharacters(record.characters),
    environments: normalizeEnvironments(record.environments),
    props: normalizeProps(record.props),
    warnings: normalizeWarnings(record.warnings),
  }
  return validateAssetExtractionPackage(pkg)
}

export function validateAssetExtractionPackage(pkg: AssetExtractionPackage): AssetExtractionPackage {
  if (pkg.version !== 'asset-extraction-v1') {
    throw new Error('asset extraction package version invalid')
  }
  if (!pkg.worldBackground) {
    throw new Error('asset extraction worldBackground is required')
  }
  if (!Array.isArray(pkg.characters) || !Array.isArray(pkg.environments) || !Array.isArray(pkg.props)) {
    throw new Error('asset extraction arrays are required')
  }
  for (const character of pkg.characters) {
    if (!character.background) throw new Error(`character background is required: ${character.name}`)
    if (!character.profile.subject || !character.profile.face || !character.profile.clothing) {
      throw new Error(`character visual profile is incomplete: ${character.name}`)
    }
    if (!character.mainAppearance.name || !character.mainAppearance.episodeRange.start) {
      throw new Error(`character main appearance is incomplete: ${character.name}`)
    }
    if (
      !character.mainAppearance.profile.subject ||
      !character.mainAppearance.profile.face ||
      !character.mainAppearance.profile.clothing
    ) {
      throw new Error(`character main appearance profile is incomplete: ${character.name}`)
    }
  }
  return pkg
}
