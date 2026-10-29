import type { CSSProperties } from 'react'

// [glow A, glow B, base] drawn from the brand + media hue family so covers stay on-palette.
const COVER_PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ['#3c8bff', '#a855f7', '#0e1430'],
  ['#f472b6', '#7c66ff', '#1c1030'],
  ['#34d399', '#38bdf8', '#08201f'],
  ['#fbbf24', '#f472b6', '#2a1410'],
  ['#fb923c', '#e070e0', '#2a1018'],
  ['#2dd4bf', '#6e7bff', '#0a1a28'],
  ['#a78bfa', '#38bdf8', '#14112e'],
  ['#ff6b8a', '#fbbf24', '#2a0f18'],
]

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function generativeCoverStyle(seed: string): CSSProperties {
  const hash = hashSeed(seed || 'nori')
  const [a, b, base] = COVER_PALETTES[hash % COVER_PALETTES.length]
  const pick = (shift: number, min: number, span: number) => min + ((hash >>> shift) % span)
  return {
    '--cover-a': a,
    '--cover-b': b,
    '--cover-base': base,
    '--cover-x1': `${pick(3, 8, 40)}%`,
    '--cover-y1': `${pick(9, 0, 36)}%`,
    '--cover-x2': `${pick(14, 58, 40)}%`,
    '--cover-y2': `${pick(19, 52, 46)}%`,
    '--cover-angle': `${pick(24, 110, 70)}deg`,
  } as CSSProperties
}

export function coverMonogram(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'N'
  const first = Array.from(trimmed)[0]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}
