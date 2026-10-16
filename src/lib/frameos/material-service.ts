import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { extractStorageKey } from '@/lib/storage'
import { withCharacterVoiceMaterial } from './character-voice-reference'

export type FrameosMaterialType = 'image' | 'video' | 'audio' | 'model3d'
export type FrameosMaterialSource = 'toolbox' | 'creative' | 'production' | 'upload'

export interface RegisterFrameosMaterialInput {
  userId: string
  projectId?: string | null
  ownerName?: string | null
  title: string
  type: FrameosMaterialType
  source: FrameosMaterialSource
  storageKey?: string | null
  resultUrl?: string | null
  metadata?: Record<string, unknown> | null
}

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function parseStringList(value: string | null | undefined): string[] {
  const raw = cleanText(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
    }
  } catch {
    // A legacy field may contain a single storage key rather than JSON.
  }
  return [raw]
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)))
}

function safeTitle(value: string | null | undefined, fallback: string): string {
  return cleanText(value).slice(0, 160) || fallback
}

function materialIdentity(value: string): { storageKey: string | null; resultUrl: string } {
  const storageKey = extractStorageKey(value)
  return {
    storageKey,
    resultUrl: storageKey || value,
  }
}

function toPrismaJson(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function registerFrameosMaterial(input: RegisterFrameosMaterialInput) {
  const explicitStorageKey = cleanText(input.storageKey)
  const explicitResultUrl = cleanText(input.resultUrl)
  const resolvedStorageKey = explicitStorageKey || extractStorageKey(explicitResultUrl) || null
  const projectId = cleanText(input.projectId) || 'global'
  let resultUrl = explicitResultUrl || resolvedStorageKey || ''

  if (resolvedStorageKey) {
    const media = await ensureMediaObjectFromStorageKey(resolvedStorageKey)
    resultUrl = media.url
  }
  if (!resultUrl) {
    throw new Error('FrameOS material requires storageKey or resultUrl')
  }

  const where = resolvedStorageKey
    ? { userId: input.userId, projectId, storageKey: resolvedStorageKey }
    : { userId: input.userId, projectId, resultUrl }
  const existing = await prisma.frameosMaterial.findFirst({ where: { ...where, deletedAt: null } })
  const data = {
    projectId,
    ownerName: cleanText(input.ownerName) || null,
    title: safeTitle(input.title, '未命名素材'),
    type: input.type,
    source: input.source,
    status: 'ready',
    resultUrl,
    storageKey: resolvedStorageKey,
    metadata: toPrismaJson(input.metadata),
  }

  if (existing) {
    const previousMetadata = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, unknown> : {}
    const mergedMetadata = { ...previousMetadata, ...input.metadata }
    const metadata = mergedMetadata.assetCategory && mergedMetadata.assetCategory !== 'character'
      ? withCharacterVoiceMaterial(mergedMetadata, null) : mergedMetadata
    return await prisma.frameosMaterial.update({
      where: { id: existing.id },
      data: { ...data, metadata: toPrismaJson(metadata) },
    })
  }

  return await prisma.frameosMaterial.create({
    data: {
      userId: input.userId,
      ...data,
    },
  })
}

type BackfillCandidate = {
  projectId: string
  title: string
  value: string
  source: FrameosMaterialSource
  metadata: Record<string, unknown>
}

function appendCandidates(
  target: BackfillCandidate[],
  input: Omit<BackfillCandidate, 'value'> & { values: Array<string | null | undefined> },
) {
  for (const value of uniqueValues(input.values)) {
    target.push({
      projectId: input.projectId,
      title: input.title,
      value,
      source: input.source,
      metadata: input.metadata,
    })
  }
}

/**
 * Imports existing project/global image outputs into the material index.
 * This is intentionally idempotent and lets older generated images become
 * selectable without rewriting their original asset records.
 */
export async function syncGeneratedImagesToMaterialLibrary(input: {
  userId: string
  projectId?: string | null
}) {
  const [projects, owner] = await Promise.all([prisma.project.findMany({
    where: {
      userId: input.userId,
      deletedAt: null,
      ...(input.projectId ? { id: input.projectId } : {}),
    },
    select: {
      id: true,
      name: true,
      novelPromotionData: {
        select: {
          characters: {
            select: {
              id: true,
              name: true,
              appearances: {
                select: {
                  id: true,
                  changeReason: true,
                  imageUrl: true,
                  imageUrls: true,
                  previousImageUrl: true,
                  previousImageUrls: true,
                },
              },
            },
          },
          locations: {
            select: {
              id: true,
              name: true,
              assetKind: true,
              images: {
                select: {
                  id: true,
                  imageIndex: true,
                  imageUrl: true,
                  previousImageUrl: true,
                },
              },
            },
          },
          episodes: {
            select: {
              episodeNumber: true,
              name: true,
              storyboards: {
                select: {
                  panels: {
                    select: {
                      id: true,
                      panelNumber: true,
                      panelIndex: true,
                      imageUrl: true,
                      previousImageUrl: true,
                      candidateImages: true,
                      imageHistory: true,
                      sketchImageUrl: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }), prisma.user.findUnique({ where: { id: input.userId }, select: { name: true } })])

  const candidates: BackfillCandidate[] = []
  for (const project of projects) {
    const novel = project.novelPromotionData
    if (!novel) continue
    for (const character of novel.characters) {
      for (const appearance of character.appearances) {
        const label = cleanText(appearance.changeReason) || '主形象'
        appendCandidates(candidates, {
          projectId: project.id,
          title: `${character.name} · ${label}`,
          values: [
            appearance.imageUrl,
            ...parseStringList(appearance.imageUrls),
            appearance.previousImageUrl,
            ...parseStringList(appearance.previousImageUrls),
          ],
          source: 'creative',
          metadata: { originType: 'character', originId: appearance.id, projectName: project.name },
        })
      }
    }
    for (const location of novel.locations) {
      for (const image of location.images) {
        appendCandidates(candidates, {
          projectId: project.id,
          title: `${location.name}${location.images.length > 1 ? ` · ${image.imageIndex + 1}` : ''}`,
          values: [image.imageUrl, image.previousImageUrl],
          source: 'creative',
          metadata: {
            originType: location.assetKind === 'prop' ? 'prop' : 'location',
            originId: image.id,
            projectName: project.name,
          },
        })
      }
    }
    for (const episode of novel.episodes) {
      for (const storyboard of episode.storyboards) {
        for (const panel of storyboard.panels) {
          const shotNo = panel.panelNumber ?? panel.panelIndex + 1
          appendCandidates(candidates, {
            projectId: project.id,
            title: `E${episode.episodeNumber} · 镜头 ${shotNo}`,
            values: [
              panel.imageUrl,
              panel.previousImageUrl,
              panel.sketchImageUrl,
              ...parseStringList(panel.candidateImages),
              ...parseStringList(panel.imageHistory),
            ],
            source: 'production',
            metadata: {
              originType: 'panel',
              originId: panel.id,
              episodeNumber: episode.episodeNumber,
              episodeName: episode.name,
              projectName: project.name,
            },
          })
        }
      }
    }
  }

  if (!input.projectId) {
    const [globalCharacters, globalLocations] = await Promise.all([
      prisma.globalCharacter.findMany({
        where: { userId: input.userId },
        select: {
          name: true,
          appearances: {
            select: {
              id: true,
              changeReason: true,
              imageUrl: true,
              imageUrls: true,
              previousImageUrl: true,
              previousImageUrls: true,
            },
          },
        },
      }),
      prisma.globalLocation.findMany({
        where: { userId: input.userId },
        select: {
          name: true,
          assetKind: true,
          images: { select: { id: true, imageIndex: true, imageUrl: true, previousImageUrl: true } },
        },
      }),
    ])
    for (const character of globalCharacters) {
      for (const appearance of character.appearances) {
        appendCandidates(candidates, {
          projectId: 'global',
          title: `${character.name} · ${cleanText(appearance.changeReason) || '主形象'}`,
          values: [
            appearance.imageUrl,
            ...parseStringList(appearance.imageUrls),
            appearance.previousImageUrl,
            ...parseStringList(appearance.previousImageUrls),
          ],
          source: 'creative',
          metadata: { originType: 'global-character', originId: appearance.id },
        })
      }
    }
    for (const location of globalLocations) {
      for (const image of location.images) {
        appendCandidates(candidates, {
          projectId: 'global',
          title: `${location.name}${location.images.length > 1 ? ` · ${image.imageIndex + 1}` : ''}`,
          values: [image.imageUrl, image.previousImageUrl],
          source: 'creative',
          metadata: {
            originType: location.assetKind === 'prop' ? 'global-prop' : 'global-location',
            originId: image.id,
          },
        })
      }
    }
  }

  const normalized = candidates.map((candidate) => ({
    ...candidate,
    ...materialIdentity(candidate.value),
  }))
  const storageKeys = uniqueValues(normalized.map((item) => item.storageKey))
  const resultUrls = uniqueValues(normalized.map((item) => item.resultUrl))
  const existing = await prisma.frameosMaterial.findMany({
    where: {
      userId: input.userId,
      deletedAt: null,
      OR: [
        ...(storageKeys.length > 0 ? [{ storageKey: { in: storageKeys } }] : []),
        ...(resultUrls.length > 0 ? [{ resultUrl: { in: resultUrls } }] : []),
      ],
    },
    select: { projectId: true, storageKey: true, resultUrl: true },
  })
  const existingKeys = new Set(existing.filter((item) => item.storageKey).map((item) => JSON.stringify([item.projectId, cleanText(item.storageKey)])))
  const existingUrls = new Set(existing.filter((item) => item.resultUrl).map((item) => JSON.stringify([item.projectId, cleanText(item.resultUrl)])))
  const seen = new Set<string>()
  const missing = normalized.filter((item) => {
    const value = item.storageKey || item.resultUrl
    const identity = JSON.stringify([item.projectId, value])
    if (!value || seen.has(identity)
      || existingKeys.has(JSON.stringify([item.projectId, item.storageKey || '']))
      || existingUrls.has(JSON.stringify([item.projectId, item.resultUrl]))) {
      return false
    }
    seen.add(identity)
    return true
  })

  if (missing.length > 0) {
    await prisma.frameosMaterial.createMany({
      data: missing.map((item) => ({
        userId: input.userId,
        ownerName: owner?.name || null,
        projectId: item.projectId,
        title: safeTitle(item.title, '生成图片'),
        type: 'image',
        source: item.source,
        status: 'ready',
        resultUrl: item.resultUrl,
        storageKey: item.storageKey,
        metadata: toPrismaJson(item.metadata),
      })),
    })
  }

  return { discovered: normalized.length, created: missing.length }
}
