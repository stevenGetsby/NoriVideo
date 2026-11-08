/**
 * Scene text is the screenwriter's primary input. These helpers keep the
 * editing model small and predictable: line endings are normalised, NUL is
 * dropped, and the visible text never exceeds a hard code-point budget so a
 * paste cannot grow a canvas node without bound.
 */

export const SCENE_TEXT_MAX = 2000
export const SCENE_TEXT_MIN_ROWS = 3
export const SCENE_TEXT_MAX_ROWS = 10
/** Roughly how many wide characters fit in one visual line of a story card. */
export const SCENE_TEXT_WRAP_AT = 26

export type SceneTextMetrics = {
  text: string
  chars: number
  lines: number
  max: number
  remaining: number
  isFull: boolean
  isEmpty: boolean
}

export type SceneTextRowOptions = {
  minRows?: number
  maxRows?: number
  wrapAt?: number
}

const DEFAULT_ROWS = SCENE_TEXT_MIN_ROWS
const DEFAULT_MAX_ROWS = SCENE_TEXT_MAX_ROWS
const DEFAULT_WRAP_AT = SCENE_TEXT_WRAP_AT

const positive = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

/**
 * Non-destructive normalisation for stored and compiled text. CRLF is the main
 * real-world case; NUL is the only control character we strip because it can
 * break downstream JSON/text rendering.
 */
export function normalizeSceneText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').split(String.fromCharCode(0)).join('')
}

/** Counts Unicode code points, so an emoji counts as one character and is never split. */
export function sceneTextLength(value: string): number {
  let count = 0
  for (const _ of value) count += 1
  return count
}

function limitOf(max: unknown): number {
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 0) return SCENE_TEXT_MAX
  return Math.floor(max)
}

/** Normalises and cuts at a code-point boundary. A max of 0 produces an empty string. */
export function clampSceneText(value: unknown, max: number = SCENE_TEXT_MAX): string {
  const text = normalizeSceneText(value)
  const limit = limitOf(max)
  if (sceneTextLength(text) <= limit) return text
  let result = ''
  let count = 0
  for (const char of text) {
    if (count >= limit) break
    result += char
    count += 1
  }
  return result
}

export function sceneTextMetrics(value: unknown, max: number = SCENE_TEXT_MAX): SceneTextMetrics {
  const limit = limitOf(max)
  const text = clampSceneText(value, limit)
  const chars = sceneTextLength(text)
  return {
    text,
    chars,
    lines: text ? text.split('\n').length : 0,
    max: limit,
    remaining: Math.max(0, limit - chars),
    isFull: chars >= limit,
    isEmpty: chars === 0,
  }
}

/**
 * Estimates the textarea height from explicit newlines and soft wrapping.
 * Bounded so a very long scene still leaves the branch ports reachable.
 */
export function fitSceneTextRows(value: unknown, options: SceneTextRowOptions = {}): number {
  const minRows = positive(options.minRows, DEFAULT_ROWS)
  const maxRows = Math.max(minRows, positive(options.maxRows, DEFAULT_MAX_ROWS))
  const wrapAt = positive(options.wrapAt, DEFAULT_WRAP_AT)
  const text = normalizeSceneText(value)
  if (!text) return minRows
  let rows = 0
  for (const line of text.split('\n')) {
    rows += Math.max(1, Math.ceil(sceneTextLength(line) / wrapAt))
    if (rows >= maxRows) return maxRows
  }
  return Math.max(minRows, Math.min(maxRows, rows))
}
