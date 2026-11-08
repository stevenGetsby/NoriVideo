import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'

export async function findBoundCharacterVoices(tx: Prisma.TransactionClient, userId: string, materialIds: string[]): Promise<Map<string, string>> {
  const conflicts = new Map<string, string>()
  if (!materialIds.length) return conflicts
  const linked = await tx.frameosMaterial.findMany({
    where: { userId, deletedAt: null, type: 'image', OR: materialIds.map((id) => ({ metadata: { path: '$.voiceMaterialId', equals: id } })) },
    select: { id: true, title: true, metadata: true },
  })
  for (const image of linked) {
    const metadata = image.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata) ? image.metadata : {}
    const id = typeof metadata.voiceMaterialId === 'string' ? metadata.voiceMaterialId : ''
    if (materialIds.includes(id)) conflicts.set(id, `音色仍被角色「${image.title || '未命名角色'}」使用，请先解除角色卡音色绑定。`)
  }
  const remaining = materialIds.filter((id) => !conflicts.has(id))
  if (!remaining.length) return conflicts
  const audio = await tx.frameosMaterial.findMany({
    where: { userId, id: { in: remaining } }, select: { id: true, storageKey: true, resultUrl: true },
  })
  const sources = [...new Set(audio.flatMap((item) => [item.storageKey, item.resultUrl]).filter((value): value is string => Boolean(value)))]
  if (!sources.length) return conflicts
  const voiceWhere = { OR: [{ customVoiceUrl: { in: sources } }, { customVoiceMedia: { storageKey: { in: sources } } }] }
  const [global, project] = await Promise.all([
    tx.globalCharacter.findMany({ where: { userId, ...voiceWhere }, select: { name: true, customVoiceUrl: true, customVoiceMedia: { select: { storageKey: true } } } }),
    tx.novelPromotionCharacter.findMany({ where: { novelPromotionProject: { project: { userId } }, ...voiceWhere }, select: { name: true, customVoiceUrl: true, customVoiceMedia: { select: { storageKey: true } } } }),
  ])
  for (const item of audio) {
    const character = [...global, ...project].find((candidate) => candidate.customVoiceUrl === item.resultUrl
      || candidate.customVoiceUrl === item.storageKey
      || Boolean(item.storageKey && candidate.customVoiceMedia?.storageKey === item.storageKey))
    if (character) conflicts.set(item.id, `音色仍被角色「${character.name || '未命名角色'}」使用，请先解除角色音色绑定。`)
  }
  return conflicts
}

export async function assertCharacterVoiceNotBound(tx: Prisma.TransactionClient, userId: string, materialIds: string[]) {
  if (!materialIds.length) return
  const conflicts = await findBoundCharacterVoices(tx, userId, materialIds)
  if (conflicts.size > 0) throw new ApiError('CONFLICT', { message: conflicts.values().next().value })
}
