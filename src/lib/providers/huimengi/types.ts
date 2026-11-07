export type HuimengiModelModality = 'image' | 'video'

export type HuimengiAudioParam = 'generate_audio' | 'audio'

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
  supportsReferenceVideos?: boolean
  supportsReferenceAudios?: boolean
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
