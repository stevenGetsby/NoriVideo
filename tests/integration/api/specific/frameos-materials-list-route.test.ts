import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectParticipantWhere } from '@/lib/collaboration/access'
import { buildMockRequest } from '../../../helpers/request'

type Where = { [key: string]: unknown }

function compareCursorValues(left: unknown, right: unknown): number | null {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right)
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return null
}

function scalarMatches(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime()
  if (expected === null) return actual == null
  if (typeof expected !== 'object') return Object.is(actual, expected)
  if (actual === null || actual === undefined) return 'equals' in expected && scalarMatches(actual, (expected as Record<string, unknown>).equals)
  const operator = expected as Record<string, unknown>
  return Object.entries(operator).every(([key, operand]) => {
    if (key === 'in' || key === 'notIn') return (operand as unknown[]).includes(actual) === (key === 'in')
    if (key === 'not') return operand === null ? actual !== null : !scalarMatches(actual, operand)
    if (key === 'contains') return typeof actual === 'string' && actual.includes(String(operand))
    if (key === 'equals') return scalarMatches(actual, operand)
    if (key === 'gt' || key === 'lt' || key === 'gte' || key === 'lte') {
      const order = compareCursorValues(actual, operand)
      if (order === null) return false
      if (key === 'gt') return order > 0
      if (key === 'lt') return order < 0
      if (key === 'gte') return order >= 0
      return order <= 0
    }
    return true
  })
}

function whereMatches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every((part) => whereMatches(row, part as Where))
    if (key === 'OR') return (condition as Where[]).length === 0 || (condition as Where[]).some((part) => whereMatches(row, part))
    if (key === 'NOT') return !whereMatches(row, condition as Where)
    // The synthetic paging rows do not opt into categories, so JSON category
    // predicates are treated as matching by this deliberately small Prisma fake.
    if (key === 'metadata') return true
    return scalarMatches(row[key], condition)
  })
}

function materialRow(id: string, createdAt: Date, metadata: unknown = {}, projectId = 'project-1') {
  return {
    id, userId: 'user-1', projectId, ownerName: '管理员', title: id,
    type: 'image', source: 'upload', status: 'ready', isFavorited: false,
    resultUrl: `https://assets.test/${id}.jpg`, storageKey: null,
    createdAt, updatedAt: createdAt, deletedAt: null, personalOwnerId: null, metadata,
  }
}

const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(async () => ({ id: 'project-1' })),
    findMany: vi.fn(async () => [{ id: 'project-1', name: '短剧作品' }]),
  },
  user: {
    findMany: vi.fn(async () => [
      { id: 'user-1', name: '管理员' },
      { id: 'creator-1', name: '资产师甲' },
      { id: 'storyboard-child', name: '分镜师' },
    ]),
  },
  frameosMaterial: {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => [{
      id: 'material-1',
      userId: 'user-1',
      projectId: 'project-1',
      ownerName: '资产师甲',
      title: '雨夜场景',
      type: 'image',
      source: 'upload',
      status: 'ready',
      isFavorited: true,
      resultUrl: 'https://assets.test/rain.jpg',
      storageKey: null,
      createdAt: new Date('2026-07-17T00:00:00.000Z'),
      updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    }]),
  },
}))
const syncGeneratedImagesToMaterialLibrary = vi.hoisted(() => vi.fn(async () => undefined))
const requireUserAuthMock = vi.hoisted(() => vi.fn())
const requireProjectAuthLightMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: requireUserAuthMock,
  requireProjectAuthLight: requireProjectAuthLightMock,
  requireUserPermission: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/frameos/material-upload', () => ({ uploadFrameosMaterial: vi.fn() }))
vi.mock('@/lib/frameos/material-service', () => ({
  syncGeneratedImagesToMaterialLibrary,
}))
vi.mock('@/lib/storage', () => ({
  extractStorageKey: (value: string | null) => value?.startsWith('images/') || value?.startsWith('voice/') ? value : null,
  getSignedUrl: (key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}`,
}))

import { GET } from '@/app/api/frameos/materials/route'

type MaterialRow = ReturnType<typeof materialRow>

async function materialPage(query: Record<string, string | number>) {
  const response = await GET(buildMockRequest({
    path: '/api/frameos/materials', method: 'GET', query: { projectId: 'project-1', ...query },
  }), { params: Promise.resolve({}) })
  const payload = await response.json() as {
    materials: MaterialRow[]
    pagination: { nextCursor: string | null; total?: number }
    error?: { message?: string }
  }
  return { status: response.status, ...payload }
}

function initialCursor(): undefined {
  return undefined
}

// The URLSearchParams transport is exercised by materialPage; no cursor rewriting.

function useSyntheticMaterials(rows: MaterialRow[]) {
  prismaMock.frameosMaterial.findMany.mockImplementation((async (args?: {
    where?: Where
    select?: Record<string, boolean>
    orderBy?: Array<Record<string, 'asc' | 'desc'>>
    take?: number
    cursor?: { id: string }
    skip?: number
  }) => {
    if (!args) return [] as MaterialRow[]
    if (args.where && Object.keys(args.where).length === 1 && 'id' in args.where) {
      const ids = (args.where.id as { in: string[] }).in
      return ids.map((id) => rows.find((row) => row.id === id)).filter((row): row is MaterialRow => Boolean(row))
    }
    let result = rows.filter((row) => !args.where || whereMatches(row as unknown as Record<string, unknown>, args.where))
    const direction = args.orderBy?.[0]?.createdAt === 'asc' ? 1 : -1
    result = result.toSorted((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime()) || direction * a.id.localeCompare(b.id))
    if (args.cursor) {
      const index = result.findIndex((row) => row.id === args.cursor?.id)
      if (index >= 0) result = result.slice(index)
    }
    if (args.skip) result = result.slice(args.skip)
    if (args.take !== undefined) result = result.slice(0, args.take)
    if (args.select) return result.map(({ id, projectId, createdAt, metadata }) => ({ id, projectId, createdAt, metadata }))
    return result
  }) as (args?: {
    where?: Where
    select?: Record<string, boolean>
    orderBy?: Array<Record<string, 'asc' | 'desc'>>
    take?: number
    cursor?: { id: string }
    skip?: number
  }) => Promise<MaterialRow[]>)
}

describe('FrameOS material list filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const session = {
      user: {
        id: 'user-1',
        actorId: 'user-1',
        workspaceOwnerId: 'user-1',
        role: 'admin',
        permissions: ['assetRead', 'assetWrite'],
      },
    }
    requireUserAuthMock.mockResolvedValue({ session })
    requireProjectAuthLightMock.mockResolvedValue({ session, project: { id: 'project-1', userId: 'user-1', name: '短剧作品' } })
    prismaMock.project.findMany.mockResolvedValue([{ id: 'project-1', name: '短剧作品' }])
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', name: '管理员' },
      { id: 'creator-1', name: '资产师甲' },
      { id: 'storyboard-child', name: '分镜师' },
    ])
    prismaMock.frameosMaterial.count.mockResolvedValue(0)
  })

  it('queries persisted favorite, source, project, creator, and creation-time fields', async () => {
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials',
      method: 'GET',
      query: {
        projectId: 'project-1',
        available: '1',
        type: 'image',
        source: 'upload',
        favorite: '1',
        creator: '资产师甲',
        createdFrom: '2026-07-01T00:00:00.000Z',
        createdTo: '2026-07-18T00:00:00.000Z',
      },
    }), { params: Promise.resolve({}) })
    const payload = await response.json() as { materials?: Array<{ projectName?: string }> }

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith({
      where: { AND: [{
        userId: { in: ['user-1', 'creator-1', 'storyboard-child'] },
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
        deletedAt: null,
        type: 'image',
        source: 'upload',
        isFavorited: true,
        OR: [
          { ownerName: { contains: '资产师甲' } },
          { userId: { in: ['creator-1'] } },
        ],
        createdAt: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-18T00:00:00.000Z'),
        },
      }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 201,
    })
    expect(payload.materials?.[0]?.projectName).toBe('短剧作品')
  })

  it('returns real creator choices and performs exact dropdown filtering', async () => {
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials', method: 'GET',
      query: { creator: '资产师甲', creatorExact: '1', projectId: 'project-1', available: '0' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [expect.objectContaining({
        projectId: { in: ['project-1'] },
        OR: [{ ownerName: { equals: '资产师甲' } }, { userId: { in: ['creator-1'] }, OR: [{ ownerName: null }, { ownerName: '' }] }],
      })] },
    }))
    expect(await response.json()).toMatchObject({
      creators: [{ id: 'user-1', name: '管理员' }, { id: 'creator-1', name: '资产师甲' }, { id: 'storyboard-child', name: '分镜师' }],
    })
  })

  it('limits an unscoped child-account query to its management workspace plus account materials', async () => {
    requireUserAuthMock.mockResolvedValueOnce({
      session: {
        user: {
          id: 'user-1',
          actorId: 'storyboard-child',
          workspaceOwnerId: 'user-1',
          role: 'storyboard',
          permissions: ['assetRead', 'storyboardWrite'],
        },
      },
    })
    prismaMock.project.findMany.mockResolvedValueOnce([{ id: 'project-1', name: '短剧作品' }])

    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials',
      method: 'GET',
      query: { available: '1', sync: '1' },
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        deletedAt: null,
        ...projectParticipantWhere('storyboard-child'),
      },
      select: { id: true, name: true, workId: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    })
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [expect.objectContaining({
        userId: { in: ['user-1', 'creator-1', 'storyboard-child'] },
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
        deletedAt: null,
      })] },
    }))
    expect(syncGeneratedImagesToMaterialLibrary).not.toHaveBeenCalled()
  })

  it('keeps cursor pagination inside the authenticated project scope', async () => {
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials', method: 'GET', query: { projectId: 'project-1', cursor: 'material-older', limit: '1' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [expect.objectContaining({ projectId: { in: ['project-1'] }, userId: { in: ['user-1', 'creator-1', 'storyboard-child'] } })] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], cursor: { id: 'material-older' }, skip: 1, take: 2,
    }))
    expect((await response.json()).pagination.nextCursor).toBeNull()
  })

  it('applies persisted filters before both page boundaries and deduplicated totals', async () => {
    useSyntheticMaterials([
      materialRow('kept-new', new Date('2026-07-03T00:00:00.000Z'), {}, 'project-1'),
      materialRow('filtered-new', new Date('2026-07-02T00:00:00.000Z'), {}, 'project-2'),
      materialRow('kept-old', new Date('2026-07-01T00:00:00.000Z'), {}, 'project-1'),
      materialRow('filtered-old', new Date('2026-06-30T00:00:00.000Z'), {}, 'project-2'),
    ])

    const first = await materialPage({ pageVersion: '1', deduplicate: '1', limit: 1 })
    expect(first.materials.map((row) => row.id)).toEqual(['kept-new'])
    expect(first.pagination).toEqual({ nextCursor: `1:${new Date('2026-07-03T00:00:00.000Z').toISOString()}:kept-new`, total: 2, missingVoiceCount: 0 })
    const second = await materialPage({ pageVersion: '1', deduplicate: '1', limit: 1, cursor: first.pagination.nextCursor! })
    expect(second.materials.map((row) => row.id)).toEqual(['kept-old'])
    expect(second.pagination).toEqual({ nextCursor: null, total: 2, missingVoiceCount: 0 })
  })

  it('allows an initial versioned request without a cursor', async () => {
    useSyntheticMaterials([materialRow('first', new Date('2026-07-01T00:00:00.000Z'))])
    const page = await materialPage({ pageVersion: '1', limit: 1 })
    expect(page.status).toBe(200)
    expect(page.materials.map((row) => row.id)).toEqual(['first'])
  })

  it.each([
    { sort: 'newest', timestamp: '2026-07-01T00:00:00.000Z', ids: ['tied-d', 'tied-c', 'tied-b', 'tied-a'] },
    { sort: 'oldest', timestamp: '2026-07-01T00:00:00.000Z', ids: ['tied-a', 'tied-b', 'tied-c', 'tied-d'] },
  ])('uses the (createdAt,id) cursor for equal timestamps when sorting $sort', async ({ sort, timestamp, ids }) => {
    useSyntheticMaterials(ids.map((id) => materialRow(id, new Date(timestamp))))
    const visited: string[] = []
    let cursor: string | undefined = initialCursor()
    do {
      const page = await materialPage({ pageVersion: '1', limit: 1, sort, ...(cursor ? { cursor } : {}) })
      expect(page.status).toBe(200)
      visited.push(...page.materials.map((row) => row.id))
      cursor = page.pagination.nextCursor ?? undefined
    } while (cursor)
    expect(visited).toEqual(ids)
  })

  it('reports the real deduplicated total after excluding superseded rows', async () => {
    useSyntheticMaterials([
      materialRow('root', new Date('2026-07-04T00:00:00.000Z')),
      materialRow('copy', new Date('2026-07-03T00:00:00.000Z'), { inheritedFrom: { projectId: 'project-1', materialId: 'root' } }),
      materialRow('superseded', new Date('2026-07-02T00:00:00.000Z'), { supersededByMaterialId: 'copy' }),
      materialRow('unrelated', new Date('2026-07-01T00:00:00.000Z')),
    ])
    const page = await materialPage({ pageVersion: '1', deduplicate: '1', limit: 1 })
    expect(page.materials.map((row) => row.id)).toEqual(['root'])
    expect(page.pagination.total).toBe(2)
  })

  it('deduplicates inherited lineages across page boundaries', async () => {
    useSyntheticMaterials([
      materialRow('child', new Date('2026-07-04T00:00:00.000Z'), { inheritedFrom: { projectId: 'project-1', materialId: 'parent' } }),
      materialRow('parent', new Date('2026-07-03T00:00:00.000Z')),
      materialRow('other', new Date('2026-07-02T00:00:00.000Z')),
    ])
    const first = await materialPage({ pageVersion: '1', deduplicate: '1', limit: 1 })
    const second = await materialPage({ pageVersion: '1', deduplicate: '1', limit: 1, cursor: first.pagination.nextCursor! })
    expect(first.materials.map((row) => row.id)).toEqual(['child'])
    expect(second.materials.map((row) => row.id)).toEqual(['other'])
    expect(first.pagination.total).toBe(2)
  })

  it('keeps an already selected ancestor as the lineage representative on a later page', async () => {
    useSyntheticMaterials([
      materialRow('child', new Date('2026-07-04T00:00:00.000Z'), { inheritedFrom: { projectId: 'project-1', materialId: 'parent' } }),
      materialRow('other', new Date('2026-07-03T00:00:00.000Z')),
      materialRow('parent', new Date('2026-07-02T00:00:00.000Z')),
      materialRow('unreadable', new Date('2026-07-01T00:00:00.000Z'), {}, 'unreadable-project'),
    ])
    const query = { pageVersion: '1', deduplicate: '1', limit: 1, pinnedId: 'parent' }
    const first = await materialPage(query)
    expect(first.materials.map((row) => row.id)).toEqual(['other'])
    expect(first.pagination.total).toBe(2)
    const second = await materialPage({ ...query, cursor: first.pagination.nextCursor! })
    expect(second.materials.map((row) => row.id)).toEqual(['parent'])
    expect(second.pagination.nextCursor).toBeNull()
  })

  it('excludes superseded materials before page boundaries', async () => {
    useSyntheticMaterials([
      materialRow('newest', new Date('2026-07-04T00:00:00.000Z')),
      materialRow('superseded', new Date('2026-07-03T00:00:00.000Z'), { supersededByMaterialId: 'newest' }),
      materialRow('oldest', new Date('2026-07-02T00:00:00.000Z')),
    ])
    const first = await materialPage({ pageVersion: '1', limit: 2 })
    expect(first.materials.map((row) => row.id)).toEqual(['newest', 'oldest'])
    expect(first.pagination.nextCursor).toBeNull()
  })

  it.each([false, true])('continues past batches of retired materials (versioned: %s)', async (versioned) => {
    const query: Record<string, string | number> = versioned ? { pageVersion: '1', limit: 1 } : { limit: 1 }
    const timestamp = new Date('2026-07-04T00:00:00.000Z')
    const retired = { supersededByMaterialId: 'material-d' }
    useSyntheticMaterials([
      materialRow('material-f', timestamp, retired),
      materialRow('material-e', timestamp, retired),
      materialRow('material-d', timestamp),
      materialRow('material-c', timestamp, retired),
      materialRow('material-b', timestamp, {}, 'unreadable-project'),
      materialRow('material-a', timestamp),
    ])

    const first = await materialPage(query)
    expect(first.status).toBe(200)
    expect(first.materials.map((row) => row.id)).toEqual(['material-d'])
    expect(first.pagination.nextCursor).toBe(versioned ? '1:2026-07-04T00:00:00.000Z:material-d' : 'material-d')

    const second = await materialPage({ ...query, cursor: first.pagination.nextCursor! })
    expect(second.status).toBe(200)
    expect(second.materials.map((row) => row.id)).toEqual(['material-a'])
    expect(second.pagination.nextCursor).toBeNull()
  })

  it('pages 10,000 synthetic materials without gaps or duplicate rows', async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => materialRow(
      `material-${String(index).padStart(5, '0')}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(index / 3))),
    ))
    useSyntheticMaterials(rows)
    const visited: string[] = []
    let cursor: string | undefined = initialCursor()
    let pages = 0
    do {
      const page = await materialPage({ pageVersion: '1', limit: 137, ...(cursor ? { cursor } : {}) })
      expect(page.status).toBe(200)
      visited.push(...page.materials.map((row) => row.id))
      cursor = page.pagination.nextCursor ?? undefined
      pages += 1
    } while (cursor)
    expect(pages).toBe(73)
    expect(visited).toHaveLength(10_000)
    expect(new Set(visited).size).toBe(10_000)
    expect(visited).toEqual(rows.map((row) => row.id).reverse())
  })
})
