import { INHERITED_FROM_KEY } from './material-inherit'

const SUPERSEDED_KEY = 'supersededByMaterialId'

// Describes the file itself, so a replacement row must not inherit it. The
// inheritance marker goes too: a replaced copy is a fresh upload, no longer a
// copy of the other 作品's picture.
const FILE_METADATA_KEYS = [
  'originalName',
  'mimeType',
  'sizeBytes',
  'width',
  'height',
  'durationSeconds',
  'characterId',
  'characterName',
  SUPERSEDED_KEY,
  'replacesMaterialId',
  INHERITED_FROM_KEY,
] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** A retired row stays alive for canvases that still point at it, but is hidden from every library. */
export function supersededByMaterialId(metadata: unknown): string | null {
  const value = record(metadata)[SUPERSEDED_KEY]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function withSupersededMaterial(metadata: unknown, replacementId: string): Record<string, unknown> {
  return { ...record(metadata), [SUPERSEDED_KEY]: replacementId }
}

export function replacementMaterialMetadata(
  previousMetadata: unknown,
  previousId: string,
  file: { originalName: string; mimeType: string; sizeBytes: number; width: number; height: number },
  voiceMaterialId: string | null,
): Record<string, unknown> {
  const next = { ...record(previousMetadata) }
  for (const key of FILE_METADATA_KEYS) delete next[key]
  delete next.voiceMaterialId
  return {
    ...next,
    ...(voiceMaterialId ? { voiceMaterialId } : {}),
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    replacesMaterialId: previousId,
  }
}
