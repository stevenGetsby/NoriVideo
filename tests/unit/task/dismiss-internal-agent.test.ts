import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateManyMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      updateMany: updateManyMock,
    },
  },
}))

describe('dismissFailedTasks internal agent visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    updateManyMock.mockResolvedValue({ count: 1 })
  })

  it('does not dismiss internal agent tasks by default', async () => {
    const { dismissFailedTasks } = await import('@/lib/task/service')

    const count = await dismissFailedTasks(['task-public-1', 'task-agent-1'], 'user-1')

    expect(count).toBe(1)
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['task-public-1', 'task-agent-1'] },
        userId: 'user-1',
        status: 'failed',
        type: { notIn: ['super_agent_execute'] },
      },
      data: {
        status: 'dismissed',
      },
    })
  })

  it('allows internal agent task dismissal only for server-side internal tools', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
    const { dismissFailedTasks } = await import('@/lib/task/service')

    await dismissFailedTasks(['task-agent-1'], 'user-1')

    const call = updateManyMock.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined
    expect(call?.where).toMatchObject({
      id: { in: ['task-agent-1'] },
      userId: 'user-1',
      status: 'failed',
    })
    expect(call?.where).not.toHaveProperty('type')
  })
})
