import { executeAiTextStep } from '@/lib/ai-runtime'
import type { AiStepExecutionResult } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildAssetExtractionPrompt } from './prompt'
import { normalizeAssetExtractionPackage } from './normalize'
import {
  applySingleCharacterVisualRefinement,
  buildCharacterVisualRefinementPrompt,
} from './visual-refinement'
import type {
  AssetExtractionEpisodeInput,
  AssetExtractionPackage,
  CharacterAsset,
  CharacterImportance,
  CharacterMainAppearance,
  CharacterPeriodFacts,
  CharacterVariant,
  CharacterVisualProfile,
  EnvironmentAsset,
  ExecuteAssetExtractionInput,
  ExtractionWarning,
  PropAsset,
  SourceEvidence,
} from './types'

type ExecuteTextStep = typeof executeAiTextStep
const EPISODES_PER_EXTRACTION_BATCH = 3
const MAX_VARIANTS_BY_IMPORTANCE: Record<CharacterImportance, number> = {
  lead: 4,
  core_supporting: 2,
  supporting: 0,
}

export type AssetExtractionExecutionParams = ExecuteAssetExtractionInput & {
  executeTextStep?: ExecuteTextStep
  batchConcurrency?: number
  batchSize?: number
  enableVisualRefinement?: boolean
}

export type AssetExtractionExecutionResult = {
  package: AssetExtractionPackage
  rawText: string
  usage: AiStepExecutionResult['usage']
}

function normalizeEpisodeInputs(episodes: ExecuteAssetExtractionInput['episodes']) {
  return episodes
    .map((episode) => ({
      episodeNumber: Number.isFinite(episode.episodeNumber)
        ? Math.max(1, Math.floor(episode.episodeNumber))
        : 0,
      title: typeof episode.title === 'string' && episode.title.trim()
        ? episode.title.trim()
        : '',
      sourceText: typeof episode.sourceText === 'string'
        ? episode.sourceText.trim()
        : '',
    }))
    .filter((episode) => episode.episodeNumber > 0 && episode.sourceText)
    .map((episode) => ({
      ...episode,
      title: episode.title || `第${episode.episodeNumber}集`,
    }))
}

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isFinite(value)) return EPISODES_PER_EXTRACTION_BATCH
  return Math.max(1, Math.min(5, Math.floor(value || EPISODES_PER_EXTRACTION_BATCH)))
}

function chunkEpisodes(episodes: AssetExtractionEpisodeInput[], batchSize = EPISODES_PER_EXTRACTION_BATCH) {
  const chunks: AssetExtractionEpisodeInput[][] = []
  for (let index = 0; index < episodes.length; index += batchSize) {
    chunks.push(episodes.slice(index, index + batchSize))
  }
  return chunks
}

function mergeUniqueStrings(left: string[], right: string[]) {
  return [...new Set([...left, ...right].map((item) => item.trim()).filter(Boolean))]
}

function mergeUniqueNumbers(left: number[], right: number[]) {
  return [...new Set([...left, ...right].filter((item) => Number.isFinite(item) && item > 0))]
    .sort((a, b) => a - b)
}

function mergeEvidence(left: SourceEvidence[], right: SourceEvidence[]) {
  const seen = new Set<string>()
  const merged: SourceEvidence[] = []
  for (const item of [...left, ...right]) {
    const key = `${item.episodeNumber}:${item.quote}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

function normalizeCastName(value: string) {
  return value
    .replace(/（[^）]*）/gu, '')
    .replace(/\([^)]*\)/gu, '')
    .replace(/【[^】]*】/gu, '')
    .replace(/\[[^\]]*\]/gu, '')
    .replace(/^(人物|角色)\s*[:：]/u, '')
    .trim()
}

function shouldIgnoreCastName(value: string) {
  const normalized = normalizeNameKey(value)
  if (!normalized) return true
  return /^(若干|多人|两名|2人|数人|尾声出场|仅提及|暗处观察|幕后|画外视角衔接)$/u.test(normalized)
}

function splitCastNames(value: string) {
  const names: string[] = []
  for (const rawPart of value.split(/[、,，]/u)) {
    const part = rawPart.trim()
    if (!part) continue

    const parentheticalMatches = [
      ...part.matchAll(/（([^）]+)）/gu),
      ...part.matchAll(/\(([^)]+)\)/gu),
    ]
    const outside = normalizeCastName(part)
    if (outside && !shouldIgnoreCastName(outside)) names.push(outside)
    for (const match of parentheticalMatches) {
      const inner = normalizeCastName(match[1])
      if (inner && !shouldIgnoreCastName(inner)) names.push(inner)
    }
  }
  return mergeUniqueStrings(names, [])
}

function extractCastMentions(episode: AssetExtractionEpisodeInput) {
  const mentions: Array<{ episodeNumber: number; names: string[]; quote: string }> = []
  const lines = episode.sourceText.split('\n')
  for (const line of lines) {
    for (const match of line.matchAll(/人物\s*[:：]\s*([^|\n]+)/gu)) {
      const names = splitCastNames(match[1])
      if (names.length === 0) continue
      mentions.push({
        episodeNumber: episode.episodeNumber,
        names,
        quote: `人物：${match[1].trim()}`,
      })
    }
  }
  return mentions
}

function candidateCharacterKeys(character: CharacterAsset) {
  return mergeUniqueStrings([character.name, ...character.aliases], [])
    .map(normalizeNameKey)
    .filter(Boolean)
}

function findFirstMentionLine(sourceText: string, names: string[]) {
  const normalizedNames = names.map((name) => name.trim()).filter(Boolean)
  if (normalizedNames.length === 0) return ''
  return sourceText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => normalizedNames.some((name) => line.includes(name))) || ''
}

function augmentCharacterCoverageFromEpisodes(
  character: CharacterAsset,
  episodes: AssetExtractionEpisodeInput[],
): CharacterAsset {
  const keys = new Set(candidateCharacterKeys(character))
  if (keys.size === 0) return character

  let relatedEpisodes = character.relatedEpisodes
  let evidence = character.evidence
  for (const episode of episodes) {
    const castMentions = extractCastMentions(episode)
    const matchedCast = castMentions.find((mention) =>
      mention.names.some((name) => keys.has(normalizeNameKey(name))))
    if (matchedCast) {
      relatedEpisodes = mergeUniqueNumbers(relatedEpisodes, [episode.episodeNumber])
      evidence = mergeEvidence(evidence, [{
        episodeNumber: episode.episodeNumber,
        quote: matchedCast.quote,
      }])
      continue
    }

    const names = mergeUniqueStrings([character.name, ...character.aliases], [])
      .filter((name) => name.length > 1 || name === '我')
    const mentionLine = findFirstMentionLine(episode.sourceText, names)
    if (mentionLine) {
      relatedEpisodes = mergeUniqueNumbers(relatedEpisodes, [episode.episodeNumber])
      evidence = mergeEvidence(evidence, [{
        episodeNumber: episode.episodeNumber,
        quote: mentionLine.slice(0, 180),
      }])
    }
  }

  return {
    ...character,
    relatedEpisodes,
    evidence,
  }
}

function limitEvidence(items: SourceEvidence[], maxItems = 6) {
  return items.slice(0, maxItems)
}

function preferLonger(left: string, right: string) {
  return right.length > left.length ? right : left
}

function countProfileText(profile: CharacterVisualProfile) {
  return profile.subject.length + profile.face.length + profile.clothing.length + profile.accessories.length
}

function preferProfile(left: CharacterVisualProfile, right: CharacterVisualProfile): CharacterVisualProfile {
  return countProfileText(right) > countProfileText(left) ? right : left
}

function mergeTextParts(parts: string[], maxParts = 3) {
  return mergeUniqueStrings(parts, [])
    .slice(0, maxParts)
    .join('；')
}

function mergePeriodFacts(left: CharacterPeriodFacts, right: CharacterPeriodFacts): CharacterPeriodFacts {
  return {
    identity: preferLonger(left.identity, right.identity),
    socialStatus: preferLonger(left.socialStatus, right.socialStatus),
    plotState: mergeTextParts([left.plotState, right.plotState], 3),
    explicitVisualCues: mergeUniqueStrings(left.explicitVisualCues, right.explicitVisualCues).slice(0, 8),
  }
}

function importanceRank(value: CharacterImportance) {
  if (value === 'lead') return 3
  if (value === 'core_supporting') return 2
  return 1
}

function mergeImportance(left: CharacterImportance, right: CharacterImportance): CharacterImportance {
  return importanceRank(right) > importanceRank(left) ? right : left
}

function normalizeNameKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[“”"‘’'《》（）()\[\]【】{}·,，.。:：;；、\s_-]+/gu, '')
    .replace(/的/gu, '')
}

function normalizeVariantNameKey(value: string) {
  return normalizeNameKey(value)
    .replace(/视觉阶段$/u, '')
    .replace(/阶段$/u, '')
    .replace(/时期$/u, '')
    .replace(/状态$/u, '')
    .replace(/期$/u, '')
}

function stripVariantPhaseSuffix(value: string) {
  return value
    .trim()
    .replace(/视觉阶段$/u, '')
    .replace(/阶段$/u, '')
    .replace(/时期$/u, '')
    .replace(/状态$/u, '')
    .replace(/期$/u, '')
}

function isGenericVariantLabel(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/gu, '')
  return /^第?\d+(?:-\d+)?集?(?:视觉)?(?:变化)?(?:阶段|时期|状态|期)?$/u.test(normalized)
}

function firstMeaningfulClause(value: string) {
  const clause = value
    .split(/[。；;，,\n]/u)
    .map((item) => item.trim())
    .find((item) => item && !isGenericVariantLabel(item))
  if (!clause) return ''
  return clause
    .replace(/^(该阶段|此阶段|角色|视觉上|状态上|背景变化[:：]?)/u, '')
    .replace(/[，,。；;：:]+$/u, '')
    .trim()
}

function compactVariantLabel(value: string, position: 'first' | 'last' = 'first') {
  const stripped = stripVariantPhaseSuffix(value)
    .replace(/视觉变化$/u, '')
    .replace(/视觉状态$/u, '')
    .replace(/状态$/u, '')
    .trim()
  if (!stripped || isGenericVariantLabel(stripped)) return ''
  const parts = stripped
    .split(/至/u)
    .map((item) => item.trim())
    .filter(Boolean)
  const selected = position === 'last' ? (parts.at(-1) || stripped) : (parts[0] || stripped)
  return selected.length > 10 ? selected.slice(0, 10) : selected
}

function normalizePeriodName(label: string, fallback: string) {
  const compact = compactVariantLabel(label) || compactVariantLabel(fallback) || '关键变化'
  return compact.endsWith('时期') ? compact : `${compact}时期`
}

function normalizeCharacterVariantName(label: string, fallback: string) {
  const compact = compactVariantLabel(label) || compactVariantLabel(fallback) || '关键变化'
  if (/(逃亡|被卖|柴房|孤女|民女|老年|童年|少年|督军夫人|侧夫人|身份升级|身份变化)/u.test(compact)) {
    return compact.endsWith('时期') ? compact : `${compact}时期`
  }
  return compact.endsWith('状态') ? compact : `${compact}状态`
}

function scorePeriodText(text: string, range?: { start: number; end: number }) {
  let score = 0
  if (/姨太|夫人|副官|督军|小姐/u.test(text)) score += 20
  if (/陆府|偏院|内宅/u.test(text)) score += 4
  if (/孤女|媒婆|丫鬟|西医|下人/u.test(text)) score += 5
  if (/常态|稳定|基准|默认|主形象/u.test(text)) score += 4
  if (/逃亡|被卖|遇袭|受辱|栽赃|败露|护胎|病危|重伤|断食|救援|狼狈/u.test(text)) score -= 8
  if (range) score += Math.max(0, range.end - range.start + 1)
  return score
}

function isGenericMainAppearanceName(value: string) {
  const normalized = normalizeNameKey(value)
  return !normalized || /^(主形象|默认主形象|常规主形象|主视觉|角色主形象)(时期)?$/u.test(normalized)
}

function inferMainAppearanceName(character: CharacterAsset) {
  if (!isGenericMainAppearanceName(character.mainAppearance.name)) {
    return normalizePeriodName(character.mainAppearance.name, '主形象')
  }
  const text = [
    character.name,
    character.background,
    character.profile.subject,
    character.profile.clothing,
    character.profile.accessories,
  ].join(' ')
  if (/督军夫人/u.test(text)) return '督军夫人时期'
  if (/侧夫人/u.test(text)) return '侧夫人时期'
  if (/姨太/u.test(text)) return '陆府姨太时期'
  if (/被贬/u.test(text) && /副官/u.test(text)) return '被贬副官时期'
  if (/副官|军官|军阀|军政/u.test(text)) return '陆府副官时期'
  if (/孤女/u.test(text) && /逃亡|被卖/u.test(text)) return '逃亡孤女时期'
  if (/媒婆/u.test(text)) return '媒婆时期'
  if (/丫鬟/u.test(text)) return '陆府丫鬟时期'
  if (/西医|医生/u.test(text)) return '西医时期'
  return `${character.name}主形象时期`
}

function scoreMainAppearance(appearance: CharacterMainAppearance) {
  return scorePeriodText([
    appearance.name,
    appearance.reason,
    appearance.profile.subject,
    appearance.profile.clothing,
    appearance.profile.accessories,
  ].join(' '), appearance.episodeRange)
}

function preferMainAppearance(
  left: CharacterMainAppearance,
  right: CharacterMainAppearance,
): CharacterMainAppearance {
  if (normalizeVariantNameKey(left.name) === normalizeVariantNameKey(right.name)) {
    return {
      ...left,
      episodeRange: {
        start: Math.min(left.episodeRange.start, right.episodeRange.start),
        end: Math.max(left.episodeRange.end, right.episodeRange.end),
      },
      facts: mergePeriodFacts(left.facts, right.facts),
      profile: preferProfile(left.profile, right.profile),
      reason: preferLonger(left.reason, right.reason),
      evidence: limitEvidence(mergeEvidence(left.evidence, right.evidence)),
    }
  }
  const preferred = scoreMainAppearance(right) > scoreMainAppearance(left) ? right : left
  return {
    ...preferred,
    evidence: limitEvidence(mergeEvidence(left.evidence, right.evidence)),
  }
}

function expandRange(range: { start: number; end: number }) {
  const values: number[] = []
  for (let episode = range.start; episode <= range.end; episode += 1) values.push(episode)
  return values
}

function identityClassTokens(value: string) {
  const normalized = normalizeNameKey(value)
  return [
    '姨太',
    '夫人',
    '侧夫人',
    '副官',
    '丫鬟',
    '西医',
    '媒婆',
    '管家',
    '恶霸',
    '同乡',
    '孤女',
  ].filter((token) => normalized.includes(token))
}

function isSameMainIdentity(mainAppearance: CharacterMainAppearance, variant: CharacterVariant) {
  const mainIdentity = normalizeNameKey([
    mainAppearance.name,
    mainAppearance.facts.identity,
    mainAppearance.facts.socialStatus,
  ].join(' '))
  const variantIdentity = normalizeNameKey([
    variant.name,
    variant.facts.identity,
    variant.facts.socialStatus,
  ].join(' '))
  if (!mainIdentity || !variantIdentity) return false
  const preHouseholdCue = /(逃亡|柴房|被卖|恶霸|土地庙|孤女|民女|雨夜|追兵|泥水)/u
  const householdConcubineCue = /(陆府|内宅|偏院|姨太|孕中|护胎)/u
  if (
    householdConcubineCue.test(mainIdentity)
    && preHouseholdCue.test(variantIdentity)
  ) {
    return false
  }
  const mainTokens = identityClassTokens(mainIdentity)
  const variantTokens = identityClassTokens(variantIdentity)
  if (mainTokens.length > 0 && variantTokens.length > 0) {
    return mainTokens.some((token) => variantTokens.includes(token))
  }
  return mainIdentity.includes(variantIdentity) || variantIdentity.includes(mainIdentity)
}

function deriveMainAppearanceEpisodes(
  character: CharacterAsset,
  variants: CharacterVariant[],
) {
  const identityChangingVariants = variants.filter((variant) =>
    !isSameMainIdentity(character.mainAppearance, variant))
  const variantEpisodes = new Set(identityChangingVariants.flatMap((variant) => expandRange(variant.episodeRange)))
  const uncovered = character.relatedEpisodes.filter((episode) => !variantEpisodes.has(episode))
  return uncovered
}

function chooseMainVariantIndex(character: CharacterAsset, variants: CharacterVariant[]) {
  const uncovered = deriveMainAppearanceEpisodes(character, variants)
  if (uncovered.length > 0 || variants.length <= 1) return -1

  const mainScore = scoreMainAppearance(character.mainAppearance)
  let bestIndex = -1
  let bestScore = mainScore
  variants.forEach((variant, index) => {
    const score = scorePeriodText([
      variant.name,
      variant.backgroundDelta,
      variant.reason,
    ].join(' '), variant.episodeRange)
    if (score > bestScore + 3) {
      bestScore = score
      bestIndex = index
    }
  })
  return bestIndex
}

function buildMainAppearance(
  character: CharacterAsset,
  variants: CharacterVariant[],
): CharacterMainAppearance {
  const uncoveredEpisodes = deriveMainAppearanceEpisodes(character, variants)
  const mainEpisodes = uncoveredEpisodes.length > 0
    ? uncoveredEpisodes
    : expandRange(character.mainAppearance.episodeRange)
  const start = mainEpisodes[0] || character.mainAppearance.episodeRange.start || character.relatedEpisodes[0] || 1
  const end = mainEpisodes.at(-1) || character.mainAppearance.episodeRange.end || start
  const evidence = limitEvidence(
    character.evidence.filter((item) => item.episodeNumber >= start && item.episodeNumber <= end),
  )
  return {
    id: character.mainAppearance.id || `${character.id}-main-appearance`,
    name: inferMainAppearanceName(character),
    episodeRange: { start, end: Math.max(start, end) },
    facts: character.mainAppearance.facts,
    profile: preferProfile(character.mainAppearance.profile, character.profile),
    reason: character.mainAppearance.reason || `第 ${start}-${Math.max(start, end)} 集的稳定主形象，用于该角色常规资产定稿图。`,
    evidence: evidence.length > 0 ? evidence : limitEvidence(character.evidence),
  }
}

function removeMainRangeVariants(
  mainAppearance: CharacterMainAppearance,
  variants: CharacterVariant[],
) {
  return variants.filter((variant) => {
    const sameRange = variant.episodeRange.start === mainAppearance.episodeRange.start
      && variant.episodeRange.end === mainAppearance.episodeRange.end
    if (sameRange) return false
    return normalizeVariantNameKey(variant.name) !== normalizeVariantNameKey(mainAppearance.name)
  })
}

function mergeProfileOverride(
  variants: CharacterVariant[],
  field: keyof CharacterVisualProfile,
) {
  return mergeTextParts(
    variants
      .map((variant) => variant.profileOverride[field] || '')
      .filter(Boolean),
  )
}

function mergeVariant(left: CharacterVariant, right: CharacterVariant): CharacterVariant {
  return {
    ...left,
    episodeRange: {
      start: Math.min(left.episodeRange.start, right.episodeRange.start),
      end: Math.max(left.episodeRange.end, right.episodeRange.end),
    },
    facts: mergePeriodFacts(left.facts, right.facts),
    backgroundDelta: preferLonger(left.backgroundDelta, right.backgroundDelta),
    profileOverride: {
      subject: mergeTextParts([left.profileOverride.subject || '', right.profileOverride.subject || '']),
      face: mergeTextParts([left.profileOverride.face || '', right.profileOverride.face || '']),
      clothing: mergeTextParts([left.profileOverride.clothing || '', right.profileOverride.clothing || '']),
      accessories: mergeTextParts([left.profileOverride.accessories || '', right.profileOverride.accessories || '']),
    },
    reason: preferLonger(left.reason, right.reason),
    evidence: limitEvidence(mergeEvidence(left.evidence, right.evidence)),
  }
}

function dedupeVariants(variants: CharacterVariant[]) {
  const byKey = new Map<string, CharacterVariant>()
  for (const variant of variants) {
    const nameKey = normalizeVariantNameKey(variant.name)
    const key = nameKey || `${variant.episodeRange.start}-${variant.episodeRange.end}`
    const existing = byKey.get(key)
    byKey.set(key, existing ? mergeVariant(existing, variant) : variant)
  }
  return [...byKey.values()]
    .sort((left, right) => {
      if (left.episodeRange.start !== right.episodeRange.start) {
        return left.episodeRange.start - right.episodeRange.start
      }
      return left.episodeRange.end - right.episodeRange.end
    })
}

function normalizeCharacterVariantForOutput(variant: CharacterVariant): CharacterVariant {
  return {
    ...variant,
    name: normalizeCharacterVariantName(variant.name, variant.backgroundDelta),
  }
}

function buildCollapsedVariantName(group: CharacterVariant[], start: number, end: number) {
  if (group.length === 1) {
    return normalizeCharacterVariantName(group[0].name, firstMeaningfulClause(group[0].backgroundDelta))
  }
  const first = compactVariantLabel(group[0].name, 'first')
    || compactVariantLabel(firstMeaningfulClause(group[0].backgroundDelta), 'first')
  const last = compactVariantLabel(group[group.length - 1].name, 'last')
    || compactVariantLabel(firstMeaningfulClause(group[group.length - 1].backgroundDelta), 'last')
  const joined = first && last && first !== last
    ? `${first}至${last}期`
    : `${first || last || '关键变化'}期`
  return normalizeCharacterVariantName(joined, `${start}-${end}`)
}

function collapseVariantGroup(
  characterId: string,
  group: CharacterVariant[],
  index: number,
  forcedRange?: { start: number; end: number },
): CharacterVariant {
  const start = forcedRange?.start ?? Math.min(...group.map((variant) => variant.episodeRange.start))
  const end = forcedRange?.end ?? Math.max(...group.map((variant) => variant.episodeRange.end))
  const name = buildCollapsedVariantName(group, start, end)
  const evidence = limitEvidence(group.flatMap((variant) => variant.evidence))
  return {
    id: `${characterId}-variant-${start}-${end}-${index + 1}`,
    name,
    episodeRange: { start, end },
    facts: group
      .map((variant) => variant.facts)
      .reduce((left, right) => mergePeriodFacts(left, right)),
    backgroundDelta: mergeTextParts(group.map((variant) => variant.backgroundDelta), 4),
    profileOverride: {
      ...(mergeProfileOverride(group, 'subject') ? { subject: mergeProfileOverride(group, 'subject') } : {}),
      ...(mergeProfileOverride(group, 'face') ? { face: mergeProfileOverride(group, 'face') } : {}),
      ...(mergeProfileOverride(group, 'clothing') ? { clothing: mergeProfileOverride(group, 'clothing') } : {}),
      ...(mergeProfileOverride(group, 'accessories') ? { accessories: mergeProfileOverride(group, 'accessories') } : {}),
    },
    reason: `合并 ${group.length} 个相邻视觉状态，作为第 ${start}-${end} 集可复用角色阶段。`,
    evidence,
  }
}

function compactCharacterVariants(
  characterId: string,
  importance: CharacterImportance,
  variants: CharacterVariant[],
) {
  const deduped = dedupeVariants(variants).map(normalizeCharacterVariantForOutput)
  const maxVariants = MAX_VARIANTS_BY_IMPORTANCE[importance]
  if (maxVariants <= 0) return []
  if (deduped.length <= maxVariants) return deduped

  const minEpisode = Math.min(...deduped.map((variant) => variant.episodeRange.start))
  const maxEpisode = Math.max(...deduped.map((variant) => variant.episodeRange.end))
  const windowSize = Math.max(1, Math.ceil((maxEpisode - minEpisode + 1) / maxVariants))
  const groups = Array.from({ length: maxVariants }, () => [] as CharacterVariant[])
  for (const variant of deduped) {
    const midpoint = Math.floor((variant.episodeRange.start + variant.episodeRange.end) / 2)
    const groupIndex = Math.min(maxVariants - 1, Math.floor((midpoint - minEpisode) / windowSize))
    groups[groupIndex].push(variant)
  }

  return groups
    .map((group, index) => {
      if (group.length === 0) return null
      const start = minEpisode + (index * windowSize)
      const end = Math.min(maxEpisode, start + windowSize - 1)
      return collapseVariantGroup(characterId, group, index, { start, end })
    })
    .filter((variant): variant is CharacterVariant => !!variant)
}

function mergeCharacter(left: CharacterAsset, right: CharacterAsset): CharacterAsset {
  const importance = mergeImportance(left.importance, right.importance)
  const profile = {
    subject: preferLonger(left.profile.subject, right.profile.subject),
    face: preferLonger(left.profile.face, right.profile.face),
    clothing: preferLonger(left.profile.clothing, right.profile.clothing),
    accessories: preferLonger(left.profile.accessories, right.profile.accessories),
  }
  const mainAppearance = preferMainAppearance(left.mainAppearance, right.mainAppearance)
  return {
    ...left,
    aliases: mergeUniqueStrings(left.aliases, right.aliases),
    importance,
    background: preferLonger(left.background, right.background),
    mainAppearance,
    profile,
    variants: compactCharacterVariants(left.id, importance, [...left.variants, ...right.variants]),
    relatedEpisodes: mergeUniqueNumbers(left.relatedEpisodes, right.relatedEpisodes),
    evidence: mergeEvidence(left.evidence, right.evidence),
  }
}

function mergeEnvironment(left: EnvironmentAsset, right: EnvironmentAsset): EnvironmentAsset {
  return {
    ...left,
    background: preferLonger(left.background, right.background),
    profile: {
      subject: preferLonger(left.profile.subject, right.profile.subject),
      layout: preferLonger(left.profile.layout, right.profile.layout),
      atmosphere: preferLonger(left.profile.atmosphere, right.profile.atmosphere),
      visualDetails: preferLonger(left.profile.visualDetails, right.profile.visualDetails),
    },
    relatedEpisodes: mergeUniqueNumbers(left.relatedEpisodes, right.relatedEpisodes),
    evidence: mergeEvidence(left.evidence, right.evidence),
  }
}

function mergeProp(left: PropAsset, right: PropAsset): PropAsset {
  return {
    ...left,
    name: preferPropName(left.name, right.name),
    background: preferLonger(left.background, right.background),
    profile: {
      subject: preferLonger(left.profile.subject, right.profile.subject),
      material: preferLonger(left.profile.material, right.profile.material),
      shape: preferLonger(left.profile.shape, right.profile.shape),
      visualDetails: preferLonger(left.profile.visualDetails, right.profile.visualDetails),
    },
    owner: left.owner || right.owner,
    relatedEpisodes: mergeUniqueNumbers(left.relatedEpisodes, right.relatedEpisodes),
    evidence: mergeEvidence(left.evidence, right.evidence),
  }
}

function assetKey(id: string, name: string) {
  return normalizeNameKey(name) || id.trim().toLowerCase()
}

function propCanonicalKey(item: PropAsset) {
  const name = normalizeNameKey(item.name)
  const text = normalizeNameKey([
    item.name,
    item.background,
    item.profile.subject,
    item.profile.material,
    item.profile.shape,
    item.profile.visualDetails,
  ].join(' '))
  const source = `${name}${text}`
  if (/令牌/u.test(source)) return 'prop:令牌'
  if (/银簪/u.test(source)) return 'prop:银簪'
  if (/玉簪/u.test(source)) return 'prop:玉簪'
  if (/玉镯/u.test(source)) return 'prop:玉镯'
  if (/油灯/u.test(source)) return 'prop:油灯'
  if (/食盒/u.test(source)) return 'prop:食盒'
  if (/药箱/u.test(source)) return 'prop:药箱'
  if (/汤药|堕胎药/u.test(source)) return 'prop:汤药'
  if (/稀粥/u.test(source)) return 'prop:稀粥'
  return `prop:${assetKey(item.id, item.name)}`
}

function propNameScore(value: string) {
  let score = value.length
  if (/陆字|玄铁|羊脂|西医/u.test(value)) score += 12
  if (/断裂|变形|踩压|半碗|小院|晚膳|刺鼻|昨日|破损/u.test(value)) score -= 20
  if (/^(令牌|油灯|银簪|玉镯|汤药)$/u.test(value)) score -= 2
  return score
}

function preferPropName(left: string, right: string) {
  return propNameScore(right) > propNameScore(left) ? right : left
}

function mergeByKey<T extends { id: string; name: string }>(
  items: T[],
  mergeItem: (left: T, right: T) => T,
  keyForItem: (item: T) => string = (item) => assetKey(item.id, item.name),
) {
  const byKey = new Map<string, T>()
  for (const item of items) {
    const key = keyForItem(item)
    const existing = byKey.get(key)
    byKey.set(key, existing ? mergeItem(existing, item) : item)
  }
  return [...byKey.values()]
}

function mergeWarnings(warnings: ExtractionWarning[]) {
  const seen = new Set<string>()
  const merged: ExtractionWarning[] = []
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.targetId || ''}:${warning.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(warning)
  }
  return merged
}

function mergePackages(packages: AssetExtractionPackage[]): AssetExtractionPackage {
  return normalizeAssetExtractionPackage({
    version: 'asset-extraction-v1',
    worldBackground: packages
      .map((pkg) => pkg.worldBackground)
      .filter(Boolean)
      .join('\n'),
    characters: mergeByKey(packages.flatMap((pkg) => pkg.characters), mergeCharacter),
    environments: mergeByKey(packages.flatMap((pkg) => pkg.environments), mergeEnvironment),
    props: mergeByKey(packages.flatMap((pkg) => pkg.props), mergeProp, propCanonicalKey),
    warnings: mergeWarnings(packages.flatMap((pkg) => pkg.warnings)),
  })
}

function postProcessAssetPackage(
  pkg: AssetExtractionPackage,
  episodes: AssetExtractionEpisodeInput[],
): AssetExtractionPackage {
  return normalizeAssetExtractionPackage({
    ...pkg,
    characters: pkg.characters
      .map((character) => {
        const augmented = augmentCharacterCoverageFromEpisodes(character, episodes)
        const compactedVariants = compactCharacterVariants(augmented.id, augmented.importance, augmented.variants)
        const promotedVariantIndex = chooseMainVariantIndex(augmented, compactedVariants)
        const promotedVariant = promotedVariantIndex >= 0 ? compactedVariants[promotedVariantIndex] : null
        const variants = compactedVariants.filter((_, index) => index !== promotedVariantIndex)
        const mainSeed = promotedVariant
          ? {
              ...augmented,
              mainAppearance: {
                ...augmented.mainAppearance,
                name: normalizePeriodName(promotedVariant.name, promotedVariant.backgroundDelta),
                episodeRange: promotedVariant.episodeRange,
                facts: promotedVariant.facts,
                reason: promotedVariant.reason || promotedVariant.backgroundDelta,
                evidence: promotedVariant.evidence,
              },
            }
          : augmented
        const mainAppearance = buildMainAppearance(mainSeed, variants)
        const finalVariants = removeMainRangeVariants(mainAppearance, variants)
        return {
          ...augmented,
          mainAppearance,
          profile: mainAppearance.profile,
          variants: finalVariants,
        }
      }),
    props: mergeByKey(pkg.props, mergeProp, propCanonicalKey),
  })
}

function emptyUsage(): AiStepExecutionResult['usage'] {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
}

function addUsage(left: AiStepExecutionResult['usage'], right: AiStepExecutionResult['usage']) {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  }
}

async function executeAssetExtractionBatch(params: {
  userId: string
  projectId: string
  model: string
  episodes: AssetExtractionEpisodeInput[]
  executeTextStep: ExecuteTextStep
  stepIndex: number
  stepTotal: number
}) {
  const prompt = buildAssetExtractionPrompt({ episodes: params.episodes })
  const completion = await params.executeTextStep({
    userId: params.userId,
    projectId: params.projectId,
    model: params.model,
    action: 'asset_extraction',
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    meta: {
      stepId: 'asset_extraction',
      stepTitle: '资产抽取',
      stepIndex: params.stepIndex,
      stepTotal: params.stepTotal,
    },
    temperature: 0.1,
    reasoning: false,
    reasoningEffort: 'low',
    maxTokens: Math.min(11_000, 5_000 + params.episodes.length * 2_000),
  })

  const rawText = completion.text.trim()
  if (!rawText) {
    throw new Error('asset extraction llm returned empty response')
  }

  const parsed = safeParseJsonObject(rawText)
  return {
    package: normalizeAssetExtractionPackage(parsed),
    rawText,
    usage: completion.usage,
  }
}

type AssetExtractionBatchResult = Awaited<ReturnType<typeof executeAssetExtractionBatch>>

async function executeCharacterVisualRefinement(params: {
  userId: string
  projectId: string
  model: string
  pkg: AssetExtractionPackage
  executeTextStep: ExecuteTextStep
  stepIndex: number
  stepTotal: number
}) {
  if (params.pkg.characters.length === 0) {
    return {
      package: params.pkg,
      rawText: '',
      usage: emptyUsage(),
    }
  }

  let refinedPackage = params.pkg
  let usage = emptyUsage()
  const rawTexts: string[] = []
  for (let index = 0; index < params.pkg.characters.length; index += 1) {
    const character = refinedPackage.characters[index]
    const prompt = buildCharacterVisualRefinementPrompt({
      worldBackground: params.pkg.worldBackground,
      character,
    })
    const completion = await params.executeTextStep({
      userId: params.userId,
      projectId: params.projectId,
      model: params.model,
      action: 'asset_visual_refinement',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      meta: {
        stepId: 'asset_visual_refinement',
        stepTitle: `资产视觉设定：${character.name}`,
        stepIndex: params.stepIndex + index,
        stepTotal: params.stepTotal,
      },
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'low',
      maxTokens: 6_500,
    })

    const rawText = completion.text.trim()
    if (!rawText) {
      throw new Error(`asset visual refinement llm returned empty response: ${character.name}`)
    }

    const parsed = safeParseJsonObject(rawText)
    refinedPackage = normalizeAssetExtractionPackage(
      applySingleCharacterVisualRefinement(refinedPackage, character.id, parsed),
    )
    usage = addUsage(usage, completion.usage)
    rawTexts.push(rawText)
  }
  return {
    package: refinedPackage,
    rawText: rawTexts.join('\n\n'),
    usage,
  }
}

function normalizeBatchConcurrency(value: number | undefined) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(4, Math.floor(value || 1)))
}

async function executeAssetExtractionBatches(params: {
  userId: string
  projectId: string
  model: string
  episodeBatches: AssetExtractionEpisodeInput[][]
  executeTextStep: ExecuteTextStep
  concurrency: number
}) {
  const results: Array<AssetExtractionBatchResult | undefined> = []
  let nextIndex = 0
  async function worker() {
    while (nextIndex < params.episodeBatches.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await executeAssetExtractionBatch({
        userId: params.userId,
        projectId: params.projectId,
        model: params.model,
        episodes: params.episodeBatches[index],
        executeTextStep: params.executeTextStep,
        stepIndex: index + 1,
        stepTotal: params.episodeBatches.length,
      })
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(params.concurrency, params.episodeBatches.length) },
      () => worker(),
    ),
  )
  return results.filter((result): result is AssetExtractionBatchResult => !!result)
}

export async function executeAssetExtraction(
  params: AssetExtractionExecutionParams,
): Promise<AssetExtractionExecutionResult> {
  const episodes = normalizeEpisodeInputs(params.episodes)
  if (episodes.length === 0) {
    throw new Error('asset extraction episodes are required')
  }

  const executeTextStep = params.executeTextStep || executeAiTextStep
  const episodeBatches = chunkEpisodes(episodes, normalizeBatchSize(params.batchSize))
  const results = await executeAssetExtractionBatches({
    userId: params.userId,
    projectId: params.projectId,
    model: params.model,
    episodeBatches,
    executeTextStep,
    concurrency: normalizeBatchConcurrency(params.batchConcurrency),
  })
  let usage = results.reduce(
    (total, result) => addUsage(total, result.usage),
    emptyUsage(),
  )

  const mergedPackage = results.length === 1
    ? results[0].package
    : mergePackages(results.map((result) => result.package))

  const postProcessedPackage = postProcessAssetPackage(mergedPackage, episodes)
  const shouldRefineVisuals = params.enableVisualRefinement !== false
  const visualRefinement = shouldRefineVisuals
    ? await executeCharacterVisualRefinement({
      userId: params.userId,
      projectId: params.projectId,
      model: params.model,
      pkg: postProcessedPackage,
      executeTextStep,
      stepIndex: episodeBatches.length + 1,
      stepTotal: episodeBatches.length + postProcessedPackage.characters.length,
    })
    : null
  if (visualRefinement) {
    usage = addUsage(usage, visualRefinement.usage)
  }

  return {
    package: visualRefinement?.package || postProcessedPackage,
    rawText: [
      ...results.map((result) => result.rawText),
      ...(visualRefinement?.rawText ? [visualRefinement.rawText] : []),
    ].join('\n\n'),
    usage,
  }
}
