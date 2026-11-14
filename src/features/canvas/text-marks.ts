import type { CanvasTextHighlight, CanvasTextMark } from './types'

function styleEqual(a: CanvasTextMark, b: CanvasTextMark) {
  return a.bold === b.bold && a.highlight === b.highlight
}

export function normalizeMarks(marks: CanvasTextMark[] | undefined, textLength: number): CanvasTextMark[] {
  const sorted = (marks || []).flatMap((mark) => {
    const start = Math.max(0, Math.floor(mark.start))
    const end = Math.min(textLength, Math.floor(mark.end))
    return start < end && (mark.bold || mark.highlight) ? [{ start, end, ...(mark.bold ? { bold: true as const } : {}), ...(mark.highlight ? { highlight: mark.highlight } : {}) }] : []
  }).sort((a, b) => a.start - b.start || a.end - b.end)
  const result: CanvasTextMark[] = []
  const points = [...new Set(sorted.flatMap((mark) => [mark.start, mark.end]))].sort((a, b) => a - b)
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const mark = [...sorted].reverse().find((item) => item.start <= start && item.end >= end)
    if (!mark) continue
    const previous = result[result.length - 1]
    if (previous && previous.end === start && styleEqual(previous, mark)) previous.end = end
    else result.push({ start, end, ...(mark.bold ? { bold: true as const } : {}), ...(mark.highlight ? { highlight: mark.highlight } : {}) })
  }
  return result.slice(0, 200)
}

function applyStyle(marks: CanvasTextMark[] | undefined, start: number, end: number, style: (mark?: CanvasTextMark) => Pick<CanvasTextMark, 'bold' | 'highlight'>) {
  if (start >= end) return normalizeMarks(marks, Number.MAX_SAFE_INTEGER)
  const normalized = normalizeMarks(marks, Number.MAX_SAFE_INTEGER)
  const result: CanvasTextMark[] = []
  for (const mark of normalized) {
    if (mark.end <= start || mark.start >= end) result.push(mark)
    else {
      if (mark.start < start) result.push({ ...mark, end: start })
      if (mark.end > end) result.push({ ...mark, start: end })
    }
  }
  const points = new Set([start, end])
  for (const mark of normalized) {
    if (mark.start > start && mark.start < end) points.add(mark.start)
    if (mark.end > start && mark.end < end) points.add(mark.end)
  }
  const ordered = [...points].sort((a, b) => a - b)
  for (let index = 1; index < ordered.length; index += 1) {
    const segmentStart = ordered[index - 1]
    const segmentEnd = ordered[index]
    const original = normalized.find((mark) => mark.start <= segmentStart && mark.end >= segmentEnd)
    const next = style(original)
    if (next.bold || next.highlight) result.push({ start: segmentStart, end: segmentEnd, ...next })
  }
  return normalizeMarks(result, Number.MAX_SAFE_INTEGER)
}

export function toggleBold(marks: CanvasTextMark[] | undefined, start: number, end: number) {
  const normalized = normalizeMarks(marks, Number.MAX_SAFE_INTEGER)
  const allBold = start < end && normalizeMarks(marks, Number.MAX_SAFE_INTEGER).filter((mark) => mark.end > start && mark.start < end).every((mark) => mark.bold) && normalized.some((mark) => mark.end > start && mark.start < end)
  return applyStyle(normalized, start, end, (mark) => ({ ...(mark?.highlight ? { highlight: mark.highlight } : {}), ...(allBold ? {} : { bold: true as const }) }))
}

export function setHighlight(marks: CanvasTextMark[] | undefined, start: number, end: number, color: CanvasTextHighlight | null) {
  const normalized = normalizeMarks(marks, Number.MAX_SAFE_INTEGER)
  const current = normalized.filter((mark) => mark.end > start && mark.start < end).map((mark) => mark.highlight)
  const same = current.length > 0 && current.every((highlight) => highlight === color)
  return applyStyle(normalized, start, end, (mark) => ({ ...(mark?.bold ? { bold: true as const } : {}), ...(color && !same ? { highlight: color } : {}) }))
}

export function clearMarks(marks: CanvasTextMark[] | undefined, start: number, end: number) {
  return applyStyle(marks, start, end, () => ({}))
}

export function rebaseMarks(marks: CanvasTextMark[] | undefined, oldText: string, newText: string): CanvasTextMark[] {
  let prefix = 0
  while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix += 1
  let suffix = 0
  while (suffix < oldText.length - prefix && suffix < newText.length - prefix && oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]) suffix += 1
  const oldEnd = oldText.length - suffix
  const newEnd = newText.length - suffix
  const delta = newText.length - oldText.length
  return normalizeMarks(normalizeMarks(marks, oldText.length).flatMap((mark) => {
    if (mark.end <= prefix) return [mark]
    if (mark.start >= oldEnd) return [{ ...mark, start: mark.start + delta, end: mark.end + delta }]
    if (oldEnd === prefix && mark.start < prefix && prefix < mark.end) return [{ ...mark, end: mark.end + delta }]
    const pieces: CanvasTextMark[] = []
    if (mark.start < prefix) pieces.push({ ...mark, end: prefix })
    if (mark.end > oldEnd) pieces.push({ ...mark, start: newEnd, end: mark.end + delta })
    return pieces
  }), newText.length)
}

export function marksEqual(a: CanvasTextMark[] | undefined, b: CanvasTextMark[] | undefined) {
  const left = normalizeMarks(a, Number.MAX_SAFE_INTEGER)
  const right = normalizeMarks(b, Number.MAX_SAFE_INTEGER)
  return left.length === right.length && left.every((mark, index) => styleEqual(mark, right[index]) && mark.start === right[index].start && mark.end === right[index].end)
}

export function splitByMarks(text: string, marks: CanvasTextMark[] | undefined) {
  const normalized = normalizeMarks(marks, text.length)
  const segments: Array<{ text: string; bold: boolean; highlight?: CanvasTextHighlight }> = []
  let offset = 0
  for (const mark of normalized) {
    if (mark.start > offset) segments.push({ text: text.slice(offset, mark.start), bold: false })
    segments.push({ text: text.slice(mark.start, mark.end), bold: mark.bold === true, highlight: mark.highlight })
    offset = mark.end
  }
  if (offset < text.length) segments.push({ text: text.slice(offset), bold: false })
  return segments
}
