import { safeParseJsonObject } from '@/lib/json-repair'
import { prisma } from '@/lib/prisma'
import { persistStoryboardsAndPanels } from '@/lib/workers/handlers/script-to-storyboard-helpers'
import type { StoryboardPanel } from '@/lib/storyboard-phases'
import fs from 'node:fs/promises'
import JSZip from 'jszip'
import {
  buildPreciseBeatVideoPrompt,
  buildVideoPromptBlocks,
  parseShotSheetText,
  summarizeVideoPromptBeat,
  type ShotSheetShot,
} from '@/lib/novel-promotion/short-drama-video-prompt'
import {
  parseAgentStoryPackageText,
  type AgentStoryPackage,
} from './agent-story-package'
import type { AgentExecutionPlan } from './types'

type JsonRecord = Record<string, unknown>

export type AgentLlmCall = (
  systemPrompt: string,
  userPrompt: string,
  options?: {
    action?: string
    timeoutMs?: number
    maxFallbackModels?: number
  },
) => Promise<string>

type NormalizedAsset = {
  name: string
  summary: string
  visual: string
  aliases: string[]
}

type NormalizedClip = {
  index: number
  title: string
  summary: string
  location: string
  characters: string[]
  props: string[]
  content: string
  screenplay: JsonRecord
  duration: number
}

type NormalizedPanel = {
  clipIndex: number
  panelIndex: number
  summary: string
  location: string
  characters: string[]
  props: string[]
  shotType: string
  cameraMove: string
  duration: number
  videoPrompt: string
}

type Stage2Result = {
  characters: NormalizedAsset[]
  locations: NormalizedAsset[]
  props: NormalizedAsset[]
  clips: NormalizedClip[]
}

const AGENT_LLM_PIPELINE_SOURCE = 'agent-llm-storyboard-pipeline'
const MAX_ASSETS = 40
const MAX_CLIPS = 30
const MAX_PANELS = 80
const MAX_PROMPT_CHARS = 6000
const LLM_JSON_RETRY_COUNT = 2
const STAGE2_LLM_TIMEOUT_MS = 240_000
const STAGE3_CLIP_LLM_TIMEOUT_MS = 90_000
const SHOT_SCRIPT_LLM_RETRY_COUNT = 1
const SHOT_SCRIPT_LLM_TIMEOUT_MS = 240_000
const HARDCODED_STORYBOARD_DOCX_PATHS = [
  process.env.NORI_AGENT_HARDCODED_STORYBOARD_DOCX_PATH,
  '/Users/headmasterx/Desktop/视频提示词.docx',
].filter((value): value is string => Boolean(value?.trim()))

export function hasHardcodedStoryboardPromptSource(): boolean {
  return HARDCODED_STORYBOARD_DOCX_PATHS.length > 0
}

type HardcodedStoryboardPrompt = {
  index: number
  duration: number
  title: string
  prompt: string
  sceneText: string
  shotLanguage: string
}

function compactText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function readText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function uniqueStrings(values: unknown[], fallback: string[] = []): string[] {
  const normalized = values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
  const unique = Array.from(new Set(normalized))
  return unique.length > 0 ? unique : fallback
}

function uniqueTextValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => compactText(value)).filter(Boolean)))
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractDocxParagraphs(documentXml: string): string[] {
  const paragraphs = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []
  return paragraphs
    .map((paragraph) => {
      const pieces: string[] = []
      const pattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g
      for (const match of paragraph.matchAll(pattern)) {
        if (match[1] !== undefined) {
          pieces.push(decodeXmlText(match[1]))
        } else if (match[0].startsWith('<w:tab')) {
          pieces.push('\t')
        } else {
          pieces.push('\n')
        }
      }
      return pieces.join('').trim()
    })
    .filter(Boolean)
}

export function parseHardcodedStoryboardPromptText(text: string): HardcodedStoryboardPrompt[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const blocks: Array<{ index: number; duration: number; lines: string[] }> = []
  let current: { index: number; duration: number; lines: string[] } | null = null

  for (const line of lines) {
    const headerMatch = line.match(/【分镜\s*(\d+)[^】]*?(\d+)\s*秒[^】]*】/)
    if (headerMatch?.[1]) {
      if (current) blocks.push(current)
      current = {
        index: Number(headerMatch[1]),
        duration: clampInteger(Number(headerMatch[2]), 2, 15, 6),
        lines: [line],
      }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) blocks.push(current)

  return blocks.map((block) => {
    const promptLines = block.lines.filter((line) => (
      !/^[—\-\s]*【分镜\s*\d+[^】]*?秒[^】]*】[—\-\s]*$/.test(line)
    ))
    const prompt = promptLines.join('\n').trim()
    const sceneLine = promptLines.find((line) => /^场景[:：]/.test(line)) || ''
    const shotLine = promptLines.find((line) => /^镜头语言[:：]/.test(line)) || ''
    const sceneText = sceneLine.replace(/^场景[:：]\s*/, '').replace(/。来源镜头[:：].*$/, '').trim()
    return {
      index: block.index,
      duration: block.duration,
      title: sceneText || `视频分镜 ${block.index}`,
      prompt,
      sceneText,
      shotLanguage: shotLine.replace(/^镜头语言[:：]\s*/, '').trim(),
    }
  })
}

async function loadHardcodedStoryboardPromptsFromDocx(): Promise<HardcodedStoryboardPrompt[]> {
  for (const docxPath of HARDCODED_STORYBOARD_DOCX_PATHS) {
    try {
      const buffer = await fs.readFile(docxPath)
      const zip = await JSZip.loadAsync(buffer)
      const documentXml = await zip.file('word/document.xml')?.async('string')
      if (!documentXml) continue
      const prompts = parseHardcodedStoryboardPromptText(extractDocxParagraphs(documentXml).join('\n'))
      if (prompts.length > 0) return prompts
    } catch {
      continue
    }
  }
  return []
}

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function promptContainsName(prompt: string, asset: NormalizedAsset): boolean {
  const normalizedPrompt = normalizeMatchText(prompt)
  const names = [asset.name, ...asset.aliases].map(normalizeMatchText).filter(Boolean)
  return names.some((name) => normalizedPrompt.includes(name))
}

function inferHardcodedCharacters(prompt: string, characters: NormalizedAsset[]): string[] {
  return uniqueTextValues(
    characters
      .filter((character) => promptContainsName(prompt, character))
      .map((character) => character.name),
  ).slice(0, 6)
}

function inferHardcodedLocation(prompt: string, sceneText: string, locations: NormalizedAsset[]): string {
  const findLocation = (pattern: RegExp, exclude?: RegExp) => locations.find((location) => {
    const text = `${location.name}\n${location.summary}\n${location.visual}`
    return pattern.test(text) && (!exclude || !exclude.test(text))
  })
  const sceneSource = sceneText || prompt
  if (/ICU|重症监护/i.test(sceneSource)) {
    return findLocation(/ICU|重症监护/i)?.name || sceneText
  }
  if (/更衣|准备室|洗手池/.test(sceneSource)) {
    return findLocation(/更衣|准备室|locker|preparation|prep/i)?.name || sceneText
  }
  if (/走廊|导视线|等待区|扶手/.test(sceneSource)) {
    return findLocation(/走廊|corridor/i, /ICU/i)?.name
      || findLocation(/走廊|corridor/i)?.name
      || sceneText
  }
  if (/手术室|无影灯|无菌|监护仪/.test(sceneSource)) {
    return findLocation(/手术室|operating|surgery|surgical|无影灯|无菌|监护仪/i)?.name || sceneText
  }

  const source = `${sceneText}\n${prompt}`
  const direct = locations.find((location) => promptContainsName(source, location))
  if (direct) return direct.name
  if (/ICU|重症监护/i.test(source)) {
    return findLocation(/ICU|重症监护/i)?.name || sceneText
  }
  if (/更衣|准备室|洗手池/.test(source)) {
    return findLocation(/更衣|准备室|locker|preparation|prep/i)?.name || sceneText
  }
  if (/走廊|手术室门|等待区/.test(source)) {
    return findLocation(/走廊|corridor/i, /ICU/i)?.name
      || findLocation(/走廊|corridor/i)?.name
      || sceneText
  }
  if (/手术室|无影灯|无菌|监护仪/.test(source)) {
    return findLocation(/手术室|operating|surgery|surgical|无影灯|无菌|监护仪/i)?.name || sceneText
  }
  return locations[0]?.name || sceneText
}

function inferHardcodedProps(prompt: string, props: NormalizedAsset[]): string[] {
  const direct = uniqueTextValues(
    props
      .filter((prop) => promptContainsName(prompt, prop))
      .map((prop) => prop.name),
  )
  const inferred: string[] = []
  for (const prop of props) {
    const source = `${prop.name}\n${prop.summary}\n${prop.visual}`
    if (/(文件|病历|付款|排期|安排|file|document|chart|folder)/i.test(prompt)
      && /(文件|病历|file|document|chart|folder)/i.test(source)) {
      inferred.push(prop.name)
    }
    if (/(手术器械|金属器械|手术刀|scalpel|instrument)/i.test(prompt)
      && /(器械|手术刀|scalpel|instrument)/i.test(source)) {
      inferred.push(prop.name)
    }
    if (/(树叶|leaf)/i.test(prompt) && /(树叶|leaf)/i.test(source)) {
      inferred.push(prop.name)
    }
    if (/(月亮灯|光球|提灯|moon lamp|lantern)/i.test(prompt)
      && /(月亮灯|光球|提灯|moon lamp|lantern)/i.test(source)) {
      inferred.push(prop.name)
    }
  }
  return uniqueTextValues([...direct, ...inferred]).slice(0, 3)
}

function distributeHardcodedPanelsAcrossClips(
  prompts: HardcodedStoryboardPrompt[],
  clips: NormalizedClip[],
  characters: NormalizedAsset[],
  locations: NormalizedAsset[],
  props: NormalizedAsset[],
): Array<{ clip: NormalizedClip; panels: NormalizedPanel[] }> {
  const buckets = clips.map((clip) => ({ clip, panels: [] as NormalizedPanel[] }))
  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index]
    const bucketIndex = Math.min(clips.length - 1, Math.floor(index * clips.length / prompts.length))
    const location = inferHardcodedLocation(prompt.prompt, prompt.sceneText, locations)
    const promptCharacters = inferHardcodedCharacters(prompt.prompt, characters)
    buckets[bucketIndex]?.panels.push({
      clipIndex: bucketIndex + 1,
      panelIndex: prompt.index,
      summary: prompt.title,
      location,
      characters: promptCharacters.length > 0 ? promptCharacters : buckets[bucketIndex].clip.characters,
      props: inferHardcodedProps(prompt.prompt, props),
      shotType: prompt.shotLanguage || '按视频提示词执行',
      cameraMove: prompt.shotLanguage || '按视频提示词执行',
      duration: prompt.duration,
      videoPrompt: prompt.prompt,
    })
  }
  return buckets.filter((bucket) => bucket.panels.length > 0)
}

function truncate(value: string, maxChars: number): string {
  const chars = Array.from(value.replace(/\s+\n/g, '\n').trim())
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : chars.join('')
}

function parseJsonArrayField(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
      : []
  } catch {
    return []
  }
}

function splitShotNames(raw: string | undefined): string[] {
  return (raw || '')
    .split(/[\/、,，]/)
    .map((item) => compactText(item))
    .filter((item) => item && item !== '（空）' && item !== '(空)')
}

function readShotField(shot: ShotSheetShot, name: string): string {
  return compactText(shot.fields[name])
    .replace(/（空）/g, '')
    .replace(/\(空\)/g, '')
}

function inferShotCharacterAsset(name: string): NormalizedAsset {
  if (/Ava/i.test(name)) {
    return {
      name,
      summary: '年轻美国女性，24-27 岁；焦急、委屈、脆弱但倔强，用于欧美医疗短剧转绘保持全片一致。',
      visual: '黑框眼镜，低马尾或微乱浅棕发，奶白色针织开衫和白色内搭，眼神湿润，有熬夜疲惫感。',
      aliases: [name],
    }
  }
  if (/Grayson/i.test(name)) {
    return {
      name,
      summary: '美国男外科医生，30-34 岁；冷静克制、专业、高冷，有压迫感。',
      visual: '深棕色短发，轮廓分明；白大褂版本穿白色医生大褂和深色衬衫，手术服版本穿绿色手术服、手术帽、口罩和无菌手套。',
      aliases: [name],
    }
  }
  if (/Nurse Sarah/i.test(name)) {
    return {
      name,
      summary: '美国注册护士，30-40 岁；职业感强，语速快，带质疑和指责感。',
      visual: '浅蓝色护士服，医用口罩，眼神严厉，医疗环境中保持稳定外观。',
      aliases: [name],
    }
  }
  if (/Carter/i.test(name)) {
    return {
      name,
      summary: '美国男医生，30-35 岁；外向八卦，负责调侃和轻喜剧反应。',
      visual: '白大褂，浅色衬衫或 scrub，表情轻松，欧美医生形象保持一致。',
      aliases: [name],
    }
  }
  return {
    name,
    summary: `从结构化镜头稿抽取的角色资产：${name}。`,
    visual: '按原始脚本设定保持脸部、发型、服装、体型和表演气质完全统一。',
    aliases: [name],
  }
}

function inferShotLocationAsset(name: string): NormalizedAsset {
  const isOperatingRoom = /手术室/.test(name)
  const visual = isOperatingRoom
    ? '现代美国医院手术室，冷绿色医疗灯光，绿色无菌布，英文监护仪界面，无影灯和金属器械清晰可见，专业克制，不血腥。'
    : /洗手间|更衣室|准备室|术后/.test(name)
      ? '现代美国医院术后准备室/更衣区，冷白照明、浅蓝墙面、洗手池和医疗器械背景保持一致。'
      : /医院|走廊|ICU|病房|护士站|候诊|急诊|诊室|手术/.test(name)
        ? '现代美国私立医院走廊，白色墙面配浅蓝色横向导视线，冷白顶灯，英文导视牌、手术室门、等待区椅子和金属扶手保持一致。'
        : `${name}，按镜头稿保持空间结构、光线方向、环境元素、角色行动路线和视觉风格一致。`
  return {
    name,
    summary: `${name} 是本项目锁定场景资产，后续分镜、视频和参考图必须保持空间关系与英文环境标识一致。`,
    visual,
    aliases: [name],
  }
}

function inferShotProps(shots: ShotSheetShot[]): string[] {
  const explicit = shots.flatMap((shot) => splitShotNames(shot.fields['道具']))
  const inferred = shots.flatMap((shot) => {
    const text = `${readShotField(shot, '画面')} ${readShotField(shot, '动作')} ${readShotField(shot, '对白/字幕')}`
    return [
      /手术|文件|安排/.test(text) ? '手术安排文件' : '',
      /眼镜/.test(text) ? '黑框眼镜' : '',
      /监护仪/.test(text) ? '生命体征监护仪' : '',
      /手术器械|器械/.test(text) ? '手术器械' : '',
      /手机/.test(text) ? '手机' : '',
    ].filter(Boolean)
  })
  return uniqueTextValues([...explicit, ...inferred]).slice(0, 12)
}

function isPreciseSegmentVideoPrompt(content: string): boolean {
  const text = content.trim()
  return /^S\d{2}-SEG\d{2}\n/.test(text)
    && text.includes('\n◎ 参考资产\n')
    && text.includes('\n◎ 输出参数\n')
    && text.includes('\n◈ 一致性控制\n')
    && text.includes('\n◈ 视频提示词\n')
    && text.includes('\n开场状态：\n')
    && text.includes('\nShot 1\n')
    && text.includes('\nduration: ')
    && text.includes('\n【本分镜负面要求】')
}

function extractVideoPromptSummary(prompt: string, fallback: string): string {
  const body = prompt.match(/\n◈ 视频提示词\n\d+\s*字\n([\s\S]+)/)?.[1] || ''
  const firstActionLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^(开场状态：|环境：|站位关系：|灯光：|Shot \d+|duration:|镜头：|画面：|光影：|【本分镜负面要求】)/.test(line))
  return truncate(compactText(firstActionLine || fallback), 700)
}

function normalizeShotScriptText(rawText: string): string {
  let text = rawText
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/\s*```$/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
  const sceneMatch = text.match(/^##\s+S\d+\s+\[/m)
  if (sceneMatch?.index !== undefined && sceneMatch.index > 0) {
    text = text.slice(sceneMatch.index).trim()
  }
  return text
}

function validateShotScriptText(rawText: string): {
  ok: boolean
  scriptText: string
  shots: ShotSheetShot[]
  errors: string[]
} {
  const scriptText = normalizeShotScriptText(rawText)
  const errors: string[] = []
  const shots = parseShotSheetText(scriptText)
  if (shots.length === 0) {
    errors.push('没有解析到任何 ### SHxxx [mm:ss-mm:ss] 镜头。')
  }
  if (!/^##\s+S\d+\s+\[/m.test(scriptText)) {
    errors.push('缺少 ## Sx [场景名] 角色：... 场景标题。')
  }

  const numbers = shots.map((shot) => shot.number)
  const uniqueNumbers = new Set(numbers)
  if (uniqueNumbers.size !== numbers.length) {
    errors.push('SH 编号重复，必须从 SH001 连续递增。')
  }
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) {
      errors.push(`SH 编号不连续：第 ${index + 1} 个镜头应为 SH${String(index + 1).padStart(3, '0')}。`)
      break
    }
  }

  const requiredFields = ['景别', '机位', '运镜', '画面', '角色', '动作']
  for (const shot of shots) {
    if (shot.durationSeconds > 15) {
      errors.push(`${shot.code} 时长 ${shot.durationSeconds}s 超过 15s。`)
    }
    for (const fieldName of requiredFields) {
      if (!readShotField(shot, fieldName)) {
        errors.push(`${shot.code} 缺少字段：${fieldName}。`)
      }
    }
  }

  if (shots.length > 0) {
    const blocks = buildVideoPromptBlocks(scriptText)
    const longBlock = blocks.find((block) => block.durationSeconds > 15)
    if (longBlock) {
      const first = longBlock.shots[0]
      const last = longBlock.shots[longBlock.shots.length - 1]
      errors.push(`${first.code}-${last.code} 组合后为 ${longBlock.durationSeconds}s，超过 video generation 15s 限制。`)
    }
  }

  return {
    ok: errors.length === 0,
    scriptText,
    shots,
    errors,
  }
}

function buildShotSheetStage2Result(sourceText: string): Stage2Result | null {
  const validation = validateShotScriptText(sourceText)
  if (!validation.ok || validation.shots.length === 0) return null
  const shots = validation.shots
  const blocks = buildVideoPromptBlocks(validation.scriptText)
  if (blocks.length === 0) return null

  const characterNames = uniqueTextValues(shots.flatMap((shot) => [
    ...splitShotNames(shot.fields['角色']),
    ...shot.scene.characters,
  ]))
  const locationNames = uniqueTextValues(shots.map((shot) => shot.scene.heading))
  const propNames = inferShotProps(shots)

  const clips = blocks.map((block, index): NormalizedClip => {
    const first = block.shots[0]
    const last = block.shots[block.shots.length - 1]
    const characters = uniqueTextValues(block.shots.flatMap((shot) => [
      ...splitShotNames(shot.fields['角色']),
      ...shot.scene.characters,
    ])).slice(0, 8)
    const props = inferShotProps(block.shots).slice(0, 8)
    const summary = extractVideoPromptSummary(
      block.text,
      `${first.code}-${last.code} 视频提示词块，按原始镜头稿复刻构图、站位、台词和节奏。`,
    )
    return {
      index: index + 1,
      title: `${first.code}-${last.code}`,
      summary,
      location: first.scene.heading,
      characters,
      props,
      content: block.text,
      duration: clampInteger(block.durationSeconds, 2, 15, 8),
      screenplay: {
        source: 'shot-sheet-deterministic-video-prompt',
        sourceRange: `${first.code}-${last.code}`,
        shots: block.shots.map((shot) => ({
          code: shot.code,
          timeRange: shot.timeRange,
          scene: shot.scene.heading,
          characters: splitShotNames(shot.fields['角色']),
          picture: readShotField(shot, '画面'),
          action: readShotField(shot, '动作'),
          dialogue: readShotField(shot, '对白/字幕'),
        })),
        beats: block.shots.map((shot) => summarizeVideoPromptBeat(
          [shot.code, readShotField(shot, '画面'), readShotField(shot, '动作')].filter(Boolean).join(' '),
          160,
        )),
        dialogue: block.shots
          .map((shot) => readShotField(shot, '对白/字幕'))
          .filter(Boolean),
      },
    }
  })

  return {
    characters: characterNames.map(inferShotCharacterAsset),
    locations: locationNames.map(inferShotLocationAsset),
    props: propNames.map((name) => ({
      name,
      summary: `从镜头稿抽取的关键道具：${name}。`,
      visual: `${name} 必须只在剧情需要的分镜中出现，并与角色动作、场景空间保持一致。`,
      aliases: [name],
    })),
    clips,
  }
}

function formatAgentRoleAssets(pkg: AgentStoryPackage | null): string {
  const roles = pkg?.roleAssets || []
  if (roles.length === 0) return '未提供明确角色资产；请从故事中抽取会反复出现的角色，并保持名称全局一致。'
  return roles
    .map((role) => `${role.name}：${role.description}`)
    .join('\n')
}

function buildShotScriptSystemPrompt(plan: AgentExecutionPlan): string {
  return [
    '你是 NoriVideo 的剧本层导演。你的任务是把短剧情 prompt 或扩写后的故事，转成结构化 SH 镜头稿。',
    '这是剧本层，不是 video_prompt 层；不要输出 JSON，不要输出 markdown，不要输出解释。',
    '输出必须只包含以下格式的纯文本：',
    '## S1 [场景名] 角色：角色A / 角色B',
    '### SH001 [00:00-00:04]',
    '景别：中景',
    '机位：平视',
    '运镜：固定',
    '画面：谁在什么场景、什么位置、画面主体是什么',
    '角色：角色A / 角色B',
    '动作：角色执行的具体动作，必须推动剧情',
    '微表情：眼神、嘴角、呼吸、停顿等表演细节',
    '对白/字幕：（对口型）Speaker: short natural line. 或 （画外）Speaker: line. 或 （空）',
    '光影：场景光线和角色脸部受光',
    '声音/剪辑：必要环境声、脚步声、道具声或（空）',
    '道具：关键道具名称或（空）',
    '',
    '硬性规则：',
    '- SH 编号必须从 SH001 连续递增，不要跳号，不要重复。',
    '- 时间码必须连续递增，格式必须是 [mm:ss-mm:ss]。',
    '- 单个 SH 镜头必须 2-6 秒；复杂动作拆成多个 SH。',
    '- 后续多个 SH 会被组合为 video_prompt，每个组合最长 15 秒；所以不要让一个动作段超过 15 秒。',
    '- 镜头数量根据故事自然决定，通常 6-18 个；短故事也至少 4 个 SH。',
    '- 每个 SH 必须有：景别、机位、运镜、画面、角色、动作、微表情、对白/字幕、光影、声音/剪辑、道具。',
    '- 普通故事、童话、剧情短片不是广告，不要写卖点、CTA、商品宣传。',
    '- 角色、场景、道具名称必须全篇一致；不要新增不服务剧情的角色。',
    '- 需要台词时使用短句；英文/欧美要求时台词用英文并标注（对口型）。',
    '- 用户要求不要中文字幕时，不要生成中文可见字幕；对白字段只作为口型/声音指导。',
    '- 用户要求不要背景音乐时，声音/剪辑只能写环境声、脚步声、衣料声、道具声。',
    `项目视觉风格：${plan.projectConfig.artStylePrompt || plan.projectConfig.artStyle}`,
    `目标比例：${plan.projectConfig.videoRatio}`,
  ].join('\n')
}

function buildShotScriptUserPrompt(params: {
  sourceText: string
  plan: AgentExecutionPlan
  validationErrors?: string[]
  previousOutput?: string
}): string {
  const pkg = parseAgentStoryPackageText(params.sourceText)
  const originalPrompt = pkg?.originalPrompt || params.sourceText
  const expandedStory = pkg?.expandedStory || params.sourceText
  const constraints = [
    pkg?.dialogueLanguage === 'en' ? '所有可见说话角色必须英文口型同步。' : '',
    pkg?.noSubtitles ? '不要生成中文字幕，不要生成大段可见字幕。' : '',
    pkg?.noMusic ? '不要生成背景音乐，只保留必要环境声和道具声。' : '',
    pkg?.settingRegion === 'western' ? '使用国外/欧美生活语境和英文环境标识，不要变成中文标识环境。' : '',
    pkg?.settingRegion === 'china' ? '使用中国生活语境和中文环境标识，不要变成欧美环境。' : '',
    pkg?.settingRegion === 'fantasy' ? '童话/奇幻规则必须前后一致，角色物种、发光道具和场景光线保持统一。' : '',
  ].filter(Boolean)
  const retryBlock = params.validationErrors?.length
    ? [
      '',
      '上一次 SH 镜头稿校验失败，必须修复以下问题：',
      ...params.validationErrors.map((error, index) => `${index + 1}. ${error}`),
      params.previousOutput ? `\n上一次输出片段供参考，不要照抄错误：\n${truncate(params.previousOutput, 2000)}` : '',
    ].join('\n')
    : ''

  return [
    '请把下面输入转成结构化 SH 镜头稿。',
    '',
    '【原始用户 prompt】',
    originalPrompt,
    '',
    '【扩写后的完整故事】',
    expandedStory,
    '',
    '【角色资产】',
    formatAgentRoleAssets(pkg),
    '',
    '【制作约束】',
    constraints.length > 0 ? constraints.join('\n') : '按项目视觉风格和故事语境自然推理。',
    `推荐总时长：${params.plan.creativeParameters.durationSeconds || 30}s。`,
    `推荐剧情节拍数：${params.plan.creativeParameters.shotCount || 6}。`,
    retryBlock,
  ].join('\n')
}

async function generateValidatedShotScript(params: {
  sourceText: string
  plan: AgentExecutionPlan
  callLlm: AgentLlmCall
}): Promise<string> {
  let previousOutput = ''
  let validationErrors: string[] | undefined
  let lastError: unknown = null

  for (let attempt = 0; attempt <= SHOT_SCRIPT_LLM_RETRY_COUNT; attempt += 1) {
    try {
      const response = await callWithTimeout({
        promise: params.callLlm(
          buildShotScriptSystemPrompt(params.plan),
          buildShotScriptUserPrompt({
            sourceText: params.sourceText,
            plan: params.plan,
            validationErrors,
            previousOutput,
          }),
          {
            action: 'agent-shot-script-stage',
            timeoutMs: SHOT_SCRIPT_LLM_TIMEOUT_MS,
          },
        ),
        timeoutMs: SHOT_SCRIPT_LLM_TIMEOUT_MS,
        label: 'agent-shot-script-stage',
      })
      previousOutput = response
      const validation = validateShotScriptText(response)
      if (validation.ok) return validation.scriptText
      validationErrors = validation.errors
      lastError = new Error(`agent-shot-script-stage: ${validation.errors.join(' ')}`)
    } catch (error) {
      lastError = error
      validationErrors = [error instanceof Error ? error.message : String(error)]
    }
  }

  throw lastError instanceof Error ? lastError : new Error('agent-shot-script-stage: failed to generate valid SH script')
}

function normalizeAsset(value: unknown, fallbackPrefix: string, index: number): NormalizedAsset {
  const source = readObject(value)
  const name = truncate(readText(source.name, `${fallbackPrefix}${index + 1}`), 48)
  const summary = truncate(readText(source.summary, readText(source.profile, readText(source.description, name))), 600)
  const visual = truncate(readText(source.visual, readText(source.appearance, summary)), 800)
  return {
    name,
    summary,
    visual,
    aliases: uniqueStrings(readArray(source.aliases), [name]).slice(0, 8),
  }
}

function isNarrowNarrativeProp(asset: NormalizedAsset): boolean {
  const source = `${asset.name}\n${asset.summary}\n${asset.visual}`.toLowerCase()
  const abstractOrRelationship = /(deal|transaction|condition|offer|money|payment|relationship|secret|五万美元|交易|条件|关系|秘密|羞辱|占有|吻痕|hickey)/i
  if (abstractOrRelationship.test(source)) return false

  const clothingOrBody = /(coat|lab coat|white coat|mask|glove|scrub|scrubs|cap|uniform|dress|shirt|hair|glasses|白大褂|口罩|手套|手术服|护士服|眼镜|发型|吻痕)/i
  if (clothingOrBody.test(source)) return false

  const sceneFixture = /(door|sign|chair|wall|corridor|light|lamp|monitor|screen|bed|table|门|导视|椅|墙|走廊|顶灯|灯牌|监护仪|手术台|无影灯)/i
  const explicitIndependent = /(file|document|chart|form|letter|folder|instrument|scalpel|tool|leaf|moon lamp|lantern|病历|文件|表格|信|夹|器械|手术刀|树叶|月亮灯|提灯)/i
  if (sceneFixture.test(source) && !explicitIndependent.test(source)) return false

  return explicitIndependent.test(source)
}

function filterNarrativeProps(props: NormalizedAsset[], isCommercial: boolean): NormalizedAsset[] {
  if (isCommercial) return props.slice(0, 12)
  return props.filter(isNarrowNarrativeProp).slice(0, 4)
}

function filterClipProps(clips: NormalizedClip[], props: NormalizedAsset[]): NormalizedClip[] {
  const allowedNames = new Set(props.map((prop) => normalizeMatchText(prop.name)))
  if (allowedNames.size === 0) {
    return clips.map((clip) => ({ ...clip, props: [] }))
  }
  return clips.map((clip) => ({
    ...clip,
    props: clip.props.filter((prop) => allowedNames.has(normalizeMatchText(prop))),
  }))
}

function isCommercialStage2Plan(plan: AgentExecutionPlan): boolean {
  const skill = String(plan.selectedSkill || '').toLowerCase()
  return skill.includes('product') || skill.includes('promo') || skill.includes('ad') || skill.includes('commercial')
}

function normalizeClip(value: unknown, index: number): NormalizedClip {
  const source = readObject(value)
  const summary = truncate(readText(source.summary, readText(source.title, `剧情片段 ${index + 1}`)), 700)
  const content = truncate(readText(source.content, readText(source.screenplayText, summary)), 2500)
  const screenplay = readObject(source.screenplay)
  return {
    index: clampInteger(source.clipIndex ?? source.index, 1, MAX_CLIPS, index + 1),
    title: truncate(readText(source.title, `剧情片段 ${index + 1}`), 80),
    summary,
    location: truncate(readText(source.location, '按剧情锁定场景'), 80),
    characters: uniqueStrings(readArray(source.characters)).slice(0, 8),
    props: uniqueStrings(readArray(source.props)).slice(0, 8),
    content,
    screenplay: Object.keys(screenplay).length > 0
      ? screenplay
      : {
        source: AGENT_LLM_PIPELINE_SOURCE,
        summary,
        content,
      },
    duration: clampInteger(source.duration, 2, 15, 6),
  }
}

function normalizeStage2Response(response: string, options: { isCommercial?: boolean } = {}): Stage2Result {
  const parsed = safeParseJsonObject(response)
  const assets = readObject(parsed.assets)
  const characters = readArray(assets.characters ?? parsed.characters)
    .slice(0, MAX_ASSETS)
    .map((item, index) => normalizeAsset(item, '角色', index))
  const locations = readArray(assets.locations ?? parsed.locations)
    .slice(0, MAX_ASSETS)
    .map((item, index) => normalizeAsset(item, '场景', index))
  const rawProps = readArray(assets.props ?? parsed.props)
    .slice(0, MAX_ASSETS)
    .map((item, index) => normalizeAsset(item, '道具', index))
  const props = filterNarrativeProps(rawProps, options.isCommercial === true)
  const clips = filterClipProps(readArray(parsed.clips)
    .slice(0, MAX_CLIPS)
    .map((item, index) => normalizeClip(item, index))
    .filter((clip) => clip.summary || clip.content), props)

  if (clips.length === 0) {
    throw new Error('agent-llm-stage2: no usable clips returned by LLM')
  }

  return { characters, locations, props, clips }
}

async function callLlmJsonWithRetry<T>(params: {
  callLlm: AgentLlmCall
  systemPrompt: string
  userPrompt: string
  normalize: (response: string) => T
  label: string
  maxRetries?: number
  timeoutMs?: number
}): Promise<T> {
  let lastError: unknown = null
  const maxRetries = params.maxRetries ?? LLM_JSON_RETRY_COUNT
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const retryInstruction = attempt === 0
      ? ''
      : [
        '',
        '上一次输出为空或不是合法 JSON。请重新输出。',
        '只返回一个完整 JSON 对象，不要 markdown，不要解释，不要省略字段。',
      ].join('\n')
    try {
      const response = await callWithTimeout({
        promise: params.callLlm(
          params.systemPrompt,
          `${params.userPrompt}${retryInstruction}`,
          {
            action: params.label,
            timeoutMs: params.timeoutMs,
          },
        ),
        timeoutMs: params.timeoutMs,
        label: params.label,
      })
      if (!response.trim()) {
        throw new Error(`${params.label}: empty LLM response`)
      }
      return params.normalize(response)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${params.label}: invalid LLM JSON response`)
}

async function callWithTimeout<T>(params: {
  promise: Promise<T>
  timeoutMs?: number
  label: string
}): Promise<T> {
  if (!params.timeoutMs || params.timeoutMs <= 0) return await params.promise
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      params.promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${params.label}: timed out after ${params.timeoutMs}ms`))
        }, params.timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeVideoPrompt(rawPrompt: string, panel: Omit<NormalizedPanel, 'videoPrompt'>, clip: NormalizedClip): string {
  let prompt = rawPrompt
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/g, '')
    .trim()

  const segmentIndex = prompt.search(/S\d{2}-SEG\d{2}\n/)
  if (segmentIndex >= 0) prompt = prompt.slice(segmentIndex).trim()

  const disallowedSection = prompt.search(/\n(?:对应原文|画面描述|说明|解释|JSON)[：:]/)
  if (disallowedSection > 0) prompt = prompt.slice(0, disallowedSection).trim()

  if (isPreciseSegmentVideoPrompt(prompt)) {
    return truncate(prompt, MAX_PROMPT_CHARS)
  }

  const location = panel.location || clip.location || '按剧情锁定场景'
  const duration = panel.duration || clip.duration || 6
  const beat = [prompt, panel.summary, clip.summary].map(compactText).find(Boolean) || '按当前剧情片段完成主体动作、台词、表情和情绪落点。'
  return truncate(buildPreciseBeatVideoPrompt({
    segmentId: `S${String(clip.index).padStart(2, '0')}-SEG${String(panel.panelIndex).padStart(2, '0')}`,
    location,
    beat,
    durationSeconds: duration,
    characters: panel.characters.map((name) => ({ name })),
    props: panel.props.map((name) => ({ name })),
    sceneOpening: `${location}，按当前剧情片段建立可拍摄空间，角色站位、道具位置、入口方向和环境声保持连续<环境声、脚步声、衣料摩擦声>。`,
    lighting: `${panel.shotType || '中景到近景'} 与 ${panel.cameraMove || '固定或轻微推近'} 对应的主光保持稳定；动作主体、表情和关键道具清晰。`,
    dialogueInstruction: /英文|English|Dr\.|Nurse|Ava/i.test(`${beat}\n${clip.content}`)
      ? '如本片段需要台词，使用简短自然英文台词并保持英文口型同步。'
      : '如本片段需要台词，使用简短自然台词并保持口型同步。',
  }), MAX_PROMPT_CHARS)
}

function normalizePanel(value: unknown, clip: NormalizedClip, fallbackIndex: number): NormalizedPanel {
  const source = readObject(value)
  const duration = clampInteger(source.duration, 2, 15, clip.duration || 6)
  const partial = {
    clipIndex: clampInteger(source.clipIndex, 1, MAX_CLIPS, clip.index),
    panelIndex: clampInteger(source.panelIndex ?? source.index, 1, MAX_PANELS, fallbackIndex + 1),
    summary: truncate(readText(source.summary, readText(source.description, clip.summary)), 700),
    location: truncate(readText(source.location, clip.location), 80),
    characters: uniqueStrings(readArray(source.characters), clip.characters).slice(0, 8),
    props: uniqueStrings(readArray(source.props), clip.props).slice(0, 8),
    shotType: truncate(readText(source.shotType, readText(source.shot_type, '中景到近景')), 80),
    cameraMove: truncate(readText(source.cameraMove, readText(source.camera_move, '固定镜头或轻微推近')), 80),
    duration,
  }
  return {
    ...partial,
    videoPrompt: normalizeVideoPrompt(readText(source.video_prompt ?? source.videoPrompt), partial, clip),
  }
}

function normalizeStage3Response(response: string, clips: NormalizedClip[]): NormalizedPanel[] {
  const parsed = safeParseJsonObject(response)
  const rows = readArray(parsed.panels ?? parsed.storyboards)
  const clipByIndex = new Map(clips.map((clip) => [clip.index, clip]))
  const panels = rows.slice(0, MAX_PANELS).map((row, index) => {
    const source = readObject(row)
    const clipIndex = clampInteger(source.clipIndex, 1, MAX_CLIPS, Math.min(index + 1, clips.length))
    return normalizePanel(row, clipByIndex.get(clipIndex) || clips[Math.min(index, clips.length - 1)], index)
  })

  if (panels.length === 0) {
    return clips.map((clip, index) => normalizePanel({
      clipIndex: clip.index,
      panelIndex: 1,
      summary: clip.summary,
      location: clip.location,
      characters: clip.characters,
      props: clip.props,
      duration: clip.duration,
    }, clip, index))
  }

  return panels
}

export const __agentLlmStoryboardPipelineTestHooks = {
  normalizeStage2Response,
  normalizeStage3Response,
  validateShotScriptText,
  buildShotSheetStage2Result,
  generateValidatedShotScript,
}

function buildStage2SystemPrompt(plan: AgentExecutionPlan): string {
  return [
    '你是 NoriVideo 的 Agent 剧本结构化引擎。你的任务是把用户给的混乱 prompt、角色设定、剧情文本或剧本，整理成后续可编辑制作的数据。',
    '必须先抽取并锁定全局资产，再拆剧情片段。不要生成分镜，不要生成视频提示词。',
    '输出只允许是 JSON 对象，不要 markdown，不要解释。',
    'JSON 结构：',
    '{',
    '  "assets": {',
    '    "characters": [{"name":"角色名","aliases":["别名"],"summary":"身份、性格、关系","visual":"年龄、种族/地域、发型、服装、气质、稳定外观"}],',
    '    "locations": [{"name":"场景名","summary":"用途和剧情关系","visual":"空间结构、光线、环境文字、时代/地域"}],',
    '    "props": [{"name":"道具名","summary":"剧情用途","visual":"外观、材质、位置和一致性要求"}]',
    '  },',
    '  "clips": [{"clipIndex":1,"title":"片段标题","summary":"一句话剧情片段","location":"场景名","characters":["角色名"],"props":["道具名"],"duration":6,"content":"该片段可拍摄动作、情绪、必要英文台词","screenplay":{"beats":["动作节拍"],"dialogue":["Speaker: line"]}}]',
    '}',
    '规则：',
    '- 普通故事、童话、剧情短片不是商业广告，不要提卖点和 CTA。',
    '- 先片段后分镜：clips 是剧情片段，不是镜头。每个片段必须有明确因果、动作、情绪或悬念。',
    '- 角色、场景、道具名称必须全局一致，clips 只能引用 assets 里存在的名称。',
    '- props 只允许独立、可复用、会被镜头明确引用的关键物理物件；不要把交易、关系、金额、身体痕迹、衣服、白大褂、口罩、手套、灯牌、门、椅子、墙面、监护仪等场景固定设施或服装建成独立道具。',
    '- 非商业剧情片通常 0-3 个关键道具；宁可少建，不要为了完整而堆道具。',
    '- 英文/欧美故事必须保持国外场景、英文环境标识和英文口型语境；不要变成中文标识或亚洲场景。',
    '- 如果用户要求不要中文字幕、不要背景音乐，这些约束保留在 content/screenplay 语境中。',
    '- clips 数量根据剧情自然决定，通常 4-12 个；长剧本可更多，但不要机械固定。',
    `项目视觉风格：${plan.projectConfig.artStylePrompt || plan.projectConfig.artStyle}`,
    `目标比例：${plan.projectConfig.videoRatio}`,
  ].join('\n')
}

function buildStage3SystemPrompt(plan: AgentExecutionPlan): string {
  return [
    '你是 NoriVideo 的视频分镜提示词导演。你要基于已锁定资产和剧情片段，生成 Seedance 2.0 可直接使用的 video_prompt。',
    '输出只允许是 JSON 对象，不要 markdown，不要解释。',
    'JSON 结构：',
    '{',
    '  "panels": [{"clipIndex":1,"panelIndex":1,"summary":"本分镜剧情","location":"场景名","characters":["角色名"],"props":["道具名"],"shotType":"中景/近景/特写等","cameraMove":"固定/轻微推近等","duration":7,"video_prompt":"干净的视频提示词"}]',
    '}',
    'video_prompt 必须是纯文本，不要放 JSON，不要放“对应原文”“画面描述”“说明”。',
    'video_prompt 必须复刻精细 Segment 结构，包含这些段落且顺序固定：',
    'S01-SEG01',
    '场景名',
    '视频秒数',
    '◎ 参考资产',
    '角色 / 物品 / 环境',
    '◎ 输出参数',
    '视频模型 / 分辨率 / 视频秒数',
    '◈ 一致性控制',
    '◈ 视频提示词',
    '开场状态：',
    '环境：',
    '站位关系：',
    '灯光：',
    'Shot 1',
    'duration: 3.0s',
    '镜头：景别、角度、运镜、焦段、景深、速度、稳定方式、镜头起点和落点。',
    '画面：',
    '角色动作、微表情、道具状态、台词或内心独白。',
    '光影：主光、辅光、色温、阴影比例、高光细节。',
    '<必要环境声或道具声>',
    '【本分镜负面要求】 ...',
    '规则：',
    '- 每个剧情片段可以生成 1-3 个分镜，由动作、台词、场景变化自然决定；不要机械平均。',
    '- duration 必须按台词和动作推理，范围 2-15 秒；如果剧情动作或台词超过 15 秒，必须拆成多个连续分镜。',
    '- 每个 Shot 必须推进动作、台词、表情、道具状态或情绪，不要静态摆拍。',
    '- 需要台词时写简短自然英文台词并要求英文口型同步；用户要求不要中文字幕/不要背景音乐时必须遵守。',
    '- prompt 中提到的角色、场景、道具必须能在 assets 中找到，reference image 后续会由资产系统补充。',
    `项目视觉风格：${plan.projectConfig.artStylePrompt || plan.projectConfig.artStyle}`,
    `目标比例：${plan.projectConfig.videoRatio}`,
  ].join('\n')
}

function serializeStage3Input(params: {
  sourceText: string
  plan: AgentExecutionPlan
  characters: NormalizedAsset[]
  locations: NormalizedAsset[]
  props: NormalizedAsset[]
  clips: NormalizedClip[]
}): string {
  return JSON.stringify({
    originalPrompt: params.sourceText,
    visualStyle: params.plan.projectConfig.artStylePrompt || params.plan.projectConfig.artStyle,
    ratio: params.plan.projectConfig.videoRatio,
    assets: {
      characters: params.characters,
      locations: params.locations,
      props: params.props,
    },
    clips: params.clips,
  }, null, 2)
}

async function generatePanelsForClipBatch(params: {
  sourceText: string
  plan: AgentExecutionPlan
  characters: NormalizedAsset[]
  locations: NormalizedAsset[]
  props: NormalizedAsset[]
  clips: NormalizedClip[]
  callLlm: AgentLlmCall
}): Promise<NormalizedPanel[]> {
  return await callLlmJsonWithRetry({
    callLlm: params.callLlm,
    systemPrompt: buildStage3SystemPrompt(params.plan),
    userPrompt: serializeStage3Input({
      sourceText: params.sourceText,
      plan: params.plan,
      characters: params.characters,
      locations: params.locations,
      props: params.props,
      clips: params.clips,
    }),
    normalize: (response) => normalizeStage3Response(response, params.clips),
    label: 'agent-llm-stage3',
    maxRetries: 0,
    timeoutMs: STAGE3_CLIP_LLM_TIMEOUT_MS,
  })
}

async function persistStage2Result(params: {
  projectId: string
  episodeId: string
  normalized: Stage2Result
  scriptText?: string
}) {
  const { normalized } = params
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
  })
  if (!project) throw new Error(`NovelPromotionProject not found: ${params.projectId}`)

  await prisma.$transaction(async (tx) => {
    if (params.scriptText?.trim()) {
      await tx.novelPromotionEpisode.update({
        where: { id: params.episodeId },
        data: { novelText: params.scriptText.trim() },
      })
    }

    await tx.novelPromotionClip.deleteMany({ where: { episodeId: params.episodeId } })

    for (const character of normalized.characters) {
      const existing = await tx.novelPromotionCharacter.findFirst({
        where: {
          novelPromotionProjectId: project.id,
          name: character.name,
        },
      })
      const data = {
        aliases: JSON.stringify(character.aliases),
        introduction: [character.summary, character.visual].filter(Boolean).join('\n'),
        profileData: JSON.stringify({
          source: AGENT_LLM_PIPELINE_SOURCE,
          summary: character.summary,
          visual: character.visual,
        }),
        profileConfirmed: true,
      }
      if (existing) {
        await tx.novelPromotionCharacter.update({ where: { id: existing.id }, data })
      } else {
        await tx.novelPromotionCharacter.create({
          data: {
            novelPromotionProjectId: project.id,
            name: character.name,
            ...data,
          },
        })
      }
    }

    for (const location of normalized.locations) {
      const existing = await tx.novelPromotionLocation.findFirst({
        where: {
          novelPromotionProjectId: project.id,
          name: location.name,
          assetKind: 'location',
        },
      })
      const data = {
        summary: [location.summary, location.visual].filter(Boolean).join('\n'),
        assetKind: 'location',
      }
      if (existing) {
        await tx.novelPromotionLocation.update({ where: { id: existing.id }, data })
      } else {
        await tx.novelPromotionLocation.create({
          data: {
            novelPromotionProjectId: project.id,
            name: location.name,
            ...data,
          },
        })
      }
    }

    for (const prop of normalized.props) {
      const existing = await tx.novelPromotionLocation.findFirst({
        where: {
          novelPromotionProjectId: project.id,
          name: prop.name,
          assetKind: 'prop',
        },
      })
      const data = {
        summary: [prop.summary, prop.visual].filter(Boolean).join('\n'),
        assetKind: 'prop',
      }
      if (existing) {
        await tx.novelPromotionLocation.update({ where: { id: existing.id }, data })
      } else {
        await tx.novelPromotionLocation.create({
          data: {
            novelPromotionProjectId: project.id,
            name: prop.name,
            ...data,
          },
        })
      }
    }

    for (const clip of normalized.clips) {
      await tx.novelPromotionClip.create({
        data: {
          episodeId: params.episodeId,
          start: clip.index - 1,
          end: clip.index,
          duration: clip.duration,
          summary: clip.summary,
          location: clip.location,
          content: clip.content,
          characters: JSON.stringify(clip.characters),
          props: JSON.stringify(clip.props),
          startText: clip.title,
          endText: clip.summary,
          shotCount: 1,
          screenplay: JSON.stringify({
            ...clip.screenplay,
            source: AGENT_LLM_PIPELINE_SOURCE,
            clipIndex: clip.index,
            title: clip.title,
          }),
        },
      })
    }
  }, { timeout: 30000 })

  return {
    characterCount: params.normalized.characters.length,
    locationCount: params.normalized.locations.length,
    clipCount: params.normalized.clips.length,
    hasScript: params.normalized.clips.length > 0,
  }
}

export async function persistAgentLlmStage2(params: {
  projectId: string
  episodeId: string
  sourceText: string
  plan: AgentExecutionPlan
  callLlm: AgentLlmCall
}): Promise<{
  characterCount: number
  locationCount: number
  clipCount: number
  hasScript: boolean
}> {
  const skipShotScriptGeneration = hasHardcodedStoryboardPromptSource()
  const directShotScriptValidation = skipShotScriptGeneration
    ? { ok: false as const, scriptText: params.sourceText, errors: [] }
    : validateShotScriptText(params.sourceText)
  const deterministicShotSheet = directShotScriptValidation.ok
    ? buildShotSheetStage2Result(directShotScriptValidation.scriptText)
    : null
  let scriptText = deterministicShotSheet ? directShotScriptValidation.scriptText : ''
  let normalized = deterministicShotSheet

  if (!normalized && !skipShotScriptGeneration) {
    try {
      scriptText = await generateValidatedShotScript({
        sourceText: params.sourceText,
        plan: params.plan,
        callLlm: params.callLlm,
      })
      normalized = buildShotSheetStage2Result(scriptText)
    } catch {
      normalized = null
      scriptText = ''
    }
  }

  if (!normalized) {
    normalized = await callLlmJsonWithRetry({
      callLlm: params.callLlm,
      systemPrompt: buildStage2SystemPrompt(params.plan),
      userPrompt: params.sourceText,
      normalize: (response) => normalizeStage2Response(response, {
        isCommercial: isCommercialStage2Plan(params.plan),
      }),
      label: 'agent-llm-stage2',
      maxRetries: 1,
      timeoutMs: STAGE2_LLM_TIMEOUT_MS,
    })
  }

  return await persistStage2Result({
    projectId: params.projectId,
    episodeId: params.episodeId,
    normalized,
    scriptText,
  })
}

export async function persistAgentLlmStage3(params: {
  episodeId: string
  sourceText: string
  plan: AgentExecutionPlan
  callLlm: AgentLlmCall
  onProgress?: (progress: {
    clipIndex: number
    clipCount: number
    clipTitle: string
    status: 'running' | 'completed' | 'failed'
    generatedPanelCount?: number
  }) => Promise<void> | void
}): Promise<{
  storyboardCount: number
  panelCount: number
  voiceLineCount: number
  hasStoryboard: boolean
}> {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: params.episodeId },
    include: {
      clips: {
        orderBy: { start: 'asc' },
      },
      novelPromotionProject: {
        include: {
          characters: true,
          locations: true,
        },
      },
      voiceLines: true,
    },
  })
  if (!episode) throw new Error(`NovelPromotionEpisode not found: ${params.episodeId}`)

  const characters = (episode.novelPromotionProject.characters || []).map((character, index) => normalizeAsset({
    name: character.name,
    aliases: parseJsonArrayField(character.aliases),
    summary: character.introduction || '',
    visual: character.profileData || character.introduction || '',
  }, '角色', index))
  const locations = (episode.novelPromotionProject.locations || [])
    .filter((location) => location.assetKind !== 'prop')
    .map((location, index) => normalizeAsset({
      name: location.name,
      summary: location.summary || '',
      visual: location.summary || '',
    }, '场景', index))
  const props = (episode.novelPromotionProject.locations || [])
    .filter((location) => location.assetKind === 'prop')
    .map((location, index) => normalizeAsset({
      name: location.name,
      summary: location.summary || '',
      visual: location.summary || '',
    }, '道具', index))
  const clips = (episode.clips || []).map((clip, index) => normalizeClip({
    clipIndex: index + 1,
    title: clip.startText || `剧情片段 ${index + 1}`,
    summary: clip.summary,
    location: clip.location,
    characters: parseJsonArrayField(clip.characters),
    props: parseJsonArrayField(clip.props),
    duration: clip.duration,
    content: clip.content,
    screenplay: clip.screenplay ? JSON.parse(clip.screenplay) : {},
  }, index))

  if (clips.length === 0) {
    throw new Error('agent-llm-stage3: no clips found before storyboard generation')
  }

  const hardcodedPrompts = await loadHardcodedStoryboardPromptsFromDocx()
  if (hardcodedPrompts.length > 0) {
    const groupedPanels = distributeHardcodedPanelsAcrossClips(
      hardcodedPrompts,
      clips,
      characters,
      locations,
      props,
    )
    const clipPanels = groupedPanels.map((group) => {
      const dbClip = episode.clips[group.clip.index - 1]
      return {
        clipId: dbClip.id,
        clipIndex: group.clip.index - 1,
        finalPanels: group.panels.map((panel): StoryboardPanel => ({
          panel_number: panel.panelIndex,
          description: panel.summary,
          location: panel.location,
          source_text: group.clip.content,
          characters: panel.characters,
          props: panel.props,
          shot_type: panel.shotType,
          camera_move: panel.cameraMove,
          video_prompt: panel.videoPrompt,
          duration: panel.duration,
          photographyPlan: {
            source: 'hardcoded-docx-video-prompts',
            docxPath: HARDCODED_STORYBOARD_DOCX_PATHS[0],
            originalPanelIndex: panel.panelIndex,
          },
          actingNotes: {
            source: 'hardcoded-docx-video-prompts',
            characters: panel.characters,
          },
        })),
      }
    })

    const persisted = await persistStoryboardsAndPanels({
      episodeId: params.episodeId,
      clipPanels,
    })
    const panelCount = persisted.reduce((sum, storyboard) => sum + storyboard.panels.length, 0)
    await params.onProgress?.({
      clipIndex: clips.length,
      clipCount: clips.length,
      clipTitle: `已从视频提示词.docx 硬填充 ${panelCount} 个分镜`,
      status: 'completed',
      generatedPanelCount: panelCount,
    })

    return {
      storyboardCount: persisted.length,
      panelCount,
      voiceLineCount: episode.voiceLines?.length || 0,
      hasStoryboard: persisted.length > 0 && panelCount > 0,
    }
  }

  const panels: NormalizedPanel[] = []
  if (clips.every((clip) => isPreciseSegmentVideoPrompt(clip.content))) {
    panels.push(...clips.map((clip) => ({
      clipIndex: clip.index,
      panelIndex: 1,
      summary: clip.summary,
      location: clip.location,
      characters: clip.characters,
      props: clip.props,
      shotType: '按 video_prompt 内部镜头语言执行',
      cameraMove: '按 video_prompt 内部运镜执行',
      duration: clip.duration,
      videoPrompt: clip.content,
    })))
  } else {
    for (const clip of clips) {
      try {
        await params.onProgress?.({
          clipIndex: clip.index,
          clipCount: clips.length,
          clipTitle: clip.title || clip.summary,
          status: 'running',
        })
        const generatedPanels = await generatePanelsForClipBatch({
          sourceText: params.sourceText,
          plan: params.plan,
          characters,
          locations,
          props,
          clips: [clip],
          callLlm: params.callLlm,
        })
        panels.push(...generatedPanels)
        await params.onProgress?.({
          clipIndex: clip.index,
          clipCount: clips.length,
          clipTitle: clip.title || clip.summary,
          status: 'completed',
          generatedPanelCount: generatedPanels.length,
        })
      } catch {
        await params.onProgress?.({
          clipIndex: clip.index,
          clipCount: clips.length,
          clipTitle: clip.title || clip.summary,
          status: 'failed',
        })
        panels.push(...normalizeStage3Response(JSON.stringify({ panels: [] }), [clip]))
      }
    }
  }
  const panelsByClipIndex = new Map<number, NormalizedPanel[]>()
  for (const panel of panels) {
    const rows = panelsByClipIndex.get(panel.clipIndex) || []
    rows.push(panel)
    panelsByClipIndex.set(panel.clipIndex, rows)
  }

  const clipPanels = clips.map((clip) => {
    const sourcePanels = panelsByClipIndex.get(clip.index) || [
      normalizePanel({
        clipIndex: clip.index,
        panelIndex: 1,
        summary: clip.summary,
        location: clip.location,
        characters: clip.characters,
        props: clip.props,
        duration: clip.duration,
      }, clip, 0),
    ]
    const dbClip = episode.clips[clip.index - 1]
    return {
      clipId: dbClip.id,
      clipIndex: clip.index - 1,
      finalPanels: sourcePanels.map((panel, index): StoryboardPanel => ({
        panel_number: index + 1,
        description: panel.summary,
        location: panel.location,
        source_text: clip.content,
        characters: panel.characters,
        props: panel.props,
        shot_type: panel.shotType,
        camera_move: panel.cameraMove,
        video_prompt: panel.videoPrompt,
        duration: panel.duration,
        photographyPlan: {
          source: AGENT_LLM_PIPELINE_SOURCE,
          clipIndex: clip.index,
          panelIndex: panel.panelIndex,
        },
        actingNotes: {
          source: AGENT_LLM_PIPELINE_SOURCE,
          characters: panel.characters,
        },
      })),
    }
  })

  const persisted = await persistStoryboardsAndPanels({
    episodeId: params.episodeId,
    clipPanels,
  })
  const panelCount = persisted.reduce((sum, storyboard) => sum + storyboard.panels.length, 0)

  return {
    storyboardCount: persisted.length,
    panelCount,
    voiceLineCount: episode.voiceLines?.length || 0,
    hasStoryboard: persisted.length > 0 && panelCount > 0,
  }
}
