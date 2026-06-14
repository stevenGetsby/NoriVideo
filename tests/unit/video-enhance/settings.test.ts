import { describe, expect, it } from 'vitest'
import { normalizeVideoEnhanceSettings } from '@/lib/video-enhance/settings'

describe('video enhance settings', () => {
  it('normalizes supported persisted settings', () => {
    expect(normalizeVideoEnhanceSettings({
      sourceMode: 'url',
      toolVersion: 'professional',
      scene: 'short_series',
      resolutionMode: 'limit',
      resolution: '4k',
      resolutionLimit: '1440',
      fps: '30',
      showAdvanced: true,
      submitConcurrency: '6',
      videoUrlsDraft: ' https://example.com/a.mp4 \n\nhttps://example.com/b.mp4 ',
    })).toEqual({
      sourceMode: 'url',
      toolVersion: 'professional',
      scene: 'short_series',
      resolutionMode: 'limit',
      resolution: '4k',
      resolutionLimit: '1440',
      fps: '30',
      showAdvanced: true,
      submitConcurrency: '6',
      videoUrlsDraft: 'https://example.com/a.mp4\nhttps://example.com/b.mp4',
    })
  })

  it('falls back or clamps unsafe values', () => {
    expect(normalizeVideoEnhanceSettings({
      sourceMode: 'remote',
      toolVersion: 'enterprise',
      scene: 'private',
      resolutionMode: 'custom',
      resolution: '16k',
      resolutionLimit: '9999',
      fps: '500',
      showAdvanced: 'yes',
      submitConcurrency: '99',
      videoUrls: 'https://example.com/private.mp4',
      videoUrlsDraft: 123,
      downloadDirectoryPath: '/Users/me/Downloads',
    })).toEqual({
      sourceMode: 'file',
      toolVersion: 'standard',
      scene: 'aigc',
      resolutionMode: 'preset',
      resolution: '1080p',
      resolutionLimit: '',
      fps: '',
      showAdvanced: false,
      submitConcurrency: '8',
      videoUrlsDraft: '',
    })
  })

  it('bounds the persisted video url draft without storing unrelated local fields', () => {
    const longUrl = `https://example.com/${'a'.repeat(3000)}.mp4`
    const input = Array.from({ length: 80 }, (_, index) => `${longUrl}?i=${index}`).join('\n')

    const settings = normalizeVideoEnhanceSettings({
      videoUrlsDraft: input,
      clientToken: 'token-should-not-persist',
      callbackArgs: '{"secret":true}',
      downloadDirectoryPath: '/Users/me/Downloads',
    })

    const lines = settings.videoUrlsDraft.split('\n')
    expect(lines).toHaveLength(5)
    expect(lines.every((line) => line.length <= 2048)).toBe(true)
    expect(settings.videoUrlsDraft.length).toBeLessThanOrEqual(10000)
    expect(JSON.stringify(settings)).not.toContain('token-should-not-persist')
    expect(JSON.stringify(settings)).not.toContain('downloadDirectoryPath')
  })
})
