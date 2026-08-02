import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import {
  parseCanvasOperationTaskPayload,
  type CanvasOperationTaskPayload,
} from '@/lib/canvas/operation-task'
import { materializeCanvasAsyncOperationResult } from '@/lib/canvas/operation-output-nodes'
import { upscaleCanvasImage } from '@/lib/canvas/image-operations'
import {
  enhanceCanvasVideo,
  eraseCanvasVideoRegion,
  renderCanvasPlaylistVideo,
  type CanvasVideoOperationHooks,
  type CanvasVideoRegion,
} from '@/lib/canvas/video-operations'
import { canvasPlaylistFingerprint } from '@/lib/canvas/playlist'
import { parseCanvasPlaylistRenderTaskPayload } from '@/lib/canvas/playlist-render-task'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { getObjectBuffer, getSignedUrl, uploadObject } from '@/lib/storage'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'unknown'
}

function deterministicOutputKey(job: Job<TaskJobData>, extension: 'jpg' | 'mp4') {
  return `canvas-operations/${safeSegment(job.data.userId)}/${safeSegment(job.data.taskId)}.${extension}`
}

async function requirePayload(job: Job<TaskJobData>): Promise<CanvasOperationTaskPayload> {
  const payload = parseCanvasOperationTaskPayload(job.data.payload)
  if (!payload || payload.sourceNodeId !== job.data.targetId || job.data.targetType !== 'CanvasNode') {
    throw new Error('INVALID_PARAMS: canvas operation task payload is invalid')
  }
  const expectedTaskType = payload.operation === 'superresolve'
    ? TASK_TYPE.CANVAS_IMAGE_OPERATION
    : TASK_TYPE.CANVAS_VIDEO_OPERATION
  if (job.data.type !== expectedTaskType) {
    throw new Error('INVALID_PARAMS: canvas operation task type does not match its operation')
  }

  const node = await prisma.canvasNode.findFirst({
    where: {
      id: payload.sourceNodeId,
      canvasId: payload.canvasId,
      canvas: { projectId: job.data.projectId },
    },
    select: { id: true },
  })
  if (!node) throw new Error('NOT_FOUND: canvas source node no longer exists')
  return payload
}

async function ownerName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  return user?.name || null
}

async function persistImageResult(
  job: Job<TaskJobData>,
  payload: CanvasOperationTaskPayload,
  processed: Awaited<ReturnType<typeof upscaleCanvasImage>>,
) {
  await assertTaskActive(job, 'canvas_image_upload')
  await reportTaskProgress(job, 84, { stage: 'canvas_operation_upload' })
  const storageKey = deterministicOutputKey(job, 'jpg')
  await uploadObject(processed.body, storageKey, undefined, 'image/jpeg')
  await assertTaskActive(job, 'canvas_image_persist')
  await reportTaskProgress(job, 94, { stage: 'canvas_operation_persist' })
  const material = await registerFrameosMaterial({
    userId: job.data.userId,
    projectId: job.data.projectId,
    ownerName: await ownerName(job.data.userId),
    title: `${payload.sourceTitle} · 超清`,
    type: 'image',
    source: 'creative',
    storageKey,
    metadata: {
      originType: 'canvas-operation',
      taskId: job.data.taskId,
      sourceNodeId: payload.sourceNodeId,
      operation: payload.operation,
      engineKey: payload.engineKey,
      modelKey: payload.modelKey,
      width: processed.width,
      height: processed.height,
      scale: payload.parameters.scale,
      retryOf: payload.retryOf || null,
    },
  })
  return {
    index: 0,
    row: 0,
    col: 0,
    width: processed.width,
    height: processed.height,
    title: material.title || `${payload.sourceTitle} · 超清`,
    materialId: material.id,
    url: material.resultUrl || material.storageKey || storageKey,
  }
}

async function persistVideoResult(
  job: Job<TaskJobData>,
  payload: CanvasOperationTaskPayload,
  processed: Awaited<ReturnType<typeof enhanceCanvasVideo>>,
) {
  await assertTaskActive(job, 'canvas_video_upload')
  await reportTaskProgress(job, 84, { stage: 'canvas_operation_upload' })
  const storageKey = deterministicOutputKey(job, 'mp4')
  await uploadObject(processed.body, storageKey, undefined, 'video/mp4')
  await assertTaskActive(job, 'canvas_video_persist')
  await reportTaskProgress(job, 94, { stage: 'canvas_operation_persist' })
  const suffix = payload.operation === 'subtitle_erase' ? '去字幕' : '超清'
  const material = await registerFrameosMaterial({
    userId: job.data.userId,
    projectId: job.data.projectId,
    ownerName: await ownerName(job.data.userId),
    title: `${payload.sourceTitle} · ${suffix}`,
    type: 'video',
    source: 'creative',
    storageKey,
    metadata: {
      originType: 'canvas-operation',
      taskId: job.data.taskId,
      sourceNodeId: payload.sourceNodeId,
      operation: payload.operation,
      engineKey: payload.engineKey,
      modelKey: payload.modelKey,
      width: processed.width,
      height: processed.height,
      duration: processed.duration,
      fps: processed.fps,
      ...payload.parameters,
      retryOf: payload.retryOf || null,
    },
  })
  return {
    index: 0,
    row: 0,
    col: 0,
    width: processed.width,
    height: processed.height,
    duration: processed.duration,
    fps: processed.fps,
    title: material.title || `${payload.sourceTitle} · ${suffix}`,
    materialId: material.id,
    url: material.resultUrl || material.storageKey || storageKey,
  }
}

export async function handleCanvasImageOperationTask(job: Job<TaskJobData>) {
  const payload = await requirePayload(job)
  if (payload.operation !== 'superresolve' || payload.engineKey !== 'local-sharp') {
    throw new Error(`INVALID_PARAMS: unsupported canvas image operation engine ${payload.engineKey}`)
  }

  await assertTaskActive(job, 'canvas_image_download')
  await reportTaskProgress(job, 12, { stage: 'canvas_operation_download' })
  const source = await getObjectBuffer(payload.sourceStorageKey)
  await assertTaskActive(job, 'canvas_image_process')
  await reportTaskProgress(job, 32, { stage: 'canvas_operation_process' })
  const processed = await upscaleCanvasImage(source, Number(payload.parameters.scale))
  await assertTaskActive(job, 'canvas_image_processed')
  const result = await persistImageResult(job, payload, processed)
  const materialization = await materializeCanvasAsyncOperationResult({
    userId: job.data.userId,
    projectId: job.data.projectId,
    canvasId: payload.canvasId,
    sourceNodeId: payload.sourceNodeId,
    taskId: job.data.taskId,
    operation: payload.operation,
    modelKey: payload.modelKey,
    parameters: payload.parameters,
    result,
  })
  return {
    operation: payload.operation,
    engineKey: payload.engineKey,
    modelKey: payload.modelKey,
    results: [result],
    materialization,
  }
}

export async function handleCanvasVideoOperationTask(job: Job<TaskJobData>) {
  const playlistPayload = parseCanvasPlaylistRenderTaskPayload(job.data.payload)
  if (playlistPayload) {
    if (job.data.targetType !== 'CanvasNode' || job.data.targetId !== playlistPayload.nodeId) {
      throw new Error('INVALID_PARAMS: playlist render target does not match its node')
    }
    const node = await prisma.canvasNode.findFirst({
      where: { id: playlistPayload.nodeId, canvasId: playlistPayload.canvasId, canvas: { projectId: job.data.projectId } },
      select: { id: true, data: true },
    })
    if (!node) throw new Error('NOT_FOUND: playlist node no longer exists')

    await assertTaskActive(job, 'canvas_playlist_download')
    await reportTaskProgress(job, 8, { stage: 'canvas_playlist_download' })
    const clips = []
    for (let index = 0; index < playlistPayload.segments.length; index += 1) {
      const segment = playlistPayload.segments[index]
      clips.push({
        body: await getObjectBuffer(segment.storageKey),
        trimStartMs: segment.trimStartMs,
        trimEndMs: segment.trimEndMs,
      })
      await reportTaskProgress(job, 8 + Math.floor(((index + 1) / playlistPayload.segments.length) * 14), {
        stage: 'canvas_playlist_download',
        progressDetails: { completed: index + 1, total: playlistPayload.segments.length },
      })
    }

    let lastProgress = 22
    const rendered = await renderCanvasPlaylistVideo(clips, {
      assertActive: async () => await assertTaskActive(job, 'canvas_playlist_render'),
      onProgress: async (ratio) => {
        const progress = 22 + Math.floor(Math.max(0, Math.min(1, ratio)) * 62)
        if (progress < lastProgress + 2) return
        lastProgress = progress
        await reportTaskProgress(job, progress, { stage: 'canvas_playlist_render', progressDetails: { mediaProgress: ratio } })
      },
    })

    await assertTaskActive(job, 'canvas_playlist_upload')
    await reportTaskProgress(job, 88, { stage: 'canvas_playlist_upload' })
    const storageKey = `canvas-playlists/${safeSegment(job.data.userId)}/${safeSegment(job.data.taskId)}.mp4`
    await uploadObject(rendered.body, storageKey, undefined, 'video/mp4')
    const material = await registerFrameosMaterial({
      userId: job.data.userId,
      projectId: job.data.projectId,
      ownerName: await ownerName(job.data.userId),
      title: `${playlistPayload.title} · 成片`,
      type: 'video',
      source: 'creative',
      storageKey,
      metadata: {
        originType: 'canvas-playlist-render',
        taskId: job.data.taskId,
        canvasId: playlistPayload.canvasId,
        nodeId: playlistPayload.nodeId,
        fingerprint: playlistPayload.fingerprint,
        clipCount: playlistPayload.segments.length,
        duration: rendered.duration,
        width: rendered.width,
        height: rendered.height,
        fps: rendered.fps,
      },
    })
    const outputUrl = material.resultUrl || getSignedUrl(storageKey)
    const completedAt = new Date().toISOString()
    const currentData = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? node.data as Record<string, unknown>
      : {}
    const stillCurrent = canvasPlaylistFingerprint(currentData.playlistItems) === playlistPayload.fingerprint
    if (stillCurrent) {
      await prisma.canvasNode.update({
        where: { id: node.id },
        data: {
          data: JSON.parse(JSON.stringify({
            ...currentData,
            playlistRender: {
              fingerprint: playlistPayload.fingerprint,
              taskId: job.data.taskId,
              status: 'completed',
              storageKey,
              outputUrl,
              materialId: material.id,
              durationMs: Math.round(rendered.duration * 1_000),
              completedAt,
            },
          })),
          taskId: job.data.taskId,
          status: 'SUCCEEDED',
          mediaObjectId: material.id,
        },
      })
    }
    await reportTaskProgress(job, 97, { stage: 'canvas_playlist_persist' })
    return {
      kind: 'canvas_playlist_render',
      fingerprint: playlistPayload.fingerprint,
      outputUrl,
      storageKey,
      materialId: material.id,
      durationMs: Math.round(rendered.duration * 1_000),
      width: rendered.width,
      height: rendered.height,
      fps: rendered.fps,
      completedAt,
      stale: !stillCurrent,
    }
  }

  const payload = await requirePayload(job)
  if (payload.operation === 'superresolve' || payload.engineKey !== 'local-ffmpeg') {
    throw new Error(`INVALID_PARAMS: unsupported canvas video operation engine ${payload.engineKey}`)
  }

  await assertTaskActive(job, 'canvas_video_download')
  await reportTaskProgress(job, 12, { stage: 'canvas_operation_download' })
  const source = await getObjectBuffer(payload.sourceStorageKey)
  await assertTaskActive(job, 'canvas_video_process')
  await reportTaskProgress(job, 30, { stage: 'canvas_operation_process' })

  let lastReportedProgress = 30
  const hooks: CanvasVideoOperationHooks = {
    assertActive: async () => await assertTaskActive(job, 'canvas_video_process'),
    onProgress: async (ratio) => {
      const progress = 30 + Math.floor(Math.max(0, Math.min(1, ratio)) * 50)
      if (progress < lastReportedProgress + 2) return
      lastReportedProgress = progress
      await reportTaskProgress(job, progress, {
        stage: 'canvas_operation_process',
        progressDetails: { mediaProgress: ratio },
      })
    },
  }

  const processed = payload.operation === 'subtitle_erase'
    ? await eraseCanvasVideoRegion(
      source,
      payload.parameters.region as CanvasVideoRegion,
      payload.parameters.mode === 'text' ? 'text' : 'subtitle',
      hooks,
    )
    : await enhanceCanvasVideo(source, {
      target: payload.parameters.target as '2x' | '720p' | '1080p' | '2k' | '4k',
      interpolate: payload.parameters.interpolate === true,
    }, hooks)

  await assertTaskActive(job, 'canvas_video_processed')
  const result = await persistVideoResult(job, payload, processed)
  const materialization = await materializeCanvasAsyncOperationResult({
    userId: job.data.userId,
    projectId: job.data.projectId,
    canvasId: payload.canvasId,
    sourceNodeId: payload.sourceNodeId,
    taskId: job.data.taskId,
    operation: payload.operation,
    modelKey: payload.modelKey,
    parameters: payload.parameters,
    result,
  })
  return {
    operation: payload.operation,
    engineKey: payload.engineKey,
    modelKey: payload.modelKey,
    results: [result],
    materialization,
  }
}
