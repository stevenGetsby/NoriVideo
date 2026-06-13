/**
 * Super Agent Orchestrator - MVP 版本
 * 核心编排器：阶段 0-3（规划 → 项目初始化 → 故事分析 → 分镜生成）
 */

import { prisma } from '@/lib/prisma'
import { safeParseJsonObject } from '@/lib/json-repair'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { llmClient } from './llm-client'
import { skillLibrary } from './skill-parser'
import { resolveEpisodeStageArtifacts } from '@/lib/novel-promotion/stage-readiness'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { submitTask } from '@/lib/task/submitter'
import {
  buildImageBillingPayload,
  getProjectModelConfig,
  getUserModelConfig,
  resolveProjectModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/api-config'
import { executeAiStoryExpansion } from '@/lib/novel-promotion/ai-story-expand'
import {
  hasCharacterAppearanceOutput,
  hasLocationImageOutput,
  hasPanelImageOutput,
  hasPanelVideoOutput,
} from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  applySkillWorkflowDefaults,
  createAgentWorkflowStages,
  createDeterministicAnalysis,
  normalizeAgentExecutionPlan,
  normalizeCreativeParameters,
  normalizeExecutionMode,
} from './plan-utils'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { withRecommendedVideoDurationOptions } from '@/lib/video/recommended-duration'
import { ensureAgentPanelVideoPrompt } from './panel-video-prompt'
import {
  decorateLocationSummaryWithIntent,
  inferAgentAssetIntentCritic,
} from './asset-intent-critic'
import {
  createMockScriptArtifacts,
  createMockStoryboardArtifacts,
} from './mock-execution'
import {
  completeAgentWorkflowRun,
  failAgentWorkflowRun,
  recordAgentWorkflowStage,
  startAgentWorkflowRun,
} from './workflow-store'
import {
  buildAgentStoryPackage,
  serializeAgentStoryPackage,
} from './agent-story-package'
import { buildAgentWorkspaceVideoUrl } from './workspace-url'
import {
  isStructuredShotScript,
} from './structured-shot-script'
import {
  persistAgentLlmStage2,
  persistAgentLlmStage3,
} from './llm-storyboard-pipeline'
import type {
  AgentContext,
  AgentExecutionPlan,
  AgentExecutionResult,
  LLMAnalysisResult,
  SkillId,
} from './types'
import type { Locale } from '@/i18n/routing'

const VIDEO_RATIOS = new Set(['9:16', '16:9', '1:1'])
const AGENT_ASSET_BRIEF_START = '【Agent 资产一致性简报】'
const AGENT_ASSET_BRIEF_END = '【Agent 资产一致性简报结束】'
const PANEL_IMAGE_CANDIDATE_COUNT = 1
const RECORDING_REPLAY_PROMPT_PATTERN = /#测试(?=\s|$|[，。,.!！?？])|测试\s*mock/i
const RECORDING_REPLAY_SOURCE_PROJECT_NAME = 'TEST'
const RECORDING_REPLAY_STAGE_DELAY_MS = 900

function isArkSeedanceVideoModel(modelKey: string | null | undefined): boolean {
  return typeof modelKey === 'string' && (/^ark::/i.test(modelKey) || /doubao-seedance/i.test(modelKey))
}

function isRecordingReplayPrompt(input: string): boolean {
  return RECORDING_REPLAY_PROMPT_PATTERN.test(input)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type VideoGenerationStageResult = {
  panelCount: number
  skippedMissingImageCount: number
  skippedMissingVideoModel?: boolean
  skippedExistingVideoCount: number
  submittedTaskCount: number
  completedTaskCount: number
  failedTaskCount: number
  hasVideos: boolean
  taskIds: string[]
}

type AssetImageGenerationStageResult = {
  characterAppearanceCount: number
  locationImageCount: number
  propImageCount: number
  skippedExistingImageCount: number
  submittedTaskCount: number
  completedTaskCount: number
  failedTaskCount: number
  hasAssetImages: boolean
  taskIds: string[]
}

type TaskCompletionProgress = {
  totalCount: number
  completedCount: number
  failedCount: number
  pendingCount: number
  queuedCount: number
  processingCount: number
  averageProgress: number
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function mergeParameterSources(
  inferred: unknown,
  explicit: unknown,
): Record<string, unknown> {
  return {
    ...(readObject(inferred) ?? {}),
    ...(readObject(explicit) ?? {}),
  }
}

function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : 'zh'
}

function normalizeSkillId(value: unknown, fallback: LLMAnalysisResult, userInput: string): SkillId {
  const rawSkill = readNonEmptyString(value)
  if (rawSkill && skillLibrary.getSkill(rawSkill as SkillId)) {
    return rawSkill as SkillId
  }

  return skillLibrary.findSkillByKeywords([
    rawSkill || '',
    fallback.storyText,
    fallback.projectName,
    userInput,
  ].filter(Boolean))
}

function isReusableBlankEpisode(episode: {
  novelText?: string | null
  clips?: unknown[]
  storyboards?: unknown[]
} | null | undefined): boolean {
  if (!episode) return false
  return (
    !episode.novelText?.trim()
    && (episode.clips?.length || 0) === 0
    && (episode.storyboards?.length || 0) === 0
  )
}

function isEpisodeNumberUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; message?: unknown }
  return record.code === 'P2002'
    || (typeof record.message === 'string'
      && /Unique constraint failed|novel_promotion_episodes_novelPromotionProjectId_episodeNumb/.test(record.message))
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  } catch {
    return value
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}

function summarizeAssetSubject(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return Array.from(compact).slice(0, 42).join('')
}

function normalizeAssetName(value: string, fallback: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return fallback
  return Array.from(compact).slice(0, 36).join('')
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
}

function inferProductSubjectFromScript(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  const explicit = compact.match(/(?:商品宣传短片|产品宣传短片|宣传短片)[：:]\s*([^，。,.\n]{2,32})/)
  if (explicit?.[1]) return normalizeAssetName(explicit[1], '核心商品')

  const afterColon = compact.match(/[：:]\s*([^，。,.\n]{2,32})/)
  if (afterColon?.[1]) return normalizeAssetName(afterColon[1], '核心商品')

  return ''
}

function isCommercialAgentSkill(skillId: string): boolean {
  return skillId === 'product-promo'
    || skillId === 'digital-avatar-ad'
    || skillId === 'ugc-platform-promo'
}

function isRoleAssetRichPrompt(input: string): boolean {
  return /(角色资产|角色设定|人物资产|人物设定|Role Assets?|Character Assets?)/i.test(input)
}

function isRealisticAgentPlan(plan: AgentExecutionPlan): boolean {
  return plan.projectConfig.artStyle === 'realistic'
}

function createStructuredShotScriptAnalysis(input: string): LLMAnalysisResult {
  const title = input.split('\n').map((line) => line.trim()).find(Boolean) || '结构化镜头稿'
  const cleanTitle = title.replace(/[《》#]/g, '').trim() || '结构化镜头稿'
  return {
    videoType: 'generic',
    storyText: input,
    videoRatio: /16:9|横屏/i.test(input) ? '16:9' : '9:16',
    visualStyle: '欧美医疗短剧转绘视频，真实真人短剧质感，英文口型，不要中文字幕，不要背景音乐。',
    projectName: cleanTitle.slice(0, 36),
    episodeName: '第1集',
    language: /Nurse|Dr\.|Ava|English/i.test(input) ? 'en' : 'zh',
    confidence: 0.99,
    creativeParameters: {
      storyboardOnly: true,
      narration: 'off',
      panelsPerShot: 1,
    },
  }
}

function buildWorkspaceUrl(params: {
  locale?: string
  projectId: string
  episodeId: string
  hasVideos: boolean
}): string {
  return buildAgentWorkspaceVideoUrl(params)
}

function replaceAgentAssetBrief(existing: string | null | undefined, brief: string): string {
  const base = (existing || '').trim()
  const pattern = new RegExp(`${AGENT_ASSET_BRIEF_START}[\\s\\S]*?${AGENT_ASSET_BRIEF_END}`, 'g')
  const cleaned = base.replace(pattern, '').trim()
  return [cleaned, brief].filter(Boolean).join('\n\n')
}

function countCjk(value: string): number {
  return (value.match(/[\u3400-\u9fff]/g) || []).length
}

function countLatinWords(value: string): number {
  return (value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length
}

function countStorySentences(value: string): number {
  return (value.match(/[。！？!?；;.]/g) || []).length
}

function isThinGenericStory(storyText: string, userInput: string, language: 'zh' | 'en'): boolean {
  const story = storyText.trim()
  if (!story) return true
  const normalizedStory = story.replace(/\s+/g, '')
  const normalizedInput = userInput.trim().replace(/\s+/g, '')
  if (normalizedStory && normalizedStory === normalizedInput) return true
  if (language === 'en') {
    return countLatinWords(story) < 90 && countStorySentences(story) < 5
  }
  return countCjk(story) < 160 && countStorySentences(story) < 5
}

export function parseLlmAnalysisResult(response: string, userInput: string): LLMAnalysisResult {
  const fallback = createDeterministicAnalysis(userInput)
  let parsed: Record<string, unknown>

  try {
    parsed = safeParseJsonObject(response)
  } catch {
    return fallback
  }

  const videoRatio = readNonEmptyString(parsed.videoRatio)
  const language = readNonEmptyString(parsed.language)
  const creativeParameters = readObject(parsed.creativeParameters)
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : fallback.confidence
  const videoType = normalizeSkillId(parsed.videoType, fallback, userInput)
  const normalizedLanguage = language === 'zh' || language === 'en' ? language : fallback.language
  const parsedStoryText = readNonEmptyString(parsed.storyText) || fallback.storyText

  return {
    videoType,
    storyText: parsedStoryText,
    videoRatio: VIDEO_RATIOS.has(videoRatio || '')
      ? videoRatio as LLMAnalysisResult['videoRatio']
      : fallback.videoRatio,
    visualStyle: readNonEmptyString(parsed.visualStyle) || fallback.visualStyle,
    projectName: readNonEmptyString(parsed.projectName) || fallback.projectName,
    episodeName: readNonEmptyString(parsed.episodeName) || fallback.episodeName,
    language: normalizedLanguage,
    confidence,
    creativeParameters,
  }
}

export class SuperAgentOrchestrator {
  /**
   * 阶段 0：生成执行计划
   */
  async createExecutionPlan(context: AgentContext): Promise<AgentExecutionPlan> {
    // Keep planning deterministic and fast. The heavy LLM work belongs to the
    // background workflow so the UI can get a real run/task id immediately.
    const executionMode = normalizeExecutionMode(context.executionMode)
    const structuredShotScript = isStructuredShotScript(context.userInput)
    const analysis = executionMode === 'mock'
      ? createDeterministicAnalysis(context.userInput)
      : structuredShotScript
        ? createStructuredShotScriptAnalysis(context.userInput)
        : createDeterministicAnalysis(context.userInput)
    const storyReadyAnalysis = analysis
    const storyPackage = buildAgentStoryPackage({
      userInput: context.userInput,
      analysis: storyReadyAnalysis,
    })
    const rawParameters = mergeParameterSources(storyReadyAnalysis.creativeParameters, context.parameters)
    if (structuredShotScript && rawParameters.storyboardOnly !== false) {
      rawParameters.storyboardOnly = true
    }
    let creativeParameters = normalizeCreativeParameters(rawParameters)

    // 2. 获取 Skill 定义
    const skill = skillLibrary.getSkill(storyReadyAnalysis.videoType)
    if (!skill) {
      throw new Error(`Skill not found: ${storyReadyAnalysis.videoType}`)
    }
    creativeParameters = applySkillWorkflowDefaults(creativeParameters, rawParameters, storyReadyAnalysis.videoType)

    // 3. 构建执行计划
    const plan: AgentExecutionPlan = {
      projectConfig: {
        name: storyReadyAnalysis.projectName,
        videoRatio: storyReadyAnalysis.videoRatio,
        artStyle: 'realistic',
        artStylePrompt: storyReadyAnalysis.visualStyle || skill.defaultConfig.visualStyle,
      },
      episodeConfig: {
        name: storyReadyAnalysis.episodeName,
        novelText: serializeAgentStoryPackage(storyPackage),
      },
      selectedSkill: storyReadyAnalysis.videoType,
      skillDescription: skill.description,
      executionMode,
      creativeParameters,
      stages: createAgentWorkflowStages(),
      estimatedDuration: 2525,
    }

    return plan
  }

  private async expandThinGenericStoryWithManualSmartCreation(
    context: AgentContext,
    analysis: LLMAnalysisResult,
  ): Promise<LLMAnalysisResult> {
    if (analysis.videoType !== 'generic') return analysis
    if (isRoleAssetRichPrompt(context.userInput)) return analysis
    if (!isThinGenericStory(analysis.storyText, context.userInput, analysis.language)) return analysis

    const userConfig = await getUserModelConfig(context.userId)
    if (!userConfig.analysisModel) {
      throw new Error('analysisModel is required. Please configure it in profile settings.')
    }

    const expansion = await executeAiStoryExpansion({
      userId: context.userId,
      model: userConfig.analysisModel,
      prompt: context.userInput,
      locale: normalizeLocale(context.locale),
      projectId: context.targetProjectId || 'super-agent-story-expand',
      action: 'super-agent.story-expand',
      stepId: 'agent_story_expand',
      stepTitle: 'Agent 故事扩写',
      stepIndex: 1,
      stepTotal: 1,
    })

    return {
      ...analysis,
      storyText: expansion.expandedText,
    }
  }

  /**
   * 执行计划
   */
  async executePlan(
    plan: AgentExecutionPlan,
    context: AgentContext,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<AgentExecutionResult> {
    plan = normalizeAgentExecutionPlan(plan)
    const executionId = `agent_exec_${Date.now()}`
    const errors: string[] = []
    let workflowRunId: string | null = context.workflowRunId || null
    let workflowProjectId: string | null = context.targetProjectId || null
    let activeStageIndex = 0
    const storyboardOnly = plan.creativeParameters.storyboardOnly === true
    const structuredShotScript = isStructuredShotScript(context.userInput)

    if (isRecordingReplayPrompt(context.userInput)) {
      return await this.executeRecordingReplayMock(plan, context, executionId)
    }

    try {
      if (context.targetProjectId && !workflowRunId) {
        workflowProjectId = context.targetProjectId
        try {
          const run = await startAgentWorkflowRun({
            userId: context.userId,
            projectId: context.targetProjectId,
            episodeId: null,
            targetId: context.targetProjectId,
            plan,
            userInput: context.userInput,
          })
          workflowRunId = run.id
        } catch (workflowError) {
          errors.push(`workflow-store: ${workflowError instanceof Error ? workflowError.message : String(workflowError)}`)
        }
      }

      // 阶段 1：项目初始化
      activeStageIndex = 0
      plan.stages[0].status = 'running'
      if (workflowRunId && workflowProjectId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId: workflowProjectId,
          stage: plan.stages[0],
          status: 'running',
          percent: 8,
          message: '正在准备项目和第一集，保留原始 prompt、创作模式和风格约束。',
        })
      }
      onProgress?.('项目初始化', 10)
      const stage1Result = await this.executeStage1(plan, context)
      plan.stages[0].status = 'completed'

      const { projectId, episodeId } = stage1Result
      workflowProjectId = projectId
      try {
        if (!workflowRunId) {
          const run = await startAgentWorkflowRun({
            userId: context.userId,
            projectId,
            episodeId,
            targetId: context.targetProjectId || projectId,
            plan,
            userInput: context.userInput,
          })
          workflowRunId = run.id
        }
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[0],
          status: 'completed',
          percent: 14,
          message: '项目和剧集已准备，Agent 保留原始 prompt 与制作约束。',
          details: stage1Result,
        })
      } catch (workflowError) {
        errors.push(`workflow-store: ${workflowError instanceof Error ? workflowError.message : String(workflowError)}`)
      }

      // 阶段 2：故事分析与剧本生成
      activeStageIndex = 1
      plan.stages[1].status = 'running'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[1],
          status: 'running',
          percent: 20,
          message: '正在用 LLM 抽取全局资产，并把混乱 prompt/剧本拆成可编辑剧情片段。',
        })
      }
      onProgress?.('故事扩写与剧本生成', 30)
      const stage2Result = plan.executionMode === 'mock'
        ? await createMockScriptArtifacts({ projectId, episodeId, plan })
        : await this.executeStage2(projectId, episodeId, context, plan)
      if (!stage2Result.hasScript || stage2Result.clipCount <= 0) {
        throw new Error('Agent script generation produced no usable clips')
      }
      plan.stages[1].status = 'completed'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[1],
          status: 'completed',
          percent: 36,
          message: `资产抽取和剧情片段拆分完成：已生成 ${stage2Result.clipCount} 个剧情片段，并完成角色、场景、道具候选抽取。`,
          details: stage2Result,
        })
      }

      // 阶段 3：资产一致性核对
      activeStageIndex = 2
      plan.stages[2].status = 'running'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[2],
          status: 'running',
          percent: 42,
          message: '正在执行资产 critic：核对角色、场景、道具是否符合 prompt 意图和地域语境。',
        })
      }
      onProgress?.('资产一致性核对', 50)
      const assetConsistencyResult = await this.executeAssetConsistencyStage(projectId, episodeId, plan, context)
      plan.stages[2].status = 'completed'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[2],
          status: 'completed',
          percent: 50,
          message: `资产已锁定：${assetConsistencyResult.characterCount} 个角色、${assetConsistencyResult.locationCount} 个场景、${assetConsistencyResult.propCount} 个道具。`,
          details: assetConsistencyResult,
        })
      }

      // 阶段 4：资产图生成
      activeStageIndex = 3
      plan.stages[3].status = 'running'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[3],
          status: 'running',
          percent: 56,
          message: '正在为全局角色、场景和道具生成一致性参考图。',
        })
      }
      onProgress?.('资产图生成', 62)
      const assetProgressRunId = workflowRunId
      const assetImageGenerationResult = plan.executionMode === 'mock'
          ? await this.executeMockAssetImageGenerationStage(projectId)
          : await this.executeAssetImageGenerationStage(projectId, context, assetProgressRunId
          ? async (progress) => {
            await recordAgentWorkflowStage({
              runId: assetProgressRunId,
              userId: context.userId,
              projectId,
              stage: plan.stages[3],
              status: 'running',
              percent: 56 + (progress.averageProgress / 100) * 8,
              message: `资产图生成中：完成 ${progress.completedCount}/${progress.totalCount}，失败 ${progress.failedCount}，处理中 ${progress.processingCount}，排队 ${progress.queuedCount}。`,
              details: {
                submittedTaskCount: progress.totalCount,
                completedTaskCount: progress.completedCount,
                failedTaskCount: progress.failedCount,
                pendingTaskCount: progress.pendingCount,
                queuedTaskCount: progress.queuedCount,
                processingTaskCount: progress.processingCount,
                averageProgress: progress.averageProgress,
              },
            })
          }
          : undefined)
      const assetImagesIncomplete = plan.executionMode === 'live' && !assetImageGenerationResult.hasAssetImages
      plan.stages[3].status = assetImageGenerationResult.failedTaskCount > 0 || assetImagesIncomplete
        ? 'failed'
        : 'completed'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[3],
          status: plan.stages[3].status,
          percent: 64,
          message: assetImageGenerationResult.failedTaskCount > 0
            ? `${assetImageGenerationResult.failedTaskCount} 个资产图任务失败。`
            : assetImagesIncomplete
              ? '资产图任务结束，但仍有全局资产缺少可用参考图。'
            : `资产图任务完成/提交：${assetImageGenerationResult.completedTaskCount}/${assetImageGenerationResult.submittedTaskCount}。`,
          details: assetImageGenerationResult,
        })
      }
      if (assetImageGenerationResult.failedTaskCount > 0) {
        errors.push(`asset-image-generation: ${assetImageGenerationResult.failedTaskCount} asset image task(s) failed`)
      }
      if (assetImagesIncomplete) {
        errors.push('asset-image-generation: asset reference images are incomplete')
      }

      // 阶段 5：分镜生成
      activeStageIndex = 4
      plan.stages[4].status = 'running'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[4],
          status: 'running',
          percent: 70,
          message: '正在用 LLM 按剧情片段生成 Seedance video_prompt，并进行规则校验/清洗。',
        })
      }
      onProgress?.('精简分镜生成', 74)
      const stage3Result = plan.executionMode === 'mock'
        ? await createMockStoryboardArtifacts({ episodeId, plan })
        : await this.executeStage3(projectId, episodeId, context, plan, workflowRunId)
      if (!stage3Result.hasStoryboard || stage3Result.storyboardCount <= 0 || stage3Result.panelCount <= 0) {
        throw new Error('Agent storyboard generation produced no usable panels')
      }
      const panelPromptResult = plan.executionMode === 'live' && !structuredShotScript && !storyboardOnly
        ? await this.ensureAgentPanelVideoPromptFormat(episodeId)
        : { updatedPanelCount: 0 }
      plan.stages[4].status = 'completed'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[4],
          status: 'completed',
          percent: 78,
          message: `已生成 ${stage3Result.storyboardCount} 个分镜板、${stage3Result.panelCount} 个视频分镜提示词，并完成规则校验/清洗。`,
          details: {
            ...stage3Result,
            panelPromptResult,
          },
        })
      }

      // 阶段 6：分镜视频准备
      activeStageIndex = 5
      plan.stages[5].status = 'running'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[5],
          status: 'running',
          percent: 82,
          message: '正在确认每个分镜的视频提示词和资产引用，Seedance 将直接用资产参考图生成视频。',
        })
      }
      onProgress?.('视频资产引用准备', 86)
      const imageGenerationResult = {
        panelCount: stage3Result.panelCount,
        skippedExistingImageCount: 0,
        submittedTaskCount: 0,
        completedTaskCount: 0,
        failedTaskCount: 0,
        hasImages: false,
        taskIds: [],
        skippedByAgentSeedanceDirectVideo: true,
      }
      const panelImagesIncomplete = false
      plan.stages[5].status = 'completed'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[5],
          status: plan.stages[5].status,
          percent: 88,
          message: '已跳过分镜图生成。视频阶段会使用每个 panel 的 video_prompt 与角色/场景/道具资产参考图直连 Seedance 2.0。',
          details: imageGenerationResult,
        })
      }

      // 阶段 7：视频生成
      activeStageIndex = 6
      plan.stages[6].status = 'running'
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[6],
          status: 'running',
          percent: 92,
          message: '正在按每个分镜的视频提示词提交 Seedance 视频任务，并注入对应角色、场景、道具参考图。',
        })
      }
      onProgress?.('视频生成', 94)
      let videoGenerationResult: VideoGenerationStageResult
      const videoProgressRunId = workflowRunId
      try {
        videoGenerationResult = storyboardOnly
          ? {
            panelCount: stage3Result.panelCount,
            skippedMissingImageCount: 0,
            skippedExistingVideoCount: 0,
            submittedTaskCount: 0,
            completedTaskCount: 0,
            failedTaskCount: 0,
            hasVideos: false,
            taskIds: [],
          }
          : plan.executionMode === 'mock'
            ? await this.executeMockVideoGenerationStage(episodeId)
            : await this.executeVideoGenerationStage(projectId, episodeId, context, videoProgressRunId
            ? async (progress) => {
              await recordAgentWorkflowStage({
                runId: videoProgressRunId,
                userId: context.userId,
                projectId,
                stage: plan.stages[6],
                status: 'running',
                percent: 92 + (progress.averageProgress / 100) * 6,
                message: `视频生成中：完成 ${progress.completedCount}/${progress.totalCount}，失败 ${progress.failedCount}，处理中 ${progress.processingCount}，排队 ${progress.queuedCount}。`,
                details: {
                  submittedTaskCount: progress.totalCount,
                  completedTaskCount: progress.completedCount,
                  failedTaskCount: progress.failedCount,
                  pendingTaskCount: progress.pendingCount,
                  queuedTaskCount: progress.queuedCount,
                  processingTaskCount: progress.processingCount,
                  averageProgress: progress.averageProgress,
                },
              })
            }
            : undefined)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const skippedMissingVideoModel = message === 'Video model is not configured'
        errors.push(skippedMissingVideoModel
          ? 'video-generation: skipped because Video model is not configured'
          : `video-generation: ${message}`)
        videoGenerationResult = await this.createVideoGenerationFailureSnapshot(episodeId, {
          skippedMissingVideoModel,
          markReadyPanelsFailed: !skippedMissingVideoModel,
        })
      }
      const panelVideosIncomplete = plan.executionMode === 'live'
        && !storyboardOnly
        && !videoGenerationResult.skippedMissingVideoModel
        && !videoGenerationResult.hasVideos
      plan.stages[6].status = videoGenerationResult.failedTaskCount > 0
        || videoGenerationResult.skippedMissingImageCount > 0
        || videoGenerationResult.skippedMissingVideoModel === true
        || panelVideosIncomplete
        ? 'failed'
        : 'completed'
      if (videoGenerationResult.failedTaskCount > 0) {
        errors.push(`video-generation: ${videoGenerationResult.failedTaskCount} panel video task(s) failed`)
      }
      if (videoGenerationResult.skippedMissingImageCount > 0) {
        errors.push(`video-generation: ${videoGenerationResult.skippedMissingImageCount} panel(s) missing image output`)
      }
      if (panelVideosIncomplete) {
        errors.push('video-generation: panel videos are incomplete')
      }
      if (workflowRunId) {
        await recordAgentWorkflowStage({
          runId: workflowRunId,
          userId: context.userId,
          projectId,
          stage: plan.stages[6],
          status: plan.stages[6].status === 'failed' ? 'failed' : 'completed',
          percent: 98,
          message: storyboardOnly
            ? '已按 storyboardOnly 跳过视频生成；当前产物停在可编辑分镜 video_prompt。'
            : videoGenerationResult.hasVideos
            ? '视频生成完成。'
            : panelVideosIncomplete
              ? '视频任务结束，但仍有 panel 缺少可用视频。'
            : `视频任务已处理：提交 ${videoGenerationResult.submittedTaskCount} 个，已有视频 ${videoGenerationResult.skippedExistingVideoCount} 个。`,
          details: videoGenerationResult,
        })
      }

      onProgress?.('完成', 100)

      const hasBlockingGenerationError = imageGenerationResult.failedTaskCount > 0
        || assetImageGenerationResult.failedTaskCount > 0
        || assetImagesIncomplete
        || panelImagesIncomplete
        || (!storyboardOnly && (
          videoGenerationResult.failedTaskCount > 0
          || videoGenerationResult.skippedMissingImageCount > 0
          || videoGenerationResult.skippedMissingVideoModel === true
          || panelVideosIncomplete
        ))

      const result: AgentExecutionResult = {
        executionId,
        projectId,
        episodeId,
        status: hasBlockingGenerationError ? 'partial' : 'completed',
        stageResults: {
          stage1: stage1Result,
          stage2: stage2Result,
          assetConsistency: assetConsistencyResult,
          assetImageGeneration: assetImageGenerationResult,
          stage3: stage3Result,
          imageGeneration: imageGenerationResult,
          videoGeneration: videoGenerationResult,
        },
        workspaceUrl: buildWorkspaceUrl({
          locale: context.locale,
          projectId,
          episodeId,
          hasVideos: videoGenerationResult.hasVideos,
        }),
        summary: this.generateSummary(
          stage2Result,
          stage3Result,
          imageGenerationResult,
          videoGenerationResult,
          assetImageGenerationResult,
        ),
        errors,
      }

      if (workflowRunId) {
        try {
          await completeAgentWorkflowRun({
            runId: workflowRunId,
            userId: context.userId,
            result,
            plan,
          })
        } catch (workflowError) {
          result.errors.push(`workflow-store: ${workflowError instanceof Error ? workflowError.message : String(workflowError)}`)
        }
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errors.push(errorMessage)
      if (workflowRunId) {
        try {
          await recordAgentWorkflowStage({
            runId: workflowRunId,
            userId: context.userId,
            projectId: workflowProjectId || context.targetProjectId || 'unknown',
            stage: plan.stages[activeStageIndex] || plan.stages[0],
            status: 'failed',
            percent: 0,
            message: errorMessage,
            details: { errorMessage },
          })
          await failAgentWorkflowRun({
            runId: workflowRunId,
            userId: context.userId,
            projectId: workflowProjectId || context.targetProjectId || 'unknown',
            errorMessage,
            details: { activeStageIndex },
          })
        } catch {
          // Preserve the original execution error.
        }
      }
      throw error
    }
  }

  private async findRecordingReplayProject(params: {
    userId: string
    targetProjectId?: string
  }) {
    const includePayload = {
      novelPromotionData: {
        include: {
          characters: {
            include: {
              appearances: {
                orderBy: { appearanceIndex: 'asc' as const },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
          locations: {
            include: {
              images: {
                orderBy: { imageIndex: 'asc' as const },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
          episodes: {
            include: {
              clips: {
                orderBy: { createdAt: 'asc' as const },
              },
              storyboards: {
                include: {
                  panels: {
                    orderBy: { panelIndex: 'asc' as const },
                  },
                },
                orderBy: { createdAt: 'asc' as const },
              },
            },
            orderBy: { episodeNumber: 'asc' as const },
          },
        },
      },
    }

    const hasCompleteVideos = (project: {
      novelPromotionData?: {
        episodes: Array<{
          storyboards: Array<{
            panels: Array<{ videoUrl: string | null }>
          }>
        }>
      } | null
    } | null | undefined) => {
      const panels = project?.novelPromotionData?.episodes.flatMap((episode) => (
        episode.storyboards.flatMap((storyboard) => storyboard.panels)
      )) || []
      return panels.length > 0 && panels.every((panel) => Boolean(panel.videoUrl))
    }

    const testProject = await prisma.project.findFirst({
      where: {
        userId: params.userId,
        name: RECORDING_REPLAY_SOURCE_PROJECT_NAME,
      },
      include: includePayload,
      orderBy: { updatedAt: 'desc' },
    })

    if (!hasCompleteVideos(testProject)) {
      throw new Error(`录屏演示 mock 找不到完整的 ${RECORDING_REPLAY_SOURCE_PROJECT_NAME} 产物`)
    }

    return testProject
  }

  private async cloneRecordingReplayProjectToTarget(params: {
    sourceProject: any
    targetProjectId: string
    userId: string
    userInput: string
  }): Promise<{
    projectId: string
    episodeId: string
    clipCount: number
    storyboardCount: number
    panelCount: number
    videoCount: number
    characterCount: number
    locationCount: number
    characterAppearanceCount: number
    locationImageCount: number
    propCount: number
    propImageCount: number
  }> {
    const sourceData = params.sourceProject?.novelPromotionData
    if (!sourceData) throw new Error('录屏演示 mock 源项目缺少创作数据')
    const sourceEpisodesWithVideos = sourceData.episodes.filter((episode: any) => (
      episode.storyboards.some((storyboard: any) => storyboard.panels.some((panel: any) => panel.videoUrl))
    ))
    const fallbackEpisode = sourceData.episodes.find((episode: any) => episode.id === sourceData.lastEpisodeId)
      || sourceData.episodes[0]
    const sourceEpisodes = sourceEpisodesWithVideos.length > 0
      ? sourceEpisodesWithVideos
      : (fallbackEpisode ? [fallbackEpisode] : [])

    if (params.sourceProject.id === params.targetProjectId) {
      const panels = sourceEpisodes.flatMap((episode: any) => (
        episode.storyboards.flatMap((storyboard: any) => storyboard.panels)
      ))
      const replayEpisode = sourceEpisodes.find((episode: any) => episode.id === sourceData.lastEpisodeId)
        || sourceEpisodes[0]
      return {
        projectId: params.targetProjectId,
        episodeId: replayEpisode.id,
        clipCount: sourceEpisodes.reduce((sum: number, episode: any) => sum + episode.clips.length, 0),
        storyboardCount: sourceEpisodes.reduce((sum: number, episode: any) => sum + episode.storyboards.length, 0),
        panelCount: panels.length,
        videoCount: panels.filter((panel: any) => panel.videoUrl).length,
        characterCount: sourceData.characters.length,
        locationCount: sourceData.locations.length,
        characterAppearanceCount: sourceData.characters.reduce((sum: number, character: any) => sum + character.appearances.length, 0),
        locationImageCount: sourceData.locations.reduce((sum: number, location: any) => sum + location.images.length, 0),
        propCount: sourceData.locations.filter((location: any) => location.assetKind === 'prop').length,
        propImageCount: sourceData.locations
          .filter((location: any) => location.assetKind === 'prop')
          .reduce((sum: number, location: any) => sum + location.images.length, 0),
      }
    }

    const targetProject = await prisma.project.findFirst({
      where: {
        id: params.targetProjectId,
        userId: params.userId,
      },
      select: { id: true },
    })
    if (!targetProject) {
      throw new Error('录屏演示 mock 目标项目不存在')
    }

    const cleanedPrompt = params.userInput.replace(RECORDING_REPLAY_PROMPT_PATTERN, '').trim() || params.userInput

    return await prisma.$transaction(async (tx) => {
      await tx.novelPromotionProject.deleteMany({
        where: { projectId: params.targetProjectId },
      })

      const nextProject = await tx.novelPromotionProject.create({
        data: {
          projectId: params.targetProjectId,
          analysisModel: sourceData.analysisModel,
          imageModel: sourceData.imageModel,
          videoModel: sourceData.videoModel,
          audioModel: sourceData.audioModel,
          videoRatio: sourceData.videoRatio,
          ttsRate: sourceData.ttsRate,
          globalAssetText: sourceData.globalAssetText,
          artStyle: sourceData.artStyle,
          artStylePrompt: sourceData.artStylePrompt,
          characterModel: sourceData.characterModel,
          locationModel: sourceData.locationModel,
          storyboardModel: sourceData.storyboardModel,
          editModel: sourceData.editModel,
          videoResolution: sourceData.videoResolution,
          capabilityOverrides: sourceData.capabilityOverrides,
          workflowMode: 'agent',
          imageResolution: sourceData.imageResolution,
          importStatus: 'completed',
        },
      })

      await tx.project.update({
        where: { id: params.targetProjectId },
        data: {
          description: cleanedPrompt,
          lastAccessedAt: new Date(),
        },
      })

      for (const character of sourceData.characters) {
        const nextCharacter = await tx.novelPromotionCharacter.create({
          data: {
            novelPromotionProjectId: nextProject.id,
            name: character.name,
            aliases: character.aliases,
            customVoiceUrl: character.customVoiceUrl,
            customVoiceMediaId: character.customVoiceMediaId,
            voiceId: character.voiceId,
            voiceType: character.voiceType,
            seedanceAssetGroupId: character.seedanceAssetGroupId,
            seedanceAssetsProjectName: character.seedanceAssetsProjectName,
            profileData: character.profileData,
            profileConfirmed: character.profileConfirmed,
            introduction: character.introduction,
            sourceGlobalCharacterId: character.sourceGlobalCharacterId,
          },
        })

        for (const appearance of character.appearances) {
          await tx.characterAppearance.create({
            data: {
              characterId: nextCharacter.id,
              appearanceIndex: appearance.appearanceIndex,
              changeReason: appearance.changeReason,
              description: appearance.description,
              descriptions: appearance.descriptions,
              imageUrl: appearance.imageUrl,
              imageUrls: appearance.imageUrls,
              selectedIndex: appearance.selectedIndex,
              previousImageUrl: appearance.previousImageUrl,
              previousImageUrls: appearance.previousImageUrls,
              previousDescription: appearance.previousDescription,
              previousDescriptions: appearance.previousDescriptions,
              imageMediaId: appearance.imageMediaId,
              seedanceAssetId: appearance.seedanceAssetId,
              seedanceAssetUri: appearance.seedanceAssetUri,
              seedanceAssetStatus: appearance.seedanceAssetStatus,
              seedanceAssetError: appearance.seedanceAssetError,
              seedanceAssetImageUrl: appearance.seedanceAssetImageUrl,
              seedanceAssetSyncedAt: appearance.seedanceAssetSyncedAt,
            },
          })
        }
      }

      for (const location of sourceData.locations) {
        const nextLocation = await tx.novelPromotionLocation.create({
          data: {
            novelPromotionProjectId: nextProject.id,
            name: location.name,
            summary: location.summary,
            assetKind: location.assetKind,
            sourceGlobalLocationId: location.sourceGlobalLocationId,
          },
        })
        const imageIdMap = new Map<string, string>()
        for (const image of location.images) {
          const nextImage = await tx.locationImage.create({
            data: {
              locationId: nextLocation.id,
              imageIndex: image.imageIndex,
              description: image.description,
              availableSlots: image.availableSlots,
              imageUrl: image.imageUrl,
              isSelected: image.isSelected,
              previousImageUrl: image.previousImageUrl,
              previousDescription: image.previousDescription,
              imageMediaId: image.imageMediaId,
            },
          })
          imageIdMap.set(image.id, nextImage.id)
        }
        if (location.selectedImageId && imageIdMap.has(location.selectedImageId)) {
          await tx.novelPromotionLocation.update({
            where: { id: nextLocation.id },
            data: { selectedImageId: imageIdMap.get(location.selectedImageId) },
          })
        }
      }

      let episodeId = ''
      let clipCount = 0
      let storyboardCount = 0
      let panelCount = 0
      let videoCount = 0

      for (const episode of sourceEpisodes) {
        const nextEpisode = await tx.novelPromotionEpisode.create({
          data: {
            novelPromotionProjectId: nextProject.id,
            episodeNumber: episode.episodeNumber,
            name: episode.name,
            description: episode.description,
            novelText: cleanedPrompt || episode.novelText,
            audioUrl: episode.audioUrl,
            audioMediaId: episode.audioMediaId,
            srtContent: episode.srtContent,
            speakerVoices: episode.speakerVoices,
          },
        })
        if (!episodeId || episode.id === sourceData.lastEpisodeId) episodeId = nextEpisode.id

        const clipIdMap = new Map<string, string>()
        for (const clip of episode.clips) {
          const nextClip = await tx.novelPromotionClip.create({
            data: {
              episodeId: nextEpisode.id,
              start: clip.start,
              end: clip.end,
              duration: clip.duration,
              summary: clip.summary,
              location: clip.location,
              content: clip.content,
              characters: clip.characters,
              props: clip.props,
              endText: clip.endText,
              shotCount: clip.shotCount,
              startText: clip.startText,
              screenplay: clip.screenplay,
            },
          })
          clipIdMap.set(clip.id, nextClip.id)
          clipCount += 1
        }

        for (const storyboard of episode.storyboards) {
          const nextClipId = clipIdMap.get(storyboard.clipId)
          if (!nextClipId) continue
          const nextStoryboard = await tx.novelPromotionStoryboard.create({
            data: {
              episodeId: nextEpisode.id,
              clipId: nextClipId,
              storyboardImageUrl: storyboard.storyboardImageUrl,
              panelCount: storyboard.panelCount,
              storyboardTextJson: storyboard.storyboardTextJson,
              imageHistory: storyboard.imageHistory,
              candidateImages: storyboard.candidateImages,
              lastError: storyboard.lastError,
              photographyPlan: storyboard.photographyPlan,
            },
          })
          storyboardCount += 1

          for (const panel of storyboard.panels) {
            await tx.novelPromotionPanel.create({
              data: {
                storyboardId: nextStoryboard.id,
                panelIndex: panel.panelIndex,
                panelNumber: panel.panelNumber,
                shotType: panel.shotType,
                cameraMove: panel.cameraMove,
                description: panel.description,
                location: panel.location,
                characters: panel.characters,
                props: panel.props,
                srtSegment: panel.srtSegment,
                srtStart: panel.srtStart,
                srtEnd: panel.srtEnd,
                duration: panel.duration,
                imagePrompt: panel.imagePrompt,
                imageUrl: panel.imageUrl,
                imageMediaId: panel.imageMediaId,
                imageHistory: panel.imageHistory,
                videoPrompt: panel.videoPrompt,
                firstLastFramePrompt: panel.firstLastFramePrompt,
                videoUrl: panel.videoUrl,
                videoGenerationMode: panel.videoGenerationMode,
                videoMediaId: panel.videoMediaId,
                sceneType: panel.sceneType,
                candidateImages: panel.candidateImages,
                linkedToNextPanel: panel.linkedToNextPanel,
                lipSyncTaskId: panel.lipSyncTaskId,
                lipSyncVideoUrl: panel.lipSyncVideoUrl,
                lipSyncVideoMediaId: panel.lipSyncVideoMediaId,
                sketchImageUrl: panel.sketchImageUrl,
                sketchImageMediaId: panel.sketchImageMediaId,
                photographyRules: panel.photographyRules,
                actingNotes: panel.actingNotes,
                previousImageUrl: panel.previousImageUrl,
                previousImageMediaId: panel.previousImageMediaId,
              },
            })
            panelCount += 1
            if (panel.videoUrl) videoCount += 1
          }
        }
      }

      await tx.novelPromotionProject.update({
        where: { id: nextProject.id },
        data: { lastEpisodeId: episodeId || null },
      })

      return {
        projectId: params.targetProjectId,
        episodeId,
        clipCount,
        storyboardCount,
        panelCount,
        videoCount,
        characterCount: sourceData.characters.length,
        locationCount: sourceData.locations.length,
        characterAppearanceCount: sourceData.characters.reduce((sum: number, character: any) => sum + character.appearances.length, 0),
        locationImageCount: sourceData.locations.reduce((sum: number, location: any) => sum + location.images.length, 0),
        propCount: sourceData.locations.filter((location: any) => location.assetKind === 'prop').length,
        propImageCount: sourceData.locations
          .filter((location: any) => location.assetKind === 'prop')
          .reduce((sum: number, location: any) => sum + location.images.length, 0),
      }
    }, { timeout: 30_000 })
  }

  private async executeRecordingReplayMock(
    plan: AgentExecutionPlan,
    context: AgentContext,
    executionId: string,
  ): Promise<AgentExecutionResult> {
    if (!context.targetProjectId) {
      throw new Error('录屏演示 mock 需要在工作区项目内启动')
    }

    let workflowRunId = context.workflowRunId || null
    if (!workflowRunId) {
      const run = await startAgentWorkflowRun({
        userId: context.userId,
        projectId: context.targetProjectId,
        episodeId: null,
        targetId: context.targetProjectId,
        plan,
        userInput: context.userInput,
      })
      workflowRunId = run.id
    }

    const replayProject = await this.findRecordingReplayProject({
      userId: context.userId,
      targetProjectId: context.targetProjectId,
    })
    if (!replayProject?.novelPromotionData) {
      throw new Error('录屏演示 mock 没有可复用的项目产物')
    }

    const cloned = await this.cloneRecordingReplayProjectToTarget({
      sourceProject: replayProject,
      targetProjectId: context.targetProjectId,
      userId: context.userId,
      userInput: context.userInput,
    })

    const stageMessages = [
      { percent: 14, message: '录屏演示 mock：已接收 prompt，并准备项目。' },
      { percent: 36, message: `录屏演示 mock：已复制 TEST 的剧情片段到当前项目，载入 ${cloned.clipCount} 个片段。` },
      { percent: 50, message: `录屏演示 mock：已复制 TEST 的全局资产到当前项目，锁定 ${cloned.characterCount} 个角色、${cloned.locationCount} 个场景。` },
      { percent: 64, message: '录屏演示 mock：资产参考图已复用，不调用生图接口。' },
      { percent: 78, message: `录屏演示 mock：已复制 ${cloned.storyboardCount} 个分镜板、${cloned.panelCount} 个视频提示词。` },
      { percent: 88, message: '录屏演示 mock：已注入每个分镜对应资产 reference。' },
      { percent: 98, message: `录屏演示 mock：当前项目已挂载 ${cloned.videoCount} 个现有视频，不调用 Seedance。` },
    ]

    for (let index = 0; index < plan.stages.length && index < stageMessages.length; index += 1) {
      const stage = plan.stages[index]
      const stageMessage = stageMessages[index]
      stage.status = 'running'
      await recordAgentWorkflowStage({
        runId: workflowRunId,
        userId: context.userId,
        projectId: context.targetProjectId,
        stage,
        status: 'running',
        percent: Math.max(1, stageMessage.percent - 6),
        message: stage.description,
      })
      await delay(RECORDING_REPLAY_STAGE_DELAY_MS)
      stage.status = 'completed'
      await recordAgentWorkflowStage({
        runId: workflowRunId,
        userId: context.userId,
        projectId: context.targetProjectId,
        stage,
        status: 'completed',
        percent: stageMessage.percent,
        message: stageMessage.message,
        details: {
          recordingReplayMock: true,
          replayProjectId: replayProject.id,
          replayProjectName: replayProject.name,
        },
      })
    }

    const stage2Result = {
      characterCount: cloned.characterCount,
      locationCount: cloned.locationCount,
      clipCount: cloned.clipCount,
      hasScript: cloned.clipCount > 0,
    }
    const assetImageGenerationResult = {
      characterAppearanceCount: cloned.characterAppearanceCount,
      locationImageCount: cloned.locationImageCount,
      propImageCount: cloned.propImageCount,
      skippedExistingImageCount: cloned.characterAppearanceCount + cloned.locationImageCount,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      hasAssetImages: cloned.characterAppearanceCount + cloned.locationImageCount > 0,
      taskIds: [],
    }
    const stage3Result = {
      storyboardCount: cloned.storyboardCount,
      panelCount: cloned.panelCount,
      voiceLineCount: 0,
      hasStoryboard: cloned.panelCount > 0,
    }
    const imageGenerationResult = {
      panelCount: cloned.panelCount,
      skippedExistingImageCount: 0,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      hasImages: false,
      taskIds: [],
    }
    const videoGenerationResult = {
      panelCount: cloned.panelCount,
      skippedMissingImageCount: 0,
      skippedExistingVideoCount: cloned.videoCount,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      hasVideos: cloned.videoCount > 0,
      taskIds: [],
    }

    const result: AgentExecutionResult = {
      executionId,
      projectId: cloned.projectId,
      episodeId: cloned.episodeId,
      status: 'completed',
      stageResults: {
        stage1: {
          projectId: cloned.projectId,
          episodeId: cloned.episodeId,
          hasStory: true,
        },
        stage2: stage2Result,
        assetConsistency: {
          characterCount: cloned.characterCount,
          locationCount: cloned.locationCount,
          propCount: cloned.propCount,
          clipCount: cloned.clipCount,
          hasConsistencyBrief: true,
          characterAppearanceCount: cloned.characterAppearanceCount,
          locationImageSlotCount: cloned.locationImageCount,
          propImageSlotCount: cloned.propImageCount,
        },
        assetImageGeneration: assetImageGenerationResult,
        stage3: stage3Result,
        imageGeneration: imageGenerationResult,
        videoGeneration: videoGenerationResult,
      },
      workspaceUrl: buildWorkspaceUrl({
        locale: context.locale,
        projectId: cloned.projectId,
        episodeId: cloned.episodeId,
        hasVideos: videoGenerationResult.hasVideos,
      }),
      summary: this.generateSummary(
        stage2Result,
        stage3Result,
        imageGenerationResult,
        videoGenerationResult,
        assetImageGenerationResult,
      ),
      errors: [],
    }

    await completeAgentWorkflowRun({
      runId: workflowRunId,
      userId: context.userId,
      result,
      plan,
    })

    return result
  }

  private async executeAssetConsistencyStage(
    projectId: string,
    episodeId: string,
    plan: AgentExecutionPlan,
    context: AgentContext,
  ): Promise<{
    characterCount: number
    locationCount: number
    propCount: number
    clipCount: number
    hasConsistencyBrief: boolean
    characterAppearanceCount: number
    locationImageSlotCount: number
    propImageSlotCount: number
  }> {
    const [project, episode] = await Promise.all([
      prisma.novelPromotionProject.findUnique({
        where: { projectId },
        include: {
          characters: {
            include: {
              appearances: true,
            },
          },
          locations: {
            include: {
              images: true,
            },
          },
        },
      }),
      prisma.novelPromotionEpisode.findUnique({
        where: { id: episodeId },
        include: {
          clips: {
            orderBy: { start: 'asc' },
          },
        },
      }),
    ])

    if (!project) {
      throw new Error(`NovelPromotionProject not found: ${projectId}`)
    }

    const clips = episode?.clips || []
    if (clips.length === 0) {
      throw new Error('Agent asset consistency requires script clips before storyboard generation')
    }

    const scriptText = clips.map((clip) => firstNonEmpty([clip.summary, clip.content, clip.screenplay])).join(' ')
    const scriptDigest = summarizeAssetSubject(scriptText)
    const assetIntentCritic = inferAgentAssetIntentCritic([
      context.userInput,
      plan.projectConfig.artStylePrompt,
      plan.episodeConfig.novelText,
      scriptText,
    ])
    const extractedCharacterNames = uniqueStrings(clips.flatMap((clip) => parseJsonStringArray(clip.characters)))
    const extractedLocationNames = uniqueStrings(clips.map((clip) => clip.location || '').filter(Boolean))
    const extractedPropNames = uniqueStrings(clips.flatMap((clip) => parseJsonStringArray(clip.props)))
    const isCommercial = isCommercialAgentSkill(plan.selectedSkill)
    const productSubject = plan.selectedSkill === 'product-promo' && extractedPropNames.length === 0
      ? inferProductSubjectFromScript(scriptText) || normalizeAssetName(scriptDigest, '核心商品')
      : ''

    const existingCharacterNames = new Set((project.characters || [])
      .map((item) => item.name?.trim().toLowerCase())
      .filter((item): item is string => Boolean(item)))
    const existingLocationNames = new Set((project.locations || [])
      .filter((item) => item.assetKind !== 'prop')
      .map((item) => item.name?.trim().toLowerCase())
      .filter((item): item is string => Boolean(item)))
    const existingPropNames = new Set((project.locations || [])
      .filter((item) => item.assetKind === 'prop')
      .map((item) => item.name?.trim().toLowerCase())
      .filter((item): item is string => Boolean(item)))

    const createdCharacters = []
    for (const name of extractedCharacterNames) {
      if (existingCharacterNames.has(name.toLowerCase())) continue
      const created = await prisma.novelPromotionCharacter.create({
        data: {
          novelPromotionProjectId: project.id,
          name,
          aliases: JSON.stringify([name]),
          introduction: `从脚本片段抽取的角色资产，用于分镜、图像和视频保持外观与称呼一致。脚本依据：${scriptDigest}`,
          profileData: JSON.stringify({
            source: 'super-agent-script-assets',
            scriptEvidence: scriptDigest,
          }),
          profileConfirmed: true,
        },
      })
      createdCharacters.push(created)
      existingCharacterNames.add(name.toLowerCase())
    }

    const createdLocations = []
    const locationNamesToEnsure = extractedLocationNames.length > 0 ? extractedLocationNames : [assetIntentCritic.defaultLocationName]
    for (const name of locationNamesToEnsure) {
      const normalizedName = normalizeAssetName(name, assetIntentCritic.defaultLocationName)
      if (existingLocationNames.has(normalizedName.toLowerCase())) continue
      const summary = decorateLocationSummaryWithIntent(
        `从脚本片段抽取的场景资产。后续分镜必须复用该场景的光线、空间关系和项目视觉风格。脚本依据：${scriptDigest}`,
        assetIntentCritic,
      )
      const created = await prisma.novelPromotionLocation.create({
        data: {
          novelPromotionProjectId: project.id,
          name: normalizedName,
          assetKind: 'location',
          summary,
        },
      })
      createdLocations.push(created)
      existingLocationNames.add(normalizedName.toLowerCase())
    }

    const createdProps = []
    const propNamesToEnsure = uniqueStrings([
      ...extractedPropNames,
      ...(productSubject ? [`核心商品：${productSubject}`] : []),
    ])
    for (const name of propNamesToEnsure) {
      const normalizedName = normalizeAssetName(name, '核心商品')
      if (existingPropNames.has(normalizedName.toLowerCase())) continue
      const created = await prisma.novelPromotionLocation.create({
        data: {
          novelPromotionProjectId: project.id,
          name: normalizedName,
          assetKind: 'prop',
          summary: isCommercial
            ? `从脚本片段抽取的商品/道具资产。后续视频必须保持同一外观、材质、图案和核心展示方式。脚本依据：${scriptDigest}`
            : `从脚本片段抽取的剧情道具资产。后续视频必须保持同一外观、材质、颜色和故事中的使用方式。脚本依据：${scriptDigest}`,
        },
      })
      createdProps.push(created)
      existingPropNames.add(normalizedName.toLowerCase())
    }

    const existingLocationsWithCritic = []
    for (const location of (project.locations || []).filter((item) => item.assetKind !== 'prop')) {
      const summary = decorateLocationSummaryWithIntent(location.summary || '', assetIntentCritic)
      if (summary !== (location.summary || '').trim()) {
        await prisma.novelPromotionLocation.update({
          where: { id: location.id },
          data: { summary },
        })
      }
      existingLocationsWithCritic.push({
        ...location,
        summary,
      })
    }

    const characters = [...(project.characters || []), ...createdCharacters]
    const locations = [
      ...existingLocationsWithCritic,
      ...createdLocations,
    ]
    const props = [
      ...(project.locations || []).filter((item) => item.assetKind === 'prop'),
      ...createdProps,
    ]

    if (characters.length + locations.length + props.length === 0) {
      throw new Error('Agent asset consistency produced no script-derived assets')
    }

    const characterLines = characters.map((character) => {
      const intro = character.introduction?.trim()
      return `- ${character.name}${intro ? `：${intro}` : ''}`
    })
    const locationLines = locations.map((location) => {
      const summary = location.summary?.trim()
      return `- ${location.name}${summary ? `：${summary}` : ''}`
    })
    const clipLines = (episode?.clips || []).map((clip, index) => (
      `- ${index + 1}. ${clip.summary}`
    ))
    const brief = [
      AGENT_ASSET_BRIEF_START,
      `Workflow：脚本已先完成并锁定；后续分镜、图片和视频必须复用本简报中的角色、场景、商品/道具设定。`,
      `Skill：${plan.selectedSkill}；目标比例：${plan.projectConfig.videoRatio}；计划镜头数：${plan.creativeParameters.shotCount ?? 3}；单镜头关键分镜：${plan.creativeParameters.panelsPerShot ?? 1}。`,
      `视觉一致性：${plan.projectConfig.artStylePrompt || '保持同一光线、色调、镜头质感和主体外观。'}`,
      `地域/语言 critic：${assetIntentCritic.regionLabel}。${assetIntentCritic.regionConstraint} 环境文字要求：${assetIntentCritic.environmentSignage}。`,
      `脚本片段：\n${clipLines.length > 0 ? clipLines.join('\n') : '- 暂无脚本片段'}`,
      `角色资产：\n${characterLines.length > 0 ? characterLines.join('\n') : (isCommercial ? '- 无固定角色，使用旁白或产品主体承载画面' : '- 无固定角色，使用场景和旁白承载画面')}`,
      `场景资产：\n${locationLines.length > 0 ? locationLines.join('\n') : '- 无固定场景，按故事需要建立统一空间和光线'}`,
      `${isCommercial ? '商品/道具资产' : '剧情道具资产'}：\n${props.length > 0 ? props.map((item) => `- ${item.name}${item.summary ? `：${item.summary}` : ''}`).join('\n') : (isCommercial ? '- 暂无独立商品/道具资产，按脚本主体保持一致' : '- 无需要独立建模的关键道具')}`,
      isCommercial
        ? `分镜约束：宣发短片只保留能推进产品展示、信息传达和行动号召的关键画面，避免把同一动作拆成过多相似分镜。`
        : `分镜约束：故事短片必须按叙事节拍推进，先片段后分镜；每个片段内用多个分镜表现动作、反应、道具状态变化和情绪结果。`,
      AGENT_ASSET_BRIEF_END,
    ].join('\n')

    await prisma.novelPromotionProject.update({
      where: { id: project.id },
      data: {
        globalAssetText: replaceAgentAssetBrief(project.globalAssetText, brief),
      },
    })

    const placeholderResult = await this.ensureProjectAssetImagePlaceholders(project.id, plan, scriptDigest)

    return {
      characterCount: characters.length,
      locationCount: locations.length,
      propCount: props.length,
      clipCount: episode?.clips.length || 0,
      hasConsistencyBrief: true,
      characterAppearanceCount: placeholderResult.characterAppearanceCount,
      locationImageSlotCount: placeholderResult.locationImageSlotCount,
      propImageSlotCount: placeholderResult.propImageSlotCount,
    }
  }

  private async ensureProjectAssetImagePlaceholders(
    novelPromotionProjectId: string,
    plan: AgentExecutionPlan,
    scriptDigest: string,
  ): Promise<{
    characterAppearanceCount: number
    locationImageSlotCount: number
    propImageSlotCount: number
  }> {
    const [characters, locations] = await Promise.all([
      prisma.novelPromotionCharacter.findMany({
        where: { novelPromotionProjectId },
        include: {
          appearances: {
            orderBy: { appearanceIndex: 'asc' },
          },
        },
      }),
      prisma.novelPromotionLocation.findMany({
        where: { novelPromotionProjectId },
        include: {
          images: {
            orderBy: { imageIndex: 'asc' },
          },
        },
      }),
    ])

    const realisticAgentPlan = isRealisticAgentPlan(plan)
    const characterAssetStylePrompt = (plan.projectConfig.artStylePrompt || '保持项目统一美术风格')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/重点锁定|角色资产|锁定\s*[A-Za-z\u4e00-\u9fa5、，,.\s]+的角色/.test(line))
      .join('\n') || '保持项目统一美术风格'

    for (const character of characters) {
      if ((character.appearances || []).length > 0) continue
      const visualDescription = [
        `角色名：${character.name}`,
        character.introduction ? `角色设定：${character.introduction}` : null,
        `故事依据：${scriptDigest}`,
        `视觉风格：${characterAssetStylePrompt}`,
        realisticAgentPlan
          ? '真实真人短剧角色资产：必须是单个真实欧美真人角色的摄影级设定图，真实皮肤、真实头发、真实服装材质，符合现代美国医疗短剧语境。'
          : null,
        `画面主体：以 ${character.name} 为唯一角色对象，生成该角色的设定图，不要混入其他角色。`,
        '要求：生成用于全局一致性的角色设定图，保持可复用、清晰、无具体分镜动作。',
        realisticAgentPlan
          ? '负面要求：不要漫画、不要动漫、不要插画、不要卡通、不要二次元、不要多人合照、不要把其他角色画进同一张角色资产。'
          : null,
      ].filter(Boolean).join('\n')

      await prisma.characterAppearance.create({
        data: {
          characterId: character.id,
          appearanceIndex: 0,
          changeReason: '初始形象',
          description: visualDescription,
          descriptions: JSON.stringify([visualDescription]),
          imageUrls: encodeImageUrls([]),
          previousImageUrls: encodeImageUrls([]),
          selectedIndex: 0,
        },
      })
    }

    for (const location of locations) {
      if ((location.images || []).length > 0) continue
      const isProp = location.assetKind === 'prop'
      const description = [
        isProp ? `道具/商品：${location.name}` : `场景：${location.name}`,
        location.summary ? `设定：${location.summary}` : null,
        `故事依据：${scriptDigest}`,
        `视觉风格：${plan.projectConfig.artStylePrompt || '保持项目统一美术风格'}`,
        isProp
          ? '要求：生成干净背景的道具/商品资产图，不包含具体分镜动作。'
          : '要求：生成场景空间调性资产图，定义空间结构、光线和色彩，不包含具体分镜动作。',
      ].filter(Boolean).join('\n')

      await prisma.locationImage.create({
        data: {
          locationId: location.id,
          imageIndex: 0,
          description,
          isSelected: true,
        },
      })
    }

    const [freshCharacters, freshLocations] = await Promise.all([
      prisma.novelPromotionCharacter.findMany({
        where: { novelPromotionProjectId },
        include: { appearances: true },
      }),
      prisma.novelPromotionLocation.findMany({
        where: { novelPromotionProjectId },
        include: { images: true },
      }),
    ])

    return {
      characterAppearanceCount: freshCharacters.reduce(
        (sum, character) => sum + (character.appearances?.length || 0),
        0,
      ),
      locationImageSlotCount: freshLocations
        .filter((location) => location.assetKind !== 'prop')
        .reduce((sum, location) => sum + (location.images?.length || 0), 0),
      propImageSlotCount: freshLocations
        .filter((location) => location.assetKind === 'prop')
        .reduce((sum, location) => sum + (location.images?.length || 0), 0),
    }
  }

  /**
   * 阶段 1：项目初始化
   */
  private async executeStage1(
    plan: AgentExecutionPlan,
    context: AgentContext
  ): Promise<{
    projectId: string
    episodeId: string
    hasStory: boolean
  }> {
    const userConfig = await getUserModelConfig(context.userId)

    if (context.targetProjectId) {
      const targetProject = await prisma.project.findFirst({
        where: {
          id: context.targetProjectId,
          userId: context.userId,
        },
        include: {
          novelPromotionData: true,
        },
      })

      if (!targetProject) {
        throw new Error(`Target project not found: ${context.targetProjectId}`)
      }

      await prisma.project.update({
        where: { id: targetProject.id },
        data: {
          name: targetProject.name,
          description: `Created by Super Agent (${plan.executionMode})`,
        },
      })

      const novelPromotionProject = targetProject.novelPromotionData
        ? await prisma.novelPromotionProject.update({
          where: { id: targetProject.novelPromotionData.id },
          data: {
            videoRatio: plan.projectConfig.videoRatio,
            artStyle: plan.projectConfig.artStyle,
            artStylePrompt: plan.projectConfig.artStylePrompt,
            analysisModel: userConfig.analysisModel,
            characterModel: userConfig.characterModel,
            locationModel: userConfig.locationModel,
            storyboardModel: userConfig.storyboardModel,
            editModel: userConfig.editModel,
            videoModel: userConfig.videoModel,
            audioModel: userConfig.audioModel,
            videoResolution: '1080p',
            imageResolution: '2K',
            workflowMode: 'agent',
            importStatus: 'completed',
          },
        })
        : await prisma.novelPromotionProject.create({
          data: {
            projectId: targetProject.id,
            videoRatio: plan.projectConfig.videoRatio,
            artStyle: plan.projectConfig.artStyle,
            artStylePrompt: plan.projectConfig.artStylePrompt,
            analysisModel: userConfig.analysisModel,
            characterModel: userConfig.characterModel,
            locationModel: userConfig.locationModel,
            storyboardModel: userConfig.storyboardModel,
            editModel: userConfig.editModel,
            videoModel: userConfig.videoModel,
            audioModel: userConfig.audioModel,
            videoResolution: '1080p',
            imageResolution: '2K',
            workflowMode: 'agent',
            importStatus: 'completed',
          },
        })

      const firstEpisode = await prisma.novelPromotionEpisode.findFirst({
        where: { novelPromotionProjectId: novelPromotionProject.id },
        orderBy: { episodeNumber: 'asc' },
        include: {
          clips: { take: 1 },
          storyboards: { take: 1 },
        },
      })

      let episode
      if (firstEpisode && isReusableBlankEpisode(firstEpisode)) {
        episode = await prisma.novelPromotionEpisode.update({
          where: { id: firstEpisode.id },
          data: {
            name: plan.episodeConfig.name,
            novelText: plan.episodeConfig.novelText,
          },
        })
      } else {
        episode = await this.createNextAgentEpisode(
          novelPromotionProject.id,
          plan.episodeConfig.name,
          plan.episodeConfig.novelText,
        )
      }

      await prisma.novelPromotionProject.update({
        where: { id: novelPromotionProject.id },
        data: { lastEpisodeId: episode.id },
      })

      return {
        projectId: targetProject.id,
        episodeId: episode.id,
        hasStory: true,
      }
    }

    // 1. 创建 Project
    const project = await prisma.project.create({
      data: {
        name: plan.projectConfig.name,
        description: `Created by Super Agent (${plan.executionMode})`,
        userId: context.userId,
      },
    })

    // 2. 创建 NovelPromotionProject
    const novelPromotionProject = await prisma.novelPromotionProject.create({
      data: {
        projectId: project.id,
        videoRatio: plan.projectConfig.videoRatio,
        artStyle: plan.projectConfig.artStyle,
        artStylePrompt: plan.projectConfig.artStylePrompt,
        analysisModel: userConfig.analysisModel,
        characterModel: userConfig.characterModel,
        locationModel: userConfig.locationModel,
        storyboardModel: userConfig.storyboardModel,
        editModel: userConfig.editModel,
        videoModel: userConfig.videoModel,
        audioModel: userConfig.audioModel,
        videoResolution: '1080p',
        imageResolution: '2K',
        workflowMode: 'agent',
        importStatus: 'completed',
      },
    })

    // 3. 创建 Episode（使用 NovelPromotionProject.id）
    const episode = await this.createNextAgentEpisode(
      novelPromotionProject.id,
      plan.episodeConfig.name,
      plan.episodeConfig.novelText,
    )

    await prisma.novelPromotionProject.update({
      where: { id: novelPromotionProject.id },
      data: { lastEpisodeId: episode.id },
    })

    return {
      projectId: project.id,
      episodeId: episode.id,
      hasStory: true,
    }
  }

  private async createNextAgentEpisode(
    novelPromotionProjectId: string,
    name: string,
    novelText: string,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const lastEpisode = await prisma.novelPromotionEpisode.findFirst({
        where: { novelPromotionProjectId },
        orderBy: { episodeNumber: 'desc' },
      })
      try {
        return await prisma.novelPromotionEpisode.create({
          data: {
            novelPromotionProjectId,
            episodeNumber: (lastEpisode?.episodeNumber || 0) + 1,
            name,
            novelText,
          },
        })
      } catch (error) {
        if (!isEpisodeNumberUniqueConflict(error) || attempt === 2) {
          throw error
        }
      }
    }

    throw new Error('Failed to create Agent episode')
  }

  /**
   * 阶段 2：故事分析与剧本生成
   */
  private async executeStage2(
    projectId: string,
    episodeId: string,
    context: AgentContext,
    plan: AgentExecutionPlan,
  ): Promise<{
    characterCount: number
    locationCount: number
    clipCount: number
    hasScript: boolean
  }> {
    if (isStructuredShotScript(context.userInput) || plan.creativeParameters.storyboardOnly === true) {
      const sourceText = context.userInput
      return await persistAgentLlmStage2({
        projectId,
        episodeId,
        sourceText,
        plan,
        callLlm: (systemPrompt, userPrompt, options) => llmClient.callLLM(context.userId, systemPrompt, userPrompt, {
          ...options,
          action: options?.action || 'super-agent.stage2',
          projectId,
        }),
      })
    }

    // 通过正式任务入口提交，确保 GraphRun 会绑定 Task 并进入 worker 队列。
    const task = await submitTask({
      userId: context.userId,
      locale: normalizeLocale(context.locale),
      projectId,
      episodeId,
      type: TASK_TYPE.STORY_TO_SCRIPT_RUN,
      targetType: 'episode',
      targetId: episodeId,
      payload: {
        episodeId,
        content: plan.episodeConfig.novelText || context.userInput,
        disableAgentStoryPackageFastPath: true,
      },
    })
    if (!task.runId) {
      throw new Error('Failed to create story-to-script run')
    }

    // 等待 Run 完成
    await this.waitForRunCompletion(task.runId, 300000) // 5 分钟超时

    // 验证结果
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        clips: true,
      },
    })

    const project = await prisma.novelPromotionProject.findUnique({
      where: { projectId },
      include: {
        characters: true,
        locations: true,
      },
    })

    const readiness = resolveEpisodeStageArtifacts(episode)

    return {
      characterCount: project?.characters.length || 0,
      locationCount: project?.locations.length || 0,
      clipCount: episode?.clips.length || 0,
      hasScript: readiness.hasScript,
    }
  }

  /**
   * 阶段 3：分镜生成
   */
  private async executeStage3(
    projectId: string,
    episodeId: string,
    context: AgentContext,
    plan: AgentExecutionPlan,
    workflowRunId?: string | null,
  ): Promise<{
    storyboardCount: number
    panelCount: number
    voiceLineCount: number
    hasStoryboard: boolean
  }> {
    void projectId
    if (isStructuredShotScript(context.userInput) || plan.creativeParameters.storyboardOnly) {
      const sourceText = isStructuredShotScript(context.userInput)
        ? context.userInput
        : (plan.episodeConfig.novelText || context.userInput)
      return await persistAgentLlmStage3({
        episodeId,
        sourceText,
        plan,
        callLlm: (systemPrompt, userPrompt, options) => llmClient.callLLM(context.userId, systemPrompt, userPrompt, {
          ...options,
          action: options?.action || 'super-agent.stage3',
          projectId,
        }),
        onProgress: async (progress) => {
          if (!workflowRunId) return
          const clipRatio = progress.clipCount > 0
            ? Math.max(0, Math.min(1, (progress.clipIndex - (progress.status === 'completed' ? 0 : 0.5)) / progress.clipCount))
            : 0
          const percent = 70 + Math.round(clipRatio * 7)
          const statusText = progress.status === 'completed'
            ? `已完成第 ${progress.clipIndex}/${progress.clipCount} 个剧情片段，生成 ${progress.generatedPanelCount || 0} 个视频分镜提示词。`
            : progress.status === 'failed'
              ? `第 ${progress.clipIndex}/${progress.clipCount} 个剧情片段生成失败，已使用规则兜底生成可编辑分镜。`
              : `正在生成第 ${progress.clipIndex}/${progress.clipCount} 个剧情片段的视频分镜提示词：${progress.clipTitle}`
          await recordAgentWorkflowStage({
            runId: workflowRunId,
            userId: context.userId,
            projectId,
            stage: plan.stages[4],
            status: 'running',
            percent,
            message: statusText,
            details: {
              clipIndex: progress.clipIndex,
              clipCount: progress.clipCount,
              clipTitle: progress.clipTitle,
              status: progress.status,
              generatedPanelCount: progress.generatedPanelCount || 0,
            },
          })
        },
      })
    }

    // 通过正式任务入口提交，确保 GraphRun 会绑定 Task 并进入 worker 队列。
    const task = await submitTask({
      userId: context.userId,
      locale: normalizeLocale(context.locale),
      projectId,
      episodeId,
      type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
      targetType: 'episode',
      targetId: episodeId,
      payload: { episodeId },
    })
    if (!task.runId) {
      throw new Error('Failed to create script-to-storyboard run')
    }

    // 等待 Run 完成
    await this.waitForRunCompletion(task.runId, 600000) // 10 分钟超时
    await this.enforceStoryboardBudget(episodeId, plan.creativeParameters.panelsPerShot)

    // 验证结果
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        storyboards: {
          include: {
            panels: true,
          },
        },
        voiceLines: true,
      },
    })

    const readiness = resolveEpisodeStageArtifacts(episode)

    const panelCount = episode?.storyboards.reduce(
      (sum, sb) => sum + (sb.panels?.length || 0),
      0
    ) || 0

    return {
      storyboardCount: episode?.storyboards.length || 0,
      panelCount,
      voiceLineCount: episode?.voiceLines.length || 0,
      hasStoryboard: readiness.hasStoryboard,
    }
  }

  private async ensureAgentPanelVideoPromptFormat(episodeId: string): Promise<{ updatedPanelCount: number }> {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        clips: {
          orderBy: { start: 'asc' },
        },
        storyboards: {
          orderBy: { createdAt: 'asc' },
          include: {
            panels: {
              orderBy: { panelIndex: 'asc' },
            },
          },
        },
      },
    })
    if (!episode) return { updatedPanelCount: 0 }

    let updatedPanelCount = 0
    const clips = episode.clips || []
    for (const storyboard of episode.storyboards || []) {
      const clip = clips.find((item) => item.id === storyboard.clipId) || null
      for (const panel of storyboard.panels || []) {
        const normalized = ensureAgentPanelVideoPrompt({
          panelNumber: panel.panelNumber,
          description: panel.description,
          location: panel.location,
          characters: panel.characters,
          props: panel.props,
          shotType: panel.shotType,
          cameraMove: panel.cameraMove,
          sourceText: panel.srtSegment,
          videoPrompt: panel.videoPrompt,
          duration: panel.duration,
          clipContent: clip?.content || null,
        })
        if (!normalized.changed && panel.duration === normalized.duration) continue
        await prisma.novelPromotionPanel.update({
          where: { id: panel.id },
          data: {
            videoPrompt: normalized.videoPrompt,
            duration: normalized.duration,
          },
        })
        updatedPanelCount += 1
      }
    }

    return { updatedPanelCount }
  }

  private async enforceStoryboardBudget(episodeId: string, panelsPerShot: number | undefined): Promise<void> {
    const maxPanels = Math.min(8, Math.max(1, Math.round(panelsPerShot || 1)))
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
      where: { episodeId },
      include: {
        panels: {
          orderBy: { panelIndex: 'asc' },
        },
      },
    })

    for (const storyboard of storyboards) {
      const hasAgentTimedPanels = (storyboard.panels || []).some((panel) => (
        typeof panel.videoPrompt === 'string'
        && panel.videoPrompt.includes('\n执行要求：严格执行本 video_prompt')
        && /\n\d+(?:\.\d+)?-\d+(?:\.\d+)?s[：:]/.test(panel.videoPrompt)
      ))
      if (hasAgentTimedPanels) continue
      if ((storyboard.panels || []).length <= maxPanels) continue
      const keep = storyboard.panels.slice(0, maxPanels)
      const remove = storyboard.panels.slice(maxPanels)
      await prisma.$transaction(async (tx) => {
        await tx.novelPromotionPanel.deleteMany({
          where: { id: { in: remove.map((panel) => panel.id) } },
        })
        for (let index = 0; index < keep.length; index += 1) {
          await tx.novelPromotionPanel.update({
            where: { id: keep[index].id },
            data: {
              panelIndex: index,
              panelNumber: index + 1,
            },
          })
        }
        await tx.novelPromotionStoryboard.update({
          where: { id: storyboard.id },
          data: { panelCount: keep.length },
        })
      })
    }
  }

  private async executeMockImageGenerationStage(episodeId: string): Promise<{
    panelCount: number
    skippedExistingImageCount: number
    submittedTaskCount: number
    completedTaskCount: number
    failedTaskCount: number
    hasImages: boolean
    taskIds: string[]
  }> {
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
      where: { episodeId },
      include: { panels: true },
    })
    const panels = storyboards.flatMap((storyboard) => storyboard.panels || [])
    const panelsWithImages = panels.filter((panel) => Boolean(panel.imageUrl || panel.imageMediaId)).length
    return {
      panelCount: panels.length,
      skippedExistingImageCount: panelsWithImages,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      hasImages: panels.length > 0 && panelsWithImages === panels.length,
      taskIds: [],
    }
  }

  private async executeMockAssetImageGenerationStage(projectId: string): Promise<AssetImageGenerationStageResult> {
    const project = await prisma.novelPromotionProject.findUnique({
      where: { projectId },
      include: {
        characters: {
          include: { appearances: true },
        },
        locations: {
          include: { images: true },
        },
      },
    })
    const appearances = project?.characters.flatMap((character) => character.appearances || []) || []
    const locationImages = project?.locations
      .filter((location) => location.assetKind !== 'prop')
      .flatMap((location) => location.images || []) || []
    const propImages = project?.locations
      .filter((location) => location.assetKind === 'prop')
      .flatMap((location) => location.images || []) || []
    return {
      characterAppearanceCount: appearances.length,
      locationImageCount: locationImages.length,
      propImageCount: propImages.length,
      skippedExistingImageCount: 0,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      hasAssetImages: false,
      taskIds: [],
    }
  }

  private async executeAssetImageGenerationStage(
    projectId: string,
    context: AgentContext,
    onTaskProgress?: (progress: TaskCompletionProgress) => Promise<void>,
  ): Promise<AssetImageGenerationStageResult> {
    const project = await prisma.novelPromotionProject.findUnique({
      where: { projectId },
      include: {
        characters: {
          include: {
            appearances: {
              orderBy: { appearanceIndex: 'asc' },
            },
          },
        },
        locations: {
          include: {
            images: {
              orderBy: { imageIndex: 'asc' },
            },
          },
        },
      },
    })

    if (!project) {
      throw new Error(`NovelPromotionProject not found: ${projectId}`)
    }

    const appearances = project.characters.flatMap((character) => character.appearances || [])
    const locationImages = project.locations
      .filter((location) => location.assetKind !== 'prop')
      .flatMap((location) => (location.images || []).map((image) => ({ ...image, assetKind: 'location' as const })))
    const propImages = project.locations
      .filter((location) => location.assetKind === 'prop')
      .flatMap((location) => (location.images || []).map((image) => ({ ...image, assetKind: 'prop' as const })))

    const projectModelConfig = await getProjectModelConfig(projectId, context.userId)
    if (appearances.length > 0 && !projectModelConfig.characterModel) {
      throw new Error('Character image model is not configured')
    }
    if ((locationImages.length > 0 || propImages.length > 0) && !projectModelConfig.locationModel) {
      throw new Error('Location/prop image model is not configured')
    }
    if (projectModelConfig.characterModel) {
      try {
        await resolveModelSelection(context.userId, projectModelConfig.characterModel, 'image')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Character image model is invalid'
        throw new Error(`Character image model is invalid: ${message}`)
      }
    }
    if (projectModelConfig.locationModel) {
      try {
        await resolveModelSelection(context.userId, projectModelConfig.locationModel, 'image')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Location image model is invalid'
        throw new Error(`Location image model is invalid: ${message}`)
      }
    }

    const taskIds: string[] = []
    let skippedExistingImageCount = 0

    for (const appearance of appearances) {
      const hasOutputAtStart = await hasCharacterAppearanceOutput({ appearanceId: appearance.id })
      if (hasOutputAtStart) {
        skippedExistingImageCount += 1
        continue
      }

      const billingPayload = await buildImageBillingPayload({
        projectId,
        userId: context.userId,
        imageModel: projectModelConfig.characterModel,
        basePayload: {
          appearanceId: appearance.id,
          imageIndex: 0,
          count: 1,
        },
      })
      const payload = withTaskUiPayload(billingPayload, {
        intent: 'generate',
        hasOutputAtStart,
      })

      const task = await submitTask({
        userId: context.userId,
        locale: normalizeLocale(context.locale),
        projectId,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        payload,
        dedupeKey: `agent_asset_character:${appearance.id}:0`,
      })
      taskIds.push(task.taskId)
    }

    for (const image of [...locationImages, ...propImages]) {
      const hasOutputAtStart = await hasLocationImageOutput({ imageId: image.id })
      if (hasOutputAtStart) {
        skippedExistingImageCount += 1
        continue
      }

      const billingPayload = await buildImageBillingPayload({
        projectId,
        userId: context.userId,
        imageModel: projectModelConfig.locationModel,
        basePayload: {
          id: image.locationId,
          locationId: image.locationId,
          imageIndex: image.imageIndex,
          count: 1,
          type: image.assetKind,
        },
      })
      const payload = withTaskUiPayload(billingPayload, {
        intent: 'generate',
        hasOutputAtStart,
      })

      const task = await submitTask({
        userId: context.userId,
        locale: normalizeLocale(context.locale),
        projectId,
        type: TASK_TYPE.IMAGE_LOCATION,
        targetType: 'LocationImage',
        targetId: image.id,
        payload,
        dedupeKey: `agent_asset_${image.assetKind}:${image.id}:${image.imageIndex}`,
      })
      taskIds.push(task.taskId)
    }

    const taskCompletion = await this.waitForTaskCompletion(taskIds, 1200000, onTaskProgress)
    const [freshAppearances, freshLocationImages] = await Promise.all([
      prisma.characterAppearance.findMany({
        where: { id: { in: appearances.map((appearance) => appearance.id) } },
        select: {
          id: true,
          imageUrl: true,
          imageUrls: true,
          imageMediaId: true,
        },
      }),
      prisma.locationImage.findMany({
        where: { id: { in: [...locationImages, ...propImages].map((image) => image.id) } },
        select: {
          id: true,
          imageUrl: true,
          imageMediaId: true,
        },
      }),
    ])

    const appearanceImagesReady = freshAppearances.filter((appearance) => (
      Boolean(appearance.imageUrl || appearance.imageMediaId)
      || parseJsonStringArray(appearance.imageUrls).length > 0
    )).length
    const locationImagesReady = freshLocationImages.filter((image) => image.imageUrl || image.imageMediaId).length
    const totalAssetImageSlots = appearances.length + locationImages.length + propImages.length
    const totalAssetImagesReady = appearanceImagesReady + locationImagesReady

    return {
      characterAppearanceCount: appearances.length,
      locationImageCount: locationImages.length,
      propImageCount: propImages.length,
      skippedExistingImageCount,
      submittedTaskCount: taskIds.length,
      completedTaskCount: taskCompletion.completedCount,
      failedTaskCount: taskCompletion.failedCount,
      hasAssetImages: totalAssetImageSlots > 0 && totalAssetImagesReady === totalAssetImageSlots,
      taskIds,
    }
  }

  private async executeImageGenerationStage(
    projectId: string,
    episodeId: string,
    context: AgentContext,
  ): Promise<{
    panelCount: number
    skippedExistingImageCount: number
    submittedTaskCount: number
    completedTaskCount: number
    failedTaskCount: number
    hasImages: boolean
    taskIds: string[]
  }> {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        storyboards: {
          include: {
            panels: {
              orderBy: { panelIndex: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    const panels = episode?.storyboards.flatMap((storyboard) => storyboard.panels || []) || []
    if (panels.length === 0) {
      return {
        panelCount: 0,
        skippedExistingImageCount: 0,
        submittedTaskCount: 0,
        completedTaskCount: 0,
        failedTaskCount: 0,
        hasImages: false,
        taskIds: [],
      }
    }

    const panelsWithExistingImages = []
    const panelsNeedingImages = []
    for (const panel of panels) {
      if (panel.imageUrl || panel.imageMediaId) {
        panelsWithExistingImages.push(panel)
      } else {
        panelsNeedingImages.push(panel)
      }
    }

    if (panelsNeedingImages.length === 0) {
      return {
        panelCount: panels.length,
        skippedExistingImageCount: panelsWithExistingImages.length,
        submittedTaskCount: 0,
        completedTaskCount: 0,
        failedTaskCount: 0,
        hasImages: true,
        taskIds: [],
      }
    }

    const projectModelConfig = await getProjectModelConfig(projectId, context.userId)
    if (!projectModelConfig.storyboardModel) {
      throw new Error('Storyboard image model is not configured')
    }
    try {
      await resolveModelSelection(context.userId, projectModelConfig.storyboardModel, 'image')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Storyboard image model is invalid'
      throw new Error(`Storyboard image model is invalid: ${message}`)
    }

    const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId,
      userId: context.userId,
      modelType: 'image',
      modelKey: projectModelConfig.storyboardModel,
    })

    const taskIds: string[] = []
    for (const panel of panelsNeedingImages) {
      const hasOutputAtStart = await hasPanelImageOutput(panel.id)
      if (hasOutputAtStart) continue

      const payload = withTaskUiPayload({
        panelId: panel.id,
        count: PANEL_IMAGE_CANDIDATE_COUNT,
        candidateCount: PANEL_IMAGE_CANDIDATE_COUNT,
        imageModel: projectModelConfig.storyboardModel,
        ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {}),
      }, {
        intent: 'generate',
        hasOutputAtStart,
      })

      const task = await submitTask({
        userId: context.userId,
        locale: normalizeLocale(context.locale),
        projectId,
        episodeId,
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'NovelPromotionPanel',
        targetId: panel.id,
        payload,
        dedupeKey: `image_panel:${panel.id}:${PANEL_IMAGE_CANDIDATE_COUNT}`,
      })
      taskIds.push(task.taskId)
    }

    const taskCompletion = await this.waitForTaskCompletion(taskIds, 1200000)
    const freshPanels = await prisma.novelPromotionPanel.findMany({
      where: { id: { in: panels.map((panel) => panel.id) } },
      select: {
        id: true,
        imageUrl: true,
        imageMediaId: true,
      },
    })
    const panelsWithImages = freshPanels.filter((panel) => panel.imageUrl || panel.imageMediaId).length

    return {
      panelCount: panels.length,
      skippedExistingImageCount: panelsWithExistingImages.length,
      submittedTaskCount: taskIds.length,
      completedTaskCount: taskCompletion.completedCount,
      failedTaskCount: taskCompletion.failedCount,
      hasImages: panels.length > 0 && panelsWithImages === panels.length,
      taskIds,
    }
  }

  private async executeMockVideoGenerationStage(episodeId: string): Promise<VideoGenerationStageResult> {
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
      where: { episodeId },
      include: { panels: true },
    })
    const panels = storyboards.flatMap((storyboard) => storyboard.panels || [])
    const panelsWithVideos = panels.filter((panel) => panel.videoUrl || panel.videoMediaId).length
    return {
      panelCount: panels.length,
      skippedMissingImageCount: 0,
      skippedExistingVideoCount: panelsWithVideos,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      hasVideos: panels.length > 0 && panelsWithVideos === panels.length,
      taskIds: [],
    }
  }

  private async createVideoGenerationFailureSnapshot(
    episodeId: string,
    options: {
      skippedMissingVideoModel?: boolean
      markReadyPanelsFailed?: boolean
    } = {},
  ): Promise<VideoGenerationStageResult> {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        storyboards: {
          include: {
            panels: {
              orderBy: { panelIndex: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    const panels = episode?.storyboards.flatMap((storyboard) => storyboard.panels || []) || []
    const panelsMissingImages = panels.filter((panel) => !panel.imageUrl && !panel.imageMediaId).length
    const panelsWithVideos = panels.filter((panel) => panel.videoUrl || panel.videoMediaId).length
    const panelsReadyForVideo = panels.length - panelsMissingImages - panelsWithVideos

    return {
      panelCount: panels.length,
      skippedMissingImageCount: panelsMissingImages,
      skippedMissingVideoModel: options.skippedMissingVideoModel === true,
      skippedExistingVideoCount: panelsWithVideos,
      submittedTaskCount: 0,
      completedTaskCount: 0,
      failedTaskCount: options.markReadyPanelsFailed === false ? 0 : Math.max(0, panelsReadyForVideo),
      hasVideos: panels.length > 0 && panelsWithVideos === panels.length,
      taskIds: [],
    }
  }

  private async executeVideoGenerationStage(
    projectId: string,
    episodeId: string,
    context: AgentContext,
    onTaskProgress?: (progress: TaskCompletionProgress) => Promise<void>,
  ): Promise<VideoGenerationStageResult> {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        storyboards: {
          include: {
            panels: {
              orderBy: { panelIndex: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    const panels = episode?.storyboards.flatMap((storyboard) => storyboard.panels || []) || []
    if (panels.length === 0) {
      return {
        panelCount: 0,
        skippedMissingImageCount: 0,
        skippedExistingVideoCount: 0,
        submittedTaskCount: 0,
        completedTaskCount: 0,
        failedTaskCount: 0,
        hasVideos: false,
        taskIds: [],
      }
    }

    const projectModelConfig = await getProjectModelConfig(projectId, context.userId)
    if (!projectModelConfig.videoModel) {
      throw new Error('Video model is not configured')
    }
    try {
      await resolveModelSelection(context.userId, projectModelConfig.videoModel, 'video')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video model is invalid'
      throw new Error(`Video model is invalid: ${message}`)
    }
    const requiresPanelImageInput = !isArkSeedanceVideoModel(projectModelConfig.videoModel)

    const panelsWithExistingVideos = []
    const panelsMissingImages = []
    const panelsNeedingVideos = []
    for (const panel of panels) {
      if (panel.videoUrl || panel.videoMediaId) {
        panelsWithExistingVideos.push(panel)
      } else if (requiresPanelImageInput && !panel.imageUrl && !panel.imageMediaId) {
        panelsMissingImages.push(panel)
      } else {
        panelsNeedingVideos.push(panel)
      }
    }

    if (panelsNeedingVideos.length === 0) {
      return {
        panelCount: panels.length,
        skippedMissingImageCount: panelsMissingImages.length,
        skippedExistingVideoCount: panelsWithExistingVideos.length,
        submittedTaskCount: 0,
        completedTaskCount: 0,
        failedTaskCount: 0,
        hasVideos: panels.length > 0 && panelsWithExistingVideos.length === panels.length,
        taskIds: [],
      }
    }

    const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId,
      userId: context.userId,
      modelType: 'video',
      modelKey: projectModelConfig.videoModel,
    })

    const taskIds: string[] = []
    const videoDurationOptions = resolveBuiltinCapabilitiesByModelKey(
      'video',
      projectModelConfig.videoModel,
    )?.video?.durationOptions
    for (const panel of panelsNeedingVideos) {
      const hasOutputAtStart = await hasPanelVideoOutput(panel.id)
      if (hasOutputAtStart) continue
      const panelCapabilityOptions = withRecommendedVideoDurationOptions({
        duration: panel.duration,
        description: panel.description,
        videoPrompt: panel.videoPrompt,
        firstLastFramePrompt: panel.firstLastFramePrompt,
        srtSegment: panel.srtSegment,
        shotType: panel.shotType,
        cameraMove: panel.cameraMove,
      }, capabilityOptions, videoDurationOptions)

      const payload = withTaskUiPayload({
        panelId: panel.id,
        videoModel: projectModelConfig.videoModel,
        ...(Object.keys(panelCapabilityOptions).length > 0 ? { generationOptions: panelCapabilityOptions } : {}),
      }, {
        intent: 'generate',
        hasOutputAtStart,
      })

      const task = await submitTask({
        userId: context.userId,
        locale: normalizeLocale(context.locale),
        projectId,
        episodeId,
        type: TASK_TYPE.VIDEO_PANEL,
        targetType: 'NovelPromotionPanel',
        targetId: panel.id,
        payload,
        dedupeKey: `video_panel:${panel.id}`,
      })
      taskIds.push(task.taskId)
    }

    const taskCompletion = await this.waitForTaskCompletion(taskIds, 2400000, onTaskProgress)
    const freshPanels = await prisma.novelPromotionPanel.findMany({
      where: { id: { in: panels.map((panel) => panel.id) } },
      select: {
        id: true,
        videoUrl: true,
        videoMediaId: true,
      },
    })
    const panelsWithVideos = freshPanels.filter((panel) => panel.videoUrl || panel.videoMediaId).length

    return {
      panelCount: panels.length,
      skippedMissingImageCount: panelsMissingImages.length,
      skippedExistingVideoCount: panelsWithExistingVideos.length,
      submittedTaskCount: taskIds.length,
      completedTaskCount: taskCompletion.completedCount,
      failedTaskCount: taskCompletion.failedCount,
      hasVideos: panels.length > 0 && panelsWithVideos === panels.length,
      taskIds,
    }
  }

  private async waitForTaskCompletion(
    taskIds: string[],
    timeoutMs: number,
    onProgress?: (progress: TaskCompletionProgress) => Promise<void>,
  ): Promise<{
    completedCount: number
    failedCount: number
  }> {
    if (taskIds.length === 0) {
      return { completedCount: 0, failedCount: 0 }
    }

    const startTime = Date.now()
    const pollInterval = 3000
    const pending = new Set(taskIds)
    let completedCount = 0
    let failedCount = 0
    let lastProgressSignature = ''
    let lastProgressEmitAt = 0

    while (Date.now() - startTime < timeoutMs) {
      const tasks = await prisma.task.findMany({
        where: { id: { in: Array.from(pending) } },
        select: {
          id: true,
          status: true,
          progress: true,
        },
      })

      let queuedCount = 0
      let processingCount = 0
      let activeProgressTotal = 0
      for (const task of tasks) {
        if (!pending.has(task.id)) continue
        if (task.status === TASK_STATUS.COMPLETED) {
          pending.delete(task.id)
          completedCount += 1
        } else if (
          task.status === TASK_STATUS.FAILED ||
          task.status === TASK_STATUS.CANCELED ||
          task.status === TASK_STATUS.DISMISSED
        ) {
          pending.delete(task.id)
          failedCount += 1
        } else {
          if (task.status === TASK_STATUS.PROCESSING) processingCount += 1
          if (task.status === TASK_STATUS.QUEUED) queuedCount += 1
          activeProgressTotal += Math.max(0, Math.min(99, task.progress || 0))
        }
      }

      if (onProgress) {
        const pendingCount = pending.size
        const averageProgress = taskIds.length > 0
          ? Math.round(((completedCount + failedCount) * 100 + activeProgressTotal) / taskIds.length)
          : 100
        const progress: TaskCompletionProgress = {
          totalCount: taskIds.length,
          completedCount,
          failedCount,
          pendingCount,
          queuedCount,
          processingCount,
          averageProgress: Math.max(0, Math.min(100, averageProgress)),
        }
        const signature = `${completedCount}:${failedCount}:${pendingCount}:${queuedCount}:${processingCount}:${progress.averageProgress}`
        const now = Date.now()
        if (signature !== lastProgressSignature || now - lastProgressEmitAt >= 15000) {
          lastProgressSignature = signature
          lastProgressEmitAt = now
          await onProgress(progress)
        }
      }

      if (pending.size === 0) {
        return { completedCount, failedCount }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    return {
      completedCount,
      failedCount: failedCount + pending.size,
    }
  }

  /**
   * 等待 Run 完成
   */
  private async waitForRunCompletion(runId: string, timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 2000 // 2 秒轮询一次

    while (Date.now() - startTime < timeoutMs) {
      const run = await prisma.graphRun.findUnique({
        where: { id: runId },
      })

      if (!run) {
        throw new Error(`Run not found: ${runId}`)
      }

      if (run.status === 'completed') {
        return
      }

      if (run.status === 'failed') {
        throw new Error(`Run failed: ${run.errorMessage || 'Unknown error'}`)
      }

      // 等待后继续轮询
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    throw new Error(`Run timeout after ${timeoutMs}ms`)
  }

  /**
   * 使用 LLM 分析用户输入
   */
  private async analyzeUserInput(context: AgentContext): Promise<LLMAnalysisResult> {
    const skillOptions = skillLibrary.getAllSkills()
      .map((skill) => (
        `- ${skill.id}: ${skill.name}（${skill.description}；关键词：${skill.keywords.join('、')}）`
      ))
      .join('\n')

    const systemPrompt = `你是 NoriVideo 的 AI 助手。分析用户需求，并把短 prompt 扩写为可拍摄故事。

可用的视频类型：
${skillOptions}

请分析用户输入，先判断它是普通故事/童话/剧情短片，还是商品/平台/品牌宣发，并参考“智能创作”的方式把短 prompt 扩写成可拍摄故事。返回 JSON 格式（只返回 JSON，不要其他内容）：
{
  "videoType": "generic",
  "storyText": "扩写后的完整故事正文，第三人称、可拍摄、包含动作和必要台词；如果用户已给完整故事则保留原意并只做轻微影视化整理",
  "videoRatio": "9:16",
  "visualStyle": "可爱温暖的童话动画风格",
  "projectName": "自动生成的项目名",
  "episodeName": "第1集",
  "language": "zh",
  "confidence": 0.95,
  "creativeParameters": {
    "durationSeconds": 30,
    "tone": "温暖、清晰、有故事感",
    "narration": "auto",
    "shotCount": 6,
    "panelsPerShot": 3
  }
}

“智能创作”故事扩写标准：
- 普通故事/童话/剧情短片必须生成 300-800 字故事正文；短关键词输入生成约 400-600 字，已有大纲控制在 500-800 字。
- 故事必须有清楚的开头、发展、结尾或高潮悬念；角色有动机，场景具体，动作和表情能转成分镜。
- 使用第三人称；场景转换可用空行；首次出现角色要有简短介绍；对话用引号并注明说话者。
- 不输出标题、说明、markdown；storyText 直接是故事正文。
- 不额外发明用户未提及且不服务剧情的角色或场景；宁可精炼也不要冗长。
- 商业宣发/平台口播/商品广告可以是短脚本型内容，但仍要给出可拍摄的场景、动作和镜头信息，不要只写卖点列表。

规则：
1. 如果用户明确提供了完整故事，storyText 必须保留原意，不得丢失角色、场景、风格、语言、字幕、音乐、比例等制作约束
2. 如果用户只描述需求，storyText 必须扩写成 300-800 字的可拍摄故事正文，不要只生成一句大纲
3. videoRatio 默认 9:16（竖屏），除非用户明确要求横屏
4. projectName 要简洁有意义
5. confidence 表示识别的置信度（0-1）
6. 视频制作必须遵循：先脚本/片段，再资产一致性设定，再为每个片段生成多个分镜，最后生成图片/视频
7. creativeParameters 必须根据用户 prompt 推理填充；用户没有明确说的字段也要给出合理默认
8. 商品宣发短片要短而聚焦，建议 durationSeconds 15-30、shotCount 3-5、panelsPerShot 1-2，不要把素材拆成过多重复分镜
9. 普通故事、童话、剧情短片不是商业宣发：不要填写 sellingPoints，不要填写 callToAction，不要把剧情道具写成商品卖点
10. 只有商品、平台、品牌、广告、口播推广类需求才允许填写 sellingPoints 和 callToAction
11. narration 只能是 auto、on、off；不确定时使用 auto
12. 中国故事必须保持中国场景、中文生活语境和中文环境标识；英文/欧美故事必须保持国外场景、英文生活语境和英文环境标识
13. 如果用户要求英文口型、不要中文字幕、不要背景音乐，这些约束必须保留在 visualStyle 或 storyText 的语境中`

    const userPrompt = context.userInput

    const response = await llmClient.callLLM(context.userId, systemPrompt, userPrompt, {
      action: 'super-agent.analyze',
    })

    return parseLlmAnalysisResult(response, context.userInput)
  }

  /**
   * 生成摘要
   */
  private generateSummary(
    stage2Result: { characterCount: number; locationCount: number; clipCount: number },
    stage3Result: { storyboardCount: number; panelCount: number; voiceLineCount: number },
    imageGenerationResult?: {
      submittedTaskCount: number
      completedTaskCount: number
      failedTaskCount: number
      hasImages: boolean
    },
    videoGenerationResult?: {
      skippedMissingImageCount: number
      skippedMissingVideoModel?: boolean
      submittedTaskCount: number
      completedTaskCount: number
      failedTaskCount: number
      hasVideos: boolean
    },
    assetImageGenerationResult?: {
      characterAppearanceCount: number
      locationImageCount: number
      propImageCount: number
      submittedTaskCount: number
      completedTaskCount: number
      failedTaskCount: number
      hasAssetImages: boolean
    },
  ): string {
    const assetImageLines = assetImageGenerationResult
      ? [
        `- 资产图槽位：${assetImageGenerationResult.characterAppearanceCount} 个角色形象、${assetImageGenerationResult.locationImageCount} 个场景、${assetImageGenerationResult.propImageCount} 个道具`,
        `- 提交 ${assetImageGenerationResult.submittedTaskCount} 个资产图生成任务`,
        `- 完成 ${assetImageGenerationResult.completedTaskCount} 个资产图任务`,
        assetImageGenerationResult.failedTaskCount > 0
          ? `- 失败 ${assetImageGenerationResult.failedTaskCount} 个资产图任务`
          : `- 资产图状态：${assetImageGenerationResult.hasAssetImages ? '全部已有参考图' : '资产图任务已提交或等待完成'}`,
      ]
      : []
    const imageLines = imageGenerationResult
      ? [
        `- 分镜图生成：已跳过，改用 video_prompt + 资产参考图直出视频`,
        `- 视频资产引用准备：${imageGenerationResult.submittedTaskCount} 个中间图片任务、${imageGenerationResult.completedTaskCount} 个完成`,
        imageGenerationResult.failedTaskCount > 0
          ? `- 失败 ${imageGenerationResult.failedTaskCount} 个中间图片任务`
          : `- 分镜图状态：${imageGenerationResult.hasImages ? '已有图片可作为额外输入' : '不要求中间分镜图'}`,
      ]
      : []
    const videoLines = videoGenerationResult
      ? [
        `- 提交 ${videoGenerationResult.submittedTaskCount} 个视频生成任务`,
        `- 完成 ${videoGenerationResult.completedTaskCount} 个视频任务`,
        videoGenerationResult.failedTaskCount > 0
          ? `- 失败 ${videoGenerationResult.failedTaskCount} 个视频任务`
          : `- 视频状态：${videoGenerationResult.skippedMissingVideoModel ? '未配置视频模型，已跳过视频生成' : (videoGenerationResult.hasVideos ? '全部已有视频' : '视频任务已提交或等待完成')}`,
        videoGenerationResult.skippedMissingImageCount > 0
          ? `- ${videoGenerationResult.skippedMissingImageCount} 个分镜格使用的非 Seedance 模型缺少输入图，暂未生成视频`
          : null,
      ].filter(Boolean)
      : []

    return `已完成项目初始化和内容生成：
- 发现 ${stage2Result.characterCount} 个角色
- 发现 ${stage2Result.locationCount} 个场景
- 生成 ${stage2Result.clipCount} 个片段
- 已写入脚本后的资产一致性简报
${assetImageLines.join('\n')}
- 生成 ${stage3Result.storyboardCount} 个分镜板
- 生成 ${stage3Result.panelCount} 个分镜格
- 生成 ${stage3Result.voiceLineCount} 条配音行
${imageLines.join('\n')}
${videoLines.join('\n')}

你现在可以在工作区中查看和编辑所有内容。`
  }
}
