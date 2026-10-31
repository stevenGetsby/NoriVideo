import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToCos,
} from '../utils'
import { normalizeSeedanceImageReferences, normalizeSeedanceMediaReference } from '@/lib/media/seedance-reference'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { compileSeedancePromptForSubmission } from '@/lib/novel-promotion/seedance-prompt-assets'
import { projectCanvasToolboxTaskTerminal } from '@/lib/canvas/toolbox-node-binding'
import { workerTaskWillRetry } from '../retry-state'
import { normalizeCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { extractVoiceAudioFromVideo } from '@/lib/media/video-audio'
import { generateUniqueKey, getObjectBuffer, uploadObject } from '@/lib/storage'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { ensureSeedanceCharacterAsset } from '@/lib/novel-promotion/seedance-character-asset'
import { normalizeFrameosAssetCategory } from '@/lib/frameos/material-category'
import { pickVideoResultMetadata, type VideoResultMetadata } from '@/lib/video-result'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveRuntimeModelKey } from '@/lib/nori-model-catalog'
import { enhanceCanvasVideo, type CanvasVideoOperationHooks } from '@/lib/canvas/video-operations'

type AnyObj = Record<string, unknown>
type GeneratedVideo = VideoResultMetadata & {
  url: string
  actualVideoTokens?: number
  downloadHeaders?: Record<string, string>
}

function isKuaiziSeedanceModel(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(resolveRuntimeModelKey(modelKey) || modelKey)
  return parsed?.provider === 'kuaizi'
    && /^doubao-seedance-2-(?:0|5)(?:-|$)/i.test(parsed.modelId)
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

async function normalizeReferenceMedia(values: string[], modelKey: string): Promise<string[]> {
  return await Promise.all(values.map(async (value) => await normalizeSeedanceMediaReference(value, modelKey)))
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
    if (asset.bizType === 'character_audition' && isKuaiziSeedanceModel(modelId)) {
      const characterId = readString(readJsonObject(asset.params).characterId)
      if (!characterId) throw new Error('角色试镜任务缺少 characterId。')
      await reportTaskProgress(job, 18, { stage: 'prepare_character_private_asset' })
      const privateAsset = await ensureSeedanceCharacterAsset({
        userId: job.data.userId,
        projectId: job.data.projectId,
        characterId,
        modelKey: modelId,
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
      normalized = await normalizeSeedanceImageReferences(referenceImages, modelId)
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
    const normalizedVideos = useReferenceMode ? await normalizeReferenceMedia(referenceVideos, modelId) : []
    const normalizedAudios = useReferenceMode ? await normalizeReferenceMedia(referenceAudios, modelId) : []
    const buildGenerationOptions = (images: string[]) => ({
      prompt,
      ...(useReferenceMode && images.length > 0 ? { referenceImages: images } : {}),
      ...(useReferenceMode && normalizedVideos.length > 0 ? { videos: normalizedVideos } : {}),
      ...(useReferenceMode && normalizedAudios.length > 0 ? { audios: normalizedAudios } : {}),
      ...(isFirstLastFrame ? { lastFrameImageUrl: images[lastFrameIndex] } : {}),
      ...(readNumber(payload.duration) !== undefined ? { duration: readNumber(payload.duration) } : {}),
      ...(readNumber(payload.fps) !== undefined ? { fps: readNumber(payload.fps) } : {}),
      ...(readString(payload.resolution) ? { resolution: readString(payload.resolution) } : {}),
      ...(readString(payload.aspectRatio) ? { aspectRatio: readString(payload.aspectRatio) } : {}),
      ...(typeof payload.generateAudio === 'boolean' ? { generateAudio: payload.generateAudio } : {}),
      generationMode: isFirstLastFrame ? 'firstlastframe' as const : 'normal' as const,
    })
    const generated: GeneratedVideo = await resolveVideoSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId,
      imageUrl: sourceImage,
      options: buildGenerationOptions(normalized),
    })
    let storageKey = await uploadVideoSourceToCos(generated.url, 'toolbox-video', asset.id, generated.downloadHeaders)
    const superresolveTarget = readString(payload.superresolveTarget)
    const actualResolution = readString(payload.resolution) || readString(generated.resolution)
    let outputMetadata: Record<string, unknown> = {}
    if (superresolveTarget === '720p' || superresolveTarget === '1080p' || superresolveTarget === '4k') {
      await assertTaskActive(job, 'superresolve_toolbox_video')
      await reportTaskProgress(job, 75, { stage: 'superresolve_toolbox_video', superresolveTarget })
      const source = await getObjectBuffer(storageKey)
      let lastReportedProgress = 75
      const hooks: CanvasVideoOperationHooks = {
        assertActive: async () => await assertTaskActive(job, 'superresolve_toolbox_video'),
        onProgress: async (ratio) => {
          const progress = 75 + Math.floor(Math.max(0, Math.min(1, ratio)) * 18)
          if (progress < lastReportedProgress + 2) return
          lastReportedProgress = progress
          await reportTaskProgress(job, progress, { stage: 'superresolve_toolbox_video', progressDetails: { mediaProgress: ratio } })
        },
      }
      const enhanced = await enhanceCanvasVideo(source, { target: superresolveTarget }, hooks)
      storageKey = await uploadObject(enhanced.body, `toolbox-video-superresolved/${job.data.userId}/${job.data.taskId}.mp4`, 1, 'video/mp4')
      outputMetadata = {
        width: enhanced.width,
        height: enhanced.height,
        durationSeconds: enhanced.duration,
        fps: enhanced.fps,
        superresolveTarget,
        outputResolution: superresolveTarget,
      }
      await assertTaskActive(job, 'persist_toolbox_video_superresolve')
    }
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
        ...pickVideoResultMetadata(generated),
        ...outputMetadata,
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
      ...pickVideoResultMetadata(generated),
      ...outputMetadata,
      ...(actualResolution && Object.keys(outputMetadata).length > 0 ? { resolution: actualResolution } : {}),
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
