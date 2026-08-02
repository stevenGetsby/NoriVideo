import { ApiError } from '@/lib/api-errors'

export const ASSIGNMENT_STAGES = ['script', 'asset', 'storyboard', 'video'] as const
export const ASSIGNMENT_STATUSES = [
  'unassigned',
  'in_progress',
  'pending_review',
  'completed',
  'rejected',
] as const
export const ASSIGNMENT_TABS = ['todo', 'in_review', 'done'] as const

export type AssignmentStage = typeof ASSIGNMENT_STAGES[number]
export type AssignmentStatus = typeof ASSIGNMENT_STATUSES[number]
export type AssignmentTab = typeof ASSIGNMENT_TABS[number]
export type AssignmentAction = 'assign' | 'submit' | 'approve' | 'reject' | 'mark-complete' | 'reopen'

export interface AssignmentCapabilityInput {
  actorIsManagement: boolean
  actorIsProjectCreator: boolean
  actorIsWorkCreator: boolean
  workMemberCanManage: boolean
  workMemberRole?: string | null
  projectMemberCanManage: boolean
  projectMemberCanReview: boolean
}

/**
 * FrameOS treats assignment management as a superset of review access: every
 * manager can approve/reject, while a review-only member cannot assign work.
 * Keep that relationship in one pure contract so list flags, pending-review
 * visibility, mutation authorization, and deep-link validation cannot drift.
 */
export function resolveAssignmentCapabilities(input: AssignmentCapabilityInput) {
  const managesWork = input.actorIsWorkCreator
    || input.workMemberCanManage
    || input.workMemberRole === 'manager'
  const canManage = input.actorIsManagement
    || input.actorIsProjectCreator
    || managesWork
    || input.projectMemberCanManage
  return {
    canManage,
    canReview: canManage || input.projectMemberCanReview,
  }
}

const ACTION_FROM_STATUSES: Record<AssignmentAction, readonly AssignmentStatus[]> = {
  assign: ['unassigned', 'in_progress', 'pending_review', 'rejected'],
  submit: ['in_progress', 'rejected'],
  approve: ['pending_review'],
  reject: ['pending_review'],
  'mark-complete': ['in_progress', 'rejected'],
  reopen: ['completed'],
}

export function isAssignmentStage(value: unknown): value is AssignmentStage {
  return typeof value === 'string' && ASSIGNMENT_STAGES.includes(value as AssignmentStage)
}

export function isAssignmentTab(value: unknown): value is AssignmentTab {
  return typeof value === 'string' && ASSIGNMENT_TABS.includes(value as AssignmentTab)
}

export function statusesForAssignmentTab(tab: AssignmentTab): AssignmentStatus[] {
  if (tab === 'in_review') return ['pending_review']
  if (tab === 'done') return ['completed']
  return ['in_progress', 'rejected']
}

export function canTransitionAssignment(action: AssignmentAction, status: string): boolean {
  return ACTION_FROM_STATUSES[action].includes(status as AssignmentStatus)
}

export function assertAssignmentTransition(action: AssignmentAction, status: string): void {
  if (!canTransitionAssignment(action, status)) {
    throw new ApiError('CONFLICT', {
      message: `任务当前状态为 ${status}，不能执行 ${action}。`,
      status,
      action,
    })
  }
}

export function nextAssignmentStatus(
  action: AssignmentAction,
  submitCompletesDirectly = false,
): AssignmentStatus {
  if (action === 'assign' || action === 'reopen') return 'in_progress'
  if (action === 'submit') return submitCompletesDirectly ? 'completed' : 'pending_review'
  if (action === 'approve' || action === 'mark-complete') return 'completed'
  return 'rejected'
}
