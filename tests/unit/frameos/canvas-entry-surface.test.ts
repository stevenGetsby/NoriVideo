import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS-compatible infinite canvas entry', () => {
  it('exposes the FrameOS global canvas hub as a real route with work and project selection', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const hubPage = readSource('src/app/[locale]/canvas/[[...segments]]/page.tsx')
    const hub = readSource('src/components/frameos/FosCanvasHubClient.tsx')
    const globalNav = shell.slice(shell.indexOf('const primaryNav'), shell.indexOf('const secondaryNav'))

    expect(globalNav).toContain("{ key: 'canvas', label: '无限画布', href: '/canvas'")
    expect(hubPage).toContain('<FosCanvasHubClient initialProjectId={projectId} initialCanvasId={canvasId} />')
    expect(hub).toContain('data-testid="global-canvas-work-picker"')
    expect(hub).toContain('data-testid="global-canvas-project-picker"')
    expect(hub).toContain('project.workId === selectedWork.id')
    expect(hub).toContain('routeBase={`/canvas/${encodeURIComponent(selectedProject.id)}`}')
  })

  it('keeps project navigation on workbench views and uses the shared canvas menu on canvas views', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const workflow = readSource('src/components/frameos/FosWorkflowClient.tsx')
    const header = readSource('src/components/frameos/FosProjectHeader.tsx')
    const hub = readSource('src/components/frameos/FosCanvasHubClient.tsx')

    expect(shell).toContain('projectNavigation?: FosProjectNavigation')
    expect(shell).toContain('data-testid="project-workbench-nav"')
    expect(shell).toContain('data-testid="project-canvas-nav"')
    expect(shell).toContain('/workbench-premium2/canvas')
    expect(workflow).toContain('projectNavigation={projectNavigation}')
    expect(workflow).toContain('<FosShell activeKey="canvas" canvasShell titlebarTitle={data.projectName} projectNavigation={projectNavigation}>')
    expect(workflow).toContain('<div key={navigationSurfaceKey} className="contents">')
    expect(hub).toContain('canvasShell={Boolean(selectedProject)}')
    expect(hub).toContain('titlebarTitle={selectedProject?.name}')
    expect(header).toContain('data-testid="project-stage-canvas-entry"')
    expect(header).toContain('`/workflow/${projectId}/workbench-premium2/canvas`')
  })

  it('exposes a direct canvas action on each project card for read-only and editable users', () => {
    const projects = readSource('src/components/frameos/FosProjectsClient.tsx')
    const projectPanels = readSource('src/components/frameos/works/FosWorkPanels.tsx')

    expect(projects).toContain("import { WorkPanel } from './works/FosWorkPanels'")
    expect(projectPanels).toContain('data-testid="project-card-canvas-entry"')
    expect(projectPanels).toContain('className="works-project-canvas-entry"')
    expect(projectPanels).toContain('进入画布')
    expect(projectPanels).toContain('data-testid="project-card-canvas-menu-entry"')
    expect(projectPanels).toContain('{!selectable ? (')
    expect(projectPanels).not.toContain('!selectable && (canManage || canMove || canMembers)')
  })
})
