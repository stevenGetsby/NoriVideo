import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const requireAdminAuthMock = vi.hoisted(() => vi.fn())
const logInfoMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  balanceTransaction: { groupBy: vi.fn(), findMany: vi.fn() },
}))

vi.mock('@/lib/api-auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 }),
  notFound: (resource: string) => Response.json({ error: `${resource} not found` }, { status: 404 }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/logging/core')>()),
  logInfo: logInfoMock,
}))

import { GET as getOverview } from '@/app/api/admin/activity/route'
import { GET as getDetail } from '@/app/api/admin/activity/[userId]/route'

const account = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `name-${id}`,
  role: 'writer',
  roleLabel: null,
  status: 'active',
  workspaceOwnerId: 'admin-1',
  parentAccountId: 'admin-1',
  lastLoginAt: null,
  ...overrides,
})

function adminSession(role = 'admin') {
  requireAdminAuthMock.mockResolvedValue({ session: { user: { id: 'admin-1', actorId: 'admin-1', role } } })
}

function sqlText(query: unknown) {
  const sql = query as { sql?: string; strings?: string[] }
  return sql.sql ?? (sql.strings || []).join('?')
}

describe('admin activity routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminSession()
    prismaMock.user.findMany.mockResolvedValue([
      account('sub-a'),
      account('sub-b', { status: 'disabled' }),
      account('sub-deleted', { status: 'deleted' }),
      account('other-ws', { parentAccountId: 'admin-2', workspaceOwnerId: 'admin-2' }),
      account('admin-peer', { role: 'admin' }),
      account('admin-1', { role: 'admin', parentAccountId: null, workspaceOwnerId: null }),
    ])
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'sub-b', _sum: { amount: -0.2 } }])
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      { amount: -0.5, billingMeta: JSON.stringify({ quotaUserId: 'sub-a' }) },
      { amount: -9, billingMeta: JSON.stringify({ quotaUserId: 'other-ws' }) },
      { amount: -9, billingMeta: '{broken' },
    ])
    prismaMock.$queryRaw.mockImplementation(async (query: unknown) => {
      const text = sqlText(query)
      if (text.includes('JOIN tasks')) return [{ actorId: 'sub-a', produced: BigInt(4), kept: BigInt(3) }]
      if (text.includes("m.source = 'upload'") && text.includes('GROUP BY m.ownerName')) {
        return [{ ownerName: 'name-sub-a', type: 'image', n: BigInt(3), uniqueN: BigInt(2), lastAt: new Date('2026-11-11T01:00:00Z') }]
      }
      if (text.includes('GROUP BY') && text.includes('t.status')) {
        return [
          { actorId: 'sub-a', type: 'toolbox_image', status: 'completed', n: BigInt(5), retried: BigInt(1), lastAt: new Date('2026-11-11T02:00:00Z') },
          { actorId: 'sub-a', type: 'toolbox_video', status: 'completed', n: BigInt(2), retried: BigInt(0), lastAt: new Date('2026-11-11T03:00:00Z') },
          { actorId: 'sub-a', type: 'toolbox_video', status: 'failed', n: BigInt(1), retried: BigInt(1), lastAt: new Date('2026-11-11T03:30:00Z') },
          { actorId: 'someone-else', type: 'toolbox_image', status: 'completed', n: BigInt(99), retried: BigInt(0), lastAt: null },
        ]
      }
      return []
    })
  })

  it('rejects non-admin callers and super admins', async () => {
    requireAdminAuthMock.mockResolvedValueOnce(Response.json({ error: 'nope' }, { status: 403 }))
    expect((await getOverview(buildMockRequest({ path: '/api/admin/activity', method: 'GET' }), {} as never)).status).toBe(403)

    adminSession('super_admin')
    expect((await getOverview(buildMockRequest({ path: '/api/admin/activity', method: 'GET' }), {} as never)).status).toBe(403)
    expect((await getDetail(
      buildMockRequest({ path: '/api/admin/activity/sub-a', method: 'GET' }),
      { params: Promise.resolve({ userId: 'sub-a' }) },
    )).status).toBe(403)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('rejects unknown ranges', async () => {
    const response = await getOverview(buildMockRequest({ path: '/api/admin/activity', method: 'GET', query: { range: '90d' } }), {} as never)
    expect(response.status).toBe(400)
  })

  it('only reports direct subaccounts of the calling admin and keeps generation and uploads separate', async () => {
    const response = await getOverview(buildMockRequest({ path: '/api/admin/activity', method: 'GET', query: { range: '7d' } }), {} as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = await response.json()
    expect(body.rows.map((item: { userId: string }) => item.userId)).toEqual(['sub-a', 'sub-b'])
    const [a, b] = body.rows
    expect(a.generated).toEqual({ image: 5, video: 2, audio: 0, total: 7 })
    expect(a.uploaded).toEqual({ image: 3, video: 0, audio: 0, total: 3 })
    expect(a.uploadedUnique).toBe(2)
    expect(a.failed).toBe(1)
    expect(a.retried).toBe(2)
    expect(a.points).toBe(50)
    expect(a.producedAssets).toBe(4)
    expect(a.keptAssets).toBe(3)
    expect(b.status).toBe('disabled')
    expect(b.points).toBe(20)
    expect(b.generated.total).toBe(0)
    expect(body.summary.accounts).toBe(2)
    expect(body.summary.generated.total).toBe(7)
  })

  it('scopes SQL to the admin wallet and the listed subaccounts only', async () => {
    await getOverview(buildMockRequest({ path: '/api/admin/activity', method: 'GET' }), {} as never)
    const params = prismaMock.$queryRaw.mock.calls.flatMap(([query]) => (query as { values: unknown[] }).values)
    expect(params).toContain('admin-1')
    expect(params).toContain('sub-a')
    expect(params).not.toContain('other-ws')
    expect(params).not.toContain('admin-peer')
    expect(params).not.toContain('sub-deleted')
  })

  it('exports CSV and writes an audit log', async () => {
    const response = await getOverview(buildMockRequest({ path: '/api/admin/activity', method: 'GET', query: { range: 'today', format: 'csv' } }), {} as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain('work-activity-today-')
    const text = await response.text()
    expect(text).toContain('name-sub-a,正常')
    expect(logInfoMock).toHaveBeenCalledWith('[ActivityAudit] export', expect.objectContaining({ operatorUserId: 'admin-1', range: 'today' }))
  })

  it('returns detail for a member and audits the view', async () => {
    const response = await getDetail(
      buildMockRequest({ path: '/api/admin/activity/sub-a', method: 'GET', query: { range: 'today' } }),
      { params: Promise.resolve({ userId: 'sub-a' }) },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.row.userId).toBe('sub-a')
    expect(body.trend).toHaveLength(14)
    expect(body.hours).toHaveLength(24)
    expect(logInfoMock).toHaveBeenCalledWith('[ActivityAudit] view', { operatorUserId: 'admin-1', targetUserId: 'sub-a', range: 'today' })
  })

  it('answers 404 without auditing for accounts outside the workspace', async () => {
    for (const userId of ['other-ws', 'admin-peer', 'sub-deleted', 'admin-1', 'missing']) {
      const response = await getDetail(
        buildMockRequest({ path: `/api/admin/activity/${userId}`, method: 'GET' }),
        { params: Promise.resolve({ userId }) },
      )
      expect(response.status).toBe(404)
    }
    expect(logInfoMock).not.toHaveBeenCalled()
  })
})
