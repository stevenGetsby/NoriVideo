import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('global infinite canvas hierarchy', () => {
  it('keeps work identity while mapping projects and filters project choices to the active work', () => {
    const types = readSource('src/features/canvas/types.ts')
    const hub = readSource('src/components/frameos/FosCanvasHubClient.tsx')
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')

    expect(types).toContain('export type CanvasWorkOption')
    expect(types).toContain('workId?: string | null')
    expect(types).toContain('workName?: string | null')

    expect(hub).toContain('workId: work.id')
    expect(hub).toContain("workName: work.virtual ? '未归属项目' : work.name")
    expect(hub).toContain('project.workId === selectedWork.id')
    expect(hub).toContain('data-testid="global-canvas-work-picker"')
    expect(hub).toContain('data-testid="global-canvas-project-picker"')
    expect(hub).toContain("searchParams?.get('work_id')")
    expect(hub).toContain('router.replace(`/canvas?work_id=${encodeURIComponent(workId)}`)')

    expect(chrome).toContain('data-testid="global-canvas-active-work-picker"')
    expect(chrome).toContain('const activeWorkId = activeProject?.workId || null')
    expect(chrome).toContain('project.workId === activeWorkId')
    expect(chrome).toContain('href={`${canvasHomeHref}?work_id=${encodeURIComponent(work.id)}`}')
    expect(chrome).toContain('placeholder="搜索项目"')
    expect(chrome).toContain('placeholder="搜索作品"')
  })

  it('keeps project-scoped and global canvas routes distinct', () => {
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const hub = readSource('src/components/frameos/FosCanvasHubClient.tsx')

    expect(workspace).toContain('routeBase || `/workflow/${projectId}/workbench-premium2/canvas`')
    expect(hub).toContain('routeBase={`/canvas/${encodeURIComponent(selectedProject.id)}`}')
    expect(hub).toContain('canvasHomeHref="/canvas"')
    expect(hub).toContain('router.push(`/canvas/${encodeURIComponent(projectId)}`)')
  })

  it('loads every works API page advertised by pagination metadata', () => {
    const hub = readSource('src/components/frameos/FosCanvasHubClient.tsx')
    const projects = readSource('src/components/frameos/FosProjectsClient.tsx')
    const fetchAllWorks = readSource('src/components/frameos/works/fetch-all-works.ts')

    expect(hub).toContain('fetchAllWorks')
    expect(projects).toContain('fetchAllWorks')
    expect(fetchAllWorks).toContain('normalizeWorksResponse')
    expect(fetchAllWorks).toContain('pagination.totalPages')
    expect(fetchAllWorks).toMatch(/(?:page|nextPage)\s*<=\s*[^\n]*totalPages/)
    expect(fetchAllWorks).toMatch(/pageSize/)
  })
})

describe('canvas management dialogs and permissions', () => {
  it('uses Nori dialogs for create, rename, and delete instead of browser prompts', () => {
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const dialog = readSource('src/features/canvas/components/CanvasManagementDialog.tsx')

    expect(workspace).not.toContain('window.prompt')
    expect(workspace).not.toContain('window.confirm')
    expect(workspace).toContain('CanvasManagementDialog')
    expect(workspace).toContain("setManagementIntent({ type: 'create'")
    expect(workspace).toContain("setManagementIntent({ type: 'rename'")
    expect(workspace).toContain("setManagementIntent({ type: 'delete'")

    expect(dialog).toContain('data-testid={`canvas-${intent.type}-dialog`}')
    expect(dialog).toContain("intent.type === 'create' ? '新建画布'")
    expect(dialog).toContain("intent.type === 'rename' ? '重命名画布'")
    expect(dialog).toContain("'删除画布'")
    expect(dialog).toContain('maxLength={120}')
    expect(dialog).toContain('此操作无法撤销')
    expect(dialog).toContain("event.key !== 'Escape' || busy")
  })

  it('guards management requests and hides canvas mutations from read-only users', () => {
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')

    expect(workspace).toContain('if (!canEdit || managementBusy) return')
    expect(workspace).toContain('if (!canEdit || !activeCanvas || managementBusy) return')
    expect(workspace).toContain("canEditInfiniteCanvas(session?.user)")
    expect(chrome).toContain("readOnly ? (")
    expect(chrome).toContain('当前账号仅可查看画布')
    expect(chrome).toContain('onCreateCanvas(); setMenu(null)')
    expect(chrome).toContain('onRenameCanvas(); setMenu(null)')
    expect(chrome).toContain('onDeleteCanvas(); setMenu(null)')
    expect(chrome).toContain('onSyncProduction(); setMenu(null)')
    expect(chrome).toContain('onOpenRevisions(); setMenu(null)')
  })
})

describe('create project deep link from the canvas hierarchy', () => {
  it('links both work and project pickers to the existing project creation flow', () => {
    const hub = readSource('src/components/frameos/FosCanvasHubClient.tsx')
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')

    expect(hub).toContain('return createWorkInProjectHref(workId)')
    expect(hub).toContain('href={createProjectHref(selectedWork.id)}')
    expect(hub).toContain('data-testid="global-canvas-create-project"')
    expect(hub).toContain('canCreateProjects && selectedWork.id !== UNASSIGNED_WORK_ID')
    expect(workspace).toContain('createProjectHref={createProjectHref}')
    expect(chrome).toContain('hasGlobalHierarchy && createProjectHref')
    expect(chrome).toContain('<Link href={createProjectHref} data-testid="global-canvas-active-create-project"')
  })

  it('opens the existing CreateProjectDialog for a valid work selected by URL', () => {
    const projects = readSource('src/components/frameos/FosProjectsClient.tsx')

    expect(projects).toContain("urlParams?.get('create_project') === '1'")
    expect(projects).toContain("urlParams?.get('work_id')")
    expect(projects).toContain('works.find((work) => work.id === requestedWorkId && !work.virtual)')
    expect(projects).toContain('else if (!requestedWork.canCreateProjects)')
    expect(projects).toContain('setCreateProjectWork')
    expect(projects).toContain("remainingParams.delete('create_project')")
    expect(projects).toContain("remainingParams.delete('work_id')")
    expect(projects).toContain('<CreateProjectDialog')
    expect(projects).toContain('workName={createProjectWork.name}')
  })
})
