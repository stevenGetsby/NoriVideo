import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { moveProjects } from '@/lib/works/service'

// Only the dedicated disposable local MySQL runner may execute these tests.
const enabled = process.env.NORI_CORNER_DB_TEST === '1'
const hooks = vi.hoisted(() => ({
  beforeTransaction: null as (() => Promise<unknown>) | null,
  orderSources: false,
}))

// Prisma exposes methods via proxies. Wrap reads/transactions instead of
// spyOn/restoring its dynamic methods, which can invalidate the real client.
vi.mock('@/lib/prisma', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/prisma')>()
  const client = original.prisma
  return {
    prisma: new Proxy(client, {
      get(target, key) {
        if (key === '$transaction') {
          return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
            const operation = hooks.beforeTransaction
            hooks.beforeTransaction = null
            if (operation) await operation()
            return client.$transaction(callback)
          }
        }
        if (key === 'project' && hooks.orderSources) {
          return new Proxy(client.project, {
            get(delegate, method) {
              if (method === 'findMany') {
                return async (args?: Prisma.ProjectFindManyArgs) => (
                  await delegate.findMany(args)
                ).sort((a, b) => a.id.localeCompare(b.id))
              }
              const value = Reflect.get(delegate, method)
              return typeof value === 'function' ? value.bind(delegate) : value
            },
          })
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
  }
})
let ownerId = ''
let sourceA = ''
let sourceB = ''
let target = ''
let workA = ''
let workB = ''

function session() {
  return { user: { id: ownerId, actorId: ownerId, workspaceOwnerId: ownerId, role: 'admin' as const } }
}

function beforeMoveTransaction(operation: () => Promise<unknown>) {
  hooks.beforeTransaction = operation
}

describe.skipIf(!enabled)('work moves against disposable real MySQL', () => {
  beforeEach(async () => {
    const database = new URL(process.env.DATABASE_URL || '')
    if (database.hostname !== 'norivideo-corner-mysql'
      || database.pathname !== '/nori_corner_check') {
      throw new Error('Refusing to run destructive test fixtures outside the isolated corner database')
    }
    const suffix = randomUUID()
    const owner = await prisma.user.create({
      data: { name: `corner-owner-${suffix}`, role: 'admin' },
    })
    ownerId = owner.id
    const parents = await Promise.all(['a', 'b', 'target'].map((name) => prisma.work.create({
      data: { name, workspaceOwnerId: ownerId, createdById: ownerId },
    })))
    sourceA = parents[0].id
    sourceB = parents[1].id
    target = parents[2].id
    const works = await Promise.all([
      prisma.project.create({ data: {
        id: `a-${suffix}`, name: '作品 A', userId: ownerId, createdById: ownerId, workId: sourceA,
      } }),
      prisma.project.create({ data: {
        id: `b-${suffix}`, name: '作品 B', userId: ownerId, createdById: ownerId, workId: sourceB,
      } }),
    ])
    workA = works[0].id
    workB = works[1].id
  })

  afterEach(async () => {
    hooks.beforeTransaction = null
    hooks.orderSources = false
    if (!ownerId) return
    await prisma.project.deleteMany({ where: { userId: ownerId } })
    await prisma.work.deleteMany({ where: { workspaceOwnerId: ownerId } })
    await prisma.user.delete({ where: { id: ownerId } })
    ownerId = ''
  })

  afterAll(async () => { await prisma.$disconnect() })

  it('moves all selected works when normalized new/legacy fields agree', async () => {
    await expect(moveProjects(session(), {
      workIds: [workB, ` ${workA} `, workA], projectIds: [workA, workB],
      targetProjectId: target, targetWorkId: target,
    })).resolves.toMatchObject({ moved: 2, targetProjectId: target })
    const works = await prisma.project.findMany({ where: { id: { in: [workA, workB] } } })
    expect(works.every((work) => work.workId === target && work.deletedAt === null)).toBe(true)
    expect(works.map((work) => work.id).sort()).toEqual([workA, workB].sort())
  })

  it('rejects conflicting source aliases without any persisted move', async () => {
    await expect(moveProjects(session(), {
      workIds: [workA], projectIds: [workB], targetProjectId: target,
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect((await prisma.project.findUniqueOrThrow({ where: { id: workA } })).workId).toBe(sourceA)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: workB } })).workId).toBe(sourceB)
  })

  it('does not move a work soft-deleted after the initial source read', async () => {
    beforeMoveTransaction(() => prisma.project.update({
      where: { id: workA }, data: { deletedAt: new Date(), deletedById: ownerId },
    }))
    await expect(moveProjects(session(), {
      workIds: [workA], targetProjectId: target,
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    const record = await prisma.project.findUniqueOrThrow({ where: { id: workA } })
    expect(record.deletedAt).not.toBeNull()
    expect(record.workId).toBe(sourceA)
  })

  it('rolls back earlier batch updates if a later source was deleted concurrently', async () => {
    hooks.orderSources = true
    beforeMoveTransaction(() => prisma.project.update({
      where: { id: workB }, data: { deletedAt: new Date(), deletedById: ownerId },
    }))
    await expect(moveProjects(session(), {
      workIds: [workA, workB], targetProjectId: target,
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    const first = await prisma.project.findUniqueOrThrow({ where: { id: workA } })
    const second = await prisma.project.findUniqueOrThrow({ where: { id: workB } })
    expect(first.workId).toBe(sourceA)
    expect(first.deletedAt).toBeNull()
    expect(second.workId).toBe(sourceB)
    expect(second.deletedAt).not.toBeNull()
    expect(await prisma.project.count({ where: { workId: target } })).toBe(0)
  })
})
