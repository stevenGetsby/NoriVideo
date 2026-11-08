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

/** Characters that terminate the @query token in both detection and editing. */
const MENTION_TOKEN_BREAK = /[@\s，。；：,\n]/u
const MENTION_QUERY_PATTERN = /@([^@\s，。；：,\n]*)$/u
const MENTION_SEPARATOR_START = /^[\s，。！？；：,.!?;:)\]}]/u

function clampIndex(value: number, length: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(length, Math.trunc(value))) : length
}

function normalizedMentionName(rawName: string): string {
  return rawName.trim().replace(/^@+/, '')
}

export function findActiveMention(value: string, cursor: number): ActivePromptMention | null {
  const safeCursor = clampIndex(cursor, value.length)
  const before = value.slice(0, safeCursor)
  const match = before.match(MENTION_QUERY_PATTERN)
  if (!match || match.index === undefined) return null
  return { query: match[1], start: match.index }
}

/**
 * End (exclusive) of the @token that starts at `start`. The character class is
 * deliberately identical to findActiveMention: a token never crosses spaces,
 * newlines, another @ or common Chinese/ASCII separators.
 */
function mentionTokenEnd(value: string, start: number): number {
  let index = start
  while (index < value.length && !MENTION_TOKEN_BREAK.test(value[index])) index += 1
  return index
}

/** True when every character of `value` appears in `target` in order. */
function isSubsequence(value: string, target: string): boolean {
  const chars = Array.from(value)
  let index = 0
  for (const char of target) {
    if (index < chars.length && chars[index] === char) index += 1
    if (index === chars.length) return true
  }
  return index === chars.length
}

function knownPromptAssetNames(assets: readonly MentionPromptName[]): Set<string> {
  const names = new Set<string>()
  for (const asset of assets) {
    const name = normalizedMentionName(asset.name)
    if (name) names.add(name.toLocaleLowerCase())
  }
  return names
}

/**
 * Replaces the live @mention token with the chosen asset. This always runs
 * against the textarea's current value and selection, so deleting text,
 * undoing/redoing, or an in-flight IME composition can never make the picker
 * insert at a stale index.
 *
 * The replacement range extends past the caret when the caret sits inside a
 * token that already spells a known asset (or the beginning of the chosen
 * asset). Without that, deleting a character inside “@张三丰”, retyping it and
 * choosing 张三丰 used to leave a duplicated trailing “丰”.
 */
export function replacePromptMention(
  value: string,
  mention: ActivePromptMention | null,
  selectionStart: number,
  selectionEnd: number,
  rawName: string,
  assets: readonly MentionPromptName[] = [],
): { value: string; cursor: number } | null {
  const name = normalizedMentionName(rawName)
  if (!mention || !name) return null
  const start = clampIndex(mention.start, value.length)
  if (value[start] !== '@') return null
  const caret = clampIndex(selectionStart, value.length)
  let end = Math.max(caret, clampIndex(selectionEnd, value.length))

  const tokenStart = start + 1
  const tokenEnd = mentionTokenEnd(value, tokenStart)
  const tokenName = value.slice(tokenStart, tokenEnd)
  const tokenLower = tokenName.toLocaleLowerCase()
  const nameLower = name.toLocaleLowerCase()
  if (tokenName) {
    if (knownPromptAssetNames(assets).has(tokenLower)) {
      // A complete, already-bound mention is replaced as one unit even when the
      // caret was moved into the middle before choosing another asset.
      end = Math.max(end, tokenEnd)
    } else if (tokenLower.startsWith(nameLower)) {
      end = Math.max(end, tokenStart + name.length)
    } else if (caret > tokenStart && caret < tokenEnd && tokenLower.length >= 2 && isSubsequence(tokenLower, nameLower)) {
      // The caret sits inside a partially edited token, e.g. deleting “三”
      // from “@张三丰” leaves “@张丰” with the caret after “张”. Absorb the
      // rest of the token only when it can still be read as a partial spelling
      // of the chosen name, so ordinary trailing text such as “@张三你好”
      // (not a subsequence of “张三”) is never deleted.
      end = Math.max(end, tokenEnd)
    }
  }
  end = Math.min(value.length, Math.max(start, end))

  const suffix = value.slice(end)
  const separator = MENTION_SEPARATOR_START.test(suffix) ? '' : ' '
  const inserted = `@${name}${separator}`
  return {
    value: `${value.slice(0, start)}${inserted}${suffix}`,
    cursor: start + inserted.length,
  }
}

/** Replaces only the active @query and leaves all surrounding prompt text intact. */
export function insertPromptMention(
  value: string,
  mention: ActivePromptMention,
  cursor: number,
  rawName: string,
): { value: string; cursor: number } {
  return replacePromptMention(value, mention, cursor, cursor, rawName) ?? { value, cursor }
}

/**
 * Applies the paste path against the live value/selection. Returns null when
 * the pasted text has no known asset name, so the browser can paste normally.
 */
export function pastePromptAssets(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  pastedText: string,
  assets: readonly MentionPromptName[],
): { value: string; cursor: number; matched: string[] } | null {
  if (!pastedText) return null
  const start = clampIndex(selectionStart, value.length)
  const end = Math.max(start, clampIndex(selectionEnd, value.length))
  const result = matchPromptAssetNames(pastedText, assets)
  if (result.matched.length === 0) return null
  let inserted = result.value
  // Typing @ and then pasting a known name must not produce @@name.
  if (start > 0 && value[start - 1] === '@' && inserted.startsWith('@')) inserted = inserted.slice(1)
  return {
    value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
    cursor: start + inserted.length,
    matched: result.matched,
  }
}

export interface PromptInsertionRecord {
  before: string
  after: string
  cursorBefore: number
  cursorAfter: number
}

/**
 * Undo/redo for values React inserts programmatically (mention selection and
 * paste). Native undo in a controlled textarea cannot replay those mutations,
 * so the editor keeps one explicit record. A user edit invalidates it.
 */
export function undoPromptInsertion(
  currentValue: string,
  record: PromptInsertionRecord | null,
): { value: string; cursor: number } | null {
  if (!record || currentValue !== record.after) return null
  return { value: record.before, cursor: record.cursorBefore }
}

export function redoPromptInsertion(
  currentValue: string,
  record: PromptInsertionRecord | null,
): { value: string; cursor: number } | null {
  if (!record || currentValue !== record.before) return null
  return { value: record.after, cursor: record.cursorAfter }
}

/** True while an IME owns the keyboard; mention shortcuts must not run then. */
export function isPromptCompositionKey(event: {
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}): boolean {
  return event.nativeEvent?.isComposing === true
    || event.nativeEvent?.keyCode === 229
    || event.keyCode === 229
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Auto-prefix pasted prompt text with @ for known asset names. Existing mention
 * tokens and overlapping names are skipped; ordinary text is preserved byte for
 * byte. Names are matched longest-first so 张三丰 wins over 张三.
 */
export function matchPromptAssetNames(
  value: string,
  assets: readonly MentionPromptName[],
): { value: string; matched: string[] } {
  if (!value) return { value, matched: [] }

  const names: string[] = []
  const seen = new Set<string>()
  for (const asset of assets) {
    const name = asset.name.trim().replace(/^@+/, '')
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  names.sort((left, right) => right.length - left.length)
  if (names.length === 0) return { value, matched: [] }

  const pattern = new RegExp(names.map((name) => {
    const escaped = escapeRegExp(name)
    const prefix = /^[A-Za-z0-9_]/.test(name) ? '(?<![A-Za-z0-9_])' : ''
    const suffix = /[A-Za-z0-9_]$/.test(name) ? '(?![A-Za-z0-9_])' : ''
    return `${prefix}${escaped}${suffix}`
  }).join('|'), 'giu')
  const matched = new Set<string>()
  const output = splitPromptMentionParts(value, assets).map((part) => {
    if (part.mention) return part.text
    return part.text.replace(pattern, (name) => {
      if (name.startsWith('@')) return name
      const canonical = names.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase()) || name
      matched.add(canonical)
      return `@${name}`
    })
  }).join('')

  return { value: output, matched: [...matched] }
}

/** Splits the prompt without changing its text so bound @asset names can be styled. */
export function splitPromptMentionParts(value: string, assets: readonly MentionPromptName[]): MentionPromptPart[] {
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
