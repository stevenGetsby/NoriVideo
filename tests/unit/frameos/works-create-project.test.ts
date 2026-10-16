import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS-compatible project creation', () => {
  it('offers the unified Nori1.0 product, four visual styles and duration modes', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')
    const variants = readSource('src/components/frameos/works/create-project-variants.ts')

    expect(dialog).toContain('<strong>Nori1.0</strong>')
    expect(dialog).not.toContain('精品版 2.0')
    expect(dialog).not.toContain('<strong>精品版</strong>')
    expect(dialog).toContain("{ value: 'anime-3d', label: '3D 动漫' }")
    expect(dialog).toContain("{ value: 'anime-2.5d', label: '2.5D 动漫' }")
    expect(dialog).toContain("{ value: 'anime-2d', label: '2D 动漫' }")
    expect(dialog).toContain('统一的短剧工业化生产工作流')
    expect(dialog).toContain('role="radiogroup"')
    expect(dialog).toContain('<select')
    expect(dialog).toContain('type CreateProjectDurationMode')
    expect(variants).toContain("export type CreateProjectDurationMode = 'per-episode' | 'per-1000-chars'")
    expect(dialog).toContain("videoResolution: '480p'")
  })

  it('keeps the overseas-redraw audience pills and requires an explicit duration', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')

    expect(dialog).toContain('label="目标受众"')
    expect(dialog).toContain("{ value: 'global-platform', label: '海外平台' }")
    expect(dialog).toContain("setError('请输入单集时长')")
    expect(dialog).toContain('min={bounds.minimum}')
    expect(dialog).toContain('max={bounds.maximum}')
    expect(dialog).toContain('required')
  })

  it('matches the updated premium2 duration order and Escape-close behavior', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')

    expect(dialog.indexOf('>每千字</button>')).toBeLessThan(dialog.indexOf('>每集</button>'))
    expect(dialog).toContain("if (event.key !== 'Escape') return")
    expect(dialog).toContain('if (!submittingRef.current) onClose()')
    expect(dialog).toContain('aria-label="关闭创建作品"')
  })

  it('wires initial focus, a modal Tab loop, and trigger-focus restoration', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')

    expect(dialog).toContain('focusCreateProjectDialogInitial(initialFocusRef.current, dialog)')
    expect(dialog).toContain('trapCreateProjectDialogTab(dialog, document.activeElement, event.shiftKey)')
    expect(dialog).toContain('restoreCreateProjectDialogFocus(restoreFocusRef.current)')
    expect(dialog).toContain('role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
  })

  it('reserves stable space between the available-script search icon and text', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(dialog).toContain('className="create-project-script-search"')
    expect(dialog).toContain('aria-label="搜索可用剧本"')
    expect(styles).toContain('.create-project-script-search > .fos-input { padding-left: 36px;')
    expect(styles).toContain('pointer-events: none; transform: translateY(-50%);')
  })

  it('submits an explicit 1-100 episode range to the atomic project endpoint', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')
    const route = readSource('src/app/api/projects/route.ts')

    expect(dialog).toContain('指定集数范围')
    expect(dialog).toContain('initialEpisodeStart: 1')
    expect(dialog).toContain('initialEpisodeEnd: 3')
    expect(client).toContain("form.set('initialEpisodeStart'")
    expect(client).toContain("form.set('initialEpisodeEnd'")
    expect(client).not.toContain('/episodes/batch')
    expect(route).toContain('normalizeInitialEpisodeRange(rawBody)')
    expect(route).toContain('initialEpisodesCreated')
  })

  it('offers a blank project path without importing a script or creating episodes', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')

    expect(dialog).toContain("type ScriptSource = 'blank' | 'writer' | 'local' | 'range'")
    expect(dialog).toContain('>空白作品</button>')
    expect(dialog).toContain('不导入剧本、不预建剧集')
    expect(dialog).toContain("source === 'blank'")
    expect(dialog).toContain("source === 'blank'\n        ? { ...normalizedDraft, scriptFile: null, importedScriptText: '', importedScriptTitle: '', initializeEpisodeRange: false")
    expect(client).toContain("'创建空白作品…'")
  })

  it('states that a custom style overrides the selected project style', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')

    expect(dialog).toContain('内置画风已被自定义画风覆盖')
    expect(dialog).toContain('生成时完全忽略内置画风选项')
    expect(dialog).toContain('填写后将完全覆盖上方作品风格')
  })

  it('keeps the create-project dialog fully accessible on small screens', () => {
    const styles = readSource('src/styles/frameos-replica.css')

    expect(styles).toContain('width: min(1000px,100%);')
    expect(styles).toContain('height: min(920px,100%);')
    expect(styles).toContain('.create-project-dialog > .create-project-body')
    expect(styles).toContain('flex: 1 1 auto;')
    expect(styles).toContain('overscroll-behavior: contain;')
    expect(styles).toContain('@media (max-height: 760px)')
    expect(styles).toContain('.create-project-dialog { height: 100%; max-height: 100%; }')
    expect(styles).toContain('@media (max-width: 480px)')
    expect(styles).toContain('grid-template-columns: repeat(2,minmax(0,1fr));')
  })

  it('uses an independent project-creation capability without granting work administration', () => {
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')
    const panels = readSource('src/components/frameos/works/FosWorkPanels.tsx')

    expect(client).toContain('else if (!requestedWork.canCreateProjects)')
    expect(client).toContain("hasAccountPermissions(session?.user || {}, ['projectCreate'])")
    expect(client).toContain('canCreateProjects={Boolean(work.canCreateProjects && canCreateProjects)}')
    expect(client).not.toContain('canManageProjects')
    expect(panels).toContain('const canManage = Boolean(project.canManage)')
    expect(panels).not.toContain('canAdminProjects')
  })

  it('never creates a fixed default work and keeps work structure manager-only', () => {
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')
    const route = readSource('src/app/api/projects/route.ts')
    const agent = readSource('src/lib/super-agent/orchestrator.ts')

    expect(client).toContain("session?.user?.role === 'admin'")
    expect(route).toContain('requireWorkProjectCreator(session, workId)')
    expect(route).toContain("code: 'PROJECT_WORK_REQUIRED'")
    expect(route).not.toContain("createWork(session, { name: '默认项目' })")
    expect(agent).not.toContain("name: '默认项目'")
  })
})
