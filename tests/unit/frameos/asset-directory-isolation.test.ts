import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAssets } from '@/lib/assets/services/read-assets'

const db = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn() },
  globalCharacter: { findMany: vi.fn() },
  globalVoice: { findMany: vi.fn() },
}))
const locations = vi.hoisted(() => ({ project: vi.fn(), global: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (value) => value),
  attachMediaFieldsToGlobalCharacter: vi.fn(async (value) => value),
  attachMediaFieldsToGlobalLocation: vi.fn(async (value) => value),
  attachMediaFieldsToGlobalVoice: vi.fn(async (value) => value),
}))
vi.mock('@/lib/assets/services/location-backed-assets', () => ({
  listProjectLocationBackedAssets: locations.project,
  listGlobalLocationBackedAssets: locations.global,
}))

describe('asset subdirectory isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.novelPromotionProject.findUnique.mockResolvedValue({ id: 'novel-1' })
    db.globalCharacter.findMany.mockRejectedValue(new Error('bad legacy character'))
    db.globalVoice.findMany.mockRejectedValue(new Error('bad unrelated voice'))
    locations.project.mockResolvedValue([{ id: 'scene-1', name: '工厂', assetKind: 'location', summary: null, images: [] }])
    locations.global.mockResolvedValue([{ id: 'scene-1', name: '工厂', assetKind: 'location', folderId: null, summary: null, images: [] }])
  })
  it('opens a project scene subdirectory without reading character records or prop folders', async () => {
    const assets = await readAssets({ scope: 'project', projectId: 'project-1', kind: 'location' })
    expect(assets).toMatchObject([{ id: 'scene-1', kind: 'location' }])
    expect(db.novelPromotionProject.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, characters: false },
    }))
    expect(locations.project.mock.calls).toEqual([['novel-1', 'location']])
  })
  it('opens a global scene directory even when unrelated character/voice reads would fail', async () => {
    expect(await readAssets({ scope: 'global', kind: 'location', folderId: 'folder-1' }, { userId: 'owner-1' }))
      .toMatchObject([{ id: 'scene-1', kind: 'location' }])
    expect(db.globalCharacter.findMany).not.toHaveBeenCalled()
    expect(db.globalVoice.findMany).not.toHaveBeenCalled()
    expect(locations.global).toHaveBeenCalledOnce()
    expect(locations.global).toHaveBeenCalledWith({ userId: 'owner-1', folderId: 'folder-1', kind: 'location' })
  })
})
