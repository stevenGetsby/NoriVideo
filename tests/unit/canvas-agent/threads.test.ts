import type { UIMessage } from 'ai'
import { beforeEach, expect, it, vi } from 'vitest'
import { deleteCanvasAgentThread, getCanvasAgentThread, listCanvasAgentThreads, saveCanvasAgentThread } from '@/lib/canvas-agent/threads'

const store = vi.hoisted(() => ({
  findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { canvasAgentThread: store } }))

const scope = { userId: 'actor-a', projectId: 'project-a', canvasId: 'canvas-a' }
const threadId = '18e948a3-ff8c-45d1-b5c3-963c38afb9a5'
const messages: UIMessage[] = [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: '帮我整理分镜' }] }]

beforeEach(() => {
  vi.resetAllMocks()
})

it('creates a bounded, named thread in the caller’s user/project/canvas scope', async () => {
  store.findUnique.mockResolvedValueOnce(null)
  await saveCanvasAgentThread({ ...scope, threadId, messages })
  expect(store.create).toHaveBeenCalledWith({ data: { id: threadId, ...scope, title: '帮我整理分镜', messages, messageCount: 1 } })
})

it('does not overwrite a thread in a different project even if its ID matches', async () => {
  store.findUnique.mockResolvedValueOnce({ ...scope, projectId: 'project-b' })
  await expect(saveCanvasAgentThread({ ...scope, threadId, messages })).resolves.toBe(false)
  expect(store.create).not.toHaveBeenCalled()
  expect(store.updateMany).not.toHaveBeenCalled()
})

it('does not return or delete out-of-scope threads; listing never loads message bodies', async () => {
  store.findFirst.mockResolvedValueOnce(null)
  store.deleteMany.mockResolvedValueOnce({ count: 0 })
  store.findMany.mockResolvedValueOnce([])
  await expect(getCanvasAgentThread({ ...scope, threadId })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(deleteCanvasAgentThread({ ...scope, threadId })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(listCanvasAgentThreads(scope)).resolves.toEqual([])
  expect(store.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: threadId, ...scope } }))
  expect(store.deleteMany).toHaveBeenCalledWith({ where: { id: threadId, ...scope } })
  expect(store.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: scope, take: 20 }))
  expect(store.findMany.mock.calls[0]?.[0].select).not.toHaveProperty('messages')
})
