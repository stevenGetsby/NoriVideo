export type TggModelModality = 'video'
export type TggReferenceFormat = 'categorized' | 'files' | 'files-named'

export interface TggModelDefinition {
  /** Must match the id returned by GET /v1/models exactly. */
  modelId: string
  name: string
  modality: TggModelModality
  referenceFormat: TggReferenceFormat
  supportsImages: boolean
  supportsVideos: boolean
  supportsAudios: boolean
  maxImages: number
  maxVideos: number
  maxAudios: number
  /** false → never send `resolution`. */
  supportsResolution: boolean
  /** false → only `ratio` is sent, never `aspect_ratio`. */
  supportsAspectRatioField: boolean
  supportsFirstLastFrame: boolean
  /** Empty means unverified → the model is not selectable. */
  durationOptions: number[]
  ratios: string[]
  resolutions: string[]
}

export interface TggGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  [key: string]: unknown
}
