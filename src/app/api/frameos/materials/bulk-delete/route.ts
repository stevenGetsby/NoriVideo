import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { getWorkspaceActor, projectReadWhere } from '@/lib/collaboration/access'
import { findBoundCharacterVoices } from '@/lib/frameos/character-voice-service'
import { canActorAccessMaterial } from '@/lib/frameos/material-ownership'
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
    const actor = getWorkspaceActor(session)
    const materials = await tx.frameosMaterial.findMany({
      where: { id: { in: materialIds }, userId: actor.workspaceOwnerId },
    })
    const materialsById = new Map(materials.map((material) => [material.id, material]))
    const missingIds = materialIds.filter((id) => !materialsById.has(id))
    if (missingIds.length > 0) throw new ApiError('NOT_FOUND')
    const results = materialIds.map((materialId) => ({ materialId, deleted: false, reason: null as string | null }))
    const resultById = new Map(results.map((result) => [result.materialId, result]))

    for (const material of materials) {
      const item = resultById.get(material.id)!
      if (material.deletedAt) {
        item.deleted = true
        continue
      }
      if (material.source !== 'upload') {
        item.reason = '只能删除本地上传的素材。'
        continue
      }
      if (!canActorAccessMaterial(session, material)) throw new ApiError('NOT_FOUND')
      if (material.personalOwnerId) continue
      if (material.projectId !== 'global' && material.projectId !== 'global-asset-hub') {
        const project = await tx.project.findFirst({
          where: projectReadWhere(session, material.projectId),
          select: { id: true },
        })
        if (!project) item.reason = '当前账号无权管理此项目素材。'
      }
    }
    const candidates = materials.filter((material) => !material.deletedAt && !resultById.get(material.id)?.reason)
    const activeMaterials = candidates.filter((material) => material.source === 'upload')
    const audioIds = activeMaterials.filter((material) => material.type === 'audio').map((material) => material.id)
    const voiceConflicts = await findBoundCharacterVoices(tx, actor.workspaceOwnerId, audioIds)
    const referencesById = activeMaterials.length > 0
      ? await findCanvasMaterialsReferences(tx, actor.workspaceOwnerId, activeMaterials)
      : new Map()
    const deletedAt = new Date()
    for (const material of activeMaterials) {
      const item = resultById.get(material.id)!
      const voiceConflict = voiceConflicts.get(material.id)
      const references = referencesById.get(material.id)
      const reason = voiceConflict || (references?.referenced
        ? canvasMaterialReferenceConflictMessage(references.counts)
        : null)
      if (reason) {
        item.reason = reason
        continue
      }
      const update = await tx.frameosMaterial.updateMany({
        where: {
          id: material.id,
          userId: actor.workspaceOwnerId,
          projectId: material.projectId,
          source: 'upload',
          updatedAt: material.updatedAt,
          deletedAt: null,
        },
        data: {
          deletedAt,
          deletedById: actor.actorId,
          isFavorited: false,
        },
      })
      if (update.count !== 1) {
        item.reason = '素材已发生变化，请刷新后重试。'
        continue
      }
      item.deleted = true
    }
    return { count: results.filter((item) => item.deleted).length, results }
  }, { timeout: 30_000 })

  return NextResponse.json({
    success: true,
    materialIds: result.results.filter((item) => item.deleted).map((item) => item.materialId),
    deletedCount: result.count,
    skippedCount: result.results.length - result.count,
    results: result.results,
  })
})
