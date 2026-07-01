import {
  buildPreciseBeatVideoPrompt,
  type PreciseSegmentCharacterRef,
  type PreciseSegmentPropRef,
} from '@/lib/novel-promotion/short-drama-video-prompt'
import { chatCompletion } from '@/lib/llm/chat-completion'
import { getCompletionParts } from '@/lib/llm/completion-parts'

export const EPISODE_SEGMENT_FUNCTIONS = [
  '开场钩子',
  '建立情境',
  '情绪承载',
  '推进信息',
  '制造冲突',
  '交代行动',
  '反转钩子',
] as const

export type EpisodeSegmentFunction = typeof EPISODE_SEGMENT_FUNCTIONS[number]

export type EpisodeStoryboardWorkflowCharacter = PreciseSegmentCharacterRef & {
  aliases?: string[]
}

export type EpisodeStoryboardWorkflowProp = PreciseSegmentPropRef & {
  aliases?: string[]
}

export type EpisodeStoryboardWorkflowLocation = {
  name: string
  aliases?: string[]
  lighting?: string
  opening?: string
}

export type EpisodeStoryboardWorkflowInput = {
  episodeNumber: number
  scriptText: string
  characters?: EpisodeStoryboardWorkflowCharacter[]
  props?: EpisodeStoryboardWorkflowProp[]
  locations?: EpisodeStoryboardWorkflowLocation[]
  defaultLocation?: string
  videoModel?: string
  resolution?: string
}

export type EpisodeStoryboardLlmPlanSegment = {
  functionLabel: EpisodeSegmentFunction
  sourceText: string
  location: string
  durationSeconds: number
  emotionalIntent: string
  storyQuestion: string
  transitionOut: string
  characterNames?: string[]
  propNames?: string[]
}

export type EpisodeStoryboardLlmPlan = {
  segments: EpisodeStoryboardLlmPlanSegment[]
}

export type EpisodeStoryboardWorkflowLlmPlanner = (prompt: string) => Promise<string>

export type EpisodeStoryboardWorkflowRuntimeLlmOptions = {
  userId: string
  model?: string | null
  projectId?: string
  maxTokens?: number
}

export type EpisodeStoryboardWorkflowSegment = {
  segmentId: string
  functionLabel: EpisodeSegmentFunction
  sourceText: string
  location: string
  durationSeconds: number
  emotionalIntent: string
  storyQuestion: string
  transitionOut: string
  characters: PreciseSegmentCharacterRef[]
  props: PreciseSegmentPropRef[]
  videoPrompt: string
}

export type EpisodeStoryboardWorkflowScene = {
  sceneId: string
  location: string
  segmentIds: string[]
  totalDurationSeconds: number
}

export type EpisodeStoryboardWorkflowResult = {
  episodeNumber: number
  segmentFunctions: readonly EpisodeSegmentFunction[]
  scenes: EpisodeStoryboardWorkflowScene[]
  segments: EpisodeStoryboardWorkflowSegment[]
}

type BeatUnit = {
  text: string
  functionLabel: EpisodeSegmentFunction
  location: string
  durationSeconds: number
  emotionalIntent: string
  storyQuestion: string
  transitionOut: string
  characterNames?: string[]
  propNames?: string[]
}

const FUNCTION_INTENT: Record<EpisodeSegmentFunction, {
  emotionalIntent: string
  storyQuestion: string
  transitionOut: string
  durationSeconds: number
}> = {
  开场钩子: {
    emotionalIntent: '第一秒抓住危险、欲望或异常状态，让观众立刻想知道角色为什么会陷入这里。',
    storyQuestion: '她/他为什么会在这个处境里？马上会发生什么更危险的事？',
    transitionOut: '用一个视线、声音、道具高光或空间入口，把观众带入下一段情境建立。',
    durationSeconds: 12,
  },
  建立情境: {
    emotionalIntent: '交代空间、人物关系和压迫源，让观众理解冲突场域和强弱关系。',
    storyQuestion: '这里是谁的地盘？主角处于什么劣势？',
    transitionOut: '让压迫源、脚步、台词或道具状态自然推动到正面冲突。',
    durationSeconds: 12,
  },
  情绪承载: {
    emotionalIntent: '放大角色呼吸、眼神、手部和身体反应，把剧情压力落到可感知的情绪上。',
    storyQuestion: '主角会崩溃、妥协，还是压住恐惧继续撑住？',
    transitionOut: '用情绪的临界点、泪水、停顿或手部动作转入信息或冲突推进。',
    durationSeconds: 10,
  },
  推进信息: {
    emotionalIntent: '揭示因果、身份、交易、规则或威胁条件，让观众知道冲突为什么不可回避。',
    storyQuestion: '真正的原因是什么？这条信息会如何改变主角选择？',
    transitionOut: '把新信息压成下一步必须行动或必须对抗的原因。',
    durationSeconds: 10,
  },
  制造冲突: {
    emotionalIntent: '让对抗具体发生：逼近、抓握、质问、威胁、争夺、压迫或台词爆点。',
    storyQuestion: '这一轮冲突谁占上风？主角还能不能翻出机会？',
    transitionOut: '把冲突结果落到一个身体动作、道具变化或下一步逃跑/反击入口。',
    durationSeconds: 12,
  },
  交代行动: {
    emotionalIntent: '清楚展示主角做出的选择和动作执行，给观众明确的因果兑现。',
    storyQuestion: '主角的行动是否真的改变处境？代价是什么？',
    transitionOut: '用动作余波、受伤、逃离方向或追赶声接到下一段。',
    durationSeconds: 12,
  },
  反转钩子: {
    emotionalIntent: '在段落末尾抛出新威胁、新人物、新空间入口或身份悬念，推动继续观看。',
    storyQuestion: '门口是谁？接下来会救她、抓她，还是带来更大的反转？',
    transitionOut: '结尾停在局部物件、脚步、眼神或门口剪影，不解释完整答案。',
    durationSeconds: 12,
  },
}

function compact(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function normalizeScriptText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function aliasHit(text: string, name: string, aliases: string[] = []): boolean {
  return [name, ...aliases].filter(Boolean).some((item) => text.includes(item))
}

function resolvePlannedLocation(
  plannedLocation: string,
  locations: EpisodeStoryboardWorkflowLocation[],
  defaultLocation: string,
  currentLocation: string,
): string {
  const text = compact(plannedLocation)
  if (!text) return currentLocation || defaultLocation
  const matched = locations.find((location) => (
    aliasHit(text, location.name, location.aliases)
    || location.name.includes(text)
    || text.includes(location.name)
  ))
  if (matched) return matched.name
  return text || currentLocation || defaultLocation
}

function textHasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function buildSceneOpening(location: string, label: EpisodeSegmentFunction): string {
  if (textHasAny(location, ['柴房', '张秃子'])) {
    return `${location}，${label} 段落，雨夜、油灯、入口方向和墙角压迫关系保持连续<暴雨声、脚步声、衣料摩擦声、油灯火苗声>。`
  }
  if (textHasAny(location, ['土地庙', '庙'])) {
    return `${location}，${label} 段落，雨夜冷青环境、火把暖光、门口方向和墙角躲藏关系保持连续<雨声、追兵脚步声、火把噼啪声>。`
  }
  if (textHasAny(location, ['医院', '美国', '走廊'])) {
    return `${location}，${label} 段落，英文环境标识、入口方向、人物距离和道具位置保持连续<医院底噪、脚步声、衣料摩擦声>。`
  }
  return `${location}，${label} 段落，空间结构、入口方向、道具位置和环境声保持连续<环境声、脚步声、衣料摩擦声>。`
}

function buildLighting(location: string): string {
  if (textHasAny(location, ['柴房', '张秃子'])) {
    return '破旧油灯暖黄实用光 2700K 作为主光，窗外雨夜冷青闪电 6500K 作为瞬间弱环境光；key:fill 约 10:1，明暗反差压抑，角色脸部、手部和银簪高光清晰。'
  }
  if (textHasAny(location, ['土地庙', '庙'])) {
    return '雨夜冷青环境光 6500K 与火把暖橙实用光 2200K 交替进入土地庙；key:fill 约 8:1，阴影压迫但保留脸部、手部和关键道具状态。'
  }
  if (textHasAny(location, ['医院', '美国', '走廊'])) {
    return '冷白 LED 顶灯 5600K 作为主光，白蓝墙面形成冷色反射；key:fill 约 4:1，英文环境标识可读但不抢画面。'
  }
  return '场景既有实用光作为主光，环境反射作为弱副光；key:fill 约 6:1，主体动作区和关键道具清晰。'
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('EPISODE_STORYBOARD_LLM_PLAN_JSON_NOT_FOUND')
}

function isEpisodeSegmentFunction(value: unknown): value is EpisodeSegmentFunction {
  return typeof value === 'string' && (EPISODE_SEGMENT_FUNCTIONS as readonly string[]).includes(value)
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
  return items.length > 0 ? items : undefined
}

function parseLlmStoryboardPlan(raw: string): EpisodeStoryboardLlmPlan {
  const parsed = JSON.parse(extractJsonObject(raw)) as unknown
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  if (!record || !Array.isArray(record.segments)) {
    throw new Error('EPISODE_STORYBOARD_LLM_PLAN_INVALID: segments must be an array')
  }

  const segments = record.segments.map((item, index): EpisodeStoryboardLlmPlanSegment => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : null
    if (!row) throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} is not an object`)
    if (!isEpisodeSegmentFunction(row.functionLabel)) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} has invalid functionLabel`)
    }
    const sourceText = typeof row.sourceText === 'string' ? compact(row.sourceText) : ''
    if (!sourceText) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} missing sourceText`)
    }
    const location = typeof row.location === 'string' ? compact(row.location) : ''
    if (!location) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} missing location`)
    }
    if (typeof row.durationSeconds !== 'number' || !Number.isFinite(row.durationSeconds)) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} missing durationSeconds`)
    }
    const emotionalIntent = typeof row.emotionalIntent === 'string' ? compact(row.emotionalIntent) : ''
    const storyQuestion = typeof row.storyQuestion === 'string' ? compact(row.storyQuestion) : ''
    const transitionOut = typeof row.transitionOut === 'string' ? compact(row.transitionOut) : ''
    if (!emotionalIntent || !storyQuestion || !transitionOut) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} missing emotional fields`)
    }
    const durationSeconds = Math.max(4, Math.min(15, row.durationSeconds))
    return {
      functionLabel: row.functionLabel,
      sourceText,
      location,
      durationSeconds,
      emotionalIntent,
      storyQuestion,
      transitionOut,
      characterNames: asStringArray(row.characterNames),
      propNames: asStringArray(row.propNames),
    }
  })

  if (segments.length === 0) {
    throw new Error('EPISODE_STORYBOARD_LLM_PLAN_INVALID: segments cannot be empty')
  }
  return { segments }
}

function buildLlmPlanningPrompt(input: EpisodeStoryboardWorkflowInput): string {
  return [
    '你是短剧分镜工作流 planner。请把剧本拆成 Episode -> Scene -> Segment，其中 Segment 必须围绕情绪线和剧情功能，不要机械按句子平均切。',
    '',
    '只能使用这些 functionLabel：',
    EPISODE_SEGMENT_FUNCTIONS.join('、'),
    '',
    '固定语义：',
    ...EPISODE_SEGMENT_FUNCTIONS.map((label) => {
      const guide = FUNCTION_INTENT[label]
      return `- ${label}：${guide.emotionalIntent} 追问：${guide.storyQuestion}`
    }),
    '',
    '每个 Segment 输出 JSON 字段：',
    '- functionLabel：七类之一',
    '- sourceText：该 Segment 对应的原文，必须来自剧本，不要改写',
    '- location：场景名，优先使用已给 location',
    '- durationSeconds：4-15 秒，按动作和台词自然估算，必须符合 Seedance 2.0 时长范围',
    '- emotionalIntent：本段情绪目的',
    '- storyQuestion：本段制造的追问',
    '- transitionOut：如何接到下一段',
    '- characterNames：本段出现/被重点拍摄的角色名',
    '- propNames：本段需要追踪的道具名',
    '',
    '拆分原则：',
    '1. 如果原文信息足够，必须至少覆盖一次：开场钩子、建立情境、情绪承载、推进信息、制造冲突、交代行动、反转钩子。不要把“开场钩子”和“建立情境”合并成一段。',
    '2. “情绪承载”用于喘息、恐惧、冷汗、眼泪、沉默、手部细节；“推进信息”用于揭示因果/交易/身份/规则；“交代行动”用于逃跑、刺、递、拿、保护、做出选择。',
    '3. 开场钩子和反转钩子不是关键词判断，而是观众继续看的悬念功能。',
    '4. propNames 不只写明文提到的道具，也要写本段画面中需要保持连续的隐藏/随身关键道具，例如发髻里的银簪。',
    '5. emotionalIntent、storyQuestion、transitionOut 每项控制在 18-32 个中文字以内；不要写长解释，避免 JSON 过长。',
    '6. 输出必须是纯 JSON，不要 markdown，不要解释。',
    '',
    `可用角色：${(input.characters || []).map((item) => item.name).join('、') || '未提供'}`,
    `可用道具：${(input.props || []).map((item) => item.name).join('、') || '未提供'}`,
    `可用场景：${(input.locations || []).map((item) => item.name).join('、') || input.defaultLocation || '未提供'}`,
    '',
    '剧本：',
    normalizeScriptText(input.scriptText),
    '',
    'JSON 结构：',
    '{"segments":[{"functionLabel":"开场钩子","sourceText":"...","location":"...","durationSeconds":12,"emotionalIntent":"...","storyQuestion":"...","transitionOut":"...","characterNames":["..."],"propNames":["..."]}]}',
  ].join('\n')
}

function buildBeatUnitsFromLlmPlan(input: EpisodeStoryboardWorkflowInput, plan: EpisodeStoryboardLlmPlan): BeatUnit[] {
  const defaultLocation = input.defaultLocation || input.locations?.[0]?.name || '按剧本锁定场景'
  let currentLocation = defaultLocation
  return plan.segments.map((segment) => {
    currentLocation = resolvePlannedLocation(segment.location, input.locations || [], defaultLocation, currentLocation)
    return {
      text: segment.sourceText,
      functionLabel: segment.functionLabel,
      location: currentLocation,
      durationSeconds: segment.durationSeconds,
      emotionalIntent: segment.emotionalIntent,
      storyQuestion: segment.storyQuestion,
      transitionOut: segment.transitionOut,
      characterNames: segment.characterNames,
      propNames: segment.propNames,
    }
  })
}

function buildScenes(segments: EpisodeStoryboardWorkflowSegment[]): EpisodeStoryboardWorkflowScene[] {
  const scenes: EpisodeStoryboardWorkflowScene[] = []
  for (const segment of segments) {
    const last = scenes[scenes.length - 1]
    if (!last || last.location !== segment.location) {
      const sceneId = `S${String(scenes.length + 1).padStart(2, '0')}`
      scenes.push({
        sceneId,
        location: segment.location,
        segmentIds: [segment.segmentId],
        totalDurationSeconds: segment.durationSeconds,
      })
    } else {
      last.segmentIds.push(segment.segmentId)
      last.totalDurationSeconds += segment.durationSeconds
    }
  }
  return scenes
}

function selectCharactersByNames(
  names: string[] | undefined,
  characters: EpisodeStoryboardWorkflowCharacter[],
): PreciseSegmentCharacterRef[] {
  if (names?.length) {
    const matched = characters.filter((character) => names.some((name) => character.name === name || character.aliases?.includes(name)))
    if (matched.length > 0) return matched.map(({ name, appearance }) => ({ name, appearance }))
    return names.map((name) => ({ name }))
  }
  return []
}

function selectPropsByNames(
  names: string[] | undefined,
  props: EpisodeStoryboardWorkflowProp[],
): PreciseSegmentPropRef[] {
  if (names?.length) {
    const matched = props.filter((prop) => names.some((name) => prop.name === name || prop.aliases?.includes(name)))
    if (matched.length > 0) return matched.map(({ name, state }) => ({ name, state }))
    return names.map((name) => ({ name }))
  }
  return []
}

function buildWorkflowFromUnits(input: EpisodeStoryboardWorkflowInput, units: BeatUnit[]): EpisodeStoryboardWorkflowResult {
  const characters = input.characters || []
  const props = input.props || []
  const segments: EpisodeStoryboardWorkflowSegment[] = []
  const sceneIndexByLocation = new Map<string, number>()
  const segmentIndexByScene = new Map<string, number>()

  for (const unit of units) {
    const sceneIndex = sceneIndexByLocation.get(unit.location)
      || (sceneIndexByLocation.set(unit.location, sceneIndexByLocation.size + 1).get(unit.location) || 1)
    const sceneId = `S${String(sceneIndex).padStart(2, '0')}`
    const segmentIndex = (segmentIndexByScene.get(sceneId) || 0) + 1
    segmentIndexByScene.set(sceneId, segmentIndex)

    const segmentId = `${sceneId}-SEG${String(segmentIndex).padStart(2, '0')}`
    const segmentCharacters = selectCharactersByNames(unit.characterNames, characters)
    const segmentProps = selectPropsByNames(unit.propNames, props)
    const durationSeconds = unit.durationSeconds
    const prompt = buildPreciseBeatVideoPrompt({
      segmentId,
      location: unit.location,
      beat: `${unit.functionLabel}：${unit.text}`,
      durationSeconds,
      characters: segmentCharacters,
      props: segmentProps,
      sceneOpening: buildSceneOpening(unit.location, unit.functionLabel),
      lighting: buildLighting(unit.location),
      outputParams: {
        videoModel: input.videoModel,
        resolution: input.resolution,
      },
    })

    segments.push({
      segmentId,
      functionLabel: unit.functionLabel,
      sourceText: unit.text,
      location: unit.location,
      durationSeconds,
      emotionalIntent: unit.emotionalIntent,
      storyQuestion: unit.storyQuestion,
      transitionOut: unit.transitionOut,
      characters: segmentCharacters,
      props: segmentProps,
      videoPrompt: prompt,
    })
  }

  return {
    episodeNumber: input.episodeNumber,
    segmentFunctions: EPISODE_SEGMENT_FUNCTIONS,
    scenes: buildScenes(segments),
    segments,
  }
}

export async function buildEpisodeStoryboardWorkflowWithLlm(
  input: EpisodeStoryboardWorkflowInput,
  planner: EpisodeStoryboardWorkflowLlmPlanner,
): Promise<EpisodeStoryboardWorkflowResult> {
  const raw = await planner(buildLlmPlanningPrompt(input))
  const plan = parseLlmStoryboardPlan(raw)
  return buildWorkflowFromUnits(input, buildBeatUnitsFromLlmPlan(input, plan))
}

export async function buildEpisodeStoryboardWorkflowWithRuntimeLlm(
  input: EpisodeStoryboardWorkflowInput,
  options: EpisodeStoryboardWorkflowRuntimeLlmOptions,
): Promise<EpisodeStoryboardWorkflowResult> {
  const prompt = buildLlmPlanningPrompt(input)
  const completion = await chatCompletion(
    options.userId,
    options.model,
    [
      {
        role: 'system',
        content: '你只输出符合要求的 JSON。不要 markdown，不要解释。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    {
      temperature: 0.2,
      reasoning: false,
      maxTokens: options.maxTokens || 8000,
      projectId: options.projectId,
      action: 'episode_storyboard_segment_plan',
    },
  )
  const raw = getCompletionParts(completion).text
  const plan = parseLlmStoryboardPlan(raw)
  return buildWorkflowFromUnits(input, buildBeatUnitsFromLlmPlan(input, plan))
}
