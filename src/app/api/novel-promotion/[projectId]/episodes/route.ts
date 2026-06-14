import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * GET - 获取项目的所有剧集
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const episodes = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { episodeNumber: 'asc' }
  })

  return NextResponse.json({ episodes })
})

/**
 * POST - 创建新剧集
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const body = await request.json()
  const { name, description, novelText } = body

  if (!name || name.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取下一个剧集编号
  const lastEpisode = await prisma.novelPromotionEpisode.findFirst({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { episodeNumber: 'desc' }
  })
  const nextEpisodeNumber = (lastEpisode?.episodeNumber || 0) + 1

  const buildCreateData = (episodeNumber: number): Prisma.NovelPromotionEpisodeUncheckedCreateInput => {
    const createData: Prisma.NovelPromotionEpisodeUncheckedCreateInput = {
      novelPromotionProjectId: novelData.id,
      episodeNumber,
      name: name.trim(),
      description: description?.trim() || null,
    }
    if (typeof novelText === 'string') {
      createData.novelText = novelText
    }
    return createData
  }

  let episode
  try {
    episode = await prisma.novelPromotionEpisode.create({
      data: buildCreateData(nextEpisodeNumber),
    })
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const latestEpisode = await prisma.novelPromotionEpisode.findFirst({
      where: { novelPromotionProjectId: novelData.id },
      orderBy: { episodeNumber: 'desc' },
    })
    episode = await prisma.novelPromotionEpisode.create({
      data: buildCreateData((latestEpisode?.episodeNumber || 0) + 1),
    })
  }

  // 更新最后编辑的剧集ID
  const updateData: Prisma.NovelPromotionProjectUpdateInput = { lastEpisodeId: episode.id }
  if (novelData.importStatus === 'pending' || novelData.pendingImportText || novelData.pendingImportEpisodeName) {
    updateData.importStatus = 'completed'
    updateData.pendingImportText = null
    updateData.pendingImportEpisodeName = null
  }

  await prisma.novelPromotionProject.update({
    where: { id: novelData.id },
    data: updateData,
  })

  return NextResponse.json({ episode }, { status: 201 })
})
