import type { MemberCandidate, WorkMember } from './types'

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'manager', 'creator'])

/**
 * Creation and workspace-management status are authority boundaries, not an
 * editable collaboration choice. Keep those accounts visible in the member
 * list while preventing the member picker from staging their removal.
 */
export function isProtectedMember(member: WorkMember): boolean {
  return Boolean(member.isCreator)
    || ADMIN_ROLES.has(member.accountRole || '')
    || ADMIN_ROLES.has(member.role || '')
}

export interface MemberChangeSet {
  additions: MemberCandidate[]
  removals: WorkMember[]
}

/**
 * Converts the dialog's draft state into the existing single-member API
 * contract. De-duplication also keeps repeated clicks/reloads idempotent.
 */
export function buildMemberChangeSet(
  members: readonly WorkMember[],
  selectedCandidates: readonly MemberCandidate[],
  pendingRemovalIds: readonly string[],
): MemberChangeSet {
  const existingIds = new Set(members.map((member) => member.userId))
  const additionIds = new Set<string>()
  const removalIds = new Set(pendingRemovalIds)

  const additions = selectedCandidates.filter((candidate) => {
    if (existingIds.has(candidate.id) || additionIds.has(candidate.id)) return false
    additionIds.add(candidate.id)
    return true
  })
  const removals = members.filter((member) => (
    removalIds.has(member.userId)
    && member.canRemove !== false
    && !isProtectedMember(member)
  ))

  return { additions, removals }
}
