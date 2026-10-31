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

function durationOptions(modelKey: string) {
  return getCapabilityOptionFields(
    'video',
    resolveBuiltinCapabilitiesByModelKey('video', modelKey),
  ).duration
}

describe('Seedance business model resolution tiers', () => {
  it('keeps Mini and Fast at the resolutions officially supported by those tiers', () => {
    expect(resolutionOptions('nori::seedance2.0-mini')).toEqual(['480p', '720p'])
    expect(resolutionOptions('nori::seedance2.0-fast')).toEqual(['480p', '720p'])
  })

  it('uses the documented Kuaizi integer duration range for every Mini surface', () => {
    const durations = Array.from({ length: 12 }, (_, index) => index + 4)
    expect(durationOptions('nori::seedance2.0-mini')).toEqual(durations)
    expect(durationOptions('kuaizi::doubao-seedance-2-0-mini-260615')).toEqual(durations)
  })

  it('exposes 1080p and 4k only on Seedance 2.0 Pro', () => {
    expect(resolutionOptions('nori::seedance2.0')).toEqual(['480p', '720p', '1080p', '4k'])
    expect(resolutionOptions('ark::doubao-seedance-2-0-260128')).toEqual(['480p', '720p', '1080p', '4k'])
  })

  it('exposes Seedance 2.5 at 480p/720p with 30s duration on the Kuaizi route', () => {
    expect(resolutionOptions('nori::norivideo2.5')).toEqual(['480p', '720p'])
    expect(resolutionOptions('kuaizi::doubao-seedance-2-5-260628')).toEqual(['480p', '720p'])
    const durations = getCapabilityOptionFields(
      'video',
      resolveBuiltinCapabilitiesByModelKey('video', 'nori::norivideo2.5'),
    ).duration
    expect(durations).toContain(30)
    expect(durations).not.toContain(1080)
  })
})
