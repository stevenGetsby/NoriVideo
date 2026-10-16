import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { deleteObjects, extractStorageKey } from '@/lib/storage'
import { unreferencedProjectStorageKeys } from './shared-media-retention'
import {
  cleanupUnreferencedBailianVoices,
  collectProjectBailianManagedVoiceIds,
} from '@/lib/providers/bailian'

export const PROJECT_RECYCLE_RETENTION_MS = 15 * 24 * 60 * 60 * 1000
export const PROJECT_RECYCLE_RETENTION_DAYS = 15

const logger = createScopedLogger({ module: 'projects.recycle-bin' })

const MEDIA_URL_FIELDS = [
  'contentUrl',
  'imageUrl',
  'videoUrl',
  'audioUrl',
  'modelUrl',
  'posterUrl',
  'url',
  'previewUrl',
  'thumbnailUrl',
  'storageKey',
] as const

function pushMediaString(value: unknown, keys: string[]) {
  if (typeof value !== 'string' || !value.trim()) return
  const key = extractStorageKey(value)
  if (key) keys.push(key)
}

/**
 * Canvas media can appear in current nodes, generation history, reference
 * summaries, snapshots, and nested 3D documents. Scan JSON shape-agnostically
 * so adding another durable URL field does not silently leak storage objects.
 */
function collectCanvasMediaStorageKeys(value: unknown, keys: string[]) {
  if (typeof value === 'string') return
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectCanvasMediaStorageKeys(item, keys)
    return
  }
  const record = value as Record<string, unknown>
  for (const field of MEDIA_URL_FIELDS) pushMediaString(record[field], keys)
  for (const item of Object.values(record)) collectCanvasMediaStorageKeys(item, keys)
}

export function projectRestoreDeadline(deletedAt: Date) {
  return new Date(deletedAt.getTime() + PROJECT_RECYCLE_RETENTION_MS)
}

export async function collectProjectStorageKeys(projectId: string): Promise<string[]> {
  const [novelPromotion, frameosMaterials, toolboxAssets, canvases] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId },
      include: {
        characters: { include: { appearances: true } },
        locations: { include: { images: true } },
        episodes: {
          include: {
            storyboards: { include: { panels: true } },
          },
        },
      },
    }),
    prisma.frameosMaterial.findMany({
      where: { projectId },
      select: { resultUrl: true, storageKey: true },
    }),
    prisma.frameosToolboxAsset.findMany({
      where: { projectId },
      select: { resultUrl: true, params: true },
    }),
    prisma.canvas.findMany({
      where: { projectId },
      select: {
        nodes: { select: { data: true, studioDocument: { select: { document: true } } } },
        snapshots: {
          select: {
            document: true,
            studioDocuments: { select: { document: true } },
          },
        },
      },
    }),
  ])
  const keys: string[] = []
  const push = async (value: unknown) => {
    const key = await resolveStorageKeyFromMediaValue(value)
    if (key) keys.push(key)
  }

  const pushDirectKey = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return
    const key = extractStorageKey(value)
    if (key) keys.push(key)
  }
  for (const material of frameosMaterials) pushDirectKey(material.storageKey || material.resultUrl)
  for (const canvas of canvases) {
    for (const node of canvas.nodes) {
      collectCanvasMediaStorageKeys(node.data, keys)
      collectCanvasMediaStorageKeys(node.studioDocument?.document, keys)
    }
    for (const snapshot of canvas.snapshots) {
      collectCanvasMediaStorageKeys(snapshot.document, keys)
      for (const document of snapshot.studioDocuments) collectCanvasMediaStorageKeys(document.document, keys)
    }
  }
  for (const asset of toolboxAssets) {
    pushDirectKey(asset.resultUrl)
    const params = asset.params
    if (params && typeof params === 'object' && !Array.isArray(params)) {
      for (const value of Object.values(params as Record<string, unknown>)) {
        if (typeof value === 'string') pushDirectKey(value)
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
          const record = value as Record<string, unknown>
          pushDirectKey(record.url ?? record.thumbnailUrl ?? record.audioUrl ?? record.videoUrl)
        }
      }
    }
  }

  if (novelPromotion) {
  if (Array.isArray(novelPromotion.artStyleReferences)) {
    for (const reference of novelPromotion.artStyleReferences) {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference)) continue
      const record = reference as Record<string, unknown>
      await push(record.storageKey ?? record.url)
    }
  }
  for (const character of novelPromotion.characters) {
    for (const appearance of character.appearances) await push(appearance.imageUrl)
  }
  for (const location of novelPromotion.locations) {
    for (const image of location.images) await push(image.imageUrl)
  }
  for (const episode of novelPromotion.episodes) {
    await push(episode.audioUrl)
    for (const storyboard of episode.storyboards) {
      await push(storyboard.storyboardImageUrl)
      if (typeof storyboard.candidateImages === 'string') {
        try {
          const candidates = JSON.parse(storyboard.candidateImages) as unknown[]
          for (const candidate of candidates) await push(candidate)
        } catch {
          // A malformed legacy JSON array is removed with the project anyway.
        }
      }
      for (const panel of storyboard.panels) {
        await push(panel.imageUrl)
        await push(panel.videoUrl)
      }
    }
  }
  }
  return Array.from(new Set(keys))
}

async function purgeProject(project: {
  id: string
  name: string
  userId: string
}) {
  const keys = await collectProjectStorageKeys(project.id)
  const voiceIds = await collectProjectBailianManagedVoiceIds(project.id)
  const voices = await cleanupUnreferencedBailianVoices({
    voiceIds,
    scope: {
      userId: project.userId,
      excludeProjectId: project.id,
    },
  })
  await prisma.project.delete({ where: { id: project.id } })
  const deletableKeys = await unreferencedProjectStorageKeys(project.id, keys)

  // The database is the source of restoreability. Only clean storage after the
  // project row has been deleted; a storage failure then leaves an orphan
  // object rather than an unrecoverable project whose files are already gone.
  if (deletableKeys.length > 0) {
    try {
      await deleteObjects(deletableKeys)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({
        action: 'recycle-bin.storage_cleanup_failed',
        message: `Failed to clean storage after purging project ${project.id}`,
        error: { message },
        details: { storageObjects: deletableKeys.length },
      })
    }
  }

  logger.info({
    action: 'recycle-bin.purged',
    message: `Purged project ${project.id}`,
    details: {
      storageObjectsDeleted: deletableKeys.length,
      sharedStorageObjectsRetained: keys.length - deletableKeys.length,
      bailianVoicesDeleted: voices.deletedVoiceIds.length,
    },
  })
}

/** Hard-deletes recycle-bin projects that passed the 15-day retention window. */
export async function purgeExpiredRecycleBinProjects(limit = 20) {
  const deadline = new Date(Date.now() - PROJECT_RECYCLE_RETENTION_MS)
  const projects = await prisma.project.findMany({
    where: { deletedAt: { lte: deadline } },
    orderBy: { deletedAt: 'asc' },
    take: limit,
    select: { id: true, name: true, userId: true },
  })

  const purged: string[] = []
  const failed: Array<{ id: string; message: string }> = []
  for (const project of projects) {
    try {
      await purgeProject(project)
      purged.push(project.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ id: project.id, message })
      logger.error({
        action: 'recycle-bin.purge_failed',
        message: `Failed to purge project ${project.id}`,
        error: { message },
      })
    }
  }
  return { purged, failed }
}
