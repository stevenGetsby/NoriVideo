import { safeParseJsonArray, safeParseJsonObject } from '@/lib/json-repair'
import { buildCharactersIntroduction } from '@/lib/constants'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'
import {
  buildWholeContentClipBoundary,
  createClipContentMatcher,
  shouldFallbackToWholeContentSingleClip,
  type ClipMatchLevel,
} from './clip-matching'
import { mapWithConcurrency } from '@/lib/async/map-with-concurrency'
import {
  DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
  normalizeWorkflowConcurrencyValue,
} from '@/lib/workflow-concurrency'
import {
  CANONICAL_PANEL_NEGATIVE_REQUIREMENTS,
  buildCanonicalTimedActionLines,
  buildShortDramaBriefVideoPrompt,
  buildVideoPromptBlocks,
  parseShortDramaBrief,
  parseShotSheetText,
  splitShortDramaBriefBeats,
  summarizeVideoPromptBeat,
} from '@/lib/novel-promotion/short-drama-video-prompt'
import {
  parseAgentStoryPackageText,
  splitAgentStoryBeats,
  type AgentSettingRegion,
  type AgentStoryPackage,
} from '@/lib/super-agent/agent-story-package'

export type StoryToScriptStepMeta = {
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

export type StoryToScriptStepOutput = {
  text: string
  reasoning: string
}

export type StoryToScriptClipCandidate = {
  id: string
  startText: string
  endText: string
  summary: string
  location: string | null
  characters: string[]
  props: string[]
  content: string
  matchLevel: ClipMatchLevel
  matchConfidence: number
}

export type StoryToScriptScreenplayResult = {
  clipId: string
  success: boolean
  sceneCount: number
  screenplay?: Record<string, unknown>
  error?: string
}

export type StoryToScriptPromptTemplates = {
  characterPromptTemplate: string
  locationPromptTemplate: string
  propPromptTemplate: string
  clipPromptTemplate: string
  screenplayPromptTemplate: string
}

export type StoryToScriptOrchestratorInput = {
  concurrency?: number
  content: string
  disableAgentStoryPackageFastPath?: boolean
  baseCharacters: string[]
  baseLocations: string[]
  baseProps?: string[]
  baseCharacterIntroductions: Array<{ name: string; introduction?: string | null }>
  promptTemplates: StoryToScriptPromptTemplates
  runStep: (
    meta: StoryToScriptStepMeta,
    prompt: string,
    action: string,
    maxOutputTokens: number,
  ) => Promise<StoryToScriptStepOutput>
  onStepError?: (meta: StoryToScriptStepMeta, message: string) => void
  onLog?: (message: string, details?: Record<string, unknown>) => void
}

export type StoryToScriptOrchestratorResult = {
  characterStep: StoryToScriptStepOutput
  locationStep: StoryToScriptStepOutput
  propStep: StoryToScriptStepOutput
  splitStep: StoryToScriptStepOutput
  charactersObject: Record<string, unknown>
  locationsObject: Record<string, unknown>
  propsObject: Record<string, unknown>
  analyzedCharacters: Record<string, unknown>[]
  analyzedLocations: Record<string, unknown>[]
  analyzedProps: Record<string, unknown>[]
  charactersLibName: string
  locationsLibName: string
  propsLibName: string
  charactersIntroduction: string
  clipList: StoryToScriptClipCandidate[]
  screenplayResults: StoryToScriptScreenplayResult[]
  summary: {
    characterCount: number
      locationCount: number
      propCount: number
      clipCount: number
    screenplaySuccessCount: number
    screenplayFailedCount: number
    totalScenes: number
  }
}
const orchestratorLogger = createScopedLogger({ module: 'worker.orchestrator.story_to_script' })

function applyTemplate(template: string, replacements: Record<string, string>) {
  let next = template
  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return next
}

function parseClipArray(responseText: string): Record<string, unknown>[] {
  return safeParseJsonArray(responseText, 'clips')
}

function parseScreenplayObject(responseText: string): Record<string, unknown> {
  return safeParseJsonObject(responseText)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function parseShotCharacters(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split('/')
    .map((item) => item.trim())
    .filter((item) => item && item !== '（空）')
}

function inferCharacterProfile(name: string): Record<string, unknown> {
  if (/Ava/i.test(name)) {
    return {
      name,
      introduction: '年轻美国女性，黑框眼镜，焦急、委屈、脆弱但倔强，用于欧美医疗短剧转绘保持全片一致。',
      gender: 'female',
      age_range: '24-27',
      occupation: 'student/family member',
      visual_keywords: ['black framed glasses', 'cream cardigan', 'tired anxious eyes'],
    }
  }
  if (/Grayson/i.test(name)) {
    return {
      name,
      introduction: '美国男外科医生，白大褂和绿色手术服两个版本，冷静克制、高冷、有压迫感。',
      gender: 'male',
      age_range: '30-34',
      occupation: 'surgeon',
      visual_keywords: ['white coat', 'green surgical scrubs', 'cold restrained expression'],
    }
  }
  if (/Nurse Sarah/i.test(name)) {
    return {
      name,
      introduction: '美国注册护士，浅蓝色护士服和医用口罩，眼神严厉，语速快，负责质疑和指责。',
      gender: 'female',
      age_range: '30-40',
      occupation: 'registered nurse',
      visual_keywords: ['blue nurse uniform', 'medical mask', 'stern eyes'],
    }
  }
  if (/Carter/i.test(name)) {
    return {
      name,
      introduction: '美国男医生，白大褂，外向八卦，负责调侃和轻喜剧反应。',
      gender: 'male',
      age_range: '30-35',
      occupation: 'doctor',
      visual_keywords: ['white coat', 'playful expression', 'friendly teasing'],
    }
  }
  return {
    name,
    introduction: '从 SH 镜头稿抽取的短剧角色，后续资产、分镜、图片和视频必须保持一致。',
  }
}

function inferCharacterProfileFromBrief(name: string, description: string): Record<string, unknown> {
  const lower = description.toLowerCase()
  return {
    name,
    introduction: description,
    gender: /女性|女子|女|female|woman/.test(description) ? 'female' : (/男性|男子|男|male|man/.test(description) ? 'male' : undefined),
    age_range: description.match(/\d{1,2}\s*[-~－]\s*\d{1,2}/)?.[0] || undefined,
    occupation: /医生|外科|doctor|surgeon/i.test(description)
      ? 'doctor'
      : (/护士|nurse/i.test(description) ? 'nurse' : undefined),
    visual_keywords: [
      /眼镜|glasses/i.test(description) ? 'glasses' : '',
      /白大褂|white coat/i.test(description) ? 'white coat' : '',
      /手术服|scrub|surgical/i.test(lower) ? 'surgical scrubs' : '',
      /口罩|mask/i.test(description) ? 'medical mask' : '',
    ].filter(Boolean),
  }
}

function inferCharacterProfileFromAgentAsset(name: string, description: string): Record<string, unknown> {
  return {
    name,
    introduction: description,
    gender: /女性|女子|女|female|woman/i.test(description)
      ? 'female'
      : (/男性|男子|男|male|man/i.test(description) ? 'male' : undefined),
    age_range: description.match(/\d{1,2}\s*[-~－]\s*\d{1,2}/)?.[0] || undefined,
    visual_keywords: description
      .split(/[，,；;。]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8),
  }
}

function inferGenericRoleAssets(pkg: AgentStoryPackage): Array<{ name: string; description: string }> {
  const source = `${pkg.originalPrompt}\n${pkg.expandedStory}`
  const candidates = [
    ...pkg.roleAssets.map((asset) => asset.name),
    ...Array.from(source.matchAll(/\b((?:Dr\.|Nurse|Doctor|Officer|Agent|Mr\.|Mrs\.|Ms\.)\s+[A-Z][A-Za-z.'-]{1,24})\b/g)).map((match) => match[1]),
    ...Array.from(source.matchAll(/\b(Ava|Sarah|Carter|Grayson)\b/g)).map((match) => match[1]),
    ...Array.from(source.matchAll(/([A-Z][A-Za-z. -]{1,28})\s*(?:说|问|shouts?|says?|asks?)/g)).map((match) => match[1]),
    ...Array.from(source.matchAll(/([A-Z][A-Za-z. -]{1,28})\s*(?:challenges?|questions?|protects?|helps?|waits?|turns?|whispers?)/g)).map((match) => match[1]),
    ...Array.from(source.matchAll(/([\u4e00-\u9fa5]{2,6})\s*(?:说|问|喊|低声|高兴地|焦急地)/g)).map((match) => match[1]),
  ]
  if (/小兔子|兔子/.test(source)) candidates.push('小兔子')
  if (/萤火虫/.test(source)) candidates.push('萤火虫')
  const uniqueCandidates = uniqueStrings(candidates)
  const titledWesternNames = new Set(
    uniqueCandidates
      .filter((name) => /^(?:Dr\.|Nurse|Doctor|Officer|Mr\.|Mrs\.|Ms\.)\s+/i.test(name))
      .map((name) => name.split(/\s+/).slice(1).join(' ')),
  )
  const names = uniqueCandidates
    .filter((name) => !/后来大家|从那以后|忽然/.test(name))
    .filter((name) => !/因为|由于|却|被|在|手术|费用|问题|请求|安排|成功|之后|以后/.test(name))
    .filter((name) => !/^(?:她|他|它|他们|她们|大家|后来|忽然|从那以后|问题|费用)$/.test(name))
    .filter((name) => !titledWesternNames.has(name))
    .slice(0, 6)
  if (names.length === 0) {
    names.push(pkg.settingRegion === 'western' ? 'Main Character' : '主角')
  }

  const explicitAssetByName = new Map(pkg.roleAssets.map((asset) => [asset.name, asset]))
  return names.map((name) => {
    const explicitAsset = explicitAssetByName.get(name)
    if (explicitAsset) return explicitAsset
    if (name === '小兔子') {
      return {
        name,
        description: '可爱的童话小兔子，柔软白色绒毛，圆眼睛，动作善良温柔，全片保持同一体型和表情气质。',
      }
    }
    if (name === '萤火虫') {
      return {
        name,
        description: '小巧发光的萤火虫，温暖黄绿色微光，翅膀透明，作为会发光的童话角色保持同一光色。',
      }
    }
    return {
      name,
      description: `从 Agent 扩写故事抽取的主要角色：${name}。后续资产、分镜、图片和视频必须保持脸部/物种、服装或外观、年龄气质和表演方式一致。`,
    }
  })
}

function inferAgentPropAssets(pkg: AgentStoryPackage): Array<{ name: string; description: string }> {
  const source = `${pkg.originalPrompt}\n${pkg.expandedStory}`
  const props: Array<{ name: string; description: string }> = []
  const addProp = (name: string, description: string) => {
    if (props.some((item) => item.name.toLowerCase() === name.toLowerCase())) return
    props.push({ name, description })
  }

  if (/月亮灯/.test(source)) {
    addProp('月亮灯', '童话关键道具，像月亮一样明亮的小光球或提灯，温暖柔和发光，用于照亮森林道路并承接善良主题。')
  }
  if (/树叶/.test(source)) {
    addProp('树叶', '小兔子用于救援的绿色树叶，轻薄、干净，可伸向小水坑作为临时救助工具。')
  }
  if (/小水坑|水坑/.test(source)) {
    addProp('小水坑', '森林地面上的浅水坑，能反射月光和萤火虫微光，是救援动作发生的关键环境道具。')
  }
  if (/手术|surgery/i.test(source)) {
    addProp('手术安排文件', '欧美医疗短剧中的关键文件或病历夹，干净专业，作为安排手术和推进剧情的可见道具。')
  }
  return props
}

function inferAgentBeatParticipants(
  roles: Array<{ name: string; description: string }>,
  beat: string,
): Array<{ name: string; description: string }> {
  const normalizedBeat = beat.toLowerCase()
  const matched = roles.filter((role) => {
    const name = role.name.trim()
    if (!name) return false
    const aliases = name
      .split(/[\/、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
    return aliases.some((alias) => normalizedBeat.includes(alias.toLowerCase()))
  })
  if (matched.length > 0) return matched
  return roles.slice(0, 1)
}

function inferAgentBeatProps(
  props: Array<{ name: string; description: string }>,
  beat: string,
): Array<{ name: string; description: string }> {
  return props.filter((prop) => {
    if (beat.includes(prop.name)) return true
    if (prop.name === '手术安排文件') return /手术|surgery|arrange|arrangement/i.test(beat)
    if (prop.name === '树叶') return /树叶|leaf/i.test(beat)
    if (prop.name === '小水坑') return /水坑|救|掉进|puddle|rescue|help/i.test(beat)
    if (prop.name === '月亮灯') return /月亮灯|moon lamp|light ball/i.test(beat)
    return false
  })
}

function compactBeatPreview(beat: string): string {
  return Array.from(beat.replace(/\s+/g, ' ').trim()).slice(0, 64).join('')
}

function extractSpeakerDialogueMap(
  beat: string,
  roles: Array<{ name: string; description: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const role of roles) {
    const aliases = role.name.split(/[\/、,，]/).map((item) => item.trim()).filter(Boolean)
    for (const alias of aliases) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`${escapedAlias}[^。！？!?“"「]{0,24}[“"「](.+?)[”"」]`, 'g')
      let match: RegExpExecArray | null
      while ((match = pattern.exec(beat)) !== null) {
        const line = match[1]?.trim()
        if (!line) continue
        const existing = map.get(role.name) || []
        existing.push(line)
        map.set(role.name, existing)
      }
    }
  }
  return map
}

function inferRoleAction(params: {
  roleName: string
  beat: string
  dialogueLines: string[]
  dialogueLanguage: AgentStoryPackage['dialogueLanguage']
}): string {
  const { roleName, beat, dialogueLines, dialogueLanguage } = params
  const quotedDialogue = dialogueLines.length > 0
    ? `${dialogueLanguage === 'en' ? '英文口型同步，说' : '口型同步，说'}：“${dialogueLines.join(' / ')}”。`
    : ''

  if (roleName === '小兔子') {
    if (/树叶|救/.test(beat)) return `伸出树叶靠近小水坑，稳定地把萤火虫救出来。${quotedDialogue}`
    if (/水坑|掉进/.test(beat)) return `发现萤火虫掉进小水坑后停下脚步，弯腰靠近观察，露出担心和准备帮忙的表情。${quotedDialogue}`
    if (/月亮灯|照亮|迷路|回家/.test(beat)) return `接住或提起月亮灯，沿森林小路为迷路的小动物照亮方向。${quotedDialogue}`
    return `在夜晚童话森林里散步、停步观察环境，表情温柔好奇。${quotedDialogue}`
  }
  if (roleName === '萤火虫') {
    if (/水坑|掉进|救/.test(beat)) return `困在小水坑里微弱发光，被小兔子救起后重新振翅。${quotedDialogue}`
    if (/月亮灯|挥动|谢谢/.test(beat)) return `高兴地挥动翅膀，把像月亮一样亮的小光球送到小兔子手里。${quotedDialogue}`
    return `用温暖黄绿色微光回应小兔子的善意。${quotedDialogue}`
  }
  if (/Ava/i.test(roleName)) {
    if (/ask|request|help|surgery|手术|请求|帮/i.test(beat)) {
      return `眼神湿润、疲惫但倔强地靠近 Dr. Grayson，请求他帮忙安排手术。${quotedDialogue}`
    }
    return `在医院走廊焦急等待，低头攥紧衣角或病历，保持脆弱但倔强的状态。${quotedDialogue}`
  }
  if (/Nurse Sarah/i.test(roleName)) {
    return `穿浅蓝护士服，带质疑和指责感快速发问，身体略前倾压迫 Ava。${quotedDialogue}`
  }
  if (/Grayson/i.test(roleName)) {
    if (/protect|shield|handle|arrange|手术|保护|安排/i.test(beat)) {
      return `冷静挡在 Ava 与质疑者之间，克制地作出手术安排或专业判断。${quotedDialogue}`
    }
    return `保持冷静克制的医生姿态，观察 Ava 的请求并控制现场节奏。${quotedDialogue}`
  }
  if (/Carter/i.test(roleName)) {
    return `以轻松八卦表情在旁边调侃或反应，提供轻喜剧节奏但不抢主线。${quotedDialogue}`
  }

  return `按剧情片段执行清楚可见的动作，动作必须对应“${compactBeatPreview(beat)}”。${quotedDialogue}`
}

function buildAgentRoleActionLines(params: {
  pkg: AgentStoryPackage
  beat: string
  participants: Array<{ name: string; description: string }>
}): string[] {
  const dialogueMap = extractSpeakerDialogueMap(params.beat, params.participants)
  return params.participants.map((role) => {
    const action = inferRoleAction({
      roleName: role.name,
      beat: params.beat,
      dialogueLines: dialogueMap.get(role.name) || [],
      dialogueLanguage: params.pkg.dialogueLanguage,
    })
    return `${role.name}：${action}`
  })
}

function inferAgentLocations(pkg: AgentStoryPackage): Record<string, unknown>[] {
  const source = `${pkg.originalPrompt}\n${pkg.expandedStory}`
  if (pkg.settingRegion === 'fantasy' || /森林|月亮灯|萤火虫|童话/.test(source)) {
    return [
      {
        name: '夜晚童话森林',
        summary: '温柔可爱的童话森林，月光、树影、小水坑和萤火虫微光保持全片一致。',
        descriptions: ['夜晚森林小路，柔和月光，苔藓和树叶，小水坑反射微光，可爱童话动画质感。'],
      },
    ]
  }
  if (pkg.settingRegion === 'western') {
    const isMedical = /医院|医疗|手术|doctor|hospital|surgeon/i.test(source)
    return [
      {
        name: isMedical ? '现代美国私立医院' : '国外真实短剧主场景',
        summary: isMedical
          ? '现代美国私立医院走廊、手术区或等待区，英文导视标识、冷白顶灯、白蓝墙面，真实欧美短剧质感。'
          : '符合英文/欧美故事语境的国外生活场景，英文环境标识、真实摄影光线和空间关系保持一致。',
        descriptions: [
          isMedical
            ? 'white and pale blue private hospital hallway, English signs, cold white LED lights, surgery doors, waiting chairs, realistic vertical drama look'
            : 'realistic western environment, English signage when needed, natural light, clear spatial layout, vertical short drama cinematography',
        ],
      },
    ]
  }
  return [
    {
      name: '中国故事主场景',
      summary: '符合中国故事语境的真实生活空间，中文环境标识、建筑细节、光线和人物关系保持一致。',
      descriptions: ['中国真实生活场景，中文标识，本土建筑和室内陈设，自然光线，空间关系清楚。'],
    },
  ]
}

function extractDialogueSummary(beat: string, dialogueLanguage: AgentStoryPackage['dialogueLanguage']): string {
  const quoted = Array.from(beat.matchAll(/[“"「](.+?)[”"」]/g)).map((match) => match[1].trim()).filter(Boolean)
  if (quoted.length === 0) {
    return dialogueLanguage === 'en'
      ? '如本片段需要台词，使用简短自然英文台词并保持英文口型同步。'
      : '如本片段需要台词，使用简短自然台词并保持口型同步。'
  }
  const prefix = dialogueLanguage === 'en' ? '英文口型同步，说：' : '口型同步，说：'
  return quoted.map((line) => `${prefix}${line}`).join('；')
}

function inferAgentBeatDuration(beat: string): number {
  const length = Array.from(beat).length
  if (/[“"「].+?[”"」]/.test(beat) || length > 70) return 10
  if (length > 42) return 8
  return 6
}

function buildRegionLine(region: AgentSettingRegion): string {
  if (region === 'western') return '地域要求：英文/欧美故事必须保持国外场景、英文环境标识和欧美生活语境，不要变成亚洲场景。'
  if (region === 'china') return '地域要求：中国故事必须保持中国场景、中文环境标识和中国生活语境，不要变成欧美场景。'
  if (region === 'fantasy') return '地域要求：童话/奇幻故事必须保持统一世界观、角色物种和魔法道具规则。'
  return '地域要求：按故事文本保持统一场景语境。'
}

function buildAgentVideoPrompt(params: {
  pkg: AgentStoryPackage
  beat: string
  beatIndex: number
  totalBeats: number
  roles: Array<{ name: string; description: string }>
  participants: Array<{ name: string; description: string }>
  props: Array<{ name: string; description: string }>
  locationName: string
}): string {
  const { pkg, beat, participants, props, locationName } = params
  const duration = inferAgentBeatDuration(beat)
  const beatSummary = summarizeVideoPromptBeat(beat, 120)
  const participantNames = participants.map((role) => role.name).join('、')
  const propNames = props.map((prop) => prop.name).join('、')
  const dialogue = extractDialogueSummary(beat, pkg.dialogueLanguage)
  const roleActionLines = buildAgentRoleActionLines({ pkg, beat, participants })
  const roleActionText = summarizeVideoPromptBeat(roleActionLines.join('；'), 180)
  const timedActionLines = buildCanonicalTimedActionLines({
    duration,
    scene: locationName,
    roleNames: participantNames,
    roleActionText,
    beatSummary,
    propNames,
    dialogueInstruction: dialogue,
  })
  return [
    `场景：${locationName}。`,
    `剧情片段：${beatSummary}`,
    '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
    `本分镜使用资产：角色=${participantNames || '按剧情出现的主要角色'}；场景=${locationName}；道具=${propNames || '无独立关键道具，仅使用场景内自然元素'}。`,
    `角色行为拆分：${roleActionText}`,
    `人物站位：${participantNames || '主要角色'} 按剧情关系形成清楚前景、中景、背景层次；说话者占主画面，听者可在前景边缘或背景虚化；角色进入、停顿、转身、递交、救助、质问等动作必须和剧情片段一致。`,
    '镜头语言：先用关系中景建立空间和人物位置，再用近景表现核心动作/台词，再用特写捕捉眼神、手部或道具状态，最后用中景给出结果或转场。固定镜头为主，可轻微推近；不要手持乱晃，不要新增无关镜头。',
    ...timedActionLines,
    `【本分镜负面要求】 ${CANONICAL_PANEL_NEGATIVE_REQUIREMENTS}`,
  ].join('\n')
}

function buildAgentStoryPackageFastPathResult(content: string): StoryToScriptOrchestratorResult | null {
  const pkg = parseAgentStoryPackageText(content)
  if (!pkg) return null
  const beats = splitAgentStoryBeats(pkg)
  if (beats.length === 0) return null
  const roles = inferGenericRoleAssets(pkg)
  const props = inferAgentPropAssets(pkg)
  const analyzedCharacters = roles.map((role) => inferCharacterProfileFromAgentAsset(role.name, role.description))
  const analyzedProps = props.map((prop) => ({
    name: prop.name,
    summary: prop.description,
    descriptions: [prop.description],
  }))
  const analyzedLocations = inferAgentLocations(pkg)
  const locationName = asString(analyzedLocations[0]?.name) || 'Agent 主场景'
  const clipList: StoryToScriptClipCandidate[] = beats.map((beat, index) => {
    const participants = inferAgentBeatParticipants(roles, beat)
    const beatProps = inferAgentBeatProps(props, beat)
    return {
      id: `clip_${index + 1}`,
      startText: beat,
      endText: beat,
      summary: `Agent 剧情片段 ${index + 1}/${beats.length}：${beat}`,
      location: locationName,
      characters: participants.map((role) => role.name),
      props: beatProps.map((prop) => prop.name),
      content: buildAgentVideoPrompt({
        pkg,
        beat,
        beatIndex: index + 1,
        totalBeats: beats.length,
        roles,
        participants,
        props: beatProps,
        locationName,
      }),
      matchLevel: 'L1',
      matchConfidence: 1,
    }
  })
  const screenplayResults: StoryToScriptScreenplayResult[] = clipList.map((clip) => ({
    clipId: clip.id,
    success: true,
    sceneCount: 1,
    screenplay: {
      scenes: [
        {
          heading: clip.location || locationName,
          description: clip.content,
          characters: clip.characters,
          content: [
            {
              type: 'action',
              text: clip.summary,
            },
          ],
        },
      ],
    },
  }))
  const charactersIntroduction = buildCharactersIntroduction(
    roles.map((role) => ({
      name: role.name,
      introduction: role.description,
    })),
  )
  return {
    characterStep: { text: JSON.stringify({ characters: analyzedCharacters }), reasoning: 'agent story package deterministic pipeline' },
    locationStep: { text: JSON.stringify({ locations: analyzedLocations }), reasoning: 'agent story package deterministic pipeline' },
    propStep: { text: JSON.stringify({ props: analyzedProps }), reasoning: 'agent story package deterministic pipeline' },
    splitStep: { text: JSON.stringify(clipList), reasoning: 'agent story package deterministic pipeline' },
    charactersObject: { characters: analyzedCharacters },
    locationsObject: { locations: analyzedLocations },
    propsObject: { props: analyzedProps },
    analyzedCharacters,
    analyzedLocations,
    analyzedProps,
    charactersLibName: roles.map((role) => role.name).join('、') || '无',
    locationsLibName: locationName,
    propsLibName: props.map((prop) => prop.name).join('、') || '无',
    charactersIntroduction,
    clipList,
    screenplayResults,
    summary: {
      characterCount: analyzedCharacters.length,
      locationCount: analyzedLocations.length,
      propCount: analyzedProps.length,
      clipCount: clipList.length,
      screenplaySuccessCount: screenplayResults.length,
      screenplayFailedCount: 0,
      totalScenes: screenplayResults.length,
    },
  }
}

function buildShotSheetFastPathResult(content: string): StoryToScriptOrchestratorResult | null {
  const shots = parseShotSheetText(content)
  if (shots.length < 8) return null
  const blocks = buildVideoPromptBlocks(content)
  if (blocks.length === 0) return null

  const characterNames = uniqueStrings(shots.flatMap((shot) => [
    ...parseShotCharacters(shot.fields['角色']),
    ...shot.scene.characters,
  ]))
  const locationNames = uniqueStrings(shots.map((shot) => shot.scene.heading))
  const analyzedCharacters = characterNames.map(inferCharacterProfile)
  const analyzedLocations = locationNames.map((name) => ({
    name,
    summary: /手术室/.test(name)
      ? '现代美国医院手术室，冷绿色医疗灯光、无影灯、英文监护仪和绿色无菌布，专业克制不血腥。'
      : '现代美国私立医院空间，白蓝墙面、冷白顶灯、英文导视牌和干净医疗环境保持一致。',
    descriptions: [
      /手术室/.test(name)
        ? '冷绿色医疗灯光，绿色无菌布，英文监护仪，无影灯，金属器械，真实真人短剧质感。'
        : '白色墙面配浅蓝色导视线，冷白 LED 顶灯，英文门牌和等待区椅子，真实欧美医院短剧质感。',
    ],
  }))
  const clipList: StoryToScriptClipCandidate[] = blocks.map((block) => {
    const first = block.shots[0]
    const last = block.shots[block.shots.length - 1]
    const characters = uniqueStrings(block.shots.flatMap((shot) => parseShotCharacters(shot.fields['角色'])))
    return {
      id: `clip_${block.blockNumber}`,
      startText: first.code,
      endText: last.code,
      summary: `${first.code}-${last.code} 视频提示词块，按原始镜头稿复刻构图、站位、台词和节奏。`,
      location: first.scene.heading,
      characters,
      props: [],
      content: block.text,
      matchLevel: 'L1',
      matchConfidence: 1,
    }
  })
  const screenplayResults: StoryToScriptScreenplayResult[] = blocks.map((block) => ({
    clipId: `clip_${block.blockNumber}`,
    success: true,
    sceneCount: 1,
    screenplay: {
      scenes: [
        {
          heading: block.shots[0].scene.heading,
          description: block.text,
          content: block.shots.map((shot) => ({
            type: 'action',
            text: `${shot.code} ${shot.fields['画面'] || ''} ${shot.fields['对白/字幕'] || ''}`.trim(),
          })),
        },
      ],
    },
  }))
  const charactersLibName = characterNames.length > 0 ? characterNames.join('、') : '无'
  const locationsLibName = locationNames.length > 0 ? locationNames.join('、') : '无'
  const charactersIntroduction = buildCharactersIntroduction(
    analyzedCharacters.map((item) => ({
      name: asString(item.name),
      introduction: asString(item.introduction),
    })),
  )

  return {
    characterStep: { text: JSON.stringify({ characters: analyzedCharacters }), reasoning: 'shot-sheet deterministic fast path' },
    locationStep: { text: JSON.stringify({ locations: analyzedLocations }), reasoning: 'shot-sheet deterministic fast path' },
    propStep: { text: JSON.stringify({ props: [] }), reasoning: 'shot-sheet deterministic fast path' },
    splitStep: { text: JSON.stringify(clipList), reasoning: 'shot-sheet deterministic fast path' },
    charactersObject: { characters: analyzedCharacters },
    locationsObject: { locations: analyzedLocations },
    propsObject: { props: [] },
    analyzedCharacters,
    analyzedLocations,
    analyzedProps: [],
    charactersLibName,
    locationsLibName,
    propsLibName: '无',
    charactersIntroduction,
    clipList,
    screenplayResults,
    summary: {
      characterCount: analyzedCharacters.length,
      locationCount: analyzedLocations.length,
      propCount: 0,
      clipCount: clipList.length,
      screenplaySuccessCount: screenplayResults.length,
      screenplayFailedCount: 0,
      totalScenes: screenplayResults.length,
    },
  }
}

function buildShortDramaBriefFastPathResult(content: string): StoryToScriptOrchestratorResult | null {
  const brief = parseShortDramaBrief(content)
  if (!brief) return null
  const beats = splitShortDramaBriefBeats(brief.storyText)
  if (beats.length === 0) return null

  const analyzedCharacters = brief.roleAssets.map((role) =>
    inferCharacterProfileFromBrief(role.name, role.description))
  const analyzedLocations = [
    {
      name: brief.isMedical ? '现代美国私立医院' : '核心短剧场景',
      summary: brief.isMedical
        ? '现代美国私立医院走廊或手术区，白蓝墙面、冷白顶灯、英文导视标识，真实欧美医疗短剧质感。'
        : '根据剧情建立的真实短剧主场景，空间关系、光线、色调和角色站位在全片保持一致。',
      descriptions: [
        brief.isMedical
          ? '白色墙面配浅蓝色导视线，冷白 LED 顶灯，英文门牌、手术室门、等待区椅子和金属扶手。'
          : '真实摄影质感，场景空间清楚，环境元素服务剧情，不使用动画风或海报式构图。',
      ],
    },
  ]
  const clipList: StoryToScriptClipCandidate[] = beats.map((beat, index) => {
    const contentText = buildShortDramaBriefVideoPrompt({
      brief,
      beat,
      beatIndex: index + 1,
      totalBeats: beats.length,
    })
    return {
      id: `clip_${index + 1}`,
      startText: beat,
      endText: beat,
      summary: `短剧精细视频提示词块 ${index + 1}/${beats.length}：${beat}`,
      location: analyzedLocations[0].name,
      characters: brief.roleAssets.map((role) => role.name),
      props: [],
      content: contentText,
      matchLevel: 'L1',
      matchConfidence: 1,
    }
  })
  const screenplayResults: StoryToScriptScreenplayResult[] = clipList.map((clip) => ({
    clipId: clip.id,
    success: true,
    sceneCount: 1,
    screenplay: {
      scenes: [
        {
          heading: clip.location || analyzedLocations[0].name,
          description: clip.content,
          content: [
            {
              type: 'action',
              text: clip.summary,
            },
          ],
        },
      ],
    },
  }))
  const charactersLibName = brief.roleAssets.map((role) => role.name).join('、') || '无'
  const charactersIntroduction = buildCharactersIntroduction(
    brief.roleAssets.map((role) => ({
      name: role.name,
      introduction: role.description,
    })),
  )

  return {
    characterStep: { text: JSON.stringify({ characters: analyzedCharacters }), reasoning: 'short-drama brief deterministic fast path' },
    locationStep: { text: JSON.stringify({ locations: analyzedLocations }), reasoning: 'short-drama brief deterministic fast path' },
    propStep: { text: JSON.stringify({ props: [] }), reasoning: 'short-drama brief deterministic fast path' },
    splitStep: { text: JSON.stringify(clipList), reasoning: 'short-drama brief deterministic fast path' },
    charactersObject: { characters: analyzedCharacters },
    locationsObject: { locations: analyzedLocations },
    propsObject: { props: [] },
    analyzedCharacters,
    analyzedLocations,
    analyzedProps: [],
    charactersLibName,
    locationsLibName: analyzedLocations[0].name,
    propsLibName: '无',
    charactersIntroduction,
    clipList,
    screenplayResults,
    summary: {
      characterCount: analyzedCharacters.length,
      locationCount: analyzedLocations.length,
      propCount: 0,
      clipCount: clipList.length,
      screenplaySuccessCount: screenplayResults.length,
      screenplayFailedCount: 0,
      totalScenes: screenplayResults.length,
    },
  }
}

function extractAnalyzedCharacters(obj: Record<string, unknown>): Record<string, unknown>[] {
  const primary = toObjectArray(obj.characters)
  if (primary.length > 0) return primary
  return toObjectArray(obj.new_characters)
}

function extractAnalyzedLocations(obj: Record<string, unknown>): Record<string, unknown>[] {
  return toObjectArray(obj.locations)
}

function extractAnalyzedProps(obj: Record<string, unknown>): Record<string, unknown>[] {
  return toObjectArray(obj.props)
}

const MAX_STEP_ATTEMPTS = 3
const MAX_SPLIT_BOUNDARY_ATTEMPTS = 2
const MAX_RETRY_DELAY_MS = 10_000
const CLIP_BOUNDARY_SUFFIX = `

[Boundary Constraints]
1. The "start" and "end" anchors must come from the original text and be locatable.
2. Allow punctuation/whitespace differences, but do not rewrite key entities or events.
3. If anchors cannot be located reliably, return [] directly.`

function normalizeBoundaryText(value: string): string {
  return value.replace(/\s+/g, '')
}

function isWholeContentSingleClip(input: {
  clipCount: number
  startText: string
  endText: string
  content: string
}): boolean {
  if (input.clipCount !== 1) return false
  const content = normalizeBoundaryText(input.content.trim())
  if (!content) return false
  return (
    normalizeBoundaryText(input.startText) === content
    && normalizeBoundaryText(input.endText) === content
  )
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeRetryDelayMs(attempt: number) {
  const base = Math.min(1_000 * Math.pow(2, Math.max(0, attempt - 1)), MAX_RETRY_DELAY_MS)
  const jitter = Math.floor(Math.random() * 300)
  return base + jitter
}

function isRecoverableJsonParseError(error: unknown, normalizedMessage: string): boolean {
  if (normalizedMessage.includes('ark responses 调用失败')) return false
  if (normalizedMessage.includes('invalidparameter')) return false
  if (normalizedMessage.includes('unknown field')) return false

  if (error instanceof SyntaxError) return true

  return normalizedMessage.includes('unexpected token')
    || normalizedMessage.includes('unexpected end of json input')
    || normalizedMessage.includes('json format invalid')
    || normalizedMessage.includes('invalid clip json format')
}

async function runStepWithRetry<T>(
  runStep: StoryToScriptOrchestratorInput['runStep'],
  baseMeta: StoryToScriptStepMeta,
  prompt: string,
  action: string,
  maxOutputTokens: number,
  parse: (text: string) => T,
): Promise<{ output: StoryToScriptStepOutput; parsed: T }> {
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
      const lowerMessage = normalizedError.message.toLowerCase()
      const shouldRetry = attempt < MAX_STEP_ATTEMPTS
        && (
          normalizedError.retryable
          || isRecoverableJsonParseError(error, lowerMessage)
        )

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
      await wait(computeRetryDelayMs(attempt))
    }
  }
  throw lastError!
}

export async function runStoryToScriptOrchestrator(
  input: StoryToScriptOrchestratorInput,
): Promise<StoryToScriptOrchestratorResult> {
  const {
    concurrency: rawConcurrency,
    content,
    disableAgentStoryPackageFastPath,
    baseCharacters,
    baseLocations,
    baseProps = [],
    baseCharacterIntroductions,
    promptTemplates,
    runStep,
    onStepError,
    onLog,
  } = input
  const concurrency = normalizeWorkflowConcurrencyValue(
    rawConcurrency,
    DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
  )
  const shotSheetFastPath = buildShotSheetFastPathResult(content)
  if (shotSheetFastPath) {
    onLog?.('检测到 SH 镜头稿，使用确定性短剧转绘切分路径', {
      clipCount: shotSheetFastPath.summary.clipCount,
      characterCount: shotSheetFastPath.summary.characterCount,
      locationCount: shotSheetFastPath.summary.locationCount,
    })
    return shotSheetFastPath
  }
  const agentStoryPackageFastPath = disableAgentStoryPackageFastPath
    ? null
    : buildAgentStoryPackageFastPathResult(content)
  if (agentStoryPackageFastPath) {
    onLog?.('检测到 Agent 故事包，使用 Agent 专用故事到视频提示词路径', {
      clipCount: agentStoryPackageFastPath.summary.clipCount,
      characterCount: agentStoryPackageFastPath.summary.characterCount,
      locationCount: agentStoryPackageFastPath.summary.locationCount,
    })
    return agentStoryPackageFastPath
  }
  const shortDramaBriefFastPath = buildShortDramaBriefFastPathResult(content)
  if (shortDramaBriefFastPath) {
    onLog?.('检测到短剧 brief，使用确定性精细视频提示词路径', {
      clipCount: shortDramaBriefFastPath.summary.clipCount,
      characterCount: shortDramaBriefFastPath.summary.characterCount,
      locationCount: shortDramaBriefFastPath.summary.locationCount,
    })
    return shortDramaBriefFastPath
  }

  const baseCharactersText = baseCharacters.length > 0 ? baseCharacters.join('、') : '无'
  const baseLocationsText = baseLocations.length > 0 ? baseLocations.join('、') : '无'
  const basePropsText = baseProps.length > 0 ? baseProps.join('、') : '无'
  const baseCharacterInfo = baseCharacterIntroductions.length > 0
    ? baseCharacterIntroductions.map((item, index) => `${index + 1}. ${item.name}`).join('\n')
    : '暂无已有角色'

  const characterPrompt = applyTemplate(promptTemplates.characterPromptTemplate, {
    input: content,
    characters_lib_name: baseCharactersText,
    characters_lib_info: baseCharacterInfo,
  })
  const locationPrompt = applyTemplate(promptTemplates.locationPromptTemplate, {
    input: content,
    locations_lib_name: baseLocationsText,
  })
  const propPrompt = applyTemplate(promptTemplates.propPromptTemplate, {
    input: content,
    props_lib_name: basePropsText,
  })

  onLog?.('开始步骤1：角色/场景/道具分析（并行）')
  const analysisResults = await mapWithConcurrency(
    [
      () => runStepWithRetry(
        runStep,
        {
          stepId: 'analyze_characters',
          stepTitle: 'progress.streamStep.analyzeCharacters',
          stepIndex: 1,
          stepTotal: 2,
          groupId: 'analysis',
          parallelKey: 'characters',
          retryable: true,
        },
        characterPrompt,
        'analyze_characters',
        2200,
        safeParseJsonObject,
      ),
      () => runStepWithRetry(
        runStep,
        {
          stepId: 'analyze_locations',
          stepTitle: 'progress.streamStep.analyzeLocations',
          stepIndex: 2,
          stepTotal: 2,
          groupId: 'analysis',
          parallelKey: 'locations',
          retryable: true,
        },
        locationPrompt,
        'analyze_locations',
        2200,
        safeParseJsonObject,
      ),
      () => runStepWithRetry(
        runStep,
        {
          stepId: 'analyze_props',
          stepTitle: 'progress.streamStep.analyzeProps',
          stepIndex: 3,
          stepTotal: 3,
          groupId: 'analysis',
          parallelKey: 'props',
          retryable: true,
        },
        propPrompt,
        'analyze_props',
        1600,
        safeParseJsonObject,
      ),
    ],
    concurrency,
    async (run) => await run(),
  )
  const { output: characterStep, parsed: charactersObject } = analysisResults[0]
  const { output: locationStep, parsed: locationsObject } = analysisResults[1]
  const { output: propStep, parsed: propsObject } = analysisResults[2]

  const analyzedCharacters = extractAnalyzedCharacters(charactersObject)
  const analyzedLocations = extractAnalyzedLocations(locationsObject)
  const analyzedProps = extractAnalyzedProps(propsObject)

  const analyzedCharacterNames = analyzedCharacters
    .map((item) => asString(item.name).trim())
    .filter(Boolean)
  const analyzedLocationNames = analyzedLocations
    .map((item) => asString(item.name).trim())
    .filter(Boolean)
  const analyzedPropNames = analyzedProps
    .map((item) => asString(item.name).trim())
    .filter(Boolean)

  // 合并新发现角色与已有角色库（新角色优先，已有角色补充），避免已有角色被覆盖丢失
  const analyzedCharacterNameSet = new Set(analyzedCharacterNames)
  const mergedCharacterNames = [
    ...analyzedCharacterNames,
    ...baseCharacters.filter((name) => !analyzedCharacterNameSet.has(name)),
  ]
  const charactersLibName = mergedCharacterNames.length > 0
    ? mergedCharacterNames.join('、')
    : baseCharactersText

  const locationsLibName = analyzedLocationNames.length > 0
    ? analyzedLocationNames.join('、')
    : baseLocationsText
  const analyzedPropNameSet = new Set(analyzedPropNames)
  const mergedPropNames = [
    ...analyzedPropNames,
    ...baseProps.filter((name) => !analyzedPropNameSet.has(name)),
  ]
  const propsLibName = mergedPropNames.length > 0
    ? mergedPropNames.join('、')
    : basePropsText

  // 合并角色介绍：新角色 + 未被新角色覆盖的已有角色介绍
  const mergedCharacterIntroductions = [
    ...analyzedCharacters.map((item) => ({
      name: asString(item.name),
      introduction: asString(item.introduction),
    })),
    ...baseCharacterIntroductions
      .filter((item) => !analyzedCharacterNameSet.has(item.name))
      .map((item) => ({
        name: item.name,
        introduction: item.introduction || '',
      })),
  ]
  const charactersIntroduction = buildCharactersIntroduction(
    mergedCharacterIntroductions.length > 0
      ? mergedCharacterIntroductions
      : baseCharacterIntroductions.map((item) => ({
        name: item.name,
        introduction: item.introduction || '',
      })),
  )

  onLog?.('开始步骤2：片段切分（最多重试1次）', {
    charactersLibName,
    locationsLibName,
  })

  const splitPromptBase = applyTemplate(promptTemplates.clipPromptTemplate, {
    input: content,
    locations_lib_name: locationsLibName || '无',
    characters_lib_name: charactersLibName || '无',
    props_lib_name: propsLibName || '无',
    characters_introduction: charactersIntroduction || '暂无角色介绍',
  })
  const splitPrompt = `${splitPromptBase}${CLIP_BOUNDARY_SUFFIX}`

  let splitStep: StoryToScriptStepOutput | null = null
  let clipList: StoryToScriptClipCandidate[] = []
  let lastBoundaryError: Error | null = null

  for (let attempt = 1; attempt <= MAX_SPLIT_BOUNDARY_ATTEMPTS; attempt += 1) {
    const splitMeta: StoryToScriptStepMeta = {
      stepId: 'split_clips',
      stepAttempt: attempt,
      stepTitle: 'progress.streamStep.splitClips',
      stepIndex: 1,
      stepTotal: 1,
      dependsOn: ['analyze_characters', 'analyze_locations'],
      retryable: true,
    }

    const { output, parsed: rawClipList } = await runStepWithRetry(
      runStep,
      splitMeta,
      splitPrompt,
      'split_clips',
      2600,
      parseClipArray,
    )
    if (rawClipList.length === 0) {
      lastBoundaryError = new Error('split_clips returned empty clips')
      onLog?.('片段切分结果为空', {
        attempt,
        maxAttempts: MAX_SPLIT_BOUNDARY_ATTEMPTS,
      })
      continue
    }

    const matcher = createClipContentMatcher(content)
    const nextClipList: StoryToScriptClipCandidate[] = []
    let searchFrom = 0
    let failedAt: { clipId: string; startText: string; endText: string } | null = null

    for (let index = 0; index < rawClipList.length; index += 1) {
      const item = rawClipList[index]
      const startText = asString(item.start)
      const endText = asString(item.end)
      const clipId = `clip_${index + 1}`
      if (isWholeContentSingleClip({
        clipCount: rawClipList.length,
        startText,
        endText,
        content,
      })) {
        nextClipList.push({
          id: clipId,
          startText,
          endText,
          summary: asString(item.summary),
          location: asString(item.location) || null,
          characters: toStringArray(item.characters),
          props: toStringArray(item.props),
          content,
          matchLevel: 'L1',
          matchConfidence: 1,
        })
        searchFrom = content.length
        continue
      }
      const match = matcher.matchBoundary(startText, endText, searchFrom)
      if (!match) {
        if (shouldFallbackToWholeContentSingleClip({
          clipCount: rawClipList.length,
          startText,
          endText,
          content,
        })) {
          const fallback = buildWholeContentClipBoundary(content)
          nextClipList.push({
            id: clipId,
            startText: fallback.startText,
            endText: fallback.endText,
            summary: asString(item.summary),
            location: asString(item.location) || null,
            characters: toStringArray(item.characters),
            props: toStringArray(item.props),
            content: fallback.content,
            matchLevel: 'L2',
            matchConfidence: 0.91,
          })
          searchFrom = content.length
          continue
        }
        failedAt = { clipId, startText, endText }
        break
      }

      nextClipList.push({
        id: clipId,
        startText,
        endText,
        summary: asString(item.summary),
        location: asString(item.location) || null,
        characters: toStringArray(item.characters),
        props: toStringArray(item.props),
        content: content.slice(match.startIndex, match.endIndex),
        matchLevel: match.level,
        matchConfidence: match.confidence,
      })
      searchFrom = match.endIndex
    }

    if (!failedAt) {
      splitStep = output
      clipList = nextClipList
      const levelCount: Record<ClipMatchLevel, number> = { L1: 0, L2: 0, L3: 0 }
      for (const clip of nextClipList) {
        levelCount[clip.matchLevel] += 1
      }
      onLog?.('片段边界匹配成功', {
        attempt,
        clipCount: nextClipList.length,
        levelCount,
      })
      break
    }

    lastBoundaryError = new Error(
      `split_clips boundary matching failed at ${failedAt.clipId}: start="${failedAt.startText}" end="${failedAt.endText}"`,
    )
    onLog?.('片段边界匹配失败', {
      attempt,
      maxAttempts: MAX_SPLIT_BOUNDARY_ATTEMPTS,
      failedClip: failedAt.clipId,
      startText: failedAt.startText,
      endText: failedAt.endText,
    })
  }

  if (!splitStep) {
    throw lastBoundaryError || new Error('split_clips boundary matching failed')
  }

  onLog?.('开始步骤3：对每个片段做剧本转换（并行）', { clipCount: clipList.length })

  const screenplayResults = await mapWithConcurrency(
    clipList,
    concurrency,
    async (clip, index): Promise<StoryToScriptScreenplayResult> => {
      const stepMeta: StoryToScriptStepMeta = {
        stepId: `screenplay_${clip.id}`,
        stepTitle: 'progress.streamStep.screenplayConversion',
        stepIndex: index + 1,
        stepTotal: clipList.length || 1,
        dependsOn: ['split_clips'],
        groupId: 'screenplay_conversion',
        parallelKey: clip.id,
        retryable: true,
      }

      try {
        const screenplayPrompt = applyTemplate(promptTemplates.screenplayPromptTemplate, {
          clip_content: clip.content,
          locations_lib_name: locationsLibName || '无',
          characters_lib_name: charactersLibName || '无',
          props_lib_name: propsLibName || '无',
          characters_introduction: charactersIntroduction || '暂无角色介绍',
          clip_id: clip.id,
        })

        const { parsed: screenplay } = await runStepWithRetry(
          runStep,
          stepMeta,
          screenplayPrompt,
          'screenplay_conversion',
          2200,
          parseScreenplayObject,
        )
        const scenes = Array.isArray(screenplay.scenes) ? screenplay.scenes : []
        return {
          clipId: clip.id,
          success: true,
          sceneCount: scenes.length,
          screenplay,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        onStepError?.(stepMeta, message)
        return {
          clipId: clip.id,
          success: false,
          sceneCount: 0,
          error: message,
        }
      }
    },
  )

  const screenplaySuccessCount = screenplayResults.filter((item) => item.success).length
  const screenplayFailedCount = screenplayResults.length - screenplaySuccessCount
  const totalScenes = screenplayResults.reduce((sum, item) => sum + item.sceneCount, 0)

  return {
    characterStep,
    locationStep,
    propStep,
    splitStep,
    charactersObject,
    locationsObject,
    propsObject,
    analyzedCharacters,
    analyzedLocations,
    analyzedProps,
    charactersLibName,
    locationsLibName,
    propsLibName,
    charactersIntroduction,
    clipList,
    screenplayResults,
    summary: {
      characterCount: analyzedCharacters.length,
      locationCount: analyzedLocations.length,
      propCount: analyzedProps.length,
      clipCount: clipList.length,
      screenplaySuccessCount,
      screenplayFailedCount,
      totalScenes,
    },
  }
}
