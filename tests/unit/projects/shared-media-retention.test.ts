import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ mediaObject: { findMany: vi.fn() }, $queryRaw: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
import { unreferencedProjectStorageKeys } from '@/lib/projects/shared-media-retention'

describe('expired project shared media retention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.mediaObject.findMany.mockResolvedValue([{ id: 'media-id', storageKey: 'images/shared.png', publicId: 'public-id' }])
    db.$queryRaw.mockResolvedValue([])
  })
  it('retains cross-project canvas or template references stored by stable /m URL', async () => {
    db.$queryRaw.mockImplementation(async (sql: { sql: string; values: unknown[] }) => (
      sql.sql.includes('canvas_nodes') && sql.values.includes('%/m/public-id%') ? [{ retained: 1 }] : []
    ))
    expect(await unreferencedProjectStorageKeys('expired-project', ['images/shared.png'])).toEqual([])
  })
  it('retains global asset media-id references, not only raw storage paths', async () => {
    db.$queryRaw.mockImplementation(async (sql: { sql: string; values: unknown[] }) => (
      sql.sql.includes('global_location_images') && sql.values.includes('%media-id%') ? [{ retained: 1 }] : []
    ))
    expect(await unreferencedProjectStorageKeys('expired-project', ['images/shared.png'])).toEqual([])
  })
  it('permits deletion only after examining surviving durable fields and excludes the purged project', async () => {
    expect(await unreferencedProjectStorageKeys('expired-project', ['images/shared.png'])).toEqual(['images/shared.png'])
    const calls = db.$queryRaw.mock.calls.map(([sql]) => sql)
    expect(calls.some((sql) => sql.sql.includes('canvas_snapshots'))).toBe(true)
    expect(calls.some((sql) => sql.sql.includes('canvas_workflow_templates'))).toBe(true)
    expect(calls.some((sql) => sql.sql.includes('frameos_materials') && sql.values.includes('expired-project'))).toBe(true)
  })
  it('fails closed on a reference lookup error rather than deleting unchecked files', async () => {
    db.$queryRaw.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(unreferencedProjectStorageKeys('p1', ['images/shared.png'])).rejects.toThrow('database unavailable')
  })
  it('never expands wildcard keys into unrelated references', async () => {
    await unreferencedProjectStorageKeys('p1', ['images/my_100%.png'])
    expect(db.$queryRaw.mock.calls[0][0].values).toContain('%images/my!_100!%.png%')
  })
})
