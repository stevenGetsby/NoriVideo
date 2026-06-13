import type {
  AgentCreativeParameters,
  AgentExecutionMode,
  AgentExecutionPlan,
  AgentStage,
  LLMAnalysisResult,
  SkillId,
} from './types'
import { skillLibrary } from './skill-parser'

const DEFAULT_MOCK_PROMPT = 'Mock prompt: 生成一个可编辑的智能创作项目，用于本地流程验证，不调用外部模型。'
const FIXED_AGENT_VISUAL_STYLE = [
  '真实真人短剧质感，竖屏 mini drama 摄影风格。',
  '真实人物比例、真实皮肤质感、真实头发和服装材质，场景、光线、道具保持电影级写实连续性。',
  '角色资产必须是单个真人角色设定图，不要漫画、不要动漫、不要插画、不要卡通渲染、不要多人合照。',
].join(' ')

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clampInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function detectRatio(input: string): '9:16' | '16:9' | '1:1' {
  if (/(16\s*[:：]\s*9|横屏|landscape)/i.test(input)) return '16:9'
  if (/(1\s*[:：]\s*1|方形|square)/i.test(input)) return '1:1'
  return '9:16'
}

function detectLanguage(input: string): 'zh' | 'en' {
  return /[\u4e00-\u9fff]/.test(input) ? 'zh' : 'en'
}

function detectSkill(input: string): SkillId {
  return skillLibrary.findSkillByKeywords([input]) || 'generic'
}

function makeProjectName(input: string, skillId: SkillId): string {
  const skill = skillLibrary.getSkill(skillId)
  const compact = input.replace(/\s+/g, ' ').trim()
  if (!compact) return `${skill?.name || '智能创作'}项目`
  const sliced = Array.from(compact).slice(0, 18).join('')
  return `${sliced}${Array.from(compact).length > 18 ? '...' : ''}`
}

function countCjkChars(input: string): number {
  return (input.match(/[\u3400-\u9fff]/g) || []).length
}

function countStoryParagraphs(input: string): number {
  return input
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .length
}

function countStorySentences(input: string): number {
  return (input.match(/[。！？!?；;]/g) || []).length
}

function countExplicitCompressedBeats(input: string): number {
  const numberedLines = input
    .split('\n')
    .filter((line) => /^\s*\d+\s*[.、:：]/.test(line.trim()))
    .length
  const shotRanges = (input.match(/SH\d{2,4}\s*[-—–]\s*SH\d{2,4}/gi) || []).length
  return Math.max(numberedLines, shotRanges)
}

function inferNarrativeShotCount(input: string): number {
  const explicitBeats = countExplicitCompressedBeats(input)
  if (explicitBeats >= 4) return Math.min(24, Math.max(6, explicitBeats))

  const paragraphs = countStoryParagraphs(input)
  if (paragraphs >= 4) return Math.min(18, Math.max(6, paragraphs))

  const cjkChars = countCjkChars(input)
  const sentenceCount = countStorySentences(input)
  if (cjkChars >= 3000 || sentenceCount >= 24) return 14
  if (cjkChars >= 2200 || sentenceCount >= 18) return 12
  if (cjkChars >= 1400 || sentenceCount >= 12) return 10
  if (cjkChars >= 800 || sentenceCount >= 8) return 8
  if (cjkChars >= 360 || sentenceCount >= 4) return 6
  return 4
}

function inferCreativeParameters(input: string, skillId: SkillId): Partial<AgentCreativeParameters> {
  const narration: AgentCreativeParameters['narration'] = /(口播|旁白|解说|voiceover|narration)/i.test(input)
    ? 'on'
    : 'auto'

  if (skillId === 'ugc-platform-promo') {
    return {
      durationSeconds: 30,
      targetAudience: '内容创作者、社区运营者、品牌方和希望通过内容获得曝光的用户',
      tone: '专业、自然、有亲和力',
      sellingPoints: '便捷发布内容、连接创作者社区、提升内容曝光、支持互动与成长',
      callToAction: '立即加入平台，发布你的第一条内容',
      narration,
      shotCount: 4,
      panelsPerShot: 1,
    }
  }

  if (skillId === 'product-promo') {
    return {
      durationSeconds: 18,
      tone: '清晰、克制、有购买引导',
      callToAction: '立即了解',
      narration,
      shotCount: 3,
      panelsPerShot: 1,
    }
  }

  if (skillId === 'digital-avatar-ad') {
    return {
      durationSeconds: 30,
      tone: '自然、清晰、有信任感',
      narration: 'on',
      shotCount: 4,
      panelsPerShot: 1,
    }
  }

  const narrativeShotCount = inferNarrativeShotCount(input)
  return {
    durationSeconds: Math.min(240, Math.max(30, narrativeShotCount * 8)),
    tone: '自然、清晰',
    narration,
    shotCount: narrativeShotCount,
    panelsPerShot: 1,
  }
}

function isCommercialSkill(skillId: SkillId): boolean {
  return skillId === 'product-promo'
    || skillId === 'digital-avatar-ad'
    || skillId === 'ugc-platform-promo'
}

export function normalizeExecutionMode(value: unknown): AgentExecutionMode {
  return value === 'live' ? 'live' : 'mock'
}

export function createAgentWorkflowStages(): AgentStage[] {
  return [
    {
      stageId: 'stage_1',
      stageNumber: 1,
      title: '项目初始化',
      description: '创建项目和剧集',
      estimatedDuration: 5,
      status: 'pending',
    },
    {
      stageId: 'stage_2',
      stageNumber: 2,
      title: '故事扩写与剧本锁定',
      description: '按手动智能创作标准扩写故事，再拆剧情片段和 screenplay，后续资产与分镜必须围绕脚本执行',
      estimatedDuration: 120,
      status: 'pending',
    },
    {
      stageId: 'stage_3',
      stageNumber: 3,
      title: '资产一致性核对',
      description: '根据脚本确认角色、场景、道具和商品设定，写入全局一致性简报',
      estimatedDuration: 20,
      status: 'pending',
    },
    {
      stageId: 'stage_4',
      stageNumber: 4,
      title: '资产图生成',
      description: '先为脚本抽取的角色、场景和道具生成全局参考图，供后续 Seedance 视频生成引用',
      estimatedDuration: 600,
      status: 'pending',
    },
    {
      stageId: 'stage_5',
      stageNumber: 5,
      title: '精简分镜生成',
      description: '按脚本和资产简报生成关键分镜；宣发短片默认使用少量关键画面',
      estimatedDuration: 180,
      status: 'pending',
    },
    {
      stageId: 'stage_6',
      stageNumber: 6,
      title: '视频资产引用准备',
      description: '确认每个分镜的 video_prompt 与角色、场景、道具参考图绑定，不再生成中间分镜图',
      estimatedDuration: 30,
      status: 'pending',
    },
    {
      stageId: 'stage_7',
      stageNumber: 7,
      title: '视频生成',
      description: '基于 video_prompt 和已锁定资产参考图提交 Seedance 视频任务，并等待任务完成',
      estimatedDuration: 1200,
      status: 'pending',
    },
  ]
}

function readStageNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.round(parsed))
}

function normalizeAgentStage(raw: unknown, fallback: AgentStage, index: number): AgentStage {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  return {
    stageId: readText(source.stageId) || fallback.stageId,
    stageNumber: readStageNumber(source.stageNumber, index + 1),
    title: readText(source.title) || fallback.title,
    description: readText(source.description) || fallback.description,
    estimatedDuration: readStageNumber(source.estimatedDuration, fallback.estimatedDuration),
    status: 'pending',
  }
}

export function normalizeAgentExecutionPlan(plan: AgentExecutionPlan): AgentExecutionPlan {
  const defaults = createAgentWorkflowStages()
  const rawStages = Array.isArray(plan.stages) ? plan.stages : []
  const stages = defaults.map((fallback, index) => normalizeAgentStage(rawStages[index], fallback, index))
  const estimatedDuration = stages.reduce((sum, stage) => sum + stage.estimatedDuration, 0)
  return {
    ...plan,
    stages,
    estimatedDuration: readStageNumber(plan.estimatedDuration, estimatedDuration),
  }
}

export function normalizeCreativeParameters(raw: unknown): AgentCreativeParameters {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  const narration = source.narration === 'on' || source.narration === 'off'
    ? source.narration
    : 'auto'

  return {
    durationSeconds: clampInteger(source.durationSeconds, 5, 300) ?? 30,
    targetAudience: readText(source.targetAudience),
    tone: readText(source.tone),
    sellingPoints: readText(source.sellingPoints),
    callToAction: readText(source.callToAction),
    narration,
    shotCount: clampInteger(source.shotCount, 1, 24) ?? 6,
    panelsPerShot: clampInteger(source.panelsPerShot, 1, 8) ?? 3,
    mockPrompt: readText(source.mockPrompt) || DEFAULT_MOCK_PROMPT,
    storyboardOnly: source.storyboardOnly === true,
  }
}

function hasOwnParameter(raw: unknown, key: keyof AgentCreativeParameters): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, key)
}

export function applySkillWorkflowDefaults(
  parameters: AgentCreativeParameters,
  raw: unknown,
  skillId: SkillId,
): AgentCreativeParameters {
  if (!isCommercialSkill(skillId)) {
    return {
      ...parameters,
      sellingPoints: undefined,
      callToAction: undefined,
    }
  }

  if (skillId !== 'product-promo') return parameters

  const durationIsGenericDefault = !hasOwnParameter(raw, 'durationSeconds') || parameters.durationSeconds === 30
  const panelsIsGenericDefault = !hasOwnParameter(raw, 'panelsPerShot') || parameters.panelsPerShot === 3

  return {
    ...parameters,
    durationSeconds: durationIsGenericDefault ? 18 : parameters.durationSeconds,
    shotCount: hasOwnParameter(raw, 'shotCount') ? parameters.shotCount : 3,
    panelsPerShot: panelsIsGenericDefault ? 1 : parameters.panelsPerShot,
    tone: parameters.tone?.trim() || '清晰、克制、有购买引导',
    callToAction: parameters.callToAction?.trim() || '立即了解',
  }
}

export function createDeterministicAnalysis(userInput: string): LLMAnalysisResult {
  const input = userInput.trim()
  const videoType = detectSkill(input)
  const skill = skillLibrary.getSkill(videoType) || skillLibrary.getSkill('generic')
  const projectName = makeProjectName(input, videoType)

  return {
    videoType,
    storyText: input || '一个简短的智能创作流程验证故事。',
    videoRatio: detectRatio(input),
    visualStyle: FIXED_AGENT_VISUAL_STYLE,
    projectName,
    episodeName: '第1集',
    language: detectLanguage(input),
    confidence: 1,
    creativeParameters: inferCreativeParameters(input, videoType),
  }
}
