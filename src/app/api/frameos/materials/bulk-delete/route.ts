import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { projectReadWhere } from '@/lib/collaboration/access'
import { assertCharacterVoiceNotBound } from '@/lib/frameos/character-voice-service'
import {
  canvasMaterialReferenceConflictMessage,
  findCanvasMaterialsReferences,
} from '@/lib/canvas/material-reference-guard'

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200
    || value.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 191)) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择 1–200 个有效素材。' })
  }
  return Array.from(new Set(value.map((item: string) => item.trim())))
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserPermission(['assetWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '批量删除请求无效。' })
  }
  const materialIds = normalizeIds(body.materialIds)

  const result = await prisma.$transaction(async (tx) => {
    const materials = await tx.frameosMaterial.findMany({
      where: { id: { in: materialIds }, userId: session.user.id },
    })
    if (materials.length !== materialIds.length) throw new ApiError('NOT_FOUND')

    const checkedProjects = new Set<string>()
    for (const material of materials) {
      if (material.projectId !== 'global' && material.projectId !== 'global-asset-hub' && !checkedProjects.has(material.projectId)) {
        const project = await tx.project.findFirst({
          where: projectReadWhere(session, material.projectId),
          select: { id: true },
        })
        if (!project) throw new ApiError('NOT_FOUND')
        checkedProjects.add(material.projectId)
      }
      if (material.source !== 'upload') {
        throw new ApiError('FORBIDDEN', { message: '这里只能批量删除本地上传的素材。' })
      }
    }
    const activeMaterials = materials.filter((material) => !material.deletedAt)
    await assertCharacterVoiceNotBound(tx, session.user.id, activeMaterials.filter((material) => material.type === 'audio').map((material) => material.id))
    const referencesById = activeMaterials.length > 0
      ? await findCanvasMaterialsReferences(tx, session.user.id, activeMaterials)
      : new Map()
    for (const material of activeMaterials) {
      const references = referencesById.get(material.id)
      if (references?.referenced) {
        throw new ApiError('CONFLICT', {
          message: canvasMaterialReferenceConflictMessage(references.counts),
          materialId: material.id,
          referenceCounts: references.counts,
        })
      }
    }

    const deletedAt = new Date()
    let count = 0
    for (const material of materials) {
      if (material.deletedAt) continue
      const update = await tx.frameosMaterial.updateMany({
        where: {
          id: material.id,
          userId: session.user.id,
          projectId: material.projectId,
          source: 'upload',
          updatedAt: material.updatedAt,
          deletedAt: null,
        },
        data: {
          deletedAt,
          deletedById: session.user.actorId || session.user.id,
          isFavorited: false,
        },
      })
      if (update.count !== 1) {
        throw new ApiError('CONFLICT', { message: '所选素材已发生变化，整批操作已取消，请刷新后重试。' })
      }
      count++
    }
    return { count }
  }, { timeout: 30_000 })

  return NextResponse.json({ success: true, materialIds, deletedCount: result.count })
})
