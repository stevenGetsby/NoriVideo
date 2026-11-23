/** Same token class as the prompt editor's @ picker, so client and server agree on token extent. */
const MENTION_TOKEN_BREAK = /[@\s，。；：,\n]/u
const ASCII_IDENTIFIER = /[A-Za-z0-9_]/
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/
const ASCII_ALNUM = /[A-Za-z0-9]/

export interface PromptMentionMatch {
  /** Index of the `@`. */
  start: number
  /** Exclusive end of the mention text. */
  end: number
  /** Canonical known name, or null when the @token matches no known name. */
  name: string | null
  /** Mention text exactly as typed, without the `@`. */
  text: string
}

export function normalizePromptMentionName(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().replace(/^@+/, '')
}

/**
 * Finds every `@mention` in a prompt. Known names win longest-first; an `@`
 * that matches no known name becomes an unknown mention spanning the whole
 * editor token. Bare names without `@` are never mentions.
 */
export function scanPromptMentions(prompt: string, names: Iterable<string>): PromptMentionMatch[] {
  if (!prompt || !prompt.includes('@')) return []
  const candidates = Array.from(new Set(Array.from(names, normalizePromptMentionName).filter(Boolean)))
    .sort((left, right) => right.length - left.length)
  const lowered = candidates.map((name) => name.toLocaleLowerCase())
  const matches: PromptMentionMatch[] = []

  let index = prompt.indexOf('@')
  while (index >= 0) {
    const bodyStart = index + 1
    const next = prompt[bodyStart]
    if (next === undefined || MENTION_TOKEN_BREAK.test(next)) {
      index = prompt.indexOf('@', bodyStart)
      continue
    }

    let known = -1
    for (let candidate = 0; candidate < candidates.length; candidate += 1) {
      const name = candidates[candidate]
      if (prompt.slice(bodyStart, bodyStart + name.length).toLocaleLowerCase() !== lowered[candidate]) continue
      // "@Ava" must not claim the first three letters of "@Avarice".
      if (ASCII_IDENTIFIER.test(name[name.length - 1]) && ASCII_IDENTIFIER.test(prompt[bodyStart + name.length] || '')) continue
      known = candidate
      break
    }
    if (known >= 0) {
      const end = bodyStart + candidates[known].length
      matches.push({ start: index, end, name: candidates[known], text: prompt.slice(bodyStart, end) })
      index = prompt.indexOf('@', end)
      continue
    }

    const previous = prompt[index - 1]
    if (previous && EMAIL_LOCAL_CHAR.test(previous) && ASCII_ALNUM.test(next)) {
      index = prompt.indexOf('@', bodyStart)
      continue
    }
    let end = bodyStart
    while (end < prompt.length && !MENTION_TOKEN_BREAK.test(prompt[end])) end += 1
    matches.push({ start: index, end, name: null, text: prompt.slice(bodyStart, end) })
    index = prompt.indexOf('@', end)
  }

  return matches
}

const QUOTE_PAIRS: Record<string, string> = { '“': '”', '‘': '’', '「': '」', '"': '"', "'": "'" }

export interface QuotedDialogueRange {
  /** Index of the opening quote. */
  start: number
  /** Exclusive end: one past the closing quote, or the line/paragraph end when unclosed. */
  end: number
}

/**
 * Dialogue protection, mirroring the 字字动画 Seedance plugin rule
 * "引号里的内容按台词处理，不参与裸词资产匹配": text inside quotes is spoken
 * dialogue, so asset names there must never be rewritten into 图N（名） bindings.
 * Covered quote pairs: “” ‘’ 「」 and straight "" '' — some authors write
 * dialogue in 「」 or English double quotes instead of “”.
 * An unclosed quote shields the rest of its line (CJK quotes “ ‘ 「: the rest
 * of the paragraph) so a missing closing mark cannot leak bindings into dialogue.
 */
export function findQuotedDialogueRanges(prompt: string): QuotedDialogueRange[] {
  if (!prompt) return []
  const ranges: QuotedDialogueRange[] = []
  let index = 0
  while (index < prompt.length) {
    const closer = QUOTE_PAIRS[prompt[index]]
    if (!closer) { index += 1; continue }
    const isCjkQuote = prompt[index] === '“' || prompt[index] === '‘' || prompt[index] === '「'
    const stop = isCjkQuote ? /\n{2,}/u : /\n/u
    const rest = prompt.slice(index + 1)
    const stopIndex = rest.search(stop)
    const limit = stopIndex >= 0 ? index + 1 + stopIndex : prompt.length
    let end = index + 1
    while (end < limit && prompt[end] !== closer) end += 1
    if (end < limit && prompt[end] === closer) {
      ranges.push({ start: index, end: end + 1 })
      index = end + 1
    } else {
      ranges.push({ start: index, end: limit })
      index = limit
    }
  }
  return ranges
}

export function isInsideQuotedDialogue(ranges: readonly QuotedDialogueRange[], position: number): boolean {
  return ranges.some((range) => position >= range.start && position < range.end)
}

/** Short, de-duplicated labels for unknown mentions, suitable for an error message. */
export function describeUnknownPromptMentions(matches: readonly PromptMentionMatch[], limit = 5): string[] {
  const labels: string[] = []
  for (const match of matches) {
    if (match.name !== null) continue
    const text = Array.from(match.text)
    const label = `@${text.length > 16 ? `${text.slice(0, 16).join('')}…` : match.text}`
    if (!labels.includes(label)) labels.push(label)
  }
  return labels.length > limit ? [...labels.slice(0, limit), `等 ${labels.length} 处`] : labels
}

export function unknownPromptMentionMessage(labels: readonly string[]): string {
  return `提示词中的 ${labels.join('、')} 没有对应的参考素材。模型无法识别这些 @，会把人物或场景画错。请从 @ 列表重新选择素材，或删除这些 @ 标记后再提交。`
}
