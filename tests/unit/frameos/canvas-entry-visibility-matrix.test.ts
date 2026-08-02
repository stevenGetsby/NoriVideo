import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { effectiveAccountPermissions } from '@/lib/account/permissions'
import { canEditInfiniteCanvas } from '@/features/canvas/permissions'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('infinite canvas entry visibility matrix', () => {
  it('keeps the global canvas entry visible in expanded navigation without collapsed icon residue', () => {
    const shell = source('src/components/frameos/FosShell.tsx')
    const primaryNav = shell.slice(shell.indexOf('const primaryNav'), shell.indexOf('const secondaryNav'))

    expect(primaryNav).toContain("{ key: 'canvas', label: '无限画布', href: '/canvas'")
    expect(shell).not.toContain('CollapsedCanvasNavigation')
    expect(shell).not.toContain('data-testid="collapsed-global-canvas-nav"')
    expect(shell).toContain('data-collapsed={collapsed ? \'true\' : \'false\'}')
    expect(shell).toContain('hidden={collapsed}')
  })

  it('keeps project canvas navigation in workbench surfaces and opens the shared canvas menu in canvas mode', () => {
    const shell = source('src/components/frameos/FosShell.tsx')
    const header = source('src/components/frameos/FosProjectHeader.tsx')
    const workflow = source('src/components/frameos/FosWorkflowClient.tsx')
    const worksStyles = source('src/styles/frameos-replica.css')

    expect(shell).toContain('data-testid="project-canvas-nav"')
    expect(shell).not.toContain('data-testid="collapsed-project-canvas-nav"')
    expect(shell).toContain('`/workflow/${projectNavigation.projectId}/workbench-premium2/canvas`')
    expect(header).toContain('data-testid="project-stage-canvas-entry"')
    expect(header).toContain('`/workflow/${projectId}/workbench-premium2/canvas`')
    expect(workflow).toContain('projectNavigation={projectNavigation}')
    expect(workflow).toContain('<FosShell activeKey="canvas" canvasShell titlebarTitle={data.projectName} projectNavigation={projectNavigation}>')
    expect(workflow).toContain('<div key={navigationSurfaceKey} className="contents">')
    expect(workflow).toContain("activeItem: view === 'canvas' ? 'canvas' : 'workbench'")
    expect(worksStyles).toContain('.works-project-date { white-space: nowrap; }')
    expect(worksStyles).toMatch(/\.works-project-canvas-entry\s*\{[\s\S]*?top:\s*128px;/)
    expect(worksStyles).toMatch(/\.works-project-canvas-entry\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/)
  })

  it('allows every work-front role to read and generate on the shared canvas', () => {
    for (const role of ['admin', 'writer', 'asset', 'storyboard'] as const) {
      expect(effectiveAccountPermissions(role)).toContain('read')
    }
    expect(canEditInfiniteCanvas({ role: 'admin' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'storyboard' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'writer' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'asset' })).toBe(true)

    const shell = source('src/components/frameos/FosShell.tsx')
    expect(shell).toContain("session?.user?.role !== 'super_admin'")
    expect(shell).toContain("router.replace({ pathname: '/admin/accounts' })")
  })

  it('gives editable and read-only accounts correct empty-project and new-account guidance', () => {
    const workspace = source('src/features/canvas/CanvasWorkspace.tsx')
    const hub = source('src/components/frameos/FosCanvasHubClient.tsx')

    expect(workspace).toContain("canEdit ? '创建第一张画布' : '暂无可查看的画布'")
    expect(workspace).toContain('请联系管理账号或分镜师创建。')
    expect(workspace).toContain("{canEdit ? <button type=\"button\"")
    expect(hub).toContain("canCreateProjects ? '暂无可用作品' : '暂无已分配项目'")
    expect(hub).toContain('当前账号尚未分配可访问的作品或项目，请联系管理账号完成分配。')
    expect(hub).toContain("canCreateProjects ? '创建或管理作品' : '查看我的作品'")
  })

  it('supports both global and project-scoped direct canvas deep links', () => {
    const globalPage = source('src/app/[locale]/canvas/[[...segments]]/page.tsx')
    const projectPage = source('src/app/[locale]/workflow/[projectId]/workbench-premium2/[[...segments]]/page.tsx')
    const hub = source('src/components/frameos/FosCanvasHubClient.tsx')
    const workspace = source('src/features/canvas/CanvasWorkspace.tsx')

    expect(globalPage).toContain('const [projectId, canvasId] = resolved.segments || []')
    expect(globalPage).toContain('<FosCanvasHubClient initialProjectId={projectId} initialCanvasId={canvasId} />')
    expect(projectPage).toContain("segments[0] === 'canvas' && segments[1]")
    expect(hub).toContain('routeBase={`/canvas/${encodeURIComponent(selectedProject.id)}`}')
    expect(hub).toContain('canvasShell={Boolean(selectedProject)}')
    expect(workspace).toContain('routeBase || `/workflow/${projectId}/workbench-premium2/canvas`')
  })
})
