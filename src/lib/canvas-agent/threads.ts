import { Prisma } from '@prisma/client'
import type { UIMessage } from 'ai'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { canvasAgentThreadTitle, capThreadMessages } from './thread-content'

type ThreadScope = { userId: string; projectId: string; canvasId: string }
type ThreadIdentity = ThreadScope & { threadId: string }

export async function saveCanvasAgentThread({ threadId, userId, projectId, canvasId, messages }: ThreadIdentity & { messages: readonly UIMessage[] }) {
  const existing = await prisma.canvasAgentThread.findUnique({
    where: { id: threadId },
    select: { userId: true, projectId: true, canvasId: true },
  })
  if (existing && (existing.userId !== userId || existing.projectId !== projectId || existing.canvasId !== canvasId)) {
    console.warn('[canvas-agent] THREAD_SCOPE_MISMATCH')
    return false
  }

  const capped = capThreadMessages(messages)
  const data = {
    messages: JSON.parse(JSON.stringify(capped)) as Prisma.InputJsonArray,
    messageCount: capped.length,
  }
  const where = { id: threadId, userId, projectId, canvasId }
  if (!existing) {
    try {
      await prisma.canvasAgentThread.create({ data: { ...where, ...data, title: canvasAgentThreadTitle(messages) } })
      return true
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      // Concurrent first requests may race to create. The update below still
      // requires the complete ownership scope and can't take over the row.
    }
  }
  const updated = await prisma.canvasAgentThread.updateMany({ where, data })
  return updated.count === 1
}

export function listCanvasAgentThreads({ userId, projectId, canvasId }: ThreadScope) {
  return prisma.canvasAgentThread.findMany({
    where: { userId, projectId, canvasId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: { id: true, title: true, messageCount: true, updatedAt: true },
  })
}

export async function getCanvasAgentThread({ threadId, userId, projectId, canvasId }: ThreadIdentity) {
  const thread = await prisma.canvasAgentThread.findFirst({
    where: { id: threadId, userId, projectId, canvasId },
    select: { id: true, title: true, messages: true, updatedAt: true },
  })
  if (!thread) throw new ApiError('NOT_FOUND', { message: '喵导对话不存在。' })
  return thread
}

export async function deleteCanvasAgentThread({ threadId, userId, projectId, canvasId }: ThreadIdentity) {
  const result = await prisma.canvasAgentThread.deleteMany({ where: { id: threadId, userId, projectId, canvasId } })
  if (result.count === 0) throw new ApiError('NOT_FOUND', { message: '喵导对话不存在。' })
}
