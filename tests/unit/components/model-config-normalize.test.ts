import { describe, expect, it } from 'vitest'
import { normalizeVideoDraftForModel } from '@/components/batch-workflow/model-config-normalize'

const baseDraft = {
  videoAspectRatio: '16:9',
  videoResolution: '1080p',
  videoDurationSeconds: 12,
  videoInputMode: 'firstlastframe',
  videoGenerateAudio: true,
} as const

describe('normalizeVideoDraftForModel', () => {
  it('keeps every field when the new model supports them', () => {
    const next = normalizeVideoDraftForModel(baseDraft, {
      resolutionOptions: ['720p', '1080p'],
      aspectRatioOptions: ['16:9', '9:16'],
      durationOptions: [4, 8, 12],
      firstLastFrame: true,
      supportGenerateAudio: true,
    })
    expect(next).toEqual(baseDraft)
  })

  it('normalizes aspect ratio, resolution and duration for a weaker model', () => {
    const next = normalizeVideoDraftForModel(baseDraft, {
      resolutionOptions: ['720p'],
      aspectRatioOptions: ['9:16', '1:1'],
      durationOptions: [4, 6, 8],
      firstLastFrame: false,
      supportGenerateAudio: false,
    })
    expect(next.videoResolution).toBe('720p')
    expect(next.videoAspectRatio).toBe('9:16')
    expect(next.videoDurationSeconds).toBe(8)
    expect(next.videoInputMode).toBe('image')
    expect(next.videoGenerateAudio).toBe(false)
  })

  it('picks the closest supported duration instead of clamping to a range', () => {
    const next = normalizeVideoDraftForModel({ ...baseDraft, videoDurationSeconds: 7 }, {
      resolutionOptions: [],
      aspectRatioOptions: [],
      durationOptions: [4, 10],
      firstLastFrame: true,
      supportGenerateAudio: true,
    })
    expect(next.videoDurationSeconds).toBe(4)
  })

  it('uses conservative defaults for unknown capabilities', () => {
    const next = normalizeVideoDraftForModel(baseDraft, {
      resolutionOptions: [],
      aspectRatioOptions: [],
      durationOptions: [],
      firstLastFrame: false,
      supportGenerateAudio: false,
    })
    expect(next.videoResolution).toBe('1080p')
    expect(next.videoAspectRatio).toBe('16:9')
    expect(next.videoInputMode).toBe('image')
    expect(next.videoGenerateAudio).toBe(false)
  })

  it('clamps out-of-range durations into the safe 4-15s window when options are unknown', () => {
    const next = normalizeVideoDraftForModel({ ...baseDraft, videoDurationSeconds: 40 }, {
      resolutionOptions: [],
      aspectRatioOptions: [],
      durationOptions: [],
      firstLastFrame: true,
      supportGenerateAudio: true,
    })
    expect(next.videoDurationSeconds).toBe(15)
  })
})
