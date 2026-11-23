const MAX_THREAD_MESSAGES = 200
const MAX_THREAD_BYTES = 1.5 * 1024 * 1024

/** Keep a contiguous recent suffix without retaining an orphaned tool result. */
export function capThreadMessages<T extends { role: string }>(messages: readonly T[]): T[] {
  const encoder = new TextEncoder()
  let bytes = 2 // JSON array delimiters
  let start = messages.length
  for (let index = messages.length - 1; index >= Math.max(0, messages.length - MAX_THREAD_MESSAGES); index--) {
    const itemBytes = encoder.encode(JSON.stringify(messages[index])).byteLength
    const delimiter = start < messages.length ? 1 : 0
    if (bytes + itemBytes + delimiter > MAX_THREAD_BYTES) break
    bytes += itemBytes + delimiter
    start = index
  }
  while (start < messages.length && messages[start].role !== 'user') start++
  return messages.slice(start)
}

export function canvasAgentThreadTitle(messages: readonly { role: string; parts: readonly unknown[] }[]) {
  const user = messages.find((message) => message.role === 'user')
  const label = user?.parts.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const item = part as { type?: unknown; text?: unknown }
    return item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  }).join(' ').replace(/\s+/gu, ' ').trim() ?? ''
  return Array.from(label).slice(0, 30).join('') || '新对话'
}
