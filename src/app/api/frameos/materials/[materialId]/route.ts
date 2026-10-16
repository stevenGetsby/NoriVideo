import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission, type AuthSession } from '@/lib/api-auth'
import { projectReadWhere } from '@/lib/collaboration/access'
import {
  canvasMaterialReferenceConflictMessage,
  findCanvasMaterialReferences,
} from '@/lib/canvas/material-reference-guard'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  frameosAssetCategoryFromMetadata,
  frameosCharacterBindingFromMetadata,
  isFrameosAssetCategory,
  withFrameosAssetCategory,
  withFrameosCharacterBinding,
} from '@/lib/frameos/material-category'
import { MAX_MATERIAL_TITLE_LENGTH } from '@/lib/frameos/upload-file-policy'
import { withCharacterVoiceMaterial } from '@/lib/frameos/character-voice-reference'
import { assertCharacterVoiceNotBound } from '@/lib/frameos/character-voice-service'

const ACCOUNT_MATERIAL_PROJECT_IDS = new Set(['global', 'global-asset-hub'])

async function requireMaterialProjectAccess(
  tx: Prisma.TransactionClient,
  session: AuthSession,
  projectId: string,
) {
  if (ACCOUNT_MATERIAL_PROJECT_IDS.has(projectId)) return
  const project = await tx.project.findFirst({
    where: projectReadWhere(session, projectId),
    select: { id: true },
  })
  // Keep the response indistinguishable from an unknown material id. In
  // particular, a subaccount must not be able to probe another project's ids.
  if (!project) throw new ApiError('NOT_FOUND')
}

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ materialId: string }> },
) => {
  const authResult = await requireUserPermission(['assetWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { materialId } = await context.params

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '素材更新请求无效。' })
  }
  const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : null
  if (body.title !== undefined && (!title || title.length > MAX_MATERIAL_TITLE_LENGTH)) {
    throw new ApiError('INVALID_PARAMS', { message: `素材名称须为 1–${MAX_MATERIAL_TITLE_LENGTH} 个字符。` })
  }
  if (body.assetCategory !== undefined && !isFrameosAssetCategory(body.assetCategory)) {
    throw new ApiError('INVALID_PARAMS', { message: '素材归类无效。' })
  }
  if (body.characterId !== undefined && body.characterId !== null && typeof body.characterId !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: '项目角色绑定无效。' })
  }
  if (body.voiceMaterialId !== undefined && body.voiceMaterialId !== null && (typeof body.voiceMaterialId !== 'string' || !body.voiceMaterialId.trim() || body.voiceMaterialId.length > 191)) {
    throw new ApiError('INVALID_PARAMS', { message: '音色素材 ID 无效。' })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const material = await tx.frameosMaterial.findFirst({
      where: { id: materialId, userId: session.user.id },
    })
    if (!material) throw new ApiError('NOT_FOUND')
    await requireMaterialProjectAccess(tx, session, material.projectId)

    if (body.restore === true && !material.deletedAt) return material
    if (body.restore !== true && material.deletedAt) throw new ApiError('NOT_FOUND')

    const requestedCharacterId = typeof body.characterId === 'string' ? body.characterId.trim() : ''
    const nextCategory = body.assetCategory !== undefined
      ? body.assetCategory
      : frameosAssetCategoryFromMetadata(material.metadata)
    let characterBinding: { characterId: string; characterName: string | null } | null = null
    if (requestedCharacterId) {
      if (ACCOUNT_MATERIAL_PROJECT_IDS.has(material.projectId) || nextCategory !== 'character') {
        throw new ApiError('INVALID_PARAMS', { message: '只有项目内的角色素材才能绑定项目角色。' })
      }
      const character = await tx.novelPromotionCharacter.findFirst({
        where: {
          id: requestedCharacterId,
          novelPromotionProject: { projectId: material.projectId },
        },
        select: { id: true, name: true },
      })
      if (!character) throw new ApiError('NOT_FOUND')
      characterBinding = { characterId: character.id, characterName: character.name }
    } else if (body.characterId === undefined && nextCategory === 'character') {
      characterBinding = frameosCharacterBindingFromMetadata(material.metadata)
    }

    let nextMetadata = body.assetCategory !== undefined || body.characterId !== undefined
      ? withFrameosCharacterBinding(
          withFrameosAssetCategory(material.metadata, nextCategory),
          nextCategory === 'character' ? characterBinding : null,
        )
      : null
    if (body.voiceMaterialId !== undefined) {
      if (material.type !== 'image' || nextCategory !== 'character') {
        throw new ApiError('INVALID_PARAMS', { message: '只有角色图片资产可以设置音色。' })
      }
      const voiceId = typeof body.voiceMaterialId === 'string' ? body.voiceMaterialId.trim() : null
      if (voiceId) {
        const voice = await tx.frameosMaterial.findFirst({
          where: {
            id: voiceId, userId: session.user.id, type: 'audio', status: 'ready', deletedAt: null,
            projectId: { in: [material.projectId, ...ACCOUNT_MATERIAL_PROJECT_IDS] },
          },
          select: { id: true, updatedAt: true },
        })
        if (!voice) throw new ApiError('NOT_FOUND', { message: '音色不存在、已删除或不属于当前作品。' })
        // Serialize binding against deletion: deletion's updatedAt guard must
        // fail if a role acquired this voice after the reference scan.
        const previousTime = voice.updatedAt instanceof Date ? voice.updatedAt.getTime() : 0
        const locked = await tx.frameosMaterial.updateMany({
          where: { id: voice.id, type: 'audio', status: 'ready', deletedAt: null },
          data: { updatedAt: new Date(Math.max(Date.now(), previousTime + 1)) },
        })
        if (locked.count !== 1) throw new ApiError('CONFLICT', { message: '音色已被删除或正在变更，请重新选择。' })
      }
      nextMetadata = withCharacterVoiceMaterial(nextMetadata || material.metadata, voiceId)
    } else if (nextMetadata && nextCategory !== 'character') {
      nextMetadata = withCharacterVoiceMaterial(nextMetadata, null)
    }

    const result = await tx.frameosMaterial.updateMany({
      where: {
        id: material.id,
        userId: session.user.id,
        projectId: material.projectId,
        updatedAt: material.updatedAt,
        ...(body.restore === true ? { deletedAt: material.deletedAt } : { deletedAt: null }),
      },
      data: body.restore === true
        ? { deletedAt: null, deletedById: null }
        : {
            ...(title ? { title } : {}),
            ...(typeof body.isFavorited === 'boolean' ? { isFavorited: body.isFavorited } : {}),
            ...(nextMetadata ? {
              metadata: JSON.parse(JSON.stringify(nextMetadata)) as Prisma.InputJsonValue,
            } : {}),
          },
    })
    if (result.count !== 1) {
      throw new ApiError('CONFLICT', { message: '素材已发生变化，请刷新后重试。' })
    }
    const nextMaterial = await tx.frameosMaterial.findFirst({
      where: { id: material.id, userId: session.user.id, projectId: material.projectId, deletedAt: null },
    })
    if (!nextMaterial) throw new ApiError('NOT_FOUND')

    if (material.type === 'audio' && characterBinding) {
      const voiceMedia = material.storageKey
        ? await tx.mediaObject.findUnique({ where: { storageKey: material.storageKey }, select: { id: true } })
        : null
      await tx.novelPromotionCharacter.update({
        where: { id: characterBinding.characterId },
        data: {
          voiceType: 'uploaded',
          voiceId: null,
          customVoiceUrl: material.resultUrl || material.storageKey,
          customVoiceMediaId: voiceMedia?.id || null,
        },
      })
    }
    return nextMaterial
  })
  return NextResponse.json({ success: true, material: updated })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ materialId: string }> },
) => {
  const authResult = await requireUserPermission(['assetWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { materialId } = await context.params

  const trashed = await prisma.$transaction(async (tx) => {
    const material = await tx.frameosMaterial.findFirst({
      where: { id: materialId, userId: session.user.id },
    })
    if (!material) throw new ApiError('NOT_FOUND')
    await requireMaterialProjectAccess(tx, session, material.projectId)
    if (material.deletedAt) return material
    if (material.source !== 'upload') {
      throw new ApiError('FORBIDDEN', { message: '这里只能删除本地上传的素材；项目产物请在对应工作流中管理。' })
    }
    if (material.type === 'audio') await assertCharacterVoiceNotBound(tx, session.user.id, [material.id])

    const references = await findCanvasMaterialReferences(tx, session.user.id, material)
    if (references.referenced) {
      throw new ApiError('CONFLICT', {
        message: canvasMaterialReferenceConflictMessage(references.counts),
        materialId: material.id,
        referenceCounts: references.counts,
      })
    }

    const result = await tx.frameosMaterial.updateMany({
      where: {
        id: material.id,
        userId: session.user.id,
        projectId: material.projectId,
        source: 'upload',
        updatedAt: material.updatedAt,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        deletedById: session.user.actorId || session.user.id,
        isFavorited: false,
      },
    })
    if (result.count !== 1) {
      throw new ApiError('CONFLICT', { message: '素材已发生变化，请刷新后重试。' })
    }
    const nextMaterial = await tx.frameosMaterial.findFirst({
      where: { id: material.id, userId: session.user.id, projectId: material.projectId },
    })
    if (!nextMaterial) throw new ApiError('NOT_FOUND')
    return nextMaterial
  })

  return NextResponse.json({ success: true, materialId: trashed.id, trashed: true })
})
