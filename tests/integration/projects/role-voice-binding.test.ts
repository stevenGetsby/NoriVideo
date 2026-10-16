import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { buildMockRequest } from '../../helpers/request'
const enabled = process.env.NORI_ASSETS_DB_TEST === '1'
const state = vi.hoisted(() => ({ owner: '' }))
vi.mock('@/lib/api-auth', () => ({
  requireUserPermission: async () => ({ session: { user: { id: state.owner, actorId: state.owner, role: 'admin' } } }),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
import { PATCH, DELETE } from '@/app/api/frameos/materials/[materialId]/route'
let imageId = ''
let audioId = ''
async function change(id: string, body: unknown) {
  return PATCH(buildMockRequest({ path: `/api/frameos/materials/${id}`, method: 'PATCH', body }), { params: Promise.resolve({ materialId: id }) })
}
describe.skipIf(!enabled)('role/audio bindings in disposable real MySQL', () => {
  beforeEach(async () => {
    const url = new URL(process.env.DATABASE_URL || '')
    if (url.hostname !== 'nori-assets-test-mysql-20261014' || url.pathname !== '/nori_assets_check') throw new Error('Refusing non-disposable database')
    state.owner = `voice-owner-${randomUUID()}`
    imageId = randomUUID(); audioId = randomUUID()
    await prisma.frameosMaterial.createMany({ data: [
      { id: imageId, userId: state.owner, projectId: 'global', title: '关羽', type: 'image', source: 'upload', metadata: { assetCategory: 'character' } },
      { id: audioId, userId: state.owner, projectId: 'global', title: '关羽音色', type: 'audio', source: 'upload', metadata: { durationSeconds: 3 } },
    ] })
  })
  afterEach(async () => { await prisma.frameosMaterial.deleteMany({ where: { userId: state.owner } }) })
  afterAll(async () => { await prisma.$disconnect() })
  it('persists role voice metadata and rejects deleting the linked audio atomically', async () => {
    expect((await change(imageId, { voiceMaterialId: audioId })).status).toBe(200)
    expect((await prisma.frameosMaterial.findUnique({ where: { id: imageId } }))?.metadata).toMatchObject({ voiceMaterialId: audioId })
    const removed = await DELETE(buildMockRequest({ path: `/api/frameos/materials/${audioId}`, method: 'DELETE' }), { params: Promise.resolve({ materialId: audioId }) })
    expect(removed.status).toBe(409)
    expect((await prisma.frameosMaterial.findUnique({ where: { id: audioId } }))?.deletedAt).toBeNull()
  })
  it('unbinds without losing category, allowing later audio deletion', async () => {
    await change(imageId, { voiceMaterialId: audioId })
    expect((await change(imageId, { voiceMaterialId: null })).status).toBe(200)
    expect((await prisma.frameosMaterial.findUnique({ where: { id: imageId } }))?.metadata).toEqual({ assetCategory: 'character' })
    expect((await DELETE(buildMockRequest({ path: `/api/frameos/materials/${audioId}`, method: 'DELETE' }), { params: Promise.resolve({ materialId: audioId }) })).status).toBe(200)
  })
  it('rejects cross-workspace or deleted voices without mutating the image', async () => {
    await prisma.frameosMaterial.update({ where: { id: audioId }, data: { deletedAt: new Date() } })
    expect((await change(imageId, { voiceMaterialId: audioId })).status).toBe(404)
    expect((await prisma.frameosMaterial.findUnique({ where: { id: imageId } }))?.metadata).toEqual({ assetCategory: 'character' })
  })
})
