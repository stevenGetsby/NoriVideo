const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

type ElementLike = { tagName?: unknown; type?: unknown; isContentEditable?: unknown; parentElement?: ElementLike | null }

/** True when a right-click landed where the user types, so the browser's own Cut/Copy/Paste menu must win. */
export function isTextEntryTarget(target: unknown): boolean {
  let node = target as ElementLike | null | undefined
  while (node && typeof node === 'object') {
    const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : ''
    if (tag === 'TEXTAREA') return true
    if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has(String(node.type ?? 'text').toLowerCase())
    if (node.isContentEditable === true) return true
    node = node.parentElement
  }
  return false
}
