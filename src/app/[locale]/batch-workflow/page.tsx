import { BatchWorkflowClient } from '@/components/batch-workflow/BatchWorkflowClient'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'

async function resolveCanManageSkills(): Promise<boolean> {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return false
  const { user } = auth.session
  return isManagementRole(normalizeAccountRole(user.role)) && hasAccountPermissions(user, ['admin'])
}

export default async function BatchWorkflowPage() {
  const canManageSkills = await resolveCanManageSkills()
  return <BatchWorkflowClient canManageSkills={canManageSkills} />
}
