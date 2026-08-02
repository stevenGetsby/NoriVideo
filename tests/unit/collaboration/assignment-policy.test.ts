import { describe, expect, it } from 'vitest'
import {
  assertAssignmentTransition,
  canTransitionAssignment,
  isAssignmentStage,
  nextAssignmentStatus,
  resolveAssignmentCapabilities,
  statusesForAssignmentTab,
} from '@/lib/collaboration/assignment-policy'

describe('workflow assignment state machine', () => {
  it('recognizes script as a first-class assignment stage', () => {
    expect(isAssignmentStage('script')).toBe(true)
    expect(isAssignmentStage('unknown')).toBe(false)
  })

  it('maps personal task tabs to stable backend statuses', () => {
    expect(statusesForAssignmentTab('todo')).toEqual(['in_progress', 'rejected'])
    expect(statusesForAssignmentTab('in_review')).toEqual(['pending_review'])
    expect(statusesForAssignmentTab('done')).toEqual(['completed'])
  })

  it('allows only the documented assignment transitions', () => {
    expect(canTransitionAssignment('assign', 'unassigned')).toBe(true)
    expect(canTransitionAssignment('assign', 'rejected')).toBe(true)
    expect(canTransitionAssignment('assign', 'in_progress')).toBe(true)
    expect(canTransitionAssignment('assign', 'pending_review')).toBe(true)
    expect(canTransitionAssignment('submit', 'in_progress')).toBe(true)
    expect(canTransitionAssignment('submit', 'rejected')).toBe(true)
    expect(canTransitionAssignment('approve', 'pending_review')).toBe(true)
    expect(canTransitionAssignment('reject', 'pending_review')).toBe(true)
    expect(canTransitionAssignment('mark-complete', 'rejected')).toBe(true)
    expect(canTransitionAssignment('reopen', 'completed')).toBe(true)

    expect(canTransitionAssignment('approve', 'in_progress')).toBe(false)
    expect(canTransitionAssignment('submit', 'completed')).toBe(false)
    expect(() => assertAssignmentTransition('reopen', 'pending_review')).toThrow(/不能执行 reopen/)
  })

  it('supports direct completion without bypassing submit authorization', () => {
    expect(nextAssignmentStatus('submit', false)).toBe('pending_review')
    expect(nextAssignmentStatus('submit', true)).toBe('completed')
    expect(nextAssignmentStatus('mark-complete')).toBe('completed')
  })

  it('treats assignment management as a superset of review access', () => {
    expect(resolveAssignmentCapabilities({
      actorIsManagement: false,
      actorIsProjectCreator: true,
      actorIsWorkCreator: false,
      workMemberCanManage: false,
      projectMemberCanManage: false,
      projectMemberCanReview: false,
    })).toEqual({ canManage: true, canReview: true })

    expect(resolveAssignmentCapabilities({
      actorIsManagement: false,
      actorIsProjectCreator: false,
      actorIsWorkCreator: false,
      workMemberCanManage: false,
      projectMemberCanManage: true,
      projectMemberCanReview: false,
    })).toEqual({ canManage: true, canReview: true })

    expect(resolveAssignmentCapabilities({
      actorIsManagement: false,
      actorIsProjectCreator: false,
      actorIsWorkCreator: false,
      workMemberCanManage: false,
      projectMemberCanManage: false,
      projectMemberCanReview: true,
    })).toEqual({ canManage: false, canReview: true })
  })
})
