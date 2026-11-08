import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { buildMockRequest } from '../../helpers/request'

const enabled = process.env.NORI_ASSETS_DB_TEST === '1'
const state = vi.hoisted(() => ({ owner: '', member: '' }))

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: async () => ({ session: {
    user: { id: state.owner, actorId: state.member, workspaceOwnerId: state.owner, role: 'writer', permissions: [], projectLeader: false },
  } }),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/logging/core', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), event: vi.fn() }),
}))

import { GET as readProjects } from '@/app/api/projects/route'
import { GET as readTransactions } from '@/app/api/user/transactions/route'

async function read(path: string) {
  const handler = path.startsWith('/api/user/') ? readTransactions : readProjects
  return handler(buildMockRequest({ path, method: 'GET' }), { params: Promise.resolve({}) })
}

describe.skipIf(!enabled)('shared project summary and billing scopes against disposable real MySQL', () => {
  let visibleProjectId = ''
  let hiddenProjectId = ''
  let visibleEpisodeId = ''
  let hiddenEpisodeId = ''

  beforeEach(async () => {
    const database = new URL(process.env.DATABASE_URL || '')
    if (database.hostname !== '127.0.0.1' || database.port !== '33079' || database.pathname !== '/nori_assets_check') {
      throw new Error('Refusing shared summary fixtures outside the disposable MySQL database')
    }
    state.owner = `owner-${randomUUID()}`
    state.member = `member-${randomUUID()}`
    const formerMember = `former-${randomUUID()}`
    const outsider = `outsider-${randomUUID()}`
    await prisma.user.createMany({ data: [
      { id: state.owner, name: state.owner, role: 'admin' },
      { id: state.member, name: state.member, role: 'writer', workspaceOwnerId: state.owner },
      { id: formerMember, name: formerMember, role: 'writer', workspaceOwnerId: state.owner },
      { id: outsider, name: outsider, role: 'writer', workspaceOwnerId: state.owner },
    ] })
    const visibleWork = await prisma.work.create({
      data: { name: '共享项目', workspaceOwnerId: state.owner, createdById: state.owner },
    })
    const hiddenWork = await prisma.work.create({
      data: { name: '隔离项目', workspaceOwnerId: state.owner, createdById: state.owner },
    })
    await prisma.workMember.createMany({ data: [
      { workId: visibleWork.id, userId: state.member },
      { workId: hiddenWork.id, userId: outsider },
    ] })
    const visibleProject = await prisma.project.create({
      data: { name: '共享作品', userId: state.owner, workId: visibleWork.id, createdById: formerMember },
    })
    const hiddenProject = await prisma.project.create({
      data: { name: '隔离作品', userId: state.owner, workId: hiddenWork.id, createdById: outsider },
    })
    visibleProjectId = visibleProject.id
    hiddenProjectId = hiddenProject.id
    const visibleNovel = await prisma.novelPromotionProject.create({ data: { projectId: visibleProjectId } })
    const hiddenNovel = await prisma.novelPromotionProject.create({ data: { projectId: hiddenProjectId } })
    visibleEpisodeId = (await prisma.novelPromotionEpisode.create({
      data: { novelPromotionProjectId: visibleNovel.id, episodeNumber: 3, name: '共享第三集' },
    })).id
    hiddenEpisodeId = (await prisma.novelPromotionEpisode.create({
      data: { novelPromotionProjectId: hiddenNovel.id, episodeNumber: 9, name: '隔离第九集' },
    })).id
    await prisma.usageCost.createMany({ data: [
      { projectId: visibleProjectId, userId: formerMember, apiType: 'image', model: 'image-model', action: 'image_panel', quantity: 1, unit: 'call', cost: 2.5 },
      { projectId: visibleProjectId, userId: state.owner, apiType: 'video', model: 'video-model', action: 'video_panel', quantity: 1, unit: 'call', cost: 1.5 },
      { projectId: hiddenProjectId, userId: outsider, apiType: 'video', model: 'video-model', action: 'video_panel', quantity: 1, unit: 'call', cost: 100 },
    ] })
    await prisma.workflowStageState.createMany({ data: [
      { projectId: visibleProjectId, userId: formerMember, stageKey: 'storyboard', status: 'failed', progress: 20, blocker: '旧成员失败', updatedAt: new Date('2026-11-08T09:00:00.000Z') },
      { projectId: visibleProjectId, userId: state.member, stageKey: 'storyboard', status: 'running', progress: 48, updatedAt: new Date('2026-11-08T10:00:00.000Z') },
      { projectId: hiddenProjectId, userId: outsider, stageKey: 'editor', status: 'failed', progress: 99, blocker: '不应读取', updatedAt: new Date('2026-11-08T11:00:00.000Z') },
    ] })
    await prisma.task.createMany({ data: [
      { projectId: visibleProjectId, userId: formerMember, type: 'image_panel', targetType: 'NovelPromotionPanel', targetId: 'panel-1', status: 'processing' },
      { projectId: hiddenProjectId, userId: outsider, type: 'video_panel', targetType: 'NovelPromotionPanel', targetId: 'panel-2', status: 'queued' },
    ] })
    await prisma.balanceTransaction.createMany({ data: [
      { userId: state.owner, type: 'consume', amount: -4, balanceAfter: 96, projectId: visibleProjectId, episodeId: visibleEpisodeId, taskType: 'video_panel', description: 'video_panel - model - ¥4' },
      { userId: state.owner, type: 'consume', amount: -100, balanceAfter: 0, projectId: hiddenProjectId, episodeId: hiddenEpisodeId, taskType: 'video_panel', description: 'video_panel - model - ¥100' },
    ] })
  })

  afterAll(async () => {
    if (state.owner) await prisma.user.delete({ where: { id: state.owner } })
    await prisma.$disconnect()
  })

  it('includes legacy child costs and latest stage rows without exposing another work', async () => {
    const response = await read('/api/projects?page=1&pageSize=12')
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.projects).toHaveLength(1)
    expect(payload.projects[0]).toMatchObject({
      id: visibleProjectId,
      totalCost: 4,
      workflowSummary: {
        currentStage: 'storyboard', status: 'running', progress: 48,
        activeTaskCount: 1, blockedStages: [], activeStages: ['storyboard'],
      },
    })
    expect(JSON.stringify(payload)).not.toContain(hiddenProjectId)
    expect(JSON.stringify(payload)).not.toContain('不应读取')
  })

  it('resolves only member-readable episode names and hides foreign references', async () => {
    const response = await read('/api/user/transactions?page=1&pageSize=20')
    expect(response.status).toBe(200)
    const payload = await response.json()
    const visible = payload.transactions.find((item: { projectId: string }) => item.projectId === visibleProjectId)
    const hidden = payload.transactions.find((item: { projectId: string }) => item.projectId === hiddenProjectId)
    expect(visible).toMatchObject({ projectName: '共享作品', episodeNumber: 3, episodeName: '共享第三集' })
    expect(hidden).toMatchObject({ projectName: null, episodeNumber: null, episodeName: null })
  })

  it('revokes shared aggregation immediately after work membership is removed', async () => {
    await prisma.workMember.deleteMany({ where: { work: { projects: { some: { id: visibleProjectId } } }, userId: state.member } })
    const projects = await (await read('/api/projects?page=1&pageSize=12')).json()
    expect(projects.projects).toEqual([])
    const billing = await (await read('/api/user/transactions?page=1&pageSize=20')).json()
    expect(billing.transactions.every((item: { projectName: string | null }) => item.projectName === null)).toBe(true)
    expect(billing.transactions.every((item: { episodeNumber: number | null }) => item.episodeNumber === null)).toBe(true)
  })
})
