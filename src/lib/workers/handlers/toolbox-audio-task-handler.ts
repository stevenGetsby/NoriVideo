import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import {
  audioCapabilitiesForModel,
  normalizeAudioGenerationRequest,
} from '@/lib/audio/generation-contract'
import { generateProviderAudio } from '@/lib/audio/provider'
import { persistGeneratedAudio } from '@/lib/audio/persist'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { projectCanvasToolboxTaskTerminal } from '@/lib/canvas/toolbox-node-binding'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getTaskExistingExternalId,
  waitExternalResult,
} from '../utils'
import { workerTaskWillRetry } from '../retry-state'

type AnyObj = Record<string, unknown>

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleToolboxAudioTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const asset = await prisma.frameosToolboxAsset.findFirst({
    where: { id: job.data.targetId, userId: job.data.userId, projectId: job.data.projectId, type: 'audio' },
  })
  if (!asset) throw new Error('Toolbox audio asset not found')

  const modelKey = compact(payload.audioModel) || compact(payload.modelId)
  if (!modelKey) throw new Error('Toolbox audio model missing')
  const request = normalizeAudioGenerationRequest({
    modelKey,
    prompt: payload.prompt,
    capabilities: audioCapabilitiesForModel(modelKey),
    options: {
      mode: payload.mode,
      voice: payload.voice,
      duration: payload.duration,
      genre: payload.genre,
      sfxKind: payload.sfxKind,
    },
  })
  const title = compact(payload.title) || '工具箱生成音频'
  const canvasId = compact(payload.canvasId)
  const nodeId = compact(payload.nodeId)

  if (asset.status === 'ready' && compact(asset.resultUrl)) {
    await projectCanvasToolboxTaskTerminal({
      projectId: job.data.projectId,
      canvasId,
      nodeId,
      assetId: asset.id,
      taskId: job.data.taskId,
      type: 'audio',
      status: 'ready',
      resultUrl: asset.resultUrl,
      materialId: asset.materialId,
    })
    return {
      assetId: asset.id,
      materialId: asset.materialId,
      audioUrl: asset.resultUrl,
    }
  }

  await prisma.frameosToolboxAsset.update({
    where: { id: asset.id },
    data: { status: 'processing', errorMessage: null },
  })

  try {
    await reportTaskProgress(job, 15, { stage: 'generate_toolbox_audio', mode: request.mode })
    const existingExternalId = await getTaskExistingExternalId(job.data.taskId)
    let source: string
    let downloadHeaders: Record<string, string> | undefined
    if (existingExternalId) {
      const polled = await waitExternalResult(job, existingExternalId, job.data.userId, {
        progressStart: 20,
        progressEnd: 86,
      })
      source = polled.url
      downloadHeaders = polled.downloadHeaders
    } else {
      const generated = await generateProviderAudio({
        userId: job.data.userId,
        modelKey,
        request,
      })
      if (generated.kind === 'async') {
        const polled = await waitExternalResult(job, generated.externalId, job.data.userId, {
          progressStart: 20,
          progressEnd: 86,
        })
        source = polled.url
        downloadHeaders = polled.downloadHeaders
      } else {
        source = generated.audioUrl
      }
    }

    await assertTaskActive(job, 'persist_toolbox_audio')
    await reportTaskProgress(job, 90, { stage: 'persist_toolbox_audio' })
    const persisted = await persistGeneratedAudio({
      source,
      projectId: job.data.projectId,
      downloadHeaders,
    })
    await assertTaskActive(job, 'persist_toolbox_audio_result')
    const material = await registerFrameosMaterial({
      userId: job.data.userId,
      projectId: job.data.projectId,
      ownerName: compact(payload.ownerName) || undefined,
      title,
      type: 'audio',
      source: 'toolbox',
      storageKey: persisted.storageKey,
      metadata: {
        taskId: job.data.taskId,
        originType: 'toolbox-audio',
        originId: asset.id,
        mode: request.mode,
        prompt: request.prompt,
        modelKey,
        ...(request.genre ? { genre: request.genre } : {}),
        ...(request.sfxKind ? { sfxKind: request.sfxKind } : {}),
        ...(persisted.durationSeconds !== null ? { durationSeconds: persisted.durationSeconds } : {}),
      },
    })
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: {
        status: 'ready',
        resultUrl: persisted.storageKey,
        materialId: material.id,
        errorMessage: null,
      },
    })
    await projectCanvasToolboxTaskTerminal({
      projectId: job.data.projectId,
      canvasId,
      nodeId,
      assetId: asset.id,
      taskId: job.data.taskId,
      type: 'audio',
      status: 'ready',
      resultUrl: persisted.storageKey,
      materialId: material.id,
      materialMetadata: material.metadata,
    })
    return {
      assetId: asset.id,
      materialId: material.id,
      audioUrl: persisted.storageKey,
      ...(persisted.durationSeconds !== null ? { actualDurationSeconds: persisted.durationSeconds } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const willRetry = workerTaskWillRetry(job, error)
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: willRetry ? 'processing' : 'failed', errorMessage: message },
    }).catch(() => undefined)
    if (!willRetry) {
      await projectCanvasToolboxTaskTerminal({
        projectId: job.data.projectId,
        canvasId,
        nodeId,
        assetId: asset.id,
        taskId: job.data.taskId,
        type: 'audio',
        status: 'failed',
        errorMessage: message,
      }).catch(() => undefined)
    }
    throw error
  }
}
