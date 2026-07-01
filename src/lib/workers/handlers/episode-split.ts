import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { splitNovelIntoEpisodes } from '@/lib/novel-promotion/episode-split'
import type { TaskJobData } from '@/lib/task/types'

export async function handleEpisodeSplitTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const projectId = job.data.projectId
  const content = typeof payload.content === 'string' ? payload.content : ''

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }

  const novelProject = await prisma.novelPromotionProject.findFirst({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    throw new Error('Novel promotion data not found')
  }

  const episodes = await splitNovelIntoEpisodes({
    userId: job.data.userId,
    projectId,
    content,
    locale: job.data.locale,
    reportProgress: async (progress, progressPayload) => {
      await reportTaskProgress(job, progress, progressPayload)
    },
    assertActive: async (stage) => {
      await assertTaskActive(job, stage)
    },
  })

  return {
    success: true,
    episodes,
  }
}
