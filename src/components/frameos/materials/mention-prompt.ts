export interface MentionPromptName {
  name: string
}

export interface MentionPromptPart {
  text: string
  mention: boolean
}

export interface ActivePromptMention {
  query: string
  start: number
}

export function findActiveMention(value: string, cursor: number): ActivePromptMention | null {
  const before = value.slice(0, cursor)
  const match = before.match(/@([^@\s，。；：,\n]*)$/u)
  if (!match || match.index === undefined) return null
  return { query: match[1], start: match.index }
}

/** Replaces only the active @query and leaves all surrounding prompt text intact. */
export function insertPromptMention(
  value: string,
  mention: ActivePromptMention,
  cursor: number,
  rawName: string,
): { value: string; cursor: number } {
  const name = rawName.trim().replace(/^@+/, '')
  if (!name) return { value, cursor }

  const start = Math.max(0, Math.min(value.length, mention.start))
  const end = Math.max(start, Math.min(value.length, cursor))
  const suffix = value.slice(end)
  const separator = /^[\s，。！？；：,.!?;:)\]}]/u.test(suffix) ? '' : ' '
  const inserted = `@${name}${separator}`
  return {
    value: `${value.slice(0, start)}${inserted}${suffix}`,
    cursor: start + inserted.length,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Splits the prompt without changing its text so bound @asset names can be styled. */
export function splitPromptMentionParts(value: string, assets: MentionPromptName[]): MentionPromptPart[] {
  if (!value) return []

  const names = Array.from(new Set(
    assets
      .map((asset) => asset.name.trim().replace(/^@+/, ''))
      .filter(Boolean),
  )).sort((left, right) => right.length - left.length)
  if (names.length === 0) return [{ text: value, mention: false }]

  const pattern = new RegExp(`@(?:${names.map(escapeRegExp).join('|')})`, 'giu')
  const parts: MentionPromptPart[] = []
  let cursor = 0

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ text: value.slice(cursor, index), mention: false })
    parts.push({ text: match[0], mention: true })
    cursor = index + match[0].length
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), mention: false })

  return parts.length > 0 ? parts : [{ text: value, mention: false }]
}
