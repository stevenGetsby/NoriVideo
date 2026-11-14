function foldSearchText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('zh-CN')
}

export function normalizeSearchText(text: string): string {
  return foldSearchText(text).replace(/\s+/g, '')
}

function isSubsequence(needle: readonly string[], haystack: readonly string[]): boolean {
  let matched = 0
  for (const char of haystack) {
    if (char === needle[matched]) matched += 1
    if (matched === needle.length) return true
  }
  return needle.length === 0
}

/** Lower is better, null means no match: exact < prefix < substring < every word < characters in order. */
export function fuzzyScore(label: string, query: string): number | null {
  const needle = normalizeSearchText(query)
  if (!needle) return 0
  const haystack = normalizeSearchText(label)
  if (haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1
  const at = haystack.indexOf(needle)
  if (at >= 0) return 2 + at / (haystack.length + 1)
  const words = foldSearchText(query).split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((word) => haystack.includes(word))) return 3
  return isSubsequence(Array.from(needle), Array.from(haystack)) ? 4 : null
}

export function filterByFuzzyQuery<T extends { label: string }>(items: readonly T[], query: string): T[] {
  if (!normalizeSearchText(query)) return items.slice()
  const ranked: Array<{ item: T; index: number; score: number }> = []
  items.forEach((item, index) => {
    const score = fuzzyScore(item.label, query)
    if (score !== null) ranked.push({ item, index, score })
  })
  return ranked.sort((left, right) => left.score - right.score || left.index - right.index).map((entry) => entry.item)
}
