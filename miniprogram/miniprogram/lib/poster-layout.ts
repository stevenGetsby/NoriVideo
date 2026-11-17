export const POSTER_W = 750
export const POSTER_H = 1334
export const POSTER_GRADIENT_START = 0.4
export const POSTER_CARD = { x: 40, y: 1100, w: 670, h: 190, r: 24 }
export const POSTER_QR = { x: 536, y: 1120, size: 150 }

export const ENDING_TYPE_COLOR: Record<string, string> = {
  good: '#38D39F', normal: '#4C7DFF', bad: '#FF6B6B', hidden: '#FFB547',
}
export const ENDING_TYPE_LABEL: Record<string, string> = {
  good: '圆满结局', normal: '普通结局', bad: '遗憾结局', hidden: '隐藏结局',
}

export function coverCrop(w: number, h: number, targetW = POSTER_W, targetH = POSTER_H): { sx: number; sy: number; sw: number; sh: number } {
  if (w <= 0 || h <= 0) return { sx: 0, sy: 0, sw: targetW, sh: targetH }
  const scale = Math.max(targetW / w, targetH / h)
  const sw = targetW / scale
  const sh = targetH / scale
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh }
}

export function fitText(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text
  let out = text
  while (out.length > 0 && measure(`${out}…`) > maxWidth) out = out.slice(0, -1)
  return out ? `${out}…` : '…'
}

export function wrapText(text: string, maxWidth: number, maxLines: number, measure: (text: string) => number): string[] {
  if (!text) return []
  if (maxLines <= 1) return [fitText(text, maxWidth, measure)]
  const lines: string[] = []
  let rest = text
  while (rest) {
    if (measure(rest) <= maxWidth) {
      lines.push(rest)
      break
    }
    if (lines.length === maxLines - 1) {
      lines.push(fitText(rest, maxWidth, measure))
      break
    }
    let cut = rest.length
    while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut -= 1
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  return lines
}

export interface EndingMiddle {
  tagY: number
  lineY: number
  nameY: number
  nameLineH: number
  rarityY: number | null
}

export function endingMiddle(nameLines: number, hasRarity: boolean): EndingMiddle {
  const nameY = 930
  const nameLineH = 66
  const nameEnd = nameY + Math.max(1, nameLines) * nameLineH
  return { tagY: 820, lineY: 884, nameY, nameLineH, rarityY: hasRarity ? nameEnd + 4 : null }
}

export interface WorkMiddle {
  nameY: number
  nameLineH: number
  taglineY: number
  taglineLineH: number
  tagsY: number | null
}

export function workMiddle(nameLines: number, taglineLines: number): WorkMiddle {
  const nameY = 820
  const nameLineH = 66
  const taglineY = nameY + Math.max(1, nameLines) * nameLineH + 12
  const taglineLineH = 42
  const tagsY = taglineY + Math.max(1, taglineLines) * taglineLineH + 16
  return { nameY, nameLineH, taglineY, taglineLineH, tagsY: tagsY + 40 <= POSTER_CARD.y ? tagsY : null }
}
