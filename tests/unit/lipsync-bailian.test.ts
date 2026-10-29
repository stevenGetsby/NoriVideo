import { describe, expect, it, vi } from 'vitest'
import { generateLipSync } from '@/lib/lipsync'

describe('retired lipsync providers', () => {
  it('does not resolve a provider or submit a new task', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateLipSync({
      videoUrl: 'https://example.com/video.mp4',
      audioUrl: 'https://example.com/audio.wav',
    }, 'user-1', 'bailian::videoretalk')).rejects.toThrow('LIPSYNC_PROVIDER_RETIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
