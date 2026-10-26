import { NextResponse } from 'next/server'
import { getUserCostSummary } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { findHiddenProjectIds } from '@/lib/collaboration/access'

/**
 * GET /api/user/costs
 * 获取当前用户所有项目费用汇总
 */
export const GET = apiHandler(async () => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const userId = session.user.id

  // 获取用户费用汇总
  const fullSummary = await getUserCostSummary(userId)
  const hiddenProjectIds = await findHiddenProjectIds(session, fullSummary.byProject.map(p => p.projectId))
  const visibleByProject = fullSummary.byProject.filter(p => !hiddenProjectIds.has(p.projectId))
  const costSummary = {
    total: hiddenProjectIds.size > 0
      ? visibleByProject.reduce((sum, p) => sum + (p._sum.cost || 0), 0)
      : fullSummary.total,
    byProject: visibleByProject,
  }

  // 获取项目名称
  const projectIds = costSummary.byProject.map(p => p.projectId)
  const projects = await prisma.project.findMany({
    where: {
      id: { in: projectIds },
      userId,
      deletedAt: null,
    },
    select: { id: true, name: true }
  })

  const projectMap = new Map(projects.map(p => [p.id, p.name]))

  // 合并项目名称
  const byProjectWithNames = costSummary.byProject.map(p => ({
    projectId: p.projectId,
    projectName: projectMap.get(p.projectId) || '未知项目',
    totalCost: p._sum.cost || 0,
    recordCount: p._count
  }))

  return NextResponse.json({
    userId,
    currency: BILLING_CURRENCY,
    total: costSummary.total,
    byProject: byProjectWithNames.sort((a, b) => b.totalCost - a.totalCost)
  })
})
