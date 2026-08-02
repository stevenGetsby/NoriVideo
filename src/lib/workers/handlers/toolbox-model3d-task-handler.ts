import type { Job } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import {
  normalizeFrameos3DPose,
  normalizeFrameos3DTopology,
  resolveFrameos3DProviderConfig,
  submitFrameos3DGeneration,
  waitForFrameos3DGeneration,
} from '@/lib/model3d/frameos-3d-provider'
import { assertSelfContainedGlbV2 } from '@/lib/model3d/glb-validation'
import { generateUniqueKey, uploadObject } from '@/lib/storage'
import { trySetTaskExternalId } from '@/lib/task/service'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive } from '../utils'
import { workerTaskWillRetry } from '../retry-state'

type AnyObj = Record<string, unknown>

const MAX_MODEL_BYTES = 128 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024

function record(value: unknown): AnyObj {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyObj
    : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function providerConfigurationError() {
  return Object.assign(new Error('帧界 3D 服务未配置，请在服务配置中填写 API Key。'), {
    code: 'MODEL3D_PROVIDER_NOT_CONFIGURED',
    retryable: false,
  })
}

async function downloadBuffer(url: string, maxBytes: number, label: string) {
  if (!/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error(`${label}地址无效`), { code: 'MODEL3D_RESULT_URL_INVALID', retryable: false })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) {
      throw Object.assign(new Error(`${label}下载失败 (${response.status})`), {
        code: 'MODEL3D_RESULT_DOWNLOAD_FAILED',
        retryable: response.status === 429 || response.status >= 500,
      })
    }
    const declared = Number(response.headers.get('content-length') || 0)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw Object.assign(new Error(`${label}超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 上限`), {
        code: 'MODEL3D_RESULT_TOO_LARGE',
        retryable: false,
      })
    }
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0) throw Object.assign(new Error(`${label}为空`), { code: 'MODEL3D_RESULT_EMPTY', retryable: true })
    if (body.length > maxBytes) {
      throw Object.assign(new Error(`${label}超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 上限`), {
        code: 'MODEL3D_RESULT_TOO_LARGE',
        retryable: false,
      })
    }
    return { body, contentType: response.headers.get('content-type')?.split(';')[0]?.trim() || '' }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw Object.assign(new Error(`${label}下载超时`), { code: 'MODEL3D_RESULT_DOWNLOAD_TIMEOUT', retryable: true })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function assertGlbBuffer(body: Buffer) {
  try {
    assertSelfContainedGlbV2(body)
  } catch (error) {
    throw Object.assign(new Error('3D 服务返回的文件不是有效的 GLB 2.0 模型'), {
      code: 'MODEL3D_RESULT_INVALID_GLB',
      retryable: false,
      cause: error,
    })
  }
}

async function persistModel(url: string, projectId: string) {
  const downloaded = await downloadBuffer(url, MAX_MODEL_BYTES, '3D 模型')
  assertGlbBuffer(downloaded.body)
  const key = generateUniqueKey(`toolbox-model3d/${projectId}`, 'glb')
  return await uploadObject(downloaded.body, key, 3, 'model/gltf-binary')
}

async function persistThumbnail(url: string | null, projectId: string): Promise<string | null> {
  if (!url) return null
  try {
    const downloaded = await downloadBuffer(url, MAX_THUMBNAIL_BYTES, '3D 预览图')
    if (!downloaded.contentType.startsWith('image/')) return null
    const extension = downloaded.contentType.includes('png') ? 'png' : downloaded.contentType.includes('webp') ? 'webp' : 'jpg'
    const key = generateUniqueKey(`toolbox-model3d-thumbnail/${projectId}`, extension)
    return await uploadObject(downloaded.body, key, 2, downloaded.contentType)
  } catch {
    // A missing thumbnail must not discard an otherwise valid GLB result.
    return null
  }
}

export async function handleToolboxModel3DTask(job: Job<TaskJobData>) {
  const payload = record(job.data.payload)
  const asset = await prisma.frameosToolboxAsset.findFirst({
    where: { id: job.data.targetId, userId: job.data.userId, type: 'model3d' },
  })
  if (!asset) throw Object.assign(new Error('Toolbox 3D asset not found'), { code: 'NOT_FOUND', retryable: false })

  const prompt = readString(payload.prompt)
  const title = readString(payload.title) || '工具箱 3D 模型'
  if (!prompt) throw Object.assign(new Error('3D 模型提示词不能为空'), { code: 'INVALID_PARAMS', retryable: false })
  const topology = normalizeFrameos3DTopology(payload.topology)
  const pose = normalizeFrameos3DPose(payload.pose)
  const generateTexture = payload.generateTexture !== false
  const config = resolveFrameos3DProviderConfig()
  if (!config) throw providerConfigurationError()

  const assetParams = record(asset.params)
  await prisma.frameosToolboxAsset.update({
    where: { id: asset.id },
    data: { status: 'processing', errorMessage: null },
  })

  try {
    await assertTaskActive(job, 'model3d_prepare')
    await reportTaskProgress(job, 12, { stage: 'model3d_prepare' })
    const taskRow = await prisma.task.findUnique({ where: { id: job.data.taskId }, select: { externalId: true } })
    let externalTaskId = readString(taskRow?.externalId) || readString(assetParams.externalTaskId)
    let result = null

    if (!externalTaskId) {
      await reportTaskProgress(job, 22, { stage: 'model3d_submit' })
      const submission = await submitFrameos3DGeneration(config, {
        prompt,
        topology,
        generateTexture,
        pose,
      })
      externalTaskId = submission.externalTaskId || ''
      result = submission.result
      if (externalTaskId) {
        await trySetTaskExternalId(job.data.taskId, externalTaskId)
        await prisma.frameosToolboxAsset.update({
          where: { id: asset.id },
          data: { params: { ...assetParams, externalTaskId } as Prisma.InputJsonValue },
        })
      }
    }

    if (!result) {
      if (!externalTaskId) throw Object.assign(new Error('3D 服务没有返回可恢复的任务 ID'), { code: 'MODEL3D_PROVIDER_INVALID_RESPONSE', retryable: true })
      result = await waitForFrameos3DGeneration(config, externalTaskId, async (remoteProgress, status) => {
        await assertTaskActive(job, 'model3d_poll')
        const progress = 30 + Math.floor(Math.max(0, Math.min(100, remoteProgress)) * 0.52)
        await reportTaskProgress(job, progress, { stage: 'model3d_generate', externalId: externalTaskId, providerStatus: status })
      })
    }

    await assertTaskActive(job, 'model3d_download')
    await reportTaskProgress(job, 86, { stage: 'model3d_download' })
    const storageKey = await persistModel(result.modelUrl, job.data.projectId)
    const thumbnailKey = await persistThumbnail(result.thumbnailUrl, job.data.projectId)

    await assertTaskActive(job, 'model3d_persist')
    await reportTaskProgress(job, 95, { stage: 'model3d_persist' })
    const material = await registerFrameosMaterial({
      userId: job.data.userId,
      projectId: job.data.projectId,
      ownerName: readString(payload.ownerName) || undefined,
      title,
      type: 'model3d',
      source: 'toolbox',
      storageKey,
      metadata: {
        taskId: job.data.taskId,
        originType: 'toolbox-model3d',
        originId: asset.id,
        prompt,
        topology,
        generateTexture,
        pose,
        ...(thumbnailKey ? { thumbnailUrl: thumbnailKey } : {}),
      },
    })
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: {
        status: 'ready',
        resultUrl: storageKey,
        materialId: material.id,
        errorMessage: null,
        params: {
          ...assetParams,
          ...(externalTaskId ? { externalTaskId } : {}),
          ...(thumbnailKey ? { thumbnailUrl: thumbnailKey } : {}),
        } as Prisma.InputJsonValue,
      },
    })
    return {
      assetId: asset.id,
      materialId: material.id,
      modelUrl: storageKey,
      thumbnailUrl: thumbnailKey,
    }
  } catch (error) {
    const willRetry = workerTaskWillRetry(job, error)
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: willRetry ? 'processing' : 'failed', errorMessage: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined)
    throw error
  }
}
