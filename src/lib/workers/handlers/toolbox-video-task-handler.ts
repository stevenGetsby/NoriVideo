import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToCos,
} from '../utils'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToOriginalMediaUrl,
} from '@/lib/media/outbound-image'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { compileSeedancePromptForSubmission } from '@/lib/novel-promotion/seedance-prompt-assets'
import { projectCanvasToolboxTaskTerminal } from '@/lib/canvas/toolbox-node-binding'
import { workerTaskWillRetry } from '../retry-state'
import { normalizeCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { extractVoiceAudioFromVideo } from '@/lib/media/video-audio'
import { generateUniqueKey, getObjectBuffer, uploadObject } from '@/lib/storage'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { isArkInputImageModerationError, isArkVideoModel } from '../ark-video-fallback'
import {
  ensureSeedanceCharacterAsset,
  ensureSeedanceToolboxReferenceAssets,
} from '@/lib/novel-promotion/seedance-character-asset'
import { normalizeFrameosAssetCategory } from '@/lib/frameos/material-category'

type AnyObj = Record<string, unknown>
type GeneratedVideo = {
  url: string
  actualVideoTokens?: number
  downloadHeaders?: Record<string, string>
  fallbackMode?: 'ark_text_only_after_input_image_moderation'
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function readJsonObject(value: unknown): AnyObj {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyObj : {}
}

async function normalizeReferenceMedia(values: string[]): Promise<string[]> {
  return await Promise.all(values.map(async (value) => await normalizeToOriginalMediaUrl(value)))
}

export async function handleToolboxVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const asset = await prisma.frameosToolboxAsset.findFirst({
    where: { id: job.data.targetId, userId: job.data.userId, type: 'video' },
  })
  if (!asset) throw new Error('Toolbox video asset not found')
  const rawPrompt = readString(payload.prompt)
  const modelId = readString(payload.videoModel) || readString(payload.modelId)
  if (!rawPrompt || !modelId) throw new Error('Toolbox video prompt/model missing')
  const referenceImages = readStringArray(payload.referenceImages)
  const referenceVideos = readStringArray(payload.referenceVideos)
  const referenceAudios = readStringArray(payload.referenceAudios)
  const referenceNames = readStringArray(payload.referenceNames)
  const referenceImageNames = readStringArray(payload.referenceImageNames)
  const referenceVideoNames = readStringArray(payload.referenceVideoNames)
  const referenceAudioNames = readStringArray(payload.referenceAudioNames)
  const inputMode = readString(payload.inputMode) || 'text'
  const materialReferenceContract = normalizeCanvasGenerationMaterialReferences({
    value: payload.referenceMaterials,
    legacyMaterialIds: readStringArray(payload.referenceMaterialIds),
    inputMode,
    limit: 15,
  })
  const referenceImageRoles = readStringArray(payload.referenceImageRoles)
  const title = readString(payload.title) || '工具箱生成视频'

  await prisma.frameosToolboxAsset.update({ where: { id: asset.id }, data: { status: 'processing', errorMessage: null } })
  try {
    if (!materialReferenceContract.success) throw new Error(materialReferenceContract.message)
    await reportTaskProgress(job, 15, { stage: 'generate_toolbox_video' })
    let normalized: string[]
    if (asset.bizType === 'character_audition' && isArkVideoModel(modelId)) {
      const characterId = readString(readJsonObject(asset.params).characterId)
      if (!characterId) throw new Error('角色试镜任务缺少 characterId。')
      await reportTaskProgress(job, 18, { stage: 'prepare_character_private_asset' })
      const privateAsset = await ensureSeedanceCharacterAsset({
        userId: job.data.userId,
        projectId: job.data.projectId,
        characterId,
        onStatus: async (status, attempt) => {
          await assertTaskActive(job, 'prepare_character_private_asset')
          await reportTaskProgress(job, Math.min(32, 18 + attempt), {
            stage: 'prepare_character_private_asset',
            assetStatus: status,
          })
        },
      })
      normalized = [privateAsset.assetUri]
    } else {
      normalized = await normalizeReferenceImagesForGeneration(referenceImages, {
        context: { projectId: job.data.projectId, taskId: job.data.taskId, usage: 'toolbox_video' },
      })
    }
    const prompt = compileSeedancePromptForSubmission(
      rawPrompt,
      (referenceImageNames.length > 0 ? referenceImageNames : referenceNames)
        .map((name) => ({ kind: 'prop' as const, name })),
    )
    const isFirstLastFrame = inputMode === 'firstlastframe'
    const isImageToVideo = inputMode === 'image'
    const expectedImageRoles = materialReferenceContract.references.map((item) => item.role)
    if (
      isFirstLastFrame
      && (
        referenceImageRoles.length !== expectedImageRoles.length
        || referenceImageRoles.some((role, index) => role !== expectedImageRoles[index])
      )
    ) {
      throw new Error('First/last frame roles were not preserved in the queued task')
    }
    const firstFrameIndex = isFirstLastFrame ? referenceImageRoles.indexOf('FIRST_FRAME') : 0
    const lastFrameIndex = isFirstLastFrame ? referenceImageRoles.indexOf('LAST_FRAME') : -1
    const sourceImage = (isImageToVideo || isFirstLastFrame) ? (normalized[firstFrameIndex] || '') : ''
    if ((isImageToVideo || isFirstLastFrame) && !sourceImage) {
      throw new Error('Toolbox video mode requires a reference image')
    }
    if (isFirstLastFrame && (lastFrameIndex < 0 || !normalized[lastFrameIndex])) {
      throw new Error('First/last frame mode requires two images')
    }
    const useReferenceMode = !isImageToVideo && !isFirstLastFrame
    const normalizedVideos = useReferenceMode ? await normalizeReferenceMedia(referenceVideos) : []
    const normalizedAudios = useReferenceMode ? await normalizeReferenceMedia(referenceAudios) : []
    const buildGenerationOptions = (images: string[], forceReferenceMode = false) => ({
      prompt,
      ...((useReferenceMode || forceReferenceMode) && images.length > 0 ? { referenceImages: images } : {}),
      ...((useReferenceMode || forceReferenceMode) && normalizedVideos.length > 0 ? { videos: normalizedVideos } : {}),
      ...((useReferenceMode || forceReferenceMode) && normalizedAudios.length > 0 ? { audios: normalizedAudios } : {}),
      ...(!forceReferenceMode && isFirstLastFrame ? { lastFrameImageUrl: images[lastFrameIndex] } : {}),
      ...(readNumber(payload.duration) !== undefined ? { duration: readNumber(payload.duration) } : {}),
      ...(readNumber(payload.fps) !== undefined ? { fps: readNumber(payload.fps) } : {}),
      ...(readString(payload.resolution) ? { resolution: readString(payload.resolution) } : {}),
      ...(readString(payload.aspectRatio) ? { aspectRatio: readString(payload.aspectRatio) } : {}),
      ...(typeof payload.generateAudio === 'boolean' ? { generateAudio: payload.generateAudio } : {}),
      generationMode: !forceReferenceMode && isFirstLastFrame ? 'firstlastframe' as const : 'normal' as const,
    })
    let generated: GeneratedVideo
    try {
      generated = await resolveVideoSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId,
        imageUrl: sourceImage,
        options: buildGenerationOptions(normalized),
      })
    } catch (error) {
      const canRetryWithPrivateAssets = asset.bizType !== 'character_audition'
        && isArkVideoModel(modelId)
        && !isFirstLastFrame
        && referenceImages.length > 0
        && isArkInputImageModerationError(error)
      if (!canRetryWithPrivateAssets) throw error

      await reportTaskProgress(job, 28, { stage: 'prepare_toolbox_private_assets' })
      const privateReferences = await ensureSeedanceToolboxReferenceAssets({
        userId: job.data.userId,
        projectId: job.data.projectId,
        materialIds: readStringArray(payload.referenceMaterialIds),
        onStatus: async ({ status, attempt }) => {
          await assertTaskActive(job, 'prepare_toolbox_private_assets')
          await reportTaskProgress(job, Math.min(42, 28 + attempt), {
            stage: 'prepare_toolbox_private_assets',
            assetStatus: status,
          })
        },
      })
      generated = await resolveVideoSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId,
        imageUrl: '',
        options: buildGenerationOptions(privateReferences, true),
      })
    }
    const storageKey = await uploadVideoSourceToCos(generated.url, 'toolbox-video', asset.id, generated.downloadHeaders)
    await assertTaskActive(job, 'persist_toolbox_video')
    let auditionAudioUrl = ''
    if (asset.bizType === 'character_audition') {
      const characterId = readString(readJsonObject(asset.params).characterId)
      const character = characterId
        ? await prisma.novelPromotionCharacter.findFirst({
            where: { id: characterId, novelPromotionProject: { projectId: job.data.projectId } },
            select: { id: true },
          })
        : null
      if (!character) throw new Error('角色试镜任务对应的角色不存在。')

      await reportTaskProgress(job, 95, { stage: 'extract_character_audition_audio' })
      const videoBody = await getObjectBuffer(storageKey)
      const audioBody = await extractVoiceAudioFromVideo(videoBody)
      const audioKey = generateUniqueKey(`voice/custom/${job.data.projectId}/${character.id}`, 'mp3')
      auditionAudioUrl = await uploadObject(audioBody, audioKey, 1, 'audio/mpeg')
      await resolveMediaRefFromLegacyValue(auditionAudioUrl)
      await assertTaskActive(job, 'persist_character_audition_audio')
    }
    const material = await registerFrameosMaterial({
      userId: job.data.userId,
      projectId: job.data.projectId,
      ownerName: readString(payload.ownerName) || undefined,
      title,
      type: 'video',
      source: 'toolbox',
      storageKey,
      metadata: {
        taskId: job.data.taskId,
        originType: 'toolbox-video',
        originId: asset.id,
        assetCategory: normalizeFrameosAssetCategory(payload.assetCategory),
        inputMode,
        prompt: rawPrompt,
        referenceNames,
        referenceImageNames,
        referenceVideoNames,
        referenceAudioNames,
        referenceMaterials: materialReferenceContract.references,
        referenceImageRoles,
        ...(generated.fallbackMode ? { fallbackMode: generated.fallbackMode } : {}),
      },
    })
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: 'ready', resultUrl: storageKey, materialId: material.id, errorMessage: null },
    })
    await projectCanvasToolboxTaskTerminal({
      projectId: job.data.projectId,
      canvasId: readString(payload.canvasId),
      nodeId: readString(payload.nodeId),
      assetId: asset.id,
      taskId: job.data.taskId,
      type: 'video',
      status: 'ready',
      resultUrl: storageKey,
      materialId: material.id,
      materialMetadata: material.metadata,
    })
    return {
      assetId: asset.id,
      materialId: material.id,
      videoUrl: storageKey,
      ...(auditionAudioUrl ? { audioUrl: auditionAudioUrl } : {}),
      ...(generated.fallbackMode ? { fallbackMode: generated.fallbackMode } : {}),
      ...(typeof generated.actualVideoTokens === 'number' ? { actualVideoTokens: generated.actualVideoTokens } : {}),
    }
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
        type: 'video',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined)
    }
    throw error
  }
}
