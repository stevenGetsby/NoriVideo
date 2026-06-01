import type {
  AgentCreativeParameters,
  AgentExecutionMode,
  LLMAnalysisResult,
  SkillId,
} from './types'
import { skillLibrary } from './skill-parser'

const DEFAULT_MOCK_PROMPT = 'Mock prompt: 生成一个可编辑的智能创作项目，用于本地流程验证，不调用外部模型。'

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
  const normalizedInput = input.toLowerCase()
  const matched = skillLibrary.getAllSkills().find((skill) =>
    skill.keywords.some((keyword) => normalizedInput.includes(keyword.toLowerCase())),
  )
  return matched?.id || 'generic'
}

function makeProjectName(input: string, skillId: SkillId): string {
  const skill = skillLibrary.getSkill(skillId)
  const compact = input.replace(/\s+/g, ' ').trim()
  if (!compact) return `${skill?.name || '智能创作'}项目`
  const sliced = Array.from(compact).slice(0, 18).join('')
  return `${sliced}${Array.from(compact).length > 18 ? '...' : ''}`
}

export function normalizeExecutionMode(value: unknown): AgentExecutionMode {
  return value === 'live' ? 'live' : 'mock'
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
    shotCount: clampInteger(source.shotCount, 1, 12) ?? 3,
    panelsPerShot: clampInteger(source.panelsPerShot, 1, 8) ?? 3,
    mockPrompt: readText(source.mockPrompt) || DEFAULT_MOCK_PROMPT,
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
    visualStyle: skill?.defaultConfig.visualStyle || '清晰、可执行、便于分镜拆解的视觉风格',
    projectName,
    episodeName: '第1集',
    language: detectLanguage(input),
    confidence: 1,
  }
}
