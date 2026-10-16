import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'

export async function assertCharacterVoiceNotBound(tx: Prisma.TransactionClient, userId: string, materialIds: string[]) {
  if (!materialIds.length) return
  const linked = await tx.frameosMaterial.findFirst({
    where: { userId, deletedAt: null, type: 'image', OR: materialIds.map((id) => ({ metadata: { path: '$.voiceMaterialId', equals: id } })) },
    select: { id: true, title: true },
  })
  if (linked) throw new ApiError('CONFLICT', { message: `音色仍被角色「${linked.title || '未命名角色'}」使用，请先解除角色卡音色绑定。` })
  const audio = await tx.frameosMaterial.findMany({
    where: { userId, id: { in: materialIds } }, select: { storageKey: true, resultUrl: true },
  })
  const sources = [...new Set(audio.flatMap((item) => [item.storageKey, item.resultUrl]).filter((value): value is string => Boolean(value)))]
  if (!sources.length) return
  const voiceWhere = { OR: [{ customVoiceUrl: { in: sources } }, { customVoiceMedia: { storageKey: { in: sources } } }] }
  const [global, project] = await Promise.all([
    tx.globalCharacter.findFirst({ where: { userId, ...voiceWhere }, select: { name: true } }),
    tx.novelPromotionCharacter.findFirst({ where: { novelPromotionProject: { project: { userId } }, ...voiceWhere }, select: { name: true } }),
  ])
  if (global || project) throw new ApiError('CONFLICT', { message: `音色仍被角色「${global?.name || project?.name || '未命名角色'}」使用，请先解除角色音色绑定。` })
}
