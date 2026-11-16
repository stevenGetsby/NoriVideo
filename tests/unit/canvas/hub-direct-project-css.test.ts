import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.join(process.cwd(), 'src/features/canvas/canvas.css'), 'utf8')

describe('canvas hub direct project entries', () => {
  it('sizes the first grid column to the real compact cover width', () => {
    const rule = css.match(/\.nori-canvas-hub-direct-projects > div > button \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('grid-template-columns: 58px minmax(0, 1fr) 16px')
  })

  it('drops the dead initial-letter rules replaced by WorkCover', () => {
    expect(css).not.toContain('.nori-canvas-hub-direct-projects > div > button > i')
  })

  it('pins the compact cover box inside the hub button', () => {
    expect(css).toContain('.nori-canvas-hub-direct-projects > div > button > .work-cover { width: 58px; height: 46px; min-width: 0; }')
  })
})
