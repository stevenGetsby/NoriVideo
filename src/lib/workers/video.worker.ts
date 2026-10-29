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
} from './utils'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { mediaUrlFromRef, resolveMediaRef } from '@/lib/media/service'
import { extractStorageKey, getSignedObjectUrl } from '@/lib/storage'
import { ensureStorageObjectAvailable } from '@/lib/storage/ensure-object'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveRuntimeModelKey } from '@/lib/nori-model-catalog'
import { withRecommendedVideoDurationOptions } from '@/lib/video/recommended-duration'
import { handleCanvasVideoOperationTask } from './handlers/canvas-operation-task-handler'
import {
  buildPanelSeedanceReferenceAssets,
  mergePanelSeedanceReferenceAssets,
  readPanelSeedanceReferenceAssetsFromActingNotes,
  type PanelSeedanceReferenceAsset,
} from '@/lib/novel-promotion/seedance-reference-assets'
import {
  compileSeedancePromptForSubmission,
  extractSeedanceVideoPromptBody,
  isSeedanceVideoPromptBody,
  stripSeedancePromptAssetMentions,
} from '@/lib/novel-promotion/seedance-prompt-assets'
import { readPanelFrameOSMetadataFromActingNotes } from '@/lib/novel-promotion/panel-frameos-metadata'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { handleToolboxVideoTask } from './handlers/toolbox-video-task-handler'
import { appendProjectArtStyleConstraint } from '@/lib/projects/creation-config'

import { pickVideoResultMetadata, type VideoResultMetadata } from '@/lib/video-result'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type VideoGenerationMode = 'normal' | 'firstlastframe'
type PanelRecord = NonNullable<Awaited<ReturnType<typeof prisma.novelPromotionPanel.findUnique>>>
type GeneratedVideoSource = VideoResultMetadata & {
  url: string
  actualVideoTokens?: number
  downloadHeaders?: Record<string, string>
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

function readVideoModelId(modelKey: string): string {
  const runtimeModelKey = resolveRuntimeModelKey(modelKey) || modelKey
  return parseModelKeyStrict(runtimeModelKey)?.modelId || runtimeModelKey
}

function supportsSeedanceReferenceMode(modelKey: string): boolean {
  // The Seedance reference protocol applies to every Seedance 2.x model,
  // including the Kuaizi routing used by new tasks.
  return /^doubao-seedance-2-(?:0|5)(?:-|$)/i.test(readVideoModelId(modelKey))
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

function readVideoResolution(value: VideoOptionValue | undefined): '480p' | '720p' | '1080p' | '4k' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized === '480p' || normalized === '720p' || normalized === '1080p' || normalized === '4k'
    ? normalized
    : undefined
}

function buildPanelVideoPromptWithFrameOSEvidence(panel: PanelRecord, basePrompt: string): string {
  const metadata = readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)
  if (!metadata) return basePrompt

  const evidence: Record<string, unknown> = {}
  if (metadata.panel_id) evidence.panel_id = metadata.panel_id
  if (metadata.panel_number !== undefined) evidence.panel_number = metadata.panel_number
  if (metadata.source_text) evidence.source_text = metadata.source_text
  if (metadata.source_anchor !== undefined) evidence.source_anchor = metadata.source_anchor
  if (metadata.referenced_assets !== undefined) evidence.referenced_assets = metadata.referenced_assets
  if (metadata.continuity_notes) evidence.continuity_notes = metadata.continuity_notes
  if (metadata.voice_refs !== undefined) evidence.voice_refs = metadata.voice_refs
  if (metadata.visual_style) evidence.visual_style = metadata.visual_style
  if (metadata.visual_style_description) evidence.visual_style_description = metadata.visual_style_description

  if (Object.keys(evidence).length === 0) return basePrompt
  return [
    basePrompt,
    '',
    'FrameOS production evidence for this panel. Keep the video consistent with this evidence; do not add subtitles or visible text from voice_refs.',
    JSON.stringify(evidence, null, 2),
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
): Promise<PanelSeedanceReferenceAsset[]> {
  const projectModel = (prisma as unknown as {
    novelPromotionProject?: typeof prisma.novelPromotionProject
  }).novelPromotionProject
  if (!projectModel) return []
  const storyboardModel = (prisma as unknown as {
    novelPromotionStoryboard?: typeof prisma.novelPromotionStoryboard
  }).novelPromotionStoryboard

  const [projectAssets, storyboardContext] = await Promise.all([
    projectModel.findUnique({
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
    }),
    storyboardModel ? storyboardModel.findFirst({
      where: {
        id: panel.storyboardId,
        episode: { novelPromotionProject: { projectId } },
      },
      select: { episode: { select: { episodeNumber: true } } },
    }) : Promise.resolve(null),
  ])
  if (!projectAssets) return []

  const persistedReferences = readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)
  const generatedReferences = buildPanelSeedanceReferenceAssets({
    panel: {
      characters: panel.characters,
      location: panel.location,
      props: panel.props,
      videoPrompt: panel.videoPrompt,
    },
    characterAssets: projectAssets.characters,
    locationAssets: projectAssets.locations,
    episodeNumber: storyboardContext?.episode.episodeNumber,
    sceneId: readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)?.panel_id?.match(/^S\d+/i)?.[0] || null,
  })
  const references = mergePanelSeedanceReferenceAssets(generatedReferences, persistedReferences)

  const seen = new Set<string>()
  const panelImage = panel.imageUrl?.trim()
  const resolvedAssets: PanelSeedanceReferenceAsset[] = []
  for (const reference of references) {
    const resolvedUrl = reference.imageUrl.startsWith('asset://')
      ? reference.imageUrl
      : options?.publicFetchableUrls
      ? await toProviderFetchablePublicUrl(reference.imageUrl)
      : toSignedUrlIfCos(reference.imageUrl, 3600) || reference.imageUrl
    const trimmed = (resolvedUrl || '').trim()
    if (!trimmed || reference.imageUrl === panelImage || trimmed === panelImage || seen.has(trimmed)) continue
    seen.add(trimmed)
    resolvedAssets.push({ ...reference, imageUrl: trimmed })
  }
  return resolvedAssets
}

function normalizeAssetNameForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function addCharacterNames(names: Set<string>, value: unknown) {
  if (typeof value === 'string') {
    value.split(/[、,，/]/).forEach((item) => {
      const normalized = item.trim()
      if (normalized) names.add(normalized)
    })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => addCharacterNames(names, item))
    return
  }
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>
  addCharacterNames(names, row.name ?? row.speaker ?? row.character ?? row.characterName)
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
  const frameosMetadata = readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)
  if (frameosMetadata?.referenced_assets && typeof frameosMetadata.referenced_assets === 'object') {
    addCharacterNames(
      names,
      (frameosMetadata.referenced_assets as Record<string, unknown>).characters,
    )
  }
  addCharacterNames(names, frameosMetadata?.voice_refs)
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
    if (!matched || (!character.customVoiceUrl && !character.customVoiceMediaId)) continue
    const voiceMedia = await resolveMediaRef(character.customVoiceMediaId, character.customVoiceUrl)
    const url = await toProviderFetchablePublicUrl(
      voiceMedia?.storageKey || voiceMedia?.url || character.customVoiceUrl,
    )
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
  projectArtStylePrompt: string | null | undefined,
  generationOptions: VideoOptionMap,
): Promise<VideoResultMetadata & {
  cosKey: string
  generationMode: VideoGenerationMode
  actualVideoTokens?: number
}> {
  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  const firstLastCustomPrompt = typeof firstLastFramePayload?.customPrompt === 'string' ? firstLastFramePayload.customPrompt : null
  const persistedFirstLastPrompt = firstLastFramePayload ? panel.firstLastFramePrompt : null
  const customPrompt = typeof payload.customPrompt === 'string' ? payload.customPrompt : null
  const rawPrompt = firstLastCustomPrompt || persistedFirstLastPrompt || customPrompt || panel.videoPrompt || panel.description
  if (!rawPrompt?.trim()) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }
  const editorPrompt = appendProjectArtStyleConstraint(
    extractSeedanceVideoPromptBody(rawPrompt),
    projectArtStylePrompt,
  )
  const shouldAppendFrameOSEvidence = !firstLastCustomPrompt
    && !customPrompt
    && !isSeedanceVideoPromptBody(editorPrompt)

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
  const seedanceReferenceMode = supportsSeedanceReferenceMode(model) && generationMode === 'normal'
  const inputImage = await resolvePanelVideoInputImage(panel)
  if (!inputImage.sourceImageBase64 && !supportsSeedanceReferenceMode(model)) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }
  if (generationMode === 'firstlastframe' && !inputImage.sourceImageBase64) {
    throw new Error(`Panel ${panel.id} has no first frame image for first/last frame generation`)
  }

  const selectedCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
  const durationOptions = selectedCapabilities?.video?.durationOptions
  const recommendedGenerationOptionsRaw = withRecommendedVideoDurationOptions({
    duration: panel.duration,
    description: panel.description,
    videoPrompt: panel.videoPrompt,
    firstLastFramePrompt: panel.firstLastFramePrompt,
    srtSegment: panel.srtSegment,
    shotType: panel.shotType,
    cameraMove: panel.cameraMove,
  }, generationOptions, durationOptions)
  const canonicalResolution = readVideoResolution(recommendedGenerationOptionsRaw.resolution)
  const recommendedGenerationOptions = canonicalResolution
    ? { ...recommendedGenerationOptionsRaw, resolution: canonicalResolution }
    : recommendedGenerationOptionsRaw
  const panelReferenceAssets = seedanceReferenceMode
    ? await resolvePanelAssetReferenceImagesForVideo(job.data.projectId, panel)
    : []
  const panelReferenceImages = panelReferenceAssets.map((asset) => asset.imageUrl)
  const usesSeedanceReferenceImageMode = seedanceReferenceMode && panelReferenceAssets.length > 0
  const panelAudioReferences = seedanceReferenceMode
    ? await resolvePanelAudioReferencesForVideo(job.data.projectId, panel)
    : []
  const usesSeedanceReferenceMediaMode = seedanceReferenceMode
    && (panelReferenceAssets.length > 0 || panelAudioReferences.length > 0)
  const effectiveReferenceImages = usesSeedanceReferenceMediaMode
    && panelReferenceImages.length === 0
    && inputImage.sourceImageUrl
    ? [inputImage.sourceImageUrl]
    : panelReferenceImages
  const providerBasePrompt = usesSeedanceReferenceImageMode
    ? compileSeedancePromptForSubmission(editorPrompt, panelReferenceAssets)
    : seedanceReferenceMode
      ? stripSeedancePromptAssetMentions(editorPrompt, panelReferenceAssets)
      : editorPrompt
  const prompt = shouldAppendFrameOSEvidence
    ? buildPanelVideoPromptWithFrameOSEvidence(panel, providerBasePrompt)
    : providerBasePrompt

  const videoRequestOptions = {
    prompt,
    ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
    ...recommendedGenerationOptions,
    ...(panelAudioReferences.length > 0 ? { generateAudio: true } : {}),
    generationMode,
    ...(effectiveReferenceImages.length > 0 ? { referenceImages: effectiveReferenceImages } : {}),
    ...(panelAudioReferences.length > 0 ? { audios: panelAudioReferences } : {}),
    ...(lastFrameImageBase64 ? { lastFrameImageUrl: lastFrameImageBase64 } : {}),
  }

  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: model,
    imageUrl: usesSeedanceReferenceMediaMode
      ? ''
      : inputImage.sourceImageBase64 || panelReferenceImages[0] || '',
    options: videoRequestOptions,
  })

  const downloadHeaders = generatedVideo.downloadHeaders
  const videoSource = generatedVideo.url

  const cosKey = await uploadVideoSourceToCos(videoSource, 'panel-video', panel.id, downloadHeaders)
  return {
    cosKey,
    generationMode,
    ...pickVideoResultMetadata(generatedVideo),
  }
}

async function handleVideoPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)

  const modelId = typeof payload.videoModel === 'string' ? payload.videoModel.trim() : ''
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')

  const panel = await getPanelForVideoTask(job)

  const generationOptions = {
    ...(projectModels.videoResolution ? { resolution: projectModels.videoResolution } : {}),
    ...extractGenerationOptions(payload),
  }

  await reportTaskProgress(job, 10, {
    stage: 'generate_panel_video',
    panelId: panel.id,
  })

  const { cosKey, generationMode, ...videoMetadata } = await generateVideoForPanel(
    job,
    panel,
    payload,
    modelId,
    projectModels.videoRatio,
    projectModels.artStylePrompt,
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
  await registerFrameosMaterial({
    userId: job.data.userId,
    projectId: job.data.projectId,
    title: `分镜视频 · 镜头 ${panel.panelNumber ?? panel.panelIndex + 1}`,
    type: 'video',
    source: 'production',
    storageKey: cosKey,
    metadata: {
      taskId: job.data.taskId,
      originType: 'panel-video',
      originId: panel.id,
      generationMode,
      ...pickVideoResultMetadata(videoMetadata),
      prompt: payload.customPrompt || panel.videoPrompt || panel.description,
    },
  })

  return {
    panelId: panel.id,
    videoUrl: cosKey,
    ...pickVideoResultMetadata(videoMetadata),
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
    case TASK_TYPE.TOOLBOX_VIDEO:
      return await handleToolboxVideoTask(job)
    case TASK_TYPE.CANVAS_VIDEO_OPERATION:
      return await handleCanvasVideoOperationTask(job)
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
