import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('UX batch 1b title, canvas chrome and cover cleanup', () => {
  it('offers a compact more menu below the 720px header container', () => {
    const header = source('src/components/frameos/FosProjectHeader.tsx')

    expect(header).toContain('data-testid="project-more-actions"')
    expect(header).toContain('aria-haspopup="menu"')
    expect(header).toContain('>协作任务</button>')
    expect(header).toContain('>作品设置</button>')
    expect(header).toContain('>编辑作品</button>')
    expect(header).toContain('>删除作品</button>')
  })

  it('positions the story tips below the measured canvas chrome', () => {
    const canvas = source('src/features/canvas/canvas.css')
    const story = source('src/features/canvas/story/story-canvas.css')
    const tipsRule = story.match(/\.nori-story-tips \{\n  position: absolute;\n(?:[^}]*)\}/)?.[0] ?? ''

    expect(canvas).toMatch(/\.nori-canvas-workspace \{[\s\S]*?--nori-canvas-chrome-h: 102px;/)
    expect(canvas).toMatch(/\.nori-canvas-chrome \{[\s\S]*?height: var\(--nori-canvas-chrome-h, 102px\);/)
    expect(canvas).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.nori-canvas-workspace \{ --nori-canvas-chrome-h: 102px; \}/)
    expect(tipsRule).toContain('top: calc(var(--nori-canvas-chrome-h, 102px) + 12px)')
    expect(tipsRule).toContain('right: 24px')
    expect(tipsRule).not.toContain('top: 64px')
  })

  it('drops the collapsed-sidebar title offset and clips cover decoration', () => {
    const styles = source('src/styles/frameos-replica.css')

    expect(styles).not.toContain('.fos-sidebar.is-collapsed + .fos-main .works-heading { padding-left: 56px; }')
    expect(styles).not.toContain('.works-heading .works-view-title { padding-left: 56px; }')
    expect(styles).toMatch(/\.work-cover \{[^}]*contain: paint;/)
  })
})
