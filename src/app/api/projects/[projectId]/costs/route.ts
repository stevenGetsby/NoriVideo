import { NextRequest, NextResponse } from 'next/server'
import { getProjectCostDetails } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * GET /api/projects/[projectId]/costs
 * 获取项目费用详情
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { projectId } = await context.params

  // 验证项目归属
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: session.user.id,
    },
    select: { id: true, name: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  // 获取费用详情
  const costDetails = await getProjectCostDetails(project.id)

  return NextResponse.json({
    projectId: project.id,
    projectName: project.name,
    currency: BILLING_CURRENCY,
    ...costDetails
  })
})
