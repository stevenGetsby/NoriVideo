import { executeAiTextStep } from '@/lib/ai-runtime'
import type { AiStepExecutionResult } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildAssetExtractionPrompt } from './prompt'
import { normalizeAssetExtractionPackage } from './normalize'
import type {
  AssetExtractionEpisodeInput,
  AssetExtractionPackage,
  CharacterAsset,
  CharacterImportance,
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
  lead: 5,
  core_supporting: 4,
  supporting: 2,
}

export type AssetExtractionExecutionParams = ExecuteAssetExtractionInput & {
  executeTextStep?: ExecuteTextStep
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

function chunkEpisodes(episodes: AssetExtractionEpisodeInput[]) {
  const chunks: AssetExtractionEpisodeInput[][] = []
  for (let index = 0; index < episodes.length; index += EPISODES_PER_EXTRACTION_BATCH) {
    chunks.push(episodes.slice(index, index + EPISODES_PER_EXTRACTION_BATCH))
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

function limitEvidence(items: SourceEvidence[], maxItems = 6) {
  return items.slice(0, maxItems)
}

function preferLonger(left: string, right: string) {
  return right.length > left.length ? right : left
}

function mergeTextParts(parts: string[], maxParts = 3) {
  return mergeUniqueStrings(parts, [])
    .slice(0, maxParts)
    .join('；')
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
    .replace(/期$/u, '')
}

function stripVariantPhaseSuffix(value: string) {
  return value
    .trim()
    .replace(/视觉阶段$/u, '')
    .replace(/阶段$/u, '')
    .replace(/时期$/u, '')
    .replace(/期$/u, '')
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

function buildCollapsedVariantName(group: CharacterVariant[], start: number, end: number) {
  if (group.length === 1) return group[0].name
  const first = stripVariantPhaseSuffix(group[0].name)
  const last = stripVariantPhaseSuffix(group[group.length - 1].name)
  const joined = first && last && first !== last
    ? `${first}至${last}期`
    : `${first || last || `第${start}-${end}集`}期`
  return joined.length <= 32 ? joined : `第${start}-${end}集视觉阶段`
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
  const deduped = dedupeVariants(variants)
  const maxVariants = MAX_VARIANTS_BY_IMPORTANCE[importance]
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
  return {
    ...left,
    aliases: mergeUniqueStrings(left.aliases, right.aliases),
    importance,
    background: preferLonger(left.background, right.background),
    profile: {
      subject: preferLonger(left.profile.subject, right.profile.subject),
      face: preferLonger(left.profile.face, right.profile.face),
      clothing: preferLonger(left.profile.clothing, right.profile.clothing),
      accessories: preferLonger(left.profile.accessories, right.profile.accessories),
    },
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

function mergeByKey<T extends { id: string; name: string }>(
  items: T[],
  mergeItem: (left: T, right: T) => T,
) {
  const byKey = new Map<string, T>()
  for (const item of items) {
    const key = assetKey(item.id, item.name)
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
    props: mergeByKey(packages.flatMap((pkg) => pkg.props), mergeProp),
    warnings: mergeWarnings(packages.flatMap((pkg) => pkg.warnings)),
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
    maxTokens: 12_000,
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

export async function executeAssetExtraction(
  params: AssetExtractionExecutionParams,
): Promise<AssetExtractionExecutionResult> {
  const episodes = normalizeEpisodeInputs(params.episodes)
  if (episodes.length === 0) {
    throw new Error('asset extraction episodes are required')
  }

  const executeTextStep = params.executeTextStep || executeAiTextStep
  const episodeBatches = chunkEpisodes(episodes)
  const results = []
  let usage = emptyUsage()
  for (let index = 0; index < episodeBatches.length; index += 1) {
    const result = await executeAssetExtractionBatch({
      userId: params.userId,
      projectId: params.projectId,
      model: params.model,
      episodes: episodeBatches[index],
      executeTextStep,
      stepIndex: index + 1,
      stepTotal: episodeBatches.length,
    })
    results.push(result)
    usage = addUsage(usage, result.usage)
  }

  return {
    package: results.length === 1
      ? results[0].package
      : mergePackages(results.map((result) => result.package)),
    rawText: results.map((result) => result.rawText).join('\n\n'),
    usage,
  }
}
