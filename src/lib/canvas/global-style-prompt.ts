export const GLOBAL_STYLE_PROMPT_OPEN = '[画布全局风格]'
export const GLOBAL_STYLE_PROMPT_CLOSE = '[/画布全局风格]'
const GLOBAL_STYLE_MARKERS = /\[画布全局风格\]|\[\/画布全局风格\]/g
const GLOBAL_STYLE_BLOCK = /\[画布全局风格\][\s\S]*?\[\/画布全局风格\]/g

export const CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH = 2_000

export const VIDEO_PREFIX_PROMPT_OPEN = '[视频统一前置提示词]'
export const VIDEO_PREFIX_PROMPT_CLOSE = '[/视频统一前置提示词]'
const VIDEO_PREFIX_MARKERS = /\[视频统一前置提示词\]|\[\/视频统一前置提示词\]/g
const VIDEO_PREFIX_BLOCK = /\[视频统一前置提示词\][\s\S]*?\[\/视频统一前置提示词\]/g

type GlobalStyleSourceNode = {
  id: string
  type?: string | null
  data?: {
    globalStylePrompt?: unknown
    videoPrefixPrompt?: unknown
    text?: unknown
    title?: unknown
  } | null
}

export function normalizeCanvasGlobalStylePrompt(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(GLOBAL_STYLE_MARKERS, '')
    .trim()
    .slice(0, CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH)
}

/** Remove every engine-injected global style block while preserving user text. */
export function stripCanvasGlobalStylePrompt(prompt: string | null | undefined): string {
  if (typeof prompt !== 'string') return ''
  return prompt.replace(GLOBAL_STYLE_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Append the canvas global style exactly once. Re-composing an already
 * composed prompt replaces the previous block instead of stacking a new one.
 */
export function composeCanvasGlobalStylePrompt(
  prompt: string | null | undefined,
  stylePrompt: string | null | undefined,
): string {
  const style = normalizeCanvasGlobalStylePrompt(stylePrompt)
  const base = stripCanvasGlobalStylePrompt(prompt)
  if (!style) return base
  const block = `${GLOBAL_STYLE_PROMPT_OPEN}\n${style}\n${GLOBAL_STYLE_PROMPT_CLOSE}`
  return base ? `${base}\n\n${block}` : block
}

/** Read the current global style block from a composed prompt. */
export function extractCanvasGlobalStylePrompt(prompt: string | null | undefined): string {
  if (typeof prompt !== 'string') return ''
  const match = prompt.match(GLOBAL_STYLE_BLOCK)
  if (!match?.length) return ''
  return normalizeCanvasGlobalStylePrompt(
    match[match.length - 1]
      .replace(GLOBAL_STYLE_PROMPT_OPEN, '')
      .replace(GLOBAL_STYLE_PROMPT_CLOSE, ''),
  )
}

export function findCanvasGlobalStylePromptNode(nodes: readonly GlobalStyleSourceNode[]): GlobalStyleSourceNode | null {
  const matches = nodes.filter((node) => (
    node.data?.globalStylePrompt === true
    && (node.type === 'text' || node.type === 'note')
    && typeof node.data.text === 'string'
    && node.data.text.trim().length > 0
  ))
  return matches.length === 1 ? matches[0] : null
}

export function readCanvasGlobalStylePrompt(nodes: readonly GlobalStyleSourceNode[]): string {
  return normalizeCanvasGlobalStylePrompt(findCanvasGlobalStylePromptNode(nodes)?.data?.text)
}

export function normalizeCanvasVideoPrefixPrompt(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(VIDEO_PREFIX_MARKERS, '')
    .trim()
    .slice(0, CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH)
}

/** Remove every engine-injected video prefix block while preserving user text. */
export function stripCanvasVideoPrefixPrompt(prompt: string | null | undefined): string {
  if (typeof prompt !== 'string') return ''
  return prompt.replace(VIDEO_PREFIX_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Put the canvas-wide video prefix in front of the prompt exactly once.
 * Re-composing replaces the previous block instead of stacking another.
 */
export function composeCanvasVideoPrefixPrompt(
  prompt: string | null | undefined,
  prefixPrompt: string | null | undefined,
): string {
  const prefix = normalizeCanvasVideoPrefixPrompt(prefixPrompt)
  const base = stripCanvasVideoPrefixPrompt(prompt)
  if (!prefix) return base
  const block = `${VIDEO_PREFIX_PROMPT_OPEN}\n${prefix}\n${VIDEO_PREFIX_PROMPT_CLOSE}`
  return base ? `${block}\n\n${base}` : block
}

export function findCanvasVideoPrefixPromptNode(nodes: readonly GlobalStyleSourceNode[]): GlobalStyleSourceNode | null {
  const matches = nodes.filter((node) => (
    node.data?.videoPrefixPrompt === true
    && (node.type === 'text' || node.type === 'note')
    && typeof node.data.text === 'string'
    && node.data.text.trim().length > 0
  ))
  return matches.length === 1 ? matches[0] : null
}

export function readCanvasVideoPrefixPrompt(nodes: readonly GlobalStyleSourceNode[]): string {
  return normalizeCanvasVideoPrefixPrompt(findCanvasVideoPrefixPromptNode(nodes)?.data?.text)
}
