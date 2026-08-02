import { describe, expect, it } from 'vitest'
import {
  getCapabilityOptionFields,
  resolveBuiltinCapabilitiesByModelKey,
} from '@/lib/model-capabilities/lookup'

function resolutionOptions(modelKey: string) {
  return getCapabilityOptionFields(
    'video',
    resolveBuiltinCapabilitiesByModelKey('video', modelKey),
  ).resolution
}

describe('Seedance business model resolution tiers', () => {
  it('keeps Mini and Fast at the resolutions officially supported by those tiers', () => {
    expect(resolutionOptions('nori::seedance2.0-mini')).toEqual(['480p', '720p'])
    expect(resolutionOptions('nori::seedance2.0-fast')).toEqual(['480p', '720p'])
  })

  it('exposes 1080p and 4k only on Seedance 2.0 Pro', () => {
    expect(resolutionOptions('nori::seedance2.0')).toEqual(['480p', '720p', '1080p', '4k'])
    expect(resolutionOptions('ark::doubao-seedance-2-0-260128')).toEqual(['480p', '720p', '1080p', '4k'])
  })
})
