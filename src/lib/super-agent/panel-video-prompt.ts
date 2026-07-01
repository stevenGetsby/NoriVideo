import {
  buildPreciseBeatVideoPrompt,
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

function buildSegmentId(panelNumber: number | null | undefined): string {
  const number = typeof panelNumber === 'number' && Number.isFinite(panelNumber) && panelNumber > 0
    ? Math.round(panelNumber)
    : 1
  return `S01-SEG${String(number).padStart(2, '0')}`
}

function isPreciseSegmentVideoPrompt(prompt: string): boolean {
  const text = prompt.trim()
  return /^S\d{2}-SEG\d{2}\n/.test(text)
    && text.includes('\n◎ 参考资产\n')
    && text.includes('\n◎ 输出参数\n')
    && text.includes('\n◈ 一致性控制\n')
    && text.includes('\n◈ 视频提示词\n')
    && text.includes('\n开场状态：\n')
    && text.includes('\nShot 1\n')
    && text.includes('\nduration: ')
    && text.includes('\n镜头：')
    && text.includes('\n画面：\n')
    && text.includes('\n光影：')
    && text.includes('\n【本分镜负面要求】')
}

function cleanLegacyPanelPrompt(value: string): string {
  const text = value
    .replace(/【Agent 视频分镜提示词】/g, '')
    .replace(/【片段内分镜\d+[^】]*】/g, '')
    .replace(/【本分镜负面要求】[\s\S]*$/g, '')
    .trim()
  const actionMatch = text.match(/本 panel 动作\/台词：\s*\d+(?:\.\d+)?-\d+(?:\.\d+)?s[：:]([\s\S]+?)(?:\n视频提示：|$)/)
  if (actionMatch?.[1]) return actionMatch[1].trim()
  return text
    .replace(/^场景：[^\n]*\n?/gm, '')
    .replace(/^视频提示：/gm, '')
    .replace(/本 panel 动作\/台词：/g, '')
    .trim()
}

function buildFallbackPrecisePrompt(input: AgentPanelVideoPromptInput, duration: number): string {
  const description = readText(input.description)
  const sourceText = readText(input.sourceText)
  const clipContent = readText(input.clipContent)
  const currentPrompt = cleanLegacyPanelPrompt(readText(input.videoPrompt))
  const action = summarizeVideoPromptBeat(
    currentPrompt || description || sourceText || clipContent || '按当前剧情片段完成这一拍的主体动作、镜头运动和情绪落点。',
    140,
  )
  const location = readText(input.location) || '按剧情片段锁定的场景'
  const characters = parseNameList(input.characters)
  const props = parseNameList(input.props)
  const noHuman = /不要真人|不要人脸|no\s*human|no\s*face/i.test(`${action}\n${clipContent}`)
  const noMusic = /不要背景音乐|无背景音乐|no\s*(background\s*)?music/i.test(`${action}\n${clipContent}`)

  return buildPreciseBeatVideoPrompt({
    segmentId: buildSegmentId(input.panelNumber),
    location,
    beat: action,
    durationSeconds: duration,
    characters: noHuman ? [] : characters.map((name) => ({ name })),
    props: props.map((name) => ({ name })),
    sceneOpening: `${location}，按当前 panel 的剧情片段建立起始空间；主体、道具、入口方向和环境声保持连续<环境声、脚步声、衣料摩擦声>。`,
    lighting: `${readText(input.shotType) || '中景到近景'} 与 ${readText(input.cameraMove) || '固定或轻微推近'} 对应的主光保持稳定；主体动作区清晰，背景不抢戏。${noMusic ? '不要生成背景音乐。' : ''}`,
    dialogueInstruction: /英文|English|Dr\.|Nurse|Ava/i.test(`${action}\n${clipContent}`)
      ? '如本片段需要台词，使用简短自然英文台词并保持英文口型同步。'
      : '如本片段需要台词，使用简短自然台词并保持口型同步。',
    negativeRequirements: [
      noHuman ? '不要真人、不要人脸、不要人体剪影；只呈现锁定的产品、道具、场景和抽象视觉元素。' : '',
      noMusic ? '不要生成背景音乐，只保留必要环境声、脚步声、衣料摩擦声和道具声。' : '',
    ].filter(Boolean).join(' ') || undefined,
  })
}

export function ensureAgentPanelVideoPrompt(input: AgentPanelVideoPromptInput): AgentPanelVideoPromptResult {
  const currentPrompt = readText(input.videoPrompt)
  const duration = clampDuration(input.duration)
  if (isPreciseSegmentVideoPrompt(currentPrompt)) {
    return { videoPrompt: currentPrompt, duration, changed: false }
  }

  const prompt = buildFallbackPrecisePrompt(input, duration)

  return {
    videoPrompt: prompt,
    duration,
    changed: prompt !== currentPrompt,
  }
}
