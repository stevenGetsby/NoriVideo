import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { uploadFrameosMaterial } from '@/lib/frameos/material-upload'
import { prisma } from '@/lib/prisma'
import { registerFrameosMaterial, type FrameosMaterialType } from '@/lib/frameos/material-service'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function materialType(nodeType: string, data: Record<string, unknown>): FrameosMaterialType | null {
  const type = text(data.mediaType) || nodeType
  if (type === 'image' || type === 'video' || type === 'audio') return type
  if (type === 'model3d' || type === 'model_3d') return 'model3d'
  return null
}

function materialUrl(type: FrameosMaterialType, data: Record<string, unknown>) {
  const candidates = type === 'image'
    ? [data.contentUrl, data.imageUrl, data.posterUrl]
    : type === 'video'
      ? [data.contentUrl, data.videoUrl]
      : type === 'audio'
        ? [data.audioUrl, data.contentUrl]
        : [data.modelUrl, data.contentUrl]
  return candidates.map(text).find(Boolean) || ''
}

/** Upload a material from the canvas without granting access to the global asset editor. */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const nodeIds = Array.isArray(body?.nodeIds)
      ? Array.from(new Set(body.nodeIds.map(text).filter(Boolean))).slice(0, 20)
      : []
    if (nodeIds.length === 0) throw new ApiError('INVALID_PARAMS', { message: '请选择要引用的画布素材。' })
    const nodes = await prisma.canvasNode.findMany({
      where: { canvasId, id: { in: nodeIds } },
      select: { id: true, type: true, data: true },
    })
    const materialByNodeId: Record<string, string> = {}
    for (const nodeId of nodeIds) {
      const node = nodes.find((item) => item.id === nodeId)
      if (!node) throw new ApiError('NOT_FOUND', { message: '引用节点不存在或已被删除。' })
      const data = record(node.data)
      const existingMaterialId = text(data.materialId)
      if (existingMaterialId) {
        materialByNodeId[node.id] = existingMaterialId
        continue
      }
      const type = materialType(node.type, data)
      const resultUrl = type ? materialUrl(type, data) : ''
      if (!type || !resultUrl) {
        throw new ApiError('INVALID_PARAMS', { message: `「${text(data.title) || '未命名节点'}」尚无可引用的媒体内容。` })
      }
      const material = await registerFrameosMaterial({
        userId: authResult.session.user.id,
        projectId,
        ownerName: authResult.session.user.name || null,
        title: text(data.title) || '画布引用素材',
        type,
        source: 'creative',
        resultUrl,
        metadata: {
          ...(record(data.sourceMetadata)),
          canvasId,
          canvasNodeId: node.id,
          importedForReference: true,
        },
      })
      materialByNodeId[node.id] = material.id
    }
    return NextResponse.json({ success: true, materialByNodeId })
  }

  return await uploadFrameosMaterial(request, authResult.session, {
    expectedProjectId: projectId,
    projectAccessVerified: true,
  })
})

/** Bookmark a project-visible material without granting global asset editing. */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const materialId = typeof body?.materialId === 'string' ? body.materialId.trim() : ''
  if (!materialId || typeof body?.isFavorited !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: '收藏操作缺少有效素材或状态。' })
  }
  const material = await prisma.frameosMaterial.findFirst({
    where: {
      id: materialId,
      userId: authResult.session.user.id,
      deletedAt: null,
      projectId: { in: [projectId, 'global', 'global-asset-hub'] },
    },
    select: { id: true },
  })
  if (!material) throw new ApiError('NOT_FOUND')

  const updated = await prisma.frameosMaterial.update({
    where: { id: material.id },
    data: { isFavorited: body.isFavorited },
    select: { id: true, isFavorited: true },
  })
  return NextResponse.json({ success: true, material: updated })
})
