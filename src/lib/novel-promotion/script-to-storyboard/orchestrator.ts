import { safeParseJsonArray } from '@/lib/json-repair'
import { buildCharactersIntroduction } from '@/lib/constants'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'
import { mapWithConcurrency } from '@/lib/async/map-with-concurrency'
import {
  type ActingDirection,
  type CharacterAsset,
  type ClipCharacterRef,
  type LocationAsset,
  type PropAsset,
  type PhotographyRule,
  type StoryboardPanel,
  formatClipId,
  getFilteredAppearanceList,
  getFilteredFullDescription,
  getFilteredLocationsDescription,
} from '@/lib/storyboard-phases'
import {
  buildPromptAssetContext,
  compileAssetPromptFragments,
} from '@/lib/assets/services/asset-prompt-context'
import {
  DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
  normalizeWorkflowConcurrencyValue,
} from '@/lib/workflow-concurrency'

type JsonRecord = Record<string, unknown>
const orchestratorLogger = createScopedLogger({ module: 'worker.orchestrator.script_to_storyboard' })

export type ScriptToStoryboardStepMeta = {
  stepId: string
  stepAttempt?: number
  stepTitle: string
  stepIndex: number
  stepTotal: number
  dependsOn?: string[]
  groupId?: string
  parallelKey?: string
  retryable?: boolean
  blockedBy?: string[]
}

export type ScriptToStoryboardStepOutput = {
  text: string
  reasoning: string
}

type ClipInput = {
  id: string
  content: string | null
  characters: string | null
  location: string | null
  props?: string | null
  screenplay: string | null
}

export type ScriptToStoryboardPromptTemplates = {
  phase1PlanTemplate: string
  phase2CinematographyTemplate: string
  phase2ActingTemplate: string
  phase3DetailTemplate: string
}

export type ClipStoryboardPanels = {
  clipId: string
  clipIndex: number
  finalPanels: StoryboardPanel[]
}

export type ScriptToStoryboardOrchestratorInput = {
  concurrency?: number
  locale?: 'zh' | 'en'
  clips: ClipInput[]
  novelPromotionData: {
    characters: CharacterAsset[]
    locations: LocationAsset[]
    props?: PropAsset[]
  }
  promptTemplates: ScriptToStoryboardPromptTemplates
  runStep: (
    meta: ScriptToStoryboardStepMeta,
    prompt: string,
    action: string,
    maxOutputTokens: number,
  ) => Promise<ScriptToStoryboardStepOutput>
}

export type ScriptToStoryboardOrchestratorResult = {
  clipPanels: ClipStoryboardPanels[]
  phase1PanelsByClipId: Record<string, StoryboardPanel[]>
  phase2CinematographyByClipId: Record<string, PhotographyRule[]>
  phase2ActingByClipId: Record<string, ActingDirection[]>
  phase3PanelsByClipId: Record<string, StoryboardPanel[]>
  summary: {
    clipCount: number
    totalPanelCount: number
    totalStepCount: number
  }
}


export class JsonParseError extends Error {
  rawText: string
  constructor(message: string, rawText: string) {
    super(message)
    this.name = 'JsonParseError'
    this.rawText = rawText
  }
}

function parseJsonArray<T extends JsonRecord>(responseText: string, label: string): T[] {
  let rows: JsonRecord[]
  try {
    rows = safeParseJsonArray(responseText)
  } catch (error) {
    throw new JsonParseError(error instanceof Error ? error.message : `${label}: JSON parse failed`, responseText)
  }
  if (rows.length === 0) {
    throw new JsonParseError(`${label}: empty result`, responseText)
  }
  return rows as T[]
}

function isFallbackableStoryboardResponseError(error: unknown): boolean {
  if (error instanceof JsonParseError) {
    return error.rawText.trim() === ''
  }
  if (!(error instanceof Error)) return false
  return /returned empty valid panels/i.test(error.message)
}

function fallbackStoryboardPanel(clip: ClipInput): StoryboardPanel {
  const clipContent = clip.content?.trim() || formatClipId(clip)
  return {
    panel_number: 1,
    description: clipContent,
    location: clip.location || '未指定场景',
    source_text: clipContent,
    characters: parseClipCharacters(clip.characters ?? null),
    props: parseClipProps(clip.props ?? null),
    scene_type: '口播',
    shot_type: '中景',
    camera_move: '固定镜头',
    video_prompt: clipContent,
    duration: 4,
  }
}

function fallbackPhotographyRules(panels: StoryboardPanel[]): PhotographyRule[] {
  return panels.map((panel, index) => ({
    panel_number: typeof panel.panel_number === 'number' ? panel.panel_number : index + 1,
    composition: '主体居中，画面保持清晰',
    lighting: '柔和均匀光线',
    color_palette: '自然、干净的品牌色调',
    atmosphere: '专业、可信、易理解',
    technical_notes: '保持口播主体稳定，避免复杂运动',
  }))
}

function fallbackActingDirections(panels: StoryboardPanel[]): ActingDirection[] {
  return panels.map((panel, index) => ({
    panel_number: typeof panel.panel_number === 'number' ? panel.panel_number : index + 1,
    characters: [],
  }))
}

async function withEmptyJsonFallback<T>(
  operation: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isFallbackableStoryboardResponseError(error)) {
      return fallback()
    }
    throw error
  }
}


function parseClipCharacters(raw: string | null): ClipCharacterRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('characters field must be JSON array')
    }
    return parsed as ClipCharacterRef[]
  } catch (error) {
    throw new Error(`Invalid clip characters JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseClipProps(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('props field must be JSON array')
    }
    return parsed.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  } catch (error) {
    throw new Error(`Invalid clip props JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseScreenplay(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid clip screenplay JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function isShortDramaVideoPromptClip(clip: ClipInput): boolean {
  const content = clip.content?.trim() || ''
  const isShotSheetPrompt = content.includes('来源镜头：SH')
    && content.includes('【分镜')
    && content.includes('镜头语言：')
    && content.includes('人物站位：')
  const isBriefPrompt = content.includes('【短剧角色资产保持不变】')
    && content.includes('【本分镜负面要求】')
    && content.includes('镜头语言：')
    && content.includes('人物站位：')
  const isAgentPrompt = content.includes('【Agent 视频分镜提示词】')
    && content.includes('【本分镜负面要求】')
    && content.includes('本分镜使用资产：')
    && content.includes('镜头语言：')
    && content.includes('人物站位：')
  const isCanonicalPrompt = content.startsWith('场景：')
    && content.includes('\n剧情片段：')
    && content.includes('\n执行要求：严格执行本 video_prompt')
    && content.includes('\n本分镜使用资产：')
    && content.includes('\n角色行为拆分：')
    && content.includes('\n人物站位：')
    && content.includes('\n镜头语言：')
    && content.includes('\n【本分镜负面要求】')
  return isShotSheetPrompt || isBriefPrompt || isAgentPrompt || isCanonicalPrompt
}

function readShortDramaDuration(content: string): number {
  const match = content.match(/秒数参考：(\d+(?:\.\d+)?)秒/)
  const rangeEnds = Array.from(content.matchAll(/\n\d+(?:\.\d+)?-(\d+(?:\.\d+)?)s[：:]/g))
    .map((item) => Number(item[1]))
    .filter((item) => Number.isFinite(item))
  const value = Number(match?.[1] || (rangeEnds.length > 0 ? Math.max(...rangeEnds) : 8))
  if (!Number.isFinite(value)) return 8
  return Math.max(2, Math.min(15, value))
}

function buildShortDramaPanelFromClip(clip: ClipInput, panelNumber: number): StoryboardPanel {
  const content = clip.content?.trim() || formatClipId(clip)
  const sourceMatch = content.match(/来源镜头：(SH\d+-SH\d+)/)
  const isAgentPrompt = content.includes('【Agent 视频分镜提示词】') || content.includes('\n执行要求：严格执行本 video_prompt')
  const isFantasy = /童话|森林|萤火虫|小兔子|月亮灯|fantasy|fairy/i.test(content)
  const isChina = /中国故事|中国场景|中文环境标识|中国生活语境/.test(content)
  const isWesternMedical = /现代美国|欧美|英文环境标识|American|hospital|surgery|Dr\.|Nurse/i.test(content)
  return {
    panel_number: panelNumber,
    description: sourceMatch
      ? `${sourceMatch[1]} 的短剧转绘视频提示词块，按内部秒级拆分执行。`
      : isAgentPrompt
        ? 'Agent 生成的视频分镜提示词块，按内部秒级拆分执行。'
        : '短剧转绘视频提示词块，按内部秒级拆分执行。',
    location: clip.location || '未指定场景',
    source_text: content,
    characters: parseClipCharacters(clip.characters ?? null),
    props: parseClipProps(clip.props ?? null),
    scene_type: 'short_drama_remake',
    shot_type: '复刻分镜块',
    camera_move: '按视频提示词内部镜头语言执行',
    video_prompt: content,
    duration: readShortDramaDuration(content),
    photographyPlan: {
      composition: '严格按视频提示词中的人物站位、前景遮挡、景别和构图执行',
      lighting: isFantasy
        ? '柔和月光、温暖微光和童话森林环境光保持一致'
        : isChina
          ? '符合中国真实生活场景的自然光或室内光，按片段场景保持一致'
          : isWesternMedical
            ? '现代美国医院冷白顶灯、手术区或走廊医疗灯光，英文标识环境保持一致'
            : '真实短剧光线，按片段场景保持一致',
      colorPalette: isFantasy
        ? '夜蓝、月光银、萤火虫暖黄绿色，温柔童话质感'
        : isChina
          ? '真实中国生活空间色调，自然、克制、可拍摄'
          : isWesternMedical
            ? '白色、浅蓝和冷绿色医疗色调，真实欧美医疗短剧质感'
            : '真实真人短剧质感，色调按故事地域和场景统一',
      atmosphere: isFantasy
        ? '可爱童话短片，温柔、善良、清澈'
        : isWesternMedical
          ? '欧美医疗短剧，克制紧张，英文口型和专业医疗环境可信'
          : '竖屏短剧，节奏紧凑，情绪明确但不过度夸张',
      technicalNotes: '严格执行 video_prompt；不得新增无关镜头、改变站位、改变角色资产或生成乱码字幕',
    },
    actingNotes: [],
  }
}

function buildShortDramaPanelsFromClip(clip: ClipInput): StoryboardPanel[] {
  return [buildShortDramaPanelFromClip(clip, 1)]
}

function withStepMeta(
  stepId: string,
  stepTitle: string,
  stepIndex: number,
  stepTotal: number,
  extra?: Pick<ScriptToStoryboardStepMeta, 'dependsOn' | 'groupId' | 'parallelKey' | 'retryable' | 'blockedBy'>,
): ScriptToStoryboardStepMeta {
  return {
    stepId,
    stepTitle,
    stepIndex,
    stepTotal,
    ...extra,
  }
}

function mergePanelsWithRules(params: {
  finalPanels: StoryboardPanel[]
  photographyRules: PhotographyRule[]
  actingDirections: ActingDirection[]
}) {
  const { finalPanels, photographyRules, actingDirections } = params
  return finalPanels.map((panel, index) => {
    const rules = photographyRules.find((rule) => rule.panel_number === panel.panel_number)
    if (!rules) {
      throw new Error(`Missing photography rule for panel_number=${String(panel.panel_number)} at index=${index}`)
    }
    const acting = actingDirections.find((item) => item.panel_number === panel.panel_number)
    if (!acting) {
      throw new Error(`Missing acting direction for panel_number=${String(panel.panel_number)} at index=${index}`)
    }

    return {
      ...panel,
      photographyPlan: {
        composition: rules.composition,
        lighting: rules.lighting,
        colorPalette: rules.color_palette,
        atmosphere: rules.atmosphere,
        technicalNotes: rules.technical_notes,
      },
      actingNotes: acting.characters,
    }
  })
}

const MAX_STEP_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 10_000

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeRetryDelayMs(attempt: number) {
  const base = Math.min(1_000 * Math.pow(2, Math.max(0, attempt - 1)), MAX_RETRY_DELAY_MS)
  const jitter = Math.floor(Math.random() * 300)
  return base + jitter
}

function shouldRetryStepError(error: unknown, message: string, retryable: boolean) {
  if (error instanceof JsonParseError) return true
  if (retryable) return true
  const lowerMessage = message.toLowerCase()
  if (lowerMessage.includes('ark responses 调用失败')) return false
  if (lowerMessage.includes('invalidparameter')) return false
  if (lowerMessage.includes('unknown field')) return false
  return lowerMessage.includes('unexpected token')
    || lowerMessage.includes('unexpected end of json input')
    || lowerMessage.includes('unexpected end of json string')
    || lowerMessage.includes('json format invalid')
    || lowerMessage.includes('invalid json output')
    || lowerMessage.includes('parse')
}

async function runStepWithRetry<T>(
  runStep: ScriptToStoryboardOrchestratorInput['runStep'],
  baseMeta: ScriptToStoryboardStepMeta,
  prompt: string,
  action: string,
  maxOutputTokens: number,
  parse: (text: string) => T,
): Promise<{ output: ScriptToStoryboardStepOutput; parsed: T }> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
    const meta = attempt === 1
      ? baseMeta
      : {
        ...baseMeta,
        stepId: baseMeta.stepId,
        stepAttempt: attempt,
        stepTitle: baseMeta.stepTitle,
      }
    try {
      const output = await runStep(meta, prompt, action, maxOutputTokens)
      const parsed = parse(output.text)
      return { output, parsed }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const normalizedError = normalizeAnyError(error, { context: 'worker' })
      const shouldRetry = attempt < MAX_STEP_ATTEMPTS
        && shouldRetryStepError(error, normalizedError.message, normalizedError.retryable)

      orchestratorLogger.error({
        action: 'orchestrator.step.retry',
        message: shouldRetry ? 'step failed, retrying' : 'step failed, no more retry',
        errorCode: normalizedError.code,
        retryable: normalizedError.retryable,
        details: {
          stepId: baseMeta.stepId,
          action,
          attempt,
          maxAttempts: MAX_STEP_ATTEMPTS,
        },
        error: {
          name: lastError.name,
          message: lastError.message,
          stack: lastError.stack,
        },
      })

      if (!shouldRetry) {
        break
      }
      const retryDelayMs = computeRetryDelayMs(attempt)
      await wait(retryDelayMs)
    }
  }
  throw lastError!
}

export async function runScriptToStoryboardOrchestrator(
  input: ScriptToStoryboardOrchestratorInput,
): Promise<ScriptToStoryboardOrchestratorResult> {
  const { clips, novelPromotionData, promptTemplates, runStep, concurrency: rawConcurrency } = input
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('No clips found')
  }
  const concurrency = normalizeWorkflowConcurrencyValue(
    rawConcurrency,
    DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
  )

  if (clips.every(isShortDramaVideoPromptClip)) {
    const clipPanels = clips.map((clip, index): ClipStoryboardPanels => ({
      clipId: clip.id,
      clipIndex: index + 1,
      finalPanels: buildShortDramaPanelsFromClip(clip),
    }))
    const phase1PanelsByClipId = Object.fromEntries(
      clipPanels.map((item) => [item.clipId, item.finalPanels]),
    )
    return {
      clipPanels,
      phase1PanelsByClipId,
      phase2CinematographyByClipId: {},
      phase2ActingByClipId: {},
      phase3PanelsByClipId: phase1PanelsByClipId,
      summary: {
        clipCount: clips.length,
        totalPanelCount: clipPanels.reduce((sum, item) => sum + item.finalPanels.length, 0),
        totalStepCount: clips.length,
      },
    }
  }

  const totalStepCount = clips.length * 4 + 2
  const charactersLibName = (novelPromotionData.characters || []).map((c) => c.name).join(', ') || '无'
  const locationsLibName = (novelPromotionData.locations || []).map((l) => l.name).join(', ') || '无'
  const charactersIntroduction = buildCharactersIntroduction(novelPromotionData.characters || [])

  const phase1PanelsByClipId = new Map<string, StoryboardPanel[]>()
  const phase2CinematographyByClipId = new Map<string, PhotographyRule[]>()
  const phase2ActingByClipId = new Map<string, ActingDirection[]>()
  const phase3PanelsByClipId = new Map<string, StoryboardPanel[]>()

  const clipPanels = await mapWithConcurrency(
    clips,
    concurrency,
    async (clip, index): Promise<ClipStoryboardPanels> => {
      const clipIndex = index + 1
      const clipContent = typeof clip.content === 'string' ? clip.content.trim() : ''
      if (!clipContent) {
        throw new Error(`Clip ${formatClipId(clip)} content is empty`)
      }
      const clipCharacters = parseClipCharacters(clip.characters)
      const clipLocation = clip.location || null
      const clipProps = parseClipProps(clip.props ?? null)
      const filteredAppearanceList = getFilteredAppearanceList(novelPromotionData.characters || [], clipCharacters)
      const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters || [], clipCharacters)
      const filteredLocationsDescription = getFilteredLocationsDescription(
        novelPromotionData.locations || [],
        clipLocation,
        input.locale ?? 'zh',
      )
      const filteredPropsDescription = compileAssetPromptFragments(buildPromptAssetContext({
        characters: [],
        locations: [],
        props: novelPromotionData.props || [],
        clipCharacters: [],
        clipLocation: null,
        clipProps,
      })).propsDescriptionText
      const clipJson = JSON.stringify(
        {
          id: clip.id,
          content: clipContent,
          characters: clipCharacters,
          location: clip.location || null,
          props: clipProps,
        },
        null,
        2,
      )

      let phase1Prompt = promptTemplates.phase1PlanTemplate
        .replace('{characters_lib_name}', charactersLibName)
        .replace('{locations_lib_name}', locationsLibName)
        .replace('{characters_introduction}', charactersIntroduction)
        .replace('{characters_appearance_list}', filteredAppearanceList)
        .replace('{characters_full_description}', filteredFullDescription)
        .replace('{props_description}', filteredPropsDescription)
        .replace('{clip_json}', clipJson)

      const screenplay = parseScreenplay(clip.screenplay)
      if (screenplay) {
        phase1Prompt = phase1Prompt.replace('{clip_content}', `【剧本格式】\n${JSON.stringify(screenplay, null, 2)}`)
      } else {
        phase1Prompt = phase1Prompt.replace('{clip_content}', clipContent)
      }

      const phase1Meta = withStepMeta(
        `clip_${clip.id}_phase1`,
        'progress.streamStep.storyboardPlan',
        clipIndex,
        totalStepCount,
        {
          groupId: `clip_${clip.id}`,
          parallelKey: 'phase1',
          retryable: true,
        },
      )
      const planPanels = await withEmptyJsonFallback(
        async () => {
          const { parsed } = await runStepWithRetry(
            runStep, phase1Meta, phase1Prompt, 'storyboard_phase1_plan', 2600,
            (text) => {
              const panels = parseJsonArray<StoryboardPanel>(text, `phase1:${formatClipId(clip)}`)
              if (panels.length === 0) {
                throw new Error(`Phase 1 returned empty panels for clip ${formatClipId(clip)}`)
              }
              return panels
            },
          )
          return parsed
        },
        () => [fallbackStoryboardPanel(clip)],
      )
      phase1PanelsByClipId.set(clip.id, planPanels)

      const phase2Meta = withStepMeta(
        `clip_${clip.id}_phase2_cinematography`,
        'progress.streamStep.cinematographyRules',
        clips.length + index * 3 + 1,
        totalStepCount,
        {
          dependsOn: [`clip_${clip.id}_phase1`],
          groupId: `clip_${clip.id}`,
          parallelKey: 'phase2',
          retryable: true,
        },
      )
      const phase2ActingMeta = withStepMeta(
        `clip_${clip.id}_phase2_acting`,
        'progress.streamStep.actingDirection',
        clips.length + index * 3 + 2,
        totalStepCount,
        {
          dependsOn: [`clip_${clip.id}_phase1`],
          groupId: `clip_${clip.id}`,
          parallelKey: 'phase2',
          retryable: true,
        },
      )
      const phase3Meta = withStepMeta(
        `clip_${clip.id}_phase3_detail`,
        'progress.streamStep.storyboardDetailRefine',
        clips.length + index * 3 + 3,
        totalStepCount,
        {
          dependsOn: [
            `clip_${clip.id}_phase2_cinematography`,
            `clip_${clip.id}_phase2_acting`,
          ],
          groupId: `clip_${clip.id}`,
          parallelKey: 'phase3',
          retryable: true,
        },
      )

      const phase2Prompt = promptTemplates.phase2CinematographyTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace(/\{panel_count\}/g, String(planPanels.length))
        .replace('{locations_description}', filteredLocationsDescription)
        .replace('{characters_info}', filteredFullDescription)
        .replace('{props_description}', filteredPropsDescription)

      const phase2ActingPrompt = promptTemplates.phase2ActingTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace(/\{panel_count\}/g, String(planPanels.length))
        .replace('{characters_info}', filteredFullDescription)

      const phase3Prompt = promptTemplates.phase3DetailTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace('{characters_age_gender}', filteredFullDescription)
        .replace('{locations_description}', filteredLocationsDescription)
        .replace('{props_description}', filteredPropsDescription)

      const [
        photographyRules,
        actingDirections,
      ] = await Promise.all([
        withEmptyJsonFallback(
          async () => {
            const { parsed } = await runStepWithRetry(
              runStep, phase2Meta, phase2Prompt, 'storyboard_phase2_cinematography', 2400,
              (text) => parseJsonArray<PhotographyRule>(text, `phase2:${formatClipId(clip)}`),
            )
            return parsed
          },
          () => fallbackPhotographyRules(planPanels),
        ),
        withEmptyJsonFallback(
          async () => {
            const { parsed } = await runStepWithRetry(
              runStep, phase2ActingMeta, phase2ActingPrompt, 'storyboard_phase2_acting', 2400,
              (text) => parseJsonArray<ActingDirection>(text, `phase2-acting:${formatClipId(clip)}`),
            )
            return parsed
          },
          () => fallbackActingDirections(planPanels),
        ),
      ])
      const filteredPhase3Panels = await withEmptyJsonFallback(
        async () => {
          const { parsed } = await runStepWithRetry(
            runStep, phase3Meta, phase3Prompt, 'storyboard_phase3_detail', 2600,
            (text) => {
              const panels = parseJsonArray<StoryboardPanel>(text, `phase3:${formatClipId(clip)}`)
              const filtered = panels.filter(
                (panel) => panel.description && panel.description !== '无' && panel.location !== '无',
              )
              if (filtered.length === 0) {
                throw new Error(`Phase 3 returned empty valid panels for clip ${formatClipId(clip)}`)
              }
              return filtered
            },
          )
          return parsed
        },
        () => planPanels,
      )

      phase2CinematographyByClipId.set(clip.id, photographyRules)
      phase2ActingByClipId.set(clip.id, actingDirections)
      phase3PanelsByClipId.set(clip.id, filteredPhase3Panels)

      return {
        clipId: clip.id,
        clipIndex,
        finalPanels: mergePanelsWithRules({
          finalPanels: filteredPhase3Panels,
          photographyRules,
          actingDirections,
        }),
      }
    },
  )

  const totalPanelCount = clipPanels.reduce((sum, item) => sum + item.finalPanels.length, 0)

  const mapToRecord = <T>(source: Map<string, T>): Record<string, T> => {
    const output: Record<string, T> = {}
    for (const [key, value] of source.entries()) {
      output[key] = value
    }
    return output
  }

  return {
    clipPanels,
    phase1PanelsByClipId: mapToRecord(phase1PanelsByClipId),
    phase2CinematographyByClipId: mapToRecord(phase2CinematographyByClipId),
    phase2ActingByClipId: mapToRecord(phase2ActingByClipId),
    phase3PanelsByClipId: mapToRecord(phase3PanelsByClipId),
    summary: {
      clipCount: clips.length,
      totalPanelCount,
      totalStepCount,
    },
  }
}
