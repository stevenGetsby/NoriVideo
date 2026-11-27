export const MATERIAL_NODE_SYNC_METADATA_KEYS = ['assetCategory', 'characterId', 'characterName', 'voiceMaterialId'] as const

export type MaterialNodeSyncPatch = {
  title?: string
  metadata?: Record<string, string | null>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function replacesMaterialId(metadata: unknown): string | null {
  return text(record(metadata).replacesMaterialId) || null
}

/**
 * What a canvas node should show for a library material. `null` in `metadata`
 * means "the library no longer has this key", so the node drops it too.
 */
export function materialNodeSyncPatch(
  material: { title: string | null; metadata: unknown },
  include: { title: boolean; metadata: boolean },
): MaterialNodeSyncPatch | null {
  const patch: MaterialNodeSyncPatch = {}
  const title = typeof material.title === 'string' ? material.title.replace(/\s+/g, ' ').trim() : ''
  if (include.title && title) patch.title = title
  if (include.metadata) {
    const source = record(material.metadata)
    const metadata: Record<string, string | null> = {}
    for (const key of MATERIAL_NODE_SYNC_METADATA_KEYS) metadata[key] = text(source[key]) || null
    // A missing category can be implied by `originType`; there is nothing to assert then.
    if (!metadata.assetCategory) delete metadata.assetCategory
    patch.metadata = metadata
  }
  return patch.title !== undefined || patch.metadata ? patch : null
}

/** Returns the node's next `data`, or `null` when it already matches the patch. */
export function applyMaterialNodeSyncPatch(data: unknown, patch: MaterialNodeSyncPatch): Record<string, unknown> | null {
  const current = record(data)
  const next: Record<string, unknown> = { ...current }
  let changed = false
  if (patch.title !== undefined && current.title !== patch.title) {
    next.title = patch.title
    changed = true
  }
  if (patch.metadata) {
    const metadata = { ...record(current.sourceMetadata) }
    let metadataChanged = false
    for (const [key, value] of Object.entries(patch.metadata)) {
      if (value === null) {
        if (key in metadata) {
          delete metadata[key]
          metadataChanged = true
        }
      } else if (metadata[key] !== value) {
        metadata[key] = value
        metadataChanged = true
      }
    }
    if (metadataChanged) {
      next.sourceMetadata = metadata
      changed = true
    }
  }
  return changed ? next : null
}
