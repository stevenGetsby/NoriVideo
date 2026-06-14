import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.hoisted(() => vi.fn(async () => ({
  user: { id: 'user-1', name: 'User 1', email: 'user1@test.local' },
})))

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  project: {
    findFirst: vi.fn(),
  },
}))

vi.mock('next-auth/next', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: vi.fn(() => ''),
  })),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: async <T>(operation: () => Promise<T>) => operation(),
}))

vi.mock('@/lib/test-mode', () => ({
  getOrCreateTestModeSession: vi.fn(),
  isTestModeEnabled: vi.fn(() => false),
}))

vi.mock('@/lib/config-service', () => ({
  extractModelKey: (value: unknown) => value,
}))

describe('project auth scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' })
  })

  it('scopes light project auth lookup by current user and returns not found on scoped miss', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const { requireProjectAuthLight } = await import('@/lib/api-auth')

    const result = await requireProjectAuthLight('project-other')
    const body = await (result as Response).json() as { error?: { code?: string } }

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(404)
    expect(body.error?.code).toBe('NOT_FOUND')
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-other',
        userId: 'user-1',
      },
    })
  })

  it('scopes full project auth lookup by current user before loading novel promotion data', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1',
      userId: 'user-1',
      name: 'Project 1',
      novelPromotionData: {
        id: 'novel-project-1',
        analysisModel: 'openai::gpt-4o-mini',
      },
    })
    const { requireProjectAuth, isErrorResponse } = await import('@/lib/api-auth')

    const result = await requireProjectAuth('project-1', {
      include: { characters: true, episodes: true },
    })

    expect(isErrorResponse(result)).toBe(false)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
      },
      include: {
        novelPromotionData: {
          include: {
            characters: true,
            episodes: true,
          },
        },
      },
    })
  })
})
