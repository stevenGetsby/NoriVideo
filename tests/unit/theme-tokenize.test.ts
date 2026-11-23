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
    expect(transformCss('.badge { color: rgb(var(--nori-s-ffffff)); background: var(--fos-brand-solid); }')).toContain('color: var(--fos-on-cta)')
    expect(transformCss('.nav { color: #fff; background: var(--nav-hue); }')).toContain('color: var(--fos-on-cta)')
    expect(transformCss('.button { color: #fff; background: var(--fos-primary); }')).toContain('color: var(--fos-on-cta)')
    expect(transformCss('.button { color: rgb(var(--nori-text-1)); background: var(--fos-primary); }')).toContain('color: var(--fos-on-cta)')
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
  it('maps comma RGBA colors to the same dark channel and alpha', () => {
    const tokens = new Map()
    const source = '.x { color: rgba(213, 214, 224, 0.62); background: rgba(19, 19, 25, .7); }'
    const result = transformCss(source, tokens)
    expect(result).toContain('color: rgb(var(--nori-t-d5d6e0) / 0.62)')
    expect(result).toContain('background: rgb(var(--nori-bg-2) / 0.7)')
    expect(transformCss('.x { stroke: rgba(110, 123, 255, .6); }')).toContain('stroke: rgb(var(--nori-primary) / 0.6)')
    expect(tokens.get('t-d5d6e0').dark).toBe('d5d6e0')
    expect(transformCss(result)).toBe(result)
  })
  it('repairs surface-role foregrounds and semantic text variables', () => {
    expect(transformCss('.x { color: rgb(var(--nori-s-f3f4f6)); }')).toContain('color: rgb(var(--nori-t-f3f4f6))')
    expect(transformCss(':root { --glass-text-primary: rgb(var(--nori-s-f0f0f6)); }')).toContain('--glass-text-primary: rgb(var(--nori-t-f0f0f6))')
  })
  it('does not turn forced-dark descendants light', () => {
    expect(generatedCss(new Map([['t-ffffff', { dark: 'ffffff', light: '161827' }]]))).toContain(':not(.nori-force-dark)')
  })
})
