import type { LLMAnalysisResult } from './types'
import {
  parseShortDramaBrief,
  splitShortDramaBriefBeats,
  type ShortDramaRoleAsset,
} from '@/lib/novel-promotion/short-drama-video-prompt'

export const AGENT_STORY_PACKAGE_START = '【NORI_AGENT_STORY_PACKAGE】'
export const AGENT_STORY_PACKAGE_END = '【/NORI_AGENT_STORY_PACKAGE】'

export type AgentSettingRegion = 'china' | 'western' | 'fantasy' | 'unspecified'

export type AgentStoryPackage = {
  originalPrompt: string
  expandedStory: string
  videoRatio: '9:16' | '16:9' | '1:1'
  visualStyle: string
  language: 'zh' | 'en'
  dialogueLanguage: 'zh' | 'en' | 'auto'
  settingRegion: AgentSettingRegion
  noSubtitles: boolean
  noMusic: boolean
  roleAssets: ShortDramaRoleAsset[]
  workflowRules: string[]
  negativeRules: string[]
  criticRules: string[]
}

function compact(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function detectDialogueLanguage(input: string, language: 'zh' | 'en'): 'zh' | 'en' | 'auto' {
  if (/(英文口型|英文台词|说英文|English lip|English dialogue|speak English)/i.test(input)) return 'en'
  if (/(中文口型|中文台词|说中文|Chinese dialogue|speak Chinese)/i.test(input)) return 'zh'
  return language === 'en' ? 'en' : 'auto'
}

function detectSettingRegion(input: string, language: 'zh' | 'en'): AgentSettingRegion {
  if (/(童话|森林|魔法|精灵|仙境|fairy|forest|magic|fantasy)/i.test(input)) return 'fantasy'
  if (/(欧美|美国|英国|欧洲|英文|English|American|Western|Europe|hospital|doctor|surgeon|\bDr\.|\bNurse\b|\bAva\b|\bGrayson\b|\bCarter\b|\bSarah\b|\$\s?\d+)/i.test(input)) {
    return 'western'
  }
  if (/(中国|中文|国风|中式|北京|上海|广州|深圳|古装|Chinese)/i.test(input)) return 'china'
  return language === 'en' ? 'western' : 'china'
}

function buildDefaultNegativeRules(packageInput: {
  settingRegion: AgentSettingRegion
  dialogueLanguage: 'zh' | 'en' | 'auto'
  noSubtitles: boolean
  noMusic: boolean
}): string[] {
  const rules = [
    '不要改变故事核心因果，不要新增无关角色，不要把剧情道具改成商品卖点。',
    '角色脸部、发型、服装、体型、年龄气质必须全片一致，不串脸、不漂移。',
    '镜头必须服务动作、台词和情绪推进，不要只输出静态摆拍。',
    '不要乱码文字，不要无意义字幕，不要过度美颜，不要塑料皮肤。',
  ]
  if (packageInput.noSubtitles) rules.push('不要生成中文字幕，不要自动生成大段字幕。')
  if (packageInput.noMusic) rules.push('不要生成背景音乐，只保留必要环境声、脚步声、衣料摩擦声和道具声。')
  if (packageInput.dialogueLanguage === 'en') rules.push('所有可见说话角色必须英文口型同步准确，不要中文口型。')
  if (packageInput.settingRegion === 'china') rules.push('中国故事必须使用中国场景、中文环境标识和符合中国生活语境的空间，不要变成欧美医院、欧美街区或英文标识环境。')
  if (packageInput.settingRegion === 'western') rules.push('英文/欧美故事必须使用国外场景、英文环境标识和欧美生活语境，不要变成亚洲场景或中文标识环境。')
  return rules
}

function buildCriticRules(settingRegion: AgentSettingRegion): string[] {
  return [
    '资产 critic：只保留会在画面中出现且影响连续性的角色、场景、道具；普通背景物不得进入关键道具库。',
    settingRegion === 'china'
      ? '地域 critic：中国故事的角色职业、建筑、交通、医院/学校/家庭空间和文字标识必须符合中国语境。'
      : settingRegion === 'western'
        ? '地域 critic：英文或欧美故事的角色职业、建筑、医院/学校/家庭空间和文字标识必须符合国外语境。'
        : '地域 critic：奇幻/童话故事可以使用非现实空间，但角色物种、道具和场景规则必须前后一致。',
    '分镜 critic：每个剧情片段至少要说明场景、人物站位、镜头语言、按秒动作/对白、使用到的资产和负面要求。',
    '视频 critic：video_prompt 必须用清楚句子说明“哪个角色做了什么、说了什么台词、镜头如何拍”。',
  ]
}

export function buildAgentStoryPackage(params: {
  userInput: string
  analysis: LLMAnalysisResult
}): AgentStoryPackage {
  const originalPrompt = params.userInput.trim()
  const analysisStory = params.analysis.storyText.trim()
  const brief = parseShortDramaBrief(originalPrompt)
  const expandedStory = compact(brief?.storyText || analysisStory || originalPrompt)
  const settingRegion = detectSettingRegion(`${originalPrompt}\n${expandedStory}`, params.analysis.language)
  const dialogueLanguage = detectDialogueLanguage(originalPrompt, params.analysis.language)
  const noSubtitles = /(不要中文字幕|不要字幕|no\s*subtitle|without subtitles)/i.test(originalPrompt)
  const noMusic = /(不要背景音乐|禁止生成背景音乐|no\s*music|without music)/i.test(originalPrompt)

  return {
    originalPrompt,
    expandedStory,
    videoRatio: params.analysis.videoRatio,
    visualStyle: params.analysis.visualStyle,
    language: params.analysis.language,
    dialogueLanguage,
    settingRegion,
    noSubtitles,
    noMusic,
    roleAssets: brief?.roleAssets || [],
    workflowRules: [
      'Prompt 必须先扩写为可拍摄故事，再拆为剧情片段，再拆为分镜，最后用 video_prompt 和资产参考图生成视频。',
      '开始制作视频分镜之前，必须先抽取并锁定全局资产；分镜只能引用已锁定资产或明确声明的新资产。',
      '片段是剧情节拍，分镜是片段内的镜头；一个片段可以包含多个分镜，但视频提示词必须按单个视频分镜输出。',
      '最终必须直接进入视频生成阶段，不生成中间分镜图；视频提示词可编辑，并且可追溯到角色、场景、道具资产。',
    ],
    negativeRules: buildDefaultNegativeRules({ settingRegion, dialogueLanguage, noSubtitles, noMusic }),
    criticRules: buildCriticRules(settingRegion),
  }
}

export function serializeAgentStoryPackage(pkg: AgentStoryPackage): string {
  return [
    AGENT_STORY_PACKAGE_START,
    JSON.stringify(pkg, null, 2),
    AGENT_STORY_PACKAGE_END,
  ].join('\n')
}

export function parseAgentStoryPackageText(input: string): AgentStoryPackage | null {
  const match = input.match(/【NORI_AGENT_STORY_PACKAGE】\s*([\s\S]*?)\s*【\/NORI_AGENT_STORY_PACKAGE】/)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1]) as Partial<AgentStoryPackage>
    if (!parsed.originalPrompt || !parsed.expandedStory) return null
    return {
      originalPrompt: parsed.originalPrompt,
      expandedStory: parsed.expandedStory,
      videoRatio: parsed.videoRatio === '16:9' || parsed.videoRatio === '1:1' ? parsed.videoRatio : '9:16',
      visualStyle: parsed.visualStyle || '清晰、可拍摄、便于分镜拆解的视觉风格',
      language: parsed.language === 'en' ? 'en' : 'zh',
      dialogueLanguage: parsed.dialogueLanguage === 'zh' || parsed.dialogueLanguage === 'en' ? parsed.dialogueLanguage : 'auto',
      settingRegion: parsed.settingRegion === 'western' || parsed.settingRegion === 'fantasy' || parsed.settingRegion === 'unspecified'
        ? parsed.settingRegion
        : 'china',
      noSubtitles: parsed.noSubtitles === true,
      noMusic: parsed.noMusic === true,
      roleAssets: Array.isArray(parsed.roleAssets) ? parsed.roleAssets.filter((item): item is ShortDramaRoleAsset => (
        !!item && typeof item.name === 'string' && typeof item.description === 'string'
      )) : [],
      workflowRules: Array.isArray(parsed.workflowRules) ? parsed.workflowRules.filter((item): item is string => typeof item === 'string') : [],
      negativeRules: Array.isArray(parsed.negativeRules) ? parsed.negativeRules.filter((item): item is string => typeof item === 'string') : [],
      criticRules: Array.isArray(parsed.criticRules) ? parsed.criticRules.filter((item): item is string => typeof item === 'string') : [],
    }
  } catch {
    return null
  }
}

export function splitAgentStoryBeats(pkg: AgentStoryPackage): string[] {
  const source = pkg.expandedStory || pkg.originalPrompt
  const explicit = splitShortDramaBriefBeats(source)
  if (explicit.length > 0) return explicit

  return source
    .split(/(?<=[。！？!?；;])\s*/u)
    .map((item) => compact(item))
    .filter(Boolean)
    .slice(0, 12)
}
