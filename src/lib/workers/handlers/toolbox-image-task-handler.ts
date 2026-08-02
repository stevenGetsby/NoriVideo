import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive } from '../utils'
import { generateCleanImageToStorage } from './image-task-handler-shared'
import { projectCanvasToolboxTaskTerminal } from '@/lib/canvas/toolbox-node-binding'
import {
  assertCanvasImageInpaintSupported,
  parseCanvasImageEditTaskContract,
} from '@/lib/canvas/image-edit-contract'
import { workerTaskWillRetry } from '../retry-state'
import { normalizeFrameosAssetCategory } from '@/lib/frameos/material-category'

type AnyObj = Record<string, unknown>

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleToolboxImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const asset = await prisma.frameosToolboxAsset.findFirst({
    where: { id: job.data.targetId, userId: job.data.userId, type: 'image' },
  })
  if (!asset) throw new Error('Toolbox image asset not found')
  const prompt = readString(payload.prompt)
  const modelId = readString(payload.imageModel) || readString(payload.modelId)
  if (!prompt || !modelId) throw new Error('Toolbox image prompt/model missing')
  const referenceImages = Array.isArray(payload.referenceImages)
    ? payload.referenceImages.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const imageEdit = parseCanvasImageEditTaskContract(payload)
  if (imageEdit) {
    assertCanvasImageInpaintSupported(modelId)
    if (referenceImages.length !== 1) {
      throw new Error('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID: image_edit requires exactly one source image')
    }
  }
  const title = readString(payload.title) || '工具箱生成图片'

  await prisma.frameosToolboxAsset.update({ where: { id: asset.id }, data: { status: 'processing', errorMessage: null } })
  try {
    await reportTaskProgress(job, 15, { stage: 'generate_toolbox_image' })
    const storageKey = await generateCleanImageToStorage({
      job,
      userId: job.data.userId,
      modelId,
      prompt,
      targetId: asset.id,
      keyPrefix: 'toolbox-image',
      options: {
        referenceImages,
        ...(imageEdit ? { editMode: imageEdit.editMode, maskImage: imageEdit.maskImage } : {}),
        ...(readString(payload.aspectRatio) ? { aspectRatio: readString(payload.aspectRatio) } : {}),
        ...(readString(payload.resolution) ? { resolution: readString(payload.resolution) } : {}),
        ...(readString(payload.quality) ? { quality: readString(payload.quality) as 'low' | 'medium' | 'high' } : {}),
      },
      materialTitle: title,
      materialOwnerName: readString(payload.ownerName) || undefined,
      materialSource: 'toolbox',
      materialMetadata: {
        originType: 'toolbox-image',
        originId: asset.id,
        assetCategory: normalizeFrameosAssetCategory(payload.assetCategory),
        ...(imageEdit ? {
          processType: imageEdit.processType,
          maskMaterialId: imageEdit.maskMaterialId,
        } : {}),
      },
    })
    await assertTaskActive(job, 'persist_toolbox_image')
    const material = await prisma.frameosMaterial.findFirst({
      where: { userId: job.data.userId, storageKey, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: 'ready', resultUrl: storageKey, materialId: material?.id || null, errorMessage: null },
    })
    await projectCanvasToolboxTaskTerminal({
      projectId: job.data.projectId,
      canvasId: readString(payload.canvasId),
      nodeId: readString(payload.nodeId),
      assetId: asset.id,
      taskId: job.data.taskId,
      type: 'image',
      status: 'ready',
      resultUrl: storageKey,
      materialId: material?.id || null,
      materialMetadata: material?.metadata,
    })
    return { assetId: asset.id, materialId: material?.id || null, imageUrl: storageKey }
  } catch (error) {
    const willRetry = workerTaskWillRetry(job, error)
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: willRetry ? 'processing' : 'failed', errorMessage: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined)
    if (!willRetry) {
      await projectCanvasToolboxTaskTerminal({
        projectId: job.data.projectId,
        canvasId: readString(payload.canvasId),
        nodeId: readString(payload.nodeId),
        assetId: asset.id,
        taskId: job.data.taskId,
        type: 'image',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined)
    }
    throw error
  }
}
