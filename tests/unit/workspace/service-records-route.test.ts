import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const serviceMock = vi.hoisted(() => ({
  buildServiceRecordsOverview: vi.fn(async () => ({
    success: true,
    tasks: [],
  })),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/workspace/service-records', () => serviceMock)

describe('/api/service-records', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes bounded task limit query to service records overview', async () => {
    const { GET } = await import('@/app/api/service-records/route')

    const response = await GET(
      new NextRequest('http://localhost/api/service-records?limit=25') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ success: true, tasks: [] })
    expect(serviceMock.buildServiceRecordsOverview).toHaveBeenCalledWith('user-1', { limit: 25 })
  })
})
