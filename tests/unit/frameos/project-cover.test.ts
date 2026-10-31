import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const storageMock = vi.hoisted(() => ({
  uploadObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `images/${prefix}-abc123.${ext}`),
}))

vi.mock('@/lib/storage', () => storageMock)

import {
  PROJECT_COVER_MAX_BYTES,
  isProjectCoverFileCandidate,
  isProjectCoverStorageKey,
} from '@/lib/projects/project-cover-contract'
import {
  deleteProjectCoverObject,
  prepareProjectCoverImage,
  uploadProjectCoverImage,
} from '@/lib/projects/project-cover-image'
import { normalizeWorkProject } from '@/components/frameos/works/types'
import { requiredPermissionsForApiPath } from '@/lib/account/permissions'

async function pngBuffer(width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } },
  }).png().toBuffer()
}

function coverFile(buffer: Buffer, name = 'cover.png', type = 'image/png'): File {
  return new File([new Uint8Array(buffer)], name, { type })
}

describe('项目封面契约', () => {
  it('接受受支持的图片类型和大小', () => {
    expect(isProjectCoverFileCandidate({ type: 'image/png', size: 1024 })).toBe(true)
    expect(isProjectCoverFileCandidate({ type: 'image/jpeg', size: PROJECT_COVER_MAX_BYTES })).toBe(true)
    expect(isProjectCoverFileCandidate({ type: 'IMAGE/WEBP', size: 10 })).toBe(true)
  })

  it('拒绝空文件、超出大小或不受支持的类型', () => {
    expect(isProjectCoverFileCandidate({ type: 'image/png', size: 0 })).toBe(false)
    expect(isProjectCoverFileCandidate({ type: 'image/png', size: PROJECT_COVER_MAX_BYTES + 1 })).toBe(false)
    expect(isProjectCoverFileCandidate({ type: 'image/gif', size: 10 })).toBe(false)
    expect(isProjectCoverFileCandidate({ type: 'application/pdf', size: 10 })).toBe(false)
  })

  it('只接受本项目生成的封面对象 key', () => {
    expect(isProjectCoverStorageKey('images/project-cover-p1-1717000000-ab12.jpg')).toBe(true)
    expect(isProjectCoverStorageKey('images/project-cover-p_1-AbC.jpg')).toBe(true)
  })

  it('拒绝路径穿越、其他前缀和其他扩展名的 key', () => {
    expect(isProjectCoverStorageKey('images/project-cover-p1/../../secret.jpg')).toBe(false)
    expect(isProjectCoverStorageKey('images/project-cover-../secret.jpg')).toBe(false)
    expect(isProjectCoverStorageKey('images/avatar-1.jpg')).toBe(false)
    expect(isProjectCoverStorageKey('images/project-cover-p1.png')).toBe(false)
    expect(isProjectCoverStorageKey('/images/project-cover-p1.jpg')).toBe(false)
    expect(isProjectCoverStorageKey('https://evil/project-cover-p1.jpg')).toBe(false)
    expect(isProjectCoverStorageKey('images\\project-cover-p1.jpg')).toBe(false)
    expect(isProjectCoverStorageKey(null)).toBe(false)
    expect(isProjectCoverStorageKey(42)).toBe(false)
  })
})

describe('项目封面图片处理', () => {
  it('把 PNG 转成受尺寸限制的 JPEG', async () => {
    const source = await pngBuffer(3200, 2400)
    const prepared = await prepareProjectCoverImage(coverFile(source))

    expect(prepared.extension).toBe('jpg')
    expect(prepared.mimeType).toBe('image/jpeg')
    const metadata = await sharp(prepared.body).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBe(1600)
    expect(metadata.height).toBe(1200)
  })

  it('拒绝伪装成图片的无效内容', async () => {
    const file = coverFile(Buffer.from('not an image'), 'cover.png', 'image/png')
    await expect(prepareProjectCoverImage(file)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    })
  })

  it('上传时使用带封面前缀的 key 并传入图片类型', async () => {
    const prepared = { body: Buffer.from('jpeg'), extension: 'jpg' as const, mimeType: 'image/jpeg' as const }
    const key = await uploadProjectCoverImage('p1', prepared)

    expect(key).toBe('images/project-cover-p1-abc123.jpg')
    expect(storageMock.generateUniqueKey).toHaveBeenCalledWith('project-cover-p1', 'jpg')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(prepared.body, key, undefined, 'image/jpeg')
  })

  it('只清理合法的封面对象，且清理失败不抛出', async () => {
    storageMock.deleteObject.mockRejectedValueOnce(new Error('storage down'))
    await expect(deleteProjectCoverObject('images/project-cover-p1-abc123.jpg')).resolves.toBeUndefined()

    await deleteProjectCoverObject('images/avatar-1.jpg')
    await deleteProjectCoverObject(null)

    expect(storageMock.deleteObject).toHaveBeenCalledTimes(1)
    expect(storageMock.deleteObject).toHaveBeenCalledWith('images/project-cover-p1-abc123.jpg')
  })
})

describe('项目封面序列化', () => {
  it('保留接口返回的封面地址', () => {
    const project = normalizeWorkProject({
      id: 'p1',
      name: '作品一',
      coverImageUrl: 'https://cdn.example.com/cover.jpg',
    })
    expect(project?.coverImageUrl).toBe('https://cdn.example.com/cover.jpg')
  })

  it('兼容 snake_case 的封面地址', () => {
    const project = normalizeWorkProject({
      id: 'p1',
      name: '作品一',
      cover_image_url: 'https://cdn.example.com/cover-snake.jpg',
    })
    expect(project?.coverImageUrl).toBe('https://cdn.example.com/cover-snake.jpg')
  })

  it('没有封面时保持为空，交给彩字兜底', () => {
    const project = normalizeWorkProject({ id: 'p1', name: '作品一' })
    expect(project?.coverImageUrl).toBeNull()
  })

  it('封面接口沿用作品读取权限', () => {
    expect(requiredPermissionsForApiPath('/api/projects/p1/cover', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/p1/cover/', 'DELETE')).toEqual(['read'])
  })
})
