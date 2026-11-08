import { describe, expect, it } from 'vitest'
import { publicHistoryModelId } from '@/lib/task/public-model-presentation'

describe('public historical model identity', () => {
  it('shows the model persisted at submission without exposing its provider', () => {
    expect(publicHistoryModelId('kuaizi::doubao-seedance-2-0-260128')).toBe('doubao-seedance-2-0-260128')
    expect(publicHistoryModelId('huimengi::seedance-2.5')).toBe('seedance-2.5')
    expect(publicHistoryModelId('openlux::gpt-image-2.6-flare-c')).toBe('gpt-image-2.6-flare-c')
    expect(publicHistoryModelId('kuaizi::speech-2.8-hd')).toBe('speech-2.8-hd')
  })

  it('does not invent a historical model from a legacy alias or unknown value', () => {
    expect(publicHistoryModelId('nori::norivideo2.5')).toBeNull()
    expect(publicHistoryModelId('nori::nori-image-2.6')).toBeNull()
    expect(publicHistoryModelId('nori::nori-audio')).toBeNull()
    expect(publicHistoryModelId('nori-image-pro')).toBeNull()
    expect(publicHistoryModelId('ark::retired-video')).toBe('retired-video')
    expect(publicHistoryModelId(null)).toBeNull()
    expect(publicHistoryModelId('   ')).toBeNull()
  })
})
