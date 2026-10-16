import { beforeEach, describe, expect, it, vi } from 'vitest'

type StoredMaterial = {
  projectId?: string
  storageKey: string | null
  resultUrl: string | null
}

const state = vi.hoisted(() => ({
  stored: [] as StoredMaterial[],
}))

const prismaMock = vi.hoisted(() => ({
  frameosMaterial: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createMany: vi.fn(),
  },
  project: {
    findMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  globalCharacter: {
    findMany: vi.fn(),
  },
  globalLocation: {
    findMany: vi.fn(),
  },
}))

const mediaMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(async (storageKey: string) => ({
    url: `/m/${encodeURIComponent(storageKey)}`,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/storage', () => ({
  extractStorageKey: (value: string) => /^(?:images|video|voice)\//.test(value) ? value : null,
}))

import {
  registerFrameosMaterial,
  syncGeneratedImagesToMaterialLibrary,
} from '@/lib/frameos/material-service'

describe('FrameOS material service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.stored = []
    prismaMock.frameosMaterial.findFirst.mockResolvedValue(null)
    prismaMock.frameosMaterial.findMany.mockImplementation(async () => [...state.stored])
    prismaMock.frameosMaterial.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'material-new',
      ...data,
    }))
    prismaMock.frameosMaterial.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'material-existing',
      ...data,
    }))
    prismaMock.frameosMaterial.createMany.mockImplementation(async ({ data }: { data: StoredMaterial[] }) => {
      state.stored.push(...data.map((item) => ({
        projectId: item.projectId,
        storageKey: item.storageKey,
        resultUrl: item.resultUrl,
      })))
      return { count: data.length }
    })
    prismaMock.project.findMany.mockResolvedValue([])
    prismaMock.user.findUnique.mockResolvedValue({ name: '管理员' })
    prismaMock.globalCharacter.findMany.mockResolvedValue([])
    prismaMock.globalLocation.findMany.mockResolvedValue([])
  })

  it('normalizes a generated storage key and updates an existing indexed material idempotently', async () => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValueOnce({ id: 'material-existing' })

    const result = await registerFrameosMaterial({
      userId: 'user-1',
      projectId: 'project-1',
      title: '  苏晚卿 主形象  ',
      type: 'image',
      source: 'creative',
      storageKey: 'images/su-wanqing.png',
      metadata: { originType: 'character' },
    })

    expect(mediaMock.ensureMediaObjectFromStorageKey).toHaveBeenCalledWith('images/su-wanqing.png')
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', projectId: 'project-1', storageKey: 'images/su-wanqing.png', deletedAt: null },
    })
    expect(prismaMock.frameosMaterial.update).toHaveBeenCalledWith({
      where: { id: 'material-existing' },
      data: expect.objectContaining({
        projectId: 'project-1',
        title: '苏晚卿 主形象',
        type: 'image',
        source: 'creative',
        resultUrl: '/m/images%2Fsu-wanqing.png',
        storageKey: 'images/su-wanqing.png',
      }),
    })
    expect(result).toEqual(expect.objectContaining({ id: 'material-existing' }))
  })

  it('registers a shared image per project without moving the old project record', async () => {
    const result = await registerFrameosMaterial({
      userId: 'user-1', projectId: 'project-2', title: '复用图片', type: 'image',
      source: 'upload', storageKey: 'images/shared.png',
    })
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', projectId: 'project-2', storageKey: 'images/shared.png', deletedAt: null },
    })
    expect(prismaMock.frameosMaterial.update).not.toHaveBeenCalled()
    expect(result.projectId).toBe('project-2')
  })

  it('backfills every persisted project/global generated image and is idempotent', async () => {
    prismaMock.project.findMany.mockResolvedValue([{ 
      id: 'project-1',
      name: '海外短剧',
      novelPromotionData: {
        characters: [{
          id: 'character-1',
          name: '苏晚卿',
          appearances: [{
            id: 'appearance-1',
            changeReason: '主形象',
            imageUrl: 'images/character-main.png',
            imageUrls: JSON.stringify(['images/character-main.png', 'images/character-alt.png']),
            previousImageUrl: 'images/character-old.png',
            previousImageUrls: JSON.stringify(['images/character-old.png', 'images/character-old-alt.png']),
          }],
        }],
        locations: [{
          id: 'location-1',
          name: '柴房',
          assetKind: 'location',
          images: [{
            id: 'location-image-1',
            imageIndex: 0,
            imageUrl: 'images/location.png',
            previousImageUrl: 'images/location-old.png',
          }],
        }],
        episodes: [{
          episodeNumber: 1,
          name: '第一集',
          storyboards: [{
            panels: [{
              id: 'panel-1',
              panelNumber: 1,
              panelIndex: 0,
              imageUrl: 'images/panel-main.png',
              previousImageUrl: 'images/panel-old.png',
              sketchImageUrl: 'images/panel-sketch.png',
              candidateImages: JSON.stringify(['images/panel-main.png', 'images/panel-candidate.png']),
              imageHistory: JSON.stringify(['images/panel-history.png', 'images/panel-candidate.png']),
            }],
          }],
        }],
      },
    }])
    prismaMock.globalCharacter.findMany.mockResolvedValue([{ 
      name: '反派',
      appearances: [{
        id: 'global-appearance-1',
        changeReason: '主形象',
        imageUrl: 'images/global-character.png',
        imageUrls: JSON.stringify(['images/global-character.png', 'images/global-character-alt.png']),
        previousImageUrl: 'images/global-character-old.png',
        previousImageUrls: JSON.stringify(['images/global-character-old.png', 'images/global-character-old-alt.png']),
      }],
    }])
    prismaMock.globalLocation.findMany.mockResolvedValue([{ 
      name: '城门',
      assetKind: 'location',
      images: [{
        id: 'global-location-image-1',
        imageIndex: 0,
        imageUrl: 'images/global-location.png',
        previousImageUrl: 'images/global-location-old.png',
      }],
    }])

    const first = await syncGeneratedImagesToMaterialLibrary({ userId: 'user-1' })
    const second = await syncGeneratedImagesToMaterialLibrary({ userId: 'user-1' })

    expect(first).toEqual({ discovered: 17, created: 17 })
    expect(second).toEqual({ discovered: 17, created: 0 })
    expect(state.stored.map((item) => item.storageKey)).toEqual(expect.arrayContaining([
      'images/character-main.png',
      'images/character-alt.png',
      'images/location.png',
      'images/panel-main.png',
      'images/panel-sketch.png',
      'images/panel-candidate.png',
      'images/panel-history.png',
      'images/global-character.png',
      'images/global-character-alt.png',
      'images/global-location.png',
      'images/character-old.png',
      'images/character-old-alt.png',
      'images/location-old.png',
      'images/panel-old.png',
      'images/global-character-old.png',
      'images/global-character-old-alt.png',
      'images/global-location-old.png',
    ]))
    expect(prismaMock.frameosMaterial.createMany).toHaveBeenCalledTimes(1)
  })
})
