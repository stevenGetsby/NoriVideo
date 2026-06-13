import {
  CANONICAL_PANEL_NEGATIVE_REQUIREMENTS,
  buildCanonicalTimedActionLines,
  summarizeVideoPromptBeat,
} from '@/lib/novel-promotion/short-drama-video-prompt'

export type AgentPanelVideoPromptInput = {
  panelNumber?: number | null
  description?: string | null
  location?: string | null
  characters?: string | null
  props?: string | null
  shotType?: string | null
  cameraMove?: string | null
  sourceText?: string | null
  videoPrompt?: string | null
  duration?: number | null
  clipContent?: string | null
}

export type AgentPanelVideoPromptResult = {
  videoPrompt: string
  duration: number
  changed: boolean
}

function readText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampDuration(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 4
  return Math.max(1, Math.min(15, Math.round(value)))
}

function parseNameList(raw: string | null | undefined): string[] {
  const text = readText(raw)
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === 'string') return item.trim()
          if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
            return (item as { name: string }).name.trim()
          }
          return ''
        })
        .filter(Boolean)
    }
  } catch {
    // Fall through to delimiter parsing.
  }
  return text.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean)
}

function hasTimedActionLine(prompt: string): boolean {
  return /\n\d+(?:\.\d+)?-\d+(?:\.\d+)?s[：:]/.test(prompt)
}

function isCanonicalPanelVideoPrompt(prompt: string): boolean {
  return prompt.startsWith('场景：')
    && prompt.includes('\n剧情片段：')
    && prompt.includes('\n执行要求：严格执行本 video_prompt')
    && prompt.includes('\n本分镜使用资产：')
    && prompt.includes('\n角色行为拆分：')
    && prompt.includes('\n人物站位：')
    && prompt.includes('\n镜头语言：')
    && prompt.includes('\n【本分镜负面要求】')
    && hasTimedActionLine(prompt)
}

function extractCanonicalPromptFromLegacyWrapper(prompt: string): string | null {
  const actionMatch = prompt.match(/本 panel 动作\/台词：\s*\d+(?:\.\d+)?-\d+(?:\.\d+)?s[：:]([\s\S]+?)(?:\n视频提示：|\n【本分镜负面要求】不要生成乱码文字|$)/)
  const candidate = actionMatch?.[1]?.trim()
  if (candidate && isCanonicalPanelVideoPrompt(candidate)) return candidate

  const sceneIndex = prompt.indexOf('场景：')
  if (sceneIndex < 0) return null
  const sliced = prompt.slice(sceneIndex)
  const endMarkerIndex = sliced.indexOf('\n视频提示：')
  const candidateFromScene = (endMarkerIndex >= 0 ? sliced.slice(0, endMarkerIndex) : sliced).trim()
  return isCanonicalPanelVideoPrompt(candidateFromScene) ? candidateFromScene : null
}

function buildFallbackCanonicalPrompt(input: AgentPanelVideoPromptInput, duration: number): string {
  const description = readText(input.description)
  const sourceText = readText(input.sourceText)
  const clipContent = readText(input.clipContent)
  const currentPrompt = readText(input.videoPrompt)
  const action = summarizeVideoPromptBeat(
    currentPrompt || description || sourceText || clipContent || '按当前剧情片段完成这一拍的主体动作、镜头运动和情绪落点。',
    120,
  )
  const location = readText(input.location) || '按剧情片段锁定的场景'
  const shotType = readText(input.shotType) || '中景到近景'
  const cameraMove = readText(input.cameraMove) || '固定镜头或轻微推近'
  const characters = parseNameList(input.characters)
  const props = parseNameList(input.props)
  const roleNames = characters.join('、')
  const propNames = props.join('、')
  const roleActionText = characters.length > 0
    ? characters.map((character) => `${character}：执行剧情片段中的核心动作、台词和听者反应。`).join('；')
    : '主体资产：执行剧情片段中的核心动作和视觉变化。'
  const noMusic = /不要背景音乐|无背景音乐|no\s*(background\s*)?music/i.test(`${action}\n${clipContent}`)
  const noHuman = /不要真人|不要人脸|no\s*human|no\s*face/i.test(`${action}\n${clipContent}`)

  return [
    `场景：${location}。`,
    `剧情片段：${action}`,
    '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
    noMusic ? '声音要求：不要生成背景音乐，只保留必要环境声、脚步声、衣料摩擦声和道具声。' : '',
    noHuman ? '画面约束：不要真人、不要人脸、不要人体剪影；只呈现锁定的产品、道具、场景和抽象视觉元素。' : '',
    `本分镜使用资产：角色=${roleNames || '无'}；场景=${location}；道具=${propNames || '按剧情锁定资产'}。`,
    `角色行为拆分：${roleActionText}`,
    roleNames
      ? `人物站位：${roleNames} 按剧情关系形成清楚前景、中景、背景层次；说话者占主画面，听者可在前景边缘或背景虚化。`
      : '人物站位：无真人角色时，主体资产放在视觉中心，环境资产只服务动作和信息传达。',
    `镜头语言：${shotType}，${cameraMove}；镜头只执行本 panel 的动作，不新增无关镜头。`,
    ...buildCanonicalTimedActionLines({
      duration,
      scene: location,
      roleNames,
      roleActionText,
      beatSummary: action,
      propNames,
      dialogueInstruction: /英文|English|Dr\.|Nurse|Ava/i.test(`${action}\n${clipContent}`)
        ? '如本片段需要台词，使用简短自然英文台词并保持英文口型同步。'
        : '如本片段需要台词，使用简短自然台词并保持口型同步。',
    }),
    `【本分镜负面要求】 ${CANONICAL_PANEL_NEGATIVE_REQUIREMENTS}`,
  ].filter(Boolean).join('\n')
}

export function ensureAgentPanelVideoPrompt(input: AgentPanelVideoPromptInput): AgentPanelVideoPromptResult {
  const currentPrompt = readText(input.videoPrompt)
  const duration = clampDuration(input.duration)
  if (isCanonicalPanelVideoPrompt(currentPrompt)) {
    return { videoPrompt: currentPrompt, duration, changed: false }
  }

  const unwrappedPrompt = currentPrompt.includes('【Agent 视频分镜提示词】')
    ? extractCanonicalPromptFromLegacyWrapper(currentPrompt)
    : null
  if (unwrappedPrompt) {
    return {
      videoPrompt: unwrappedPrompt,
      duration,
      changed: unwrappedPrompt !== currentPrompt,
    }
  }

  const prompt = buildFallbackCanonicalPrompt(input, duration)

  return {
    videoPrompt: prompt,
    duration,
    changed: prompt !== currentPrompt,
  }
}
