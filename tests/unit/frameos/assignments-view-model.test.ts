import { describe, expect, it } from 'vitest'
import {
  assignmentAssigneeLabel,
  assignmentAttentionCount,
  assignmentCountForTab,
  assignmentDestination,
  assignmentEventLabel,
  assignmentEpisodeLabel,
  assignmentNavigationQuery,
  assignmentReturnPath,
  assignmentNavigateLabel,
  assignmentNavigationBlockReason,
  assignmentReviewNote,
  assignmentSourceTab,
  assignmentStageDisplayLabel,
  assignmentSubmitLabel,
  assignmentTaskLabel,
  getAssignmentTimeColumns,
  moveAssignmentFilterOptionIndex,
  moveAssignmentTabIndex,
  resolveDefaultAssignmentTab,
  shouldDeferAssignmentFilterActivationToNestedButton,
  summarizeAssignmentBatchResult,
  type CollaborationAssignment,
} from '@/components/frameos/assignments-view-model'

const base: CollaborationAssignment = {
  id: 'assignment-1',
  projectId: 'project-1',
  projectName: '演示作品',
  workId: 'work-1',
  workName: '演示项目',
  stage: 'storyboard',
  status: 'in_progress',
  assigneeUserId: 'user-1',
  assigneeName: '小王',
  assigneeKind: 'subaccount',
  episodeId: 'episode-2',
  episodeNumber: 2,
  matched: true,
}

describe('assignments view model', () => {
  it('uses the FrameOS time columns for each tab', () => {
    expect(getAssignmentTimeColumns('todo')).toEqual([{ field: 'assignedAt', label: '分配时间' }])
    expect(getAssignmentTimeColumns('in_review')).toEqual([{ field: 'submittedAt', label: '提交时间' }])
    expect(getAssignmentTimeColumns('pending_review')).toEqual([{ field: 'submittedAt', label: '提交时间' }])
    expect(getAssignmentTimeColumns('done')).toEqual([
      { field: 'completedAt', label: '完成时间' },
      { field: 'submittedAt', label: '提交时间' },
    ])
  })

  it('formats assignment identity and actions from status and capability fields', () => {
    expect(assignmentTaskLabel(base)).toBe('分镜设计·第 2 集')
    expect(assignmentEpisodeLabel(base)).toBe('第2集')
    expect(assignmentAssigneeLabel(base)).toBe('子账号 · 小王')
    expect(assignmentSubmitLabel(base)).toBe('提交审核')
    expect(assignmentNavigateLabel(base)).toBe('去完成')

    expect(assignmentSubmitLabel({ ...base, status: 'rejected' })).toBe('重新提交')
    expect(assignmentSubmitLabel({ ...base, submitCompletesDirectly: true })).toBe('标记完成')
    expect(assignmentNavigateLabel({ ...base, status: 'completed' })).toBe('查看分镜')
    expect(assignmentNavigateLabel({ ...base, status: 'pending_review', canReview: true })).toBe('查看分镜')
    expect(assignmentNavigateLabel({ ...base, stage: 'video', status: 'pending_review', canReview: true })).toBe('审核本集视频')
    expect(assignmentNavigateLabel({ ...base, stage: 'video', status: 'in_progress', canSubmit: true })).toBe('进入视频制作')
    expect(assignmentNavigateLabel({ ...base, stage: 'video', status: 'in_progress', canSubmit: false })).toBe('查看视频制作')
    expect(assignmentStageDisplayLabel({ ...base, status: 'pending_review', canReview: true })).toBe('分镜设计')
    expect(assignmentStageDisplayLabel({ ...base, stage: 'video', status: 'pending_review', canReview: true })).toBe('本集视频审核')
  })

  it('only displays review notes for rejected or completed tasks', () => {
    expect(assignmentReviewNote({ ...base, lastReviewNote: '需要调整' })).toBe('')
    expect(assignmentReviewNote({ ...base, status: 'rejected', lastReviewNote: ' 需要调整 ' })).toBe('需要调整')
    expect(assignmentReviewNote({ ...base, status: 'completed', lastReviewNote: '已通过' })).toBe('已通过')
  })

  it('builds workflow destinations and blocks stale assignment targets', () => {
    expect(assignmentDestination(base)).toBe('/workflow/project-1/workbench-premium2/storyboard')
    expect(assignmentDestination({ ...base, stage: 'script', episodeId: null, episodeNumber: null }))
      .toBe('/workflow/project-1/workbench-premium2/script-review')
    expect(assignmentDestination({ ...base, stage: 'asset' })).toBe('/workflow/project-1/workbench-premium2')
    expect(assignmentDestination({ ...base, stage: 'video' }))
      .toBe('/workflow/project-1/workbench-premium2/production/shot')
    expect(assignmentDestination({ ...base, status: 'pending_review', canReview: true }))
      .toBe('/workflow/project-1/workbench-premium2/storyboard')
    expect(assignmentDestination({ ...base, stage: 'video', status: 'pending_review', canReview: true }))
      .toBe('/my-assignments/assignment-1/video-review')
    expect(assignmentNavigationQuery(base, 'todo')).toEqual({
      from: 'my-assignments',
      from_tab: 'todo',
      episode_id: 'episode-2',
    })
    expect(assignmentNavigationQuery({ ...base, stage: 'asset' }, 'done')).toEqual({
      from: 'my-assignments',
      from_tab: 'done',
    })
    expect(assignmentNavigationQuery({ ...base, stage: 'script' }, 'todo')).toEqual({
      from: 'my-assignments',
      from_tab: 'todo',
    })
    expect(assignmentNavigationQuery({ ...base, episodeId: null }, 'todo', 'resolved-episode')).toEqual({
      from: 'my-assignments',
      from_tab: 'todo',
      episode_id: 'resolved-episode',
    })
    expect(assignmentNavigationBlockReason(base)).toBe('')
    expect(assignmentNavigationBlockReason({ ...base, matched: false })).toContain('分集已不存在')
    expect(assignmentCountForTab({ todo: 3, inReview: 2, done: 1, pendingReview: 4 }, 'pending_review')).toBe(4)
    expect(assignmentAttentionCount({ todo: 3, pendingReview: 4 })).toBe(7)
    expect(assignmentAttentionCount({ todo: 0, pendingReview: 0 })).toBe(0)
  })

  it('defaults reviewers and pending review work onto the review inbox', () => {
    expect(resolveDefaultAssignmentTab({ routeTab: 'done' })).toBe('done')
    expect(resolveDefaultAssignmentTab({ role: 'reviewer' })).toBe('pending_review')
    expect(resolveDefaultAssignmentTab({
      role: 'admin',
      showPendingReviewTab: true,
      pendingReviewCount: 2,
    })).toBe('pending_review')
    expect(resolveDefaultAssignmentTab({
      role: 'admin',
      showPendingReviewTab: true,
      pendingReviewCount: 0,
    })).toBe('todo')
    expect(resolveDefaultAssignmentTab({ role: 'writer' })).toBe('todo')
    expect(resolveDefaultAssignmentTab({
      role: 'reviewer',
      showPendingReviewTab: false,
    })).toBe('todo')
  })

  it('routes canvas playlist production and final review as a node-level task', () => {
    const playlist: CollaborationAssignment = {
      ...base,
      stage: 'video',
      scopeId: 'canvas-playlist:canvas-1:playlist-1',
      episodeId: null,
      episodeNumber: null,
      status: 'rejected',
      canSubmit: false,
    }
    expect(assignmentTaskLabel(playlist)).toBe('播放列表剪辑')
    expect(assignmentEpisodeLabel(playlist)).toBe('画布播放列表')
    expect(assignmentNavigateLabel(playlist)).toBe('进入播放列表剪辑')
    expect(assignmentDestination(playlist)).toBe('/workflow/project-1/workbench-premium2/canvas/canvas-1')
    expect(assignmentNavigationQuery(playlist, 'todo')).toEqual({
      from: 'my-assignments',
      from_tab: 'todo',
      node_id: 'playlist-1',
    })
    expect(assignmentStageDisplayLabel({ ...playlist, status: 'pending_review', canReview: true })).toBe('播放列表最终审核')
    expect(assignmentNavigateLabel({ ...playlist, status: 'pending_review', canReview: true })).toBe('审核播放列表')
    expect(assignmentDestination({ ...playlist, status: 'pending_review', canReview: true }))
      .toBe('/my-assignments/assignment-1/video-review')
  })

  it('restores the originating assignment tab and rejects unrelated origins', () => {
    expect(assignmentReturnPath('my-assignments', 'pending_review')).toBe('/my-assignments?tab=pending_review')
    expect(assignmentReturnPath('my-assignments', 'invalid')).toBe('/my-assignments?tab=todo')
    expect(assignmentReturnPath('works', 'done')).toBeNull()
  })

  it('derives a stable return tab for project-dialog navigation', () => {
    expect(assignmentSourceTab(base)).toBe('todo')
    expect(assignmentSourceTab({ ...base, status: 'pending_review', canReview: false })).toBe('in_review')
    expect(assignmentSourceTab({ ...base, status: 'pending_review', canReview: true })).toBe('pending_review')
    expect(assignmentSourceTab({ ...base, status: 'completed' })).toBe('done')
  })

  it('moves filter keyboard focus cyclically and fails closed for empty options', () => {
    expect(moveAssignmentFilterOptionIndex(0, 3, 1)).toBe(1)
    expect(moveAssignmentFilterOptionIndex(2, 3, 1)).toBe(0)
    expect(moveAssignmentFilterOptionIndex(0, 3, -1)).toBe(2)
    expect(moveAssignmentFilterOptionIndex(9, 3, -1)).toBe(2)
    expect(moveAssignmentFilterOptionIndex(0, 0, 1)).toBe(0)
  })

  it('leaves nested clear and option button activation to their native click handlers', () => {
    const root = { tagName: 'DIV' }
    const optionButton = { tagName: 'button' }
    const searchInput = { tagName: 'INPUT' }

    expect(shouldDeferAssignmentFilterActivationToNestedButton('Enter', optionButton, root)).toBe(true)
    expect(shouldDeferAssignmentFilterActivationToNestedButton(' ', optionButton, root)).toBe(true)
    expect(shouldDeferAssignmentFilterActivationToNestedButton('ArrowDown', optionButton, root)).toBe(false)
    expect(shouldDeferAssignmentFilterActivationToNestedButton('Enter', searchInput, root)).toBe(false)
    expect(shouldDeferAssignmentFilterActivationToNestedButton('Enter', root, root)).toBe(false)
  })

  it('moves tab focus cyclically and supports edge keys', () => {
    expect(moveAssignmentTabIndex(0, 3, 'ArrowLeft')).toBe(2)
    expect(moveAssignmentTabIndex(2, 3, 'ArrowRight')).toBe(0)
    expect(moveAssignmentTabIndex(2, 3, 'Home')).toBe(0)
    expect(moveAssignmentTabIndex(0, 3, 'End')).toBe(2)
    expect(moveAssignmentTabIndex(0, 0, 'ArrowRight')).toBe(0)
  })

  it('uses human labels for assignment audit events and recognizes resubmission', () => {
    expect(assignmentEventLabel({ eventType: 'approve', fromStatus: 'pending_review' })).toBe('审核通过')
    expect(assignmentEventLabel({ eventType: 'submit', fromStatus: 'rejected' })).toBe('重新提交')
    expect(assignmentEventLabel({ eventType: 'custom-event', fromStatus: null })).toBe('custom-event')
  })

  it('summarizes a fully successful batch from per-task results', () => {
    expect(summarizeAssignmentBatchResult({
      results: [
        { assignmentId: 'assignment-1', ok: true },
        { assignmentId: 'assignment-2', ok: true },
      ],
      total: 2,
      okCount: 2,
    }, ['assignment-1', 'assignment-2'])).toEqual({
      total: 2,
      okCount: 2,
      failedCount: 0,
      failures: [],
      contractMismatch: false,
    })
  })

  it('keeps partial failures available for targeted retries', () => {
    expect(summarizeAssignmentBatchResult({
      results: [
        { assignmentId: 'assignment-1', ok: true },
        { assignmentId: 'assignment-2', ok: false, error: ' 账号已停用 ' },
      ],
      total: 2,
      okCount: 1,
    }, ['assignment-1', 'assignment-2'])).toEqual({
      total: 2,
      okCount: 1,
      failedCount: 1,
      failures: [{ assignmentId: 'assignment-2', error: '账号已停用' }],
      contractMismatch: false,
    })
  })

  it('fails closed when task results are missing or aggregates disagree', () => {
    expect(summarizeAssignmentBatchResult({
      results: [{ assignmentId: 'assignment-1', ok: true }],
      total: 2,
      okCount: 2,
    }, ['assignment-1', 'assignment-2'])).toEqual({
      total: 2,
      okCount: 1,
      failedCount: 1,
      failures: [{
        assignmentId: 'assignment-2',
        error: '服务端未返回该任务的处理结果',
      }],
      contractMismatch: true,
    })

    expect(summarizeAssignmentBatchResult({
      results: [
        { assignmentId: 'assignment-1', ok: true },
        { assignmentId: 'assignment-2', ok: true },
      ],
      total: 99,
      okCount: 2,
    }, ['assignment-1', 'assignment-2'])).toMatchObject({
      okCount: 2,
      failedCount: 0,
      contractMismatch: true,
    })
  })
})
