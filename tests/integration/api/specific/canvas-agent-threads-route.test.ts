import { NextResponse } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'
import { buildMockRequest } from '../../../helpers/request'

const auth = vi.hoisted(() => ({ requireProjectAuthLight: vi.fn(), isErrorResponse: (value: unknown) => value instanceof Response }))
const access = vi.hoisted(() => ({ requireCanvasInProject: vi.fn() }))
const project = vi.hoisted(() => ({ findFirst: vi.fn() }))
const threads = vi.hoisted(() => ({ listCanvasAgentThreads: vi.fn(), getCanvasAgentThread: vi.fn(), deleteCanvasAgentThread: vi.fn() }))
vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/canvas/access', () => access)
vi.mock('@/lib/prisma', () => ({ prisma: { project } }))
vi.mock('@/lib/canvas-agent/threads', () => threads)

const scope = { projectId: 'project-1', canvasId: 'canvas-1' }
const threadId = '37ad77d4-8ca9-4967-adfd-65c877f4ab47'
const context = { params: Promise.resolve({ ...scope, threadId }) }
const root = '/api/projects/project-1/canvas/canvas-1/agent/threads'
const request = (method: 'GET' | 'DELETE', detail = false) => buildMockRequest({ path: detail ? `${root}/${threadId}` : root, method })

beforeEach(() => {
  vi.resetAllMocks()
  auth.requireProjectAuthLight.mockResolvedValue({
    session: { user: { id: 'account-1', actorId: 'actor-1' } },
    project: { id: scope.projectId, productLine: 'canvas' },
  })
  access.requireCanvasInProject.mockResolvedValue({ id: scope.canvasId })
  project.findFirst.mockResolvedValue({ work: { productLine: 'canvas' } })
  threads.listCanvasAgentThreads.mockResolvedValue([])
})

it('lists only the authenticated actor’s threads with caching disabled', async () => {
  const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/threads/route')
  const response = await GET(request('GET'), context)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toEqual({ threads: [] })
  expect(auth.requireProjectAuthLight).toHaveBeenCalledWith(scope.projectId, ['canvasWrite'])
  expect(threads.listCanvasAgentThreads).toHaveBeenCalledWith({ ...scope, userId: 'actor-1' })
})

it('rejects missing write permission and cross-project canvases before querying threads', async () => {
  const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/threads/route')
  auth.requireProjectAuthLight.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
  expect((await GET(request('GET'), context)).status).toBe(403)
  access.requireCanvasInProject.mockRejectedValueOnce(new ApiError('NOT_FOUND'))
  expect((await GET(request('GET'), context)).status).toBe(404)
  expect(threads.listCanvasAgentThreads).not.toHaveBeenCalled()
})

it('rejects story work without loading thread data', async () => {
  const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/threads/route')
  // Authorization returns the Project/作品 row, not its owning Work/项目.
  project.findFirst.mockResolvedValueOnce({ work: { productLine: 'story' } })
  const response = await GET(request('GET'), context)
  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toMatchObject({ error: { details: { code: 'CANVAS_AGENT_STORY_UNSUPPORTED' } } })
  expect(threads.listCanvasAgentThreads).not.toHaveBeenCalled()
  expect(project.findFirst).toHaveBeenCalledWith({
    where: { id: scope.projectId },
    select: { work: { select: { productLine: true } } },
  })
})

it('does not leak a thread that belongs to a different actor', async () => {
  const { GET, DELETE } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/threads/[threadId]/route')
  threads.getCanvasAgentThread.mockRejectedValueOnce(new ApiError('NOT_FOUND'))
  threads.deleteCanvasAgentThread.mockRejectedValueOnce(new ApiError('NOT_FOUND'))
  expect((await GET(request('GET', true), context)).status).toBe(404)
  expect((await DELETE(request('DELETE', true), context)).status).toBe(404)
  expect(threads.getCanvasAgentThread).toHaveBeenCalledWith({ ...scope, threadId, userId: 'actor-1' })
  expect(threads.deleteCanvasAgentThread).toHaveBeenCalledWith({ ...scope, threadId, userId: 'actor-1' })
})
