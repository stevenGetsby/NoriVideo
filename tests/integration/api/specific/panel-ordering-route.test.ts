import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'storyboard-user' } },
    project: { id: projectId, userId: 'manager-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const assignmentSyncMock = vi.hoisted(() => vi.fn(async () => undefined))

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(async () => ({ id: 'novel-project-1' })),
  },
  novelPromotionPanel: {
    findFirst: vi.fn(),
    delete: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
    count: vi.fn(async () => 0),
  },
  novelPromotionStoryboard: {
    update: vi.fn(async () => ({})),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/assignments', () => ({
  syncProjectAssignmentsForProject: assignmentSyncMock,
}))
vi.mock('@/lib/novel-promotion/panel-ai-data-sync', () => ({
  serializeStructuredJsonField: vi.fn((value: unknown) => (
    value == null ? null : typeof value === 'string' ? value : JSON.stringify(value)
  )),
}))

import { DELETE, PATCH } from '@/app/api/novel-promotion/[projectId]/panel/route'

const context = { params: Promise.resolve({ projectId: 'project-1' }) }

describe('panel delete and ordering route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'novel-project-1' })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
  })

  it('deletes a panel atomically, compacts every later index, and refreshes the storyboard count', async () => {
    prismaMock.novelPromotionPanel.findFirst
      .mockResolvedValueOnce({ id: 'panel-2', storyboardId: 'storyboard-1', panelIndex: 1 })
      .mockResolvedValueOnce({ panelIndex: 3 })
    prismaMock.novelPromotionPanel.count.mockResolvedValueOnce(3)

    const response = await DELETE(buildMockRequest({
      path: '/api/novel-promotion/project-1/panel',
      method: 'DELETE',
      query: { panelId: 'panel-2' },
    }), context)

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1', ['storyboardWrite'])
    expect(prismaMock.novelPromotionPanel.delete).toHaveBeenCalledWith({ where: { id: 'panel-2' } })
    expect(prismaMock.novelPromotionPanel.updateMany).toHaveBeenNthCalledWith(1, {
      where: { storyboardId: 'storyboard-1', panelIndex: { gt: 1 } },
      data: { panelIndex: { increment: 1003 }, panelNumber: { increment: 1003 } },
    })
    expect(prismaMock.novelPromotionPanel.updateMany).toHaveBeenNthCalledWith(2, {
      where: { storyboardId: 'storyboard-1', panelIndex: { gt: 1004 } },
      data: { panelIndex: { decrement: 1004 }, panelNumber: { decrement: 1004 } },
    })
    expect(prismaMock.novelPromotionStoryboard.update).toHaveBeenCalledWith({
      where: { id: 'storyboard-1' },
      data: { panelCount: 3 },
    })
    expect(assignmentSyncMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceOwnerId: 'storyboard-user',
    })
  })

  it('moves a segment by swapping with the nearest sibling without violating the unique index', async () => {
    prismaMock.novelPromotionPanel.findFirst
      .mockResolvedValueOnce({ id: 'panel-3', storyboardId: 'storyboard-1', panelIndex: 2 })
      .mockResolvedValueOnce({ id: 'panel-2', storyboardId: 'storyboard-1', panelIndex: 1 })

    const response = await PATCH(buildMockRequest({
      path: '/api/novel-promotion/project-1/panel',
      method: 'PATCH',
      body: { panelId: 'panel-3', reorderDirection: 'up' },
    }), context)
    const payload = await response.json() as { changed?: boolean }

    expect(response.status).toBe(200)
    expect(payload.changed).toBe(true)
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenNthCalledWith(2, {
      where: { storyboardId: 'storyboard-1', panelIndex: { lt: 2 } },
      orderBy: { panelIndex: 'desc' },
    })
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'panel-3' },
      data: { panelIndex: 10002, panelNumber: 10003 },
    })
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'panel-2' },
      data: { panelIndex: 2, panelNumber: 3 },
    })
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'panel-3' },
      data: { panelIndex: 1, panelNumber: 2 },
    })
  })
})
