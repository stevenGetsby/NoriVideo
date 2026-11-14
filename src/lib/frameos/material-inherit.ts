import { frameosAssetCategoryFromMetadata } from './material-category'

export const INHERITED_FROM_KEY = 'inheritedFrom'
export const MAX_INHERITED_MATERIALS = 200

export interface InheritedMaterialSource {
  projectId: string
  projectName: string
  materialId: string
}

export type MaterialOrigin = 'generated' | 'uploaded' | 'inherited'

export const MATERIAL_ORIGIN_LABELS: Record<MaterialOrigin, string> = {
  generated: '生成',
  uploaded: '上传',
  inherited: '继承',
}

// A copy is a standalone asset of the new 作品, so everything that ties the
// source row to its own task, canvas node, project character or retirement
// state must not survive. `seedancePrivateAsset` is the real-person asset the
// video provider registered under the source project's asset group; reusing it
// would hand another project's private asset id to this one.
const LINK_METADATA_KEYS = [
  'taskId',
  'retryOf',
  'originId',
  'targetType',
  'targetId',
  'canvasId',
  'canvasNodeId',
  'sourceNodeId',
  'characterId',
  'characterName',
  'voiceMaterialId',
  'seedancePrivateAsset',
  'supersededByMaterialId',
  'replacesMaterialId',
  INHERITED_FROM_KEY,
] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createdTime(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

export function inheritedMaterialSource(metadata: unknown): InheritedMaterialSource | null {
  const marker = record(record(metadata)[INHERITED_FROM_KEY])
  const projectId = text(marker.projectId)
  const materialId = text(marker.materialId)
  if (!projectId || !materialId) return null
  return { projectId, materialId, projectName: text(marker.projectName) || '其他作品' }
}

export function isInheritedMaterial(material: { metadata?: unknown }): boolean {
  return inheritedMaterialSource(material.metadata) !== null
}

/**
 * Uploaded files and copies inherited from another 作品 are rows of the
 * library itself, so people may rename, replace and delete them. A generated
 * result belongs to the workflow that produced it and is managed there.
 */
export function isUserManagedMaterial(material: { source: string; metadata?: unknown }): boolean {
  return material.source === 'upload' || isInheritedMaterial(material)
}

export function materialOrigin(material: { source: string; metadata?: unknown }): MaterialOrigin {
  if (isInheritedMaterial(material)) return 'inherited'
  return material.source === 'upload' ? 'uploaded' : 'generated'
}

/**
 * Copying a material into a 作品 of the same 项目 leaves the original and the
 * copy side by side in the project-wide view. Per lineage (copy → the row it
 * was copied from → …) keep one card: the newest row living in the current
 * 作品, or the original when the current 作品 holds none. Rows in `pinnedIds`
 * (already chosen by the user) always stay and win over that choice.
 */
export function collapseInheritedDuplicates<
  T extends { id: string; projectId: string; createdAt: string; metadata?: unknown },
>(items: readonly T[], currentProjectId: string, pinnedIds?: ReadonlySet<string>): T[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const parentOf = (item: T): T | null => {
    const source = inheritedMaterialSource(item.metadata)
    const parent = source ? byId.get(source.materialId) : undefined
    return parent && parent.id !== item.id ? parent : null
  }
  const rootIdOf = (item: T): string => {
    const seen = new Set<string>([item.id])
    let current = item
    for (let parent = parentOf(current); parent && !seen.has(parent.id); parent = parentOf(current)) {
      seen.add(parent.id)
      current = parent
    }
    return current.id
  }

  const lineages = new Map<string, T[]>()
  for (const item of items) {
    const rootId = rootIdOf(item)
    const lineage = lineages.get(rootId)
    if (lineage) lineage.push(item)
    else lineages.set(rootId, [item])
  }

  const kept = new Set<string>()
  for (const [rootId, lineage] of lineages) {
    const pinned = pinnedIds ? lineage.filter((item) => pinnedIds.has(item.id)) : []
    if (pinned.length > 0) {
      for (const item of pinned) kept.add(item.id)
      continue
    }
    const inCurrent = lineage.filter((item) => item.projectId === currentProjectId)
    if (inCurrent.length === 0) {
      kept.add(rootId)
      continue
    }
    kept.add(inCurrent.reduce((best, item) => (
      createdTime(item.createdAt) > createdTime(best.createdAt) ? item : best
    )).id)
  }
  return items.filter((item) => kept.has(item.id))
}

export function inheritedMaterialMetadata(
  sourceMetadata: unknown,
  source: InheritedMaterialSource,
  voiceMaterialId: string | null,
): Record<string, unknown> {
  const next = { ...record(sourceMetadata) }
  // The category may only be implied by `originType`; pin it before the copy
  // can lose any hint of where it came from.
  const assetCategory = frameosAssetCategoryFromMetadata(sourceMetadata)
  for (const key of LINK_METADATA_KEYS) delete next[key]
  return {
    ...next,
    assetCategory,
    ...(voiceMaterialId ? { voiceMaterialId } : {}),
    [INHERITED_FROM_KEY]: {
      projectId: source.projectId,
      projectName: source.projectName,
      materialId: source.materialId,
    },
  }
}
