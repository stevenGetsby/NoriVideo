import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const scopeMock = vi.hoisted(() => ({ requireCanvasInProject: vi.fn() }))
const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  canvasNode: { findMany: vi.fn(), findFirst: vi.fn() },
  canvasEdge: { findMany: vi.fn() },
}))
const reconcileMock = vi.hoisted(() => ({ reconcileCanvasGenerationNodes: vi.fn(async ({ nodes }: { nodes: unknown[] }) => nodes) }))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/canvas/access', () => scopeMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/canvas/generation-reconciliation', () => reconcileMock)

const nodeRow = {
  id: 'node-1', canvasId: 'canvas-1', type: 'image', position: { x: 0, y: 0 }, size: { width: 320, height: 200 },
  status: 'SUCCEEDED', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null,
  updatedAt: new Date('2026-11-21T00:00:00Z'),
  data: {
    title: '大图', mediaType: 'image', contentUrl: 'current.png',
    prompt: 'very long private prompt', history: [{ id: 'entry-1', status: 'ready', createdAt: '2026-11-21T00:00:00Z', url: 'current.png', prompt: 'secret history', references: [{ id: 'ref' }] }],
    unknownLargeField: 'do not send',
  },
}
const canvas = { id: 'canvas-1', projectId: 'project-1', revision: 9 }
const edge = { id: 'edge-1', canvasId: 'canvas-1', sourceNodeId: 'node-1', targetNodeId: 'node-2', sourceHandle: null, targetHandle: null, role: 'REF' }
const storedVersion = `db1-${'a'.repeat(64)}`
const { data: _data, ...nodeColumns } = nodeRow
const projectionRow = {
  ...nodeColumns,
  cardEntries: [['title', '大图'], ['mediaType', 'image'], ['contentUrl', 'current.png']],
  historyCount: BigInt(1),
  currentCostEntry: [null, null],
  detailVersion: storedVersion,
}

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.requireProjectAuthLight.mockResolvedValue({ session: { user: { id: 'user-1' } } })
  scopeMock.requireCanvasInProject.mockResolvedValue(canvas)
  prismaMock.canvasNode.findMany.mockResolvedValue([nodeRow])
  prismaMock.canvasNode.findFirst.mockResolvedValue(nodeRow)
  prismaMock.canvasEdge.findMany.mockResolvedValue([edge])
  prismaMock.$queryRaw.mockImplementation(async (query: { sql: string }) =>
    query.sql.includes('AS cardEntries') ? [projectionRow] : [{ ...nodeRow, detailVersion: storedVersion }])
})

describe('canvas graph summary and detail routes', () => {
  it('keeps the legacy graph response byte shape and 304 behavior unchanged', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/route')
    const response = await GET(request('/api/projects/project-1/canvas/canvas-1'), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })
    const body = await response.json()
    expect(body.kind).toBeUndefined()
    expect(body.nodes[0].data.history).toHaveLength(1)
    expect(body.nodes[0].data.unknownLargeField).toBe('do not send')
    expect(body.nodes[0].detailVersion).toBeUndefined()
    const etag = response.headers.get('etag')!
    const cached = await GET(request('/api/projects/project-1/canvas/canvas-1', { 'if-none-match': etag }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })
    expect(cached.status).toBe(304)
  })

  it('projects summary nodes, retains roles/topology and hashes the summary representation', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/route')
    const response = await GET(request('/api/projects/project-1/canvas/canvas-1?view=summary-v1'), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })
    const body = await response.json()
    expect(body.kind).toBe('summary-v1')
    expect(body.edges[0].role).toBe('REF')
    expect(body.nodes[0].historyCount).toBe(1)
    expect(body.nodes[0].detailVersion).toBe(storedVersion)
    expect(body.nodes[0].data.history).toBeUndefined()
    expect(body.nodes[0].data.prompt).toBeUndefined()
    expect(body.nodes[0].data.unknownLargeField).toBeUndefined()
    expect(prismaMock.canvasNode.findMany).not.toHaveBeenCalled()
    expect(reconcileMock.reconcileCanvasGenerationNodes).not.toHaveBeenCalled()
    const etag = response.headers.get('etag')!
    const cached = await GET(request('/api/projects/project-1/canvas/canvas-1?view=summary-v1', { 'if-none-match': etag }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })
    expect(cached.status).toBe(304)
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ...projectionRow, detailVersion: `db1-${'b'.repeat(64)}` }])
    const changed = await GET(request('/api/projects/project-1/canvas/canvas-1?view=summary-v1', { 'if-none-match': etag }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(etag)
  })

  it('loads full detail only for a node owned by the authorized canvas', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/route')
    const response = await GET(request('/api/projects/project-1/canvas/canvas-1/nodes/node-1?view=detail-v1'), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1' }) })
    const body = await response.json()
    expect(body.kind).toBe('detail-v1')
    expect(body.detailVersion).toBe(storedVersion)
    expect(body.node.data.history[0].prompt).toBe('secret history')
    expect(prismaMock.$queryRaw).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining('cn.canvasId = ? AND cn.id = ?'),
      values: ['canvas-1', 'node-1'],
    }))
  })

  it('denies a cross-canvas node and a history entry that does not belong to it', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/route')
    const response = await GET(request('/api/projects/project-1/canvas/canvas-1/nodes/other-node?view=detail-v1'), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'other-node' }) })
    expect(response.status).toBe(404)
    const missing = await GET(request('/api/projects/project-1/canvas/canvas-1/nodes/node-1?view=history-item-v1&entryId=other-entry'), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1' }) })
    expect(missing.status).toBe(404)
  })

  it('returns lightweight history pages and full items only on explicit expansion', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/route')
    const page = await GET(request('/api/projects/project-1/canvas/canvas-1/nodes/node-1?view=history-v1&limit=20'), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1' }) })
    const body = await page.json()
    expect(body.kind).toBe('history-v1')
    expect(body.items[0].references).toBeUndefined()
    expect(body.items[0].referenceCount).toBe(1)
    expect(body.nextCursor).toBeNull()
    const expanded = await GET(request('/api/projects/project-1/canvas/canvas-1/nodes/node-1?view=history-item-v1&entryId=entry-1'), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-1' }) })
    expect((await expanded.json()).item.prompt).toBe('secret history')
  })
})
