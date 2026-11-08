import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import type { AuthSession } from '@/lib/api-auth'
import { buildMockRequest } from '../../helpers/request'

const enabled = process.env.NORI_ASSETS_DB_TEST === '1'
const state = vi.hoisted(() => ({ owner: '', leader: '', member: '', outsider: '' }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-auth')>()
  return {
    ...original,
    requireUserAuth: async () => ({ session: {
      user: { id: state.member, actorId: state.member, workspaceOwnerId: state.owner, role: 'writer', permissions: [], projectLeader: false },
    } }),
      requireProjectAuthLight: async (projectId: string) => {
      const session: AuthSession = {
        user: { id: state.member, actorId: state.member, workspaceOwnerId: state.owner, role: 'writer', permissions: [], projectLeader: false },
      }
      const { projectReadWhere } = await import('@/lib/collaboration/access')
      const project = await prisma.project.findFirst({ where: projectReadWhere(session, projectId) })
      if (!project) {
        const { NextResponse } = await import('next/server')
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
      }
      return { session, project }
    },
  }
})
vi.mock('@/lib/storage', () => ({
  extractStorageKey: (value: string | null) => value?.startsWith('test-assets/') ? value : null,
  getSignedUrl: (key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}`,
}))
vi.mock('@/lib/logging/core', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), event: vi.fn() }),
}))
vi.mock('@/lib/frameos/material-upload', () => ({ uploadFrameosMaterial: vi.fn() }))

import { GET } from '@/app/api/frameos/materials/route'

describe.skipIf(!enabled)('project asset boundaries against disposable real MySQL', () => {
  let sharedWork = ''
  let otherWork = ''
  let currentProject = ''
  let siblingProject = ''
  let otherProject = ''

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL || '')
    if (database.hostname !== '127.0.0.1' || database.port !== '33079' || database.pathname !== '/nori_assets_check') {
      throw new Error('Refusing project asset fixtures outside the disposable MySQL database')
    }
    state.owner = `owner-${randomUUID()}`
    state.leader = `leader-${randomUUID()}`
    state.member = `member-${randomUUID()}`
    state.outsider = `outsider-${randomUUID()}`
    await prisma.user.createMany({ data: [
      { id: state.owner, name: state.owner, role: 'admin' },
      { id: state.leader, name: state.leader, role: 'writer', projectLeader: true, workspaceOwnerId: state.owner },
      { id: state.member, name: state.member, role: 'writer', workspaceOwnerId: state.owner },
      { id: state.outsider, name: state.outsider, role: 'writer', workspaceOwnerId: state.owner },
    ] })
    const works = await Promise.all(['共享项目', '其他项目'].map((name) => prisma.work.create({
      data: { name, workspaceOwnerId: state.owner, createdById: state.leader },
    })))
    sharedWork = works[0].id
    otherWork = works[1].id
    await prisma.workMember.createMany({ data: [
      { workId: sharedWork, userId: state.member },
      { workId: otherWork, userId: state.outsider },
    ] })
    const projects = await Promise.all([
      { name: '当前作品', workId: sharedWork, createdById: state.leader },
      { name: '同项目第二作品', workId: sharedWork, createdById: state.leader },
      { name: '其他项目作品', workId: otherWork, createdById: state.leader },
    ].map((data) => prisma.project.create({ data: { ...data, userId: state.owner } })))
    currentProject = projects[0].id
    siblingProject = projects[1].id
    otherProject = projects[2].id
    await prisma.frameosMaterial.createMany({ data: [
      { userId: state.owner, projectId: currentProject, title: '当前角色', type: 'image', source: 'upload', metadata: { assetCategory: 'character', voiceMaterialId: 'sibling-voice' } },
      { id: 'sibling-voice', userId: state.owner, projectId: siblingProject, title: '同项目音色', type: 'audio', source: 'upload', resultUrl: 'test-assets/voice.mp3' },
      { userId: state.owner, projectId: otherProject, title: '其他项目角色', type: 'image', source: 'upload', metadata: { voiceMaterialId: 'sibling-voice' } },
      { userId: state.owner, projectId: 'global', title: '账号资产', type: 'image', source: 'upload' },
      { userId: state.owner, projectId: 'unknown-legacy', title: '无法确认归属旧资产', type: 'image', source: 'upload' },
    ] })
  })

  afterAll(async () => {
    if (state.owner) {
      await prisma.frameosMaterial.deleteMany({ where: { userId: state.owner } })
      await prisma.project.deleteMany({ where: { userId: state.owner } })
      await prisma.work.deleteMany({ where: { workspaceOwnerId: state.owner } })
      await prisma.user.delete({ where: { id: state.owner } })
    }
    await prisma.$disconnect()
  })

  async function readMaterials(query: string, actorId = state.member) {
    const previous = state.member
    state.member = actorId
    try {
      return await GET(buildMockRequest({ path: `/api/frameos/materials?${query}`, method: 'GET' }), { params: Promise.resolve({}) })
    } finally {
      state.member = previous
    }
  }

  it('shares assets and voices across only the two works in the current project', async () => {
    const response = await readMaterials(`workId=${sharedWork}&projectId=${currentProject}`)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.materials.map((item: { title: string }) => item.title).sort((a: string, b: string) => a.localeCompare(b, 'zh'))).toEqual(['当前角色', '同项目音色'])
    expect(payload.materials.find((item: { title: string }) => item.title === '当前角色').voice.title).toBe('同项目音色')
    expect(payload.projects.map((item: { id: string }) => item.id).sort()).toEqual([currentProject, siblingProject].sort())
  })

  it('returns 404 for a nonmember and for a cross-project pair without reading assets', async () => {
    const nonmember = await readMaterials(`workId=${sharedWork}`, state.outsider)
    expect(nonmember.status).toBe(404)
    expect((await nonmember.json()).materials).toBeUndefined()
    expect((await readMaterials(`workId=${otherWork}&projectId=${currentProject}`)).status).toBe(404)
    expect((await readMaterials(`projectId=${otherProject}&available=0`)).status).toBe(404)
  })

  it('never mixes account or unconfirmed legacy assets into a project scope', async () => {
    const response = await readMaterials(`workId=${sharedWork}&projectId=${currentProject}`)
    const payload = await response.json()
    expect(payload.materials.some((item: { projectId: string }) => item.projectId === 'global' || item.projectId === 'unknown-legacy')).toBe(false)
  })

  it('does not let a former work creator bypass current project membership', async () => {
    expect((await readMaterials(`workId=${sharedWork}&projectId=${currentProject}`, state.leader)).status).toBe(404)
  })

  it('revokes both work and asset access as soon as membership is removed', async () => {
    await prisma.workMember.deleteMany({ where: { workId: sharedWork, userId: state.member } })
    try {
      const scoped = await readMaterials(`workId=${sharedWork}&projectId=${currentProject}`)
      expect(scoped.status).toBe(404)
      expect((await scoped.json()).materials).toBeUndefined()
      expect((await readMaterials(`projectId=${currentProject}&available=0`)).status).toBe(404)
    } finally {
      await prisma.workMember.create({ data: { workId: sharedWork, userId: state.member } })
    }
  })

  it('keeps a sibling voice unavailable when explicitly reading a different project', async () => {
    const response = await readMaterials(`projectId=${otherProject}&available=0`, state.outsider)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.materials[0].title).toBe('其他项目角色')
    expect(payload.materials[0].voice).toBeNull()
  })
})
