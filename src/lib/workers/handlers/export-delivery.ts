import type { Job } from 'bullmq'
import {
  buildAndUploadExportDeliveryArtifact,
  normalizeExportDeliveryCardId,
} from '@/lib/novel-promotion/export-delivery'
import { appendExportHistoryRecord } from '@/lib/novel-promotion/export-history-store'
import {
  completeExportQueueRecord,
  failExportQueueRecord,
  upsertExportQueueRecord,
} from '@/lib/novel-promotion/export-queue-store'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive } from '../utils'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readTitle(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : fallback
}

export async function handleExportDeliveryTask(job: Job<TaskJobData>) {
  const payload = toObject(job.data.payload)
  const cardId = normalizeExportDeliveryCardId(payload.cardId)
  if (!cardId) {
    throw new Error('export cardId is invalid')
  }
  if (!job.data.episodeId) {
    throw new Error('episodeId is required for export delivery task')
  }

  const title = readTitle(payload, cardId)

  await upsertExportQueueRecord({
    userId: job.data.userId,
    projectId: job.data.projectId,
    episodeId: job.data.episodeId,
    record: {
      cardId,
      title,
      status: 'queued',
      blocker: null,
      taskId: job.data.taskId,
    },
  })

  try {
    await reportTaskProgress(job, 20, {
      stage: 'export_collecting',
      stageLabel: 'progress.runtime.stage.exportCollecting',
      message: 'Collecting export assets',
      cardId,
    })
    await assertTaskActive(job, 'export_collecting')

    const output = await buildAndUploadExportDeliveryArtifact({
      userId: job.data.userId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      cardId,
      title,
      taskId: job.data.taskId,
    })

    await reportTaskProgress(job, 70, {
      stage: 'export_manifest_ready',
      stageLabel: 'progress.runtime.stage.exportManifestReady',
      message: 'Export artifact ready',
      cardId,
      fileName: output.fileName,
      outputStorageKey: output.outputStorageKey,
      outputUrl: output.outputUrl,
      contentType: output.contentType,
      sizeBytes: output.sizeBytes,
      stats: output.stats,
    })
    await assertTaskActive(job, 'export_manifest_ready')

    await completeExportQueueRecord({
      userId: job.data.userId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      cardId,
      taskId: job.data.taskId,
      outputFileName: output.fileName,
      outputStorageKey: output.outputStorageKey,
      outputUrl: output.outputUrl,
      contentType: output.contentType,
      outputManifest: output.manifest,
      stats: output.stats,
    })

    await appendExportHistoryRecord({
      userId: job.data.userId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      record: {
        id: `${job.data.taskId}-${cardId}`,
        cardId,
        title: output.title,
        fileName: output.fileName,
        createdAt: new Date().toISOString(),
        status: 'completed',
        source: 'persistent',
        taskId: job.data.taskId,
        outputStorageKey: output.outputStorageKey,
        outputUrl: output.outputUrl,
        contentType: output.contentType,
        stats: output.stats,
      },
    })

    await reportTaskProgress(job, 95, {
      stage: 'export_recorded',
      stageLabel: 'progress.runtime.stage.exportRecorded',
      message: 'Export delivery recorded',
      cardId,
      fileName: output.fileName,
      outputStorageKey: output.outputStorageKey,
      outputUrl: output.outputUrl,
      contentType: output.contentType,
      sizeBytes: output.sizeBytes,
      stats: output.stats,
    })

    return {
      cardId,
      fileName: output.fileName,
      outputStorageKey: output.outputStorageKey,
      outputUrl: output.outputUrl,
      contentType: output.contentType,
      sizeBytes: output.sizeBytes,
      stats: output.stats,
      outputManifest: output.manifest,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failExportQueueRecord({
      userId: job.data.userId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      cardId,
      taskId: job.data.taskId,
      blocker: message,
    }).catch(() => undefined)
    throw error
  }
}
