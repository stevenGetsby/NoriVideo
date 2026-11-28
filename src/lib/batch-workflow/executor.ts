/**
 * 5-Stage Skill-Pluggable Video Workflow Execution Engine.
 *
 * Stages:
 *   S1 script_analysis  -> Volcengine Ark video understanding OR pasted-script skip-in
 *   S2 script_rewrite   -> Viewer-validated LLM rewrite with Skill + StageParams
 *   S3 asset_extraction -> S3A LLM asset extraction (<=900 char prompt clamp + workspace material auto-reuse)
 *                          + S3B real `TASK_TYPE.TOOLBOX_IMAGE` batch/single image generation + voice/material binding
 *   S4 storyboard       -> Capability-aware LLM storyboard (@AssetName mentions, auto-forbidding unsupported firstlastframe)
 *   S5 video_gen        -> Real `TASK_TYPE.TOOLBOX_VIDEO` multi-take generation (proper inputMode, @mention names/aliases,
 *                          auto character voice audio attachment, inputVideoSeconds) + take selection
 *
 * Also provides:
 * - `syncBatchItemTaskStatuses`: syncs BOTH S3 TOOLBOX_IMAGE and S5 TOOLBOX_VIDEO tasks
 * - `markDownstreamStagesStale`: locks S1..K-1 and marks downstream S(K+1)..S5 stale while preserving outputs
 * - `runStageSkillTrial`: executes stage K with draft Skill overrides against locked upstream without overwriting outputs
 * - `refineWorkflowSkillWithAi`: AI-assisted admin Skill refinement returning `SkillRefineProposal`
 * - `advanceBatchRun`: supports both `gated` and `auto` execution with `hasPendingAsyncTasks`
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { resolveModelSelection } from '@/lib/api-config'
import { getCompletionContent } from '@/lib/llm-client'
import { runModelGatewayTextCompletion } from '@/lib/model-gateway/llm'
import { safeParseJsonObject } from '@/lib/json-repair'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { NORI_DEFAULT_MODEL_KEYS } from '@/lib/nori-model-catalog'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'
import {
  listSelectableModelsForViewer,
  resolveModelKeyForViewer,
  type ModelViewerContext,
} from '@/lib/platform-services/model-selection'
import {
  getCapabilityOptionFields,
  resolveBuiltinCapabilitiesByModelKey,
} from '@/lib/model-capabilities/lookup'
import type { ModelCapabilities } from '@/lib/model-config-contract'
import {
  readMediaDurationSeconds,
  resolveCanvasGenerationInputSchema,
  type CanvasReferenceMediaSummary,
} from '@/lib/canvas/generation-input-schema'
import {
  frameosAssetAliasesFromMetadata,
  frameosAssetCategoryFromMetadata,
  normalizeFrameosAssetCategory,
} from '@/lib/frameos/material-category'
import { characterVoiceMaterialId } from '@/lib/frameos/character-voice-reference'
import { ensureFrameosReferenceMediaDurations } from '@/lib/frameos/reference-media-duration'
import { understandStorageVideoWithSkill } from '@/lib/volcengine/video-understanding'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { workspaceUserWhere } from '@/lib/collaboration/access'
import {
  getWorkflowSkillById,
  mapBatchItemRow,
  mapBatchRunRow,
  recomputeBatchRunSummary,
  resolveWorkflowSkill,
} from './service'
import {
  readBatchItemRow,
  updateBatchItemForUser,
  updateBatchItemWithRetry,
  type BatchItemRow,
} from './item-store'
import {
  assertNormalizedWorkflowArtifact,
  assertStrictWorkflowArtifact,
  buildQcCorrectionPrompt,
  evaluateWorkflowQuality,
  WORKFLOW_STAGE_TIMEOUT_MS,
  WORKFLOW_MAX_SHOTS,
} from './quality'
import {
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_META,
  buildOriginalScriptFromPastedText,
  clampImagePrompt,
  getNextWorkflowStage,
  getStageIndex,
  hasBatchRunPendingAsyncTasks,
  isWorkflowStage,
  normalizeBatchItemInputPayload,
  normalizeVideoAspectRatio,
  normalizeVideoInputMode,
  reconcileShotAssetMentions,
  type AdvanceBatchRunResult,
  type AssetExtractionStageParams,
  type AssetsArtifact,
  type BatchItemDTO,
  type BatchItemStageOutputs,
  type BatchItemStatus,
  type BatchRunDTO,
  type BatchRunMode,
  type BatchStageState,
  type ImageQualityLevel,
  type OriginalScriptArtifact,
  type OriginalScriptBeat,
  type RewrittenScriptArtifact,
  type RewrittenScriptScene,
  type RunStageSkillTrialResult,
  type ScriptAnalysisStageParams,
  type ScriptRewriteStageParams,
  type SkillRefineProposal,
  type StageParams,
  type StageSkillDraftPatch,
  type StoryboardArtifact,
  type StoryboardShotItem,
  type StoryboardStageParams,
  type VideoAspectRatio,
  type VideoGenArtifact,
  type VideoGenShotEntry,
  type VideoGenShotOverride,
  type VideoGenStageParams,
  type VideoInputMode,
  type VideoShotTake,
  type VideoTakeStatus,
  type WorkflowAssetImageStatus,
  type WorkflowAssetImageVersion,
  type WorkflowAssetItem,
  type WorkflowAssetKind,
  type WorkflowModelConfig,
  type WorkflowSkillDTO,
  type WorkflowSkillFewShotExample,
  type WorkflowSkillModelPreferences,
  type WorkflowSkillQcRules,
  type WorkflowStage,
  type WorkflowTemplateStageConfig,
} from './types'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((v) => cleanText(v)).filter(Boolean)))
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue
}

function buildSystemPromptWithExamples(skill: WorkflowSkillDTO): string {
  if (!skill.fewShotExamples || skill.fewShotExamples.length === 0) {
    return skill.systemPrompt
  }
  const examplesBlock = skill.fewShotExamples
    .map((ex, idx) => `### 示例 ${idx + 1}：${ex.title}\n输入：${ex.input}\n输出：\n${ex.output}`)
    .join('\n\n')
  return `${skill.systemPrompt}\n\n---\n参考高质量范例：\n${examplesBlock}`
}

const ASSET_IMAGE_PROMPT_MAX_CHARS = 900
const MEDIA_SUBMIT_CONCURRENCY = 4

async function mapWithConcurrency<T, R>(values: readonly T[], worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  async function consume(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++
      results[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(MEDIA_SUBMIT_CONCURRENCY, values.length) }, consume))
  return results
}

function mergeSkillWithDraftPatch(  baseSkill: WorkflowSkillDTO,
  patch?: StageSkillDraftPatch | null,
): WorkflowSkillDTO {
  if (!patch) return baseSkill
  return {
    ...baseSkill,
    name: cleanText(patch.name, baseSkill.name),
    systemPrompt: typeof patch.systemPrompt === 'string' && patch.systemPrompt.trim()
      ? patch.systemPrompt.trim()
      : baseSkill.systemPrompt,
    fewShotExamples: Array.isArray(patch.fewShotExamples) ? patch.fewShotExamples : baseSkill.fewShotExamples,
    qcRules: patch.qcRules !== undefined ? patch.qcRules : baseSkill.qcRules,
    modelPreferences: patch.modelPreferences !== undefined
      ? { ...(baseSkill.modelPreferences || {}), ...(patch.modelPreferences || {}) }
      : baseSkill.modelPreferences,
  }
}

// ============================================================
// Viewer-Validated Model & Capability Helpers (exported for tests)
// ============================================================

async function resolveValidatedModelForStage(params: {
  workspaceOwnerId: string
  actorId: string
  requestedModelKey?: string | null
  explicitRequested?: boolean
  type: 'llm' | 'image' | 'video'
}): Promise<{ modelKey: string; runtimeModelKey: string; actualModelKey: string }> {
  const platformConfig = getPlatformServiceConfigResponse()
  const viewer: ModelViewerContext = {
    userId: params.actorId,
    actorId: params.actorId,
    workspaceOwnerId: params.workspaceOwnerId,
  }
  const typeLabel = params.type === 'llm' ? '文本' : params.type === 'image' ? '图片' : '视频'
  const fallbackDefault = NORI_DEFAULT_MODEL_KEYS[params.type]
  const candidate = cleanText(params.requestedModelKey) || fallbackDefault

  let chosenModelKey = candidate
  let chosenRuntimeKey = candidate

  const access = resolveModelKeyForViewer(platformConfig, candidate, params.type, viewer)
  if (access.allowed) {
    chosenModelKey = access.modelKey
    chosenRuntimeKey = access.runtimeModelKey
  } else {
    if (params.explicitRequested) {
      throw new ApiError('MODEL_UNAVAILABLE', { message: `所选${typeLabel}模型不可用：${access.reason}` })
    }
    const selectable = listSelectableModelsForViewer(platformConfig, params.type, viewer)
    if (selectable.length === 0) {
      throw new ApiError('MODEL_UNAVAILABLE', { message: `当前账号没有可用的${typeLabel}模型，请检查平台模型与 API Key 配置。` })
    }
    chosenModelKey = selectable[0].modelKey
    chosenRuntimeKey = selectable[0].runtimeModelKey
  }

  try {
    const selection = await resolveModelSelection(params.workspaceOwnerId, chosenModelKey, params.type, viewer)
    return {
      modelKey: chosenModelKey,
      runtimeModelKey: chosenRuntimeKey || selection.modelKey,
      actualModelKey: selection.modelKey,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ApiError('MODEL_UNAVAILABLE', {
      message: `无法解析${typeLabel}模型（${chosenModelKey}），请检查后台模型路由与 API Key 配置：${detail}`,
    })
  }
}

export interface VideoCapabilitiesSummary {
  supportsFirstLastFrame: boolean
  durationRange: { min: number; max: number; allowed: number[] }
  resolutionOptions: string[]
  supportsGenerateAudio: boolean
  maxImages: number
  maxVideos: number
  maxAudios: number
}

export function resolveVideoCapabilitiesSummary(actualVideoModelKey: string): VideoCapabilitiesSummary {
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', actualVideoModelKey)
  const fields = getCapabilityOptionFields('video', capabilities)
  const inputSchema = resolveCanvasGenerationInputSchema('video', capabilities)

  const durationNums = Array.isArray(fields.duration)
    ? fields.duration
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)
    : []
  const allowed = durationNums.length > 0 ? durationNums : [4, 5, 6, 7, 8, 9, 10, 11, 12, 15]
  const resolutionOptions = Array.isArray(fields.resolution)
    ? fields.resolution.filter((v): v is string => typeof v === 'string')
    : ['480p', '720p', '1080p']

  const generationModes = Array.isArray(fields.generationMode)
    ? fields.generationMode.filter((v): v is string => typeof v === 'string')
    : null
  const supportsFirstLastFrame =
    capabilities?.video?.firstlastframe === true
    && (!generationModes || generationModes.includes('firstlastframe'))

  const supportsGenerateAudio = capabilities?.video?.supportGenerateAudio !== false

  return {
    supportsFirstLastFrame,
    durationRange: {
      min: allowed[0] ?? 4,
      max: allowed[allowed.length - 1] ?? 15,
      allowed,
    },
    resolutionOptions,
    supportsGenerateAudio,
    maxImages: inputSchema.image.max,
    maxVideos: inputSchema.video.max,
    maxAudios: inputSchema.audio.max,
  }
}

export function pickClosestAllowedDuration(desired: number, allowed: readonly number[]): number {
  if (allowed.length === 0) return Math.max(4, Math.min(15, Math.round(desired || 5)))
  const target = Number.isFinite(desired) ? desired : 5
  let best = allowed[0]
  let bestDiff = Math.abs(best - target)
  for (const val of allowed) {
    const diff = Math.abs(val - target)
    if (diff < bestDiff) {
      best = val
      bestDiff = diff
    }
  }
  return best
}

/**
 * Resolves provider-valid image generation options from capability catalog
 * (e.g. OpenLux pixel sizes `1024x1536`/`1536x1024`/`1024x1024` vs Huimengi `1K`/`2K`).
 */
export function resolveImageGenerationOptionsForCapabilities(params: {
  capabilities?: ModelCapabilities
  preferredResolution?: string | null
  preferredQuality?: ImageQualityLevel | null
  aspectRatio: VideoAspectRatio
}): { aspectRatio: VideoAspectRatio; resolution?: string; quality?: ImageQualityLevel } {
  const fields = getCapabilityOptionFields('image', params.capabilities)
  const allowedAspectRatios = Array.isArray(fields.aspectRatio)
    ? fields.aspectRatio.filter((v): v is string => typeof v === 'string')
    : []
  // Never pass video-only 'adaptive' to an image model; fall back cleanly to '16:9' (or first supported image ratio).
  let resolvedAspectRatio: VideoAspectRatio =
    params.aspectRatio === 'adaptive' ? '16:9' : params.aspectRatio
  if (allowedAspectRatios.length > 0 && !allowedAspectRatios.includes(resolvedAspectRatio)) {
    if (resolvedAspectRatio === '21:9' && allowedAspectRatios.includes('16:9')) {
      resolvedAspectRatio = '16:9'
    } else {
      const firstAllowed = normalizeVideoAspectRatio(allowedAspectRatios[0], '16:9')
      resolvedAspectRatio = firstAllowed === 'adaptive' ? '16:9' : firstAllowed
    }
  }

  const allowedResolutions = Array.isArray(fields.resolution)
    ? fields.resolution.filter((v): v is string => typeof v === 'string')
    : []

  let resolvedResolution: string | undefined
  const preferred = cleanText(params.preferredResolution)

  if (allowedResolutions.length > 0) {
    // 1. Exact or case-insensitive match for explicitly preferred resolution (skip generic 'auto' if we can pick better pixel ratio, or accept 'auto' if explicitly wanted)
    const exactMatch = preferred
      ? allowedResolutions.find((r) => r.toLowerCase() === preferred.toLowerCase())
      : undefined

    const hasPixelSizes = allowedResolutions.some((r) => /^\d+x\d+$/i.test(r))
    const hasKTiers = allowedResolutions.some((r) => /^\d+(?:\.\d+)?k$/i.test(r))

    if (exactMatch && !(exactMatch === 'auto' && hasPixelSizes)) {
      resolvedResolution = exactMatch
    } else if (hasPixelSizes) {
      const portraitCandidates = ['1024x1536', '720x1280', '2160x3840', 'auto']
      const landscapeCandidates = ['1536x1024', '2048x1152', '1280x720', '3840x2160', 'auto']
      const squareCandidates = ['1024x1024', '2048x2048', 'auto']
      const candidates =
        resolvedAspectRatio === '9:16' || resolvedAspectRatio === '3:4'
          ? portraitCandidates
          : resolvedAspectRatio === '16:9' || resolvedAspectRatio === '4:3' || resolvedAspectRatio === '21:9'
            ? landscapeCandidates
            : squareCandidates
      resolvedResolution =
        candidates.find((c) => allowedResolutions.some((r) => r.toLowerCase() === c.toLowerCase()))
        || allowedResolutions[0]
      if (resolvedResolution) {
        const canonical = allowedResolutions.find((r) => r.toLowerCase() === resolvedResolution!.toLowerCase())
        if (canonical) resolvedResolution = canonical
      }
    } else if (hasKTiers) {
      const kOrder = ['2K', '2k', '1K', '1k', '3K', '3k', '4K', '4k']
      resolvedResolution =
        kOrder.find((k) => allowedResolutions.includes(k))
        || allowedResolutions[0]
    } else {
      resolvedResolution = allowedResolutions[0]
    }
  } else if (preferred && preferred !== 'auto') {
    resolvedResolution = preferred
  }

  const allowedQualities = Array.isArray(fields.quality)
    ? fields.quality.filter((v): v is string => typeof v === 'string')
    : []
  let resolvedQuality: ImageQualityLevel | undefined
  if (params.preferredQuality && (allowedQualities.length === 0 || allowedQualities.includes(params.preferredQuality))) {
    resolvedQuality = params.preferredQuality
  }

  return {
    aspectRatio: resolvedAspectRatio,
    ...(resolvedResolution ? { resolution: resolvedResolution } : {}),
    ...(resolvedQuality ? { quality: resolvedQuality } : {}),
  }
}

export function resolveShotVideoInputMode(params: {
  requested: VideoInputMode
  supportsFirstLastFrame: boolean
  imageCount: number
  videoCount: number
  audioCount: number
}): VideoInputMode {
  // First/last frame strictly requires model support, exactly 2 images, and 0 videos/audios
  if (params.requested === 'firstlastframe') {
    if (params.supportsFirstLastFrame && params.imageCount === 2 && params.videoCount === 0 && params.audioCount === 0) {
      return 'firstlastframe'
    }
    return params.imageCount === 1 && params.videoCount === 0 && params.audioCount === 0 ? 'image' : 'text'
  }
  // Single-image I2V forbids videos/audios and multiple images (multi-asset @mention needs 'text' omni-reference)
  if (params.requested === 'image') {
    if (params.imageCount === 1 && params.videoCount === 0 && params.audioCount === 0) {
      return 'image'
    }
    return 'text'
  }
  return 'text'
}

// ============================================================
// LLM Invocation Helper (viewer-validated)
// ============================================================

function modelUnavailableError(modelKey: string, error: unknown): ApiError {
  const detail = error instanceof Error ? error.message : String(error)
  return new ApiError('MODEL_UNAVAILABLE', {
    message: `调用文本大模型失败（${modelKey}）：${detail}。系统不会自动切换模型。`,
  })
}

async function callWorkflowLlmJson(params: {
  workspaceOwnerId: string
  actorId: string
  projectId: string
  action: string
  modelKey?: string | null
  explicitModel?: boolean
  temperature?: number
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
}): Promise<{ json: Record<string, unknown>; modelKey: string }> {
  const requestedModelKey = cleanText(params.modelKey) || NORI_DEFAULT_MODEL_KEYS.llm
  const resolved = await resolveValidatedModelForStage({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    requestedModelKey,
    explicitRequested: params.explicitModel ?? Boolean(cleanText(params.modelKey)),
    type: 'llm',
  })

  const temperature = typeof params.temperature === 'number' && Number.isFinite(params.temperature)
    ? Math.max(0, Math.min(1.2, params.temperature))
    : 0.55

  let content = ''
  try {
    const completion = await runModelGatewayTextCompletion({
      userId: params.workspaceOwnerId,
      model: resolved.actualModelKey,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      options: {
        temperature,
        reasoning: false,
        maxRetries: 1,
        maxTokens: params.maxTokens ?? 6000,
        projectId: params.projectId,
        action: params.action,
      },
    })
    content = getCompletionContent(completion).trim()
  } catch (error) {
    throw modelUnavailableError(resolved.modelKey, error)
  }

  if (!content) {
    throw new ApiError('EXTERNAL_ERROR', {
      message: `文本大模型（${resolved.modelKey}）返回为空，请重试或切换模型/Skill。`,
    })
  }

  try {
    return {
      json: safeParseJsonObject(content),
      modelKey: resolved.modelKey,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ApiError('EXTERNAL_ERROR', {
      message: `模型输出未能解析为有效 JSON（${detail}），请微调 Skill 提示词或重试。`,
    })
  }
}

// ============================================================
// Stage Output Normalizers (Strict 5-Stage Artifact Shapes)
// ============================================================

function formatOriginalScriptTextFromBeats(title: string, beats: readonly OriginalScriptBeat[]): string {
  const lines: string[] = [`# ${title}`]
  for (const beat of beats) {
    const tc = beat.timecode ? ` · ${beat.timecode}` : ''
    lines.push(`\n【拍${beat.beatIndex}${tc} · ${beat.sceneHeading}】`)
    if (beat.visualAction) lines.push(`画面：${beat.visualAction}`)
    if (beat.dialogue) lines.push(`对白：${beat.dialogue}`)
    if (beat.voiceover) lines.push(`旁白：${beat.voiceover}`)
    if (beat.sfxOrMusic) lines.push(`声音：${beat.sfxOrMusic}`)
  }
  return lines.join('\n').trim()
}

function normalizeStage1OriginalScript(params: {
  raw: Record<string, unknown> | null
  rawText: string
  item: BatchItemDTO
  durationSeconds?: number | null
  cutHints?: number[]
  arkFileId?: string | null
  arkModel?: string | null
}): OriginalScriptArtifact {
  const raw = params.raw || {}
  const title = cleanText(raw.title, params.item.title || '源视频解析剧本')

  const beatsRaw = Array.isArray(raw.beats)
    ? raw.beats
    : Array.isArray(raw.scenes)
      ? raw.scenes
      : []

  const beats: OriginalScriptBeat[] = beatsRaw.map((entry, idx) => {
    const obj = asRecord(entry)
    const startRaw = Number(obj.startSec ?? obj.start_time)
    const endRaw = Number(obj.endSec ?? obj.end_time)
    const startSec = Number.isFinite(startRaw) && startRaw >= 0 ? startRaw : null
    const endSec = Number.isFinite(endRaw) && endRaw >= 0 ? endRaw : null
    const timecode = cleanText(obj.timecode) || (
      startSec !== null && endSec !== null
        ? `${String(Math.floor(startSec / 60)).padStart(2, '0')}:${String(Math.floor(startSec % 60)).padStart(2, '0')} - ${String(Math.floor(endSec / 60)).padStart(2, '0')}:${String(Math.floor(endSec % 60)).padStart(2, '0')}`
        : undefined
    )
    return {
      beatIndex: toNumber(obj.beatIndex ?? obj.sceneIndex, idx + 1, 1, 100),
      ...(startSec !== null ? { startSec } : {}),
      ...(endSec !== null ? { endSec } : {}),
      ...(timecode ? { timecode } : {}),
      sceneHeading: cleanText(obj.sceneHeading ?? obj.location, `场景 ${idx + 1}`),
      visualAction: cleanText(obj.visualAction ?? obj.action ?? obj.visual, ''),
      dialogue: cleanText(obj.dialogue, ''),
      ...(cleanText(obj.voiceover) ? { voiceover: cleanText(obj.voiceover) } : {}),
      ...(cleanText(obj.sfxOrMusic ?? obj.sfx) ? { sfxOrMusic: cleanText(obj.sfxOrMusic ?? obj.sfx) } : {}),
      ...(cleanText(obj.hookNote ?? obj.note) ? { hookNote: cleanText(obj.hookNote ?? obj.note) } : {}),
    }
  })

  const characters = (Array.isArray(raw.characters) ? raw.characters : []).map((entry, idx) => {
    const obj = asRecord(entry)
    return {
      name: cleanText(obj.name, `角色${idx + 1}`),
      role: cleanText(obj.role, idx === 0 ? '主角' : '角色'),
      traits: cleanText(obj.traits ?? obj.persona, ''),
      ...(cleanText(obj.visualNote ?? obj.appearance) ? { visualNote: cleanText(obj.visualNote ?? obj.appearance) } : {}),
    }
  })

  const locations = (Array.isArray(raw.locations) ? raw.locations : []).map((entry, idx) => {
    const obj = asRecord(entry)
    return {
      name: cleanText(obj.name, `场景${idx + 1}`),
      description: cleanText(obj.description, ''),
    }
  })

  const props = (Array.isArray(raw.props) ? raw.props : []).map((entry, idx) => {
    const obj = asRecord(entry)
    return {
      name: cleanText(obj.name, `道具${idx + 1}`),
      description: cleanText(obj.description, ''),
    }
  })

  const fullScriptText = cleanText(raw.fullScriptText)
    || (beats.length > 0 ? formatOriginalScriptTextFromBeats(title, beats) : params.rawText.trim())

  const estimatedDurationSec = toNumber(
    raw.estimatedDurationSec ?? params.durationSeconds ?? params.item.inputPayload.sourceVideoDurationSec,
    30,
    5,
    600,
  )

  return {
    sourceMode: 'video_analysis',
    title,
    summary: cleanText(raw.summary, fullScriptText.slice(0, 120)),
    ...(cleanText(raw.genre) ? { genre: cleanText(raw.genre) } : {}),
    estimatedDurationSec,
    ...(cleanText(raw.hookAnalysis) ? { hookAnalysis: cleanText(raw.hookAnalysis) } : {}),
    characters,
    locations,
    props,
    beats: beats.length > 0
      ? beats
      : [{
          beatIndex: 1,
          sceneHeading: '整片内容',
          visualAction: fullScriptText.slice(0, 500),
          dialogue: '',
        }],
    fullScriptText,
    ...(params.cutHints && params.cutHints.length > 0 ? { cutHints: params.cutHints } : {}),
    arkFileId: params.arkFileId ?? null,
    arkModel: params.arkModel ?? null,
    rawAnalysisText: params.rawText.slice(0, 20000),
  }
}

function formatRewrittenScriptTextFromScenes(title: string, scenes: readonly RewrittenScriptScene[]): string {
  const lines: string[] = [`# ${title}`]
  for (const sc of scenes) {
    lines.push(`\n【场${sc.sceneIndex} · ${sc.beat} · ${sc.location} · ${sc.durationSec}s】`)
    if (sc.visualAction) lines.push(`画面：${sc.visualAction}`)
    if (sc.dialogue) lines.push(`台词：${sc.dialogue}`)
    if (sc.voiceover) lines.push(`旁白：${sc.voiceover}`)
    if (sc.onscreenText) lines.push(`花字：${sc.onscreenText}`)
    if (sc.highlightNote) lines.push(`亮点：${sc.highlightNote}`)
  }
  return lines.join('\n').trim()
}

function normalizeStage2RewrittenScript(
  raw: Record<string, unknown>,
  item: BatchItemDTO,
  skill: WorkflowSkillDTO,
  stageParams?: ScriptRewriteStageParams,
): RewrittenScriptArtifact {
  const arcObj = asRecord(raw.conflictArc)
  const charsRaw = Array.isArray(raw.characters) ? raw.characters : []
  const scenesRaw = Array.isArray(raw.scenes) ? raw.scenes : []

  const characters = charsRaw.map((entry, idx) => {
    const obj = asRecord(entry)
    return {
      name: cleanText(obj.name, idx === 0 ? '主角' : `角色${idx + 1}`),
      role: cleanText(obj.role, idx === 0 ? '主角' : '配角'),
      persona: cleanText(obj.persona, '性格鲜明、立体真实'),
      voiceTone: cleanText(obj.voiceTone, '自然口语、节奏明快'),
    }
  })

  const scenes: RewrittenScriptScene[] = scenesRaw.map((entry, idx) => {
    const obj = asRecord(entry)
    return {
      sceneIndex: toNumber(obj.sceneIndex, idx + 1, 1, WORKFLOW_MAX_SHOTS),
      ...(cleanText(obj.sourceBeatId) ? { sourceBeatId: cleanText(obj.sourceBeatId) } : {}),
      location: cleanText(obj.location, '核心场景'),
      beat: cleanText(obj.beat, `第${idx + 1}拍`),
      visualAction: cleanText(obj.visualAction, '人物表演动作与核心互动'),
      dialogue: cleanText(obj.dialogue, ''),
      ...(cleanText(obj.voiceover) ? { voiceover: cleanText(obj.voiceover) } : {}),
      ...(cleanText(obj.onscreenText) ? { onscreenText: cleanText(obj.onscreenText) } : {}),
      ...(cleanText(obj.highlightNote ?? obj.productHighlight) ? { highlightNote: cleanText(obj.highlightNote ?? obj.productHighlight) } : {}),
      durationSec: toNumber(obj.durationSec, 5, 3, 20),
    }
  })

  const title = cleanText(raw.title, item.stageOutputs.script_analysis?.title || item.title)
  const totalSec = scenes.reduce((sum, s) => sum + s.durationSec, 0)
  const effectiveScenes: RewrittenScriptScene[] = scenes

  const fullScriptText = cleanText(raw.fullScriptText)
    || formatRewrittenScriptTextFromScenes(title, effectiveScenes)

  const changeHighlights = cleanStringArray(raw.changeHighlights)

  return {
    title,
    styleTag: cleanText(raw.styleTag, skill.name),
    rewriteSummary: cleanText(raw.rewriteSummary, `基于「${skill.name}」完成剧本结构化洗稿与冲突升级`),
    changeHighlights: changeHighlights.length > 0
      ? changeHighlights.slice(0, 8)
      : ['前3秒钩子强化', '台词口语化提炼', '视觉动作重构'],
    hookLine3s: cleanText(raw.hookLine3s, effectiveScenes[0]?.dialogue || ''),
    estimatedDurationSec: toNumber(
      raw.estimatedDurationSec,
      totalSec || stageParams?.targetDurationSec || item.inputPayload.durationTargetSec || 30,
      8,
      300,
    ),
    conflictArc: {
      hook: cleanText(arcObj.hook, '前3秒制造核心冲突或悬念'),
      escalation: cleanText(arcObj.escalation, '情绪与矛盾递进升级'),
      twistOrReveal: cleanText(arcObj.twistOrReveal, '关键转折或反转破局'),
      climaxOrDemo: cleanText(arcObj.climaxOrDemo ?? arcObj.productDemo, '高光表演或视觉验证'),
      ctaOrEnding: cleanText(arcObj.ctaOrEnding ?? arcObj.cta, '强记忆点收口或转化引导'),
    },
    characters: characters.length > 0
      ? characters
      : [{ name: '主角', role: '主角', persona: '利落自信的核心人物', voiceTone: '清晰自然' }],
    scenes: effectiveScenes,
    fullScriptText,
  }
}

interface WorkspaceMaterialMatchCandidate {
  id: string
  projectId: string
  title: string | null
  type: string
  resultUrl: string | null
  storageKey: string | null
  metadata: unknown
}

function normalizeMatchName(value: string): string {
  return value.replace(/[\s·\-_()（）【】[\]「」"'@]+/g, '').toLowerCase()
}

function findBestWorkspaceMaterialMatch(params: {
  assetKind: WorkflowAssetKind
  name: string
  aliases: readonly string[]
  projectId: string
  materials: readonly WorkspaceMaterialMatchCandidate[]
}): WorkspaceMaterialMatchCandidate | null {
  const targetKeys = new Set(
    [params.name, ...params.aliases].map(normalizeMatchName).filter((k) => k.length >= 2),
  )
  if (targetKeys.size === 0) return null

  let best: WorkspaceMaterialMatchCandidate | null = null
  let bestScore = 0

  for (const mat of params.materials) {
    if (mat.type !== 'image') continue
    if (!mat.storageKey && !mat.resultUrl) continue

    const matTitle = cleanText(mat.title)
    const matAliases = frameosAssetAliasesFromMetadata(mat.metadata)
    const matKeys = [matTitle, ...matAliases].map(normalizeMatchName).filter(Boolean)

    let nameScore = 0
    for (const mk of matKeys) {
      if (targetKeys.has(mk)) {
        nameScore = Math.max(nameScore, 100)
      } else {
        for (const tk of targetKeys) {
          if (tk.length >= 2 && mk.length >= 2 && (mk.includes(tk) || tk.includes(mk))) {
            nameScore = Math.max(nameScore, 55)
          }
        }
      }
    }
    if (nameScore === 0) continue

    const category = frameosAssetCategoryFromMetadata(mat.metadata)
    const categoryBonus = category === params.assetKind ? 25 : category === 'other' ? 5 : -15
    const projectBonus = mat.projectId === params.projectId ? 20 : 0
    const totalScore = nameScore + categoryBonus + projectBonus

    if (totalScore > bestScore && totalScore >= 60) {
      bestScore = totalScore
      best = mat
    }
  }

  return best
}

function recomputeAssetsArtifactCounts(artifact: AssetsArtifact): AssetsArtifact {
  const items = artifact.items || []
  const readyCount = items.filter((it) => it.status === 'ready' || it.status === 'reused').length
  const failedCount = items.filter((it) => it.status === 'failed').length
  const pendingCount = items.filter((it) => it.status === 'pending' || it.status === 'queued' || it.status === 'processing').length
  return {
    ...artifact,
    readyCount,
    totalCount: items.length,
    pendingCount,
    failedCount,
  }
}

function normalizeStage3Assets(params: {
  raw: Record<string, unknown>
  projectId: string
  videoAspectRatio: VideoAspectRatio
  preferWorkspaceReuse: boolean
  maxAssetsPerKind: number
  workspaceImageMaterials: readonly WorkspaceMaterialMatchCandidate[]
  workspaceAudioById: ReadonlyMap<string, WorkspaceMaterialMatchCandidate>
}): AssetsArtifact {
  const rawItems = Array.isArray(params.raw.items) ? params.raw.items : []
  const kindCounts: Record<WorkflowAssetKind, number> = { character: 0, location: 0, prop: 0 }
  const seenNames = new Set<string>()
  const nowIso = new Date().toISOString()

  const items: WorkflowAssetItem[] = []

  for (const entry of rawItems) {
    const obj = asRecord(entry)
    const rawKind = cleanText(obj.kind).toLowerCase()
    const kind: WorkflowAssetKind =
      rawKind === 'location' || rawKind === 'scene'
        ? 'location'
        : rawKind === 'prop' || rawKind === 'product' || rawKind === 'item'
          ? 'prop'
          : 'character'

    if (kindCounts[kind] >= params.maxAssetsPerKind) continue
    kindCounts[kind] += 1

    const rawName = cleanText(obj.name) || `${kind === 'character' ? '角色' : kind === 'location' ? '场景' : '道具'}${kindCounts[kind]}`
    const safeName = rawName.replace(/[@\s]+/g, '').slice(0, 24) || `${kind}_${kindCounts[kind]}`
    const nameKey = safeName.toLowerCase()
    if (seenNames.has(nameKey)) continue
    seenNames.add(nameKey)

    const id = cleanText(obj.id).replace(/[^a-zA-Z0-9_-]/g, '') || `${kind === 'character' ? 'char' : kind === 'location' ? 'loc' : 'prop'}_${kindCounts[kind]}`
    const aliases = cleanStringArray(obj.aliases).filter((a) => a.toLowerCase() !== nameKey).slice(0, 6)
    const description = cleanText(obj.description, `${safeName} 视觉定妆设定`)
    // OpenLux 1000-char hard limit -> strictly clamp <= 900 chars!
    const imagePrompt = clampImagePrompt(cleanText(obj.imagePrompt, description), ASSET_IMAGE_PROMPT_MAX_CHARS)

    const locationAspectRatio: VideoAspectRatio =
      params.videoAspectRatio === 'adaptive' ? '16:9' : params.videoAspectRatio
    const aspectRatio: VideoAspectRatio =
      kind === 'character'
        ? '3:4'
        : kind === 'prop'
          ? '1:1'
          : locationAspectRatio

    const matched = params.preferWorkspaceReuse
      ? findBestWorkspaceMaterialMatch({
          assetKind: kind,
          name: safeName,
          aliases,
          projectId: params.projectId,
          materials: params.workspaceImageMaterials,
        })
      : null

    let voiceMaterialId: string | null = null
    let voiceMaterialTitle: string | null = null
    let voiceMaterialUrl: string | null = null
    if (kind === 'character' && matched) {
      const boundVoiceId = characterVoiceMaterialId(matched.metadata)
      const voiceMat = boundVoiceId ? params.workspaceAudioById.get(boundVoiceId) : null
      if (voiceMat) {
        voiceMaterialId = voiceMat.id
        voiceMaterialTitle = voiceMat.title || '角色绑定音色'
        voiceMaterialUrl = voiceMat.resultUrl || voiceMat.storageKey || null
      }
    }

    const reusedVersions: WorkflowAssetImageVersion[] = matched
      ? [{
          versionIndex: 1,
          materialId: matched.id,
          toolboxAssetId: null,
          taskId: null,
          imageUrl: matched.resultUrl || matched.storageKey || null,
          storageKey: matched.storageKey || null,
          prompt: imagePrompt,
          modelKey: null,
          aspectRatio,
          resolution: null,
          source: 'workspace_reused',
          status: 'reused',
          errorMessage: null,
          createdAt: nowIso,
        }]
      : []

    items.push({
      id,
      kind,
      name: safeName,
      aliases,
      roleOrUsage: cleanText(obj.roleOrUsage ?? obj.role, kind === 'character' ? '主要角色' : kind === 'location' ? '核心场景' : '关键道具'),
      description,
      ...(kind === 'character' && cleanText(obj.voiceProfile) ? { voiceProfile: cleanText(obj.voiceProfile) } : {}),
      voiceMaterialId,
      voiceMaterialTitle,
      voiceMaterialUrl,
      imagePrompt,
      aspectRatio,
      status: matched ? 'reused' : 'pending',
      materialId: matched?.id || null,
      imageUrl: matched?.resultUrl || matched?.storageKey || null,
      storageKey: matched?.storageKey || null,
      toolboxAssetId: null,
      taskId: null,
      errorMessage: null,
      versions: reusedVersions,
      selectedVersionIndex: matched ? 0 : -1,
    })
  }

  return recomputeAssetsArtifactCounts({
    styleBible: cleanText(params.raw.styleBible, '高质感统一视觉摄影风格，自然光影，跨镜头外观一致'),
    colorPalette: cleanText(params.raw.colorPalette, '干净克制商业影调 + 核心主体高光点缀'),
    lightingDirection: cleanText(params.raw.lightingDirection, '柔和主光 + 清晰人物眼神光与轮廓分离光'),
    items,
    readyCount: 0,
    totalCount: items.length,
    pendingCount: items.length,
    failedCount: 0,
  })
}

function normalizeStage4Storyboard(params: {
  raw: Record<string, unknown>
  item: BatchItemDTO
  modelConfig: WorkflowModelConfig
  videoModelKey: string
  videoCaps: VideoCapabilitiesSummary
}): StoryboardArtifact {
  const s3Items = params.item.stageOutputs.asset_extraction?.items || []
  const assetById = new Map(s3Items.map((a) => [a.id, a]))

  const aspectRatio = normalizeVideoAspectRatio(
    params.raw.aspectRatio,
    params.modelConfig.videoAspectRatio || params.item.inputPayload.aspectRatio || '9:16',
  )

  const shotsRaw = Array.isArray(params.raw.shots) ? params.raw.shots : []
  const shots: StoryboardShotItem[] = shotsRaw.map((entry, idx) => {
    const obj = asRecord(entry)
    const shotIndex = toNumber(obj.shotIndex, idx + 1, 1, WORKFLOW_MAX_SHOTS)
    const shotId = cleanText(obj.shotId).replace(/[^a-zA-Z0-9_-]/g, '') || `shot_${shotIndex}`

    const desiredDuration = Number(obj.durationSec ?? params.modelConfig.videoDurationSeconds ?? 5)
    const durationSec = pickClosestAllowedDuration(desiredDuration, params.videoCaps.durationRange.allowed)

    const rawPrompt = cleanText(
      obj.videoPrompt,
      cleanText(obj.visualDescription, `镜${shotIndex}：流畅运镜与主体表演`),
    )
    const videoPrompt = rawPrompt.includes('no subtitles')
      ? rawPrompt
      : `${rawPrompt}，no music, no subtitles`

    // Reconcile referencedAssetIds from BOTH explicit array AND any @AssetName / @Alias mentioned in videoPrompt
    const explicitIds = cleanStringArray(obj.referencedAssetIds).filter((id) => assetById.has(id))
    const mentioned = reconcileShotAssetMentions(videoPrompt, s3Items)
    const referencedAssetIds = Array.from(new Set([...mentioned.referencedAssetIds, ...explicitIds]))
    const referencedAssetNames = referencedAssetIds
      .map((id) => assetById.get(id)?.name)
      .filter((name): name is string => Boolean(name))

    // Enforce target model firstlastframe capability (auto-forbid on Huimengi Seedance!)
    const requestedMode = normalizeVideoInputMode(obj.inputMode, params.modelConfig.videoInputMode || 'text')
    const inputMode: VideoInputMode =
      requestedMode === 'firstlastframe' && !params.videoCaps.supportsFirstLastFrame
        ? 'text'
        : requestedMode

    return {
      shotId,
      shotIndex,
      sceneIndex: toNumber(obj.sceneIndex, idx + 1, 1, WORKFLOW_MAX_SHOTS),
      title: cleanText(obj.title, `镜${shotIndex}`),
      durationSec,
      shotType: cleanText(obj.shotType, '中近景'),
      cameraMovement: cleanText(obj.cameraMovement, '平稳推进'),
      visualDescription: cleanText(obj.visualDescription, rawPrompt),
      ...(cleanText(obj.firstFramePrompt) ? { firstFramePrompt: cleanText(obj.firstFramePrompt) } : {}),
      videoPrompt,
      ...(cleanText(obj.dialogue) ? { dialogue: cleanText(obj.dialogue) } : {}),
      ...(cleanText(obj.onscreenText) ? { onscreenText: cleanText(obj.onscreenText) } : {}),
      referencedAssetIds,
      referencedAssetNames,
      inputMode,
      negativeConstraints: cleanText(
        obj.negativeConstraints,
        'no music, no subtitles, 无多余文字水印, 保持角色与场景资产一致',
      ),
    }
  })

  const totalDurationSec = shots.reduce((sum, s) => sum + s.durationSec, 0)
  return {
    aspectRatio,
    totalDurationSec: totalDurationSec || params.item.inputPayload.durationTargetSec || 30,
    pacingStyle: cleanText(params.raw.pacingStyle, '快节奏流畅剪辑'),
    videoModelKey: params.videoModelKey,
    supportsFirstLastFrame: params.videoCaps.supportsFirstLastFrame,
    allowedDurationRange: {
      min: params.videoCaps.durationRange.min,
      max: params.videoCaps.durationRange.max,
    },
    shots,
  }
}

function recomputeVideoGenArtifactCounts(artifact: VideoGenArtifact): VideoGenArtifact {
  const shots = artifact.shots || []
  let readyCount = 0
  let pendingCount = 0
  let failedCount = 0

  for (const shot of shots) {
    const selectedTake = shot.takes[shot.selectedTakeIndex] || shot.takes[shot.takes.length - 1]
    const anyActive = shot.takes.some((t) => t.status === 'queued' || t.status === 'processing')
    const anyReady = shot.takes.some((t) => t.status === 'ready')
    if (anyActive) {
      pendingCount += 1
    } else if (selectedTake?.status === 'ready' || anyReady) {
      readyCount += 1
    } else if (selectedTake?.status === 'failed') {
      failedCount += 1
    } else {
      pendingCount += 1
    }
  }

  return {
    ...artifact,
    readyCount,
    totalCount: shots.length,
    pendingCount,
    failedCount,
  }
}

// ============================================================
// Pure State Transition & Stale Propagation Helpers (exported for tests!)
// ============================================================

/**
 * Locks upstream S1..S(K-1) untouched and marks any completed/approved/waiting_review
 * downstream S(K+1)..S5 as `stale: true` (preserving all downstream `stageOutputs`!).
 */
export function markDownstreamStagesStale(
  stageStates: Record<WorkflowStage, BatchStageState>,
  changedStage: WorkflowStage,
  reason: string,
): Record<WorkflowStage, BatchStageState> {
  const changedIdx = getStageIndex(changedStage)
  const next = { ...stageStates }

  for (let idx = changedIdx + 1; idx < WORKFLOW_STAGES.length; idx += 1) {
    const downstream = WORKFLOW_STAGES[idx]
    const current = next[downstream]
    if (!current) continue
    if (current.status === 'completed' || current.status === 'approved' || current.status === 'waiting_review') {
      next[downstream] = {
        ...current,
        stale: true,
        staleReason: reason,
      }
    }
  }

  return next
}

function hasStageOutputChanged(
  prevOutput: unknown,
  nextOutput: Record<string, unknown> | null | undefined,
): boolean {
  if (!nextOutput) return false
  try {
    return JSON.stringify(prevOutput ?? null) !== JSON.stringify(nextOutput)
  } catch {
    return true
  }
}

export function applyStageOutcomeToItemState(params: {
  item: Pick<BatchItemDTO, 'currentStage' | 'status' | 'stageStates' | 'stageOutputs' | 'errorMessage'>
  stage: WorkflowStage
  runMode: BatchRunMode
  templateStages: readonly WorkflowTemplateStageConfig[]
  skill: Pick<WorkflowSkillDTO, 'id' | 'slug' | 'name' | 'version'>
  stageOutput: unknown
  startedAtIso: string
  finishedAtIso: string
  durationMs: number
  asyncPending?: boolean
  taskIds?: string[]
  executionMeta?: WorkflowStageExecutionMeta
  skipReview?: boolean
  nextStageOverride?: WorkflowStage | null
}): {
  currentStage: WorkflowStage
  status: BatchItemStatus
  stageStates: Record<WorkflowStage, BatchStageState>
  stageOutputs: BatchItemStageOutputs
  errorMessage: string | null
  outcome: 'completed' | 'waiting_review' | 'running'
} {
  const stageConfig = params.templateStages.find((s) => s.stage === params.stage)
  const isPastedScriptSkipIn =
    params.stage === 'script_analysis'
    && asRecord(params.stageOutput).sourceMode === 'pasted_script'
  const requiresReview = !params.asyncPending
    && !params.skipReview
    && !isPastedScriptSkipIn
    && params.runMode === 'gated'
    && stageConfig?.gateMode === 'manual_review'

  // Locked-upstream guarantee: clone existing outputs and ONLY write `params.stage`.
  const nextOutputs: BatchItemStageOutputs = {
    ...params.item.stageOutputs,
    [params.stage]: params.stageOutput,
  }

  const nextStageStatus: BatchStageState['status'] = params.asyncPending
    ? 'running'
    : requiresReview
      ? 'waiting_review'
      : 'completed'

  const stageLabel = WORKFLOW_STAGE_META[params.stage].label
  const statesWithStale = markDownstreamStagesStale(
    params.item.stageStates,
    params.stage,
    `上游「${stageLabel}」已重新生成，建议重新运行本阶段以同步最新变更`,
  )

  const nextStageStates: Record<WorkflowStage, BatchStageState> = {
    ...statesWithStale,
    [params.stage]: {
      ...statesWithStale[params.stage],
      status: nextStageStatus,
      skillSlug: params.skill.slug,
      skillId: params.skill.id,
      skillName: params.skill.name,
      skillVersion: params.skill.version,
      ...(params.executionMeta?.qcReport ? { qcStatus: params.executionMeta.qcReport.status } : {}),
      ...(params.executionMeta?.qcReport ? { attempt: params.executionMeta.qcReport.retryCount + 1 } : {}),
      ...(params.executionMeta?.modelKey ? { modelKey: params.executionMeta.modelKey } : {}),
      startedAt: params.startedAtIso,
      finishedAt: params.asyncPending ? null : params.finishedAtIso,
      durationMs: params.durationMs,
      error: params.stage === 'video_gen' && (params.stageOutput as VideoGenArtifact).failedCount > 0
        ? `部分镜头失败（${(params.stageOutput as VideoGenArtifact).readyCount}/${(params.stageOutput as VideoGenArtifact).totalCount} 成功）`
        : null,
      reviewNote: null,
      stale: false,
      staleReason: null,
      trialPending: false,
      ...(params.taskIds ? { taskIds: params.taskIds } : {}),
    },
  }

  if (params.asyncPending) {
    const partialMediaError = nextStageStates[params.stage].error
    return {
      currentStage: params.stage,
      status: 'running',
      stageStates: nextStageStates,
      stageOutputs: nextOutputs,
      errorMessage: partialMediaError ?? null,
      outcome: 'running',
    }
  }

  if (requiresReview) {
    return {
      currentStage: params.stage,
      status: 'waiting_review',
      stageStates: nextStageStates,
      stageOutputs: nextOutputs,
      errorMessage: null,
      outcome: 'waiting_review',
    }
  }

  const defaultNextStage = getNextWorkflowStage(params.stage, params.templateStages)
  const nextStage =
    params.nextStageOverride
    && isWorkflowStage(params.nextStageOverride)
    && getStageIndex(params.nextStageOverride) > getStageIndex(params.stage)
      ? params.nextStageOverride
      : defaultNextStage
  return {
    currentStage: nextStage || params.stage,
    status: nextStage ? 'queued' : 'completed',
    stageStates: nextStageStates,
    stageOutputs: nextOutputs,
    errorMessage: null,
    outcome: 'completed',
  }
}

export function applyReviewActionToItemState(params: {
  item: Pick<BatchItemDTO, 'currentStage' | 'status' | 'stageStates' | 'stageOutputs' | 'errorMessage'>
  stage: WorkflowStage
  templateStages: readonly WorkflowTemplateStageConfig[]
  action: 'approve' | 'reject' | 'save_draft'
  editedOutput?: Record<string, unknown> | null
  reviewNote?: string | null
  clearStale?: boolean
}): {
  currentStage: WorkflowStage
  status: BatchItemStatus
  stageStates: Record<WorkflowStage, BatchStageState>
  stageOutputs: BatchItemStageOutputs
  errorMessage: string | null
} {
  const outputChanged = hasStageOutputChanged(params.item.stageOutputs[params.stage], params.editedOutput)

  // Never touch upstream stageOutputs; only update `params.stage` when editedOutput is provided.
  const nextOutputs: BatchItemStageOutputs = params.editedOutput
    ? {
        ...params.item.stageOutputs,
        [params.stage]: params.editedOutput,
      }
    : { ...params.item.stageOutputs }

  const stageLabel = WORKFLOW_STAGE_META[params.stage].label
  // On save_draft (including persistent stale-banner dismissal), only mark downstream stages stale if editedOutput actually changed.
  const shouldMarkDownstreamStale = params.action === 'save_draft'
    ? outputChanged
    : Boolean(params.editedOutput)
  const baseStageStates = shouldMarkDownstreamStale
    ? markDownstreamStagesStale(
        params.item.stageStates,
        params.stage,
        `上游「${stageLabel}」内容已手动编辑，下游结果可能已过期`,
      )
    : { ...params.item.stageStates }

  const existingStageState = baseStageStates[params.stage]

  if (params.action === 'approve') {
    const nextStage = getNextWorkflowStage(params.stage, params.templateStages)
    return {
      currentStage: nextStage || params.stage,
      status: nextStage ? 'queued' : 'completed',
      stageStates: {
        ...baseStageStates,
        [params.stage]: {
          ...existingStageState,
          status: 'approved',
          reviewNote: cleanText(params.reviewNote) || null,
          error: null,
          stale: false,
          staleReason: null,
        },
      },
      stageOutputs: nextOutputs,
      errorMessage: null,
    }
  }

  if (params.action === 'save_draft') {
    const shouldClearStale = params.clearStale !== false
    return {
      currentStage: params.item.currentStage,
      status: params.item.status,
      stageStates: {
        ...baseStageStates,
        [params.stage]: {
          ...existingStageState,
          ...(params.reviewNote !== undefined ? { reviewNote: cleanText(params.reviewNote) || null } : {}),
          ...(shouldClearStale ? { stale: false, staleReason: null } : {}),
        },
      },
      stageOutputs: nextOutputs,
      errorMessage: params.item.errorMessage,
    }
  }

  // Reject keeps item at this stage in waiting_review for inline edit or Skill-swapped rerun
  return {
    currentStage: params.stage,
    status: 'waiting_review',
    stageStates: {
      ...baseStageStates,
      [params.stage]: {
        ...existingStageState,
        status: 'waiting_review',
        reviewNote: cleanText(params.reviewNote) || '需修改后重新审核',
      },
    },
    stageOutputs: nextOutputs,
    errorMessage: null,
  }
}

// ============================================================
// Stage Core Runners (shared by runBatchItemStage & runStageSkillTrial)
// ============================================================

export interface WorkflowStageExecutionMeta {
  qcReport?: ReturnType<typeof evaluateWorkflowQuality>
  modelKey?: string
}

async function generateStageLlmArtifactWithQc<T>(params: {
  stage: WorkflowStage
  skill: WorkflowSkillDTO
  systemPrompt: string
  userPrompt: string
  invoke: (userPrompt: string, maxTokens?: number) => Promise<{ json: Record<string, unknown>; modelKey: string }>
  normalize: (json: Record<string, unknown>) => T
  validateRaw?: (json: Record<string, unknown>) => void
  validateNormalized?: (artifact: T) => void
  maxTokens?: number
  executionMeta?: WorkflowStageExecutionMeta
}): Promise<T> {
  let currentPrompt = params.userPrompt
  for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
    const { json, modelKey } = await params.invoke(currentPrompt, params.maxTokens)
    if (params.executionMeta) params.executionMeta.modelKey = modelKey
    let artifact: T
    try {
      params.validateRaw?.(json)
      artifact = params.normalize(json)
      params.validateNormalized?.(artifact)
    } catch (error) {
      const report = evaluateWorkflowQuality({ stage: params.stage, artifact: json, qcRules: null, retryCount })
      report.status = 'failed'
      report.violations = [{
        rule: 'structure',
        message: error instanceof Error ? error.message : String(error),
        path: params.stage === 'storyboard' ? 'shots' : params.stage === 'asset_extraction' ? 'items' : 'scenes',
      }]
      if (params.executionMeta) params.executionMeta.qcReport = report
      if (retryCount === 0) {
        currentPrompt = `${params.userPrompt}\n\n${buildQcCorrectionPrompt(report)}`
        continue
      }
      throw new ApiError('QC_FAILED', { message: report.violations[0].message, qc: report as unknown as Record<string, unknown> })
    }

    const report = evaluateWorkflowQuality({
      stage: params.stage,
      artifact: artifact as OriginalScriptArtifact | RewrittenScriptArtifact | StoryboardArtifact | Record<string, unknown>,
      qcRules: params.skill.qcRules,
      retryCount,
    })
    if (params.executionMeta) params.executionMeta.qcReport = report
    if (report.status === 'failed') {
      if (retryCount === 0) {
        currentPrompt = `${params.userPrompt}\n\n${buildQcCorrectionPrompt(report)}`
        continue
      }
      throw new ApiError('QC_FAILED', {
        message: `质量检查仍未通过：${report.violations.map((item) => item.message).join('；')}`,
        qc: report as unknown as Record<string, unknown>,
      })
    }
    return { ...artifact, qc: report }
  }
  throw new ApiError('QC_FAILED', { message: '质量检查失败，已停止重试。' })
}

async function loadWorkspaceMaterials(workspaceOwnerId: string, types: Array<'image' | 'video' | 'audio'>, limit = 250) {
  const workspaceUsers = await prisma.user.findMany({
    where: workspaceUserWhere(workspaceOwnerId),
    select: { id: true },
  })
  const workspaceUserIds = workspaceUsers.map((u) => u.id)
  if (workspaceUserIds.length === 0) return []
  return await prisma.frameosMaterial.findMany({
    where: {
      userId: { in: workspaceUserIds },
      type: { in: types },
      status: 'ready',
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      projectId: true,
      title: true,
      type: true,
      resultUrl: true,
      storageKey: true,
      metadata: true,
    },
  })
}

async function executeStage1ScriptAnalysisCore(params: {
  workspaceOwnerId: string
  item: BatchItemDTO
  skill: WorkflowSkillDTO
  stageParams: ScriptAnalysisStageParams
  executionMeta?: WorkflowStageExecutionMeta
}): Promise<OriginalScriptArtifact> {
  // Option B: Pasted-script skip-in (ZERO Ark API call required!)
  if (params.item.inputPayload.skipVideoAnalysis || (
    params.item.inputPayload.pastedScript
    && !params.item.inputPayload.sourceVideoStorageKey
    && !params.item.inputPayload.sourceVideoMaterialId
  )) {
    const pasted = cleanText(params.item.inputPayload.pastedScript)
    if (!pasted) {
      throw new ApiError('INVALID_PARAMS', { message: '已选择跳过视频解析，请粘贴或导入原剧本文本。' })
    }
    const artifact = buildOriginalScriptFromPastedText({
      title: params.item.title,
      pastedScript: pasted,
      durationTargetSec: params.item.inputPayload.durationTargetSec,
    })
    const report = evaluateWorkflowQuality({
      stage: 'script_analysis',
      artifact,
      qcRules: params.skill.qcRules,
    })
    if (params.executionMeta) params.executionMeta.qcReport = report
    if (report.status === 'failed') {
      throw new ApiError('QC_FAILED', { message: '导入剧本未通过质量检查，请修改后重试。', qc: report as unknown as Record<string, unknown> })
    }
    return { ...artifact, qc: report }
  }

  // Option A: Video analysis via Volcengine Ark video understanding
  let storageKey = cleanText(params.item.inputPayload.sourceVideoStorageKey)
  let fileName = cleanText(params.item.inputPayload.sourceVideoFileName)

  if (!storageKey && params.item.inputPayload.sourceVideoMaterialId) {
    const workspaceUsers = await prisma.user.findMany({
      where: workspaceUserWhere(params.workspaceOwnerId),
      select: { id: true },
    })
    const mat = await prisma.frameosMaterial.findFirst({
      where: {
        id: params.item.inputPayload.sourceVideoMaterialId,
        userId: { in: workspaceUsers.map((u) => u.id) },
        deletedAt: null,
      },
      select: { storageKey: true, title: true },
    })
    if (mat?.storageKey) {
      storageKey = mat.storageKey
      fileName = fileName || cleanText(mat.title)
    }
  }

  if (!storageKey) {
    throw new ApiError('INVALID_PARAMS', {
      message: '请先上传或从素材库选择源视频，或切换为「粘贴剧本跳过解析」模式。',
    })
  }

  const userPromptLines = [
    '请按照系统提示词要求完整拆解当前视频并输出严格 JSON。',
    params.stageParams.customInstruction ? `额外导演关注点：${params.stageParams.customInstruction}` : '',
    params.item.inputPayload.productName ? `关联商品/主题线索：${params.item.inputPayload.productName}` : '',
    params.item.inputPayload.extraNotes ? `补充背景备注：${params.item.inputPayload.extraNotes}` : '',
  ].filter(Boolean)

  try {
    for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
      const result = await understandStorageVideoWithSkill({
        storageKey,
        fileName: fileName || undefined,
        systemPrompt: buildSystemPromptWithExamples(params.skill),
        userPrompt: retryCount === 0
          ? userPromptLines.join('\n')
          : `${userPromptLines.join('\n')}\n\n${buildQcCorrectionPrompt(params.executionMeta?.qcReport || { status: 'failed', violations: [], retryCount, checkedAt: new Date().toISOString() })}`,
        samplingPreset: params.stageParams.samplingPreset || 'standard',
        detectSceneCuts: params.stageParams.detectSceneCuts !== false,
      })

      const artifact = normalizeStage1OriginalScript({
        raw: result.json,
        rawText: result.text,
        item: params.item,
        durationSeconds: result.durationSeconds,
        cutHints: result.cutHints,
        arkFileId: result.fileId,
        arkModel: result.model,
      })
      const report = evaluateWorkflowQuality({ stage: 'script_analysis', artifact, qcRules: params.skill.qcRules, retryCount })
      if (params.executionMeta) params.executionMeta.qcReport = report
      if (report.status === 'failed' && retryCount === 0) continue
      if (report.status === 'failed') {
        throw new ApiError('QC_FAILED', { message: '质量检查失败', qc: report as unknown as Record<string, unknown> })
      }
      return { ...artifact, qc: report }
    }
    throw new ApiError('QC_FAILED', { message: '质量检查失败' })
  } catch (error) {
    if (error instanceof ApiError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new ApiError('EXTERNAL_ERROR', { message: detail })
  }
}

async function executeStage2ScriptRewriteCore(params: {
  workspaceOwnerId: string
  actorId: string
  projectId: string
  modelConfig: WorkflowModelConfig
  item: BatchItemDTO
  skill: WorkflowSkillDTO
  stageParams: ScriptRewriteStageParams
  stageModelOverride?: string | null
  executionMeta?: WorkflowStageExecutionMeta
}): Promise<RewrittenScriptArtifact> {
  const s1 = params.item.stageOutputs.script_analysis
  const fallbackPasted = cleanText(params.item.inputPayload.pastedScript)
  if (!s1 && !fallbackPasted) {
    throw new ApiError('INVALID_PARAMS', { message: '请先完成 S1 剧本解析（或粘贴导入原剧本），再执行 S2 剧本洗稿。' })
  }

  const intensityLabel =
    params.stageParams.rewriteIntensity === 'light'
      ? 'light（轻度润色：保留原剧情主线，优化节奏与前3秒台词）'
      : params.stageParams.rewriteIntensity === 'heavy'
        ? 'heavy（深度翻拍：仅保留爆款情绪骨架，彻底重构人设、世界观与视觉桥段）'
        : 'medium（结构改编：复用节奏骨架，原创换皮角色、场景与核心台词）'

  const productBrief = params.stageParams.productBrief || (
    params.item.inputPayload.productName
      ? {
          productName: params.item.inputPayload.productName,
          sellingPoints: params.item.inputPayload.sellingPoints,
          hookAngle: params.item.inputPayload.hookAngle,
          ctaText: params.item.inputPayload.ctaText,
        }
      : undefined
  )

  const userPrompt = [
    '请基于以下上游【S1 原剧本解析】与编导洗稿参数，输出严格 JSON 格式的 S2【洗稿新剧本】：',
    `洗稿强度：${intensityLabel}`,
    `目标总时长：${params.stageParams.targetDurationSec || params.item.inputPayload.durationTargetSec || s1?.estimatedDurationSec || 30} 秒`,
    params.stageParams.tone ? `目标语调/情绪风格：${params.stageParams.tone}` : '',
    productBrief ? `带货/商品植入信息：\n${JSON.stringify(productBrief, null, 2)}` : '',
    params.stageParams.customInstruction ? `导演特别指示：${params.stageParams.customInstruction}` : '',
    params.item.inputPayload.styleNotes ? `风格补充备注：${params.item.inputPayload.styleNotes}` : '',
    s1
      ? `上游 S1 原剧本（已锁定）：\n${JSON.stringify({
          title: s1.title,
          summary: s1.summary,
          genre: s1.genre,
          estimatedDurationSec: s1.estimatedDurationSec,
          hookAnalysis: s1.hookAnalysis,
          characters: s1.characters,
          locations: s1.locations,
          props: s1.props,
          beats: s1.beats,
          fullScriptText: s1.editedScriptText ?? s1.fullScriptText,
        }, null, 2)}`
      : `原始导入剧本文本：\n${fallbackPasted}`,
  ].filter(Boolean).join('\n\n')

  return await generateStageLlmArtifactWithQc({
    stage: 'script_rewrite',
    skill: params.skill,
    systemPrompt: buildSystemPromptWithExamples(params.skill),
    userPrompt,
    invoke: async (prompt, maxTokens) => await callWorkflowLlmJson({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.actorId,
      projectId: params.projectId,
      action: 'batch-workflow.script_rewrite',
      modelKey: cleanText(params.stageModelOverride) || params.skill.modelPreferences?.llmModelKey || params.modelConfig.textModelKey,
      temperature: params.modelConfig.textCreativity ?? params.skill.modelPreferences?.temperature ?? 0.65,
      systemPrompt: buildSystemPromptWithExamples(params.skill),
      userPrompt: prompt,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    }),
    validateRaw: (json) => assertStrictWorkflowArtifact('script_rewrite', json),
    normalize: (json) => normalizeStage2RewrittenScript(json, params.item, params.skill, params.stageParams),
    validateNormalized: (artifact) => assertNormalizedWorkflowArtifact('script_rewrite', artifact),
    executionMeta: params.executionMeta,
  })
}

async function executeStage3AssetExtractLlmCore(params: {
  workspaceOwnerId: string
  actorId: string
  projectId: string
  modelConfig: WorkflowModelConfig
  item: BatchItemDTO
  skill: WorkflowSkillDTO
  stageParams: AssetExtractionStageParams
  stageModelOverride?: string | null
  executionMeta?: WorkflowStageExecutionMeta
}): Promise<AssetsArtifact> {
  const s2 = params.item.stageOutputs.script_rewrite
  const s1 = params.item.stageOutputs.script_analysis
  if (!s2 && !s1 && !cleanText(params.item.inputPayload.pastedScript)) {
    throw new ApiError('INVALID_PARAMS', { message: '请先完成 S2 剧本洗稿（或导入原剧本），再执行 S3 资产解析。' })
  }

  const preferWorkspaceReuse = params.stageParams.preferWorkspaceReuse !== false
  const maxAssetsPerKind = toNumber(params.stageParams.maxAssetsPerKind, 4, 1, 10)
  const videoAspectRatio = params.modelConfig.videoAspectRatio || params.item.inputPayload.aspectRatio || '9:16'

  const allWorkspaceMaterials = preferWorkspaceReuse
    ? await loadWorkspaceMaterials(params.workspaceOwnerId, ['image', 'audio'], 250)
    : []
  const workspaceImageMaterials = allWorkspaceMaterials.filter((m) => m.type === 'image')
  const workspaceAudioById = new Map(
    allWorkspaceMaterials.filter((m) => m.type === 'audio').map((m) => [m.id, m]),
  )

  const existingCatalogHint = workspaceImageMaterials.slice(0, 40).map((m) => ({
    title: m.title,
    category: frameosAssetCategoryFromMetadata(m.metadata),
    aliases: frameosAssetAliasesFromMetadata(m.metadata),
  }))

  const userPrompt = [
    '请基于以下剧本内容，提炼全片需要的视觉资产清单（character / location / prop），每条 imagePrompt 不超过 900 字符：',
    params.stageParams.artStyle ? `目标美术风格：${params.stageParams.artStyle}` : '',
    `每类资产最多提取数量：${maxAssetsPerKind}`,
    params.stageParams.customInstruction ? `美术指导补充要求：${params.stageParams.customInstruction}` : '',
    existingCatalogHint.length > 0
      ? `当前工作区已有素材参考名称（若角色/场景/商品定位匹配，可沿用相同简洁名称以便自动复用）：\n${JSON.stringify(existingCatalogHint, null, 2)}`
      : '',
    s2
      ? `上游 S2 洗稿剧本（已锁定）：\n${JSON.stringify(s2, null, 2)}`
      : s1
        ? `上游 S1 原剧本（跳过洗稿直入资产提取）：\n${JSON.stringify({
            title: s1.title,
            summary: s1.summary,
            characters: s1.characters,
            locations: s1.locations,
            props: s1.props,
            fullScriptText: s1.editedScriptText ?? s1.fullScriptText,
          }, null, 2)}`
        : `粘贴剧本：\n${params.item.inputPayload.pastedScript}`,
  ].filter(Boolean).join('\n\n')

  return await generateStageLlmArtifactWithQc({
    stage: 'asset_extraction',
    skill: params.skill,
    systemPrompt: buildSystemPromptWithExamples(params.skill),
    userPrompt,
    invoke: async (prompt, maxTokens) => await callWorkflowLlmJson({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.actorId,
      projectId: params.projectId,
      action: 'batch-workflow.asset_extraction',
      modelKey: cleanText(params.stageModelOverride) || params.skill.modelPreferences?.llmModelKey || params.modelConfig.textModelKey,
      temperature: Math.min(0.45, params.modelConfig.textCreativity ?? 0.35),
      systemPrompt: buildSystemPromptWithExamples(params.skill),
      userPrompt: prompt,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    }),
    validateRaw: (json) => assertStrictWorkflowArtifact('asset_extraction', json),
    normalize: (json) => normalizeStage3Assets({
      raw: json,
      projectId: params.projectId,
      videoAspectRatio,
      preferWorkspaceReuse,
      maxAssetsPerKind,
      workspaceImageMaterials,
      workspaceAudioById,
    }),
    validateNormalized: (artifact) => assertNormalizedWorkflowArtifact('asset_extraction', artifact),
    executionMeta: params.executionMeta,
  })
}

async function submitStage3AssetImageTasks(params: {
  workspaceOwnerId: string
  actorId: string
  projectId: string
  item: BatchItemDTO
  artifact: AssetsArtifact
  modelConfig: WorkflowModelConfig
  assetItemIds?: string[]
  imageModelKeyOverride?: string | null
  resolutionOverride?: string | null
  qualityOverride?: ImageQualityLevel | null
  locale: 'zh' | 'en'
}): Promise<{
  artifact: AssetsArtifact
  taskIds: string[]
  submittedCount: number
  failedCount: number
}> {
  const requestedImageModel = cleanText(params.imageModelKeyOverride) || params.modelConfig.imageModelKey
  const resolved = await resolveValidatedModelForStage({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    requestedModelKey: requestedImageModel,
    explicitRequested: Boolean(params.imageModelKeyOverride),
    type: 'image',
  })

  const capabilities = resolveBuiltinCapabilitiesByModelKey('image', resolved.actualModelKey)

  const taskIds: string[] = []
  let submittedCount = 0
  let failedCount = 0
  const targets = params.artifact.items.filter((asset) => (params.assetItemIds && params.assetItemIds.length > 0
    ? params.assetItemIds.includes(asset.id)
    : asset.status === 'pending' || asset.status === 'failed'))
  const activeByAssetId = new Map(params.artifact.items.map((asset) => [asset.id, asset.versions.find((version) => version.taskId && (version.status === 'queued' || version.status === 'processing'))]))
  const submittedByAssetId = new Map(await mapWithConcurrency(targets, async (asset): Promise<[string, WorkflowAssetItem | null]> => {
    const active = activeByAssetId.get(asset.id)
    if (active?.taskId) {
      taskIds.push(active.taskId)
      return [asset.id, null]
    }

    const styleAnchor = [
      params.artifact.styleBible,
      params.artifact.colorPalette ? `色板：${params.artifact.colorPalette}` : '',
      params.artifact.lightingDirection ? `光影：${params.artifact.lightingDirection}` : '',
    ].filter(Boolean).join('；')
    const clampedPrompt = clampImagePrompt(`${asset.imagePrompt || asset.description || asset.name}。统一风格锚点：${styleAnchor}`, ASSET_IMAGE_PROMPT_MAX_CHARS)
    const imgOpts = resolveImageGenerationOptionsForCapabilities({
      capabilities,
      preferredResolution: params.resolutionOverride || params.modelConfig.imageResolution,
      preferredQuality: params.qualityOverride || params.modelConfig.imageQuality,
      aspectRatio: asset.aspectRatio,
    })

    const assetTitle = asset.name.slice(0, 120)
    const assetCategory = normalizeFrameosAssetCategory(asset.kind)
    const nowIso = new Date().toISOString()
    const nextVersionIndex = (asset.versions || []).reduce((max, v) => Math.max(max, v.versionIndex), 0) + 1

    const toolboxAsset = await prisma.frameosToolboxAsset.create({
      data: {
        userId: params.workspaceOwnerId,
        projectId: params.projectId,
        type: 'image',
        source: 'toolbox',
        bizType: 'image_generation',
        modelId: resolved.actualModelKey,
        status: 'pending',
        params: toJsonInput({
          ...imgOpts,
          title: assetTitle,
          prompt: clampedPrompt,
          modelKey: resolved.modelKey,
          assetCategory,
          batchRunId: params.item.batchRunId,
          batchItemId: params.item.id,
          workflowAssetId: asset.id,
        }),
      },
    })

    try {
      const submitted = await submitTask({
        userId: params.workspaceOwnerId,
        locale: params.locale,
        projectId: params.projectId,
        type: TASK_TYPE.TOOLBOX_IMAGE,
        targetType: 'FrameosToolboxAsset',
        targetId: toolboxAsset.id,
        payload: {
          ...imgOpts,
          title: assetTitle,
          personalOwnerId: params.actorId,
          prompt: clampedPrompt,
          imageModel: resolved.modelKey,
          modelId: resolved.modelKey,
          assetCategory,
          referenceImages: [],
          count: 1,
        },
        dedupeKey: `${TASK_TYPE.TOOLBOX_IMAGE}:${toolboxAsset.id}`,
      })

      const newVersion: WorkflowAssetImageVersion = {
        versionIndex: nextVersionIndex,
        materialId: null,
        toolboxAssetId: toolboxAsset.id,
        taskId: submitted.taskId,
        imageUrl: null,
        storageKey: null,
        prompt: clampedPrompt,
        modelKey: resolved.modelKey,
        aspectRatio: imgOpts.aspectRatio,
        resolution: imgOpts.resolution || null,
        source: 'generated',
        // Keep status 'queued' until imageUrl/materialId are hydrated by syncBatchItemTaskStatuses
        // (even if submitTask returned synchronous COMPLETED).
        status: 'queued',
        errorMessage: null,
        createdAt: nowIso,
      }
      const nextVersions = [...(asset.versions || []), newVersion]
      taskIds.push(submitted.taskId)
      submittedCount += 1

      return [asset.id, {
        ...asset,
        imagePrompt: clampedPrompt,
        status: newVersion.status,
        toolboxAssetId: toolboxAsset.id,
        taskId: submitted.taskId,
        errorMessage: null,
        versions: nextVersions,
        selectedVersionIndex: nextVersions.length - 1,
      }]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failedCount += 1
      await prisma.frameosToolboxAsset.updateMany({
        where: { id: toolboxAsset.id, status: { not: 'ready' } },
        data: { status: 'failed', errorMessage: message },
      }).catch(() => undefined)

      const failedVersion: WorkflowAssetImageVersion = {
        versionIndex: nextVersionIndex,
        materialId: null,
        toolboxAssetId: toolboxAsset.id,
        taskId: null,
        imageUrl: null,
        storageKey: null,
        prompt: clampedPrompt,
        modelKey: resolved.modelKey,
        aspectRatio: imgOpts.aspectRatio,
        resolution: imgOpts.resolution || null,
        source: 'generated',
        status: 'failed',
        errorMessage: message,
        createdAt: nowIso,
      }
      const nextVersions = [...(asset.versions || []), failedVersion]
      return [asset.id, {
        ...asset,
        imagePrompt: clampedPrompt,
        status: 'failed',
        toolboxAssetId: toolboxAsset.id,
        taskId: null,
        errorMessage: message,
        versions: nextVersions,
        selectedVersionIndex: nextVersions.length - 1,
      }]
    }
  }))
  const nextItems = params.artifact.items.map((asset) => submittedByAssetId.get(asset.id) || asset)

  return {
    artifact: recomputeAssetsArtifactCounts({ ...params.artifact, items: nextItems }),
    taskIds,
    submittedCount,
    failedCount,
  }
}

async function executeStage4StoryboardCore(params: {
  workspaceOwnerId: string
  actorId: string
  projectId: string
  modelConfig: WorkflowModelConfig
  item: BatchItemDTO
  skill: WorkflowSkillDTO
  stageParams: StoryboardStageParams
  stageModelOverride?: string | null
  executionMeta?: WorkflowStageExecutionMeta
}): Promise<StoryboardArtifact> {
  const s2 = params.item.stageOutputs.script_rewrite
  const s1 = params.item.stageOutputs.script_analysis
  if (!s2 && !s1) {
    throw new ApiError('INVALID_PARAMS', { message: '请先完成 S2 洗稿剧本（或 S1 剧本解析），再执行 S4 处理分镜。' })
  }

  // Resolve S5 target video model capabilities so S4 obeys duration & firstlastframe rules!
  const videoResolved = await resolveValidatedModelForStage({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    requestedModelKey: params.modelConfig.videoModelKey,
    type: 'video',
  }).catch((error) => {
    throw modelUnavailableError(params.modelConfig.videoModelKey, error)
  })
  const videoCaps = resolveVideoCapabilitiesSummary(videoResolved.actualModelKey)

  const s3 = params.item.stageOutputs.asset_extraction
  const assetSummaryForPrompt = (s3?.items || []).map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    aliases: a.aliases,
    roleOrUsage: a.roleOrUsage,
    description: a.description,
    hasBoundImage: Boolean(a.materialId || a.imageUrl),
    hasBoundVoice: Boolean(a.voiceMaterialId),
  }))

  const maxShotDuration = Math.min(
    videoCaps.durationRange.max,
    toNumber(params.stageParams.maxShotDurationSec, 10, videoCaps.durationRange.min, videoCaps.durationRange.max),
  )

  const upstreamForPrompt = s2
    ? {
        title: s2.title,
        estimatedDurationSec: s2.estimatedDurationSec,
        hookLine3s: s2.hookLine3s,
        scenes: s2.scenes,
      }
    : s1
      ? {
          title: s1.title,
          estimatedDurationSec: s1.estimatedDurationSec,
          scriptText: s1.editedScriptText ?? s1.fullScriptText,
        }
      : null
  const userPrompt = [
    '请基于以下上游【S2 洗稿剧本】、【S3 视觉资产清单】与【S5 目标视频模型能力约束】，输出严格 JSON 格式的 S4【分镜提示词脚本】：',
    `目标视频模型：${videoResolved.modelKey}`,
    `画幅比例：${params.modelConfig.videoAspectRatio || params.item.inputPayload.aspectRatio || '9:16'}`,
    `允许单镜时长范围：${videoCaps.durationRange.min}-${maxShotDuration} 秒（允许值：${videoCaps.durationRange.allowed.filter((d) => d <= maxShotDuration).join(', ')}）`,
    `是否支持首尾帧模式（firstlastframe）：${videoCaps.supportsFirstLastFrame ? '支持（但多资产引用优先用 text 全能参考）' : '不支持（严禁输出 inputMode="firstlastframe"，全部使用 inputMode="text"）'}`,
    params.stageParams.targetShotCount ? `期望镜头总数：约 ${params.stageParams.targetShotCount} 镜` : '',
    params.stageParams.pacingStyle ? `期望剪辑节奏：${params.stageParams.pacingStyle}` : '',
    params.stageParams.customInstruction ? `导演分镜特别指示：${params.stageParams.customInstruction}` : '',
    `S3 视觉资产清单（videoPrompt 中必须使用精确 @name 提及以下资产，并在 referencedAssetIds 中列出对应 id）：\n${JSON.stringify({
      styleBible: s3?.styleBible || '',
      colorPalette: s3?.colorPalette || '',
      lightingDirection: s3?.lightingDirection || '',
      assets: assetSummaryForPrompt,
    }, null, 2)}`,
    `上游剧本（已锁定，仅包含分镜所需字段）：\n${JSON.stringify(upstreamForPrompt, null, 2)}`,
  ].filter(Boolean).join('\n\n')

  const expectedShots = toNumber(params.stageParams.targetShotCount, Math.max(1, s2?.scenes.length || 6), 1, WORKFLOW_MAX_SHOTS)
  const maxTokens = Math.min(32000, Math.max(6000, 2000 + expectedShots * 900))
  return await generateStageLlmArtifactWithQc({
    stage: 'storyboard',
    skill: params.skill,
    systemPrompt: buildSystemPromptWithExamples(params.skill),
    userPrompt,
    maxTokens,
    invoke: async (prompt, tokenBudget) => await callWorkflowLlmJson({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.actorId,
      projectId: params.projectId,
      action: 'batch-workflow.storyboard',
      modelKey: cleanText(params.stageModelOverride) || params.skill.modelPreferences?.llmModelKey || params.modelConfig.textModelKey,
      temperature: Math.min(0.55, params.modelConfig.textCreativity ?? 0.4),
      systemPrompt: buildSystemPromptWithExamples(params.skill),
      userPrompt: prompt,
      ...(tokenBudget !== undefined ? { maxTokens: tokenBudget } : {}),
    }),
    validateRaw: (json) => assertStrictWorkflowArtifact('storyboard', json, s3?.items.map((asset) => asset.id)),
    normalize: (json) => normalizeStage4Storyboard({
      raw: json,
      item: params.item,
      modelConfig: params.modelConfig,
      videoModelKey: videoResolved.modelKey,
      videoCaps,
    }),
    validateNormalized: (artifact) => assertNormalizedWorkflowArtifact('storyboard', artifact, s3?.items.map((asset) => asset.id)),
    executionMeta: params.executionMeta,
  })
}

async function executeStage5VideoGenCore(params: {
  workspaceOwnerId: string
  actorId: string
  projectId: string
  item: BatchItemDTO
  skill: WorkflowSkillDTO
  stageConfig?: WorkflowTemplateStageConfig
  modelConfig: WorkflowModelConfig
  stageParams: VideoGenStageParams
  shotOverrides?: Record<string, VideoGenShotOverride>
  regenerateAll?: boolean
  shotIds?: string[]
  forceRerun?: boolean
  locale: 'zh' | 'en'
}): Promise<{
  output: VideoGenArtifact
  taskIds: string[]
  asyncPending: boolean
}> {
  const s4 = params.item.stageOutputs.storyboard
  if (!s4 || !Array.isArray(s4.shots) || s4.shots.length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: '请先完成 S4 处理分镜，再执行 S5 批量生视频。' })
  }

  if ((params.forceRerun || params.regenerateAll) && params.regenerateAll !== true && !(params.shotIds && params.shotIds.length > 0)) {
    throw new ApiError('INVALID_PARAMS', { message: '已有视频的全量重抽会消耗视频额度，请显式设置 regenerateAll: true，或使用 shotIds 仅重抽指定镜头。' })
  }
  if (params.shotIds && params.shotIds.length > 0) {
    const shotIdSet = new Set(s4.shots.map((shot) => shot.shotId))
    const unknown = params.shotIds.find((shotId) => !shotIdSet.has(shotId))
    if (unknown) throw new ApiError('NOT_FOUND', { message: `未找到指定镜头：${unknown}` })
  }
  if (params.shotOverrides) {
    const unknown = Object.keys(params.shotOverrides).find((shotId) => !(params.shotIds || []).includes(shotId))
    if (unknown) throw new ApiError('INVALID_PARAMS', { message: `shotOverrides 的镜头必须同时列入 shotIds：${unknown}` })
  }

  const requestedVideoModel = cleanText(params.stageConfig?.modelKey)
    || cleanText(params.skill?.modelPreferences?.videoModelKey)
    || params.modelConfig.videoModelKey
  const videoResolved = await resolveValidatedModelForStage({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    requestedModelKey: requestedVideoModel,
    explicitRequested: Boolean(params.stageConfig?.modelKey || params.skill?.modelPreferences?.videoModelKey),
    type: 'video',
  })
  const videoCaps = resolveVideoCapabilitiesSummary(videoResolved.actualModelKey)

  const aspectRatio = normalizeVideoAspectRatio(
    params.stageParams.aspectRatio || params.modelConfig.videoAspectRatio || s4.aspectRatio || params.item.inputPayload.aspectRatio,
    '9:16',
  )
  const preferredRes = cleanText(params.stageParams.resolution) || params.modelConfig.videoResolution || '720p'
  const resolution = videoCaps.resolutionOptions.find((r) => r.toLowerCase() === preferredRes.toLowerCase())
    || videoCaps.resolutionOptions[0]
    || '720p'
  const generateAudio = videoCaps.supportsGenerateAudio
    ? (typeof params.stageParams.generateAudio === 'boolean'
        ? params.stageParams.generateAudio
        : params.modelConfig.videoGenerateAudio)
    : false
  const defaultInputMode = normalizeVideoInputMode(
    params.stageParams.inputMode || params.modelConfig.videoInputMode,
    'text',
  )

  // Gather all referenced S3 asset materialIds AND character voiceMaterialIds + any item-level referenceMaterialIds
  const s3Items = params.item.stageOutputs.asset_extraction?.items || []
  const s3ById = new Map(s3Items.map((a) => [a.id, a]))

  const wantedMaterialIds = new Set<string>()
  for (const asset of s3Items) {
    if (asset.materialId) wantedMaterialIds.add(asset.materialId)
    if (asset.voiceMaterialId) wantedMaterialIds.add(asset.voiceMaterialId)
  }
  for (const refId of params.item.inputPayload.referenceMaterialIds || []) {
    if (refId) wantedMaterialIds.add(refId)
  }

  const workspaceUsers = await prisma.user.findMany({
    where: workspaceUserWhere(params.workspaceOwnerId),
    select: { id: true },
  })
  const workspaceUserIds = workspaceUsers.map((u) => u.id)

  const initialMaterials = wantedMaterialIds.size > 0
    ? await prisma.frameosMaterial.findMany({
        where: {
          id: { in: Array.from(wantedMaterialIds) },
          userId: { in: workspaceUserIds },
          type: { in: ['image', 'video', 'audio'] },
          status: 'ready',
          deletedAt: null,
        },
      })
    : []

  // Also load any character voice materials linked on FrameosMaterial.metadata (not just asset.voiceMaterialId)
  const metadataVoiceIds = Array.from(new Set(
    initialMaterials
      .filter((m) => m.type === 'image')
      .map((m) => characterVoiceMaterialId(m.metadata))
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && !wantedMaterialIds.has(id)),
  ))
  const extraVoiceMaterials = metadataVoiceIds.length > 0
    ? await prisma.frameosMaterial.findMany({
        where: {
          id: { in: metadataVoiceIds },
          userId: { in: workspaceUserIds },
          type: 'audio',
          status: 'ready',
          deletedAt: null,
        },
      })
    : []

  const allResolvedMaterials = await ensureFrameosReferenceMediaDurations([
    ...initialMaterials,
    ...extraVoiceMaterials,
  ])
  const matById = new Map(allResolvedMaterials.map((m) => [m.id, m]))
  const materialSource = (m: (typeof allResolvedMaterials)[number]) => m.storageKey || m.resultUrl || ''

  const existingS5 = params.item.stageOutputs.video_gen
  const existingByShotId = new Map<string, VideoGenShotEntry>(
    (existingS5?.shots || []).map((entry) => [entry.shotId, entry]),
  )
  const targetShotSet = params.shotIds && params.shotIds.length > 0 ? new Set(params.shotIds) : null

  const taskIds: string[] = []
  let newlySubmitted = 0
  let newlyFailed = 0

  const submissionResults = await mapWithConcurrency(s4.shots, async (shot) => {
    const override = params.shotOverrides?.[shot.shotId]
    const effectiveShot = {
      ...shot,
      videoPrompt: cleanText(override?.prompt, shot.videoPrompt),
      inputMode: override?.inputMode || shot.inputMode,
      durationSec: override?.durationSeconds ?? shot.durationSec,
    }
    const existingEntry = existingByShotId.get(shot.shotId)
    const existingTakes = existingEntry?.takes ? [...existingEntry.takes] : []
    const hasExplicitTarget = Boolean(targetShotSet?.has(shot.shotId))
    const hasActiveTake = existingTakes.some((take) => take.taskId && (take.status === 'queued' || take.status === 'processing'))
    const hasReadyOrActiveTake = existingTakes.some(
      (t) => t.status === 'ready' || t.status === 'queued' || t.status === 'processing',
    )

    // Reconcile explicit referencedAssetIds with any @AssetName / @Alias typed directly in videoPrompt
    const mentionedAssets = reconcileShotAssetMentions(cleanText(effectiveShot.videoPrompt), s3Items)
    const effectiveReferencedAssetIds = Array.from(new Set([
      ...(shot.referencedAssetIds || []).filter((id) => s3ById.has(id)),
      ...mentionedAssets.referencedAssetIds,
    ]))

    if (hasActiveTake && !hasExplicitTarget) {
      return { submitted: false, entry: existingEntry!, taskIds: existingTakes.filter((take) => take.taskId && (take.status === 'queued' || take.status === 'processing')).map((take) => take.taskId!) }
    }

    // Decide whether to submit a new take for this shot:
    // - If shotIds[] was specified: ONLY submit for shots inside shotIds[] (appends new take to takes[]!)
    // - Else if forceRerun: submit a new take for every shot (appending to takes[])
    // - Else: submit only for shots with no ready/queued/processing take
    const shouldSubmit = targetShotSet
      ? targetShotSet.has(shot.shotId)
      : (params.forceRerun === true || !hasReadyOrActiveTake)

    if (!shouldSubmit) {
      return { submitted: false, entry: existingEntry || {
        shotId: shot.shotId,
        shotIndex: shot.shotIndex,
        title: shot.title,
        durationSec: shot.durationSec,
        prompt: effectiveShot.videoPrompt,
        referencedAssetIds: effectiveReferencedAssetIds,
        takes: existingTakes,
        selectedTakeIndex: existingTakes.length > 0 ? existingTakes.length - 1 : -1,
      }, taskIds: existingTakes.filter((take) => take.taskId && (take.status === 'queued' || take.status === 'processing')).map((take) => take.taskId!) }
    }

    // Collect image refs & character voice audio refs aligned to this shot's reconciled S3 assets
    const shotAssets = effectiveReferencedAssetIds
      .map((id) => s3ById.get(id))
      .filter((a): a is WorkflowAssetItem => Boolean(a))

    const refImageEntries: Array<{
      material: (typeof allResolvedMaterials)[number]
      mentionNames: string[]
      aliases: string[]
    }> = []
    const seenImageMatIds = new Set<string>()
    const refAudioEntries: Array<{
      material: (typeof allResolvedMaterials)[number]
      mentionNames: string[]
    }> = []
    const seenAudioMatIds = new Set<string>()
    const refVideoEntries: Array<{
      material: (typeof allResolvedMaterials)[number]
      mentionNames: string[]
    }> = []
    const seenVideoMatIds = new Set<string>()

    for (const asset of shotAssets) {
      if (asset.materialId && !seenImageMatIds.has(asset.materialId)) {
        const mat = matById.get(asset.materialId)
        if (mat && mat.type === 'image' && materialSource(mat) && refImageEntries.length < videoCaps.maxImages) {
          seenImageMatIds.add(mat.id)
          const mentionNames = Array.from(new Set([
            asset.name,
            ...(asset.aliases || []),
            cleanText(mat.title),
          ].filter(Boolean)))
          const aliases = Array.from(new Set([
            ...(asset.aliases || []),
            ...frameosAssetAliasesFromMetadata(mat.metadata),
          ].filter(Boolean)))
          refImageEntries.push({ material: mat, mentionNames, aliases })
        }
      }

      // Auto-attach character voiceMaterialId (or image metadata bound voice) when audio is enabled
      if (asset.kind === 'character' && generateAudio && videoCaps.maxAudios > 0) {
        const imageMat = asset.materialId ? matById.get(asset.materialId) : null
        const voiceId = asset.voiceMaterialId || (imageMat ? characterVoiceMaterialId(imageMat.metadata) : null)
        if (voiceId && !seenAudioMatIds.has(voiceId) && refAudioEntries.length < videoCaps.maxAudios) {
          const voiceMat = matById.get(voiceId)
          if (voiceMat && voiceMat.type === 'audio' && materialSource(voiceMat)) {
            seenAudioMatIds.add(voiceMat.id)
            refAudioEntries.push({
              material: voiceMat,
              mentionNames: Array.from(new Set([asset.name, cleanText(voiceMat.title)].filter(Boolean))),
            })
          }
        }
      }
    }

    // Include item-level reference videos if any (respecting model maxVideos)
    for (const refId of params.item.inputPayload.referenceMaterialIds || []) {
      const mat = matById.get(refId)
      if (!mat || !materialSource(mat)) continue
      if (mat.type === 'video' && !seenVideoMatIds.has(mat.id) && refVideoEntries.length < videoCaps.maxVideos) {
        seenVideoMatIds.add(mat.id)
        refVideoEntries.push({
          material: mat,
          mentionNames: cleanText(mat.title) ? [cleanText(mat.title)] : [],
        })
      }
    }

    const effectiveInputMode = resolveShotVideoInputMode({
      requested: effectiveShot.inputMode || defaultInputMode,
      supportsFirstLastFrame: videoCaps.supportsFirstLastFrame,
      imageCount: refImageEntries.length,
      videoCount: refVideoEntries.length,
      audioCount: refAudioEntries.length,
    })

    // First/last frame & single-image I2V must not attach videos or audios
    const finalAudioEntries = effectiveInputMode === 'text' ? refAudioEntries : []
    const finalVideoEntries = effectiveInputMode === 'text' ? refVideoEntries : []
    const orderedRefs = [
      ...refImageEntries.map((e) => e.material),
      ...finalVideoEntries.map((e) => e.material),
      ...finalAudioEntries.map((e) => e.material),
    ]

    const referenceImageRoles = refImageEntries.map((_, idx) =>
      effectiveInputMode === 'firstlastframe'
        ? (idx === 0 ? 'FIRST_FRAME' : 'LAST_FRAME')
        : 'REF',
    )
    const referenceMaterialsPayload = [
      ...refImageEntries.map((e, idx) => ({
        materialId: e.material.id,
        role: referenceImageRoles[idx],
      })),
      ...finalVideoEntries.map((e) => ({ materialId: e.material.id, role: 'REF' })),
      ...finalAudioEntries.map((e) => ({ materialId: e.material.id, role: 'REF' })),
    ]

    const referenceSummary: CanvasReferenceMediaSummary[] = orderedRefs.map((m, idx) => ({
      id: m.id,
      title: m.title?.trim() || '参考素材',
      type: m.type as 'image' | 'video' | 'audio',
      role: (referenceMaterialsPayload[idx]?.role || 'REF') as 'REF' | 'FIRST_FRAME' | 'LAST_FRAME',
      ...(m.type === 'video' || m.type === 'audio'
        ? { durationSeconds: readMediaDurationSeconds(m.metadata) }
        : {}),
    }))

    const inputVideoSeconds = finalVideoEntries.reduce(
      (sum, entry) => sum + (readMediaDurationSeconds(entry.material.metadata) || 0),
      0,
    )

    const shotDuration = pickClosestAllowedDuration(
      effectiveShot.durationSec || params.stageParams.durationSeconds || params.modelConfig.videoDurationSeconds || 5,
      videoCaps.durationRange.allowed,
    )
    const nextTakeIndex = existingTakes.reduce((max, t) => Math.max(max, t.takeIndex), 0) + 1
    const assetTitle = `${params.item.title} · 镜${shot.shotIndex} · Take ${nextTakeIndex}`.slice(0, 180)
    const nowIso = new Date().toISOString()

    const options = {
      aspectRatio,
      resolution,
      duration: shotDuration,
      generateAudio,
    }

    const toolboxAsset = await prisma.frameosToolboxAsset.create({
      data: {
        userId: params.workspaceOwnerId,
        projectId: params.projectId,
        type: 'video',
        source: 'toolbox',
        bizType: 'video_generation',
        modelId: videoResolved.actualModelKey,
        status: 'pending',
        params: toJsonInput({
          ...options,
          title: assetTitle,
          prompt: effectiveShot.videoPrompt,
          modelKey: videoResolved.modelKey,
          inputMode: effectiveInputMode,
          referenceMaterialIds: orderedRefs.map((m) => m.id),
          referenceMaterials: referenceMaterialsPayload,
          referenceSummary,
          batchRunId: params.item.batchRunId,
          batchItemId: params.item.id,
          shotId: shot.shotId,
          shotIndex: shot.shotIndex,
          takeIndex: nextTakeIndex,
        }),
      },
    })

    try {
      const submitted = await submitTask({
        userId: params.workspaceOwnerId,
        locale: params.locale,
        projectId: params.projectId,
        type: TASK_TYPE.TOOLBOX_VIDEO,
        targetType: 'FrameosToolboxAsset',
        targetId: toolboxAsset.id,
        payload: {
          ...options,
          generationOptions: {
            ...options,
            generationMode: effectiveInputMode === 'firstlastframe' ? 'firstlastframe' : 'normal',
          },
          title: assetTitle,
          personalOwnerId: params.actorId,
          prompt: effectiveShot.videoPrompt,
          inputMode: effectiveInputMode,
          referenceImages: refImageEntries.map((e) => materialSource(e.material)),
          referenceVideos: finalVideoEntries.map((e) => materialSource(e.material)),
          ...(finalVideoEntries.length > 0 ? { inputVideoSeconds } : {}),
          referenceAudios: finalAudioEntries.map((e) => materialSource(e.material)),
          referenceNames: orderedRefs.map((m) => m.title?.trim() || '参考素材'),
          referenceImageNames: refImageEntries.map((e) => e.mentionNames[0] || e.material.title?.trim() || '参考图片'),
          referenceVideoNames: finalVideoEntries.map((e) => e.material.title?.trim() || '参考视频'),
          referenceAudioNames: finalAudioEntries.map((e) => e.mentionNames[0] || e.material.title?.trim() || '参考音频'),
          referenceImageMentionNames: refImageEntries.map((e) => e.mentionNames),
          ...(refImageEntries.some((e) => e.aliases.length > 0)
            ? { referenceImageAliases: refImageEntries.map((e) => e.aliases) }
            : {}),
          referenceVideoMentionNames: finalVideoEntries.map((e) => e.mentionNames),
          referenceAudioMentionNames: finalAudioEntries.map((e) => e.mentionNames),
          referenceImageRoles,
          referenceMaterialIds: orderedRefs.map((m) => m.id),
          referenceMaterials: referenceMaterialsPayload,
          referenceSummary,
          videoModel: videoResolved.modelKey,
          modelId: videoResolved.modelKey,
          count: 1,
        },
        dedupeKey: `${TASK_TYPE.TOOLBOX_VIDEO}:${toolboxAsset.id}`,
      })

      taskIds.push(submitted.taskId)
      newlySubmitted += 1

      const newTake: VideoShotTake = {
        takeIndex: nextTakeIndex,
        taskId: submitted.taskId,
        assetId: toolboxAsset.id,
        materialId: null,
        videoUrl: null,
        storageKey: null,
        posterUrl: null,
        prompt: effectiveShot.videoPrompt,
        modelKey: videoResolved.modelKey,
        inputMode: effectiveInputMode,
        aspectRatio,
        resolution,
        durationSec: shotDuration,
        generateAudio,
        // Keep status 'queued' until videoUrl/materialId are hydrated by syncBatchItemTaskStatuses
        status: 'queued',
        errorMessage: null,
        submittedAt: nowIso,
        completedAt: null,
      }
      const nextTakes = [...existingTakes, newTake]
      return { submitted: true, taskId: submitted.taskId, entry: {
        shotId: shot.shotId,
        shotIndex: shot.shotIndex,
        title: shot.title,
        durationSec: shotDuration,
        prompt: effectiveShot.videoPrompt,
        referencedAssetIds: effectiveReferencedAssetIds,
        takes: nextTakes,
        selectedTakeIndex: nextTakes.length - 1,
      } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      newlyFailed += 1
      await prisma.frameosToolboxAsset.updateMany({
        where: { id: toolboxAsset.id, status: { not: 'ready' } },
        data: { status: 'failed', errorMessage: message },
      }).catch(() => undefined)

      const failedTake: VideoShotTake = {
        takeIndex: nextTakeIndex,
        taskId: null,
        assetId: toolboxAsset.id,
        materialId: null,
        videoUrl: null,
        storageKey: null,
        posterUrl: null,
        prompt: effectiveShot.videoPrompt,
        modelKey: videoResolved.modelKey,
        inputMode: effectiveInputMode,
        aspectRatio,
        resolution,
        durationSec: shotDuration,
        generateAudio,
        status: 'failed',
        errorMessage: message,
        submittedAt: nowIso,
        completedAt: null,
      }
      const nextTakes = [...existingTakes, failedTake]
      return { submitted: false, error: message, entry: {
        shotId: shot.shotId,
        shotIndex: shot.shotIndex,
        title: shot.title,
        durationSec: shotDuration,
        prompt: effectiveShot.videoPrompt,
        referencedAssetIds: effectiveReferencedAssetIds,
        takes: nextTakes,
        selectedTakeIndex: existingEntry && existingEntry.selectedTakeIndex >= 0
          ? existingEntry.selectedTakeIndex
          : nextTakes.length - 1,
      } }
    }
  })
  const nextShots = submissionResults.map((result) => result.entry)
  for (const result of submissionResults) {
    if (result.submitted) newlySubmitted += 1
    if (result.error) newlyFailed += 1
    if (result.taskId) taskIds.push(result.taskId)
    for (const taskId of result.taskIds || []) taskIds.push(taskId)
  }

  if (newlySubmitted === 0 && newlyFailed > 0 && nextShots.every((s) => s.takes.every((t) => t.status === 'failed'))) {
    const firstErr = nextShots.flatMap((s) => s.takes).find((t) => t.errorMessage)?.errorMessage
    throw new ApiError('EXTERNAL_ERROR', {
      message: `S5 批量视频提交全部失败：${firstErr || '请检查视频模型路由与算力余额'}`,
    })
  }

  const output = recomputeVideoGenArtifactCounts({
    modelKey: videoResolved.modelKey,
    aspectRatio,
    resolution,
    generateAudio,
    inputMode: defaultInputMode,
    shots: nextShots,
    readyCount: 0,
    totalCount: nextShots.length,
    pendingCount: 0,
    failedCount: 0,
  })

  return {
    output,
    taskIds,
    asyncPending: output.pendingCount > 0,
  }
}

// ============================================================
// Dual Async Task Status Sync (BOTH S3 TOOLBOX_IMAGE & S5 TOOLBOX_VIDEO)
// ============================================================

export function isTimedOutStageExecution(item: BatchItemDTO, stage: WorkflowStage, nowMs = Date.now()): boolean {
  const state = item.stageStates[stage]
  if (item.executionKey && state?.status === 'running') {
    const startedAtMs = state.startedAt ? Date.parse(state.startedAt) : Number.NaN
    return !Number.isFinite(startedAtMs) || nowMs - startedAtMs > WORKFLOW_STAGE_TIMEOUT_MS
  }
  return false
}

async function registerLateAsyncArtifact(params: {
  itemId: string
  workspaceOwnerId: string
  stage: 'asset_extraction' | 'video_gen'
  output: AssetsArtifact | VideoGenArtifact
  taskIds: string[]
}) {
  if (params.taskIds.length === 0) return
  const taskIdSet = new Set(params.taskIds)
  await updateBatchItemWithRetry(params.itemId, (latestRow) => {
    const current = mapBatchItemRow(latestRow)
    const taskIds = Array.from(new Set([...(current.stageStates[params.stage].taskIds || []), ...params.taskIds]))
    if (params.stage === 'video_gen') {
      const incoming = params.output as VideoGenArtifact
      const existing = current.stageOutputs.video_gen
      if (!existing) return {
        stageOutputs: { ...current.stageOutputs, video_gen: incoming },
        stageStates: { ...current.stageStates, video_gen: { ...current.stageStates.video_gen, taskIds } },
      }
      const incomingById = new Map(incoming.shots.map((shot) => [shot.shotId, shot]))
      const existingIds = new Set(existing.shots.map((shot) => shot.shotId))
      const shots = existing.shots.map((shot) => {
        const newTakes = incomingById.get(shot.shotId)?.takes.filter((take) => (!take.taskId || taskIdSet.has(take.taskId)) && !shot.takes.some((currentTake) => currentTake.takeIndex === take.takeIndex || (currentTake.taskId && currentTake.taskId === take.taskId))) || []
        return newTakes.length > 0 ? { ...shot, takes: [...shot.takes, ...newTakes] } : shot
      })
      for (const shot of incoming.shots) if (!existingIds.has(shot.shotId)) shots.push(shot)
      return {
        stageOutputs: { ...current.stageOutputs, video_gen: recomputeVideoGenArtifactCounts({ ...existing, shots }) },
        stageStates: { ...current.stageStates, video_gen: { ...current.stageStates.video_gen, taskIds } },
      }
    }
    const incoming = params.output as AssetsArtifact
    const existing = current.stageOutputs.asset_extraction
    if (!existing) return {
      stageOutputs: { ...current.stageOutputs, asset_extraction: incoming },
      stageStates: { ...current.stageStates, asset_extraction: { ...current.stageStates.asset_extraction, taskIds } },
    }
    const incomingById = new Map(incoming.items.map((asset) => [asset.id, asset]))
    const items = existing.items.map((asset) => {
      const newVersions = incomingById.get(asset.id)?.versions.filter((version) => (!version.taskId || taskIdSet.has(version.taskId)) && !asset.versions.some((currentVersion) => currentVersion.versionIndex === version.versionIndex || (version.taskId && currentVersion.taskId === version.taskId) || (version.toolboxAssetId && currentVersion.toolboxAssetId === version.toolboxAssetId))) || []
      return newVersions.length > 0 ? { ...asset, versions: [...asset.versions, ...newVersions] } : asset
    })
    return {
      stageOutputs: { ...current.stageOutputs, asset_extraction: recomputeAssetsArtifactCounts({ ...existing, items }) },
      stageStates: { ...current.stageStates, asset_extraction: { ...current.stageStates.asset_extraction, taskIds } },
    }
  }, { workspaceOwnerId: params.workspaceOwnerId })
}

export function buildTimeoutRecoveryPatch(item: BatchItemDTO, stage: WorkflowStage, finishedAt = new Date()): {
  currentStage: WorkflowStage
  status: 'failed'
  executionKey: null
  errorMessage: string
  stageStates: BatchItemDTO['stageStates']
} {
  const errorMessage = '执行超时或中断，可重试。'
  return {
    currentStage: stage,
    status: 'failed',
    executionKey: null,
    errorMessage,
    stageStates: {
      ...item.stageStates,
      [stage]: {
        ...item.stageStates[stage],
        status: 'failed',
        finishedAt: finishedAt.toISOString(),
        error: errorMessage,
      },
    },
  }
}

export async function syncBatchItemTaskStatuses(params: {
  workspaceOwnerId: string
  batchRunId: string
  itemId?: string
}): Promise<{ changed: boolean; hasPendingAsyncTasks: boolean }> {
  const run = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: {
      items: {
        where: params.itemId ? { id: params.itemId } : undefined,
        orderBy: { index: 'asc' },
      },
    },
  })
  if (!run || run.items.length === 0) {
    return { changed: false, hasPendingAsyncTasks: false }
  }

  const mappedRun = mapBatchRunRow(run)
  const items: BatchItemDTO[] = mappedRun.items || []
  const assetIds = new Set<string>()
  const taskIds = new Set<string>()
  const timedOutStages = new Map<string, WorkflowStage>()

  for (const item of items) {
    if (item.executionKey) {
      const stage = item.stageStates[item.currentStage]?.status === 'running'
        ? item.currentStage
        : WORKFLOW_STAGES.find((entry) => item.stageStates[entry].status === 'running')
      if (stage && isTimedOutStageExecution(item, stage)) timedOutStages.set(item.id, stage)
    }
    for (const asset of item.stageOutputs.asset_extraction?.items || []) {
      if (asset.toolboxAssetId) assetIds.add(asset.toolboxAssetId)
      if (asset.taskId) taskIds.add(asset.taskId)
      for (const ver of asset.versions || []) {
        if (ver.toolboxAssetId) assetIds.add(ver.toolboxAssetId)
        if (ver.taskId) taskIds.add(ver.taskId)
      }
    }
    for (const shot of item.stageOutputs.video_gen?.shots || []) {
      for (const take of shot.takes || []) {
        if (take.assetId) assetIds.add(take.assetId)
        if (take.taskId) taskIds.add(take.taskId)
      }
    }
  }

  const [dbAssets, dbTasks] = await Promise.all([
    assetIds.size > 0
      ? prisma.frameosToolboxAsset.findMany({
          where: { id: { in: Array.from(assetIds) } },
          select: { id: true, status: true, resultUrl: true, materialId: true, errorMessage: true, params: true, updatedAt: true },
        })
      : Promise.resolve([]),
    taskIds.size > 0
      ? prisma.task.findMany({
          where: { id: { in: Array.from(taskIds) } },
          select: { id: true, status: true, errorMessage: true, finishedAt: true },
        })
      : Promise.resolve([]),
  ])
  const dbAssetById = new Map(dbAssets.map((asset) => [asset.id, asset]))
  const dbTaskById = new Map(dbTasks.map((task) => [task.id, task]))

  let anyItemChanged = false
  const updatedItemsForPendingCheck: BatchItemDTO[] = []

  for (const initialItem of items) {
    let pendingItem = initialItem
    const updatedRow = await updateBatchItemWithRetry(initialItem.id, (latestRow) => {
      const item = mapBatchItemRow(latestRow)
      const nextOutputs: BatchItemStageOutputs = { ...item.stageOutputs }
      const nextStageStates = { ...item.stageStates }
      let nextCurrentStage = item.currentStage
      let nextItemStatus = item.status
      let nextErrorMessage = item.errorMessage
      let itemChanged = false

      const s3 = item.stageOutputs.asset_extraction
      if (s3 && Array.isArray(s3.items) && s3.items.length > 0) {
        let s3Changed = false
        const nextS3Items: WorkflowAssetItem[] = s3.items.map((asset) => {
          const nextVersions = (asset.versions || []).map((ver) => {
            if (ver.source !== 'generated' || (ver.status === 'ready' && Boolean(ver.imageUrl)) || ver.status === 'failed') return ver
            const dbAsset = ver.toolboxAssetId ? dbAssetById.get(ver.toolboxAssetId) : null
            const dbTask = ver.taskId ? dbTaskById.get(ver.taskId) : null
            let nextStatus: WorkflowAssetImageStatus = ver.status
            let nextUrl = ver.imageUrl ?? null
            let nextStorageKey = ver.storageKey ?? null
            let nextMaterialId = ver.materialId ?? null
            let nextErr = ver.errorMessage ?? null
            if (dbAsset) {
              if (dbAsset.status === 'ready' && dbAsset.resultUrl) {
                nextStatus = 'ready'
                nextUrl = dbAsset.resultUrl
                nextStorageKey = dbAsset.resultUrl
                nextMaterialId = dbAsset.materialId || nextMaterialId
                nextErr = null
              } else if (dbAsset.status === 'failed') {
                nextStatus = 'failed'
                nextErr = dbAsset.errorMessage || dbTask?.errorMessage || '资产出图失败'
              } else if (dbAsset.status === 'processing' || dbTask?.status === TASK_STATUS.PROCESSING) {
                nextStatus = 'processing'
              }
            } else if (dbTask) {
              if (dbTask.status === TASK_STATUS.FAILED || dbTask.status === TASK_STATUS.CANCELED) {
                nextStatus = 'failed'
                nextErr = dbTask.errorMessage || '图片任务失败'
              } else if (dbTask.status === TASK_STATUS.PROCESSING) {
                nextStatus = 'processing'
              }
            }
            if (nextStatus !== ver.status || nextUrl !== (ver.imageUrl ?? null)
              || nextMaterialId !== (ver.materialId ?? null) || nextErr !== (ver.errorMessage ?? null)) s3Changed = true
            return { ...ver, status: nextStatus, imageUrl: nextUrl, storageKey: nextStorageKey, materialId: nextMaterialId, errorMessage: nextErr }
          })
          const activeVer = nextVersions[asset.selectedVersionIndex] || nextVersions[nextVersions.length - 1]
          if (!activeVer) return { ...asset, versions: nextVersions }
          const nextAssetStatus = activeVer.status
          const nextImageUrl = activeVer.imageUrl ?? asset.imageUrl ?? null
          const nextStorageKey = activeVer.storageKey ?? asset.storageKey ?? null
          const nextMaterialId = activeVer.materialId ?? asset.materialId ?? null
          const nextErr = activeVer.errorMessage ?? null
          if (nextAssetStatus !== asset.status || nextImageUrl !== (asset.imageUrl ?? null)
            || nextMaterialId !== (asset.materialId ?? null) || nextErr !== (asset.errorMessage ?? null)) s3Changed = true
          return { ...asset, status: nextAssetStatus, imageUrl: nextImageUrl, storageKey: nextStorageKey, materialId: nextMaterialId, errorMessage: nextErr, versions: nextVersions }
        })
        if (s3Changed) {
          itemChanged = true
          const nextS3 = recomputeAssetsArtifactCounts({ ...s3, items: nextS3Items })
          nextOutputs.asset_extraction = nextS3
          const anyS3Active = nextS3.items.some((asset) => asset.status === 'queued' || asset.status === 'processing'
            || asset.versions.some((version) => version.status === 'queued' || version.status === 'processing'))
          if (!anyS3Active && nextStageStates.asset_extraction.status === 'running') {
            if (nextS3.failedCount > 0 && nextS3.readyCount === 0) {
              nextStageStates.asset_extraction = {
                ...nextStageStates.asset_extraction,
                status: 'failed',
                finishedAt: new Date().toISOString(),
                error: nextS3.items.find((asset) => asset.errorMessage)?.errorMessage || '资产出图全部失败',
              }
              nextCurrentStage = 'asset_extraction'
              nextItemStatus = 'failed'
              nextErrorMessage = nextStageStates.asset_extraction.error || null
            } else {
              const config = mappedRun.templateSnapshot.stages.find((entry) => entry.stage === 'asset_extraction')
              const requiresReview = mappedRun.runMode === 'gated' && config?.gateMode === 'manual_review'
              nextStageStates.asset_extraction = {
                ...nextStageStates.asset_extraction,
                status: requiresReview ? 'waiting_review' : 'completed',
                finishedAt: new Date().toISOString(),
                error: nextS3.failedCount > 0 ? `部分资产出图失败（${nextS3.readyCount}/${nextS3.totalCount} 就绪）` : null,
              }
              const nextStage = requiresReview ? null : getNextWorkflowStage('asset_extraction', mappedRun.templateSnapshot.stages)
              nextCurrentStage = requiresReview ? 'asset_extraction' : nextStage || 'asset_extraction'
              nextItemStatus = requiresReview ? 'waiting_review' : nextStage ? 'queued' : 'completed'
            }
          }
        }
      }

      const s5 = item.stageOutputs.video_gen
      if (s5 && Array.isArray(s5.shots) && s5.shots.length > 0) {
        let s5Changed = false
        const nextS5Shots: VideoGenShotEntry[] = s5.shots.map((shot) => {
          const nextTakes: VideoShotTake[] = (shot.takes || []).map((take) => {
            if ((take.status === 'ready' && Boolean(take.videoUrl)) || take.status === 'failed') return take
            const dbAsset = take.assetId ? dbAssetById.get(take.assetId) : null
            const dbTask = take.taskId ? dbTaskById.get(take.taskId) : null
            let nextStatus: VideoTakeStatus = take.status
            let nextUrl = take.videoUrl ?? null
            let nextStorageKey = take.storageKey ?? null
            let nextPoster = take.posterUrl ?? null
            let nextMaterialId = take.materialId ?? null
            let nextErr = take.errorMessage ?? null
            let nextCompletedAt = take.completedAt ?? null
            if (dbAsset) {
              const assetParams = asRecord(dbAsset.params)
              if (dbAsset.status === 'ready' && dbAsset.resultUrl) {
                nextStatus = 'ready'
                nextUrl = dbAsset.resultUrl
                nextStorageKey = dbAsset.resultUrl
                nextMaterialId = dbAsset.materialId || nextMaterialId
                nextPoster = typeof assetParams.thumbnailUrl === 'string' ? assetParams.thumbnailUrl : nextPoster
                nextErr = null
                nextCompletedAt = nextCompletedAt || dbAsset.updatedAt.toISOString()
              } else if (dbAsset.status === 'failed') {
                nextStatus = 'failed'
                nextErr = dbAsset.errorMessage || dbTask?.errorMessage || '视频生成失败'
              } else if (dbAsset.status === 'processing' || dbTask?.status === TASK_STATUS.PROCESSING) {
                nextStatus = 'processing'
              }
            } else if (dbTask) {
              if (dbTask.status === TASK_STATUS.FAILED || dbTask.status === TASK_STATUS.CANCELED) {
                nextStatus = 'failed'
                nextErr = dbTask.errorMessage || '视频任务失败'
              } else if (dbTask.status === TASK_STATUS.PROCESSING) {
                nextStatus = 'processing'
              }
            }
            if (nextStatus !== take.status || nextUrl !== (take.videoUrl ?? null)
              || nextMaterialId !== (take.materialId ?? null) || nextErr !== (take.errorMessage ?? null)) s5Changed = true
            return { ...take, status: nextStatus, videoUrl: nextUrl, storageKey: nextStorageKey, posterUrl: nextPoster, materialId: nextMaterialId, errorMessage: nextErr, completedAt: nextCompletedAt }
          })
          return { ...shot, takes: nextTakes }
        })
        if (s5Changed) {
          itemChanged = true
          const nextS5 = recomputeVideoGenArtifactCounts({ ...s5, shots: nextS5Shots })
          nextOutputs.video_gen = nextS5
          const anyS5Active = nextS5.shots.some((shot) => shot.takes.some((take) => take.status === 'queued' || take.status === 'processing'))
          if (!anyS5Active && nextStageStates.video_gen.status === 'running') {
            if (nextS5.failedCount > 0 && nextS5.readyCount === 0) {
              nextStageStates.video_gen = {
                ...nextStageStates.video_gen,
                status: 'failed',
                finishedAt: new Date().toISOString(),
                error: nextS5.shots.flatMap((shot) => shot.takes).find((take) => take.errorMessage)?.errorMessage || '视频生成失败',
              }
              nextCurrentStage = 'video_gen'
              nextItemStatus = 'failed'
              nextErrorMessage = nextStageStates.video_gen.error || null
            } else {
              const config = mappedRun.templateSnapshot.stages.find((entry) => entry.stage === 'video_gen')
              const requiresReview = mappedRun.runMode === 'gated' && config?.gateMode === 'manual_review'
              nextStageStates.video_gen = {
                ...nextStageStates.video_gen,
                status: requiresReview ? 'waiting_review' : 'completed',
                finishedAt: new Date().toISOString(),
                error: nextS5.failedCount > 0 ? `部分镜头失败（${nextS5.readyCount}/${nextS5.totalCount} 成功）` : null,
              }
              nextCurrentStage = 'video_gen'
              nextItemStatus = requiresReview ? 'waiting_review' : 'completed'
            }
          }
        }
      }

      const timeoutStage = timedOutStages.get(item.id)
      const settledAsyncStage = item.executionKey && (
        (nextStageStates.asset_extraction.status !== 'running' && nextOutputs.asset_extraction !== item.stageOutputs.asset_extraction)
        || (nextStageStates.video_gen.status !== 'running' && nextOutputs.video_gen !== item.stageOutputs.video_gen)
      ) ? item.currentStage : null
      let clearExecutionKey = Boolean(settledAsyncStage)
      if (settledAsyncStage) nextStageStates[settledAsyncStage] = { ...nextStageStates[settledAsyncStage], taskIds: [] }
      if (timeoutStage && timeoutStage !== 'asset_extraction' && timeoutStage !== 'video_gen') {
        if (isTimedOutStageExecution(item, timeoutStage)) {
          const recovery = buildTimeoutRecoveryPatch(item, timeoutStage)
          itemChanged = true
          nextCurrentStage = recovery.currentStage
          nextItemStatus = recovery.status
          nextErrorMessage = recovery.errorMessage
          nextStageStates[timeoutStage] = recovery.stageStates[timeoutStage]
          clearExecutionKey = true
        }
      } else if (timeoutStage) {
        const runningTask = item.stageStates[timeoutStage].taskIds
          ?.map((taskId) => dbTaskById.get(taskId))
          .find((task) => task?.status === TASK_STATUS.QUEUED || task?.status === TASK_STATUS.PROCESSING)
        if (!runningTask) {
          const recovery = buildTimeoutRecoveryPatch(item, timeoutStage)
          itemChanged = true
          nextCurrentStage = recovery.currentStage
          nextItemStatus = recovery.status
          nextErrorMessage = recovery.errorMessage
          nextStageStates[timeoutStage] = recovery.stageStates[timeoutStage]
          clearExecutionKey = true
        }
      }

      pendingItem = {
        ...item,
        currentStage: nextCurrentStage,
        status: nextItemStatus,
        errorMessage: nextErrorMessage,
        stageOutputs: nextOutputs,
        stageStates: nextStageStates,
        ...(clearExecutionKey ? { executionKey: null } : {}),
      }
      if (!itemChanged) return null
      return {
        currentStage: nextCurrentStage,
        status: nextItemStatus,
        stageStates: nextStageStates,
        stageOutputs: nextOutputs,
        errorMessage: nextErrorMessage,
        ...(clearExecutionKey ? { executionKey: null } : {}),
      }
    }, { workspaceOwnerId: params.workspaceOwnerId })
    if (updatedRow.revision !== initialItem.revision) anyItemChanged = true
    updatedItemsForPendingCheck.push(pendingItem)
  }

  if (anyItemChanged) await recomputeBatchRunSummary(run.id)
  return {
    changed: anyItemChanged,
    hasPendingAsyncTasks: hasBatchRunPendingAsyncTasks(updatedItemsForPendingCheck),
  }
}

// ============================================================
// Public Stage Execution, Asset & Take Operations, Trial & AI Refine
// ============================================================

export type RunBatchItemStageParams = {
  workspaceOwnerId: string
  actorId: string
  batchRunId: string
  itemId: string
  stage: WorkflowStage
  skillIdOverride?: string | null
  skillSlugOverride?: string | null
  stageParamsOverride?: StageParams | null
  forceRerun?: boolean
  regenerateAll?: boolean
  shotIds?: string[]
  shotOverrides?: Record<string, VideoGenShotOverride>
  pastedScript?: string | null
  targetStage?: WorkflowStage | null
  sourceVideoMaterialId?: string | null
  sourceVideoStorageKey?: string | null
  sourceVideoUrl?: string | null
  sourceVideoFileName?: string | null
  locale?: 'zh' | 'en'
  expectedRevision?: number
  executionKey?: string
  taskId?: string
}

export type RunBatchItemStageResult = {
  item: BatchItemDTO
  run: BatchRunDTO
  stage: WorkflowStage
  outcome: 'completed' | 'waiting_review' | 'failed' | 'running' | 'skipped'
}

function createWorkflowExecutionKey(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export async function runBatchItemStage(params: RunBatchItemStageParams): Promise<RunBatchItemStageResult> {
  if (!isWorkflowStage(params.stage)) {
    throw new ApiError('INVALID_PARAMS', { message: `无效的阶段标识：${String(params.stage)}` })
  }
  const runRow = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!runRow) throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  const run = mapBatchRunRow(runRow)
  let item = (run.items || []).find((entry) => entry.id === params.itemId)
  if (!item) throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  const isWorkerExecution = Boolean(params.executionKey && params.taskId)

  if (isWorkerExecution) {
    if (item.executionKey !== params.executionKey) return { item, run, stage: params.stage, outcome: 'skipped' }
    const taskId = item.stageStates[params.stage].taskIds?.[0]
    if (taskId && taskId !== params.taskId) return { item, run, stage: params.stage, outcome: 'skipped' }
  }

  if (params.stage === 'video_gen') {
    const previous = item.stageOutputs.video_gen
    const hasReady = previous?.shots.some((shot) => shot.takes.some((take) => take.status === 'ready'))
    if (hasReady && !(params.shotIds && params.shotIds.length > 0) && params.regenerateAll !== true) {
      throw new ApiError('INVALID_PARAMS', { message: '已有可用视频时默认不重复扣费；请用 shotIds 指定重抽镜头，或显式 regenerateAll: true 全量重抽。' })
    }
  }

  if (params.stage === 'script_analysis' && (
    params.pastedScript !== undefined || params.sourceVideoMaterialId !== undefined
    || params.sourceVideoStorageKey !== undefined || params.sourceVideoUrl !== undefined
    || params.sourceVideoFileName !== undefined
  )) {
    const hasIncomingVideo = Boolean(cleanText(params.sourceVideoMaterialId)
      || cleanText(params.sourceVideoStorageKey) || cleanText(params.sourceVideoUrl))
    const switchingToPastedScript = params.pastedScript !== undefined && Boolean(cleanText(params.pastedScript)) && !hasIncomingVideo
    const nextInput = normalizeBatchItemInputPayload({
      ...item.inputPayload,
      ...(switchingToPastedScript ? {
        sourceType: 'pasted_script' as const,
        pastedScript: params.pastedScript,
        skipVideoAnalysis: true,
        sourceVideoMaterialId: null,
        sourceVideoStorageKey: null,
        sourceVideoUrl: null,
        sourceVideoFileName: null,
        sourceVideoDurationSec: null,
      } : params.pastedScript !== undefined ? {
        pastedScript: params.pastedScript,
        skipVideoAnalysis: Boolean(params.pastedScript && !hasIncomingVideo),
      } : {}),
      ...(params.sourceVideoMaterialId !== undefined ? { sourceVideoMaterialId: params.sourceVideoMaterialId, skipVideoAnalysis: false } : {}),
      ...(params.sourceVideoStorageKey !== undefined ? { sourceVideoStorageKey: params.sourceVideoStorageKey, skipVideoAnalysis: false } : {}),
      ...(params.sourceVideoUrl !== undefined ? { sourceVideoUrl: params.sourceVideoUrl } : {}),
      ...(params.sourceVideoFileName !== undefined ? { sourceVideoFileName: params.sourceVideoFileName } : {}),
    })
    const inputRow = isWorkerExecution
      ? await updateBatchItemWithRetry(item.id, (latest) => ({ inputPayload: normalizeBatchItemInputPayload({ ...asRecord(latest.inputPayload), ...nextInput }) }), { workspaceOwnerId: params.workspaceOwnerId })
      : await updateBatchItemForUser({
          itemId: item.id,
          expectedRevision: params.expectedRevision ?? item.revision ?? 0,
          patch: { inputPayload: nextInput },
          workspaceOwnerId: params.workspaceOwnerId,
        })
    item = mapBatchItemRow(inputRow)
  }

  const stageConfig = run.templateSnapshot.stages.find((entry) => entry.stage === params.stage) || {
    stage: params.stage,
    label: WORKFLOW_STAGE_META[params.stage].label,
    skillSlug: '',
    gateMode: WORKFLOW_STAGE_META[params.stage].defaultGateMode,
    enabled: true,
  }
  if (stageConfig.enabled === false) {
    const skippedRow = await updateBatchItemWithRetry(item.id, (latest) => {
      const current = mapBatchItemRow(latest)
      const nextStage = getNextWorkflowStage(params.stage, run.templateSnapshot.stages)
      return {
        currentStage: nextStage || params.stage,
        status: nextStage ? 'queued' : 'completed',
        stageStates: {
          ...current.stageStates,
          [params.stage]: { ...current.stageStates[params.stage], status: 'skipped', finishedAt: new Date().toISOString(), stale: false, staleReason: null },
        },
      }
    }, { workspaceOwnerId: params.workspaceOwnerId })
    return { item: mapBatchItemRow(skippedRow), run: (await recomputeBatchRunSummary(run.id)) || run, stage: params.stage, outcome: 'skipped' }
  }

  const skill = await resolveWorkflowSkill({
    workspaceOwnerId: params.workspaceOwnerId,
    skillId: params.skillIdOverride ?? stageConfig.skillId,
    skillSlug: params.skillSlugOverride ?? (params.skillIdOverride ? undefined : stageConfig.skillSlug),
    track: run.track,
    stage: params.stage,
  })
  const mergedStageParams = {
    ...asRecord(skill.modelPreferences?.defaultStageParams),
    ...asRecord(stageConfig.options),
    ...asRecord(run.templateSnapshot.stageParams?.[params.stage]),
    ...asRecord(params.stageParamsOverride),
  }
  const startedAtIso = item.stageStates[params.stage].startedAt || new Date().toISOString()
  let executionKey = item.executionKey

  if (!isWorkerExecution) {
    if (typeof params.expectedRevision === 'number' && params.expectedRevision !== (item.revision ?? 0)) {
      throw new ApiError('STALE_REVISION', {
        message: '工作流条目已被更新，请刷新后重试。',
        itemId: item.id,
        expectedRevision: params.expectedRevision,
      })
    }
    const previousTaskIds = item.stageStates[params.stage].taskIds || []
    const previousTaskId = previousTaskIds[0]
    if (item.executionKey && item.stageStates[params.stage].status === 'running') {
      const previousTask = previousTaskId
        ? await prisma.task.findUnique({ where: { id: previousTaskId }, select: { id: true, status: true } })
        : null
      if (previousTask && (previousTask.status === TASK_STATUS.QUEUED || previousTask.status === TASK_STATUS.PROCESSING) && !isTimedOutStageExecution(item, params.stage)) {
        throw new ApiError('STAGE_ALREADY_RUNNING', { message: '该条目当前环节正在执行，请等待完成。', itemId: item.id })
      }
      const recovered = await updateBatchItemWithRetry(item.id, (latest) => {
        const current = mapBatchItemRow(latest)
        return current.executionKey && isTimedOutStageExecution(current, params.stage)
          ? buildTimeoutRecoveryPatch(current, params.stage)
          : null
      }, { workspaceOwnerId: params.workspaceOwnerId })
      item = mapBatchItemRow(recovered)
      if (item.executionKey && item.stageStates[params.stage].status === 'running') {
        throw new ApiError('STAGE_ALREADY_RUNNING', { message: '该条目当前环节正在执行，请等待完成。', itemId: item.id })
      }
    }
    executionKey = createWorkflowExecutionKey()
    const expectedRevision = item.revision ?? 0
    const queuedRow = await updateBatchItemForUser({
      itemId: item.id,
      expectedRevision,
      workspaceOwnerId: params.workspaceOwnerId,
      patch: {
        status: 'running',
        currentStage: params.stage,
        errorMessage: null,
        executionKey,
        stageStates: {
          ...item.stageStates,
          [params.stage]: {
            ...item.stageStates[params.stage],
            status: 'running',
            skillSlug: skill.slug,
            skillId: skill.id,
            skillName: skill.name,
            skillVersion: skill.version,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            attempt: 0,
            qcStatus: undefined,
            modelKey: undefined,
            taskIds: [],
            error: null,
          },
        },
      },
    })
    item = mapBatchItemRow(queuedRow)
    try {
      if (params.stage !== 'video_gen') {
        const submitted = await submitTask({
          userId: params.workspaceOwnerId,
          locale: params.locale || 'zh',
          projectId: run.projectId,
          type: TASK_TYPE.WORKFLOW_STAGE_RUN,
          targetType: 'BatchItem',
          targetId: item.id,
          payload: {
            batchRunId: run.id,
            itemId: item.id,
            stage: params.stage,
            executionKey,
            actorId: params.actorId,
            skillIdOverride: params.skillIdOverride || null,
            skillSlugOverride: params.skillSlugOverride || null,
            stageParamsOverride: params.stageParamsOverride || null,
            targetStage: params.targetStage || null,
            personalOwnerId: params.actorId,
          },
          dedupeKey: `${TASK_TYPE.WORKFLOW_STAGE_RUN}:${item.id}:${executionKey}`,
          maxAttempts: 1,
        })
        const taskRow = await updateBatchItemWithRetry(item.id, (latest) => {
          const current = mapBatchItemRow(latest)
          if (current.executionKey !== executionKey) return null
          return { stageStates: { ...current.stageStates, [params.stage]: { ...current.stageStates[params.stage], taskIds: [submitted.taskId] } } }
        }, { workspaceOwnerId: params.workspaceOwnerId })
        item = mapBatchItemRow(taskRow)
        return { item, run: (await recomputeBatchRunSummary(run.id)) || run, stage: params.stage, outcome: 'running' }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedRow = await updateBatchItemWithRetry(item.id, (latest) => {
        const current = mapBatchItemRow(latest)
        if (current.executionKey !== executionKey) return null
        return {
          currentStage: params.stage,
          status: 'failed',
          executionKey: null,
          errorMessage: message,
          stageStates: { ...current.stageStates, [params.stage]: { ...current.stageStates[params.stage], status: 'failed', finishedAt: new Date().toISOString(), error: message } },
        }
      }, { workspaceOwnerId: params.workspaceOwnerId })
      const failedItem = mapBatchItemRow(failedRow)
      return { item: failedItem, run: (await recomputeBatchRunSummary(run.id)) || run, stage: params.stage, outcome: 'failed' }
    }
  }

  const startedAtMs = Date.parse(startedAtIso)
  const executionMeta: WorkflowStageExecutionMeta = {}
  try {
    let stageOutput: unknown
    let asyncPending = false
    let taskIds: string[] | undefined
    if (params.stage === 'script_analysis') {
      stageOutput = await executeStage1ScriptAnalysisCore({ workspaceOwnerId: params.workspaceOwnerId, item, skill, stageParams: mergedStageParams as ScriptAnalysisStageParams, executionMeta })
    } else if (params.stage === 'script_rewrite') {
      stageOutput = await executeStage2ScriptRewriteCore({ workspaceOwnerId: params.workspaceOwnerId, actorId: params.actorId, projectId: run.projectId, modelConfig: run.modelConfig, item, skill, stageParams: mergedStageParams as ScriptRewriteStageParams, stageModelOverride: stageConfig.modelKey, executionMeta })
    } else if (params.stage === 'asset_extraction') {
      const s3Params = mergedStageParams as AssetExtractionStageParams
      let extracted = await executeStage3AssetExtractLlmCore({ workspaceOwnerId: params.workspaceOwnerId, actorId: params.actorId, projectId: run.projectId, modelConfig: run.modelConfig, item, skill, stageParams: s3Params, stageModelOverride: stageConfig.modelKey, executionMeta })
      const hasPendingImageAssets = extracted.items.some((asset) => asset.status === 'pending')
      if ((run.runMode === 'auto' || s3Params.autoGenerateImages === true) && hasPendingImageAssets) {
        const s3b = await submitStage3AssetImageTasks({ workspaceOwnerId: params.workspaceOwnerId, actorId: params.actorId, projectId: run.projectId, item, artifact: extracted, modelConfig: run.modelConfig, locale: params.locale || 'zh' })
        if (s3b.submittedCount === 0 && s3b.failedCount > 0 && s3b.artifact.readyCount === 0) {
          throw new ApiError('EXTERNAL_ERROR', { message: `自动资产出图提交失败：${s3b.artifact.items.find((asset) => asset.errorMessage)?.errorMessage || '请检查图片模型配置与算力余额'}` })
        }
        extracted = s3b.artifact
        taskIds = s3b.taskIds
        asyncPending = extracted.items.some((asset) => asset.status === 'queued' || asset.status === 'processing' || asset.versions.some((version) => version.status === 'queued' || version.status === 'processing'))
      }
      stageOutput = extracted
    } else if (params.stage === 'storyboard') {
      stageOutput = await executeStage4StoryboardCore({ workspaceOwnerId: params.workspaceOwnerId, actorId: params.actorId, projectId: run.projectId, modelConfig: run.modelConfig, item, skill, stageParams: mergedStageParams as StoryboardStageParams, stageModelOverride: stageConfig.modelKey, executionMeta })
    } else {
      const result = await executeStage5VideoGenCore({ workspaceOwnerId: params.workspaceOwnerId, actorId: params.actorId, projectId: run.projectId, item, skill, stageConfig, modelConfig: run.modelConfig, stageParams: mergedStageParams as VideoGenStageParams, shotIds: params.shotIds, forceRerun: params.forceRerun, regenerateAll: params.regenerateAll, shotOverrides: params.shotOverrides, locale: params.locale || 'zh' })
      stageOutput = result.output
      taskIds = result.taskIds
      asyncPending = result.asyncPending
    }

    const finishedAtIso = new Date().toISOString()
    const durationMs = Math.max(1, Date.now() - startedAtMs)
    const isPastedScriptS1 = params.stage === 'script_analysis' && asRecord(stageOutput).sourceMode === 'pasted_script'
    const requestedTargetStage = isPastedScriptS1
      ? (params.targetStage && isWorkflowStage(params.targetStage) ? params.targetStage : null)
        || (isWorkflowStage(mergedStageParams.targetStage) ? mergedStageParams.targetStage as WorkflowStage : null)
        || 'script_rewrite'
      : null
    let staleStageWrite = false
    const savedRow = await updateBatchItemWithRetry(item.id, (latest) => {
      const current = mapBatchItemRow(latest)
      if (current.executionKey !== executionKey || current.stageStates[params.stage].status !== 'running') {
        staleStageWrite = true
        return null
      }
      const transition = applyStageOutcomeToItemState({
        item: current,
        stage: params.stage,
        runMode: run.runMode,
        templateStages: run.templateSnapshot.stages,
        skill,
        stageOutput: params.stage === 'video_gen' ? (() => {
          const nextVideo = stageOutput as VideoGenArtifact
          const currentVideo = current.stageOutputs.video_gen
          const currentById = new Map(currentVideo?.shots.map((shot) => [shot.shotId, shot]))
          return {
            ...nextVideo,
            shots: nextVideo.shots.map((resultShot) => {
              const latestShot = currentById.get(resultShot.shotId)
              if (!latestShot) return resultShot
              const resultTakes = resultShot.takes.filter((take) => !latestShot.takes.some((currentTake) => currentTake.takeIndex === take.takeIndex || currentTake.taskId && currentTake.taskId === take.taskId))
              const takes = [...latestShot.takes, ...resultTakes]
              return {
                ...resultShot,
                takes,
                selectedTakeIndex: resultTakes.length === 0
                  ? latestShot.selectedTakeIndex
                  : resultShot.selectedTakeIndex >= 0
                    ? takes.length - resultTakes.length + resultShot.selectedTakeIndex
                    : latestShot.selectedTakeIndex,
              }
            }),
          }
        })() : stageOutput,
        startedAtIso,
        finishedAtIso,
        durationMs,
        asyncPending,
        taskIds,
        executionMeta,
        ...(isPastedScriptS1 ? { skipReview: true, nextStageOverride: requestedTargetStage } : {}),
      })
      return {
        ...(isPastedScriptS1 ? { inputPayload: normalizeBatchItemInputPayload({ ...current.inputPayload, sourceType: 'pasted_script', skipVideoAnalysis: true }) } : {}),
        currentStage: transition.currentStage,
        status: transition.status,
        stageStates: transition.stageStates,
        stageOutputs: transition.stageOutputs,
        errorMessage: transition.errorMessage,
        ...(!asyncPending ? { executionKey: null } : {}),
      }
    }, { workspaceOwnerId: params.workspaceOwnerId })
    const savedItem = mapBatchItemRow(savedRow)
    if (staleStageWrite && (params.stage === 'asset_extraction' || params.stage === 'video_gen') && taskIds?.length) {
      await registerLateAsyncArtifact({ itemId: item.id, workspaceOwnerId: params.workspaceOwnerId, stage: params.stage, output: stageOutput as AssetsArtifact | VideoGenArtifact, taskIds })
    }
    if (staleStageWrite) {
      const latestItem = mapBatchItemRow(await readBatchItemRow(item.id, params.workspaceOwnerId) || savedRow)
      return { item: latestItem, run: (await recomputeBatchRunSummary(run.id)) || run, stage: params.stage, outcome: 'skipped' }
    }
    if (savedItem.revision === item.revision || (savedItem.executionKey === executionKey && savedItem.stageStates[params.stage].status === 'running' && !asyncPending)) {
      return { item: savedItem, run: (await recomputeBatchRunSummary(run.id)) || run, stage: params.stage, outcome: 'skipped' }
    }
    const outcome = asyncPending ? 'running' : savedItem.stageStates[params.stage].status === 'waiting_review' ? 'waiting_review' : 'completed'
    return { item: savedItem, run: (await recomputeBatchRunSummary(run.id)) || run, stage: params.stage, outcome }
  } catch (error) {
    const message = error instanceof ApiError && error.code === 'QC_FAILED'
      ? '质量检查失败'
      : error instanceof Error ? error.message : String(error)
    const qc = error instanceof ApiError && error.code === 'QC_FAILED' ? asRecord(error.details || {}).qc : null
    const failedRow = await updateBatchItemWithRetry(item.id, (latest) => {
      const current = mapBatchItemRow(latest)
      if (current.executionKey !== executionKey || current.stageStates[params.stage].status !== 'running') return null
      return {
        currentStage: params.stage,
        status: 'failed',
        executionKey: null,
        errorMessage: message,
        stageStates: {
          ...current.stageStates,
          [params.stage]: {
            ...current.stageStates[params.stage],
            skillId: skill.id,
            skillName: skill.name,
            skillVersion: skill.version,
            status: 'failed',
            finishedAt: new Date().toISOString(),
            durationMs: Math.max(1, Date.now() - startedAtMs),
            ...(qc ? { qcStatus: 'failed' } : {}),
            ...(executionMeta.modelKey ? { modelKey: executionMeta.modelKey } : {}),
            ...(executionMeta.qcReport ? { attempt: executionMeta.qcReport.retryCount + 1 } : {}),
            error: message,
          },
        },
      }
    }, { workspaceOwnerId: params.workspaceOwnerId })
    return { item: mapBatchItemRow(failedRow), run: (await recomputeBatchRunSummary(run.id)) || run, stage: params.stage, outcome: 'failed' }
  }
}

/**
 * S3B: Batch or single-asset image generation (`TASK_TYPE.TOOLBOX_IMAGE`).
 * Supports selective `assetItemIds[]` re-roll (appends to `asset.versions[]`) or batch-generating all pending/failed assets.
 */
export async function generateBatchItemAssets(params: {
  workspaceOwnerId: string
  actorId: string
  batchRunId: string
  itemId: string
  assetItemIds?: string[]
  imageModelKeyOverride?: string | null
  resolutionOverride?: string | null
  qualityOverride?: ImageQualityLevel | null
  locale?: 'zh' | 'en'
  expectedRevision?: number
}): Promise<{
  item: BatchItemDTO
  run: BatchRunDTO
  submittedCount: number
  failedCount: number
  taskIds: string[]
}> {
  const runRow = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!runRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  const run = mapBatchRunRow(runRow)
  const item = (run.items || []).find((row) => row.id === params.itemId)
  if (!item) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  }
  const s3 = item.stageOutputs.asset_extraction
  if (!s3 || !Array.isArray(s3.items) || s3.items.length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: '请先执行 S3 资产解析提取资产清单，再批量出图。' })
  }

  const result = await submitStage3AssetImageTasks({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    projectId: run.projectId,
    item,
    artifact: s3,
    modelConfig: run.modelConfig,
    assetItemIds: params.assetItemIds,
    imageModelKeyOverride: params.imageModelKeyOverride,
    resolutionOverride: params.resolutionOverride,
    qualityOverride: params.qualityOverride,
    locale: params.locale || 'zh',
  })

  if (result.submittedCount === 0 && result.failedCount > 0) {
    const firstErr = result.artifact.items.find((a) => a.errorMessage)?.errorMessage
    throw new ApiError('EXTERNAL_ERROR', {
      message: `资产出图提交失败：${firstErr || '请检查图片模型配置与算力余额'}`,
    })
  }

  const anyActive = result.artifact.items.some((a) => a.status === 'queued' || a.status === 'processing')

  const updatedItemRow = await updateBatchItemWithRetry(item.id, (latest) => {
    const current = mapBatchItemRow(latest)
    const states = markDownstreamStagesStale(current.stageStates, 'asset_extraction', 'S3 视觉资产已重新出图，建议检查下游分镜与视频')
    states.asset_extraction = {
      ...states.asset_extraction,
      status: anyActive ? 'running' : states.asset_extraction.status,
      taskIds: Array.from(new Set([...(states.asset_extraction.taskIds || []), ...result.taskIds])),
      error: null,
    }
    return {
      status: anyActive ? 'running' : current.status,
      stageStates: states,
      stageOutputs: {
        ...current.stageOutputs,
        asset_extraction: {
          ...result.artifact,
          items: result.artifact.items.map((resultAsset) => {
            const currentAsset = current.stageOutputs.asset_extraction?.items.find((asset) => asset.id === resultAsset.id)
            if (!currentAsset) return resultAsset
            if (!resultAsset.toolboxAssetId || resultAsset.toolboxAssetId === currentAsset.toolboxAssetId) {
              return { ...currentAsset, imagePrompt: resultAsset.imagePrompt, status: resultAsset.status, errorMessage: resultAsset.errorMessage }
            }
            const resultVersion = resultAsset.versions.at(-1)
            if (!resultVersion || currentAsset.versions.some((version) => version.toolboxAssetId === resultVersion.toolboxAssetId)) return currentAsset
            const versions = [...currentAsset.versions, resultVersion]
            return { ...currentAsset, imagePrompt: resultAsset.imagePrompt, status: resultAsset.status, toolboxAssetId: resultAsset.toolboxAssetId, taskId: resultAsset.taskId, errorMessage: resultAsset.errorMessage, versions, selectedVersionIndex: versions.length - 1 }
          }),
        },
      },
    }
  }, { workspaceOwnerId: params.workspaceOwnerId })

  const updatedRun = (await recomputeBatchRunSummary(run.id)) || run
  return {
    item: mapBatchItemRow(updatedItemRow),
    run: updatedRun,
    submittedCount: result.submittedCount,
    failedCount: result.failedCount,
    taskIds: result.taskIds,
  }
}

/**
 * S3 manual material binding, version switching, and character voice binding!
 */
export async function bindBatchItemAssetMaterial(params: {
  workspaceOwnerId: string
  batchRunId: string
  itemId: string
  assetItemId: string
  materialId?: string | null
  voiceMaterialId?: string | null
  clearVoice?: boolean
  selectVersionIndex?: number | null
  expectedRevision?: number
}): Promise<{ item: BatchItemDTO; run: BatchRunDTO }> {
  const runRow = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!runRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  const run = mapBatchRunRow(runRow)
  const item = (run.items || []).find((row) => row.id === params.itemId)
  if (!item) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  }
  const s3 = item.stageOutputs.asset_extraction
  if (!s3 || !Array.isArray(s3.items)) {
    throw new ApiError('INVALID_PARAMS', { message: '尚未生成 S3 资产清单。' })
  }
  const assetIdx = s3.items.findIndex((a) => a.id === params.assetItemId)
  if (assetIdx === -1) {
    throw new ApiError('NOT_FOUND', { message: `未找到资产项：${params.assetItemId}` })
  }

  const workspaceUsers = await prisma.user.findMany({
    where: workspaceUserWhere(params.workspaceOwnerId),
    select: { id: true },
  })
  const workspaceUserIds = workspaceUsers.map((u) => u.id)

  let targetAsset = { ...s3.items[assetIdx] }

  if (typeof params.selectVersionIndex === 'number' && Number.isInteger(params.selectVersionIndex)) {
    const ver = targetAsset.versions[params.selectVersionIndex]
    if (!ver) {
      throw new ApiError('INVALID_PARAMS', { message: '所选资产版本索引无效。' })
    }
    if (ver.status !== 'ready' && ver.status !== 'reused') {
      throw new ApiError('ASSET_NOT_READY', { message: '仅可采纳已就绪或已复用的资产版本。', assetItemId: params.assetItemId, versionIndex: params.selectVersionIndex })
    }
    if (!cleanText(ver.imageUrl)) {
      throw new ApiError('ASSET_NOT_READY', { message: '所选资产版本缺少可用图片地址。', assetItemId: params.assetItemId, versionIndex: params.selectVersionIndex })
    }
    targetAsset = {
      ...targetAsset,
      selectedVersionIndex: params.selectVersionIndex,
      materialId: ver.materialId ?? null,
      imageUrl: ver.imageUrl ?? null,
      storageKey: ver.storageKey ?? null,
      status: ver.status,
      errorMessage: ver.errorMessage ?? null,
    }
  }

  if (params.materialId) {
    const mat = await prisma.frameosMaterial.findFirst({
      where: {
        id: params.materialId,
        userId: { in: workspaceUserIds },
        type: 'image',
        status: 'ready',
        deletedAt: null,
      },
      select: { id: true, title: true, resultUrl: true, storageKey: true, metadata: true },
    })
    if (!mat) {
      throw new ApiError('NOT_FOUND', { message: '所选图片素材不存在、未就绪或无权访问。' })
    }
    const nextVersionIndex = targetAsset.versions.reduce((max, v) => Math.max(max, v.versionIndex), 0) + 1
    const boundVersion: WorkflowAssetImageVersion = {
      versionIndex: nextVersionIndex,
      materialId: mat.id,
      toolboxAssetId: null,
      taskId: null,
      imageUrl: mat.resultUrl || mat.storageKey || null,
      storageKey: mat.storageKey || null,
      prompt: targetAsset.imagePrompt,
      modelKey: null,
      aspectRatio: targetAsset.aspectRatio,
      resolution: null,
      source: 'manual_bound',
      status: 'ready',
      errorMessage: null,
      createdAt: new Date().toISOString(),
    }
    const nextVersions = [...targetAsset.versions, boundVersion]
    targetAsset = {
      ...targetAsset,
      materialId: mat.id,
      imageUrl: mat.resultUrl || mat.storageKey || null,
      storageKey: mat.storageKey || null,
      status: 'ready',
      errorMessage: null,
      versions: nextVersions,
      selectedVersionIndex: nextVersions.length - 1,
    }
  }

  if (params.clearVoice) {
    targetAsset = {
      ...targetAsset,
      voiceMaterialId: null,
      voiceMaterialTitle: null,
      voiceMaterialUrl: null,
    }
  } else if (params.voiceMaterialId) {
    if (targetAsset.kind !== 'character') {
      throw new ApiError('INVALID_PARAMS', { message: '仅角色（character）资产支持绑定音色素材。' })
    }
    const voiceMat = await prisma.frameosMaterial.findFirst({
      where: {
        id: params.voiceMaterialId,
        userId: { in: workspaceUserIds },
        type: 'audio',
        status: 'ready',
        deletedAt: null,
      },
      select: { id: true, title: true, resultUrl: true, storageKey: true },
    })
    if (!voiceMat) {
      throw new ApiError('NOT_FOUND', { message: '所选音色素材不存在、未就绪或无权访问。' })
    }
    targetAsset = {
      ...targetAsset,
      voiceMaterialId: voiceMat.id,
      voiceMaterialTitle: voiceMat.title || '角色绑定音色',
      voiceMaterialUrl: voiceMat.resultUrl || voiceMat.storageKey || null,
    }
  }

  const nextItems = [...s3.items]
  nextItems[assetIdx] = targetAsset
  const nextS3 = recomputeAssetsArtifactCounts({ ...s3, items: nextItems })
  const nextStageStates = markDownstreamStagesStale(
    item.stageStates,
    'asset_extraction',
    `S3 资产「${targetAsset.name}」素材或音色绑定已更新`,
  )

  const updatedItemRow = await updateBatchItemForUser({
    itemId: item.id,
    expectedRevision: params.expectedRevision ?? item.revision ?? 0,
    workspaceOwnerId: params.workspaceOwnerId,
    patch: {
      stageStates: nextStageStates,
      stageOutputs: { ...item.stageOutputs, asset_extraction: nextS3 },
    },
  })

  const updatedRun = (await recomputeBatchRunSummary(run.id)) || run
  return {
    item: mapBatchItemRow(updatedItemRow),
    run: updatedRun,
  }
}

/**
 * S5 multi-take selection (`selectShotTake`).
 */
export async function selectShotTake(params: {
  workspaceOwnerId: string
  batchRunId: string
  itemId: string
  shotId: string
  takeIndex: number
  expectedRevision?: number
}): Promise<{ item: BatchItemDTO; run: BatchRunDTO }> {
  const runRow = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!runRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  const run = mapBatchRunRow(runRow)
  const item = (run.items || []).find((row) => row.id === params.itemId)
  if (!item) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  }
  const s5 = item.stageOutputs.video_gen
  if (!s5 || !Array.isArray(s5.shots)) {
    throw new ApiError('INVALID_PARAMS', { message: '尚未生成 S5 视频镜头。' })
  }
  const shotIdx = s5.shots.findIndex((sh) => sh.shotId === params.shotId)
  if (shotIdx === -1) {
    throw new ApiError('NOT_FOUND', { message: `未找到镜头：${params.shotId}` })
  }
  const shot = s5.shots[shotIdx]
  if (!Number.isInteger(params.takeIndex) || params.takeIndex < 0 || params.takeIndex >= shot.takes.length) {
    throw new ApiError('INVALID_PARAMS', { message: '所选 Take 索引超出范围。' })
  }

  const take = shot.takes[params.takeIndex]
  if (take.status !== 'ready' || !cleanText(take.videoUrl)) {
    throw new ApiError('ASSET_NOT_READY', { message: '仅可采纳已就绪且包含视频地址的 Take。', shotId: params.shotId, takeIndex: params.takeIndex })
  }

  const nextShots = [...s5.shots]
  nextShots[shotIdx] = { ...shot, selectedTakeIndex: params.takeIndex }
  const nextS5 = recomputeVideoGenArtifactCounts({ ...s5, shots: nextShots })

  const updatedItemRow = await updateBatchItemForUser({
    itemId: item.id,
    expectedRevision: params.expectedRevision ?? item.revision ?? 0,
    workspaceOwnerId: params.workspaceOwnerId,
    patch: {
      stageOutputs: { ...item.stageOutputs, video_gen: nextS5 },
    },
  })

  const updatedRun = (await recomputeBatchRunSummary(run.id)) || run
  return {
    item: mapBatchItemRow(updatedItemRow),
    run: updatedRun,
  }
}

/**
 * Convenience wrapper for S5 single-shot or multi-shot re-roll (appends new Take to takes[]).
 */
export async function generateBatchItemVideos(params: {
  workspaceOwnerId: string
  actorId: string
  batchRunId: string
  itemId: string
  shotIds?: string[]
  forceRerun?: boolean
  regenerateAll?: boolean
  expectedRevision?: number
  shotOverrides?: Record<string, VideoGenShotOverride>
  locale?: 'zh' | 'en'
}) {
  return await runBatchItemStage({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    batchRunId: params.batchRunId,
    itemId: params.itemId,
    stage: 'video_gen',
    shotIds: params.shotIds,
    forceRerun: params.regenerateAll === true || params.forceRerun,
    regenerateAll: params.regenerateAll,
    shotOverrides: params.shotOverrides,
    expectedRevision: params.expectedRevision,
    locale: params.locale,
  })
}

export async function reviewBatchItemStage(params: {
  workspaceOwnerId: string
  batchRunId: string
  itemId: string
  stage: WorkflowStage
  action: 'approve' | 'reject' | 'save_draft'
  editedOutput?: Record<string, unknown> | null
  reviewNote?: string | null
  clearStale?: boolean
  expectedRevision?: number
}): Promise<{ item: BatchItemDTO; run: BatchRunDTO }> {
  if (!isWorkflowStage(params.stage)) {
    throw new ApiError('INVALID_PARAMS', { message: `无效的审核阶段：${String(params.stage)}` })
  }
  if (params.action !== 'approve' && params.action !== 'reject' && params.action !== 'save_draft') {
    throw new ApiError('INVALID_PARAMS', { message: '审核动作仅支持 approve、reject 或 save_draft。' })
  }

  const runRow = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!runRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权审核。' })
  }
  const run = mapBatchRunRow(runRow)
  const item = (run.items || []).find((row) => row.id === params.itemId)
  if (!item) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  }

  // Re-clamp S3 imagePrompts <= 900 chars if editedOutput is saving S3 assets
  let normalizedEditedOutput = params.editedOutput ?? null
  if (params.stage === 'asset_extraction' && normalizedEditedOutput && Array.isArray(normalizedEditedOutput.items)) {
    const rawItems = normalizedEditedOutput.items as WorkflowAssetItem[]
    const clampedItems = rawItems.map((asset) => ({
      ...asset,
      imagePrompt: clampImagePrompt(cleanText(asset.imagePrompt, asset.description || asset.name), ASSET_IMAGE_PROMPT_MAX_CHARS),
    }))
    normalizedEditedOutput = recomputeAssetsArtifactCounts({
      ...(normalizedEditedOutput as unknown as AssetsArtifact),
      items: clampedItems,
    }) as unknown as Record<string, unknown>
  }

  // Reconcile S4 @AssetName / @Alias mentions -> referencedAssetIds server-side so typed mentions always bind S3 images!
  if (params.stage === 'storyboard' && normalizedEditedOutput && Array.isArray(normalizedEditedOutput.shots)) {
    const s3Items = item.stageOutputs.asset_extraction?.items || []
    const s3ById = new Map(s3Items.map((a) => [a.id, a]))
    let allowedDurations: number[] = []
    let supportsFirstLastFrame = false
    const videoResolved = await resolveValidatedModelForStage({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.workspaceOwnerId,
      requestedModelKey: run.modelConfig.videoModelKey,
      type: 'video',
    }).catch((error) => { throw modelUnavailableError(run.modelConfig.videoModelKey, error) })
    const videoCaps = resolveVideoCapabilitiesSummary(videoResolved.actualModelKey)
    allowedDurations = videoCaps.durationRange.allowed
    supportsFirstLastFrame = videoCaps.supportsFirstLastFrame
    const rawShots = normalizedEditedOutput.shots as StoryboardShotItem[]
    normalizedEditedOutput = {
      ...normalizedEditedOutput,
      videoModelKey: videoResolved.modelKey,
      supportsFirstLastFrame,
      shots: rawShots.map((shot) => {
        const explicitIds = cleanStringArray(shot.referencedAssetIds).filter((id) => s3ById.has(id))
        const mentioned = reconcileShotAssetMentions(cleanText(shot.videoPrompt), s3Items)
        const referencedAssetIds = Array.from(new Set([...explicitIds, ...mentioned.referencedAssetIds]))
        return {
          ...shot,
          durationSec: pickClosestAllowedDuration(shot.durationSec, allowedDurations),
          inputMode: shot.inputMode === 'firstlastframe' && !supportsFirstLastFrame ? 'text' : shot.inputMode,
          referencedAssetIds,
          referencedAssetNames: referencedAssetIds.map((id) => s3ById.get(id)?.name).filter((name): name is string => Boolean(name)),
        }
      }),
    }
    const artifact = normalizedEditedOutput as unknown as StoryboardArtifact
    assertNormalizedWorkflowArtifact('storyboard', artifact, s3Items.map((asset) => asset.id))
    normalizedEditedOutput = { ...normalizedEditedOutput, totalDurationSec: artifact.shots.reduce((sum, shot) => sum + shot.durationSec, 0) }
  }

  const transition = applyReviewActionToItemState({
    item,
    stage: params.stage,
    templateStages: run.templateSnapshot.stages,
    action: params.action,
    editedOutput: normalizedEditedOutput,
    reviewNote: params.reviewNote,
    ...(typeof params.clearStale === 'boolean' ? { clearStale: params.clearStale } : {}),
  })

  const updatedItemRow = await updateBatchItemForUser({
    itemId: item.id,
    expectedRevision: params.expectedRevision ?? item.revision ?? 0,
    workspaceOwnerId: params.workspaceOwnerId,
    patch: {
      currentStage: transition.currentStage,
      status: transition.status,
      stageStates: transition.stageStates,
      stageOutputs: transition.stageOutputs,
      errorMessage: transition.errorMessage,
    },
  })

  const updatedRun = (await recomputeBatchRunSummary(run.id)) || run
  return {
    item: mapBatchItemRow(updatedItemRow),
    run: updatedRun,
  }
}

/**
 * Locked-upstream A/B Skill Trial:
 * Runs stage K with draft Skill overrides against locked upstream S1..K-1 WITHOUT overwriting
 * committed `stageOutputs[K]` or mutating any DB Skill record.
 */
export async function runStageSkillTrial(params: {
  workspaceOwnerId: string
  actorId: string
  batchRunId: string
  itemId: string
  stage: WorkflowStage
  skillIdOverride?: string | null
  skillSlugOverride?: string | null
  skillPatch?: StageSkillDraftPatch | null
  stageParamsOverride?: StageParams | null
  confirmCost?: boolean
  shotId?: string | null
}): Promise<RunStageSkillTrialResult> {
  if (!isWorkflowStage(params.stage)) {
    throw new ApiError('INVALID_PARAMS', { message: `无效的阶段标识：${String(params.stage)}` })
  }

  const runRow = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!runRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权试跑。' })
  }
  const run = mapBatchRunRow(runRow)
  const item = (run.items || []).find((row) => row.id === params.itemId)
  if (!item) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  }
  const stageConfig = run.templateSnapshot.stages.find((s) => s.stage === params.stage)

  const baseSkill = await resolveWorkflowSkill({
    workspaceOwnerId: params.workspaceOwnerId,
    skillId: params.skillIdOverride ?? stageConfig?.skillId,
    skillSlug: params.skillSlugOverride ?? (params.skillIdOverride ? undefined : stageConfig?.skillSlug),
    track: run.track,
    stage: params.stage,
  })
  const trialSkill = mergeSkillWithDraftPatch(baseSkill, params.skillPatch)

  const mergedStageParams = {
    ...asRecord(trialSkill.modelPreferences?.defaultStageParams),
    ...asRecord(stageConfig?.options),
    ...asRecord(run.templateSnapshot.stageParams?.[params.stage]),
    ...asRecord(params.stageParamsOverride),
  }

  const startedAtMs = Date.now()
  let trialOutput: unknown

  if (params.stage === 'script_analysis') {
    trialOutput = await executeStage1ScriptAnalysisCore({
      workspaceOwnerId: params.workspaceOwnerId,
      item,
      skill: trialSkill,
      stageParams: mergedStageParams as ScriptAnalysisStageParams,
    })
  } else if (params.stage === 'script_rewrite') {
    trialOutput = await executeStage2ScriptRewriteCore({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.actorId,
      projectId: run.projectId,
      modelConfig: run.modelConfig,
      item,
      skill: trialSkill,
      stageParams: mergedStageParams as ScriptRewriteStageParams,
      stageModelOverride: stageConfig?.modelKey,
    })
  } else if (params.stage === 'asset_extraction') {
    // Trial runs S3A extraction ONLY (never spends image credits during A/B trial!)
    trialOutput = await executeStage3AssetExtractLlmCore({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.actorId,
      projectId: run.projectId,
      modelConfig: run.modelConfig,
      item,
      skill: trialSkill,
      stageParams: mergedStageParams as AssetExtractionStageParams,
      stageModelOverride: stageConfig?.modelKey,
    })
  } else if (params.stage === 'storyboard') {
    trialOutput = await executeStage4StoryboardCore({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.actorId,
      projectId: run.projectId,
      modelConfig: run.modelConfig,
      item,
      skill: trialSkill,
      stageParams: mergedStageParams as StoryboardStageParams,
      stageModelOverride: stageConfig?.modelKey,
    })
  } else {
    // S5 trial: dry-run preview of compiled video parameters without spending video credits
    const s4 = item.stageOutputs.storyboard
    if (!s4 || s4.shots.length === 0) throw new ApiError('INVALID_PARAMS', { message: '请先完成 S4 分镜，再试跑视频生成。' })
    if (params.shotId && !s4.shots.some((shot) => shot.shotId === params.shotId)) throw new ApiError('NOT_FOUND', { message: '未找到试跑镜头。' })
    const effectiveParams = { ...mergedStageParams } as VideoGenStageParams
    const requestedModel = cleanText(stageConfig?.modelKey) || cleanText(trialSkill.modelPreferences?.videoModelKey) || run.modelConfig.videoModelKey
    const resolved = await resolveValidatedModelForStage({
      workspaceOwnerId: params.workspaceOwnerId,
      actorId: params.actorId,
      requestedModelKey: requestedModel,
      explicitRequested: Boolean(stageConfig?.modelKey || trialSkill.modelPreferences?.videoModelKey),
      type: 'video',
    })
    const caps = resolveVideoCapabilitiesSummary(resolved.actualModelKey)
    const aspectRatio = normalizeVideoAspectRatio(effectiveParams.aspectRatio || run.modelConfig.videoAspectRatio || s4.aspectRatio, '9:16')
    const preferredResolution = cleanText(effectiveParams.resolution) || run.modelConfig.videoResolution || '720p'
    const resolution = caps.resolutionOptions.find((value) => value.toLowerCase() === preferredResolution.toLowerCase()) || caps.resolutionOptions[0] || '720p'
    const inputMode = normalizeVideoInputMode(effectiveParams.inputMode || run.modelConfig.videoInputMode, 'text')
    if (params.confirmCost === true && !params.shotId) throw new ApiError('INVALID_PARAMS', { message: '真实试跑会消耗视频额度，必须指定唯一 shotId。' })
    const targetShots = params.shotId ? s4.shots.filter((shot) => shot.shotId === params.shotId) : s4.shots
    const durationSeconds = pickClosestAllowedDuration(effectiveParams.durationSeconds || run.modelConfig.videoDurationSeconds || 5, caps.durationRange.allowed)
    const generateAudio = caps.supportsGenerateAudio ? (effectiveParams.generateAudio ?? run.modelConfig.videoGenerateAudio) : false
    if (params.confirmCost !== true && params.shotId) {
      throw new ApiError('INVALID_PARAMS', { message: '真实试跑会消耗视频额度；仅预览请省略 shotId，真实试跑请设置 confirmCost=true。' })
    }
    if (params.confirmCost !== true) {
      trialOutput = {
        dryRun: true, modelKey: resolved.modelKey, aspectRatio, resolution, generateAudio, inputMode, durationSeconds,
        shotCount: targetShots.length, shotIds: targetShots.map((shot) => shot.shotId),
        shots: targetShots.map((shot) => ({ shotId: shot.shotId, prompt: shot.videoPrompt, durationSeconds: pickClosestAllowedDuration(shot.durationSec || durationSeconds, caps.durationRange.allowed), inputMode: shot.inputMode || inputMode })),
        note: '当前为参数预览，不会消耗视频额度；真实试跑须单镜且 confirmCost=true。',
      }
    } else {
      const latestRow = await readBatchItemRow(item.id, params.workspaceOwnerId)
      if (!latestRow) throw new ApiError('NOT_FOUND', { message: '工作流条目不存在或无权操作。' })
      const latest = mapBatchItemRow(latestRow)
      const activeTake = latest.stageOutputs.video_gen?.shots.find((shot) => shot.shotId === params.shotId)?.takes.some((take) => take.status === 'queued' || take.status === 'processing')
      if (activeTake || latest.stageStates.video_gen.status === 'running') {
        throw new ApiError('STAGE_ALREADY_RUNNING', { message: '该镜头正在生成，请稍候。' })
      }
      const result = await executeStage5VideoGenCore({
        workspaceOwnerId: params.workspaceOwnerId, actorId: params.actorId, projectId: run.projectId, item: latest,
        skill: trialSkill, stageConfig, modelConfig: run.modelConfig, stageParams: effectiveParams,
        shotIds: [params.shotId!], locale: 'zh',
      })
      if (result.taskIds.length > 0) {
        await registerLateAsyncArtifact({ itemId: item.id, workspaceOwnerId: params.workspaceOwnerId, stage: 'video_gen', output: result.output, taskIds: result.taskIds })
      }
      trialOutput = { dryRun: false, modelKey: resolved.modelKey, aspectRatio, resolution, generateAudio, inputMode, durationSeconds, shotCount: 1, shotId: params.shotId, taskIds: result.taskIds, output: result.output, note: '真实单镜试跑已提交，会消耗视频额度。' }
    }
  }

  return {
    stage: params.stage,
    baseSkill: {
      id: baseSkill.id,
      slug: baseSkill.slug,
      name: baseSkill.name,
      version: baseSkill.version,
    },
    trialOutput,
    rawSkillPatch: params.skillPatch || {},
    durationMs: Math.max(1, Date.now() - startedAtMs),
  }
}

// Also export short alias requested in product notes
export const runSkillTrial = runStageSkillTrial

/**
 * Admin AI-Assisted Skill Refinement:
 * Takes a Skill + review feedback + optional sample output and asks the LLM to produce
 * an actionable, diffable `SkillRefineProposal` ready for A/B trial or immutable `v+1` publish.
 */
export async function refineWorkflowSkillWithAi(params: {
  workspaceOwnerId: string
  actorId: string
  skillId: string
  feedback: string
  sampleOutput?: unknown
  projectId?: string
  modelKey?: string | null
}): Promise<SkillRefineProposal> {
  const feedback = cleanText(params.feedback)
  if (!feedback) {
    throw new ApiError('INVALID_PARAMS', { message: '请输入您希望优化 Skill 的具体问题或方向。' })
  }

  const skill = await getWorkflowSkillById({
    workspaceOwnerId: params.workspaceOwnerId,
    skillId: params.skillId,
  })
  if (!skill) {
    throw new ApiError('NOT_FOUND', { message: '目标 Skill 不存在或无权访问。' })
  }

  const metaSystemPrompt = `你是资深 AI 提示词工程专家与短视频工作流架构师。
你的任务是根据管理员的审核反馈与可选样本输出，对一个工作流 Skill 进行精准、克制、可验证的升级迭代。

迭代铁律：
1. 必须完整保留原有 JSON 输出 Schema 字段结构与强约束（绝不能破坏下游解析器字段名！）。
2. 针对管理员反馈的问题精准补强系统提示词（nextSystemPrompt）、示例（nextFewShotExamples）、质检规则（nextQcRules）与模型偏好（nextModelPreferences）。
3. 清晰列出 2-5 条具体改动摘要（changeSummary）以及一句用于版本记录的变更说明（changeNote）。

严格只输出 JSON：
{
  "changeSummary": ["改动点1", "改动点2", "改动点3"],
  "nextName": "Skill 名称（若无需改名则保留原名）",
  "nextDescription": "更新后的简要说明",
  "nextSystemPrompt": "完整的升级版 systemPrompt（必须是完整可直接运行的提示词，禁止省略号占位！）",
  "nextFewShotExamples": [
    { "title": "示例名", "input": "示例输入", "output": "示例输出" }
  ],
  "nextQcRules": {
    "maxChars": 900,
    "minShots": 4,
    "maxShots": 8,
    "requiredKeywords": [],
    "forbiddenKeywords": [],
    "checklist": ["质检项1", "质检项2"]
  },
  "nextModelPreferences": {
    "temperature": 0.5
  },
  "changeNote": "简明版本发布备注（40字内）"
}`

  const userPrompt = [
    `当前 Skill 基础信息（阶段：${skill.stage} / 赛道：${skill.track} / 当前版本：v${skill.version}）：`,
    JSON.stringify({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      systemPrompt: skill.systemPrompt,
      fewShotExamples: skill.fewShotExamples,
      qcRules: skill.qcRules,
      modelPreferences: skill.modelPreferences,
    }, null, 2),
    `管理员迭代反馈与要求：\n${feedback}`,
    params.sampleOutput !== undefined && params.sampleOutput !== null
      ? `最近一次产出样本（供问题定位）：\n${JSON.stringify(params.sampleOutput, null, 2).slice(0, 6000)}`
      : '',
  ].filter(Boolean).join('\n\n')

  const { json, modelKey } = await callWorkflowLlmJson({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    projectId: params.projectId || 'skill-studio',
    action: 'batch-workflow.skill_refine',
    modelKey: params.modelKey || NORI_DEFAULT_MODEL_KEYS.llm,
    explicitModel: Boolean(params.modelKey),
    temperature: 0.35,
    systemPrompt: metaSystemPrompt,
    userPrompt,
    maxTokens: 6000,
  })

  const nextSystemPrompt = cleanText(json.nextSystemPrompt, skill.systemPrompt)
  const rawExamples = Array.isArray(json.nextFewShotExamples) ? json.nextFewShotExamples : skill.fewShotExamples
  const nextFewShotExamples: WorkflowSkillFewShotExample[] = rawExamples
    .map((entry) => {
      const obj = asRecord(entry)
      const title = cleanText(obj.title)
      const input = cleanText(obj.input)
      const output = cleanText(obj.output)
      if (!title && !input && !output) return null
      return { title: title || '示例', input, output }
    })
    .filter((x): x is WorkflowSkillFewShotExample => Boolean(x))
    .slice(0, 10)

  const nextQcRules: WorkflowSkillQcRules | null =
    json.nextQcRules && typeof json.nextQcRules === 'object' && !Array.isArray(json.nextQcRules)
      ? { ...(skill.qcRules || {}), ...(json.nextQcRules as WorkflowSkillQcRules) }
      : skill.qcRules

  const nextModelPreferences: WorkflowSkillModelPreferences | null =
    json.nextModelPreferences && typeof json.nextModelPreferences === 'object' && !Array.isArray(json.nextModelPreferences)
      ? { ...(skill.modelPreferences || {}), ...(json.nextModelPreferences as WorkflowSkillModelPreferences) }
      : skill.modelPreferences

  const changeSummary = cleanStringArray(json.changeSummary)

  return {
    skillId: skill.id,
    skillSlug: skill.slug,
    baseVersion: skill.version,
    stage: skill.stage,
    changeSummary: changeSummary.length > 0 ? changeSummary : ['根据审核反馈优化提示词指令与约束'],
    nextName: cleanText(json.nextName, skill.name),
    nextDescription: json.nextDescription !== undefined ? (cleanText(json.nextDescription) || null) : skill.description,
    nextSystemPrompt,
    nextFewShotExamples,
    nextQcRules,
    nextModelPreferences,
    changeNote: cleanText(json.changeNote, feedback.slice(0, 80)),
    modelKey,
  }
}

/**
 * Advances a BatchRun across items & stages:
 * - Always syncs async S3 image & S5 video task statuses first.
 * - In `gated` mode: stops cleanly at `manual_review` gates (`waiting_review`) or async jobs (`running`).
 * - In `auto` mode: flows seamlessly across S1 -> S2 -> S3A+S3B -> [async poll] -> S4 -> S5 -> [async poll] -> completed.
 * - Exposes `hasPendingAsyncTasks` so frontend polling knows to keep polling & auto-continuing!
 */
export async function advanceBatchRun(params: {
  workspaceOwnerId: string
  actorId: string
  batchRunId: string
  maxSteps?: number
  itemIds?: string[]
  approveWaitingReview?: boolean
  locale?: 'zh' | 'en'
}): Promise<AdvanceBatchRunResult> {
  await syncBatchItemTaskStatuses({
    workspaceOwnerId: params.workspaceOwnerId,
    batchRunId: params.batchRunId,
  })

  const runRow = await prisma.batchRun.findFirst({
    where: { id: params.batchRunId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!runRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权推进。' })
  }
  if (runRow.status === 'paused') {
    throw new ApiError('CONFLICT', { message: '该工作流批次已暂停，请先恢复后再推进。' })
  }

  const mappedRun = mapBatchRunRow(runRow)
  const shouldAutoApproveWaiting = mappedRun.runMode === 'auto' || params.approveWaitingReview === true
  const maxSteps = Math.max(1, Math.min(60, params.maxSteps ?? 24))
  const filterSet = params.itemIds && params.itemIds.length > 0 ? new Set(params.itemIds) : null
  const executedSteps: AdvanceBatchRunResult['executedSteps'] = []

  let remainingSteps = maxSteps
  const candidateItems: BatchItemDTO[] = (mappedRun.items || []).filter((item) => {
    if (filterSet && !filterSet.has(item.id)) return false
    if (item.status === 'queued' || item.status === 'failed') return true
    if (shouldAutoApproveWaiting && item.status === 'waiting_review') return true
    return false
  })

  async function scheduleItem(initialItem: BatchItemDTO) {
    let activeItem = initialItem
    if (shouldAutoApproveWaiting && activeItem.status === 'waiting_review') {
      const waitingStage = activeItem.currentStage
      const pendingS3Assets = waitingStage === 'asset_extraction' && mappedRun.runMode === 'auto'
        && Boolean(activeItem.stageOutputs.asset_extraction?.items?.some((asset) => asset.status === 'pending'))
      if (pendingS3Assets) {
        try {
          const generated = await generateBatchItemAssets({
            workspaceOwnerId: params.workspaceOwnerId,
            actorId: params.actorId,
            batchRunId: params.batchRunId,
            itemId: activeItem.id,
            locale: params.locale || 'zh',
            expectedRevision: activeItem.revision ?? 0,
          })
          activeItem = generated.item
          executedSteps.push({ itemId: activeItem.id, itemTitle: activeItem.title, stage: 'asset_extraction', outcome: 'running' })
          return
        } catch (error) {
          executedSteps.push({ itemId: activeItem.id, itemTitle: activeItem.title, stage: 'asset_extraction', outcome: 'failed', error: error instanceof Error ? error.message : String(error) })
          return
        }
      }
      const approved = await reviewBatchItemStage({
        workspaceOwnerId: params.workspaceOwnerId,
        batchRunId: params.batchRunId,
        itemId: activeItem.id,
        stage: waitingStage,
        action: 'approve',
        reviewNote: '全自动推进自动确认通过',
        expectedRevision: activeItem.revision ?? 0,
      })
      activeItem = approved.item
    }

    if (activeItem.status !== 'queued' && activeItem.status !== 'failed') return
    const stage = activeItem.currentStage
    try {
      const result = await runBatchItemStage({
        workspaceOwnerId: params.workspaceOwnerId,
        actorId: params.actorId,
        batchRunId: params.batchRunId,
        itemId: activeItem.id,
        stage,
        locale: params.locale || 'zh',
        expectedRevision: activeItem.revision ?? 0,
      })
      executedSteps.push({
        itemId: activeItem.id,
        itemTitle: activeItem.title,
        stage,
        outcome: result.outcome,
        ...(result.item.errorMessage ? { error: result.item.errorMessage } : {}),
      })
    } catch (error) {
      executedSteps.push({ itemId: activeItem.id, itemTitle: activeItem.title, stage, outcome: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }

  for (let index = 0; index < Math.min(candidateItems.length, remainingSteps); index += 4) {
    await Promise.all(candidateItems.slice(index, index + 4).map(scheduleItem))
  }

  const finalRun = await recomputeBatchRunSummary(params.batchRunId)
  if (!finalRun) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在。' })
  }

  return {
    run: finalRun,
    hasPendingAsyncTasks: finalRun.hasPendingAsyncTasks,
    executedSteps,
  }
}
