import { BatchWorkflowClient } from '@/components/batch-workflow/BatchWorkflowClient'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'

async function resolveCanManageSkills(): Promise<boolean> {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return false
  const { user } = auth.session
  return isManagementRole(normalizeAccountRole(user.role)) && hasAccountPermissions(user, ['admin'])
}

export default async function ProjectBatchWorkflowPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const [{ projectId }, canManageSkills] = await Promise.all([
    params,
    resolveCanManageSkills(),
  ])
  return <BatchWorkflowClient projectId={projectId} canManageSkills={canManageSkills} />
}
