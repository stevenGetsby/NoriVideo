import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { HOME_COPY } from '../../../src/components/home/home-copy'

const source = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

describe('LanmiaoTV public home contracts', () => {
  it('shows the public home only after preserving authenticated and admin redirects', () => {
    const page = source('src/app/[locale]/page.tsx')
    expect(page).toContain('getServerSession(')
    expect(page).toContain('AUTHENTICATED_HOME_PATHNAME')
    expect(page).toContain("resolveAppSurface() === 'admin'")
    expect(page).toContain('resolveRequestSurface(')
    expect(page).toContain("requestHeaders.get('x-forwarded-port')")
    expect(page).toContain('<LanmiaoHome')
  })
  it('keeps the brand page outside the fixed and zoomed workspace shell', () => {
    const home = source('src/components/home/LanmiaoHome.tsx')
    expect(home).toContain('className="lm-home nori-force-dark"')
    expect(home).not.toContain('fos-app')
    expect(home).toContain("import '@/styles/lanmiao-home.css'")
  })
  it('uses no video, remote asset, heavy graphics dependency or web font', () => {
    for (const file of readdirSync('src/components/home')) {
      const text = source(`src/components/home/${file}`)
      expect(text).not.toContain("import('three')")
      expect(text).not.toContain("from 'three'")
      expect(text).not.toContain('<video')
      expect(text).not.toContain('@font-face')
      const external = text.match(/https?:\/\/[^'"`\s<]+/g) || []
      expect(external.filter((url) => !url.startsWith('https://beian.miit.gov.cn'))).toEqual([])
    }
  })
  it('keeps Chinese and English copy complete without signup or invented metrics', () => {
    expect(Object.keys(HOME_COPY.zh)).toEqual(Object.keys(HOME_COPY.en))
    expect(JSON.stringify(HOME_COPY)).not.toMatch(/\d{3,}/)
    expect(HOME_COPY.zh.registration).toContain('暂不开放自行注册')
    expect(HOME_COPY.en.registration).toContain('Self sign-up is closed')
    expect(HOME_COPY.zh.enter).not.toContain('注册')
    expect(HOME_COPY.en.enter).not.toMatch(/sign.?up/i)
  })
  it('keeps motion optional and viewport-unit fallbacks intact', () => {
    const css = source('src/styles/lanmiao-home.css')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).not.toContain(':has(')
    expect(css).not.toContain('animation-timeline')
    expect(css).not.toContain('@container')
    const failures: string[] = []
    postcss.parse(css).walkDecls(/\d(?:dvh|svh|lvh)\b/, (declaration) => {
      const previous = declaration.prev()
      if (previous?.type !== 'decl' || previous.prop !== declaration.prop || !/\dvh\b/.test(previous.value)) failures.push(declaration.toString())
    })
    expect(failures).toEqual([])
  })
})
