import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import {
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
  withLabelBar,
} from '../utils'
import { mediaUrlFromRef, resolveMediaRef } from '@/lib/media/service'
import { parseCharacterDescriptionValues } from '@/lib/novel-promotion/character-appearance-frameos-metadata'
import { registerFrameosMaterial, type FrameosMaterialSource } from '@/lib/frameos/material-service'
import {
  databaseAppearanceOptions,
  selectStoryboardCharacterAppearance,
} from '@/lib/novel-promotion/storyboard-character-appearance'

export type AnyObj = Record<string, unknown>

interface CharacterAppearanceLike {
  id?: string | null
  appearanceIndex?: number
  changeReason: string | null
  description?: string | null
  descriptions?: string | null
  imageUrls: string | null
  imageUrl: string | null
  imageMediaId?: string | null
  selectedIndex: number | null
}

interface CharacterLike {
  name: string
  introduction?: string | null
  appearances?: CharacterAppearanceLike[]
}

interface LocationImageLike {
  description?: string | null
  availableSlots?: string | null
  imageIndex?: number
  isSelected: boolean
  imageUrl: string | null
  imageMediaId?: string | null
}

interface LocationLike {
  name: string
  assetKind?: string | null
  images?: LocationImageLike[]
}

interface NovelProjectData {
  videoRatio?: string | null
  characters?: CharacterLike[]
  locations?: LocationLike[]
}

interface PanelLike {
  sketchImageUrl?: string | null
  sketchImageMediaId?: string | null
  characters?: string | null
  location?: string | null
  props?: string | null
  description?: string | null
  videoPrompt?: string | null
  srtSegment?: string | null
}

export interface PanelCharacterReference {
  name: string
  appearance?: string
  appearanceId?: string
  slot?: string
}

export type PanelAppearanceSelectionContext = {
  episodeNumber?: number
  sceneId?: string | null
  sourceText?: string | null
}

interface NovelDataDb {
  novelPromotionProject: {
    findUnique(args: Record<string, unknown>): Promise<NovelProjectData | null>
  }
}

export function parseJsonStringArray(value: unknown): string[] {
  return parseCharacterDescriptionValues(value)
}

export function parseImageUrls(value: string | null | undefined, fieldName: string): string[] {
  return decodeImageUrlsFromDb(value, fieldName)
}

export function clampCount(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

async function generateImageToStorage(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  options?: {
    referenceImages?: string[]
    editMode?: 'inpaint'
    maskImage?: string
    aspectRatio?: string
    size?: string
    resolution?: string
    quality?: 'low' | 'medium' | 'high'
  }
  label?: string
  materialTitle?: string
  materialOwnerName?: string
  materialSource?: FrameosMaterialSource
  materialMetadata?: Record<string, unknown>
}) {
  const source = await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.modelId,
    prompt: params.prompt,
    options: params.options,
  })

  const uploadSource = params.label
    ? await withLabelBar(source, params.label)
    : source
  const cosKey = await uploadImageSourceToCos(uploadSource, params.keyPrefix, params.targetId)
  await registerFrameosMaterial({
    userId: params.job.data.userId,
    projectId: params.job.data.projectId,
    ownerName: params.materialOwnerName,
    title: params.materialTitle || params.label || `生成图片 · ${params.targetId}`,
    type: 'image',
    source: params.materialSource || (params.job.data.projectId === 'global-asset-hub' ? 'creative' : 'production'),
    storageKey: cosKey,
    metadata: {
      taskId: params.job.data.taskId,
      targetType: params.job.data.targetType,
      targetId: params.job.data.targetId,
      prompt: params.prompt,
      ...(params.materialMetadata || {}),
    },
  })
  return cosKey
}

export async function generateCleanImageToStorage(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  options?: {
    referenceImages?: string[]
    editMode?: 'inpaint'
    maskImage?: string
    aspectRatio?: string
    size?: string
    resolution?: string
    quality?: 'low' | 'medium' | 'high'
  }
  materialTitle?: string
  materialOwnerName?: string
  materialSource?: FrameosMaterialSource
  materialMetadata?: Record<string, unknown>
}) {
  return await generateImageToStorage(params)
}

export async function generateProjectLabeledImageToStorage(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  label: string
  targetId: string
  keyPrefix: string
  options?: {
    referenceImages?: string[]
    editMode?: 'inpaint'
    maskImage?: string
    aspectRatio?: string
    size?: string
    resolution?: string
    quality?: 'low' | 'medium' | 'high'
  }
  materialTitle?: string
  materialSource?: FrameosMaterialSource
  materialMetadata?: Record<string, unknown>
}) {
  return await generateImageToStorage(params)
}

export async function resolveNovelData(projectId: string) {
  const db = prisma as unknown as NovelDataDb
  const data = await db.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: { include: { appearances: { orderBy: { appearanceIndex: 'asc' } } } },
      locations: { include: { images: { orderBy: { imageIndex: 'asc' } } } },
    },
  })

  if (!data) {
    throw new Error(`NovelPromotionProject not found: ${projectId}`)
  }

  return data
}

export function parsePanelCharacterReferences(value: string | null | undefined): PanelCharacterReference[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return { name: item }
        if (!item || typeof item !== 'object') return null
        const candidate = item as { name?: unknown; appearance?: unknown; appearanceId?: unknown; slot?: unknown }
        if (typeof candidate.name === 'string') {
          return {
            name: candidate.name,
            appearance: typeof candidate.appearance === 'string' ? candidate.appearance : undefined,
            appearanceId: typeof candidate.appearanceId === 'string' ? candidate.appearanceId : undefined,
            slot: typeof candidate.slot === 'string' ? candidate.slot : undefined,
          }
        }
        return null
      })
      .filter(Boolean) as PanelCharacterReference[]
  } catch {
    return []
  }
}

function parsePanelPropReferences(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return item.trim()
        if (!item || typeof item !== 'object') return ''
        const candidate = item as { name?: unknown }
        return typeof candidate.name === 'string' ? candidate.name.trim() : ''
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 按角色名查找角色（支持别名匹配）
 * 优先级：1. 精确全名匹配  2. 按 '/' 拆分后别名精确匹配
 * 例：引用名 "顾娘子" 可匹配角色 "顾娘子/顾盼之"
 */
export function findCharacterByName<T extends { name: string }>(characters: T[], referenceName: string): T | undefined {
  const refLower = referenceName.toLowerCase().trim()
  if (!refLower) return undefined

  // 优先级 1：精确全名匹配
  const exact = characters.find((c) => c.name.toLowerCase().trim() === refLower)
  if (exact) return exact

  // 优先级 2：别名匹配 — 按 '/' 拆分后任一别名精确匹配
  const refAliases = refLower.split('/').map((s) => s.trim()).filter(Boolean)
  for (const character of characters) {
    const charAliases = character.name.toLowerCase().split('/').map((s) => s.trim()).filter(Boolean)
    const hasOverlap = refAliases.some((refAlias) => charAliases.includes(refAlias))
    if (hasOverlap) return character
  }

  return undefined
}

export function selectPanelCharacterAppearance<T extends CharacterAppearanceLike>(
  character: { appearances?: T[] },
  reference: PanelCharacterReference,
  context: PanelAppearanceSelectionContext = {},
): T | undefined {
  const appearances = character.appearances || []
  if (appearances.length === 0) return undefined
  const ordered = appearances
    .map((appearance, originalIndex) => ({ appearance, originalIndex }))
    .sort((left, right) => (
      (left.appearance.appearanceIndex ?? left.originalIndex)
      - (right.appearance.appearanceIndex ?? right.originalIndex)
    ))
  const options = databaseAppearanceOptions(ordered.map((item) => item.appearance))
    .map((option, index) => ({ ...option, appearance: ordered[index]?.appearance }))
  const hasValidAppearanceId = Boolean(
    reference.appearanceId
    && appearances.some((appearance) => appearance.id === reference.appearanceId),
  )
  const requestedAppearance = hasValidAppearanceId ? reference.appearanceId : reference.appearance
  return selectStoryboardCharacterAppearance(options, {
    episodeNumber: context.episodeNumber ?? 0,
    sceneId: context.sceneId,
    requestedAppearance,
    sourceText: context.sourceText,
    preferScopedCoverageOverPrimaryRequest: !hasValidAppearanceId,
  })?.appearance
}

export async function collectPanelReferenceImages(
  projectData: NovelProjectData,
  panel: PanelLike,
  context: PanelAppearanceSelectionContext = {},
) {
  const refs: string[] = []

  const sketchRef = await resolveMediaRef(panel.sketchImageMediaId, panel.sketchImageUrl)
  const sketch = toSignedUrlIfCos(mediaUrlFromRef(sketchRef, panel.sketchImageUrl), 3600)
  if (sketch) refs.push(sketch)

  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  for (const item of panelCharacters) {
    const character = findCharacterByName(projectData.characters || [], item.name)
    if (!character) continue

    const appearance = selectPanelCharacterAppearance(character, item, {
      ...context,
      sourceText: context.sourceText || [panel.srtSegment, panel.description, panel.videoPrompt].filter(Boolean).join('\n'),
    })

    if (!appearance) continue

    const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
    const selectedIndex = appearance.selectedIndex
    const selectedUrl = selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
    const mediaRef = await resolveMediaRef(appearance.imageMediaId, selectedUrl || imageUrls[0] || appearance.imageUrl)
    const key = mediaUrlFromRef(mediaRef, selectedUrl || imageUrls[0] || appearance.imageUrl)
    const signed = toSignedUrlIfCos(key, 3600)
    if (signed) refs.push(signed)
  }

  if (panel.location) {
    const location = (projectData.locations || []).find((loc) => (
      loc.assetKind !== 'prop'
      && loc.name.toLowerCase() === panel.location!.toLowerCase()
    ))
    if (location) {
      const images = location.images || []
      const selected = images.find((img) => img.isSelected) || images[0]
      const mediaRef = await resolveMediaRef(selected?.imageMediaId, selected?.imageUrl)
      const signed = toSignedUrlIfCos(mediaUrlFromRef(mediaRef, selected?.imageUrl), 3600)
      if (signed) refs.push(signed)
    }
  }

  const explicitProps = parsePanelPropReferences(panel.props)
  const visibleText = [
    panel.description,
    panel.videoPrompt,
    panel.srtSegment,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('\n')
  const propNames = new Set(explicitProps.map((item) => item.toLowerCase()))
  for (const location of projectData.locations || []) {
    if (location.assetKind !== 'prop') continue
    const lowerName = location.name.toLowerCase()
    if (!propNames.has(lowerName) && !visibleText.includes(location.name)) continue
    const images = location.images || []
    const selected = images.find((img) => img.isSelected) || images[0]
    const mediaRef = await resolveMediaRef(selected?.imageMediaId, selected?.imageUrl)
    const signed = toSignedUrlIfCos(mediaUrlFromRef(mediaRef, selected?.imageUrl), 3600)
    if (signed) refs.push(signed)
  }

  return refs
}
