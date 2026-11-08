import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { projectReadScopeWhere } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'

export async function resolveProjectAssetScope(session: AuthSession, input: { workId?: string; projectId?: string }) {
  const workId = input.workId?.trim() || ''
  const projectId = input.projectId?.trim() || ''
  if (!workId) throw new ApiError('INVALID_PARAMS', { message: '请选择资产所属项目。' })
  const projects = await prisma.project.findMany({
    where: {
      AND: [
        projectReadScopeWhere(session),
        { workId },
      ],
    },
    select: { id: true, name: true, workId: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  })
  if (projects.length === 0 || (projectId && !projects.some((project) => project.id === projectId))) {
    throw new ApiError('NOT_FOUND', { message: '项目不存在或当前账号无权访问。' })
  }
  return { projects, projectIds: projects.map((project) => project.id) }
}
