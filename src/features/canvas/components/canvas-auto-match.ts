import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  createBarePromptNameMatcher,
  normalizePromptMentionName,
} from '@/lib/prompt-mentions'
import {
  frameosAssetAliasesFromMetadata,
  frameosAssetCategoryFromMetadata,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import type { CanvasMentionMediaType } from './canvas-mention-references'

export interface CanvasAutoMatchHit {
  material: FrameosMaterialItem
  /** The exact name or alias found in the prompt, for the result toast. */
  matchedTerm: string
}

const CATEGORY_ORDER: Record<FrameosAssetCategory, number> = {
  character: 0,
  location: 1,
  prop: 2,
  shot: 3,
  other: 4,
}

const MEDIA_ORDER: Record<CanvasMentionMediaType, number> = { image: 0, video: 1, audio: 2 }

/**
 * One-click reference matching: select project assets whose official name or
 * alias appears in the prompt. Selection only — the caller wires nodes and
 * references; this never rewrites prompt text.
 *
 * Safety rules over the legacy substring behaviour:
 * - quoted dialogue (“” ‘’ 「」 "" '') is spoken text and never matches;
 * - a term inside a longer matched term is absorbed (甲长 covers 甲), so a
 *   short name cannot piggyback on a longer one;
 * - ASCII terms need identifier boundaries (Ava never matches Avarice);
 * - single-character / pure-digit terms are excluded entirely;
 * - one asset is selected once even when several of its terms appear.
 *
 * Result order is stable: character → location → prop → shot → other, then
 * image → video → audio, then title — never prompt occurrence order.
 */
export function matchCanvasPromptAssets(
  prompt: string,
  materials: readonly FrameosMaterialItem[],
  allowedTypes: readonly CanvasMentionMediaType[],
): CanvasAutoMatchHit[] {
  const text = (prompt || '').trim()
  if (!text) return []
  const allowed = new Set(allowedTypes)
  const findMatches = createBarePromptNameMatcher(text)

  interface Candidate {
    material: FrameosMaterialItem
    term: string
    isOfficial: boolean
    start: number
    end: number
  }
  const candidates: Candidate[] = []
  const usable = materials.filter((material) => (
    material.status === 'ready'
    && Boolean(material.url)
    && allowed.has(material.type as CanvasMentionMediaType)
  ))
  for (const material of usable) {
    const title = normalizePromptMentionName(material.title)
    const terms: Array<{ term: string; isOfficial: boolean }> = [
      { term: title, isOfficial: true },
      ...frameosAssetAliasesFromMetadata(material.metadata).map((alias) => ({ term: alias, isOfficial: false })),
    ]
    for (const { term: rawTerm, isOfficial } of terms) {
      const term = normalizePromptMentionName(rawTerm)
      for (const span of findMatches(term)) {
        candidates.push({ material, term, isOfficial, ...span })
      }
    }
  }

  // Longest spans win; equal spans prefer the official name over an alias.
  // A shorter span fully inside a kept span is absorbed.
  candidates.sort((left, right) => (
    (right.end - right.start) - (left.end - left.start)
    || Number(right.isOfficial) - Number(left.isOfficial)
    || left.start - right.start
  ))
  const kept: Candidate[] = []
  const ambiguous = new Set<Candidate>()
  for (const candidate of candidates) {
    const covering = kept.find((span) => candidate.start >= span.start && candidate.end <= span.end)
    if (covering) {
      // Same span, different asset, same name authority (both official or both
      // alias): ownership is ambiguous — drop both rather than let library
      // return order decide. An official name always beats an alias (the sort
      // already placed it first, so a later alias never displaces it).
      if (covering.start === candidate.start && covering.end === candidate.end
        && covering.material.id !== candidate.material.id
        && covering.isOfficial === candidate.isOfficial) {
        ambiguous.add(covering)
        ambiguous.add(candidate)
      }
      continue
    }
    if ([...ambiguous].some((span) => candidate.start >= span.start && candidate.end <= span.end)) continue
    kept.push(candidate)
  }

  const hitByMaterialId = new Map<string, CanvasAutoMatchHit>()
  for (const candidate of kept.filter((span) => !ambiguous.has(span)).sort((left, right) => left.start - right.start)) {
    if (!hitByMaterialId.has(candidate.material.id)) {
      hitByMaterialId.set(candidate.material.id, { material: candidate.material, matchedTerm: candidate.term })
    }
  }

  return [...hitByMaterialId.values()].sort((left, right) => {
    const leftCategory = CATEGORY_ORDER[frameosAssetCategoryFromMetadata(left.material.metadata)]
    const rightCategory = CATEGORY_ORDER[frameosAssetCategoryFromMetadata(right.material.metadata)]
    if (leftCategory !== rightCategory) return leftCategory - rightCategory
    const leftMedia = MEDIA_ORDER[left.material.type as CanvasMentionMediaType]
    const rightMedia = MEDIA_ORDER[right.material.type as CanvasMentionMediaType]
    if (leftMedia !== rightMedia) return leftMedia - rightMedia
    return (left.material.title || '').localeCompare(right.material.title || '', 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  })
}
