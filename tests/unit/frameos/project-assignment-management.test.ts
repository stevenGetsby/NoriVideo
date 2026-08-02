import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('project assignment management surface', () => {
  it('exposes the project task entry and permission-aware management dialog', () => {
    const header = read('src/components/frameos/FosProjectHeader.tsx')
    const dialog = read('src/components/frameos/FosProjectAssignmentsDialog.tsx')

    expect(header).toContain('project-assignments-entry')
    expect(header).toContain('FosProjectAssignmentsDialog')
    expect(dialog).toContain('/api/collaboration/assignments/list')
    expect(dialog).toContain('/api/collaboration/assignments/candidates')
    expect(dialog).toContain("mutate('assign'")
    expect(dialog).toContain("apiFetch('/api/collaboration/assignments/batch-assign'")
    expect(dialog).toContain('summarizeAssignmentBatchResult')
    expect(dialog).toContain('batchSummary.failures.map')
    expect(dialog).toContain('服务端汇总与逐条结果不一致')
    expect(dialog).toContain("mutate('reopen'")
    expect(dialog).toContain('canManageAssignments')
    expect(dialog).toContain('const retryLoad = async () =>')
    expect(dialog).toContain('if (manageable) await loadCandidates()')
  })

  it('preflights project-dialog navigation and preserves episode-aware return context', () => {
    const dialog = read('src/components/frameos/FosProjectAssignmentsDialog.tsx')
    const navigationStart = dialog.indexOf('const navigateToAssignment = async')
    const navigationEnd = dialog.indexOf('if (!open) return null', navigationStart)
    const navigation = dialog.slice(navigationStart, navigationEnd)

    expect(navigation.indexOf('/navigation?intent=${intent}')).toBeGreaterThanOrEqual(0)
    expect(navigation.indexOf('/navigation?intent=${intent}')).toBeLessThan(navigation.indexOf('router.push({'))
    expect(navigation).toContain('assignmentNavigationQuery(')
    expect(navigation).toContain('assignmentSourceTab(assignment)')
    expect(navigation).toContain('navigation.assignment?.episodeId')
    expect(dialog).not.toContain('<Link href={{ pathname: assignmentDestination(assignment) }}')
  })

  it('returns project assignment management capabilities with the list', () => {
    const service = read('src/lib/collaboration/assignments.ts')
    const http = read('src/lib/collaboration/assignment-http.ts')

    expect(service).toContain('getProjectAssignmentOverview')
    expect(service).toContain('canManageAssignments: access.canManageAssignments')
    expect(service).toContain('projectId, matched: true')
    expect(service).toContain("const eventType = action === 'assign' && current.assigneeUserId ? 'reassign' : action")
    expect(http).toContain('NextResponse.json(overview)')
  })

  it('uses the collaboration task for script submission and exposes rejection feedback in-panel', () => {
    const scriptReview = read('src/components/frameos/views/FosScriptReview.tsx')
    const policy = read('src/lib/collaboration/assignment-policy.ts')

    expect(policy).toContain("['script', 'asset', 'storyboard', 'video']")
    expect(scriptReview).toContain("assignment.stage === 'script'")
    expect(scriptReview).toContain("apiFetch('/api/collaboration/assignments/submit'")
    expect(scriptReview).toContain('scriptAssignment.lastReviewNote')
    expect(scriptReview).toContain('data-testid="script-submit-button"')
    expect(scriptReview).toContain("? '重新提交' : '提交'")
    expect(scriptReview).not.toContain('/stages/config/approve')
    expect(scriptReview).not.toContain('保存并审阅通过')
  })
})
