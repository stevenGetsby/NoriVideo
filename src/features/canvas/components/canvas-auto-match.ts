import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  findQuotedDialogueRanges,
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

function isAsciiIdentifierChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value))
}

/**
 * Safe bare-text policy: single-character and pure-digit names would corrupt
 * ordinary prose (时长：2秒 / 9:16 / 镜头1), so they never auto-match. Explicit
 * @mentions remain the only way to reference them.
 */
function isAutoMatchableTerm(term: string): boolean {
  return Array.from(term).length >= 2 && !/^[\p{Nd}]+$/u.test(term)
}

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
  const dialogue = findQuotedDialogueRanges(text)

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
      if (!term || !isAutoMatchableTerm(term)) continue
      const literal = term.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(literal, 'giu')
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        const index = match.index
        const end = index + match[0].length
        const asciiBounded = !(
          (isAsciiIdentifierChar(term[0]) && isAsciiIdentifierChar(text[index - 1]))
          || (isAsciiIdentifierChar(term[term.length - 1]) && isAsciiIdentifierChar(text[end]))
        )
        // Every qualifying occurrence is kept: a short name absorbed inside a
        // longer one at its first occurrence may still appear independently
        // later, and that later occurrence must survive. A span that intersects
        // any dialogue range is spoken text, even when it starts outside it.
        const intersectsDialogue = dialogue.some((range) => index < range.end && end > range.start)
        if (asciiBounded && !intersectsDialogue) {
          candidates.push({ material, term, isOfficial, start: index, end })
        }
        // Preserve overlapping occurrences without restarting inside a surrogate pair.
        pattern.lastIndex = index + (match[0].codePointAt(0)! > 0xffff ? 2 : 1)
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
