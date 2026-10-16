import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { uploadFrameosMaterial } from '@/lib/frameos/material-upload'
import { prisma } from '@/lib/prisma'
import { registerFrameosMaterial, type FrameosMaterialType } from '@/lib/frameos/material-service'
import { normalizeFrameosAssetCategory } from '@/lib/frameos/material-category'

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
      ? Array.from(new Set(body.nodeIds.map(text).filter(Boolean)))
      : []
    if (nodeIds.length === 0) throw new ApiError('INVALID_PARAMS', { message: '请选择要引用的画布素材。' })
    if (nodeIds.length > 20) throw new ApiError('INVALID_PARAMS', { message: '每次最多登记 20 个引用节点，请减少引用素材。' })
    // reference：把画布节点登记成生成引用所需的素材（默认，保持既有行为）。
    // library：把画布图片上传到资产库并归类，供素材库和其他项目复用。
    const mode = body?.register === 'library' ? 'library' : 'reference'
    const assetCategory = normalizeFrameosAssetCategory(body?.assetCategory)
    const requestedTitle = text(body?.title)
    const nodes = await prisma.canvasNode.findMany({
      where: { canvasId, id: { in: nodeIds } },
      select: { id: true, type: true, data: true },
    })
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    // Validate the whole batch before registering anything. A stale/missing id
    // must not leave an unintended partially registered selection behind.
    const missingReferenceNodeIds = nodeIds.filter((id) => !nodesById.has(id))
    if (missingReferenceNodeIds.length > 0) {
      throw new ApiError('INVALID_PARAMS', {
        message: '引用节点尚未保存或已被删除，请保存画布并清除失效引用或重新选择素材。',
        missingReferenceNodeIds,
      })
    }
    const materialByNodeId: Record<string, string> = {}
    const uploadedMaterials: Array<{ nodeId: string; materialId: string; title: string }> = []
    for (const nodeId of nodeIds) {
      const node = nodesById.get(nodeId)!
      const data = record(node.data)
      const existingMaterialId = text(data.materialId)
      // 资产库登记必须带上归类信息，已存在的素材要重新登记才能进入分类库。
      if (existingMaterialId && mode === 'reference') {
        const existing = await prisma.frameosMaterial.findFirst({
          where: { id: existingMaterialId, userId: authResult.session.user.id, deletedAt: null, status: 'ready' },
          select: { id: true },
        })
        if (existing) {
          materialByNodeId[node.id] = existing.id
          continue
        }
        throw new ApiError('INVALID_PARAMS', { message: `「${text(data.title) || '未命名节点'}」的原素材已删除或不可用，请重新选择素材。` })
      }
      const type = materialType(node.type, data)
      const resultUrl = type ? materialUrl(type, data) : ''
      if (!type || !resultUrl) {
        throw new ApiError('INVALID_PARAMS', { message: `「${text(data.title) || '未命名节点'}」尚无可引用的媒体内容。` })
      }
      if (mode === 'library' && type !== 'image') {
        throw new ApiError('INVALID_PARAMS', { message: '资产库目前只支持归类图片素材。' })
      }
      const nodeTitle = text(data.title) || '画布素材'
      const material = await registerFrameosMaterial({
        userId: authResult.session.user.id,
        projectId,
        ownerName: authResult.session.user.name || null,
        title: mode === 'library' ? (requestedTitle || nodeTitle) : nodeTitle,
        type,
        source: mode === 'library' ? 'upload' : 'creative',
        resultUrl,
        metadata: mode === 'library'
          ? {
            ...(record(data.sourceMetadata)),
            assetCategory,
            canvasId,
            canvasNodeId: node.id,
            uploadedFromCanvas: true,
          }
          : {
            ...(record(data.sourceMetadata)),
            canvasId,
            canvasNodeId: node.id,
            importedForReference: true,
          },
      })
      materialByNodeId[node.id] = material.id
      if (mode === 'library') {
        uploadedMaterials.push({ nodeId: node.id, materialId: material.id, title: material.title || nodeTitle })
      }
    }
    return NextResponse.json({ success: true, materialByNodeId, materials: uploadedMaterials })
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
