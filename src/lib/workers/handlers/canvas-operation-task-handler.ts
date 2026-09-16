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
  trimCanvasVideo,
  type CanvasVideoOperationHooks,
  type CanvasVideoRegion,
} from '@/lib/canvas/video-operations'
import { canvasPlaylistFingerprint } from '@/lib/canvas/playlist'
import { parseCanvasPlaylistRenderTaskPayload } from '@/lib/canvas/playlist-render-task'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { getObjectBuffer, getSignedObjectUrl, getSignedUrl, uploadObject } from '@/lib/storage'
import { generateKuaiziVideo } from '@/lib/providers/kuaizi'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive, getTaskExistingExternalId, waitExternalResult } from '@/lib/workers/utils'
import { pickVideoResultMetadata } from '@/lib/video-result'

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'unknown'
}

function deterministicOutputKey(job: Job<TaskJobData>, extension: 'jpg' | 'mp4') {
  return `canvas-operations/${safeSegment(job.data.userId)}/${safeSegment(job.data.taskId)}.${extension}`
}

async function resolveVideoEditReferenceUrl(
  userId: string,
  projectId: string,
  reference: unknown,
): Promise<{ type: 'image' | 'audio'; url: string } | null> {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return null
  const record = reference as Record<string, unknown>
  const type = record.type === 'audio' ? 'audio' : 'image'
  const materialId = typeof record.materialId === 'string' ? record.materialId.trim() : ''
  if (materialId) {
    const material = await prisma.frameosMaterial.findFirst({
      where: {
        id: materialId,
        userId,
        type,
        status: 'ready',
        deletedAt: null,
        projectId: { in: [projectId, 'global', 'global-asset-hub'] },
      },
      select: { storageKey: true, resultUrl: true },
    })
    if (material?.storageKey) {
      return { type, url: await getSignedObjectUrl(material.storageKey, 60 * 60) }
    }
    if (material?.resultUrl && /^https?:\/\//i.test(material.resultUrl)) {
      return { type, url: material.resultUrl }
    }
  }
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  if (/^https?:\/\//i.test(url)) return { type, url }
  return null
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
  const suffix = payload.operation === 'subtitle_erase'
    ? '去字幕'
    : payload.operation === 'video_edit'
      ? '视频编辑'
      : '超清'
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
  if (payload.operation === 'video_edit') {
    const startMs = Number(payload.parameters.startMs)
    const endMs = Number(payload.parameters.endMs)
    const prompt = String(payload.parameters.prompt || '').trim()
    const generateAudio = payload.parameters.generateAudio === true
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || !prompt) {
      throw new Error('INVALID_PARAMS: video edit parameters are invalid')
    }

    await assertTaskActive(job, 'canvas_video_edit_download')
    await reportTaskProgress(job, 10, { stage: 'canvas_video_edit_download' })
    const source = await getObjectBuffer(payload.sourceStorageKey)

    await assertTaskActive(job, 'canvas_video_edit_trim')
    await reportTaskProgress(job, 20, { stage: 'canvas_video_edit_trim' })
    let lastProgress = 20
    const trimmed = await trimCanvasVideo(source, { startMs, endMs }, {
      assertActive: async () => await assertTaskActive(job, 'canvas_video_edit_trim'),
      onProgress: async (ratio) => {
        const progress = 20 + Math.floor(Math.max(0, Math.min(1, ratio)) * 25)
        if (progress < lastProgress + 2) return
        lastProgress = progress
        await reportTaskProgress(job, progress, {
          stage: 'canvas_video_edit_trim',
          progressDetails: { mediaProgress: ratio },
        })
      },
    })

    const segmentKey = `${deterministicOutputKey(job, 'mp4').replace(/\.mp4$/, '')}-segment.mp4`
    await assertTaskActive(job, 'canvas_video_edit_upload')
    await uploadObject(trimmed.body, segmentKey, undefined, 'video/mp4')
    await reportTaskProgress(job, 50, { stage: 'canvas_video_edit_upload' })

    const referenceInputs = Array.isArray(payload.parameters.references)
      ? payload.parameters.references
      : []
    const references: Array<{ type: 'image' | 'audio'; url: string }> = []
    for (const reference of referenceInputs) {
      const resolved = await resolveVideoEditReferenceUrl(job.data.userId, job.data.projectId, reference)
      if (resolved) references.push(resolved)
    }
    await assertTaskActive(job, 'canvas_video_edit_submit')
    let externalId = await getTaskExistingExternalId(job.data.taskId)
    if (!externalId) {
      const generated = await generateKuaiziVideo({
        userId: job.data.userId,
        imageUrl: '',
        prompt,
        options: {
          provider: 'kuaizi',
          modelId: 'doubao-seedance-2-5-260628',
          modelKey: 'kuaizi::doubao-seedance-2-5-260628',
          videos: [await getSignedObjectUrl(segmentKey, 60 * 60)],
          referenceImages: references.filter((item) => item.type === 'image').map((item) => item.url),
          audios: references.filter((item) => item.type === 'audio').map((item) => item.url),
          ratio: 'adaptive',
          duration: -1,
          omniReferenceTaskType: 'edit',
          generateAudio,
          watermark: false,
          resolution: '720p',
          bitrateMode: 'standard',
          outputFormat: 'mp4',
        },
      })
      if (!generated.success || !generated.externalId) {
        throw new Error(generated.success ? '视频编辑任务未返回任务 ID' : '视频编辑任务提交失败')
      }
      externalId = generated.externalId
    }
    await reportTaskProgress(job, 55, { stage: 'canvas_video_edit_poll' })
    // Shared polling persists the external ID, resumes after restart and releases
    // the freeze on failed/expired tasks through the normal worker lifecycle.
    const polled = await waitExternalResult(job, externalId, job.data.userId, {
      progressStart: 55, progressEnd: 80, intervalMs: 5_000,
    })
    const editedUrl = polled.url
    const videoMetadata = pickVideoResultMetadata(polled)

    await assertTaskActive(job, 'canvas_video_edit_download')
    await reportTaskProgress(job, 84, { stage: 'canvas_video_edit_download' })
    const editedResponse = await fetch(editedUrl)
    if (!editedResponse.ok) throw new Error(`无法下载编辑结果：${editedResponse.status}`)
    const editedBody = Buffer.from(await editedResponse.arrayBuffer())
    const processed = {
      width: trimmed.width,
      height: trimmed.height,
      duration: videoMetadata.durationSeconds || trimmed.duration,
      fps: videoMetadata.fps || trimmed.fps,
      body: editedBody,
    }
    const result = await persistVideoResult(job, payload, processed)
    const now = new Date().toISOString()
    const sourceNode = await prisma.canvasNode.findFirst({
      where: { id: payload.sourceNodeId, canvasId: payload.canvasId, canvas: { projectId: job.data.projectId } },
      select: { data: true },
    })
    if (sourceNode) {
      const currentData = sourceNode.data && typeof sourceNode.data === 'object' && !Array.isArray(sourceNode.data)
        ? sourceNode.data as Record<string, unknown>
        : {}
      await prisma.canvasNode.update({
        where: { id: payload.sourceNodeId },
        data: {
          data: JSON.parse(JSON.stringify({
            ...currentData,
            processType: 'video_edit',
            mediaType: 'video',
            title: result.title,
            contentUrl: result.url,
            videoUrl: result.url,
            materialId: result.materialId,
            videoEdit: {
              ...(currentData.videoEdit && typeof currentData.videoEdit === 'object' && !Array.isArray(currentData.videoEdit)
                ? currentData.videoEdit as Record<string, unknown>
                : {}),
              sourceKind: 'none',
              sourceNodeId: null,
            },
            duration: processed.duration,
            fps: processed.fps,
            progress: 100,
            errorMessage: null,
            pollErrorMessage: null,
            history: [{
              id: `task:${job.data.taskId}`,
              taskId: job.data.taskId,
              url: result.url,
              materialId: result.materialId,
              prompt,
              modelKey: payload.modelKey,
              source: 'generation',
              status: 'ready',
              createdAt: now,
            }],
          })),
          status: 'SUCCEEDED',
          taskId: job.data.taskId,
          mediaObjectId: result.materialId,
        },
      })
    }
    return {
      operation: payload.operation,
      engineKey: payload.engineKey,
      modelKey: payload.modelKey,
      results: [result],
      durationSeconds: processed.duration,
      resolution: '720p',
      ...videoMetadata,
      materialization: {
        materialized: true,
        outputNodeId: payload.sourceNodeId,
        canvasRevision: null,
        reason: 'created' as const,
      },
    }
  }
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
