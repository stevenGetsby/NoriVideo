import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import type { AuthSession } from '@/lib/api-auth'
import { findCanvasMaterialReferences } from '@/lib/canvas/material-reference-guard'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { readRequestFormData } from '@/lib/http/request-form-data'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { characterVoiceMaterialId } from './character-voice-reference'
import { ACCOUNT_MATERIAL_PROJECT_IDS, requireMaterialProjectAccess } from './material-access'
import { frameosCharacterBindingFromMetadata } from './material-category'
import { isUserManagedMaterial } from './material-inherit'
import { canActorAccessMaterial, PERSONAL_MATERIAL_PROJECT_ID } from './material-ownership'
import { replacementMaterialMetadata, supersededByMaterialId, withSupersededMaterial } from './material-supersede'
import {
  assertUploadContentLength,
  normalizeFrameosImageUpload,
  storeFrameosMaterialObject,
  withMaterialUploadPermit,
} from './material-upload'
import { isImageUpload, MAX_MATERIAL_FILE_BYTES } from './upload-file-policy'

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function loadReplaceableMaterial(tx: Prisma.TransactionClient, session: AuthSession, materialId: string) {
  const actor = getWorkspaceActor(session)
  const material = await tx.frameosMaterial.findFirst({
    where: { id: materialId, userId: actor.workspaceOwnerId },
  })
  if (!material || material.deletedAt || !canActorAccessMaterial(session, material)) throw new ApiError('NOT_FOUND')
  await requireMaterialProjectAccess(tx, session, material.projectId)
  // A retired row only survives for canvases that still point at it.
  if (supersededByMaterialId(material.metadata)) throw new ApiError('NOT_FOUND')
  if (material.type !== 'image') {
    throw new ApiError('INVALID_PARAMS', { message: '只有图片素材可以替换图片。' })
  }
  if (!isUserManagedMaterial(material)) {
    throw new ApiError('FORBIDDEN', { message: '只能替换本地上传或继承的素材；生成结果请在对应工作流中管理。' })
  }
  if (frameosCharacterBindingFromMetadata(material.metadata)) {
    throw new ApiError('CONFLICT', { message: '该素材已绑定作品角色，请在作品资产中替换角色图片。' })
  }
  return material
}

type ReplaceableMaterial = Awaited<ReturnType<typeof loadReplaceableMaterial>>

/** The role voice moves to the new image only while that voice is still a ready, reachable audio. */
async function resolveVoiceToKeep(tx: Prisma.TransactionClient, session: AuthSession, material: ReplaceableMaterial) {
  const previousVoiceId = characterVoiceMaterialId(material.metadata)
  if (!previousVoiceId) return { voiceId: null, dropped: false }
  const actor = getWorkspaceActor(session)
  const voice = await tx.frameosMaterial.findFirst({
    where: {
      id: previousVoiceId, userId: actor.workspaceOwnerId, type: 'audio', status: 'ready', deletedAt: null,
      projectId: { in: [material.projectId, PERSONAL_MATERIAL_PROJECT_ID, ...ACCOUNT_MATERIAL_PROJECT_IDS] },
      OR: [{ personalOwnerId: null }, { personalOwnerId: actor.actorId }],
    },
    select: { id: true, updatedAt: true },
  })
  if (!voice) return { voiceId: null, dropped: true }
  // Same lock the role-voice binding takes: a concurrent voice deletion must fail its updatedAt guard.
  const previousTime = voice.updatedAt instanceof Date ? voice.updatedAt.getTime() : 0
  const locked = await tx.frameosMaterial.updateMany({
    where: { id: voice.id, type: 'audio', status: 'ready', deletedAt: null },
    data: { updatedAt: new Date(Math.max(Date.now(), previousTime + 1)) },
  })
  if (locked.count !== 1) throw new ApiError('CONFLICT', { message: '音色已被删除或正在变更，请稍后重试。' })
  return { voiceId: voice.id, dropped: false }
}

/**
 * Replaces the picture of an uploaded library image while keeping everything
 * else about it (name, project, category, favourite, role voice).
 *
 * The old row is never edited in place: canvases keep `materialId` plus the
 * old image URL, and generation resolves the reference image from the row.
 * Swapping the file under an existing id would make a canvas show one picture
 * while the model is given another. So the new image is a new row, and the
 * old row is retired - trashed when nothing uses it, otherwise kept (hidden
 * from the libraries) so those canvases keep generating from what they show.
 */
export async function replaceFrameosMaterialImage(
  request: NextRequest,
  session: AuthSession,
  materialId: string,
) {
  assertUploadContentLength(request)
  // Fail on an unknown/forbidden id before paying for the upload and image decode.
  await loadReplaceableMaterial(prisma, session, materialId)

  return await withMaterialUploadPermit(async () => {
    const form = await readRequestFormData(request, { fileSizeLabel: '200MB' })
    const fileValue = form.get('file')
    const file = fileValue instanceof File ? fileValue : null
    if (!file) throw new ApiError('INVALID_PARAMS', { message: '请选择要替换的图片。' })
    if (file.size <= 0 || file.size > MAX_MATERIAL_FILE_BYTES) {
      throw new ApiError('INVALID_PARAMS', { message: '素材文件大小必须在 200MB 以内。' })
    }
    if (!isImageUpload(file)) {
      throw new ApiError('INVALID_PARAMS', { message: '请选择图片文件（JPG、PNG、WebP 等）。' })
    }

    const image = await normalizeFrameosImageUpload(Buffer.from(await file.arrayBuffer()))
    const storageKey = await storeFrameosMaterialObject(image.body, session.user.id, image.extension, image.contentType)
    const media = await ensureMediaObjectFromStorageKey(storageKey)
    const actor = getWorkspaceActor(session)

    const result = await prisma.$transaction(async (tx) => {
      const previous = await loadReplaceableMaterial(tx, session, materialId)
      const voice = await resolveVoiceToKeep(tx, session, previous)
      const created = await tx.frameosMaterial.create({
        data: {
          userId: actor.workspaceOwnerId,
          personalOwnerId: previous.personalOwnerId,
          projectId: previous.projectId,
          ownerName: session.user.name?.replace(/\s+/g, ' ').trim() || previous.ownerName,
          title: previous.title,
          type: 'image',
          source: 'upload',
          status: 'ready',
          isFavorited: previous.isFavorited,
          resultUrl: media.url,
          storageKey,
          metadata: toJson(replacementMaterialMetadata(previous.metadata, previous.id, {
            originalName: file.name,
            mimeType: image.contentType,
            sizeBytes: image.body.length,
            width: image.width,
            height: image.height,
          }, voice.voiceId)),
        },
      })

      const references = await findCanvasMaterialReferences(tx, actor.workspaceOwnerId, previous)
      const retired = references.referenced ? 'superseded' as const : 'trashed' as const
      const retire = await tx.frameosMaterial.updateMany({
        where: {
          id: previous.id,
          userId: actor.workspaceOwnerId,
          projectId: previous.projectId,
          source: previous.source,
          updatedAt: previous.updatedAt,
          deletedAt: null,
        },
        data: retired === 'trashed'
          ? { deletedAt: new Date(), deletedById: actor.actorId, isFavorited: false }
          : { isFavorited: false, metadata: toJson(withSupersededMaterial(previous.metadata, created.id)) },
      })
      if (retire.count !== 1) {
        throw new ApiError('CONFLICT', { message: '素材已发生变化，请刷新后重试。' })
      }
      return { created, previous, retired, referenceCounts: references.counts, voice }
    }, { timeout: 30_000 })

    return NextResponse.json({
      success: true,
      material: {
        ...result.created,
        url: result.created.resultUrl || result.created.storageKey,
        projectName: result.created.personalOwnerId ? '个人素材' : result.created.projectId === 'global' ? '账号素材' : '项目素材',
      },
      previousMaterialId: result.previous.id,
      retired: result.retired,
      referenceCounts: result.referenceCounts,
      voiceKept: Boolean(result.voice.voiceId),
      voiceDropped: result.voice.dropped,
    })
  }, request.signal)
}
