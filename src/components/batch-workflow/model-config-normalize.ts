import type { VideoAspectRatio, VideoInputMode } from '@/lib/batch-workflow/types'

export interface VideoDraftSlice {
  videoAspectRatio: VideoAspectRatio
  videoResolution: string
  videoDurationSeconds: number
  videoInputMode: VideoInputMode
  videoGenerateAudio: boolean
}

export interface VideoModelCapabilities {
  resolutionOptions: string[]
  aspectRatioOptions: string[]
  durationOptions: number[]
  firstLastFrame: boolean
  supportGenerateAudio: boolean
}

export function normalizeVideoDraftForModel(
  prev: VideoDraftSlice,
  caps: VideoModelCapabilities,
): VideoDraftSlice {
  const { resolutionOptions, aspectRatioOptions, durationOptions } = caps
  const videoResolution = resolutionOptions.length > 0 && !resolutionOptions.includes(prev.videoResolution)
    ? (resolutionOptions.includes('720p') ? '720p' : resolutionOptions[0])
    : prev.videoResolution
  const videoAspectRatio = aspectRatioOptions.length > 0 && !aspectRatioOptions.includes(prev.videoAspectRatio)
    ? aspectRatioOptions[0] as VideoAspectRatio
    : prev.videoAspectRatio
  const videoDurationSeconds = durationOptions.length > 0
    ? durationOptions.reduce((best, candidate) => (
        Math.abs(candidate - prev.videoDurationSeconds) < Math.abs(best - prev.videoDurationSeconds) ? candidate : best
      ), durationOptions[0])
    : Math.max(4, Math.min(15, prev.videoDurationSeconds))
  const videoInputMode: VideoInputMode = !caps.firstLastFrame && prev.videoInputMode === 'firstlastframe'
    ? 'image'
    : prev.videoInputMode
  return {
    videoAspectRatio,
    videoResolution,
    videoDurationSeconds,
    videoInputMode,
    videoGenerateAudio: caps.supportGenerateAudio ? prev.videoGenerateAudio : false,
  }
}
