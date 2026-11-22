const COMPARISON_SUFFIX_PATTERN = /(?:\s*·\s*对照)+$/
const NUMBERED_COMPARISON_SUFFIX_PATTERN = /·\s*对照\s*(\d+)\s*$/

export function stripComparisonTitleSuffix(title: string): string {
  return title.replace(COMPARISON_SUFFIX_PATTERN, '').trim()
}

export function readComparisonIndex(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

export function nextComparisonIndex(source: { title?: string; comparisonIndex?: unknown }): number {
  const explicit = readComparisonIndex(source.comparisonIndex)
  if (explicit > 0) return explicit + 1
  const numbered = source.title?.match(NUMBERED_COMPARISON_SUFFIX_PATTERN)
  if (numbered) return readComparisonIndex(Number(numbered[1])) + 1
  const legacySuffixes = source.title?.match(/·\s*对照/g)
  return (legacySuffixes?.length || 0) + 1
}

export function formatComparisonTitle(baseTitle: string | undefined, comparisonIndex: unknown): string {
  const base = stripComparisonTitleSuffix(baseTitle || '') || '视频节点'
  const index = readComparisonIndex(comparisonIndex)
  return index > 0 ? `${base} · 对照 ${index}` : base
}

export function restoreComparisonTitle(source: { title?: string; comparisonIndex?: unknown }): { title: string; comparisonIndex: number } {
  const title = source.title || ''
  const explicit = readComparisonIndex(source.comparisonIndex)
  if (explicit > 0) return { title, comparisonIndex: explicit }
  const numbered = title.match(NUMBERED_COMPARISON_SUFFIX_PATTERN)
  if (numbered) {
    const index = readComparisonIndex(Number(numbered[1]))
    if (index > 0) return { title: title.slice(0, numbered.index).trim(), comparisonIndex: index }
  }
  const legacySuffixes = title.match(/·\s*对照/g)
  if (legacySuffixes?.length) return { title: stripComparisonTitleSuffix(title), comparisonIndex: legacySuffixes.length }
  return { title, comparisonIndex: 0 }
}
