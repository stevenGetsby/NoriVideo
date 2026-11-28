import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ requireUserAuth: vi.fn(), isErrorResponse: (value: unknown) => value instanceof Response }))
const access = vi.hoisted(() => ({ getWorkspaceActor: vi.fn(), projectReadWhere: vi.fn(() => ({ id: 'project-1' })) }))
const service = vi.hoisted(() => ({ getBatchRunById: vi.fn() }))
const materialize = vi.hoisted(() => ({ materializeBatchItemToCanvas: vi.fn() }))
const db = vi.hoisted(() => ({ project: { findFirst: vi.fn() } }))
vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/collaboration/access', () => access)
vi.mock('@/lib/batch-workflow/service', () => service)
vi.mock('@/lib/batch-workflow/materialize-canvas', () => materialize)
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/account/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/account/request-context')>()),
  setAccountActorContext: vi.fn(),
}))

import { POST } from '@/app/api/batch-workflow/runs/[runId]/items/[itemId]/materialize-canvas/route'

const context = { params: Promise.resolve({ runId: 'run-1', itemId: 'item-1' }) }
function request(body: unknown) {
  return new NextRequest('http://localhost/api/batch-workflow/runs/run-1/items/item-1/materialize-canvas', {
    method: 'POST', body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireUserAuth.mockResolvedValue({ session: { user: { id: 'u-1' } } })
  access.getWorkspaceActor.mockReturnValue({ actorId: 'u-1', workspaceOwnerId: 'owner-1' })
  service.getBatchRunById.mockResolvedValue({ id: 'run-1', projectId: 'project-1' })
  db.project.findFirst.mockResolvedValue({ id: 'project-1' })
  materialize.materializeBatchItemToCanvas.mockResolvedValue({
    canvasId: 'canvas-1', projectId: 'project-1', href: '/canvas/project-1/canvas-1', reused: true,
    nodeCount: 3, edgeCount: 2, fingerprint: 'new', canvasFingerprint: 'old', stale: true,
    synced: true, updatedNodeCount: 2, skippedShots: [{ shotId: 'shot-2', reason: 'not_ready' }],
    item: { id: 'item-1', revision: 4 },
  })
})

describe('materialize-canvas route', () => {
  it('forwards mode and expectedRevision and exposes sync response fields', async () => {
    const response = await POST(request({ mode: 'sync', expectedRevision: 3 }), context)
    expect(response.status).toBe(200)
    expect(materialize.materializeBatchItemToCanvas).toHaveBeenCalledWith({
      workspaceOwnerId: 'owner-1', actorId: 'u-1', batchRunId: 'run-1', itemId: 'item-1',
      forceNew: false, mode: 'sync', expectedRevision: 3,
    })
    await expect(response.json()).resolves.toMatchObject({
      canvasId: 'canvas-1', reused: true, stale: true, fingerprint: 'new', canvasFingerprint: 'old',
      synced: true, updatedNodeCount: 2, skippedShots: [{ shotId: 'shot-2', reason: 'not_ready' }],
      item: { revision: 4 },
    })
  })

  it.each([{ mode: 'overwrite' }, { expectedRevision: -1 }, { expectedRevision: 1.2 }, { forceNew: 'yes' }])('rejects invalid params: %j', async (body) => {
    const response = await POST(request(body), context)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(materialize.materializeBatchItemToCanvas).not.toHaveBeenCalled()
  })

  it('keeps project permission checks and rejects an inaccessible project', async () => {
    db.project.findFirst.mockResolvedValue(null)
    const response = await POST(request({ mode: 'check' }), context)
    expect(response.status).toBe(404)
    expect(access.projectReadWhere).toHaveBeenCalled()
    expect(materialize.materializeBatchItemToCanvas).not.toHaveBeenCalled()
  })
})
