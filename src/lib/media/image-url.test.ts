import { describe, expect, it } from 'vitest'
import { resolveOriginalImageUrl, toCanvasTextureUrl, toDisplayImageUrl, toPlayableVideoUrl, unwrapNextImageUrl } from './image-url'

describe('image-url helpers', () => {
  it('unwraps next/image nested url', () => {
    const input = '/_next/image?url=%2Fapi%2Fstorage%2Fsign%3Fkey%3Dimages%252Ffoo.png&w=640&q=75'
    expect(unwrapNextImageUrl(input)).toBe('/api/storage/sign?key=images/foo.png')
  })

  it('maps storage key to display signing route', () => {
    expect(toDisplayImageUrl('images/a.png')).toBe('/api/storage/sign?key=images%2Fa.png')
  })

  it('keeps WebGL textures on the same origin instead of following a CORS-sensitive redirect', () => {
    expect(toCanvasTextureUrl('images/a.png')).toBe('/api/storage/sign?key=images%2Fa.png&inline=1')
    expect(toCanvasTextureUrl('/api/storage/sign?key=images%2Fb.jpg&expires=900'))
      .toBe('/api/storage/sign?key=images%2Fb.jpg&expires=900&inline=1')
    expect(toCanvasTextureUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png')
  })

  it('resolves original url from next/image and keeps sign route normalized', () => {
    const input = '/_next/image?url=%2Fapi%2Fstorage%2Fsign%3Fkey%3Dimages%252Fa.png&w=1080&q=75'
    expect(resolveOriginalImageUrl(input)).toBe('/api/storage/sign?key=images%2Fa.png')
  })

  it('returns null for empty values', () => {
    expect(toDisplayImageUrl('')).toBeNull()
    expect(resolveOriginalImageUrl(null)).toBeNull()
  })

  it('uses range-capable video playback for storage keys and existing signing URLs', () => {
    expect(toPlayableVideoUrl('images/toolbox-video.mp4'))
      .toBe('/api/storage/sign?key=images%2Ftoolbox-video.mp4&playback=1')
    expect(toPlayableVideoUrl('/api/storage/sign?key=video%2Ffoo.webm&expires=900'))
      .toBe('/api/storage/sign?key=video%2Ffoo.webm&expires=900&playback=1')
    expect(toPlayableVideoUrl('https://cdn.example/clip.mp4')).toBe('https://cdn.example/clip.mp4')
    expect(toPlayableVideoUrl(null)).toBeNull()
  })
})
