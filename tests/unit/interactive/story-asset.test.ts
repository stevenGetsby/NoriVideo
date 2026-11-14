import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const storageMock = vi.hoisted(() => ({
  uploadObject: vi.fn(async () => undefined),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `images/${prefix}-1717000000-ab12.${ext}`),
}))

vi.mock('@/lib/storage', () => storageMock)

import { STORY_ASSET_MAX_BYTES, isStoryAssetFileCandidate } from '@/lib/interactive/story-asset-contract'
import { prepareStoryAssetImage, uploadStoryAssetObject } from '@/lib/interactive/story-asset'

const file = (buffer: Buffer | Uint8Array, name = 'art.png', type = 'image/png') => new File([new Uint8Array(buffer)], name, { type })
const solid = { r: 200, g: 40, b: 90 }

describe('影游图片素材契约', () => {
  it('接受 PNG、JPG、WebP、GIF，拒绝空文件、超大文件和其他类型', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'IMAGE/GIF']) {
      expect(isStoryAssetFileCandidate({ type, size: 1024 })).toBe(true)
    }
    expect(isStoryAssetFileCandidate({ type: 'image/png', size: STORY_ASSET_MAX_BYTES })).toBe(true)
    expect(isStoryAssetFileCandidate({ type: 'image/png', size: STORY_ASSET_MAX_BYTES + 1 })).toBe(false)
    expect(isStoryAssetFileCandidate({ type: 'image/png', size: 0 })).toBe(false)
    expect(isStoryAssetFileCandidate({ type: 'image/svg+xml', size: 10 })).toBe(false)
    expect(isStoryAssetFileCandidate({ type: 'video/mp4', size: 10 })).toBe(false)
  })
})

describe('影游图片素材处理', () => {
  it('把大 PNG 缩进 1280px 并转成 WebP，同时保留透明通道', async () => {
    const source = await sharp({ create: { width: 3200, height: 1600, channels: 4, background: { ...solid, alpha: 0.5 } } }).png().toBuffer()
    const prepared = await prepareStoryAssetImage(file(source))

    expect(prepared.extension).toBe('webp')
    expect(prepared.mimeType).toBe('image/webp')
    const metadata = await sharp(prepared.body).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(1280)
    expect(metadata.height).toBe(640)
    expect(metadata.hasAlpha).toBe(true)
  })

  it('不放大小图，JPEG 同样转成 WebP', async () => {
    const source = await sharp({ create: { width: 64, height: 48, channels: 3, background: solid } }).jpeg().toBuffer()
    const prepared = await prepareStoryAssetImage(file(source, 'art.jpg', 'image/jpeg'))

    const metadata = await sharp(prepared.body).metadata()
    expect(prepared.mimeType).toBe('image/webp')
    expect(metadata.width).toBe(64)
    expect(metadata.height).toBe(48)
  })

  it('GIF 原样保留，不会被压成静态图', async () => {
    const source = await sharp({ create: { width: 40, height: 40, channels: 3, background: solid } }).gif().toBuffer()
    const prepared = await prepareStoryAssetImage(file(source, 'art.gif', 'image/gif'))

    expect(prepared.extension).toBe('gif')
    expect(prepared.mimeType).toBe('image/gif')
    expect(prepared.body.equals(source)).toBe(true)
  })

  it('以真实内容为准：浏览器声明成 PNG 的 SVG、损坏文件和空文件都被拒绝', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    await expect(prepareStoryAssetImage(file(svg))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(prepareStoryAssetImage(file(Buffer.from('not an image')))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(prepareStoryAssetImage(file(Buffer.alloc(0)))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })

  it('拒绝长边超过 12000px 的图片和不受支持的类型', async () => {
    const wide = await sharp({ create: { width: 12001, height: 1, channels: 3, background: solid } }).png().toBuffer()
    await expect(prepareStoryAssetImage(file(wide))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: solid } }).png().toBuffer()
    await expect(prepareStoryAssetImage(file(png, 'doc.pdf', 'application/pdf'))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })

  it('上传到该影游自己的前缀并带上处理后的类型', async () => {
    const prepared = { body: Buffer.from('webp'), extension: 'webp' as const, mimeType: 'image/webp' as const }
    const key = await uploadStoryAssetObject('work-1', prepared)

    expect(key).toBe('images/interactive-work-1-1717000000-ab12.webp')
    expect(storageMock.generateUniqueKey).toHaveBeenCalledWith('interactive-work-1', 'webp')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(prepared.body, key, undefined, 'image/webp')
  })
})
