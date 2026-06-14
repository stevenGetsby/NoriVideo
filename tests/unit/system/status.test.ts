import { describe, expect, it, vi } from 'vitest'

const { taskCountMock, taskFindFirstMock } = vi.hoisted(() => ({
  taskCountMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      count: taskCountMock,
      findFirst: taskFindFirstMock,
    },
  },
}))

import { readSystemQueueStatus } from '@/lib/system/status'

function statusValue(where: Record<string, unknown>) {
  const status = where.status
  if (typeof status === 'string') return status
  if (status && typeof status === 'object' && 'in' in status) {
    return (status as { in: string[] }).in.join(',')
  }
  return ''
}

describe('system status queue summary', () => {
  it('aggregates task table state into production queue health rows', async () => {
    taskCountMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const types = (where.type as { in: string[] }).in
      const queueId = types.includes('video_panel')
        ? 'video'
        : types.includes('voice_line')
          ? 'voice'
          : types.includes('image_panel')
            ? 'image'
            : 'text'
      const status = statusValue(where)
      const stale = Array.isArray(where.OR)
      const table: Record<string, Record<string, number>> = {
        text: { queued: 2, processing: 1, completed: 7, failed: 1, stale: 1 },
        image: { queued: 3, processing: 2, completed: 8, failed: 0, stale: 0 },
        video: { queued: 4, processing: 3, completed: 9, failed: 2, stale: 1 },
        voice: { queued: 5, processing: 4, completed: 10, failed: 3, stale: 0 },
      }
      if (stale) return table[queueId].stale
      if (status === 'queued') return table[queueId].queued
      if (status === 'processing') return table[queueId].processing
      if (status === 'completed') return table[queueId].completed
      if (status === 'failed,canceled') return table[queueId].failed
      return 0
    })
    taskFindFirstMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const types = (where.type as { in: string[] }).in
      if (!types.includes('video_panel')) return null
      return {
        id: 'task-video-failed',
        projectId: 'project-1',
        type: 'video_panel',
        errorMessage: 'provider failed',
        updatedAt: new Date('2026-06-13T10:00:00.000Z'),
      }
    })

    const rows = await readSystemQueueStatus({ userId: 'user-1' })

    expect(rows).toHaveLength(4)
    expect(rows.find((row) => row.id === 'text')).toMatchObject({
      queued: 2,
      processing: 1,
      completed24h: 7,
      failed24h: 1,
      staleProcessing: 1,
    })
    expect(rows.find((row) => row.id === 'video')).toMatchObject({
      queued: 4,
      processing: 3,
      latestError: {
        taskId: 'task-video-failed',
        projectId: 'project-1',
        type: 'video_panel',
        message: 'provider failed',
      },
    })
    expect(rows.find((row) => row.id === 'image')?.taskTypes).toContain('image_panel')
    expect(rows.find((row) => row.id === 'voice')?.taskTypes).toContain('voice_line')
    expect(taskCountMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1' }),
    }))
    expect(taskFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1' }),
    }))
  })

  it('excludes internal agent task types from public queue health rows', async () => {
    taskCountMock.mockResolvedValue(0)
    taskFindFirstMock.mockResolvedValue(null)

    const rows = await readSystemQueueStatus({ userId: 'user-1' })
    const allTaskTypes = rows.flatMap((row) => row.taskTypes)

    expect(allTaskTypes).not.toContain('super_agent_execute')
    expect(taskCountMock).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: expect.objectContaining({
          in: expect.arrayContaining(['super_agent_execute']),
        }),
      }),
    }))
    expect(taskFindFirstMock).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: expect.objectContaining({
          in: expect.arrayContaining(['super_agent_execute']),
        }),
      }),
    }))
  })
})
