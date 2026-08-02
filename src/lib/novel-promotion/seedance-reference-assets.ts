import { getPanelAssetUsage } from './panel-asset-usage'
import type { PanelCharacterAssetRef } from './panel-asset-usage'
import {
  databaseAppearanceOptions,
  selectStoryboardCharacterAppearance,
} from './storyboard-character-appearance'

export type SeedanceReferenceAssetKind = 'character' | 'location' | 'prop'

export interface PanelReferenceSourceAsset {
  name: string
  summary?: string | null
  imageUrl?: string | null
  imageUrls?: string | string[] | null
  selectedIndex?: number | null
  seedanceAssetUri?: string | null
  seedanceAssetStatus?: string | null
  assetKind?: string | null
  appearances?: Array<{
    id?: string | null
    appearanceIndex?: number | null
    changeReason?: string | null
    descriptions?: string | null
    imageUrl?: string | null
    imageUrls?: string | string[] | null
    selectedIndex?: number | null
    seedanceAssetUri?: string | null
    seedanceAssetStatus?: string | null
  }>
  selectedImage?: {
    imageUrl?: string | null
  } | null
  images?: Array<{
    imageUrl?: string | null
    isSelected?: boolean | null
  }>
}

export interface PanelSeedanceReferenceAsset {
  kind: SeedanceReferenceAssetKind
  name: string
  imageUrl: string
  role: 'reference_image'
  materialId?: string
  appearance?: string
  appearanceId?: string
}

export interface SeedanceReferenceImageContentItem {
  type: 'image_url'
  image_url: { url: string }
  role: 'reference_image'
}

export const PANEL_SEEDANCE_REFERENCE_ASSETS_KEY = '_seedanceReferenceAssets'

interface PanelReferenceInput {
  panel: {
    characters?: unknown
    location?: unknown
    props?: unknown
    videoPrompt?: string | null
  }
  characterAssets?: PanelReferenceSourceAsset[]
  locationAssets?: PanelReferenceSourceAsset[]
  maxCharacters?: number
  maxLocations?: number
  maxProps?: number
  episodeNumber?: number
  sceneId?: string | null
}

interface StoryboardSegmentReferenceInput {
  segment: {
    characters?: Array<{ name: string; appearance?: string; appearanceId?: string }>
    location?: string | null
    props?: Array<{ name: string }>
  }
  characterAssets?: PanelReferenceSourceAsset[]
  locationAssets?: PanelReferenceSourceAsset[]
  maxCharacters?: number
  maxLocations?: number
  maxProps?: number
  episodeNumber?: number
  sceneId?: string | null
}

function compact(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMaybeJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (isRecord(value)) return value
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function splitAssetNames(value: string): string[] {
  return value
    .replace(/[。.!?！？]+$/u, '')
    .split(/[、,，/]/)
    .map((item) => compact(item))
    .filter(Boolean)
    .filter((item) => !item.startsWith('无独立'))
}

function normalizeMatchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function namesMatch(needed: string, assetName: string): boolean {
  const left = normalizeMatchName(needed)
  const right = normalizeMatchName(assetName)
  if (!left || !right) return false
  if (left === right) return true
  if (left.length < 4 || right.length < 4) return false
  return left.includes(right) || right.includes(left)
}

function parseImageUrls(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(compact).filter(Boolean)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.map((item) => compact(String(item))).filter(Boolean)
  } catch {
    // Keep supporting legacy comma-separated imageUrl lists.
  }
  return splitAssetNames(trimmed)
}

function pickImageUrl(asset: PanelReferenceSourceAsset, preferredAppearance?: string | null): string | null {
  const preferred = normalizeMatchName(compact(preferredAppearance))
  if (preferred && asset.appearances?.length) {
    const appearance = asset.appearances.find((item) => {
      const id = normalizeMatchName(compact(item.id))
      const label = normalizeMatchName(compact(item.changeReason))
      return preferred === id || preferred === label
    })
    if (appearance) {
      if (appearance.seedanceAssetStatus === 'Active') {
        const seedanceAssetUri = compact(appearance.seedanceAssetUri)
        if (seedanceAssetUri.startsWith('asset://')) return seedanceAssetUri
      }
      const resolved = pickImageUrl({
        name: asset.name,
        imageUrl: appearance.imageUrl,
        imageUrls: appearance.imageUrls,
        selectedIndex: appearance.selectedIndex,
        seedanceAssetUri: appearance.seedanceAssetUri,
        seedanceAssetStatus: appearance.seedanceAssetStatus,
      })
      // A requested appearance is a strict identity binding. Falling through
      // to another appearance would silently attach the wrong face/costume.
      return resolved
    }
  }
  if (asset.seedanceAssetStatus === 'Active') {
    const seedanceAssetUri = compact(asset.seedanceAssetUri)
    if (seedanceAssetUri.startsWith('asset://')) return seedanceAssetUri
  }

  const direct = compact(asset.imageUrl)
  if (direct) return direct

  const urls = parseImageUrls(asset.imageUrls)
  if (urls.length > 0) {
    const selectedIndex = typeof asset.selectedIndex === 'number' ? asset.selectedIndex : 0
    return urls[Math.max(0, Math.min(selectedIndex, urls.length - 1))] || urls[0] || null
  }

  const selectedImageUrl = compact(asset.selectedImage?.imageUrl)
  if (selectedImageUrl) return selectedImageUrl

  const selectedNestedImage = asset.images?.find((image) => image.isSelected && compact(image.imageUrl))
    ?? asset.images?.find((image) => compact(image.imageUrl))
  const nestedImageUrl = compact(selectedNestedImage?.imageUrl)
  if (nestedImageUrl) return nestedImageUrl

  const appearance = asset.appearances?.find((item) => compact(item.imageUrl) || parseImageUrls(item.imageUrls).length > 0)
  if (!appearance) return null
  if (appearance.seedanceAssetStatus === 'Active') {
    const seedanceAssetUri = compact(appearance.seedanceAssetUri)
    if (seedanceAssetUri.startsWith('asset://')) return seedanceAssetUri
  }
  return pickImageUrl({
    name: asset.name,
    imageUrl: appearance.imageUrl,
    imageUrls: appearance.imageUrls,
    selectedIndex: appearance.selectedIndex,
    seedanceAssetUri: appearance.seedanceAssetUri,
    seedanceAssetStatus: appearance.seedanceAssetStatus,
  })
}

function findCharacterAssets(
  refs: PanelCharacterAssetRef[],
  assets: PanelReferenceSourceAsset[],
  maxCount: number,
  context: {
    episodeNumber?: number
    sceneId?: string | null
    sourceText?: string | null
  },
): PanelSeedanceReferenceAsset[] {
  const result: PanelSeedanceReferenceAsset[] = []
  const seenUrls = new Set<string>()
  for (const ref of refs) {
    const matched = assets.find((asset) => namesMatch(ref.name, asset.name))
    if (!matched) continue
    const hasValidAppearanceId = Boolean(
      ref.appearanceId
      && matched.appearances?.some((appearance) => compact(appearance.id) === compact(ref.appearanceId)),
    )
    const requestedAppearance = hasValidAppearanceId ? ref.appearanceId : ref.appearance
    const selected = matched.appearances?.length
      ? selectStoryboardCharacterAppearance(databaseAppearanceOptions(matched.appearances), {
        episodeNumber: context.episodeNumber ?? 0,
        sceneId: context.sceneId,
        requestedAppearance,
        sourceText: context.sourceText,
        preferScopedCoverageOverPrimaryRequest: !hasValidAppearanceId,
      })
      : null
    const selectedHasStableIdentity = Boolean(
      selected?.id
      || matched.appearances?.some((appearance) => compact(appearance.changeReason) === selected?.label),
    )
    const selectedAppearance = selectedHasStableIdentity ? selected?.label : ref.appearance
    const selectedAppearanceId = selected?.id || ref.appearanceId
    const imageUrl = pickImageUrl(matched, selectedAppearanceId || selectedAppearance)
    if (!imageUrl || seenUrls.has(imageUrl)) continue
    seenUrls.add(imageUrl)
    result.push({
      kind: 'character',
      name: matched.name,
      imageUrl,
      role: 'reference_image',
      ...(selectedAppearance ? { appearance: selectedAppearance } : {}),
      ...(selectedAppearanceId ? { appearanceId: selectedAppearanceId } : {}),
    })
    if (result.length >= maxCount) break
  }
  return result
}

function normalizeReferenceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

export function replacePanelSeedanceReferenceAssetForCharacter(
  actingNotes: unknown,
  input: {
    characterName: string
    appearanceId: string
    assetUri: string
  },
): string | null {
  const record = parseMaybeJsonRecord(actingNotes)
  const raw = record[PANEL_SEEDANCE_REFERENCE_ASSETS_KEY]
  if (!Array.isArray(raw)) return Object.keys(record).length > 0 ? JSON.stringify(record) : null

  const targetName = normalizeReferenceName(input.characterName)
  const targetAppearanceId = normalizeMatchName(input.appearanceId)
  let changed = false
  const next = raw.map((item) => {
    if (!isRecord(item)) return item
    const kind = item.kind
    const name = compact(typeof item.name === 'string' ? item.name : '')
    const appearanceId = typeof item.appearanceId === 'string' ? normalizeMatchName(item.appearanceId) : ''
    if (
      kind !== 'character'
      || normalizeReferenceName(name) !== targetName
      || !appearanceId
      || appearanceId !== targetAppearanceId
    ) return item
    changed = true
    return {
      ...item,
      imageUrl: input.assetUri,
      role: 'reference_image',
    }
  })

  if (!changed) return Object.keys(record).length > 0 ? JSON.stringify(record) : null
  record[PANEL_SEEDANCE_REFERENCE_ASSETS_KEY] = next
  return JSON.stringify(record)
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map(compact).filter(Boolean)) {
    const key = normalizeMatchName(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function findAssetsByNames(
  kind: SeedanceReferenceAssetKind,
  names: string[],
  assets: PanelReferenceSourceAsset[],
  maxCount: number,
): PanelSeedanceReferenceAsset[] {
  const result: PanelSeedanceReferenceAsset[] = []
  const seenUrls = new Set<string>()
  const remainingAssets = assets.filter((asset) => compact(asset.name))

  for (const name of names) {
    const matched = remainingAssets.find((asset) => namesMatch(name, asset.name))
    if (!matched) continue
    const imageUrl = pickImageUrl(matched)
    if (!imageUrl || seenUrls.has(imageUrl)) continue
    seenUrls.add(imageUrl)
    result.push({
      kind,
      name: matched.name,
      imageUrl,
      role: 'reference_image',
    })
    if (result.length >= maxCount) break
  }

  return result
}

export function buildPanelSeedanceReferenceAssets(input: PanelReferenceInput): PanelSeedanceReferenceAsset[] {
  const usage = getPanelAssetUsage(input.panel)
  const locationAssets = input.locationAssets || []
  const realLocationAssets = locationAssets.filter((asset) => (asset.assetKind || 'location') !== 'prop')
  const propAssets = locationAssets.filter((asset) => asset.assetKind === 'prop')
  const locationNames = uniqueNames([
    ...usage.locations,
  ])
  const propNames = uniqueNames([
    ...usage.props,
  ])

  return [
    ...findCharacterAssets(usage.characters, input.characterAssets || [], input.maxCharacters ?? 4, {
      episodeNumber: input.episodeNumber,
      sceneId: input.sceneId,
      sourceText: input.panel.videoPrompt,
    }),
    ...findAssetsByNames('location', locationNames, realLocationAssets, input.maxLocations ?? 1),
    ...findAssetsByNames('prop', propNames, propAssets, input.maxProps ?? 3),
  ]
}

export function buildStoryboardSegmentSeedanceReferenceAssets(
  input: StoryboardSegmentReferenceInput,
): PanelSeedanceReferenceAsset[] {
  return buildPanelSeedanceReferenceAssets({
    panel: {
      characters: input.segment.characters || [],
      location: input.segment.location || '',
      props: input.segment.props?.map((prop) => prop.name) || [],
    },
    characterAssets: input.characterAssets,
    locationAssets: input.locationAssets,
    maxCharacters: input.maxCharacters,
    maxLocations: input.maxLocations,
    maxProps: input.maxProps,
    episodeNumber: input.episodeNumber,
    sceneId: input.sceneId,
  })
}

/**
 * Replaces automatically generated bindings with the latest contextual
 * mapping while retaining images the user explicitly added from Materials.
 */
export function mergePanelSeedanceReferenceAssets(
  generated: PanelSeedanceReferenceAsset[],
  persisted: PanelSeedanceReferenceAsset[],
): PanelSeedanceReferenceAsset[] {
  const result = [...generated]
  const seen = new Set(result.map((asset) => asset.imageUrl.trim()).filter(Boolean))
  const generatedKeys = new Set(result.map((asset) => `${asset.kind}:${normalizeReferenceName(asset.name)}`))
  for (const asset of persisted) {
    const key = `${asset.kind}:${normalizeReferenceName(asset.name)}`
    // Contextual bindings replace stale automatic refs with the same logical
    // asset. Keep explicit Materials, and retain persisted refs only when the
    // current project data cannot rebuild that asset at all.
    if (!asset.materialId && generatedKeys.has(key)) continue
    const imageUrl = asset.imageUrl.trim()
    if (!imageUrl || seen.has(imageUrl)) continue
    seen.add(imageUrl)
    result.push(asset)
  }
  return result
}

export function buildSeedanceReferenceImageContentItems(
  assets: PanelSeedanceReferenceAsset[],
): SeedanceReferenceImageContentItem[] {
  return assets.map((asset) => ({
    type: 'image_url',
    image_url: { url: asset.imageUrl },
    role: 'reference_image',
  }))
}

export function readPanelSeedanceReferenceAssetsFromActingNotes(
  actingNotes: unknown,
): PanelSeedanceReferenceAsset[] {
  const record = parseMaybeJsonRecord(actingNotes)
  const raw = record[PANEL_SEEDANCE_REFERENCE_ASSETS_KEY]
  if (!Array.isArray(raw)) return []

  const result: PanelSeedanceReferenceAsset[] = []
  const seenUrls = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const kind = item.kind
    const name = compact(typeof item.name === 'string' ? item.name : '')
    const imageUrl = compact(typeof item.imageUrl === 'string' ? item.imageUrl : '')
    if (
      (kind !== 'character' && kind !== 'location' && kind !== 'prop')
      || !name
      || !imageUrl
      || seenUrls.has(imageUrl)
    ) {
      continue
    }
    seenUrls.add(imageUrl)
    result.push({
      kind,
      name,
      imageUrl,
      role: 'reference_image',
      ...(typeof item.materialId === 'string' && item.materialId.trim()
        ? { materialId: item.materialId.trim() }
        : {}),
      ...(typeof item.appearance === 'string' && item.appearance.trim()
        ? { appearance: item.appearance.trim() }
        : {}),
      ...(typeof item.appearanceId === 'string' && item.appearanceId.trim()
        ? { appearanceId: item.appearanceId.trim() }
        : {}),
    })
  }
  return result
}

export function writePanelSeedanceReferenceAssetsToActingNotes(
  actingNotes: unknown,
  assets: PanelSeedanceReferenceAsset[],
): string | null {
  const record = parseMaybeJsonRecord(actingNotes)
  if (assets.length === 0) {
    delete record[PANEL_SEEDANCE_REFERENCE_ASSETS_KEY]
  } else {
    record[PANEL_SEEDANCE_REFERENCE_ASSETS_KEY] = assets.map((asset) => ({
      kind: asset.kind,
      name: asset.name,
      imageUrl: asset.imageUrl,
      role: asset.role,
      ...(asset.materialId ? { materialId: asset.materialId } : {}),
      ...(asset.appearance ? { appearance: asset.appearance } : {}),
      ...(asset.appearanceId ? { appearanceId: asset.appearanceId } : {}),
    }))
  }
  return Object.keys(record).length > 0 ? JSON.stringify(record) : null
}
