import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getWorkspaceActor, projectReadScopeWhere, projectReadWhere } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'

const TOOLBOX_GENERATION_BIZ_TYPES = [
  'image_generation',
  'video_generation',
  'audio_generation',
  'model3d_generation',
] as const

function toolboxBizTypesFor(type: string | null): string[] {
  if (type === 'image') return ['image_generation']
  if (type === 'video') return ['video_generation']
  if (type === 'audio') return ['audio_generation']
  if (type === 'model3d') return ['model3d_generation']
  return [...TOOLBOX_GENERATION_BIZ_TYPES]
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const type = request.nextUrl.searchParams.get('type')
  const source = request.nextUrl.searchParams.get('source')?.trim() || ''
  if (source && source !== 'toolbox') {
    throw new ApiError('INVALID_PARAMS', { message: 'source 仅支持 toolbox。' })
  }
  const projectId = request.nextUrl.searchParams.get('projectId')?.trim() || ''
  const assetIdsParam = request.nextUrl.searchParams.get('assetIds')
  const assetIds = assetIdsParam === null
    ? []
    : Array.from(new Set(assetIdsParam.split(',').map((value) => value.trim()).filter(Boolean)))
  if (
    assetIdsParam !== null
    && (assetIds.length === 0 || assetIds.length > 200 || assetIds.some((id) => id.length > 191))
  ) {
    throw new ApiError('INVALID_PARAMS', { message: 'assetIds 格式无效或超过 200 个。' })
  }
  const limitRaw = Number(request.nextUrl.searchParams.get('limit') || 80)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 80
  const actor = getWorkspaceActor(session)
  let projectScope: Prisma.FrameosToolboxAssetWhereInput
  if (projectId) {
    if (!actor.isManagement) {
      const readableProject = await prisma.project.findFirst({
        where: projectReadWhere(session, projectId),
        select: { id: true },
      })
      // Do not reveal whether the project or any generated history exists.
      if (!readableProject) throw new ApiError('NOT_FOUND')
    }
    projectScope = { projectId }
  } else if (actor.isManagement) {
    // Managers retain workspace-wide history, including legacy/orphaned rows.
    projectScope = {}
  } else {
    const readableProjects = await prisma.project.findMany({
      where: projectReadScopeWhere(session),
      select: { id: true },
    })
    projectScope = {
      OR: [
        { projectId: null },
        { projectId: { in: readableProjects.map((project) => project.id) } },
      ],
    }
  }
  const assets = await prisma.frameosToolboxAsset.findMany({
    where: {
      userId: session.user.id,
      ...projectScope,
      ...(source ? {
        source,
        // Character audition/voice-binding tasks also use the same durable
        // asset table. A source-only filter is therefore not strong enough
        // for the Toolbox history surface, especially for legacy rows.
        bizType: { in: toolboxBizTypesFor(type) },
      } : {}),
      ...(assetIds.length > 0 ? { id: { in: assetIds } } : {}),
      ...(type === 'image' || type === 'video' || type === 'audio' || type === 'model3d' ? { type } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: assetIds.length > 0 ? assetIds.length : limit,
  })
  const tasks = assets.length > 0
    ? await prisma.task.findMany({
      where: {
        userId: session.user.id,
        targetType: 'FrameosToolboxAsset',
        targetId: { in: assets.map((asset) => asset.id) },
      },
      orderBy: { createdAt: 'desc' },
    })
    : []
  const latestTask = new Map<string, typeof tasks[number]>()
  for (const task of tasks) {
    if (!latestTask.has(task.targetId)) latestTask.set(task.targetId, task)
  }
  const materialIds = Array.from(new Set(assets.map((asset) => asset.materialId).filter((id): id is string => Boolean(id))))
  const materials = materialIds.length > 0
    ? await prisma.frameosMaterial.findMany({
      where: { id: { in: materialIds }, userId: session.user.id, deletedAt: null },
      select: { id: true, metadata: true },
    })
    : []
  const materialMetadata = new Map(materials.map((material) => [material.id, material.metadata]))
  return NextResponse.json({
    assets: assets.map((asset) => {
      const task = latestTask.get(asset.id)
      return {
        ...asset,
        url: asset.resultUrl,
        materialMetadata: asset.materialId ? materialMetadata.get(asset.materialId) || null : null,
        task: task ? {
          id: task.id,
          status: task.status,
          progress: task.progress,
          errorCode: task.errorCode,
          errorMessage: task.errorMessage,
        } : null,
      }
    }),
  })
})
