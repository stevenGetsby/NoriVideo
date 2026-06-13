import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import {
  assertTaskActive,
  getProjectModels,
  resolveLipSyncVideoSource,
  resolveVideoSourceFromGeneration,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from './utils'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { mediaUrlFromRef, resolveMediaRef } from '@/lib/media/service'
import { extractStorageKey, getSignedObjectUrl } from '@/lib/storage'
import { ensureStorageObjectAvailable } from '@/lib/storage/ensure-object'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getProviderConfig } from '@/lib/api-config'
import { withRecommendedVideoDurationOptions } from '@/lib/video/recommended-duration'
import { arkCreateVideoTask } from '@/lib/ark-api'
import { HFSY_PROVIDER_ID, HFSY_VIDEO_MODEL_ID } from '@/lib/hfsy-fixed-models'
import {
  buildPanelSeedanceReferenceAssets,
  readPanelSeedanceReferenceAssetsFromActingNotes,
} from '@/lib/novel-promotion/seedance-reference-assets'
import { ensureProjectAssetImagesOnStorage } from '@/lib/novel-promotion/asset-storage-sync'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type VideoGenerationMode = 'normal' | 'firstlastframe'
type PanelRecord = NonNullable<Awaited<ReturnType<typeof prisma.novelPromotionPanel.findUnique>>>
type GeneratedVideoSource = {
  url: string
  actualVideoTokens?: number
  downloadHeaders?: Record<string, string>
  fallbackMode?: 'ark_text_only_after_input_image_moderation'
}
type PanelVideoInputImage = {
  sourceImageBase64?: string
  sourceImageUrl?: string
}

function toDurationMs(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value > 1000 ? Math.round(value) : Math.round(value * 1000)
}

function extractGenerationOptions(payload: AnyObj): VideoOptionMap {
  const fromEnvelope = payload.generationOptions
  if (!fromEnvelope || typeof fromEnvelope !== 'object' || Array.isArray(fromEnvelope)) {
    return {}
  }

  const next: VideoOptionMap = {}
  for (const [key, value] of Object.entries(fromEnvelope as Record<string, unknown>)) {
    if (key === 'aspectRatio') continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value
    }
  }
  return next
}

function isArkInputImageModerationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /InputImageSensitiveContentDetected|PrivacyInformation|输入图片审核未通过|input image/i.test(message)
}

function isArkVideoModel(modelKey: string): boolean {
  return /^ark::/i.test(modelKey) || /doubao-seedance/i.test(modelKey)
}

function isHfsyVideoModel(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  return parsed?.provider === HFSY_PROVIDER_ID && parsed.modelId === HFSY_VIDEO_MODEL_ID
}

function readArkModelId(modelKey: string): string {
  if (modelKey.startsWith('ark::')) return modelKey.slice('ark::'.length)
  return modelKey
}

function normalizeHfsyDuration(value: VideoOptionValue | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 6
  return Math.max(4, Math.min(15, Math.round(parsed)))
}

function resolveHfsyOrientation(ratio: string | null | undefined): 'landscape' | 'portrait' {
  return ratio === '16:9' || ratio === '21:9' || ratio === '4:3' ? 'landscape' : 'portrait'
}

function extractStorageKeyFromPossiblySignedRoute(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/api/storage/sign')) {
    try {
      const params = new URLSearchParams(trimmed.split('?')[1] || '')
      return params.get('key')?.trim() || null
    } catch {
      return null
    }
  }
  return extractStorageKey(trimmed)
}

async function toProviderFetchablePublicUrl(value: string | null | undefined): Promise<string | null> {
  const trimmed = (value || '').trim()
  if (!trimmed || /^asset:\/\//i.test(trimmed) || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return null
  if (/^https?:\/\//i.test(trimmed) && !/\/api\/storage\/sign\b/.test(trimmed)) return trimmed

  const key = extractStorageKeyFromPossiblySignedRoute(trimmed)
  if (!key) return null
  const availableKey = await ensureStorageObjectAvailable(key)
  return availableKey ? await getSignedObjectUrl(availableKey, 3600) : null
}

function readVideoResolution(value: VideoOptionValue | undefined): '480p' | '720p' | '1080p' | undefined {
  return value === '480p' || value === '720p' || value === '1080p' ? value : undefined
}

function buildArkTextOnlyFallbackPrompt(prompt: string): string {
  return [
    '【重要】上游视频模型拒绝使用输入分镜图，为了继续完成 Agent 成片流程，改用纯文本视频生成。',
    '必须严格保持原 panel 的角色资产、服装、场景、道具、人物站位、镜头语言、按秒动作/对白和负面要求。',
    '不要新增无关角色，不要改变剧情，不要改变角色关系，不要改变地域/语言语境。',
    prompt,
  ].join('\n')
}

async function fetchPanelByStoryboardIndex(storyboardId: string, panelIndex: number) {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId,
      panelIndex,
    },
  })
}

async function getPanelForVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj

  // 优先使用 targetType=NovelPromotionPanel 直接定位
  if (job.data.targetType === 'NovelPromotionPanel') {
    const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: job.data.targetId } })
    if (!panel) throw new Error('Panel not found')
    return panel
  }

  // 兜底：通过 storyboardId + panelIndex 定位
  const storyboardId = payload.storyboardId
  const panelIndex = payload.panelIndex
  if (typeof storyboardId !== 'string' || !storyboardId || panelIndex === undefined || panelIndex === null) {
    throw new Error('Missing storyboardId/panelIndex for video task')
  }

  const panel = await fetchPanelByStoryboardIndex(storyboardId, Number(panelIndex))
  if (!panel) throw new Error('Panel not found by storyboardId/panelIndex')
  return panel
}

async function resolvePanelImageInput(panel: PanelRecord): Promise<string | null> {
  const mediaRef = await resolveMediaRef(panel.imageMediaId, panel.imageUrl)
  return mediaUrlFromRef(mediaRef, panel.imageUrl)
}

async function resolvePanelVideoInputImage(panel: PanelRecord): Promise<PanelVideoInputImage> {
  const panelImageInput = await resolvePanelImageInput(panel)
  if (!panelImageInput) return {}
  const sourceImageUrl = toSignedUrlIfCos(panelImageInput, 3600)
  if (!sourceImageUrl) return {}
  return {
    sourceImageUrl,
    sourceImageBase64: await normalizeToBase64ForGeneration(sourceImageUrl),
  }
}

async function resolvePanelAssetReferenceImagesForVideo(
  projectId: string,
  panel: PanelRecord,
  options?: { publicFetchableUrls?: boolean },
): Promise<string[]> {
  const projectModel = (prisma as unknown as {
    novelPromotionProject?: typeof prisma.novelPromotionProject
  }).novelPromotionProject
  if (!projectModel) return []

  const projectAssets = await projectModel.findUnique({
    where: { projectId },
    include: {
      characters: {
        include: {
          appearances: { orderBy: { appearanceIndex: 'asc' } },
        },
      },
      locations: {
        include: {
          selectedImage: true,
          images: { orderBy: { imageIndex: 'asc' } },
        },
      },
    },
  })
  if (!projectAssets) return []

  const persistedReferences = readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)
  const references = persistedReferences.length > 0 ? persistedReferences : buildPanelSeedanceReferenceAssets({
    panel: {
      characters: panel.characters,
      location: panel.location,
      props: panel.props,
      videoPrompt: panel.videoPrompt,
    },
    characterAssets: projectAssets.characters,
    locationAssets: projectAssets.locations,
  })

  const seen = new Set<string>()
  const panelImage = panel.imageUrl?.trim()
  const urls: string[] = []
  for (const reference of references) {
    const resolvedUrl = options?.publicFetchableUrls
      ? await toProviderFetchablePublicUrl(reference.imageUrl)
      : toSignedUrlIfCos(reference.imageUrl, 3600) || reference.imageUrl
    const trimmed = (resolvedUrl || '').trim()
    if (!trimmed || trimmed === panelImage || seen.has(trimmed)) continue
    seen.add(trimmed)
    urls.push(trimmed)
  }
  return urls
}

function normalizeAssetNameForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function panelReferenceNames(panel: PanelRecord): string[] {
  const names = new Set<string>()
  for (const reference of readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)) {
    if (reference.kind === 'character' && reference.name.trim()) names.add(reference.name.trim())
  }
  if (typeof panel.characters === 'string') {
    try {
      const parsed = JSON.parse(panel.characters)
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (typeof item === 'string' && item.trim()) names.add(item.trim())
        })
      }
    } catch {
      panel.characters.split(/[、,，/]/).forEach((item) => {
        if (item.trim()) names.add(item.trim())
      })
    }
  }
  return Array.from(names)
}

async function resolvePanelAudioReferencesForVideo(projectId: string, panel: PanelRecord): Promise<string[]> {
  const names = panelReferenceNames(panel)
  if (names.length === 0) return []
  const normalizedNames = names.map(normalizeAssetNameForMatch).filter(Boolean)
  if (normalizedNames.length === 0) return []

  const projectModel = (prisma as unknown as {
    novelPromotionProject?: typeof prisma.novelPromotionProject
  }).novelPromotionProject
  if (!projectModel) return []

  const projectAssets = await projectModel.findUnique({
    where: { projectId },
    include: {
      characters: true,
    },
  })
  const characters = projectAssets?.characters || []
  const urls: string[] = []
  const seen = new Set<string>()

  for (const character of characters) {
    const characterName = normalizeAssetNameForMatch(character.name)
    const matched = normalizedNames.some((name) => (
      name === characterName
      || (name.length >= 4 && characterName.includes(name))
      || (characterName.length >= 4 && name.includes(characterName))
    ))
    if (!matched || !character.customVoiceUrl) continue
    const url = await toProviderFetchablePublicUrl(character.customVoiceUrl)
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
    if (urls.length >= 3) break
  }

  return urls
}

async function generateVideoForPanel(
  job: Job<TaskJobData>,
  panel: PanelRecord,
  payload: AnyObj,
  modelId: string,
  projectVideoRatio: string | null | undefined,
  generationOptions: VideoOptionMap,
): Promise<{
  cosKey: string
  generationMode: VideoGenerationMode
  actualVideoTokens?: number
  fallbackMode?: 'ark_text_only_after_input_image_moderation'
}> {
  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  const firstLastCustomPrompt = typeof firstLastFramePayload?.customPrompt === 'string' ? firstLastFramePayload.customPrompt : null
  const persistedFirstLastPrompt = firstLastFramePayload ? panel.firstLastFramePrompt : null
  const customPrompt = typeof payload.customPrompt === 'string' ? payload.customPrompt : null
  const prompt = firstLastCustomPrompt || persistedFirstLastPrompt || customPrompt || panel.videoPrompt || panel.description
  if (!prompt) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }

  let lastFrameImageBase64: string | undefined
  const generationMode: VideoGenerationMode = firstLastFramePayload ? 'firstlastframe' : 'normal'
  let model = modelId

  if (firstLastFramePayload) {
    model =
      typeof firstLastFramePayload.flModel === 'string' && firstLastFramePayload.flModel
        ? firstLastFramePayload.flModel
        : modelId
    const firstLastFrameCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
    if (firstLastFrameCapabilities?.video?.firstlastframe !== true) {
      throw new Error(`VIDEO_FIRSTLASTFRAME_MODEL_UNSUPPORTED: ${model}`)
    }
    if (
      typeof firstLastFramePayload.lastFrameStoryboardId === 'string' &&
      firstLastFramePayload.lastFrameStoryboardId &&
      firstLastFramePayload.lastFramePanelIndex !== undefined
    ) {
      const lastPanel = await fetchPanelByStoryboardIndex(
        firstLastFramePayload.lastFrameStoryboardId,
        Number(firstLastFramePayload.lastFramePanelIndex),
      )
      if (lastPanel?.imageUrl) {
        const lastFrameUrl = toSignedUrlIfCos(lastPanel.imageUrl, 3600)
        if (lastFrameUrl) {
          lastFrameImageBase64 = await normalizeToBase64ForGeneration(lastFrameUrl)
        }
      }
    }
  }
  const isArkModel = isArkVideoModel(model)
  const isHfsyModel = isHfsyVideoModel(model)
  const inputImage = isHfsyModel && generationMode === 'normal'
    ? {}
    : await resolvePanelVideoInputImage(panel)
  if (!inputImage.sourceImageBase64 && !isArkModel && !isHfsyModel) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }
  if (generationMode === 'firstlastframe' && !inputImage.sourceImageBase64) {
    throw new Error(`Panel ${panel.id} has no first frame image for first/last frame generation`)
  }

  const selectedCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
  const durationOptions = selectedCapabilities?.video?.durationOptions
  const recommendedGenerationOptions = withRecommendedVideoDurationOptions({
    duration: panel.duration,
    description: panel.description,
    videoPrompt: panel.videoPrompt,
    firstLastFramePrompt: panel.firstLastFramePrompt,
    srtSegment: panel.srtSegment,
    shotType: panel.shotType,
    cameraMove: panel.cameraMove,
  }, generationOptions, durationOptions)
  if (isHfsyVideoModel(model)) {
    await ensureProjectAssetImagesOnStorage(job.data.projectId)
  }
  const shouldAttachPanelReferenceAssets = isArkVideoModel(model) || isHfsyVideoModel(model)
  const panelReferenceImages = shouldAttachPanelReferenceAssets
    ? await resolvePanelAssetReferenceImagesForVideo(job.data.projectId, panel, {
      publicFetchableUrls: isHfsyVideoModel(model),
    })
    : []
  const panelAudioReferences = isHfsyVideoModel(model)
    ? await resolvePanelAudioReferencesForVideo(job.data.projectId, panel)
    : []
  const hfsyDuration = isHfsyVideoModel(model)
    ? normalizeHfsyDuration(recommendedGenerationOptions.duration)
    : undefined
  if (isHfsyVideoModel(model) && panelReferenceImages.length === 0) {
    throw new Error(`Panel ${panel.id} has no public reference assets for HFSY video generation`)
  }

  const videoRequestOptions = {
    prompt,
    ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
    ...recommendedGenerationOptions,
    ...(hfsyDuration ? { duration: hfsyDuration } : {}),
    generationMode,
    ...(panelReferenceImages.length > 0 ? { referenceImages: panelReferenceImages } : {}),
    ...(panelAudioReferences.length > 0 ? { audios: panelAudioReferences } : {}),
    ...(isHfsyVideoModel(model) ? {
      orientation: resolveHfsyOrientation(projectVideoRatio),
      ratio: projectVideoRatio || '9:16',
      size: 'large',
      watermark: false,
    } : {}),
    ...(lastFrameImageBase64 ? { lastFrameImageUrl: lastFrameImageBase64 } : {}),
  }

  let generatedVideo: GeneratedVideoSource
  try {
    generatedVideo = await resolveVideoSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: model,
      imageUrl: inputImage.sourceImageBase64 || panelReferenceImages[0] || '',
      options: videoRequestOptions,
    })
  } catch (error) {
    if (!isArkVideoModel(model) || generationMode !== 'normal' || !isArkInputImageModerationError(error)) {
      throw error
    }
    await reportTaskProgress(job, 35, {
      stage: 'ark_text_only_fallback',
      panelId: panel.id,
      reason: 'input_image_moderation',
    })
    const { apiKey } = await getProviderConfig(job.data.userId, 'ark')
    const fallbackTask = await arkCreateVideoTask({
      model: readArkModelId(model),
      content: [
        {
          type: 'text',
          text: buildArkTextOnlyFallbackPrompt(prompt),
        },
      ],
      ...(readVideoResolution(recommendedGenerationOptions.resolution) ? { resolution: readVideoResolution(recommendedGenerationOptions.resolution) } : {}),
      ...(projectVideoRatio ? { ratio: projectVideoRatio } : {}),
      ...(typeof recommendedGenerationOptions.duration === 'number' ? { duration: recommendedGenerationOptions.duration } : {}),
      ...(typeof recommendedGenerationOptions.generateAudio === 'boolean' ? { generate_audio: recommendedGenerationOptions.generateAudio } : {}),
      ...(typeof recommendedGenerationOptions.seed === 'number' ? { seed: recommendedGenerationOptions.seed } : {}),
      ...(typeof recommendedGenerationOptions.cameraFixed === 'boolean' ? { camera_fixed: recommendedGenerationOptions.cameraFixed } : {}),
      ...(typeof recommendedGenerationOptions.watermark === 'boolean' ? { watermark: recommendedGenerationOptions.watermark } : {}),
    }, {
      apiKey,
      logPrefix: '[ARK Video Fallback]',
    })
    if (!fallbackTask.id) {
      throw new Error('ARK text-only fallback did not return task id')
    }
    const polled = await waitExternalResult(job, `ARK:VIDEO:${fallbackTask.id}`, job.data.userId, {
      progressStart: 45,
      progressEnd: 94,
    })
    generatedVideo = {
      url: polled.url,
      fallbackMode: 'ark_text_only_after_input_image_moderation',
      ...(typeof polled.actualVideoTokens === 'number' ? { actualVideoTokens: polled.actualVideoTokens } : {}),
      ...(polled.downloadHeaders ? { downloadHeaders: polled.downloadHeaders } : {}),
    }
  }

  let downloadHeaders: Record<string, string> | undefined
  const videoSource = generatedVideo.url
  if (generatedVideo.downloadHeaders) {
    downloadHeaders = generatedVideo.downloadHeaders
  } else if (typeof videoSource === 'string') {
    const parsedModel = parseModelKeyStrict(model)
    const isGoogleDownloadUrl = videoSource.includes('generativelanguage.googleapis.com/')
      && videoSource.includes('/files/')
      && videoSource.includes(':download')
    if (parsedModel?.provider === 'google' && isGoogleDownloadUrl) {
      const { apiKey } = await getProviderConfig(job.data.userId, 'google')
      downloadHeaders = { 'x-goog-api-key': apiKey }
    }
  }

  const cosKey = await uploadVideoSourceToCos(videoSource, 'panel-video', panel.id, downloadHeaders)
  return {
    cosKey,
    generationMode,
    ...(generatedVideo.fallbackMode ? { fallbackMode: generatedVideo.fallbackMode } : {}),
    ...(typeof generatedVideo.actualVideoTokens === 'number'
      ? { actualVideoTokens: generatedVideo.actualVideoTokens }
      : {}),
  }
}

async function handleVideoPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)

  const modelId = typeof payload.videoModel === 'string' ? payload.videoModel.trim() : ''
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')

  const panel = await getPanelForVideoTask(job)

  const generationOptions = extractGenerationOptions(payload)

  await reportTaskProgress(job, 10, {
    stage: 'generate_panel_video',
    panelId: panel.id,
  })

  const { cosKey, generationMode, actualVideoTokens, fallbackMode } = await generateVideoForPanel(
    job,
    panel,
    payload,
    modelId,
    projectModels.videoRatio,
    generationOptions,
  )

  await assertTaskActive(job, 'persist_panel_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      videoUrl: cosKey,
      videoGenerationMode: generationMode,
    },
  })

  return {
    panelId: panel.id,
    videoUrl: cosKey,
    ...(fallbackMode ? { fallbackMode } : {}),
    ...(typeof actualVideoTokens === 'number' ? { actualVideoTokens } : {}),
  }
}

async function handleLipSyncTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lipSyncModel = typeof payload.lipSyncModel === 'string' && payload.lipSyncModel.trim()
    ? payload.lipSyncModel.trim()
    : undefined

  let panel: PanelRecord | null = null
  if (job.data.targetType === 'NovelPromotionPanel') {
    panel = await prisma.novelPromotionPanel.findUnique({ where: { id: job.data.targetId } })
  }

  if (
    !panel &&
    typeof payload.storyboardId === 'string' &&
    payload.storyboardId &&
    payload.panelIndex !== undefined
  ) {
    panel = await fetchPanelByStoryboardIndex(payload.storyboardId, Number(payload.panelIndex))
  }

  if (!panel) throw new Error('Lip-sync panel not found')
  if (!panel.videoUrl) throw new Error('Panel has no base video')

  const voiceLineId = typeof payload.voiceLineId === 'string' ? payload.voiceLineId : null
  if (!voiceLineId) throw new Error('Lip-sync task missing voiceLineId')

  const voiceLine = await prisma.novelPromotionVoiceLine.findUnique({ where: { id: voiceLineId } })
  if (!voiceLine || !voiceLine.audioUrl) {
    throw new Error('Voice line or audioUrl not found')
  }

  const signedVideoUrl = toSignedUrlIfCos(panel.videoUrl, 7200)
  const signedAudioUrl = toSignedUrlIfCos(voiceLine.audioUrl, 7200)

  if (!signedVideoUrl || !signedAudioUrl) {
    throw new Error('Lip-sync input media url invalid')
  }

  await reportTaskProgress(job, 25, { stage: 'submit_lip_sync' })

  const source = await resolveLipSyncVideoSource(job, {
    userId: job.data.userId,
    videoUrl: signedVideoUrl,
    audioUrl: signedAudioUrl,
    audioDurationMs: typeof voiceLine.audioDuration === 'number' ? voiceLine.audioDuration : undefined,
    videoDurationMs: toDurationMs(panel.duration),
    modelKey: lipSyncModel,
  })

  await reportTaskProgress(job, 93, { stage: 'persist_lip_sync' })

  const cosKey = await uploadVideoSourceToCos(source, 'lip-sync', panel.id)

  await assertTaskActive(job, 'persist_lip_sync_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      lipSyncVideoUrl: cosKey,
      lipSyncTaskId: null,
    },
  })

  return {
    panelId: panel.id,
    voiceLineId,
    lipSyncVideoUrl: cosKey,
  }
}

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VIDEO_PANEL:
      return await handleVideoPanelTask(job)
    case TASK_TYPE.LIP_SYNC:
      return await handleLipSyncTask(job)
    default:
      throw new Error(`Unsupported video task type: ${job.data.type}`)
  }
}

export function createVideoWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VIDEO,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'video',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.video,
        run: async () => await processVideoTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VIDEO || '4', 10) || 4,
    },
  )
}
