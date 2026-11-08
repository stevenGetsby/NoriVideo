import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { buildMockRequest } from '../../helpers/request'

const enabled = process.env.NORI_ASSETS_DB_TEST === '1'
const state = vi.hoisted(() => ({ owner: '', member: '', failCanvas: false }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-auth')>()
  return {
    ...original,
    requireUserAuth: async () => ({ session: {
      user: { id: state.member, actorId: state.member, workspaceOwnerId: state.owner, role: 'writer', permissions: [], projectLeader: false },
    } }),
  }
})
vi.mock('@/lib/prisma', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/prisma')>()
  const client = original.prisma
  return { prisma: new Proxy(client, {
    get(target, key) {
      if (key === '$transaction') {
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { timeout?: number }) => client.$transaction((tx) => callback(new Proxy(tx, {
          get(transaction, name) {
            if (name === 'canvas') return new Proxy(transaction.canvas, {
              get(delegate, method) {
                if (method === 'create' && state.failCanvas) return async () => { throw new Error('Injected canvas storage failure') }
                const value = Reflect.get(delegate, method)
                return typeof value === 'function' ? value.bind(delegate) : value
              },
            })
            const value = Reflect.get(transaction, name)
            return typeof value === 'function' ? value.bind(transaction) : value
          },
        })), options)
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) }
})
vi.mock('@/lib/logging/core', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), event: vi.fn() }),
}))

import { POST } from '@/app/api/projects/route'

describe.skipIf(!enabled)('canvas-first work creation against disposable real MySQL', () => {
  let workId = ''

  beforeEach(async () => {
    const database = new URL(process.env.DATABASE_URL || '')
    if (database.hostname !== '127.0.0.1' || database.port !== '33079' || database.pathname !== '/nori_assets_check') {
      throw new Error('Refusing project creation fixtures outside the disposable MySQL database')
    }
    state.owner = `owner-${randomUUID()}`
    state.member = `member-${randomUUID()}`
    state.failCanvas = false
    await prisma.user.create({ data: { id: state.owner, name: state.owner, role: 'admin' } })
    await prisma.user.create({ data: { id: state.member, name: state.member, role: 'writer', workspaceOwnerId: state.owner } })
    const work = await prisma.work.create({ data: { name: `事务测试项目-${randomUUID()}`, workspaceOwnerId: state.owner, createdById: state.owner } })
    workId = work.id
    await prisma.workMember.create({ data: { workId, userId: state.member } })
  })

  afterEach(async () => {
    state.failCanvas = false
    if (state.owner) {
      await prisma.project.deleteMany({ where: { userId: state.owner } })
      await prisma.work.deleteMany({ where: { workspaceOwnerId: state.owner } })
      await prisma.user.delete({ where: { id: state.owner } })
    }
    workId = ''
    state.owner = ''
    state.member = ''
  })

  afterAll(async () => { await prisma.$disconnect() })

  async function create(creationMode: 'canvas' | 'workflow') {
    return POST(buildMockRequest({ path: '/api/projects', method: 'POST', body: { name: '事务测试作品', workId, creationMode } }), { params: Promise.resolve({}) })
  }

  it('persists the work, creator membership and blank canvas together for a project member', async () => {
    const response = await create('canvas')
    expect(response.status).toBe(201)
    const payload = await response.json()
    const project = await prisma.project.findUniqueOrThrow({ where: { id: payload.project.id }, include: { members: true, canvases: true, novelPromotionData: true } })
    expect(project.createdById).toBe(state.member)
    expect(project.members.map((item) => item.userId)).toEqual([state.member])
    expect(project.canvases).toHaveLength(1)
    expect(project.novelPromotionData).not.toBeNull()
  })

  it('rolls back the work, membership and workflow config if canvas creation fails', async () => {
    state.failCanvas = true
    const response = await create('canvas')
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(await prisma.project.count({ where: { userId: state.owner } })).toBe(0)
    expect(await prisma.projectMember.count({ where: { userId: state.member } })).toBe(0)
    expect(await prisma.canvas.count({ where: { userId: state.member } })).toBe(0)
    expect(await prisma.novelPromotionProject.count({ where: { project: { userId: state.owner } } })).toBe(0)
  })

  it('keeps the workflow creation path free of an implicit canvas', async () => {
    expect((await create('workflow')).status).toBe(201)
    expect(await prisma.canvas.count({ where: { userId: state.member } })).toBe(0)
    expect(await prisma.novelPromotionProject.count({ where: { project: { userId: state.owner } } })).toBe(1)
  })
})
