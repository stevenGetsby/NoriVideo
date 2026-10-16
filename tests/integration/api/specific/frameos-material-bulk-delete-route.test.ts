import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { buildMockRequest } from '../../../helpers/request'

const auth = vi.hoisted(() => vi.fn())
const references = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => {
  const tx = {
    project: { findFirst: vi.fn() },
    frameosMaterial: { findMany: vi.fn(), updateMany: vi.fn() },
  }
  return { ...tx, $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) }
})
vi.mock('@/lib/api-auth', () => ({
  requireUserPermission: auth,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/canvas/material-reference-guard', () => ({
  findCanvasMaterialsReferences: references,
  canvasMaterialReferenceConflictMessage: () => '素材仍被画布引用，无法删除。',
}))
import { POST } from '@/app/api/frameos/materials/bulk-delete/route'

const time = new Date('2026-10-14T00:00:00Z')
const material = (id: string, values = {}) => ({
  id, userId: 'manager-1', projectId: 'global', source: 'upload',
  updatedAt: time, deletedAt: null, resultUrl: 'asset.jpg', storageKey: 'asset.jpg', ...values,
})
const request = (body: unknown) => buildMockRequest({
  path: '/api/frameos/materials/bulk-delete', method: 'POST', body,
})
const context = { params: Promise.resolve({}) }

describe('material bulk trash permissions and atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ session: { user: {
      id: 'manager-1', workspaceOwnerId: 'manager-1', actorId: 'asset-child', role: 'asset',
    } } })
    db.project.findFirst.mockResolvedValue({ id: 'project-1' })
    db.frameosMaterial.findMany.mockResolvedValue([material('a'), material('b')])
    db.frameosMaterial.updateMany.mockResolvedValue({ count: 1 })
    references.mockResolvedValue(new Map())
  })

  it('only permits assetWrite, deduplicates ids and soft-deletes in one transaction', async () => {
    const response = await POST(request({ materialIds: [' a ', 'b', 'a'] }), context)
    expect(response.status).toBe(200)
    expect(auth).toHaveBeenCalledWith(['assetWrite'])
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.frameosMaterial.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, userId: 'manager-1' },
    })
    expect(db.frameosMaterial.updateMany).toHaveBeenCalledTimes(2)
    expect(db.frameosMaterial.updateMany).toHaveBeenCalledWith({
      where: { id: 'a', userId: 'manager-1', projectId: 'global', source: 'upload', updatedAt: time, deletedAt: null },
      data: { deletedAt: expect.any(Date), deletedById: 'asset-child', isFavorited: false },
    })
    expect(await response.json()).toMatchObject({ success: true, materialIds: ['a', 'b'], deletedCount: 2 })
  })

  it('does not touch data when account permissions deny the operation', async () => {
    auth.mockResolvedValueOnce(NextResponse.json({ message: 'forbidden' }, { status: 403 }))
    expect((await POST(request({ materialIds: ['a'] }), context)).status).toBe(403)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it.each([null, [], 'bad', {}, { materialIds: [] }, { materialIds: [1] },
    { materialIds: [''] }, { materialIds: ['a'.repeat(192)] },
    { materialIds: Array.from({ length: 201 }, (_, i) => String(i)) },
  ])('rejects malformed input before reading materials: %j', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a batch containing an unknown or other-workspace id without partial changes', async () => {
    db.frameosMaterial.findMany.mockResolvedValueOnce([material('a')])
    expect((await POST(request({ materialIds: ['a', 'foreign'] }), context)).status).toBe(404)
    expect(db.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('verifies project access before accepting project material', async () => {
    db.frameosMaterial.findMany.mockResolvedValueOnce([material('a', { projectId: 'project-1' })])
    db.project.findFirst.mockResolvedValueOnce(null)
    expect((await POST(request({ materialIds: ['a'] }), context)).status).toBe(404)
    expect(db.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'manager-1', deletedAt: null },
      select: { id: true },
    })
    expect(db.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('checks the entire batch before writing and refuses generated assets', async () => {
    db.frameosMaterial.findMany.mockResolvedValueOnce([material('a'), material('b', { source: 'creative' })])
    expect((await POST(request({ materialIds: ['a', 'b'] }), context)).status).toBe(403)
    expect(db.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('refuses the whole batch when any item is referenced', async () => {
    references.mockResolvedValueOnce(new Map([['b', { referenced: true, counts: { currentCanvases: 1 } }]]))
    expect((await POST(request({ materialIds: ['a', 'b'] }), context)).status).toBe(409)
    expect(db.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  it('allows idempotent retry without overwriting a previous deletedById', async () => {
    db.frameosMaterial.findMany.mockResolvedValueOnce([material('a', { deletedAt: time })])
    const response = await POST(request({ materialIds: ['a'] }), context)
    expect(response.status).toBe(200)
    expect(db.frameosMaterial.updateMany).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ deletedCount: 0 })
  })

  it('rejects concurrent changes using each exact observed updatedAt', async () => {
    db.frameosMaterial.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    expect((await POST(request({ materialIds: ['a', 'b'] }), context)).status).toBe(409)
    expect(db.frameosMaterial.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 'b', updatedAt: time }),
    }))
  })
})
