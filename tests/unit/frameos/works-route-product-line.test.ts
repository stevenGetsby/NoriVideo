import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const serviceMock = vi.hoisted(() => ({
  listWorks: vi.fn(),
  createWork: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/works/service', () => serviceMock)

const session = { user: { id: 'owner-1', actorId: 'member-1', workspaceOwnerId: 'owner-1' } }
const routeContext = { params: Promise.resolve({}) }

function request(productLine?: string) {
  return buildMockRequest({
    path: '/api/works',
    method: 'GET',
    query: productLine === undefined ? undefined : { productLine },
  })
}

describe('GET /api/works product line filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    serviceMock.listWorks.mockResolvedValue({
      works: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    })
  })

  it('keeps the canvas default when productLine is absent', async () => {
    const { GET } = await import('@/app/api/works/route')
    const response = await GET(request(), routeContext)

    expect(response.status).toBe(200)
    expect(serviceMock.listWorks).toHaveBeenCalledWith(session, {
      page: null,
      pageSize: null,
      search: null,
    })
  })

  it('passes story and all through unchanged', async () => {
    const { GET } = await import('@/app/api/works/route')
    await GET(request('story'), routeContext)
    await GET(request('all'), routeContext)

    expect(serviceMock.listWorks).toHaveBeenNthCalledWith(1, session, {
      page: null,
      pageSize: null,
      search: null,
      productLine: 'story',
    })
    expect(serviceMock.listWorks).toHaveBeenNthCalledWith(2, session, {
      page: null,
      pageSize: null,
      search: null,
      productLine: 'all',
    })
  })

  it('rejects unknown product lines before touching the database', async () => {
    const { GET } = await import('@/app/api/works/route')
    const response = await GET(request('movie'), routeContext)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_PARAMS' },
    })
    expect(serviceMock.listWorks).not.toHaveBeenCalled()
  })
})
