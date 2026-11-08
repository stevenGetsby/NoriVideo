import { prisma } from '@/lib/prisma'
import { extractStorageKey, getObjectBuffer } from '@/lib/storage'
import { probeMediaDurationSeconds } from '@/lib/media/duration-probe'
import { readMediaDurationSeconds } from '@/lib/canvas/generation-input-schema'

type MaterialWithDuration = {
  id: string
  type: string
  storageKey: string | null
  resultUrl: string | null
  metadata: unknown
}

export async function ensureFrameosReferenceMediaDurations<T extends MaterialWithDuration>(materials: T[]): Promise<T[]> {
  return await Promise.all(materials.map(async (material) => {
    if ((material.type !== 'audio' && material.type !== 'video') || readMediaDurationSeconds(material.metadata) !== null) return material
    const storageKey = extractStorageKey(material.storageKey || material.resultUrl)
    if (!storageKey) return material
    const body = await getObjectBuffer(storageKey).catch(() => null)
    if (!body) return material
    const durationSeconds = await probeMediaDurationSeconds(body)
    if (durationSeconds === null) return material
    const metadata = {
      ...(material.metadata && typeof material.metadata === 'object' && !Array.isArray(material.metadata) ? material.metadata : {}),
      durationSeconds,
    }
    await prisma.frameosMaterial.updateMany({ where: { id: material.id, deletedAt: null }, data: { metadata } })
    return { ...material, metadata }
  }))
}
