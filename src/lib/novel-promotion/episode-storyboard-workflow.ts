import {
  buildPreciseBeatVideoPrompt,
  type PreciseSegmentCharacterRef,
  type PreciseSegmentPropRef,
} from '@/lib/novel-promotion/short-drama-video-prompt'
import {
  selectStoryboardCharacterAppearance,
  type StoryboardAppearanceOption,
} from '@/lib/novel-promotion/storyboard-character-appearance'

export const EPISODE_STORYBOARD_PROMPT_PROFILE = 'short-drama-cinematic-v1' as const

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
  appearanceOptions?: StoryboardAppearanceOption[]
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
  productionContext?: string
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
  onScreenCharacterNames?: string[]
  propNames?: string[]
  characterAppearances?: Record<string, string>
  narrativeEntry: string
  narrativeExit: string
  shotBeats: string[]
  openingState?: string
  endingState?: string
  cameraAxis?: string
}

export type EpisodeStoryboardLlmPlan = {
  segments: EpisodeStoryboardLlmPlanSegment[]
}

export type EpisodeStoryboardWorkflowLlmPlanner = (
  prompt: string,
  attempt?: number,
) => Promise<string>

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
  narrativeEntry: string
  narrativeExit: string
  shotBeats: string[]
  openingState?: string
  endingState?: string
  previousEndState?: string
  cameraAxis?: string
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
  onScreenCharacterNames?: string[]
  propNames?: string[]
  characterAppearances?: Record<string, string>
  narrativeEntry: string
  narrativeExit: string
  shotBeats: string[]
  openingState?: string
  endingState?: string
  cameraAxis?: string
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
    return '破旧油灯暖黄实用光 2700K 作为主光，窗外雨夜冷青闪电 6500K 作为瞬间弱环境光；key:fill 约 10:1，明暗反差压抑，角色脸部、手部和本段明确使用的关键道具清晰。'
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

function asExplicitStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => typeof item === 'string' ? compact(item) : '').filter(Boolean)
}

function requiredCompactString(value: unknown, field: string, index: number): string {
  const result = typeof value === 'string' ? compact(value) : ''
  if (!result) {
    throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} missing ${field}`)
  }
  return result
}

function normalizeNarrativeMatchText(value: string): string {
  return value
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    .replace(/^[△›•·]+/g, '')
}

function narrativeClauses(value: string): string[] {
  return value
    .split(/[。！？!?；;\n]+/u)
    .map((item) => normalizeNarrativeMatchText(item))
    .filter((item) => item.length >= 10)
}

function validatePlanNarrativeBoundaries(scriptText: string, segments: EpisodeStoryboardLlmPlanSegment[]): void {
  const script = normalizeNarrativeMatchText(scriptText)
  let cursor = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const source = normalizeNarrativeMatchText(segment.sourceText)
    const sourceIndex = script.indexOf(source, cursor)
    if (sourceIndex < 0) {
      throw new Error(
        `EPISODE_STORYBOARD_LLM_PLAN_SOURCE_ORDER_INVALID: segment ${index + 1} sourceText must be an exact, non-overlapping excerpt in screenplay order`,
      )
    }
    cursor = sourceIndex + source.length

    const normalizedBeats = segment.shotBeats.map(normalizeNarrativeMatchText)
    if (new Set(normalizedBeats).size !== normalizedBeats.length) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} repeats a shotBeat`)
    }

    const futureClauses = segments
      .slice(index + 1)
      .flatMap((future) => narrativeClauses(future.sourceText))
    const boundaryText = normalizeNarrativeMatchText([
      segment.narrativeEntry,
      segment.narrativeExit,
      ...segment.shotBeats,
    ].join(' '))
    const leakedClause = futureClauses.find((clause) => boundaryText.includes(clause))
    if (leakedClause) {
      throw new Error(
        `EPISODE_STORYBOARD_LLM_PLAN_FUTURE_LEAK: segment ${index + 1} contains screenplay content reserved for a later segment`,
      )
    }
  }
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [compact(key), typeof item === 'string' ? compact(item) : ''] as const)
    .filter(([key, item]) => Boolean(key && item))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function parseLlmStoryboardPlan(raw: string, scriptText: string): EpisodeStoryboardLlmPlan {
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
    const shotBeats = asExplicitStringArray(row.shotBeats)
    if (!shotBeats?.length || shotBeats.length > 5) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} shotBeats must contain 1-5 ordered beats`)
    }
    const onScreenCharacterNames = asExplicitStringArray(row.onScreenCharacterNames)
    if (!onScreenCharacterNames) {
      throw new Error(`EPISODE_STORYBOARD_LLM_PLAN_INVALID: segment ${index + 1} missing onScreenCharacterNames array`)
    }
    return {
      functionLabel: row.functionLabel,
      sourceText,
      location,
      durationSeconds,
      emotionalIntent,
      storyQuestion,
      transitionOut,
      characterNames: asStringArray(row.characterNames),
      onScreenCharacterNames,
      propNames: asStringArray(row.propNames),
      characterAppearances: asStringMap(row.characterAppearances),
      narrativeEntry: requiredCompactString(row.narrativeEntry, 'narrativeEntry', index),
      narrativeExit: requiredCompactString(row.narrativeExit, 'narrativeExit', index),
      shotBeats,
      openingState: typeof row.openingState === 'string' ? compact(row.openingState) : undefined,
      endingState: typeof row.endingState === 'string' ? compact(row.endingState) : undefined,
      cameraAxis: typeof row.cameraAxis === 'string' ? compact(row.cameraAxis) : undefined,
    }
  })

  if (segments.length === 0) {
    throw new Error('EPISODE_STORYBOARD_LLM_PLAN_INVALID: segments cannot be empty')
  }
  validatePlanNarrativeBoundaries(scriptText, segments)
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
    '- characterNames：本段剧情涉及的角色名，可包含对白里被提及但未入画的人',
    '- onScreenCharacterNames：本段画面中真实可见的角色名；只在对白、回忆或称呼中被提到的人不得写入；允许空数组',
    '- characterAppearances：对象，key 为角色正式名，value 必须是下方该角色的可用形象名；当前集/场景命中变体覆盖范围时必须选该变体，仅未命中任何变体时选主形象',
    '- propNames：本段需要追踪的道具名',
    '- narrativeEntry：本段剧情从哪个明确叙事瞬间开始，只描述当前 sourceText 的入口，不重复上一段已经完成的动作',
    '- narrativeExit：本段剧情推进到哪个明确叙事瞬间停止，不得写下一 Segment 才发生的动作',
    '- shotBeats：1-5 条严格有序的可视动作/对白节拍。每条只拍 sourceText 内的内容；第一条从 narrativeEntry 接起，最后一条精确停在 narrativeExit',
    '- openingState：本段第一帧的角色站位、身体姿态、朝向、持物手和道具状态',
    '- endingState：本段最后一帧的角色站位、身体姿态、朝向、持物手和道具状态',
    '- cameraAxis：本场戏的动作轴线和角色屏幕左右关系；同场景连续 Segment 必须保持一致',
    '',
    '拆分原则：',
    '1. 如果原文信息足够，必须至少覆盖一次：开场钩子、建立情境、情绪承载、推进信息、制造冲突、交代行动、反转钩子。不要把“开场钩子”和“建立情境”合并成一段。',
    '2. “情绪承载”用于喘息、恐惧、冷汗、眼泪、沉默、手部细节；“推进信息”用于揭示因果/交易/身份/规则；“交代行动”用于逃跑、刺、递、拿、保护、做出选择。',
    '3. 开场钩子和反转钩子不是关键词判断，而是观众继续看的悬念功能。',
    '4. propNames 可包含需要保持状态连续的隐藏/随身关键道具；但如果 sourceText 没有使用它，shotBeats 不得让角色触碰、注视、取出或使用它。',
    '5. emotionalIntent、storyQuestion、transitionOut 每项控制在 18-32 个中文字以内；不要写长解释，避免 JSON 过长。',
    '6. segments 必须按剧本原始顺序覆盖整集主要剧情；不得跳过场次、关键动作、对白、因果、反转或集尾钩子，也不得续写原文之后的剧情。',
    '7. 地点、角色和道具优先且尽量只使用下方已锁定资产的正式名称，便于下游生成 @资产名 引用。',
    '8. 一个 Segment 是一个视频生成单元，内部会继续生成多个 Shot；不要把每一句话机械拆成 Segment，也不要把整集塞进一个 Segment。',
    '9. 输出必须是纯 JSON，不要 markdown，不要解释。',
    '10. 连续性是硬约束：同场景中 segment[i].openingState 必须逐项承接 segment[i-1].endingState；角色不可瞬移、无故换手、换装、改变发型或恢复道具状态；下一段动作只能从上一段结尾继续。',
    '11. characterAppearances 只能从可用形象中精确选择。覆盖场景优先于覆盖集；命中覆盖范围的变体是硬约束，不能被主形象覆盖；多个变体同时命中时选择覆盖范围最窄、最具体的一个。剧本未命中任何覆盖范围时才使用主形象。',
    '12. sourceText 必须逐字摘自剧本中的一个连续区间；所有 Segment 的 sourceText 按原文顺序且互不重叠。不得改写、倒序、重复上一段或把后文提前到当前段。',
    '13. shotBeats 是生视频内容合同：相邻条目必须产生新的剧情推进，禁止用不同景别重复同一个动作；禁止添加 sourceText 未发生的反击、逃跑、持物、人物入场或关系变化。',
    '14. 每段第一条 shotBeat 承接上一段 narrativeExit，但不重新表演上一段；最后一条只完成本段 narrativeExit。transitionOut 只描述剪辑接口，不能把下一段动作写进 shotBeats。',
    '15. onScreenCharacterNames 只列现场可见人物。比如角色说“阿婆，我不能死”，阿婆只是被称呼且未在现场，则不得让阿婆入画，也不得为她绑定现场资产。',
    '',
    `可用角色：${(input.characters || []).map((item) => item.name).join('、') || '未提供'}`,
    `角色可用形象：${(input.characters || []).map((item) => {
      const options = item.appearanceOptions?.length
        ? item.appearanceOptions.map((option) => `${option.label}${option.coverageEpisodes?.length ? `[覆盖${option.coverageEpisodes.join('、')}]` : ''}${option.coverageScenes?.length ? `[场景${option.coverageScenes.join('、')}]` : ''}`).join(' / ')
        : item.appearance || '初始形象'
      return `${item.name} => ${options}`
    }).join('；') || '未提供'}`,
    `可用道具：${(input.props || []).map((item) => item.name).join('、') || '未提供'}`,
    `可用场景：${(input.locations || []).map((item) => item.name).join('、') || input.defaultLocation || '未提供'}`,
    ...(input.productionContext?.trim()
      ? ['', '项目制作约束：', input.productionContext.trim()]
      : []),
    '',
    '剧本：',
    normalizeScriptText(input.scriptText),
    '',
    'JSON 结构：',
    '{"segments":[{"functionLabel":"开场钩子","sourceText":"逐字原文","location":"...","durationSeconds":12,"emotionalIntent":"...","storyQuestion":"...","transitionOut":"...","characterNames":["..."],"onScreenCharacterNames":["..."],"characterAppearances":{"角色正式名":"初始形象"},"propNames":["..."],"narrativeEntry":"...","narrativeExit":"...","shotBeats":["当前段可视节拍1","当前段可视节拍2"],"openingState":"...","endingState":"...","cameraAxis":"..."}]}',
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
      onScreenCharacterNames: segment.onScreenCharacterNames,
      propNames: segment.propNames,
      characterAppearances: segment.characterAppearances,
      narrativeEntry: segment.narrativeEntry,
      narrativeExit: segment.narrativeExit,
      shotBeats: segment.shotBeats,
      openingState: segment.openingState,
      endingState: segment.endingState,
      cameraAxis: segment.cameraAxis,
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
  context: {
    episodeNumber: number
    sceneId: string
    sourceText: string
    requestedAppearances?: Record<string, string>
  },
): PreciseSegmentCharacterRef[] {
  if (names?.length) {
    const matched = characters.filter((character) => names.some((name) => character.name === name || character.aliases?.includes(name)))
    if (matched.length > 0) return matched.map((character) => {
      const requestedAppearance = context.requestedAppearances?.[character.name]
        || Object.entries(context.requestedAppearances || {}).find(([key]) => character.aliases?.includes(key))?.[1]
      const options = character.appearanceOptions?.length
        ? character.appearanceOptions
        : [{ label: character.appearance || '初始形象', isPrimary: true }]
      const selected = selectStoryboardCharacterAppearance(options, {
        episodeNumber: context.episodeNumber,
        sceneId: context.sceneId,
        requestedAppearance,
        sourceText: context.sourceText,
        // characterAppearances is planner output, not a manual user lock.
        // Episode/scene coverage remains authoritative if the planner emits
        // the generic primary label for a scoped variant episode.
        preferScopedCoverageOverPrimaryRequest: true,
      })
      return {
        name: character.name,
        ...(selected?.label ? { appearance: selected.label } : {}),
        ...(selected?.id ? { appearanceId: selected.id } : {}),
      }
    })
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
  let sceneIndex = 0
  let segmentIndex = 0
  let currentLocation = ''
  let previousSegment: EpisodeStoryboardWorkflowSegment | null = null

  for (const unit of units) {
    if (unit.location !== currentLocation) {
      sceneIndex += 1
      segmentIndex = 0
      currentLocation = unit.location
    }
    const sceneId = `S${String(sceneIndex).padStart(2, '0')}`
    segmentIndex += 1

    const segmentId = `${sceneId}-SEG${String(segmentIndex).padStart(2, '0')}`
    const segmentCharacters = selectCharactersByNames(unit.onScreenCharacterNames ?? unit.characterNames, characters, {
      episodeNumber: input.episodeNumber,
      sceneId,
      sourceText: unit.text,
      requestedAppearances: unit.characterAppearances,
    })
    const segmentProps = selectPropsByNames(unit.propNames, props)
    const durationSeconds = unit.durationSeconds
    const sameScene = previousSegment?.location === unit.location
    const previousEndState = sameScene ? previousSegment?.endingState : undefined
    const openingState = previousEndState
      || unit.openingState
      || `${unit.location}内按剧本建立本场第一帧站位、朝向与道具状态。`
    const endingState = unit.endingState || unit.narrativeExit
    const cameraAxis = unit.cameraAxis || (sameScene ? previousSegment?.cameraAxis : undefined) || `${unit.location}主动作轴线，保持角色屏幕左右关系稳定`
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
      previousEndState,
      openingContinuity: openingState,
      endingStateTarget: endingState,
      narrativeEntry: unit.narrativeEntry,
      narrativeExit: unit.narrativeExit,
      shotBeats: unit.shotBeats,
      cameraAxis,
    })

    const workflowSegment: EpisodeStoryboardWorkflowSegment = {
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
      narrativeEntry: unit.narrativeEntry,
      narrativeExit: unit.narrativeExit,
      shotBeats: unit.shotBeats,
      openingState,
      endingState,
      previousEndState,
      cameraAxis,
    }
    segments.push(workflowSegment)
    previousSegment = workflowSegment
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
  const prompt = buildLlmPlanningPrompt(input)
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await planner(prompt, attempt)
      const plan = parseLlmStoryboardPlan(raw, input.scriptText)
      return buildWorkflowFromUnits(input, buildBeatUnitsFromLlmPlan(input, plan))
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError || new Error('EPISODE_STORYBOARD_LLM_PLAN_FAILED')
}

export async function buildEpisodeStoryboardWorkflowWithRuntimeLlm(
  input: EpisodeStoryboardWorkflowInput,
  options: EpisodeStoryboardWorkflowRuntimeLlmOptions,
): Promise<EpisodeStoryboardWorkflowResult> {
  const [{ chatCompletion }, { getCompletionParts }] = await Promise.all([
    import('@/lib/llm/chat-completion'),
    import('@/lib/llm/completion-parts'),
  ])
  const prompt = buildLlmPlanningPrompt(input)
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await chatCompletion(
        options.userId,
        options.model,
        [
          {
            role: 'system',
            content: '你只输出符合要求的 JSON。不要 markdown，不要解释。严格保持剧本顺序，禁止把后续剧情提前。',
          },
          {
            role: 'user',
            content: attempt === 1
              ? prompt
              : `${prompt}\n\n上一次输出未通过内容边界校验：${lastError?.message || '格式或剧情顺序错误'}。请重新生成完整 JSON，重点修正 sourceText 原文顺序、shotBeats 越界和现场人物。`,
          },
        ],
        {
          temperature: 0.2,
          reasoning: false,
          maxTokens: options.maxTokens || 12000,
          projectId: options.projectId,
          action: 'episode_storyboard_segment_plan',
        },
      )
      const raw = getCompletionParts(completion).text
      const plan = parseLlmStoryboardPlan(raw, input.scriptText)
      return buildWorkflowFromUnits(input, buildBeatUnitsFromLlmPlan(input, plan))
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError || new Error('EPISODE_STORYBOARD_LLM_PLAN_FAILED')
}
