import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(async () => ({ id: 'project-1' })),
  },
  novelPromotionProject: {
    findFirst: vi.fn(async () => ({ id: 'np-project-1' })),
  },
}))

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => {}),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/workers/utils', () => utilsMock)

import { handleEpisodeSplitTask } from '@/lib/workers/handlers/episode-split'

function buildJob(content: string): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-episode-split-1',
      type: TASK_TYPE.EPISODE_SPLIT_LLM,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'NovelPromotionProject',
      targetId: 'project-1',
      payload: { content },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker episode-split', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails fast when content is too short', async () => {
    const job = buildJob('short text')
    await expect(handleEpisodeSplitTask(job)).rejects.toThrow('文本太短，至少需要 100 字')
  })

  it('returns episodes split by explicit headings', async () => {
    const content = [
      '故事简介：这段是导入说明，不能并入第一集。这里补足长度，确保文本超过一百字。',
      '正文',
      '第一集',
      '1-1',
      '场景：破旧柴房 - 夜 - 雨',
      '苏晚卿从混沌中惊醒，被张秃子逼近。她摸出银簪反抗，跌跌撞撞冲进瓢泼大雨。',
      '第二集',
      '2-1',
      '场景：城郊土地庙 - 夜 - 雨',
      '陆承煜在土地庙门口冷声喝止追兵，救下浑身湿透的苏晚卿，并留下令牌。',
    ].join('\n')

    const job = buildJob(content)
    const result = await handleEpisodeSplitTask(job)

    expect(result.success).toBe(true)
    expect(result.episodes).toHaveLength(2)
    expect(result.episodes[0]?.number).toBe(1)
    expect(result.episodes[0]?.title).toBe('第1集')
    expect(result.episodes[0]?.content).toContain('苏晚卿从混沌中惊醒')
    expect(result.episodes[0]?.content).not.toContain('故事简介')
    expect(result.episodes[1]?.number).toBe(2)
  })

  it('rejects content without explicit headings', async () => {
    const content = '没有分集标题的长文本，只能提示用户补充第一集、第二集这样的明确标题。'.repeat(10)

    const job = buildJob(content)
    await expect(handleEpisodeSplitTask(job)).rejects.toThrow('未检测到明确分集标题')
  })
})
