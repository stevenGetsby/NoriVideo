const COMPARISON_SUFFIX_PATTERN = /(?:\s*·\s*对照(?:\s*[1-9]\d*)?)+\s*$/

export function stripComparisonTitleSuffix(title: string): string {
  return title.replace(COMPARISON_SUFFIX_PATTERN, '').trim()
}

export function readComparisonIndex(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

export function nextComparisonIndex(source: { title?: string; comparisonIndex?: unknown }): number {
  return restoreComparisonTitle(source).comparisonIndex + 1
}

export function formatComparisonTitle(baseTitle: string | undefined, comparisonIndex: unknown): string {
  const base = baseTitle?.trim() || '视频节点'
  const index = readComparisonIndex(comparisonIndex)
  return index > 0 ? `${base} · 对照 ${index}` : base
}

export function restoreComparisonTitle(source: { title?: string; comparisonIndex?: unknown }): { title: string; comparisonIndex: number } {
  const title = source.title || ''
  const explicit = readComparisonIndex(source.comparisonIndex)
  if (explicit > 0 || source.comparisonIndex === 0) return { title, comparisonIndex: explicit }
  const suffix = title.match(COMPARISON_SUFFIX_PATTERN)
  if (!suffix) return { title, comparisonIndex: 0 }
  const takes = Array.from(suffix[0].matchAll(/·\s*对照\s*(\d+)?/g))
  const comparisonIndex = takes.reduce((highest, take) => Math.max(highest, readComparisonIndex(Number(take[1]))), takes.length)
  return { title: title.slice(0, suffix.index).trim(), comparisonIndex }
}
