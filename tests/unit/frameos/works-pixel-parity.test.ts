import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS works pixel-parity contract', () => {
  it('keeps the heading, project cards and expanded Nori menus compact', () => {
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')
    const panels = readSource('src/components/frameos/works/FosWorkPanels.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(client).toContain('<h1 className="works-view-title">我的项目</h1>')
    expect(styles).toContain('line-height: 26px;')
    expect(styles).toContain('grid-template-columns: repeat(auto-fill,minmax(220px,231px))')
    expect(styles).toMatch(/\.works-project-card\s*\{[^}]*height:\s*342px;/)
    expect(panels).toContain('className="works-project-date"')
    expect(styles).toContain('.works-project-date { white-space: nowrap; }')
    expect(styles).toContain('.works-panel-menu,.works-card-menu { width: 158px; min-width: 158px; padding: 4px; }')
    expect(styles).toContain('min-height: 44px;')

    expect(panels).toContain('移动到项目')
    expect(panels).toContain('进入无限画布')
    expect(panels).toContain('删除作品')
  })

  it('uses the evidenced create and rename message-box geometry', () => {
    const dialogs = readSource('src/components/frameos/works/FosWorksDialogs.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(dialogs).toContain('variant="create-work"')
    expect(dialogs).toContain('width={480}')
    expect(styles).toContain('.works-modal-overlay.works-create-work-modal { align-items: flex-start; padding-top: 15vh; }')
    expect(dialogs).toContain('variant="rename"')
    expect(dialogs).toContain('width={418}')
    expect(dialogs).toContain('<span>请输入新的{kind}名称</span>')
    expect(dialogs).toContain('>确定</button>')
    expect(styles).toContain('.works-dialog.works-rename-modal .fos-dialog-foot .fos-btn { min-width: 72px; }')
  })
})
