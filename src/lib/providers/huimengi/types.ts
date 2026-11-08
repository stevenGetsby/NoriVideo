export type HuimengiModelModality = 'image' | 'video'

export type HuimengiAudioParam = 'generate_audio' | 'audio'

export type HuimengiFirstFrameParam = 'image_url' | 'first_frame_image'

export interface HuimengiModelDefinition {
  modelId: string
  name: string
  modality: HuimengiModelModality
  /** The public API declares resolution enums in mixed case; keep both exact forms. */
  resolutionCase: 'lower' | 'upper'
  maxReferenceImages: number
  supportsFirstLastFrame: boolean
  supportsGenerateAudio: boolean
  audioParam?: HuimengiAudioParam
  /** Seedance 2.x documents a first-frame-only field instead of image_url. */
  firstFrameParam?: HuimengiFirstFrameParam
  supportsReferenceVideos?: boolean
  supportsReferenceAudios?: boolean
  maxReferenceVideos?: number
  maxReferenceAudios?: number
  supportsOutputFormat?: boolean
  supportsWatermark?: boolean
  supportsPromptExtend?: boolean
  supportsCameraFixed?: boolean
  supportsReturnLastFrame?: boolean
}

export interface HuimengiGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  [key: string]: unknown
}
