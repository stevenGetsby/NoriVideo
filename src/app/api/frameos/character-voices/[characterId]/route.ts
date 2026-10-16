import { NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserPermission, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/** Bind an account-owned global structured character to an account audio. */
export const PATCH = apiHandler(async (request, context: { params: Promise<{ characterId: string }> }) => {
  const auth = await requireUserPermission(['assetWrite'])
  if (isErrorResponse(auth)) return auth
  const { characterId } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('INVALID_PARAMS')
  if (body.voiceMaterialId !== null && (typeof body.voiceMaterialId !== 'string' || !body.voiceMaterialId.trim() || body.voiceMaterialId.length > 191)) throw new ApiError('INVALID_PARAMS')
  const character = await prisma.$transaction(async (tx) => {
    const existing = await tx.globalCharacter.findFirst({ where: { id: characterId, userId: auth.session.user.id }, select: { id: true } })
    if (!existing) throw new ApiError('NOT_FOUND')
    const voice = body.voiceMaterialId === null ? null : await tx.frameosMaterial.findFirst({
      where: { id: body.voiceMaterialId.trim(), userId: auth.session.user.id, projectId: { in: ['global', 'global-asset-hub'] }, type: 'audio', status: 'ready', deletedAt: null },
    })
    if (body.voiceMaterialId !== null && !voice) throw new ApiError('NOT_FOUND', { message: '请选择账号音色库内有效音频。' })
    if (voice) {
      const changed = await tx.frameosMaterial.updateMany({
        where: { id: voice.id, status: 'ready', type: 'audio', deletedAt: null },
        data: { updatedAt: new Date(Math.max(Date.now(), voice.updatedAt.getTime() + 1)) },
      })
      if (changed.count !== 1) throw new ApiError('CONFLICT', { message: '音色正在变更，请重新选择。' })
    }
    const media = voice?.storageKey ? await tx.mediaObject.findUnique({ where: { storageKey: voice.storageKey }, select: { id: true } }) : null
    return tx.globalCharacter.update({ where: { id: existing.id }, data: {
      voiceType: voice ? 'uploaded' : null, voiceId: null, globalVoiceId: null,
      customVoiceUrl: voice?.storageKey || voice?.resultUrl || null, customVoiceMediaId: media?.id || null,
    } })
  })
  return NextResponse.json({ success: true, character })
})
