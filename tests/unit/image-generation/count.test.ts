import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getImageGenerationCountConfig,
  getImageGenerationCountOptions,
  normalizeImageGenerationCount,
  normalizeImageGenerationCountPreferences,
} from '@/lib/image-generation/count'
import {
  getImageGenerationCount,
  setImageGenerationCount,
} from '@/lib/image-generation/count-preference'

describe('image generation count helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes values within each scope range', () => {
    expect(normalizeImageGenerationCount('character', 0)).toBe(1)
    expect(normalizeImageGenerationCount('character', 8)).toBe(6)
    expect(normalizeImageGenerationCount('storyboard-candidates', 0)).toBe(1)
    expect(normalizeImageGenerationCount('storyboard-candidates', 9)).toBe(4)
  })

  it('returns ordered options for each scope', () => {
    expect(getImageGenerationCountOptions('character')).toEqual([1, 2, 3, 4, 5, 6])
    expect(getImageGenerationCountOptions('storyboard-candidates')).toEqual([1, 2, 3, 4])
  })

  it('normalizes persisted count preferences', () => {
    expect(normalizeImageGenerationCountPreferences({
      character: 9,
      location: '2',
      'storyboard-candidates': 0,
      unknown: 6,
    })).toEqual({
      character: 6,
      location: 2,
      'storyboard-candidates': 1,
    })
    expect(normalizeImageGenerationCountPreferences(null)).toEqual({})
  })

  it('reads and writes client preference with scope isolation', () => {
    const localStorageMock = {
      getItem: vi.fn((key: string) => {
        if (key === getImageGenerationCountConfig('character').storageKey) return '5'
        if (key === getImageGenerationCountConfig('location').storageKey) return '2'
        return null
      }),
      setItem: vi.fn(),
    }
    vi.stubGlobal('window', { localStorage: localStorageMock })

    expect(getImageGenerationCount('character')).toBe(5)
    expect(getImageGenerationCount('location')).toBe(2)
    expect(setImageGenerationCount('storyboard-candidates', 8)).toBe(4)
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      getImageGenerationCountConfig('storyboard-candidates').storageKey,
      '4',
    )
  })
})
