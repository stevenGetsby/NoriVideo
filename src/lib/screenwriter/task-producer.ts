import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { VIDEO_REPAINT_STAGE_STATUS, type VideoRepaintStageKey } from './types'
import type { Locale } from '@/i18n/routing'

export type ScreenwriterMockStage =
  | 'auto_split'
  | 'fact_extract'
  | 'target_settings'
  | 'episode_repaint'

export async function enqueueScreenwriterMockStage(params: {
  userId: string
  taskId: string
  stage: ScreenwriterMockStage
  requestId?: string | null
  locale?: Locale
  sleepMs?: number
}) {
  const task = await prisma.screenwriterTask.findFirst({
    where: {
      id: params.taskId,
      userId: params.userId,
    },
    select: {
      id: true,
      userId: true,
      taskKind: true,
    },
  })
  if (!task) {
    throw new Error('SCREENWRITER_TASK_NOT_FOUND')
  }

  const result = await submitTask({
    userId: params.userId,
    locale: params.locale || 'zh',
    projectId: task.id,
    type: TASK_TYPE.SCREENWRITER_MOCK,
    targetType: 'screenwriter_task',
    targetId: task.id,
    payload: {
      screenwriterTaskId: task.id,
      stage: params.stage,
      sleepMs: params.sleepMs ?? 10_000,
    },
    requestId: params.requestId || null,
  })

  await prisma.screenwriterTask.update({
    where: { id: task.id },
    data: { activeWorkerTaskId: result.taskId },
  })
  await prisma.screenwriterStageState.update({
    where: {
      screenwriterTaskId_stageKey: {
        screenwriterTaskId: task.id,
        stageKey: params.stage as VideoRepaintStageKey,
      },
    },
    data: {
      workerTaskId: result.taskId,
      status: VIDEO_REPAINT_STAGE_STATUS.QUEUED,
    },
  })

  return result
}
