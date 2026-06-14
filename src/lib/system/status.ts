import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { SERVER_BOOT_ID } from '@/lib/server-boot'
import { isInternalAgentTaskType } from '@/lib/super-agent/internal-run-visibility'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

type PackageJson = {
  name?: string
  version?: string
  engines?: Record<string, string>
  dependencies?: Record<string, string>
}

export type SystemStatusSnapshot = {
  app: string
  version: string
  bootId: string
  node: string | null
  npm: string | null
  next: string | null
  react: string | null
  queues: SystemQueueStatus[]
  checkedAt: string
}

export type SystemQueueStatus = {
  id: 'text' | 'image' | 'video' | 'voice'
  taskTypes: string[]
  queued: number
  processing: number
  completed24h: number
  failed24h: number
  staleProcessing: number
  latestError: {
    taskId: string
    projectId: string
    type: string
    message: string | null
    updatedAt: string
  } | null
}

const NON_TEXT_TASK_TYPES = new Set<string>([
  TASK_TYPE.IMAGE_PANEL,
  TASK_TYPE.IMAGE_CHARACTER,
  TASK_TYPE.IMAGE_LOCATION,
  TASK_TYPE.PANEL_VARIANT,
  TASK_TYPE.MODIFY_ASSET_IMAGE,
  TASK_TYPE.REGENERATE_GROUP,
  TASK_TYPE.ASSET_HUB_IMAGE,
  TASK_TYPE.ASSET_HUB_MODIFY,
  TASK_TYPE.VIDEO_PANEL,
  TASK_TYPE.LIP_SYNC,
  TASK_TYPE.VOICE_LINE,
  TASK_TYPE.VOICE_DESIGN,
  TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
])

const QUEUE_TASK_TYPES: Record<SystemQueueStatus['id'], string[]> = {
  image: [
    TASK_TYPE.IMAGE_PANEL,
    TASK_TYPE.IMAGE_CHARACTER,
    TASK_TYPE.IMAGE_LOCATION,
    TASK_TYPE.PANEL_VARIANT,
    TASK_TYPE.MODIFY_ASSET_IMAGE,
    TASK_TYPE.REGENERATE_GROUP,
    TASK_TYPE.ASSET_HUB_IMAGE,
    TASK_TYPE.ASSET_HUB_MODIFY,
  ],
  video: [
    TASK_TYPE.VIDEO_PANEL,
    TASK_TYPE.LIP_SYNC,
  ],
  voice: [
    TASK_TYPE.VOICE_LINE,
    TASK_TYPE.VOICE_DESIGN,
    TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
  ],
  text: Object.values(TASK_TYPE).filter((type) => (
    !NON_TEXT_TASK_TYPES.has(type)
    && !isInternalAgentTaskType(type)
  )),
}

async function readPackageJson(): Promise<PackageJson> {
  try {
    const raw = await readFile(path.join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as PackageJson : {}
  } catch {
    return {}
  }
}

function sinceHours(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

export async function readSystemQueueStatus(params: { userId: string }): Promise<SystemQueueStatus[]> {
  const finishedSince = sinceHours(24)
  const staleHeartbeatBefore = sinceHours(1)

  return await Promise.all((Object.entries(QUEUE_TASK_TYPES) as Array<[SystemQueueStatus['id'], string[]]>).map(async ([id, taskTypes]) => {
    const [queued, processing, completed24h, failed24h, staleProcessing, latestError] = await Promise.all([
      prisma.task.count({
        where: {
          userId: params.userId,
          type: { in: taskTypes },
          status: TASK_STATUS.QUEUED,
        },
      }),
      prisma.task.count({
        where: {
          userId: params.userId,
          type: { in: taskTypes },
          status: TASK_STATUS.PROCESSING,
        },
      }),
      prisma.task.count({
        where: {
          userId: params.userId,
          type: { in: taskTypes },
          status: TASK_STATUS.COMPLETED,
          finishedAt: { gte: finishedSince },
        },
      }),
      prisma.task.count({
        where: {
          userId: params.userId,
          type: { in: taskTypes },
          status: { in: [TASK_STATUS.FAILED, TASK_STATUS.CANCELED] },
          finishedAt: { gte: finishedSince },
        },
      }),
      prisma.task.count({
        where: {
          userId: params.userId,
          type: { in: taskTypes },
          status: TASK_STATUS.PROCESSING,
          OR: [
            { heartbeatAt: null },
            { heartbeatAt: { lt: staleHeartbeatBefore } },
          ],
        },
      }),
      prisma.task.findFirst({
        where: {
          userId: params.userId,
          type: { in: taskTypes },
          status: { in: [TASK_STATUS.FAILED, TASK_STATUS.CANCELED] },
        },
        select: {
          id: true,
          projectId: true,
          type: true,
          errorMessage: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

    return {
      id,
      taskTypes,
      queued,
      processing,
      completed24h,
      failed24h,
      staleProcessing,
      latestError: latestError
        ? {
            taskId: latestError.id,
            projectId: latestError.projectId,
            type: latestError.type,
            message: latestError.errorMessage,
            updatedAt: latestError.updatedAt.toISOString(),
          }
        : null,
    }
  }))
}

export async function readSystemStatusSnapshot(params: { userId: string }): Promise<SystemStatusSnapshot> {
  const [pkg, queues] = await Promise.all([
    readPackageJson(),
    readSystemQueueStatus(params),
  ])
  return {
    app: pkg.name || 'nori',
    version: pkg.version || '0.0.0',
    bootId: SERVER_BOOT_ID,
    node: pkg.engines?.node || null,
    npm: pkg.engines?.npm || null,
    next: pkg.dependencies?.next || null,
    react: pkg.dependencies?.react || null,
    queues,
    checkedAt: new Date().toISOString(),
  }
}
