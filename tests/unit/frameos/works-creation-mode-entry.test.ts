import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeWorkProject } from '@/components/frameos/works/types'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('work covers follow the project creation mode', () => {
  it('normalizes creationMode and falls back to the workflow default', () => {
    expect(normalizeWorkProject({ id: 'p1', creationMode: 'canvas' })?.creationMode).toBe('canvas')
    expect(normalizeWorkProject({ id: 'p1', creation_mode: 'canvas' })?.creationMode).toBe('canvas')
    expect(normalizeWorkProject({ id: 'p1', creationMode: 'workflow' })?.creationMode).toBe('workflow')
    expect(normalizeWorkProject({ id: 'p1' })?.creationMode).toBe('workflow')
    expect(normalizeWorkProject({ id: 'p1', creationMode: 'unknown' })?.creationMode).toBe('workflow')
  })

  it('keeps the API select and the panel entry links aligned with creationMode', () => {
    const service = readSource('src/lib/works/service.ts')
    const panels = readSource('src/components/frameos/works/FosWorkPanels.tsx')

    expect(service).toContain('creationMode: true')

    expect(panels).toContain('const workbenchHref = `/workflow/${project.id}/workbench-premium2`')
    expect(panels).toContain('const canvasHref = `${workbenchHref}/canvas`')
    expect(panels).toContain("const entryHref = project.creationMode === 'canvas' ? canvasHref : workbenchHref")
    expect(panels).toContain('<Link href={{ pathname: entryHref }} className="works-project-running-enter">进入作品</Link>')
    expect(panels).toContain('href={{ pathname: entryHref }}\n        className="works-project-main"')

    expect(panels).toContain("href={{ pathname: project.creationMode === 'canvas' ? workbenchHref : canvasHref }}")
    expect(panels).toContain("data-testid={project.creationMode === 'canvas' ? 'project-card-workbench-entry' : 'project-card-canvas-entry'}")
    expect(panels).toContain("{project.creationMode === 'canvas' ? '工作台' : '进入画布'}")
    expect(panels).toContain('data-testid="project-card-canvas-menu-entry"')
  })
})
