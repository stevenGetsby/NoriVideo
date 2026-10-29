import { describe, expect, it } from 'vitest'
import {
  PRESET_MODELS,
  encodeModelKey,
  isPresetComingSoonModel,
  isPresetComingSoonModelKey,
} from '@/app/[locale]/profile/components/api-config/types'

describe('api-config preset coming soon', () => {
  it('does not advertise Google-only image presets outside the supported provider registry', () => {
    const model = PRESET_MODELS.find(
      (entry) => entry.provider === 'google' && entry.modelId === 'gemini-3.1-flash-image-preview',
    )
    expect(model).toBeUndefined()
  })

  it('does not expose retired Ark media presets', () => {
    const modelIds = PRESET_MODELS
      .filter((entry) => entry.provider === 'ark' && entry.type === 'video')
      .map((entry) => entry.modelId)

    expect(modelIds).toEqual([])
  })

  it('does not mark live preset models as coming soon', () => {
    const modelKey = encodeModelKey('kuaizi', 'doubao-seedance-2-0-260128')
    expect(isPresetComingSoonModel('kuaizi', 'doubao-seedance-2-0-260128')).toBe(false)
    expect(isPresetComingSoonModelKey(modelKey)).toBe(false)
  })

  it('does not mark normal preset models as coming soon', () => {
    const modelKey = encodeModelKey('kuaizi', 'doubao-seedance-2-0-fast-260128')
    expect(isPresetComingSoonModel('kuaizi', 'doubao-seedance-2-0-fast-260128')).toBe(false)
    expect(isPresetComingSoonModelKey(modelKey)).toBe(false)
  })

  it('keeps existing live preset models non-coming-soon', () => {
    const modelKey = encodeModelKey('kuaizi', 'doubao-seedance-1-5-pro-251215')
    expect(isPresetComingSoonModel('kuaizi', 'doubao-seedance-1-5-pro-251215')).toBe(false)
    expect(isPresetComingSoonModelKey(modelKey)).toBe(false)
  })

  it('does not advertise Bailian presets outside the current provider registry', () => {
    const modelIds = PRESET_MODELS
      .filter((entry) => entry.provider === 'bailian' && entry.type === 'video')
      .map((entry) => entry.modelId)

    expect(modelIds).toEqual([])
  })
})
