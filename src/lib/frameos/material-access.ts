import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import type { AuthSession } from '@/lib/api-auth'
import { projectReadWhere } from '@/lib/collaboration/access'
import { PERSONAL_MATERIAL_PROJECT_ID } from './material-ownership'

export const ACCOUNT_MATERIAL_PROJECT_IDS = new Set(['global', 'global-asset-hub'])

export async function requireMaterialProjectAccess(
  tx: Prisma.TransactionClient,
  session: AuthSession,
  projectId: string,
) {
  if (ACCOUNT_MATERIAL_PROJECT_IDS.has(projectId) || projectId === PERSONAL_MATERIAL_PROJECT_ID) return
  const project = await tx.project.findFirst({
    where: projectReadWhere(session, projectId),
    select: { id: true },
  })
  // Keep the response indistinguishable from an unknown material id. In
  // particular, a subaccount must not be able to probe another project's ids.
  if (!project) throw new ApiError('NOT_FOUND')
}
