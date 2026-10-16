import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { buildMockRequest } from '../../helpers/request'

const enabled = process.env.NORI_ASSETS_DB_TEST === '1'
const state = vi.hoisted(() => ({ owner: '', conflictId: '' }))
vi.mock('@/lib/api-auth', () => ({
  requireUserPermission: async () => ({ session: { user: { id: state.owner, actorId: state.owner, workspaceOwnerId: state.owner, role: 'admin' } } }),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/prisma', async (originalImport) => {
  const original = await originalImport<typeof import('@/lib/prisma')>()
  const client = original.prisma
  return { prisma: new Proxy(client, {
    get(target, property) {
      if (property === '$transaction') {
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { timeout?: number }) =>
          client.$transaction((tx) => callback(new Proxy(tx, {
            get(transaction, name) {
              if (name === 'frameosMaterial') return new Proxy(transaction.frameosMaterial, {
                get(delegate, method) {
                  if (method === 'updateMany') return async (args: Prisma.FrameosMaterialUpdateManyArgs) => {
                    if (args.where?.id === state.conflictId) return { count: 0 }
                    return delegate.updateMany(args)
                  }
                  if (method === 'findMany') return async (args: Prisma.FrameosMaterialFindManyArgs) =>
                    (await delegate.findMany(args)).sort((left, right) => left.id.localeCompare(right.id))
                  const value = Reflect.get(delegate, method)
                  return typeof value === 'function' ? value.bind(delegate) : value
                },
              })
              const value = Reflect.get(transaction, name)
              return typeof value === 'function' ? value.bind(transaction) : value
            },
          })), options)
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) }
})
import { POST } from '@/app/api/frameos/materials/bulk-delete/route'

let ids: string[] = []
async function submit(materialIds: string[]) {
  return POST(buildMockRequest({
    path: '/api/frameos/materials/bulk-delete', method: 'POST', body: { materialIds },
  }), { params: Promise.resolve({}) })
}

describe.skipIf(!enabled)('material batch trash against isolated real MySQL', () => {
  beforeEach(async () => {
    const url = new URL(process.env.DATABASE_URL || '')
    if (url.hostname !== 'nori-assets-test-mysql-20261014' || url.pathname !== '/nori_assets_check') {
      throw new Error('Refusing fixtures outside the disposable asset test database')
    }
    state.owner = `asset-owner-${randomUUID()}`
    state.conflictId = ''
    ids = ['a', 'b'].map((prefix) => `${prefix}-${randomUUID()}`)
    await prisma.frameosMaterial.createMany({
      data: ids.map((id) => ({ id, userId: state.owner, projectId: 'global', type: 'image', source: 'upload', title: id })),
    })
  })
  afterEach(async () => {
    state.conflictId = ''
    if (state.owner) await prisma.frameosMaterial.deleteMany({ where: { userId: state.owner } })
  })
  afterAll(async () => { await prisma.$disconnect() })

  it('soft-deletes all selected rows and permits idempotent retry', async () => {
    expect((await submit(ids)).status).toBe(200)
    const rows = await prisma.frameosMaterial.findMany({ where: { id: { in: ids } } })
    expect(rows.every((row) => Boolean(row.deletedAt) && row.deletedById === state.owner)).toBe(true)
    expect((await submit(ids)).status).toBe(200)
  })
  it('rolls back the earlier successful database write after a later optimistic-lock conflict', async () => {
    state.conflictId = ids[1]
    expect((await submit(ids)).status).toBe(409)
    const rows = await prisma.frameosMaterial.findMany({ where: { id: { in: ids } } })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.deletedAt === null && row.deletedById === null)).toBe(true)
  })
  it('does not remove any row when a batch includes an inaccessible id', async () => {
    expect((await submit([ids[0], 'unknown-material'])).status).toBe(404)
    expect(await prisma.frameosMaterial.count({ where: { id: { in: ids }, deletedAt: null } })).toBe(2)
  })
  it('handles 200 uploaded assets atomically without repeated document scans timing out', async () => {
    const extra = Array.from({ length: 198 }, () => randomUUID())
    await prisma.frameosMaterial.createMany({
      data: extra.map((id) => ({ id, userId: state.owner, projectId: 'global', type: 'image', source: 'upload' })),
    })
    expect((await submit([...ids, ...extra])).status).toBe(200)
    expect(await prisma.frameosMaterial.count({ where: { userId: state.owner, deletedAt: null } })).toBe(0)
  })
})
