import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission, type AuthSession } from '@/lib/api-auth'
import { projectReadWhere } from '@/lib/collaboration/access'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { canActorAccessMaterial, PERSONAL_MATERIAL_PROJECT_ID } from '@/lib/frameos/material-ownership'
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
import { characterVoiceMaterialId, withCharacterVoiceMaterial } from '@/lib/frameos/character-voice-reference'
import { assertCharacterVoiceNotBound } from '@/lib/frameos/character-voice-service'

const ACCOUNT_MATERIAL_PROJECT_IDS = new Set(['global', 'global-asset-hub'])

async function requireMaterialProjectAccess(
  tx: Prisma.TransactionClient,
  session: AuthSession,
  projectId: string,
) {
  if (ACCOUNT_MATERIAL_PROJECT_IDS.has(projectId) || projectId === PERSONAL_MATERIAL_PROJECT_ID) return
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
    const actor = getWorkspaceActor(session)
    const material = await tx.frameosMaterial.findFirst({
      where: { id: materialId, userId: actor.workspaceOwnerId },
    })
    if (!material || !canActorAccessMaterial(session, material)) throw new ApiError('NOT_FOUND')
    await requireMaterialProjectAccess(tx, session, material.projectId)
    const requestedProjectId = typeof body.projectId === 'string' ? body.projectId.trim() : null
    if (body.projectId !== undefined && (!requestedProjectId || requestedProjectId.length > 191)) {
      throw new ApiError('INVALID_PARAMS', { message: '素材项目归属无效。' })
    }
    const projectId = requestedProjectId || material.projectId
    const targetProjectId = projectId
    if (requestedProjectId === PERSONAL_MATERIAL_PROJECT_ID && material.projectId !== PERSONAL_MATERIAL_PROJECT_ID) {
      throw new ApiError('FORBIDDEN', { message: '共享素材不能移入个人素材池，请重新上传为自己的个人素材。' })
    }
    if (projectId !== material.projectId) {
      if (material.personalOwnerId !== actor.actorId) {
        throw new ApiError('FORBIDDEN', { message: '只有个人素材的创建者可以更改项目归属。' })
      }
      await requireMaterialProjectAccess(tx, session, projectId)
      if (projectId !== PERSONAL_MATERIAL_PROJECT_ID && material.type === 'audio') {
        const boundVoice = await tx.frameosMaterial.findFirst({
          where: {
            userId: actor.workspaceOwnerId, deletedAt: null, type: 'image',
            metadata: { path: '$.voiceMaterialId', equals: material.id },
            projectId: { notIn: [targetProjectId, PERSONAL_MATERIAL_PROJECT_ID, ...ACCOUNT_MATERIAL_PROJECT_IDS] },
          },
          select: { title: true },
        })
        if (boundVoice) throw new ApiError('CONFLICT', { message: `该音色仍被角色「${boundVoice.title || '未命名角色'}」绑定，请先解除绑定再调整归属。` })
      }
      if (frameosCharacterBindingFromMetadata(material.metadata)) {
        throw new ApiError('CONFLICT', { message: '请先解除作品角色绑定，再调整素材归属。' })
      }
    }
    const sharingPersonalMaterial = material.projectId === PERSONAL_MATERIAL_PROJECT_ID && targetProjectId !== PERSONAL_MATERIAL_PROJECT_ID
    const previousVoiceId = characterVoiceMaterialId(material.metadata)
    const sharedVoice = sharingPersonalMaterial && material.type === 'image' && previousVoiceId
      ? await tx.frameosMaterial.findFirst({
        where: {
          id: previousVoiceId, userId: actor.workspaceOwnerId, type: 'audio', status: 'ready', deletedAt: null,
          projectId: { in: [targetProjectId, ...ACCOUNT_MATERIAL_PROJECT_IDS] },
        },
        select: { id: true },
      })
      : null
    const shareClearedVoice = Boolean(previousVoiceId && sharingPersonalMaterial && material.type === 'image' && !sharedVoice)

    if (body.restore === true && !material.deletedAt) return { material, projectName: null, shareClearedVoice: false }
    if (body.restore !== true && material.deletedAt) throw new ApiError('NOT_FOUND')

    const requestedCharacterId = typeof body.characterId === 'string' ? body.characterId.trim() : ''
    const nextCategory = body.assetCategory !== undefined
      ? body.assetCategory
      : frameosAssetCategoryFromMetadata(material.metadata)
    let characterBinding: { characterId: string; characterName: string | null } | null = null
    if (requestedCharacterId) {
      if (ACCOUNT_MATERIAL_PROJECT_IDS.has(targetProjectId) || targetProjectId === PERSONAL_MATERIAL_PROJECT_ID || nextCategory !== 'character') {
        throw new ApiError('INVALID_PARAMS', { message: '只有项目内的角色素材才能绑定项目角色。' })
      }
      const character = await tx.novelPromotionCharacter.findFirst({
        where: {
          id: requestedCharacterId,
          novelPromotionProject: { projectId: targetProjectId },
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
            id: voiceId, userId: actor.workspaceOwnerId, type: 'audio', status: 'ready', deletedAt: null,
            projectId: { in: [targetProjectId, PERSONAL_MATERIAL_PROJECT_ID, ...ACCOUNT_MATERIAL_PROJECT_IDS] },
            OR: [{ personalOwnerId: null }, { personalOwnerId: actor.actorId }],
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
    if (shareClearedVoice) nextMetadata = withCharacterVoiceMaterial(nextMetadata || material.metadata, null)

    const result = await tx.frameosMaterial.updateMany({
      where: {
        id: material.id,
        userId: actor.workspaceOwnerId,
        projectId: material.projectId,
        updatedAt: material.updatedAt,
        ...(body.restore === true ? { deletedAt: material.deletedAt } : { deletedAt: null }),
      },
      data: body.restore === true
        ? { deletedAt: null, deletedById: null }
        : {
            ...(title ? { title } : {}),
          ...(requestedProjectId ? {
            projectId: targetProjectId,
            personalOwnerId: targetProjectId === PERSONAL_MATERIAL_PROJECT_ID ? actor.actorId : null,
          } : {}),
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
      where: { id: material.id, userId: actor.workspaceOwnerId, ...(body.restore === true ? {} : { deletedAt: null }) },
    })
    if (!nextMaterial) throw new ApiError('NOT_FOUND')
    const project = ACCOUNT_MATERIAL_PROJECT_IDS.has(nextMaterial.projectId) || nextMaterial.projectId === PERSONAL_MATERIAL_PROJECT_ID
      ? null
      : await tx.project.findFirst({
        where: projectReadWhere(session, nextMaterial.projectId),
        select: { id: true, name: true },
      })

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
    return { material: nextMaterial, projectName: project?.name || null, shareClearedVoice }
  })
  return NextResponse.json({
    success: true,
    voiceCleared: updated.shareClearedVoice,
    message: updated.shareClearedVoice ? '素材已共享到项目。原私人音色不可被其他成员访问，已解除角色卡音色绑定；音频文件仍保留在个人素材中。' : null,
    material: {
      ...updated.material,
      canEdit: !updated.material.personalOwnerId || updated.material.personalOwnerId === getWorkspaceActor(session).actorId,
      personal: updated.material.personalOwnerId === getWorkspaceActor(session).actorId
        && updated.material.projectId === PERSONAL_MATERIAL_PROJECT_ID,
      projectName: updated.material.projectId === PERSONAL_MATERIAL_PROJECT_ID ? '个人素材'
        : ACCOUNT_MATERIAL_PROJECT_IDS.has(updated.material.projectId) ? '账号素材'
          : updated.projectName || '项目素材',
    },
  })
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
    const actor = getWorkspaceActor(session)
    const material = await tx.frameosMaterial.findFirst({
      where: { id: materialId, userId: actor.workspaceOwnerId },
    })
    if (!material || !canActorAccessMaterial(session, material)) throw new ApiError('NOT_FOUND')
    await requireMaterialProjectAccess(tx, session, material.projectId)
    if (material.deletedAt) return material
    if (material.source !== 'upload') {
      throw new ApiError('FORBIDDEN', { message: '这里只能删除本地上传的素材；项目产物请在对应工作流中管理。' })
    }
    if (material.type === 'audio') await assertCharacterVoiceNotBound(tx, actor.workspaceOwnerId, [material.id])

    const references = await findCanvasMaterialReferences(tx, actor.workspaceOwnerId, material)
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
        userId: actor.workspaceOwnerId,
        projectId: material.projectId,
        source: 'upload',
        updatedAt: material.updatedAt,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        deletedById: actor.actorId,
        isFavorited: false,
      },
    })
    if (result.count !== 1) {
      throw new ApiError('CONFLICT', { message: '素材已发生变化，请刷新后重试。' })
    }
    const nextMaterial = await tx.frameosMaterial.findFirst({
      where: { id: material.id, userId: actor.workspaceOwnerId },
    })
    if (!nextMaterial) throw new ApiError('NOT_FOUND')
    return nextMaterial
  })

  return NextResponse.json({ success: true, materialId: trashed.id, trashed: true })
})
