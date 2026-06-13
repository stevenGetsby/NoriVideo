import { describe, expect, it } from 'vitest'
import type { ModelCapabilities, UnifiedModelType } from '@/lib/model-config-contract'
import { resolveGenerationOptionsForModel } from '@/lib/model-capabilities/lookup'

describe('model-capabilities/lookup - video generation defaults', () => {
  const modelType: UnifiedModelType = 'video'
  const modelKey = 'ark::doubao-seedance-1-0-lite-i2v-250428'

  const capabilities: ModelCapabilities = {
    video: {
      generationModeOptions: ['normal', 'firstlastframe'],
      durationOptions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      resolutionOptions: ['480p', '720p', '1080p'],
      generateAudioOptions: [false, true],
      firstlastframe: true,
      supportGenerateAudio: true,
    },
  }

  it('auto-fills required video capability fields for agent execution', () => {
    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      generationMode: 'normal',
      duration: 5,
      resolution: '720p',
      generateAudio: false,
    })
  })

  it('keeps explicit project or runtime selections', () => {
    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      runtimeSelections: {
        duration: 8,
        resolution: '1080p',
      },
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      generationMode: 'normal',
      duration: 8,
      resolution: '1080p',
      generateAudio: false,
    })
  })
})
