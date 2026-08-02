export const PROJECT_STYLE_REFERENCE_FIELD = 'styleReferenceFiles'
export const PROJECT_STYLE_REFERENCE_MAX_COUNT = 4
export const PROJECT_STYLE_REFERENCE_MAX_FILE_BYTES = 200 * 1024 * 1024
export const PROJECT_STYLE_REFERENCE_MAX_VIDEO_SECONDS = 60

export type ProjectStyleReferenceKind = 'image' | 'video'

export interface ProjectStyleReferenceDraftFile {
  id: string
  file: File
  kind: ProjectStyleReferenceKind
  durationSeconds: number | null
}

export interface ProjectStyleReferenceValue {
  mediaId: string
  publicId: string
  url: string
  storageKey: string
  kind: ProjectStyleReferenceKind
  name: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  order: number
}

export function projectStyleReferenceExtension(fileName: string): string {
  return fileName.split('.').pop()?.trim().toLowerCase() || ''
}

export function projectStyleReferenceKind(
  file: Pick<File, 'name' | 'type'>,
): ProjectStyleReferenceKind | null {
  const extension = projectStyleReferenceExtension(file.name)
  if (extension === 'jpg' || extension === 'jpeg' || extension === 'png') return 'image'
  if (extension === 'mp4' || extension === 'mov') return 'video'
  return null
}

