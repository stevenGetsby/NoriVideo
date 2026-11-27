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
  extractCanvasVideoAudio,
  renderCanvasPlaylistVideo,
  trimCanvasVideo,
  type CanvasVideoOperationHooks,
  type CanvasVideoRegion,
} from '@/lib/canvas/video-operations'
import { canvasPlaylistFingerprint } from '@/lib/canvas/playlist'
import { parseCanvasPlaylistRenderTaskPayload } from '@/lib/canvas/playlist-render-task'
import { isManagementRole } from '@/lib/account/permissions'
import { projectParticipantWhere, workspaceUserWhere } from '@/lib/collaboration/access'
import { PERSONAL_MATERIAL_PROJECT_ID } from '@/lib/frameos/material-ownership'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { extractStorageKey, getObjectBuffer, getSignedObjectUrl, getSignedUrl, uploadObject } from '@/lib/storage'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  assertTaskActive,
  getTaskExistingExternalId,
  resolveVideoSourceFromGeneration,
  waitExternalResult,
} from '@/lib/workers/utils'
import { pickVideoResultMetadata } from '@/lib/video-result'

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'unknown'
}

function deterministicOutputKey(job: Job<TaskJobData>, extension: 'jpg' | 'mp4' | 'mp3') {
  return `canvas-operations/${safeSegment(job.data.userId)}/${safeSegment(job.data.taskId)}.${extension}`
}

async function resolveReferenceStorageKey(value: string | null | undefined): Promise<string | null> {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  if (trimmed.startsWith('/api/storage/sign')) {
    try {
      const key = new URL(trimmed, 'http://localhost').searchParams.get('key')?.trim()
      if (key) return key.replace(/^\/+/, '')
    } catch {
      // Fall through to generic storage key resolution.
    }
  }
  const fromMedia = await resolveStorageKeyFromMediaValue(trimmed)
  if (fromMedia) return fromMedia
  return extractStorageKey(trimmed)
}

function resolveTaskActorId(job: Job<TaskJobData>, payload: CanvasOperationTaskPayload): string {
  if (typeof payload.actorId === 'string' && payload.actorId.trim()) {
    return payload.actorId.trim()
  }
  const rawPayload = job.data.payload && typeof job.data.payload === 'object' && !Array.isArray(job.data.payload)
    ? job.data.payload as Record<string, unknown>
    : null
  const meta = rawPayload?.meta && typeof rawPayload.meta === 'object' && !Array.isArray(rawPayload.meta)
    ? rawPayload.meta as Record<string, unknown>
    : null
  if (typeof meta?.quotaUserId === 'string' && meta.quotaUserId.trim()) {
    return meta.quotaUserId.trim()
  }
  return job.data.userId
}

async function resolveVideoEditReferenceAccessScope(params: {
  userId: string
  actorId: string
  projectId: string
}): Promise<{
  workspaceOwnerId: string
  actorId: string
  workspaceUserIds: string[]
  allowAllWorkspaceProjects: boolean
  readableProjectIds: string[]
}> {
  const [taskUser, actorUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, role: true, workspaceOwnerId: true },
    }),
    params.actorId === params.userId
      ? Promise.resolve(null)
      : prisma.user.findUnique({
        where: { id: params.actorId },
        select: { id: true, role: true, workspaceOwnerId: true },
      }),
  ])
  const workspaceOwnerId = (taskUser && !isManagementRole(taskUser.role) && taskUser.workspaceOwnerId)
    ? taskUser.workspaceOwnerId
    : params.userId
  const effectiveActor = actorUser || taskUser
  const allowAllWorkspaceProjects = params.actorId === workspaceOwnerId
    || isManagementRole(effectiveActor?.role)
  const [workspaceUsers, readableProjects] = await Promise.all([
    prisma.user.findMany({
      where: workspaceUserWhere(workspaceOwnerId),
      select: { id: true },
    }),
    allowAllWorkspaceProjects
      ? Promise.resolve([])
      : prisma.project.findMany({
        where: {
          userId: workspaceOwnerId,
          deletedAt: null,
          ...projectParticipantWhere(params.actorId),
        },
        select: { id: true },
      }),
  ])
  return {
    workspaceOwnerId,
    actorId: params.actorId,
    workspaceUserIds: Array.from(new Set([workspaceOwnerId, ...workspaceUsers.map((user) => user.id)])),
    allowAllWorkspaceProjects,
    readableProjectIds: Array.from(new Set([
      params.projectId,
      'global',
      'global-asset-hub',
      ...readableProjects.map((project) => project.id),
    ])),
  }
}

async function resolveVideoEditReferenceUrl(
  scope: Awaited<ReturnType<typeof resolveVideoEditReferenceAccessScope>>,
  reference: unknown,
): Promise<{ type: 'image' | 'audio'; url: string } | null> {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return null
  const record = reference as Record<string, unknown>
  const type = record.type === 'audio' ? 'audio' : 'image'
  const materialId = typeof record.materialId === 'string' ? record.materialId.trim() : ''
  if (materialId) {
    const sharedScope = scope.allowAllWorkspaceProjects
      ? { projectId: { not: PERSONAL_MATERIAL_PROJECT_ID }, personalOwnerId: null }
      : { projectId: { in: scope.readableProjectIds }, personalOwnerId: null }
    const personalScope = scope.allowAllWorkspaceProjects
      ? { personalOwnerId: scope.actorId }
      : { projectId: { in: [PERSONAL_MATERIAL_PROJECT_ID, ...scope.readableProjectIds] }, personalOwnerId: scope.actorId }
    const material = await prisma.frameosMaterial.findFirst({
      where: {
        id: materialId,
        userId: { in: scope.workspaceUserIds },
        type,
        status: 'ready',
        deletedAt: null,
        OR: [sharedScope, personalScope],
      },
      select: { storageKey: true, resultUrl: true },
    })
    if (material?.storageKey) {
      return { type, url: await getSignedObjectUrl(material.storageKey, 60 * 60) }
    }
    if (material?.resultUrl) {
      if (/^https?:\/\//i.test(material.resultUrl)) {
        return { type, url: material.resultUrl }
      }
      const resultStorageKey = await resolveReferenceStorageKey(material.resultUrl)
      if (resultStorageKey) {
        return { type, url: await getSignedObjectUrl(resultStorageKey, 60 * 60) }
      }
    }
  }
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  if (/^https?:\/\//i.test(url)) return { type, url }
  const storageKey = await resolveReferenceStorageKey(url)
  if (storageKey) {
    return { type, url: await getSignedObjectUrl(storageKey, 60 * 60) }
  }
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
    ownerName: await ownerName(resolveTaskActorId(job, payload)),
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
    ownerName: await ownerName(resolveTaskActorId(job, payload)),
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

async function persistAudioResult(
  job: Job<TaskJobData>,
  payload: CanvasOperationTaskPayload,
  processed: Awaited<ReturnType<typeof extractCanvasVideoAudio>>,
) {
  await assertTaskActive(job, 'canvas_audio_upload')
  await reportTaskProgress(job, 84, { stage: 'canvas_operation_upload' })
  const storageKey = deterministicOutputKey(job, 'mp3')
  await uploadObject(processed.body, storageKey, undefined, 'audio/mpeg')
  await assertTaskActive(job, 'canvas_audio_persist')
  await reportTaskProgress(job, 94, { stage: 'canvas_operation_persist' })
  const title = `${payload.sourceTitle} · 音频`
  const material = await registerFrameosMaterial({
    userId: job.data.userId,
    projectId: job.data.projectId,
    ownerName: await ownerName(resolveTaskActorId(job, payload)),
    title,
    type: 'audio',
    source: 'creative',
    storageKey,
    metadata: {
      originType: 'canvas-operation',
      taskId: job.data.taskId,
      sourceNodeId: payload.sourceNodeId,
      operation: payload.operation,
      engineKey: payload.engineKey,
      modelKey: payload.modelKey,
      duration: processed.duration,
      ...payload.parameters,
      retryOf: payload.retryOf || null,
    },
  })
  return {
    index: 0,
    row: 0,
    col: 0,
    width: 0,
    height: 0,
    duration: processed.duration,
    title: material.title || title,
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
    const generateAudio = payload.parameters.generateAudio !== false
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
    if (referenceInputs.length > 0) {
      const referenceScope = await resolveVideoEditReferenceAccessScope({
        userId: job.data.userId,
        actorId: resolveTaskActorId(job, payload),
        projectId: job.data.projectId,
      })
      for (const reference of referenceInputs) {
        const resolved = await resolveVideoEditReferenceUrl(referenceScope, reference)
        if (resolved) references.push(resolved)
      }
    }
    await assertTaskActive(job, 'canvas_video_edit_submit')
    const externalId = await getTaskExistingExternalId(job.data.taskId)
    let editedUrl: string
    let downloadHeaders: Record<string, string> | undefined
    let videoMetadata: ReturnType<typeof pickVideoResultMetadata>
    if (!externalId) {
      const capabilityDurationSeconds = Math.min(
        30,
        Math.max(4, Math.round(trimmed.duration || (endMs - startMs) / 1_000)),
      )
      const generated = await resolveVideoSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId: payload.modelKey,
        imageUrl: '',
        options: {
          prompt,
          videos: [await getSignedObjectUrl(segmentKey, 60 * 60)],
          referenceImages: references.filter((item) => item.type === 'image').map((item) => item.url),
          audios: references.filter((item) => item.type === 'audio').map((item) => item.url),
          aspectRatio: 'adaptive',
          ratio: 'adaptive',
          duration: capabilityDurationSeconds,
          omniReferenceTaskType: 'edit',
          generateAudio,
          watermark: false,
          resolution: '720p',
          bitrateMode: 'standard',
          outputFormat: 'mp4',
        },
        pollProgress: { start: 55, end: 80 },
      })
      if (!generated.url) {
        throw new Error('视频编辑任务未返回可用结果')
      }
      editedUrl = generated.url
      downloadHeaders = generated.downloadHeaders
      videoMetadata = pickVideoResultMetadata(generated)
    } else {
      await reportTaskProgress(job, 55, { stage: 'canvas_video_edit_poll' })
      // Shared polling persists the external ID, resumes after restart and releases
      // the freeze on failed/expired tasks through the normal worker lifecycle.
      const polled = await waitExternalResult(job, externalId, job.data.userId, {
        progressStart: 55, progressEnd: 80, intervalMs: 5_000,
      })
      editedUrl = polled.url
      downloadHeaders = polled.downloadHeaders
      videoMetadata = pickVideoResultMetadata(polled)
    }

    await assertTaskActive(job, 'canvas_video_edit_download')
    await reportTaskProgress(job, 84, { stage: 'canvas_video_edit_download' })
    const editedResponse = await fetch(editedUrl, { headers: downloadHeaders })
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
    const materialization = await prisma.$transaction(async (tx) => {
      const sourceNode = await tx.canvasNode.findFirst({
        where: { id: payload.sourceNodeId, canvasId: payload.canvasId, canvas: { projectId: job.data.projectId } },
        select: { data: true },
      })
      if (!sourceNode) {
        const canvas = await tx.canvas.findFirst({
          where: { id: payload.canvasId, projectId: job.data.projectId },
          select: { revision: true },
        })
        return {
          materialized: false,
          outputNodeId: null,
          canvasRevision: canvas?.revision ?? null,
          reason: 'source-missing' as const,
        }
      }
      const currentData = sourceNode.data && typeof sourceNode.data === 'object' && !Array.isArray(sourceNode.data)
        ? sourceNode.data as Record<string, unknown>
        : {}
      await tx.canvasNode.update({
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
      const updatedCanvas = await tx.canvas.update({
        where: { id: payload.canvasId },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      })
      return {
        materialized: true,
        outputNodeId: payload.sourceNodeId,
        canvasRevision: updatedCanvas.revision,
        reason: 'created' as const,
      }
    })
    return {
      operation: payload.operation,
      engineKey: payload.engineKey,
      modelKey: payload.modelKey,
      results: [result],
      durationSeconds: processed.duration,
      resolution: '720p',
      ...videoMetadata,
      materialization,
    }
  }
  if (payload.operation === 'audio_extract') {
    const startMs = Number(payload.parameters.startMs)
    const endMs = Number(payload.parameters.endMs)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      throw new Error('INVALID_PARAMS: audio extract range is invalid')
    }

    await assertTaskActive(job, 'canvas_audio_download')
    await reportTaskProgress(job, 12, { stage: 'canvas_operation_download' })
    const source = await getObjectBuffer(payload.sourceStorageKey)
    await assertTaskActive(job, 'canvas_audio_process')
    await reportTaskProgress(job, 30, { stage: 'canvas_operation_process' })

    let lastAudioProgress = 30
    const audioHooks: CanvasVideoOperationHooks = {
      assertActive: async () => await assertTaskActive(job, 'canvas_audio_process'),
      onProgress: async (ratio) => {
        const progress = 30 + Math.floor(Math.max(0, Math.min(1, ratio)) * 50)
        if (progress < lastAudioProgress + 2) return
        lastAudioProgress = progress
        await reportTaskProgress(job, progress, {
          stage: 'canvas_operation_process',
          progressDetails: { mediaProgress: ratio },
        })
      },
    }
    const processed = await extractCanvasVideoAudio(source, { startMs, endMs }, audioHooks)
    await assertTaskActive(job, 'canvas_audio_processed')
    const result = await persistAudioResult(job, payload, processed)
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
