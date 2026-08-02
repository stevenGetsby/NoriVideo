/**
 * Version of the serialized infinite-canvas document contract.
 *
 * A missing version is treated as the legacy v0 shape by readers, then
 * normalized to this version. Writers must always emit `schema_version` so a
 * future reader can migrate (or reject) the document deterministically.
 */
export const CANVAS_DOCUMENT_SCHEMA_VERSION = 1 as const

export function isCompatibleCanvasDocumentSchemaVersion(value: unknown): boolean {
  return value === undefined || value === null || value === CANVAS_DOCUMENT_SCHEMA_VERSION
}
