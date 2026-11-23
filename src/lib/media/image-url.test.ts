import { describe, expect, it } from 'vitest'
import { resolveOriginalImageUrl, toCanvasDisplayImageUrl, toCanvasTextureUrl, toDisplayImageUrl, toPlayableAudioUrl, toPlayableVideoUrl, toVideoPosterUrl, unwrapNextImageUrl } from './image-url'

describe('image-url helpers', () => {
  it('unwraps next/image nested url', () => {
    const input = '/_next/image?url=%2Fapi%2Fstorage%2Fsign%3Fkey%3Dimages%252Ffoo.png&w=640&q=75'
    expect(unwrapNextImageUrl(input)).toBe('/api/storage/sign?key=images/foo.png')
  })

  it('maps storage key to display signing route', () => {
    expect(toDisplayImageUrl('images/a.png')).toBe('/api/storage/sign?key=images%2Fa.png')
  })

  it('uses only storage-backed images for canvas thumbnails and preserves the original key', () => {
    expect(toCanvasDisplayImageUrl('images/a.png', 960))
      .toBe('/api/storage/sign?key=images%2Fa.png&thumbnail=960')
    expect(toCanvasDisplayImageUrl('/api/storage/sign?key=images%2Fa.png&inline=1&playback=1&expires=60', 480))
      .toBe('/api/storage/sign?key=images%2Fa.png&thumbnail=480')
    expect(toCanvasDisplayImageUrl('https://cdn.example/a.png', 960)).toBe('https://cdn.example/a.png')
  })

  it('does not request canvas thumbnails for animated or non-raster storage keys', () => {
    expect(toCanvasDisplayImageUrl('images/loop.gif', 480)).toBe('/api/storage/sign?key=images%2Floop.gif')
    expect(toCanvasDisplayImageUrl('video/clip.mp4', 480)).toBe('/api/storage/sign?key=video%2Fclip.mp4')
    expect(toCanvasDisplayImageUrl('images/b.JPEG', 480)).toBe('/api/storage/sign?key=images%2Fb.JPEG&thumbnail=480')
  })

  it('lets /m/ playback redirect by default but pins byte consumers to the same-origin proxy', () => {
    expect(toPlayableVideoUrl('/m/abc')).toBe('/m/abc')
    expect(toPlayableVideoUrl('/m/abc', { sameOrigin: true })).toBe('/m/abc?proxy=1')
    expect(toCanvasTextureUrl('/m/abc')).toBe('/m/abc?proxy=1')
    expect(toPlayableAudioUrl('/m/abc')).toBe('/m/abc?proxy=1')
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
      .toBe('/api/storage/sign?key=video%2Ffoo.webm&playback=1')
    expect(toPlayableVideoUrl('https://cdn.example/clip.mp4')).toBe('https://cdn.example/clip.mp4')
    expect(toPlayableVideoUrl(null)).toBeNull()
  })

  it('derives cacheable posters only from storage-backed video URLs', () => {
    expect(toVideoPosterUrl('video/clip.mp4', 480)).toBe('/api/storage/sign?key=video%2Fclip.mp4&poster=480')
    expect(toVideoPosterUrl('/api/storage/sign?key=video%2Fclip.mp4&playback=1&expires=10&thumbnail=960', 960))
      .toBe('/api/storage/sign?key=video%2Fclip.mp4&poster=960')
    expect(toVideoPosterUrl('https://cdn.example/clip.mp4', 480)).toBeNull()
  })
})
