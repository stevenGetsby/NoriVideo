import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS assignment page replica contract', () => {
  it('keeps the verified filters, conditional tabs, and per-tab table columns', () => {
    const client = readSource('src/components/frameos/FosAssignmentsClient.tsx')
    const table = readSource('src/components/frameos/FosAssignmentsTable.tsx')
    const viewModel = readSource('src/components/frameos/assignments-view-model.ts')

    expect(client).toContain('placeholder="全部作品"')
    expect(client).toContain('placeholder="全部项目"')
    expect(client).toContain('placeholder="全部类型"')
    expect(client).toContain("tab.key !== 'pending_review' || showPendingReviewTab")
    expect(client).toContain('onKeyDown={(event) => handleTabKeyDown(event, tab.key)}')
    expect(client).toContain('tabIndex={activeTab === tab.key ? 0 : -1}')
    expect(client).toContain('aria-controls={`assignment-panel-${tab.key}`}')
    expect(table).toContain('<th className="is-left">任务</th>')
    expect(table).toContain('<th>状态</th>')
    expect(table).toContain('<th>负责人</th>')
    expect(table).toContain('<th>操作备注</th>')
    expect(table).toContain('aria-labelledby={`assignment-tab-${activeTab}`}')
    expect(viewModel).toContain("if (tab === 'done')")
    expect(viewModel).toContain("field: 'completedAt', label: '完成时间'")
    expect(viewModel).toContain("field: 'submittedAt', label: '提交时间'")
  })

  it('loads every works page for complete task filters', () => {
    const client = readSource('src/components/frameos/FosAssignmentsClient.tsx')
    const loader = readSource('src/components/frameos/works/fetch-all-works.ts')

    expect(client).toContain("import { fetchAllWorks } from './works/fetch-all-works'")
    expect(client).toContain('void fetchAllWorks({')
    expect(client).toContain('setUnassignedProjects(unassigned?.projects ?? [])')
    expect(client).toContain('return projects.length > 0 ? [{ value: work.id, label: work.name, projects }] : []')
    expect(loader).toContain('while (page <= totalPages)')
  })

  it('retries failed work filters independently and clamps stale pages after mutations', () => {
    const client = readSource('src/components/frameos/FosAssignmentsClient.tsx')

    expect(client).toContain('const [worksRefreshToken, setWorksRefreshToken] = useState(0)')
    expect(client).toContain('}, [authReady, status, worksRefreshToken])')
    expect(client).toContain('if (worksError) setWorksRefreshToken((current) => current + 1)')
    expect(client).toContain('const lastPage = Math.max(1, Math.ceil(listTotal / PAGE_SIZE))')
    expect(client).toContain('if (currentPage > lastPage)')
    expect(client).toContain('setPages((current) => ({ ...current, [activeTab]: lastPage }))')
  })

  it('supports FrameOS keyboard search, dismissal, and focus semantics in custom task filters', () => {
    const controls = readSource('src/components/frameos/FosAssignmentControls.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(controls).toContain("event.key === 'Escape'")
    expect(controls).toContain('shouldDeferAssignmentFilterActivationToNestedButton(event.key, event.target, event.currentTarget)')
    expect(controls).toContain("event.key === 'ArrowDown' || event.key === 'ArrowUp'")
    expect(controls).toContain("!open && event.key === 'Enter'")
    expect(controls).toContain('event.key.length === 1')
    expect(controls).toContain('setQuery(event.key)')
    expect(controls).toContain('event.currentTarget.contains(event.relatedTarget as Node | null)')
    expect(controls).toContain('moveAssignmentFilterOptionIndex')
    expect(controls).toContain('aria-activedescendant={activeOptionId}')
    expect(controls).toContain('aria-autocomplete="none"')
    expect(controls).toContain('aria-label={`筛选${filterName}`}')
    expect(controls).toContain('fa-select-inline-input')
    expect(controls).toContain('className="fa-select-clear"')
    expect(controls).not.toContain('<span>{placeholder}</span>')
    expect(styles).toContain('border-radius: 12px;')
    expect(styles).toContain('height: 40px;')
    expect(styles).toContain('border: 1px solid rgba(255,255,255,.04);')
    expect(styles).toContain('border-radius: 0;')
    expect(styles).toContain('padding: 0 14px;')
    expect(styles).toContain('font-weight: 500;')
    expect(styles).toContain('top: calc(100% + 12px);')
    expect(styles).toContain('.fa-select-trigger:focus-visible')
  })

  it('matches the verified 420px metadata-only drawer without an extra detail request', () => {
    const controls = readSource('src/components/frameos/FosAssignmentControls.tsx')
    const styles = readSource('src/styles/frameos-replica.css')
    const drawerStart = controls.indexOf('export function AssignmentDetailDrawer')
    const drawerEnd = controls.indexOf('export function AssignmentReviewDialog', drawerStart)
    const drawer = controls.slice(drawerStart, drawerEnd)

    expect(styles).toContain('.fa-task-drawer { display: flex; width: 420px;')
    expect(drawer).toContain('<dt>任务</dt>')
    expect(drawer).toContain('<dt>更新时间</dt>')
    expect(drawer).toContain('assignmentNavigateLabel(assignment)')
    expect(drawer).toContain('onNavigate(assignment)')
    expect(drawer).not.toContain('/api/collaboration/assignments/')
    expect(drawer).not.toContain('任务动态')
    expect(drawer).not.toContain('fa-history')
  })

  it('traps dialog focus, sets an explicit initial target, and restores the opener', () => {
    const controls = readSource('src/components/frameos/FosAssignmentControls.tsx')

    expect(controls).toContain('function useDialogFocusTrap<T extends HTMLElement>()')
    expect(controls).toContain('const previouslyFocused = document.activeElement instanceof HTMLElement')
    expect(controls).toContain("dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')")
    expect(controls).toContain("if (event.key !== 'Tab') return")
    expect(controls).toContain('lastFocusable.focus()')
    expect(controls).toContain('firstFocusable.focus()')
    expect(controls).toContain('if (previouslyFocused?.isConnected) previouslyFocused.focus()')
    expect(controls.match(/data-dialog-initial-focus/g)).toHaveLength(3)
    expect(controls.match(/onKeyDown=\{trapTabKey\}/g)).toHaveLength(2)
    expect(controls.match(/tabIndex=\{-1\}/g)).toHaveLength(2)
  })

  it('uses the FrameOS-sized spinner without visible loading copy', () => {
    const table = readSource('src/components/frameos/FosAssignmentsTable.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(table).toContain('className="fa-loading-spinner animate-spin"')
    expect(table).toContain('aria-label="加载任务中"')
    expect(table).not.toContain('<span>加载任务中…</span>')
    expect(styles).toContain('.fa-loading-spinner { width: 42px; height: 42px; }')
  })

  it('matches the verified solid empty icon and fixed/flexible table column contract', () => {
    const table = readSource('src/components/frameos/FosAssignmentsTable.tsx')
    const styles = readSource('src/styles/frameos-replica.css')
    const icons = readSource('src/components/ui/icons/custom.tsx')

    expect(table).toContain('name="clipboardCheckSolid"')
    expect(table).toContain('className="fa-col-status"')
    expect(table).toContain('className="fa-col-time"')
    expect(styles).toContain('.fa-table col.fa-col-status { width: 92px; }')
    expect(styles).toContain('.fa-table col.fa-col-time { width: 168px; }')
    expect(styles).toContain('.fa-table.has-double-time { min-width: 1256px; }')
    expect(icons).toContain('clipboardCheckSolid: CustomIcon099')
  })
})
