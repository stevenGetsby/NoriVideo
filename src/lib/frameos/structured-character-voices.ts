import { prisma } from '@/lib/prisma'
import { registerFrameosMaterial } from './material-service'
import { characterVoiceMaterialId } from './character-voice-reference'
import { probeMediaDurationSeconds } from '@/lib/media/duration-probe'
import { extractStorageKey, getObjectBuffer } from '@/lib/storage'
import { ApiError } from '@/lib/api-errors'

/** Legacy structured characters store their voices outside FrameosMaterial.
 * Resolve only server-owned character ids in the authorised current project. */
export async function materializeStructuredCharacterVoices(input: {
  userId: string; projectId: string
  images: Array<{ metadata: unknown }>
}) {
  const appearances: string[] = []
  const globalAppearances: string[] = []
  for (const image of input.images) {
    const metadata = image.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata) ? image.metadata as Record<string, unknown> : {}
    if (!characterVoiceMaterialId(metadata) && metadata.originType === 'character' && typeof metadata.originId === 'string') appearances.push(metadata.originId)
    if (!characterVoiceMaterialId(metadata) && metadata.originType === 'global-character' && typeof metadata.originId === 'string') globalAppearances.push(metadata.originId)
  }
  if (!appearances.length && !globalAppearances.length) return []
  const rows = appearances.length ? await prisma.characterAppearance.findMany({
    where: { id: { in: appearances }, character: { novelPromotionProject: { projectId: input.projectId } } },
    select: { character: { select: { id: true, name: true, customVoiceUrl: true, customVoiceMedia: { select: { storageKey: true } } } } },
  }) : []
  const globals = globalAppearances.length ? await prisma.globalCharacterAppearance.findMany({
    where: { id: { in: globalAppearances }, character: { userId: input.userId } },
    select: { character: { select: { id: true, name: true, customVoiceUrl: true, customVoiceMedia: { select: { storageKey: true } } } } },
  }) : []
  const characters = [...new Map([
    ...rows.map((row) => [row.character.id, { ...row.character, projectId: input.projectId }] as const),
    ...globals.map((row) => [row.character.id, { ...row.character, projectId: 'global' }] as const),
  ]).values()]
  const voices = []
  for (const character of characters) {
    const source = character.customVoiceMedia?.storageKey || character.customVoiceUrl
    if (!source) continue
    const key = extractStorageKey(source)
    if (!key) throw new ApiError('INVALID_PARAMS', { message: `「${character.name}」音色没有可用的存储文件，请重新上传。` })
    const existing = await prisma.frameosMaterial.findFirst({ where: { userId: input.userId, projectId: character.projectId, type: 'audio', storageKey: key, status: 'ready', deletedAt: null } })
    const metadata = existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, unknown> : {}
    if (existing && typeof metadata.durationSeconds === 'number' && metadata.durationSeconds > 0) { voices.push(existing); continue }
    const bytes = await getObjectBuffer(key)
    if (bytes.length > 50 * 1024 * 1024) throw new ApiError('INVALID_PARAMS', { message: `「${character.name}」音色超过 50MB，请重新上传短音频。` })
    const durationSeconds = await probeMediaDurationSeconds(bytes)
    if (!durationSeconds) throw new ApiError('INVALID_PARAMS', { message: `无法读取「${character.name}」音色时长，请重新上传有效音频。` })
    const voice = await registerFrameosMaterial({
      userId: input.userId, projectId: character.projectId, title: `${character.name}音色`, type: 'audio', source: 'creative',
      resultUrl: source, metadata: { assetCategory: 'character', characterId: character.id, characterName: character.name, durationSeconds },
    })
    voices.push(voice)
  }
  return voices
}
