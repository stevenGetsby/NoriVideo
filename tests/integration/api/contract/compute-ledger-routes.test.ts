import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTE_CATALOG } from '../../../contracts/route-catalog'
import { buildMockRequest } from '../../../helpers/request'

const requireAdminAuthMock = vi.hoisted(() => vi.fn())
const requireUserAuthMock = vi.hoisted(() => vi.fn())

const entriesMock = vi.hoisted(() => ({
  listEntries: vi.fn(),
  createEntry: vi.fn(),
  replaceEntry: vi.fn(),
  voidEntry: vi.fn(),
}))
const importServiceMock = vi.hoisted(() => ({ runImport: vi.fn(), rollbackImport: vi.fn() }))
const overviewMock = vi.hoisted(() => ({ getOverview: vi.fn() }))
const projectsMock = vi.hoisted(() => ({
  archiveLedgerProject: vi.fn(),
  patchLedgerProject: vi.fn(),
  createLedgerProject: vi.fn(),
  listWorkCandidates: vi.fn(),
  listProjectOptions: vi.fn(),
}))
const reportMock = vi.hoisted(() => ({ getReport: vi.fn(), getReportFull: vi.fn() }))
const settingsMock = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn() }))
const syncMock = vi.hoisted(() => ({ syncPlatformFacts: vi.fn(), getOrCreateSetting: vi.fn() }))
const meMock = vi.hoisted(() => ({ getMe: vi.fn() }))

vi.mock('@/lib/api-auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
  requireUserAuth: requireUserAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
  forbidden: (message = 'Forbidden') => new Response(
    JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message } }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  ),
}))
vi.mock('@/lib/compute-ledger/entries', () => entriesMock)
vi.mock('@/lib/compute-ledger/import-service', () => importServiceMock)
vi.mock('@/lib/compute-ledger/overview', () => overviewMock)
vi.mock('@/lib/compute-ledger/projects', () => projectsMock)
vi.mock('@/lib/compute-ledger/report', () => reportMock)
vi.mock('@/lib/compute-ledger/settings', () => settingsMock)
vi.mock('@/lib/compute-ledger/sync', () => syncMock)
vi.mock('@/lib/compute-ledger/me', () => meMock)

const adminSession = { user: { id: 'admin-1', actorId: 'admin-1', role: 'admin', workspaceOwnerId: 'admin-1' } }
const memberSession = { user: { id: 'member-1', actorId: 'member-1', role: 'writer', workspaceOwnerId: 'admin-1' } }
const superAdminSession = { user: { id: 'sa-1', actorId: 'sa-1', role: 'super_admin', workspaceOwnerId: null } }

const unauthorized = () => new Response(
  JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED' } }),
  { status: 401, headers: { 'content-type': 'application/json' } },
)

const emptyContext = { params: Promise.resolve({ id: 'x' }) }

const ledgerRouteFiles = ROUTE_CATALOG
  .filter((entry) => entry.routeFile.includes('compute-ledger'))
  .map((entry) => entry.routeFile)

function pathFor(routeFile: string): string {
  return routeFile
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[id\]/g, 'x')
}

async function callRoute(routeFile: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', options: { query?: Record<string, string>; body?: unknown } = {}) {
  const modulePath = `@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
  const route = await import(modulePath)
  const handler = route[method] as (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>
  return handler(buildMockRequest({
    path: pathFor(routeFile),
    method,
    ...(options.query ? { query: options.query } : {}),
    ...(method !== 'GET' ? { body: options.body ?? {} } : {}),
  }), emptyContext)
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminAuthMock.mockResolvedValue({ session: adminSession })
  requireUserAuthMock.mockResolvedValue({ session: memberSession })
  overviewMock.getOverview.mockResolvedValue({
    currency: 'CNY', asOf: '2026-05-11', range: { from: null, to: null },
    sync: { complete: true, syncedThroughDate: '2026-05-11', billingMode: 'ENFORCE' },
    rates: { tokenRateCnyPerMillion: 46, jimengCnyPerPoint: 0.1 },
    totals: { totalCny: 0, periodCny: 0, platformCny: 0, externalCny: 0, budgetCny: 0, overCount: 0, warnCount: 0 },
    rows: [],
  })
  meMock.getMe.mockResolvedValue({ totalCny: 0, days: [], entries: [] })
  entriesMock.createEntry.mockResolvedValue({ id: 'e1', amountCny: 46 })
  entriesMock.replaceEntry.mockResolvedValue({ id: 'e1', amountCny: 46 })
  entriesMock.voidEntry.mockResolvedValue({ id: 'e1', voidedAt: '2026-05-11T00:00:00.000Z' })
  entriesMock.listEntries.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 100 })
  projectsMock.createLedgerProject.mockResolvedValue({ id: 'lp1', name: 'P', workId: null })
  projectsMock.listProjectOptions.mockResolvedValue([{ id: 'lp1', name: 'P' }])
  projectsMock.listWorkCandidates.mockResolvedValue([])
  syncMock.getOrCreateSetting.mockResolvedValue({ tokenRateCnyPerMillion: 46, jimengCnyPerPoint: 0.1 })
  syncMock.syncPlatformFacts.mockResolvedValue({ complete: true, syncedThroughDate: '2026-05-11' })
  importServiceMock.runImport.mockResolvedValue({ mode: 'dry-run', reportHash: 'hash-1', summary: { rows: 0 } })
  reportMock.getReport.mockResolvedValue({ view: 'day', rows: [], footer: { totalCny: 0 }, range: { from: null, to: null } })
  settingsMock.getSettings.mockResolvedValue({ tokenRateCnyPerMillion: 46, jimengCnyPerPoint: 0.1 })
})

describe('compute-ledger route registration', () => {
  it('registers all ten admin and four member ledger routes in the catalog', () => {
    expect(ledgerRouteFiles).toHaveLength(14)
    expect(ledgerRouteFiles.filter((f) => f.startsWith('src/app/api/admin/compute-ledger/'))).toHaveLength(10)
    expect(ledgerRouteFiles.filter((f) => f.startsWith('src/app/api/compute-ledger/'))).toHaveLength(4)
  })
})

describe('compute-ledger auth gating', () => {
  it('returns 401 for every ledger route when the session is missing', async () => {
    requireAdminAuthMock.mockResolvedValue(unauthorized())
    requireUserAuthMock.mockResolvedValue(unauthorized())
    for (const routeFile of ledgerRouteFiles) {
      const route = await import(`@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`)
      const method = (['GET', 'POST', 'PATCH', 'DELETE'] as const).find((m) => typeof route[m] === 'function')!
      const response = await callRoute(routeFile, method)
      expect(response.status, routeFile).toBe(401)
    }
  })

  it('rejects platform super admins on admin ledger routes with 403', async () => {
    requireAdminAuthMock.mockResolvedValue({ session: superAdminSession })
    const response = await callRoute('src/app/api/admin/compute-ledger/overview/route.ts', 'GET')
    expect(response.status).toBe(403)
    expect(overviewMock.getOverview).not.toHaveBeenCalled()
  })

  it('rejects non-admin members on admin ledger routes with 403', async () => {
    requireAdminAuthMock.mockResolvedValue({ session: memberSession })
    const response = await callRoute('src/app/api/admin/compute-ledger/projects/route.ts', 'POST')
    expect(response.status).toBe(403)
    expect(projectsMock.createLedgerProject).not.toHaveBeenCalled()
  })

  it('rejects platform super admins on member ledger routes with 403', async () => {
    requireUserAuthMock.mockResolvedValue({ session: superAdminSession })
    const response = await callRoute('src/app/api/compute-ledger/me/route.ts', 'GET')
    expect(response.status).toBe(403)
    expect(meMock.getMe).not.toHaveBeenCalled()
  })
})

describe('member ledger routes', () => {
  it('serves the personal ledger and forwards the parsed date range', async () => {
    const response = await callRoute('src/app/api/compute-ledger/me/route.ts', 'GET', { query: { from: '2026-05-01', to: '2026-05-11' } })
    expect(response.status).toBe(200)
    expect(meMock.getMe).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'admin-1', actorId: 'member-1', isAdmin: false }),
      '2026-05-01',
      '2026-05-11',
    )
  })

  it('rejects a personal range longer than 93 days', async () => {
    const response = await callRoute('src/app/api/compute-ledger/me/route.ts', 'GET', { query: { from: '2026-01-01', to: '2026-05-11' } })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'INVALID_PARAMS' } })
  })

  it('creates a manual entry bound to the session actor context', async () => {
    const response = await callRoute('src/app/api/compute-ledger/entries/route.ts', 'POST', {
      body: { ledgerProjectId: 'lp1', dateKey: '2026-05-11', kind: 'api_token', quantity: 1_000_000, actorUserId: 'member-1' },
    })
    expect(response.status).toBe(200)
    expect(entriesMock.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'member-1', isAdmin: false }),
      expect.objectContaining({ ledgerProjectId: 'lp1', kind: 'api_token', quantity: 1_000_000 }),
    )
  })

  it('voids an entry by id through the member context', async () => {
    const response = await callRoute('src/app/api/compute-ledger/entries/[id]/route.ts', 'DELETE')
    expect(response.status).toBe(200)
    expect(entriesMock.voidEntry).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'member-1' }), 'x')
  })

  it('returns project options together with the current rates', async () => {
    const response = await callRoute('src/app/api/compute-ledger/project-options/route.ts', 'GET')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      projects: [{ id: 'lp1', name: 'P' }],
      rates: { tokenRateCnyPerMillion: 46, jimengCnyPerPoint: 0.1 },
    })
  })
})

describe('admin overview route', () => {
  it('returns the overview envelope for an admin', async () => {
    const response = await callRoute('src/app/api/admin/compute-ledger/overview/route.ts', 'GET')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ currency: 'CNY', sync: { billingMode: 'ENFORCE' } })
    expect(overviewMock.getOverview).toHaveBeenCalledWith('admin-1', expect.objectContaining({ includeArchived: false, refresh: false }))
  })

  it('streams a UTF-8 CSV when format=csv', async () => {
    const response = await callRoute('src/app/api/admin/compute-ledger/overview/route.ts', 'GET', { query: { format: 'csv' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8').decode(bytes)).toContain('项目名称')
  })

  it('rejects an invalid date and an unknown category with 400', async () => {
    const badDate = await callRoute('src/app/api/admin/compute-ledger/overview/route.ts', 'GET', { query: { from: '2026-13-40' } })
    expect(badDate.status).toBe(400)
    const badCategory = await callRoute('src/app/api/admin/compute-ledger/overview/route.ts', 'GET', { query: { category: 'bogus' } })
    expect(badCategory.status).toBe(400)
    expect(overviewMock.getOverview).not.toHaveBeenCalled()
  })
})

describe('admin report route', () => {
  it('rejects an unknown view and a non-positive page', async () => {
    const badView = await callRoute('src/app/api/admin/compute-ledger/report/route.ts', 'GET', { query: { view: 'month' } })
    expect(badView.status).toBe(400)
    const badPage = await callRoute('src/app/api/admin/compute-ledger/report/route.ts', 'GET', { query: { page: '0' } })
    expect(badPage.status).toBe(400)
  })

  it('serves the day report by default', async () => {
    const response = await callRoute('src/app/api/admin/compute-ledger/report/route.ts', 'GET')
    expect(response.status).toBe(200)
    expect(reportMock.getReport).toHaveBeenCalledWith('admin-1', expect.objectContaining({ view: 'day' }))
  })
})

describe('admin import route', () => {
  it('rejects an unknown mode and a missing payload.rows array', async () => {
    const badMode = await callRoute('src/app/api/admin/compute-ledger/import/route.ts', 'POST', { body: { mode: 'live', carryForward: 'none', payload: { rows: [] } } })
    expect(badMode.status).toBe(400)
    const badPayload = await callRoute('src/app/api/admin/compute-ledger/import/route.ts', 'POST', { body: { mode: 'dry-run', carryForward: 'none', payload: {} } })
    expect(badPayload.status).toBe(400)
    expect(importServiceMock.runImport).not.toHaveBeenCalled()
  })

  it('runs a dry-run plan and returns the report', async () => {
    const response = await callRoute('src/app/api/admin/compute-ledger/import/route.ts', 'POST', {
      body: { mode: 'dry-run', carryForward: 'none', payload: { rows: [] } },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ mode: 'dry-run', reportHash: 'hash-1' })
    expect(importServiceMock.runImport).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'admin-1', isAdmin: true }),
      expect.objectContaining({ mode: 'dry-run', carryForward: 'none' }),
    )
  })
})

describe('admin project routes', () => {
  it('creates a ledger project and returns its id/name/workId', async () => {
    const response = await callRoute('src/app/api/admin/compute-ledger/projects/route.ts', 'POST', { body: { name: 'P' } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ id: 'lp1', name: 'P', workId: null })
    expect(projectsMock.createLedgerProject).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'admin-1' }),
      expect.objectContaining({ name: 'P' }),
    )
  })
})
