import { describe, expect, it } from 'vitest'
import { generatedCss, lightColor, srgbToOklch, transformCss, transformTsx } from '../../scripts/theme/tokenize-colors.mjs'

describe('theme color tokenization', () => {
  it('uses ink without contrast multiplication for text', () => {
    expect(transformCss('.x { color: rgba(255, 255, 255, .6); }')).toContain('color: rgb(var(--nori-ink) / 0.6)')
  })
  it('strengthens translucent surfaces in light mode', () => {
    expect(transformCss('.x { background: rgba(255,255,255,.05); }')).toContain('rgb(var(--nori-ink) / calc(0.05 * var(--nori-a)))')
  })
  it('maps exact dark tokens without generated roundoff', () => {
    expect(transformCss('.x { background: #202028; color: #f5f5fa }')).toContain('rgb(var(--nori-s-202028))')
    expect(transformCss('.x { color: #f5f5fa }')).toContain('rgb(var(--nori-text-1))')
  })
  it('preserves colors in forced dark media and login regions', () => {
    const source = '.nori-force-dark .x { color: #f5f5fa } .nori-auth { background: #08080c }'
    expect(transformCss(source)).toBe(source)
  })
  it('preserves alpha and maps arbitrary Tailwind colors', () => {
    expect(transformCss('.x { color: #f5f5fa80 }')).toContain('rgb(var(--nori-text-1) / 0.5019607843137255)')
    expect(transformTsx('<div className="bg-[#1b1b23] text-[#d1d2da]" />')).toContain('bg-[rgb(var(--nori-bg-3))]')
  })
  it('keeps text on brand buttons white', () => {
    expect(transformTsx('<button className="bg-indigo-600 text-white">x</button>')).toContain('text-on-brand')
    expect(transformTsx('<h1 className="text-white">x</h1>')).toContain('text-white')
  })
  it('maps surface and text lightness in opposite directions', () => {
    expect(srgbToOklch(lightColor('202028', 's')).l).toBeGreaterThan(.85)
    expect(srgbToOklch(lightColor('d1d2da', 't')).l).toBeLessThan(.35)
    expect(lightColor('ffffff', 's')).toBe('ffffff')
    expect(lightColor('0c0c11', 't')).toBe('0c0c11')
  })
  it('generates stable paired tokens and is idempotent', () => {
    const tokens = new Map()
    const result = transformCss('.x { background: #202028; color: #d1d2da }', tokens)
    expect(transformCss(result)).toBe(result)
    expect(generatedCss(tokens)).toContain('--nori-s-202028: 32 32 40')
    expect(generatedCss(tokens)).toContain('html[data-nori-theme="light"]')
  })
})
