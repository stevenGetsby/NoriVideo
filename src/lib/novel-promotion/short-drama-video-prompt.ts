export type ShotSheetScene = {
  sceneId: string
  heading: string
  characters: string[]
}

export type ShotSheetShot = {
  number: number
  code: string
  timeRange: string
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  scene: ShotSheetScene
  fields: Record<string, string>
}

export type PreciseSegmentCharacterRef = {
  name: string
  appearance?: string
}

export type PreciseSegmentPropRef = {
  name: string
  state?: string
}

export type PreciseSegmentAssets = {
  characters: PreciseSegmentCharacterRef[]
  props: PreciseSegmentPropRef[]
  environment: string
}

export type PreciseSegmentOutputParams = {
  videoModel?: string
  resolution?: string
  durationSeconds: number
}

export type PreciseOpeningState = {
  environmentLine: string
  blockingLines: string[]
  propStateLines?: string[]
  lightingLine: string
}

export type PreciseInternalShot = {
  shotNumber: number
  durationSeconds: number
  cameraLine: string
  frameLine: string
  lightingLine: string
  audioLines?: string[]
}

export type PreciseSegmentPromptInput = {
  segmentId: string
  location: string
  functionLabel?: string
  sourceText?: string
  assets: PreciseSegmentAssets
  outputParams: PreciseSegmentOutputParams
  consistencyControl?: string
  openingState: PreciseOpeningState
  shots: PreciseInternalShot[]
  quota?: {
    imageUsed?: number
    imageMax?: number
    videoUsed?: number
    videoMax?: number
    audioUsed?: number
    audioMax?: number
  }
  negativeRequirements?: string
  styleDescription?: string
}

export type VideoPromptBlock = {
  blockNumber: number
  segmentId: string
  shots: ShotSheetShot[]
  durationSeconds: number
  text: string
}

export type ShortDramaRoleAsset = {
  name: string
  description: string
}

export type ShortDramaBrief = {
  roleAssets: ShortDramaRoleAsset[]
  storyText: string
  ratio: '9:16' | '16:9' | '1:1'
  styleText: string
  noMusic: boolean
  noSubtitles: boolean
  isMedical: boolean
}

export const PRECISE_SEGMENT_NEGATIVE_REQUIREMENTS = [
  '不要改变故事核心因果，不要新增无关角色，不要替换已锁定角色、场景或道具资产，不要把剧情道具改成商品卖点。',
  '角色脸部、发型、服装、体型、年龄气质必须全片一致，不串脸、不漂移。',
  '每个 Shot 必须服务动作、台词、表情或情绪推进，不要只输出静态摆拍。',
  '不要乱码文字，不要无意义字幕，不要过度美颜，不要塑料皮肤。',
  '不要生成中文字幕，不要自动生成大段字幕；如需台词，只作为口型、声音或内心独白指导。',
  '不要生成背景音乐，只保留必要环境声、脚步声、衣料摩擦声和道具声。',
  '结尾必须留出进入下一剧情片段的动作、视线或空间方向。',
].join(' ')

const TARGET_REFERENCE_RANGES_FOR_50_SHOT_MEDICAL_TEST = [
  [1, 4],
  [5, 7],
  [8, 11],
  [12, 14],
  [15, 19],
  [20, 21],
  [22, 24],
  [25, 27],
  [28, 32],
  [33, 34],
  [35, 38],
  [39, 41],
  [42, 43],
  [44, 47],
  [48, 50],
] as const
const MAX_VIDEO_PROMPT_BLOCK_SECONDS = 15

function compact(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxLength = 120): string {
  const text = compact(value)
  const chars = Array.from(text)
  if (chars.length <= maxLength) return text
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join('')}…`
}

function parseTimecodeSeconds(value: string): number {
  const parts = value.split(':').map((part) => Number(part))
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return 0
  return Math.max(0, Math.floor(parts[0] * 60 + parts[1]))
}

function parseTimeRange(value: string): { startSeconds: number; endSeconds: number } {
  const [startRaw, endRaw] = value.split('-')
  const startSeconds = parseTimecodeSeconds(startRaw || '00:00')
  const endSeconds = parseTimecodeSeconds(endRaw || startRaw || '00:00')
  return {
    startSeconds,
    endSeconds: Math.max(startSeconds + 1, endSeconds),
  }
}

function parseCharacters(raw: string): string[] {
  return raw
    .split('/')
    .map((item) => compact(item))
    .filter((item) => item && item !== '（空）')
}

export function parseShotSheetText(text: string): ShotSheetShot[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let currentScene: ShotSheetScene = {
    sceneId: 'S1',
    heading: '未指定场景',
    characters: [],
  }
  let currentShot: ShotSheetShot | null = null
  const shots: ShotSheetShot[] = []

  const pushShot = () => {
    if (currentShot) shots.push(currentShot)
    currentShot = null
  }

  for (const lineRaw of lines) {
    const line = lineRaw.trim()
    if (!line) continue

    const sceneMatch = line.match(/^##\s+(S\d+)\s+\[(.+?)\]\s+角色[:：]\s*(.*)$/)
    if (sceneMatch) {
      pushShot()
      currentScene = {
        sceneId: sceneMatch[1],
        heading: compact(sceneMatch[2]),
        characters: parseCharacters(sceneMatch[3]),
      }
      continue
    }

    const shotMatch = line.match(/^###\s+SH(\d+)\s+\[(.+?)\]/)
    if (shotMatch) {
      pushShot()
      const number = Number(shotMatch[1])
      const timeRange = compact(shotMatch[2])
      const parsedRange = parseTimeRange(timeRange)
      currentShot = {
        number,
        code: `SH${shotMatch[1]}`,
        timeRange,
        startSeconds: parsedRange.startSeconds,
        endSeconds: parsedRange.endSeconds,
        durationSeconds: Math.max(1, parsedRange.endSeconds - parsedRange.startSeconds),
        scene: currentScene,
        fields: {},
      }
      continue
    }

    if (!currentShot) continue
    const fieldMatch = line.match(/^([^：:]+)[：:]\s*(.*)$/)
    if (fieldMatch) {
      currentShot.fields[compact(fieldMatch[1])] = compact(fieldMatch[2])
    }
  }

  pushShot()
  return shots.sort((a, b) => a.number - b.number)
}

function groupByTargetReference(shots: ShotSheetShot[]): ShotSheetShot[][] {
  const byNumber = new Map(shots.map((shot) => [shot.number, shot]))
  return TARGET_REFERENCE_RANGES_FOR_50_SHOT_MEDICAL_TEST
    .map(([start, end]) => {
      const rows: ShotSheetShot[] = []
      for (let number = start; number <= end; number += 1) {
        const shot = byNumber.get(number)
        if (shot) rows.push(shot)
      }
      return rows
    })
    .filter((rows) => rows.length > 0)
}

function groupBySceneAndDuration(shots: ShotSheetShot[], targetSeconds = 12): ShotSheetShot[][] {
  const groups: ShotSheetShot[][] = []
  let current: ShotSheetShot[] = []
  let currentSceneId = ''
  let currentDuration = 0

  const flush = () => {
    if (current.length > 0) groups.push(current)
    current = []
    currentDuration = 0
    currentSceneId = ''
  }

  for (const shot of shots) {
    const sceneChanged = currentSceneId && shot.scene.sceneId !== currentSceneId
    const wouldExceed = currentDuration >= 7 && currentDuration + shot.durationSeconds > targetSeconds + 2
    if (sceneChanged || wouldExceed) flush()
    current.push(shot)
    currentSceneId = shot.scene.sceneId
    currentDuration += shot.durationSeconds
  }
  flush()
  return groups
}

function groupDurationSeconds(group: ShotSheetShot[]): number {
  if (group.length === 0) return 0
  return Math.max(1, group[group.length - 1].endSeconds - group[0].startSeconds)
}

function splitLongShotGroups(groups: ShotSheetShot[][], maxSeconds = MAX_VIDEO_PROMPT_BLOCK_SECONDS): ShotSheetShot[][] {
  const result: ShotSheetShot[][] = []
  for (const group of groups) {
    if (groupDurationSeconds(group) <= maxSeconds) {
      result.push(group)
      continue
    }

    let current: ShotSheetShot[] = []
    const flush = () => {
      if (current.length > 0) result.push(current)
      current = []
    }

    for (const shot of group) {
      const next = [...current, shot]
      if (current.length > 0 && groupDurationSeconds(next) > maxSeconds) {
        flush()
      }
      current.push(shot)
    }
    flush()
  }
  return result
}

export function groupShotsForVideoPrompts(shots: ShotSheetShot[]): ShotSheetShot[][] {
  const isReferenceMedicalCase = shots.length === 50
    && shots[0]?.code === 'SH001'
    && shots[shots.length - 1]?.code === 'SH050'
    && shots.some((shot) => /医院|手术/.test(shot.scene.heading))

  const groups = isReferenceMedicalCase
    ? groupByTargetReference(shots)
    : groupBySceneAndDuration(shots)
  return splitLongShotGroups(groups)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => compact(value)).filter(Boolean)))
}

function cleanShotText(value: string | undefined): string {
  return compact(value)
    .replace(/（空）/g, '')
    .replace(/\(空\)/g, '')
    .replace(/沾血/g, '无血腥细节的')
    .replace(/病人创口（虚化）/g, '无菌布覆盖区域')
    .replace(/病人创口/g, '无菌布覆盖区域')
}

export function summarizeVideoPromptBeat(value: string, maxLength = 120): string {
  const text = cleanShotText(value)
    .replace(/^短剧精细视频提示词块\s*\d+\/\d+[:：]?/u, '')
    .replace(/^Agent\s*剧情片段\s*\d+\/\d+[:：]?/iu, '')
    .replace(/^\d+[.、]\s*SH\d{3}\s*[-—~至到]\s*SH\d{3}[:：]?/iu, '')
    .trim()
  return truncateText(text, maxLength)
}

function normalizeDialogue(value: string | undefined): string {
  const text = cleanShotText(value)
  if (!text) return ''
  return text
    .replace(/\(对口型\)/g, '口型同步，说：')
    .replace(/（对口型）/g, '口型同步，说：')
    .replace(/\(画外\)/g, '画外音：')
    .replace(/（画外）/g, '画外音：')
    .replace(/\(OS\)/g, '内心独白：')
}

function field(shot: ShotSheetShot, name: string): string {
  return cleanShotText(shot.fields[name])
}

function formatDuration(value: number): string {
  if (Number.isInteger(value)) return `${value}`
  return value.toFixed(1).replace(/\.0$/, '')
}

function formatShotDuration(value: number): string {
  return Math.max(0.5, value).toFixed(1)
}

function charCount(value: string): number {
  return Array.from(value.replace(/\s+/g, '')).length
}

function assetCharacterLine(item: PreciseSegmentCharacterRef): string {
  return item.appearance ? `${item.name} · ${item.appearance}` : item.name
}

function assetPropLine(item: PreciseSegmentPropRef): string {
  return item.state ? `${item.name} · ${item.state}` : item.name
}

function buildConsistencyControl(assets: PreciseSegmentAssets, sourceText = ''): string {
  const characterText = assets.characters.length > 0
    ? `角色 ${assets.characters.map(assetCharacterLine).join('、')} 的脸型、发型、服装、体型、年龄气质与参考资产完全一致`
    : '无真人角色时，主体资产外观与参考资产完全一致'
  const propText = assets.props.length > 0
    ? `道具 ${assets.props.map(assetPropLine).join('、')} 的位置、持握方式和状态连续`
    : '不新增未列出的关键道具'
  const source = sourceText ? `剧情含义严格对应“${truncateText(sourceText, 80)}”` : '剧情含义严格对应本段剧本原文'
  return `${characterText}；环境 ${assets.environment} 的空间结构、入口方向、主光方向和色调不漂移；${propText}；${source}。`
}

function buildCinematicStyleDescription(location: string, sourceText = ''): string {
  const source = `${location}\n${sourceText}`
  if (/柴房|张秃子|银簪|暴雨|药效|油灯/.test(source)) {
    return '真实古装短剧电影质感，低调高反差，油灯暖黄与雨夜冷青互相切割；保留皮肤汗珠、衣料湿痕、木墙霉斑、泥水和银簪锐利高光，不要广告棚拍感，不要柔焦美颜，不要把危险戏拍成唯美 MV。'
  }
  if (/土地庙|庙|追兵|火把|雨夜|靴子/.test(source)) {
    return '雨夜逃亡悬疑短剧质感，冷青雨幕与火把暖橙形成追捕压迫；画面颗粒克制，湿发、泥脚印、墙皮、神像阴影和手心血痕真实可触，不要玄幻化，不要过度慢动作。'
  }
  if (/医院|手术|病房|走廊|ICU|护士|医生|Ava|Dr\./i.test(source)) {
    return '真实欧美医疗短剧质感，冷白 LED、浅蓝导视线和英文标识保持可信；表演克制但情绪清楚，皮肤纹理、文件纸张、白大褂布料和金属扶手细节真实，不要广告片柔光，不要中文环境标识。'
  }
  return '真实短剧电影质感，镜头服务动作、台词、表情和情绪推进；保留皮肤、衣料、道具磨损、空间材质和环境声细节，不要静态摆拍，不要广告海报感，不要无意义炫技运镜。'
}

function formatShot(shot: PreciseInternalShot): string {
  return [
    `Shot ${shot.shotNumber}`,
    `duration: ${formatShotDuration(shot.durationSeconds)}s`,
    `镜头：${shot.cameraLine}`,
    '画面：',
    shot.frameLine,
    `光影：${shot.lightingLine}`,
    ...(shot.audioLines || []).filter(Boolean),
  ].join('\n')
}

export function buildPreciseSegmentVideoPrompt(input: PreciseSegmentPromptInput): string {
  const quota = {
    imageUsed: input.quota?.imageUsed ?? Math.min(9, input.assets.characters.length + input.assets.props.length + (input.assets.environment ? 1 : 0)),
    imageMax: input.quota?.imageMax ?? 9,
    videoUsed: input.quota?.videoUsed ?? 0,
    videoMax: input.quota?.videoMax ?? 3,
    audioUsed: input.quota?.audioUsed ?? 0,
    audioMax: input.quota?.audioMax ?? 3,
  }
  const consistencyControl = compact(input.consistencyControl) || buildConsistencyControl(input.assets, input.sourceText)
  const propStateLines = input.openingState.propStateLines || []
  const promptBody = [
    '开场状态：',
    '环境：',
    input.openingState.environmentLine,
    '站位关系：',
    ...(input.openingState.blockingLines.length > 0
      ? input.openingState.blockingLines
      : ['单主体镜头，主体位于画面动作中心；入口、出口和视线方向按剧情保持连续。']),
    ...propStateLines,
    `灯光：${input.openingState.lightingLine}`,
    '',
    ...input.shots.map(formatShot),
    '',
    `【本分镜负面要求】 ${input.negativeRequirements || PRECISE_SEGMENT_NEGATIVE_REQUIREMENTS}`,
  ].join('\n')

  return [
    input.segmentId,
    input.location,
    `${formatDuration(input.outputParams.durationSeconds)}s`,
    '',
    '◎ 参考资产',
    `分镜参考素材配额： 参考图 ${quota.imageUsed}/${quota.imageMax}  ·  参考视频 ${quota.videoUsed}/${quota.videoMax}  ·  参考音频 ${quota.audioUsed}/${quota.audioMax}`,
    '',
    '角色',
    ...(input.assets.characters.length > 0 ? input.assets.characters.map(assetCharacterLine) : ['无']),
    '物品',
    ...(input.assets.props.length > 0 ? input.assets.props.map(assetPropLine) : ['无']),
    '环境',
    input.assets.environment || input.location,
    '',
    '◎ 输出参数',
    '视频模型',
    input.outputParams.videoModel || '按项目视频模型配置',
    '分辨率',
    input.outputParams.resolution || '按项目分辨率配置',
    '视频秒数',
    `${formatDuration(input.outputParams.durationSeconds)}s`,
    '',
    '◈ 一致性控制',
    `${charCount(consistencyControl)} 字`,
    consistencyControl,
    '',
    '◈ 视频提示词',
    `${charCount(promptBody)} 字`,
    promptBody,
    '',
    '◈ 画风描述',
    input.styleDescription || buildCinematicStyleDescription(input.location, input.sourceText),
  ].join('\n')
}

function describeLocation(heading: string): string {
  if (/手术室/.test(heading)) {
    return '现代美国医院手术室，冷绿色医疗灯光，绿色无菌布，英文监护仪界面，无影灯和金属器械清晰可见，专业克制，不血腥'
  }
  if (/洗手间|更衣室/.test(heading)) {
    return '现代美国医院术后准备室/更衣区，冷白照明、浅蓝墙面、洗手池和医疗器械背景保持一致'
  }
  if (/医院|走廊|ICU|病房|护士站|候诊|急诊|诊室|手术/.test(heading)) {
    return '现代美国私立医院走廊，白色墙面配浅蓝色横向导视线，冷白顶灯，英文导视牌、手术室门、等待区椅子和金属扶手保持一致'
  }
  return `${heading}，按原始镜头稿保持空间结构、光线方向、环境元素和角色行动路线一致`
}

function inferShotProps(shots: ShotSheetShot[]): string[] {
  return unique(shots.flatMap((shot) => {
    const explicit = parseCharacters(shot.fields['道具'] || '').filter((item) => item !== '无')
    const text = `${field(shot, '画面')} ${field(shot, '动作')} ${field(shot, '对白/字幕')}`
    return [
      ...explicit,
      /手术|文件|安排/.test(text) ? '手术安排文件' : '',
      /眼镜/.test(text) ? '黑框眼镜' : '',
    ].filter(Boolean)
  }))
}

function buildSegmentId(sceneId: string, segmentNumber: number): string {
  const sceneDigits = sceneId.match(/\d+/)?.[0] || '1'
  return `S${sceneDigits.padStart(2, '0')}-SEG${String(segmentNumber).padStart(2, '0')}`
}

function buildShotSheetOpeningState(group: ShotSheetShot[], assets: PreciseSegmentAssets): PreciseOpeningState {
  const first = group[0]
  const scene = describeLocation(first.scene.heading)
  const characters = assets.characters.map((item) => item.name)
  const props = assets.props.map((item) => item.name)
  return {
    environmentLine: `${scene}，按镜头稿时间与空间关系开场，情绪基调由剧本冲突决定<环境声、脚步声、衣料摩擦声和必要道具声>。`,
    blockingLines: [
      characters.length > 0
        ? `${characters.join('、')}：位于${first.scene.heading}的关键行动区域，站位、朝向和距离关系承接源镜头 ${first.code}；动作从静止准备进入剧情。`
        : '主体资产：位于画面动作中心，空间方向和镜头稿一致。',
      props.length > 0
        ? `${props.join('、')}：只在剧情需要的位置出现，状态承接源镜头，不新增无关道具。`
        : '',
    ].filter(Boolean),
    lightingLine: field(first, '光影') || '主光按场景既有光源方向落在动作主体上；副光克制；保留面部、手部和关键道具高光。',
  }
}

function shotCameraLine(shot: ShotSheetShot): string {
  const shotType = [field(shot, '景别') || '中景', field(shot, '机位') || '平视'].filter(Boolean).join('，')
  const cameraMove = field(shot, '运镜') || '固定'
  const focusTarget = field(shot, '角色') || field(shot, '画面') || '动作主体'
  return `${shotType}，${cameraMove}，标准 50mm，浅景深焦在${truncateText(focusTarget, 24)}，常速，稳定器固定。镜头从源镜头 ${shot.code} 的起始构图进入，保持人物站位和视线方向，跟随核心动作推进，最后落到该镜头的情绪或动作结果。`
}

function shotFrameLine(shot: ShotSheetShot): string {
  const picture = field(shot, '画面') || `${shot.code} 的画面主体按镜头稿执行`
  const action = field(shot, '动作')
  const expression = field(shot, '微表情')
  const dialogue = normalizeDialogue(shot.fields['对白/字幕'])
  return [
    picture,
    action ? `动作：${action}` : '',
    expression ? `微表情：${expression}` : '',
    dialogue ? `对白/声音：${dialogue}` : '',
  ].filter(Boolean).join('；')
}

function shotLightingLine(shot: ShotSheetShot): string {
  const light = field(shot, '光影')
  if (light) return `${light}；主光方向、色温和前后镜保持一致；阴影服务情绪，不压丢关键表情和道具信息。`
  return '主光来自场景既有光源，照亮动作主体；无多余炫光；保持角色面部、手部和关键道具清晰。'
}

function shotAudioLines(shot: ShotSheetShot): string[] {
  const lines: string[] = []
  const dialogue = normalizeDialogue(shot.fields['对白/字幕'])
  const sound = field(shot, '声音/剪辑')
  if (dialogue) lines.push(dialogue.includes('：') ? dialogue : `<${dialogue}>`)
  if (sound) lines.push(...sound.split(/[；;]/).map((item) => `<${compact(item)}>`).filter((item) => item !== '<>'))
  return lines
}

function buildShotSheetSegmentText(blockNumber: number, segmentId: string, group: ShotSheetShot[]): string {
  const durationSeconds = groupDurationSeconds(group)
  const first = group[0]
  const characters = unique(group.flatMap((shot) => [
    ...parseCharacters(shot.fields['角色'] || ''),
    ...shot.scene.characters,
  ])).map((name) => ({ name }))
  const props = inferShotProps(group).map((name) => ({ name }))
  const assets: PreciseSegmentAssets = {
    characters,
    props,
    environment: first.scene.heading,
  }
  const sourceText = group.map((shot) => field(shot, '动作') || field(shot, '画面') || shot.code).filter(Boolean).join('；')
  return buildPreciseSegmentVideoPrompt({
    segmentId,
    location: first.scene.heading,
    functionLabel: `镜头稿片段 ${blockNumber}`,
    sourceText,
    assets,
    outputParams: {
      durationSeconds,
    },
    openingState: buildShotSheetOpeningState(group, assets),
    shots: group.map((shot, index) => ({
      shotNumber: index + 1,
      durationSeconds: Math.max(1, shot.durationSeconds),
      cameraLine: shotCameraLine(shot),
      frameLine: shotFrameLine(shot),
      lightingLine: shotLightingLine(shot),
      audioLines: shotAudioLines(shot),
    })),
  })
}

export function buildVideoPromptBlocks(text: string): VideoPromptBlock[] {
  const shots = parseShotSheetText(text)
  const sceneCounters = new Map<string, number>()
  return groupShotsForVideoPrompts(shots).map((group, index) => {
    const first = group[0]
    const sceneId = first.scene.sceneId
    const next = (sceneCounters.get(sceneId) || 0) + 1
    sceneCounters.set(sceneId, next)
    const segmentId = buildSegmentId(sceneId, next)
    return {
      blockNumber: index + 1,
      segmentId,
      shots: group,
      durationSeconds: groupDurationSeconds(group),
      text: buildShotSheetSegmentText(index + 1, segmentId, group),
    }
  })
}

export function buildShortDramaVideoPromptText(text: string): string {
  const shots = parseShotSheetText(text)
  if (shots.length === 0) {
    throw new Error('No SH shots found in story document')
  }
  return buildVideoPromptBlocks(text).map((block) => block.text).join('\n\n')
}

function detectVideoRatio(input: string): '9:16' | '16:9' | '1:1' {
  if (/(16\s*[:：]\s*9|横屏|landscape)/i.test(input)) return '16:9'
  if (/(1\s*[:：]\s*1|方形|square)/i.test(input)) return '1:1'
  return '9:16'
}

function stripPromptInstructions(input: string): string {
  return input
    .replace(/请用\s*Agent\s*自动创作模式生成[^。.\n]*[。.\n]?/gi, '')
    .replace(/工作流必须[^。.\n]*[。.\n]?/g, '')
    .replace(/每个视频分镜[^。.\n]*[。.\n]?/g, '')
    .replace(/不要中文字幕[^。.\n]*[。.\n]?/g, '')
    .replace(/不要背景音乐[^。.\n]*[。.\n]?/g, '')
    .trim()
}

export function parseShortDramaBrief(input: string): ShortDramaBrief | null {
  const text = input.replace(/\r\n/g, '\n').trim()
  if (!text) return null
  const hasBriefSignals = /角色资产[:：]/.test(text)
    && /(短剧|转绘|真人|口型|镜头语言|按秒拆分|人物站位|分镜|Shot|视频提示词)/.test(text)
  if (!hasBriefSignals) return null

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const roleAssets: ShortDramaRoleAsset[] = []
  let activeRole: ShortDramaRoleAsset | null = null
  let roleSectionStarted = false
  let lastRoleLineIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^角色资产[:：]?$/.test(line) || line.includes('角色资产：')) {
      roleSectionStarted = true
      continue
    }
    if (!roleSectionStarted) continue
    if (/^(剧情|故事|简短剧情|故事梗概|故事压缩节拍|风格|风格要求|要求|工作流|每个视频分镜)[:：]/.test(line)) {
      activeRole = null
      continue
    }
    const roleMatch = line.match(/^([A-Za-z][A-Za-z.\s-]{1,50}|[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z.\s-]{1,50})[:：]\s*(.+)$/)
    if (roleMatch && !/^(剧情|故事|风格|要求|工作流|每个视频分镜)[:：]/.test(line)) {
      activeRole = {
        name: compact(roleMatch[1]),
        description: compact(roleMatch[2]),
      }
      roleAssets.push(activeRole)
      lastRoleLineIndex = index
      continue
    }
    if (activeRole && !/^(剧情|故事|风格|要求)[:：]/.test(line)) {
      activeRole.description = compact(`${activeRole.description}${line}`)
      lastRoleLineIndex = index
    }
  }

  if (roleAssets.length === 0) return null

  const explicitStory = text.match(/(?:剧情|故事|简短剧情|故事梗概)[:：]\s*([\s\S]+)$/)
  const storyCandidate = explicitStory?.[1]
    || lines.slice(lastRoleLineIndex + 1).join('\n')
    || ''
  const storyText = stripPromptInstructions(storyCandidate)
    .replace(/^和一个简短的剧情[，,：:]?/u, '')
    .trim()
  if (!storyText) return null

  return {
    roleAssets,
    storyText,
    ratio: detectVideoRatio(text),
    styleText: /医疗|医院|doctor|hospital|surgeon/i.test(text)
      ? '欧美医疗短剧，真实真人质感，现代美国私立医院环境，冷白顶灯，英文导视标识，情绪强烈但表演不过度夸张'
      : '真人短剧质感，真实摄影，节奏紧凑，情绪明确，角色脸部和服装全程一致',
    noMusic: /不要背景音乐|禁止生成背景音乐|no\s*music/i.test(text),
    noSubtitles: /不要中文字幕|不要字幕|no\s*subtitle/i.test(text),
    isMedical: /医疗|医院|手术|doctor|hospital|surgeon/i.test(text),
  }
}

export function splitShortDramaBriefBeats(storyText: string): string[] {
  const numberedShotBeats = storyText
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((line) => compact(line))
    .filter((line) => /^\d+[.、]\s*SH\d{3}\s*[-—~至到]\s*SH\d{3}/i.test(line))
  if (numberedShotBeats.length > 0) {
    return numberedShotBeats.slice(0, 15)
  }

  const normalized = storyText
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])\s*/u))
    .map((line) => compact(line))
    .filter((line) => line && !/^[-*•]/.test(line))
    .filter((line) => !/^(故事压缩节拍|角色资产|风格要求|工作流必须|每个视频分镜)[:：]/.test(line))

  if (normalized.length <= 1) return normalized
  const beats: string[] = []
  let buffer = ''
  for (const sentence of normalized) {
    const next = buffer ? `${buffer}${sentence}` : sentence
    if (Array.from(next).length < 34 && normalized.length > 6) {
      buffer = next
      continue
    }
    beats.push(next)
    buffer = ''
  }
  if (buffer) beats.push(buffer)
  return beats.slice(0, 15)
}

function buildBriefScene(brief: ShortDramaBrief): string {
  if (brief.isMedical) {
    return '现代美国私立医院'
  }
  return '核心短剧场景'
}

function buildBriefSceneOpening(brief: ShortDramaBrief, scene: string): string {
  if (brief.isMedical) {
    return `${scene}，白色墙面配浅蓝色导视线，冷白 LED 顶灯，英文门牌、手术室门、等待区椅子和金属扶手保持一致<环境底噪、脚步声、衣料摩擦声>。`
  }
  return `${scene}，真实短剧空间，环境光线、色调、道具和角色站位按剧情保持一致<环境声、脚步声、衣料摩擦声和必要道具声>。`
}

function inferBeatDuration(beat: string): number {
  const charCountValue = Array.from(beat).length
  if (/[“”"].+?[“”"]|:.+/.test(beat) || charCountValue > 52) return 10
  if (charCountValue > 34) return 8
  return 6
}

function selectBriefRolesForBeat(brief: ShortDramaBrief, beat: string): ShortDramaRoleAsset[] {
  const matched = brief.roleAssets.filter((role) => {
    const escapedName = role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escapedName}\\b`, 'i').test(beat)
  })
  return matched.length > 0 ? matched : brief.roleAssets
}

function stripBeatLabels(beat: string): string {
  let text = compact(beat)
    .replace(/^[△›\s]+/g, '')
    .replace(/^第[一二三四五六七八九十\d]+集(?:开场)?[:：]\s*/g, '')

  const labels = [
    '开场钩子',
    '建立情境',
    '推进信息',
    '制造冲突',
    '情绪承载',
    '交代行动',
    '反转钩子',
    '剧情推进',
    '情绪爆点',
    '转场',
    '镜头特写',
    '镜头切换',
    '场景',
    '人物',
  ]
  let changed = true
  while (changed) {
    changed = false
    text = text.replace(/^第[一二三四五六七八九十\d]+集(?:开场)?[:：]\s*/g, '')
    for (const label of labels) {
      if (text.startsWith(`${label}：`) || text.startsWith(`${label}:`)) {
        text = text.slice(label.length + 1).trim()
        changed = true
      }
    }
  }
  return text
}

function cleanDialogueSnippet(value: string | undefined): string {
  return compact(value || '')
    .replace(/^["“”「『]+/g, '')
    .replace(/["“”」』]+$/g, '')
}

function extractDialogueSnippets(beat: string): string[] {
  const snippets: string[] = []
  const text = stripBeatLabels(beat)
  const labelLike = new Set([
    '开场钩子',
    '建立情境',
    '推进信息',
    '制造冲突',
    '情绪承载',
    '交代行动',
    '反转钩子',
    '剧情推进',
    '情绪爆点',
    '视频提示词',
    '开场状态',
    '环境',
    '站位关系',
    '灯光',
    '镜头特写',
    '镜头切换',
    '场景',
    '人物',
  ])

  const quoteMatches = text.matchAll(/["“]([^"”]{1,120})["”]/g)
  for (const match of quoteMatches) {
    const cleaned = cleanDialogueSnippet(match[1])
    if (cleaned && !snippets.includes(cleaned)) snippets.push(cleaned)
  }

  for (const rawLine of beat.replace(/\r\n/g, '\n').split('\n')) {
    let line = rawLine
      .replace(/^[△›\s]+/g, '')
      .trim()
    for (const label of labelLike) {
      if (line.startsWith(`${label}：`) || line.startsWith(`${label}:`)) {
        line = line.slice(label.length + 1).trim()
        break
      }
    }
    const match = line.match(/^([A-Z][A-Za-z. ]{0,40}|[\u4e00-\u9fa5]{1,8})(?:[（(][^）)]{0,30}[）)])?[:：]\s*(.+)$/)
    if (!match) continue
    const speaker = compact(match[1])
    if (!speaker || labelLike.has(speaker) || /^第[一二三四五六七八九十\d]+集/.test(speaker)) continue
    const cleaned = cleanDialogueSnippet(match[2])
    if (cleaned && !snippets.includes(cleaned)) snippets.push(cleaned)
  }
  return snippets.slice(0, 4)
}

function splitDurationForInternalShots(duration: number, count: number, weights?: number[]): number[] {
  const safeDuration = Math.max(2, duration)
  const safeCount = Math.max(1, count)
  if (weights?.length === safeCount && weights.every((item) => item > 0)) {
    const totalWeight = weights.reduce((sum, item) => sum + item, 0)
    let remaining = safeDuration
    return weights.map((weight, index) => {
      const value = index === weights.length - 1
        ? remaining
        : Math.max(0.5, Math.round((safeDuration * weight / totalWeight) * 10) / 10)
      remaining = Math.max(0, Math.round((remaining - value) * 10) / 10)
      return Math.max(0.5, value)
    })
  }
  const base = safeDuration / safeCount
  return Array.from({ length: safeCount }, (_, index) => {
    const value = index === safeCount - 1
      ? safeDuration - base * (safeCount - 1)
      : base
    return Math.max(1, Math.round(value * 10) / 10)
  })
}

function inferShotCount(duration: number, beat: string, propCount: number): number {
  const complex = Array.from(beat).length > 60 || /[“”":：]/.test(beat) || propCount > 0
  if (duration <= 6 && !complex) return 3
  if (duration >= 12) return 5
  if (duration >= 9 || complex) return 4
  return 3
}

type CinematicEnvironmentProfile = {
  atmosphereLine: string
  keyLightLine: string
  fillLightLine: string
  contrastLine: string
  textureLine: string
  audioLines: string[]
}

type CinematicShotDraft = {
  camera: string
  frame: string
  lighting: string
  audio: string[]
  weight?: number
}

function buildEnvironmentProfile(location: string, beat: string): CinematicEnvironmentProfile {
  const source = `${location}\n${beat}`
  if (/柴房|张秃子|银簪|暴雨|药效|油灯/.test(source)) {
    return {
      atmosphereLine: '夜，密集暴雨压在破旧木屋顶上，空气潮湿发霉，暖黄油灯和窗外冷青闪电形成压迫感',
      keyLightLine: '破旧油灯暖黄主光 2700K 从画面侧前方斜切，火苗轻微跳动造成不稳定硬光',
      fillLightLine: '窗外雨夜冷青闪电 6500K 只在关键瞬间短促补边，平时几乎无副光',
      contrastLine: 'key:fill 约 10:1，阴影占画面约 75%-85%，暗部压得很深但保留眼神、汗珠和银簪高光',
      textureLine: '潮湿木地板、霉斑墙面、冷汗、衣料湿痕、手臂淤青和银簪冷光必须清楚可见',
      audioLines: ['<密集的暴雨砸屋顶声>', '<远处惊雷声>', '<破旧木门轻微吱呀声>'],
    }
  }
  if (/土地庙|庙|追兵|火把|雨夜|靴子/.test(source)) {
    return {
      atmosphereLine: '夜，城郊破庙被暴雨包围，庙内冷青潮气和庙外火把暖光交替逼近',
      keyLightLine: '庙外火把暖橙主光 2200K 从门缝和窗棂切入，光线随脚步摇晃',
      fillLightLine: '雨夜冷青环境光 6500K 从破窗漫入，泥水反光提供极弱下方补光',
      contrastLine: 'key:fill 约 8:1，阴影占画面约 70%-80%，佛龛、墙皮和人物脸部保留必要轮廓',
      textureLine: '斑驳神像、脱落墙皮、积水泥脚印、湿发、手心血痕和银簪边缘冷光要有真实质感',
      audioLines: ['<庙檐雨水连成线落下>', '<远处追兵脚步和火把噼啪声>', '<湿衣料贴着皮肤的摩擦声>'],
    }
  }
  if (/医院|手术|病房|走廊|ICU|护士|医生|Ava|Dr\./i.test(source)) {
    return {
      atmosphereLine: '现代美国私立医院，冷白顶灯、浅蓝导视线和英文标识形成克制、紧张的医疗短剧质感',
      keyLightLine: '冷白 LED 顶灯 5600K 作为主光，稳定照亮脸部轮廓和文件道具',
      fillLightLine: '玻璃门和白墙反射形成低强度冷色补光，背景英文标识不过度抢戏',
      contrastLine: 'key:fill 约 4:1，阴影占画面约 35%-45%，保持真实医院清洁质感',
      textureLine: '白大褂布料、金属扶手、文件纸张边缘、眼眶泪光和消毒环境的冷硬质感清晰',
      audioLines: ['<医院走廊低频环境底噪>', '<远处护士站呼叫声>', '<鞋底踩过医院地面的轻响>'],
    }
  }
  return {
    atmosphereLine: `${location}，按剧情建立真实可拍空间，空气、地面、入口方向和背景层次都服务本段冲突`,
    keyLightLine: '场景内既有实用光作为主光，稳定落在动作主体、眼神和关键道具上',
    fillLightLine: '环境反射光作为弱副光，只保留必要轮廓，不破坏戏剧性阴影',
    contrastLine: 'key:fill 约 6:1，阴影占画面约 55%-70%，高光不过曝，暗部不脏',
    textureLine: '衣料褶皱、皮肤细节、道具磨损、地面材质和背景空间线索保持真实',
    audioLines: ['<环境底噪>', '<衣料摩擦声>', '<轻微脚步声>'],
  }
}

function inferBeatArchetype(beat: string, location: string): string {
  const source = stripBeatLabels(`${location} ${beat}`)
  if (/木门.*踹|踹开|靴子|门口/.test(source)) return 'doorReveal'
  if (/追兵|火把|放火|脚步声|呼喊/.test(source)) return 'pursuitThreat'
  if (/土地庙|靠墙|喘气|发抖|眼泪|躲藏|缩到角落/.test(source)) return 'hidingBreath'
  if (/冲进|跑|逃|拉开木门|雨幕|瓢泼大雨/.test(source)) return 'escapeRain'
  if (/银簪|拔下|摸出|刺|攥紧|划伤/.test(source)) return 'weaponStrike'
  if (/醒来|睁开|惊恐|药效|浑身无力|发软/.test(source)) return 'druggedAwakening'
  if (/放开|不伺候|不算数|就算死|恶魔/.test(source)) return 'defiantDialogue'
  if (/抓住|手腕|狞笑|酒气|逼近|扑来/.test(source)) return 'threatApproach'
  if (/请求|Please|doctor|surgery|手术|安排|文件|医院|Dr\./i.test(source)) return 'medicalRequest'
  return 'dramaticBeat'
}

function primaryActionFragments(beat: string): string[] {
  const withoutDialogue = stripBeatLabels(beat)
    .replace(/["“][^"”]+["”]/g, '')
    .replace(/[()（）][^()（）]{0,40}[)）]/g, '')
  return withoutDialogue
    .split(/[。！？!?；;]+|(?<=，)/u)
    .map((item) => compact(item.replace(/[，,]$/g, '')))
    .filter((item) => item && !/^第[一二三四五六七八九十\d]+集/.test(item))
    .slice(0, 6)
}

function firstCharacterName(names: string[]): string {
  return names[0] || '主体角色'
}

function secondCharacterName(names: string[]): string {
  return names[1] || '对手角色'
}

function buildDialogueLine(dialogueInstruction: string | undefined, beat: string): string {
  const provided = compact(dialogueInstruction)
  if (provided && (!/^如本片段需要台词/.test(provided) || /英文口型同步/i.test(provided))) return provided
  const snippets = extractDialogueSnippets(beat)
  return snippets.length > 0 ? snippets.map((item) => `口型同步，说：${item}`).join('；') : ''
}

function soundLines(profile: CinematicEnvironmentProfile, ...extra: string[]): string[] {
  return [...extra, ...profile.audioLines].filter(Boolean).slice(0, 4)
}

function buildCinematicDrafts(params: {
  beat: string
  location: string
  characterNames: string[]
  propNames: string[]
  dialogueInstruction?: string
}): CinematicShotDraft[] {
  const actorText = params.characterNames.join('、') || '主体角色'
  const primary = firstCharacterName(params.characterNames)
  const opposite = secondCharacterName(params.characterNames)
  const propText = params.propNames.join('、')
  const propFocus = propText || '关键道具'
  const beatSummary = summarizeVideoPromptBeat(stripBeatLabels(params.beat), 150)
  const fragments = primaryActionFragments(params.beat)
  const actionA = fragments[0] || beatSummary
  const actionB = fragments[1] || actionA
  const dialogue = buildDialogueLine(params.dialogueInstruction, params.beat)
  const profile = buildEnvironmentProfile(params.location, params.beat)
  const archetype = inferBeatArchetype(params.beat, params.location)

  if (archetype === 'druggedAwakening') {
    return [
      {
        camera: `大特写，低角度仰拍，固定，长焦 100mm，浅景深焦在${primary}的双眼，常速，手持微抖。镜头从一片失焦黑暗里猛地拉清，最后落到瞳孔骤然收缩的惊恐定格。`,
        frame: `${primary}闭着眼眉头紧锁，随即猛地睁开；瞳孔倒映出摇晃油灯，鼻翼因为倒抽冷气而扩张，额头冷汗沿鬓角滑落，下颌咬肌无意识发颤。`,
        lighting: `${profile.keyLightLine}；${profile.fillLightLine}；${profile.contrastLine}`,
        audio: soundLines(profile, '<急促吸气声>'),
        weight: 1,
      },
      {
        camera: `特写，高角度俯拍，固定，中长焦 85mm，浅景深焦在${primary}试图发力的手臂和衣袖，常速，稳定器固定。焦点从虚化下颌滑到手臂，最后落到无力砸回地面的手背。`,
        frame: `${primary}肩膀极力想抬起却只带动衣领剧烈起伏；手指在潮湿地面抓挠半寸又泄力，手腕颤了几下后整条手臂沉重滑落；${profile.textureLine}`,
        lighting: `暖黄顶侧光压出手臂和衣料湿痕，地面暗部近乎吞没；${profile.contrastLine}`,
        audio: soundLines(profile, '<衣物摩擦的窸窣声>', '<手背碰到潮湿木地板的闷响>'),
        weight: 1,
      },
      {
        camera: `中景，略高角度俯拍，缓慢上摇并微推，标准 50mm，中景深保留半身和墙角空间，常速，稳定器固定。镜头从手背起，上摇到${primary}半躺瘫坐的全身。`,
        frame: `${primary}靠在${params.location}角落，衣领和肩部被冷汗浸透；她努力甩开昏沉却只偏头半寸，眼神从游移突然定住，强行把慌乱压回胸口。`,
        lighting: `高反差侧逆光勾出湿发、下颌和衣领轮廓；${profile.fillLightLine}；${profile.contrastLine}`,
        audio: soundLines(profile, '<压抑的喘息声>'),
        weight: 1.1,
      },
      {
        camera: `特写，平视，缓慢推近，长焦 100mm，浅景深焦在眉心并逐步移到${propFocus}，常速，稳定器固定。镜头从惊恐眼神推到发髻或手部的细小高光。`,
        frame: `${primary}眼眶泛红，呼吸停住半秒后更急；${propText ? `${propText}在细微晃动中闪出一线冷光，像突然被记起的求生机会；` : '视线扫过可触达的关键物，意识到还有一线反抗机会；'}情绪从惊惧转向强忍。`,
        lighting: `伦勃朗式暖黄硬光在脸颊形成倒三角高光，${propFocus}保留锐利点状反光；${profile.contrastLine}`,
        audio: dialogue ? [dialogue, ...profile.audioLines.slice(0, 2)] : soundLines(profile, '<短促吞咽声>'),
        weight: 1.1,
      },
      {
        camera: `特写，平视，固定，长焦 100mm，浅景深焦在油灯火苗或${propFocus}反光，常速，稳定器固定。镜头从道具冷光切到摇晃光源，最后落到几乎熄灭又挣扎燃起的火舌。`,
        frame: `破旧油灯在穿堂冷风里剧烈摇晃，墙面光影狂乱舞动；${primary}的呼吸和眼神在暗处被压低，画面结尾用一小点高光保留下一段危险入口。`,
        lighting: `油灯自身 2700K 成为画面核心光源，闪电 6500K 短促打亮背景木纹；${profile.contrastLine}`,
        audio: soundLines(profile, '<油灯火苗噼啪声>'),
        weight: 0.8,
      },
    ]
  }

  if (archetype === 'threatApproach') {
    return [
      {
        camera: `近景，低角度平视，固定，标准 50mm，浅景深焦在油灯或门口阴影，常速，稳定器固定。镜头从摇晃光源起，一个巨大黑影突然撞入前景遮住光。`,
        frame: `油灯火苗剧烈歪斜，${opposite}的身躯或手臂挤入画面，酒气和汗光形成压迫感；他的脚步向${primary}逼近，地面湿痕被踩出暗色印记。`,
        lighting: `${profile.keyLightLine}从背后勾出${opposite}边缘轮廓，正面几乎成剪影；${profile.contrastLine}`,
        audio: soundLines(profile, '<沉重踉跄的脚步声>', '<粗粝喘息声>'),
        weight: 0.9,
      },
      {
        camera: `中近景，低角度仰拍，缓慢后退跟拍，中长焦 85mm，浅景深焦在${opposite}面部，常速，手持微抖。镜头随着逼近一步步后退，最后钉在狞笑嘴角。`,
        frame: `${opposite}满脸狞笑，脸颊因酒气发红，喉结滚动，眼神死锁${primary}；${actionA}，动作带着压倒性的身体优势。`,
        lighting: `顶侧硬光压进眼窝，汗珠和下颌边缘出现油亮高光；${profile.fillLightLine}；${profile.contrastLine}`,
        audio: dialogue ? [dialogue, ...profile.audioLines.slice(0, 2)] : soundLines(profile, '<压低的恶意笑声>'),
        weight: 1,
      },
      {
        camera: `全景，高角度俯拍，固定，广角 35mm，深景深保留强弱关系，常速，稳定器固定。镜头把${opposite}的阴影和${primary}的退缩放在同一空间里。`,
        frame: `${primary}向后蜷缩，手掌撑在潮湿地面却滑开；${opposite}的影子压过她半个身体，双方距离被清楚交代，强弱悬殊一眼可见。`,
        lighting: `侧逆光把${primary}脸部和手指勾出细窄边缘，${opposite}阴影覆盖下半画面；${profile.contrastLine}`,
        audio: soundLines(profile, '<衣物拖过地面的沙沙声>'),
        weight: 1.1,
      },
      {
        camera: `中景，高角度过肩，从${opposite}肩后看向${primary}，缓慢下压推近，中长焦 85mm，浅景深焦在${primary}脸部。`,
        frame: `${opposite}的肩背在前景形成暗框，${primary}后背抵住墙根，眼睫剧烈颤动，嘴唇发白，仍试图把恐惧压住。`,
        lighting: `前景暗框挡住大半主光，${primary}瞳孔里只剩细小暖黄高光；${profile.contrastLine}`,
        audio: soundLines(profile, '<贴墙急促喘息声>'),
        weight: 1,
      },
      {
        camera: `大特写，低角度仰拍，急推后急停，长焦 100mm，浅景深焦在${opposite}嘴部和下颌，常速，稳定器固定。`,
        frame: `${opposite}的嘴角不对称地扯开，牙关半张，酒气几乎喷到镜头；脸部肌肉因兴奋微微抽搐，最后落到充满恶意的眼神。`,
        lighting: `底侧反打让眉骨和鼻头投下畸形阴影，冷青闪电短促擦过背景；${profile.contrastLine}`,
        audio: dialogue ? [dialogue] : soundLines(profile, '<压迫性的低笑声>'),
        weight: 0.9,
      },
    ]
  }

  if (archetype === 'defiantDialogue' || archetype === 'weaponStrike' || archetype === 'escapeRain') {
    const isWeapon = archetype === 'weaponStrike'
    const isEscape = archetype === 'escapeRain'
    return [
      {
        camera: `特写，平视，固定，长焦 100mm，浅景深焦在${primary}手腕、指节或${propFocus}，常速，稳定器固定。镜头从受力点起，捕捉肌肉绷紧的瞬间。`,
        frame: isWeapon
          ? `${primary}的手指摸向发髻或掌心，攥住${propFocus}；指腹发白，银色冷光从指缝闪出，反抗动作开始。`
          : `${primary}缩手蜷身却没有完全退让，手指死死扣住地面或衣角；${actionA}，恐惧下面压着一股硬撑的狠劲。`,
        lighting: `${profile.keyLightLine}压在手部和道具边缘，${propFocus}出现针尖般高光；${profile.contrastLine}`,
        audio: soundLines(profile, propText ? `<${propFocus}划过发丝或掌心的细响>` : '<指甲刮过地面的细响>'),
        weight: 0.9,
      },
      {
        camera: `近景，平视或轻微仰拍，缓慢推近，中长焦 85mm，浅景深焦在${primary}脸部，常速，手持微抖。镜头跟随她从颤抖到开口。`,
        frame: `${primary}眼眶泛红，声音发颤但咬字越来越硬；${dialogue ? `她按“${dialogue}”完成口型和情绪爆发；` : `${actionB}；`}说完后下颌仍在抖，却没有移开视线。`,
        lighting: `暖黄主光切过半张脸，另一半沉入冷青阴影，情绪对抗清晰；${profile.contrastLine}`,
        audio: dialogue ? [dialogue, ...profile.audioLines.slice(0, 2)] : soundLines(profile, '<颤抖但压低的呼吸声>'),
        weight: 1,
      },
      {
        camera: isEscape
          ? `中景，侧后方跟拍，标准 50mm，中景深，常速转急促，手持微抖。镜头跟着${primary}扑向木门或雨幕，最后被雨水打湿前景。`
          : `中近景，斜侧低角度，快速横移并急停，标准 50mm，浅景深焦在双方手臂交错处，常速，稳定器固定。`,
        frame: isEscape
          ? `${primary}踉跄拉开门，冷雨瞬间灌入室内；她一手护住${propFocus}，一手推门，身体被雨夜吞进去半边。`
          : isWeapon
            ? `${opposite}扑来，${primary}侧身躲开，${propFocus}从画面下方斜刺进手臂方向；动作有准备、发力、命中三个清楚节点，不夸张血腥。`
            : `${opposite}的手臂压入画面，${primary}猛地抽回手腕，双方距离在半秒内拉开又被压近，冲突升级。`,
        lighting: `动作路径上保留暖黄拖影和冷青边缘光，关键接触点清楚；${profile.contrastLine}`,
        audio: soundLines(profile, isEscape ? '<木门被猛地拉开的吱呀声>' : '<衣料撕扯声>', isWeapon ? `<${propFocus}刺入衣料的短促钝响>` : ''),
        weight: 1.2,
      },
      {
        camera: `特写，平视，固定或轻微推近，长焦 100mm，浅景深焦在动作结果，常速，稳定器固定。`,
        frame: isEscape
          ? `雨水砸在${primary}脸上，她短暂清醒，回头的眼神被冷雨和暖光切成两半；${propFocus}仍在手心，状态连续可追踪。`
          : isWeapon
            ? `${opposite}疼痛后猛地缩手，${primary}手心被${propFocus}硌出红痕却没有松开；她的眼神第一次从恐惧变成求生。`
            : `${primary}说完后胸口剧烈起伏，眼神仍死盯${opposite}；${propFocus}在可触达位置闪出提示性的冷光。`,
        lighting: `特写高光落在眼神、嘴角、指节和${propFocus}边缘；${profile.fillLightLine}；${profile.contrastLine}`,
        audio: soundLines(profile, '<短促喘息声>'),
        weight: 1,
      },
      {
        camera: `中景，背向或侧向构图，轻微后拉，标准 50mm，中景深保留下一段入口方向，常速，稳定器固定。`,
        frame: isEscape
          ? `${primary}冲进雨幕，身影被雨线切碎；门内暖光和门外冷青雨夜形成清楚转场，结尾留给追赶方向。`
          : `${primary}和${opposite}的站位重新拉开，${propFocus}保持在画面可追踪位置；结尾用视线或身体重心指向下一步逃跑/反扑。`,
        lighting: `前一镜光线方向延续，背景空间重新可读，结尾不过度黑场；${profile.contrastLine}`,
        audio: soundLines(profile, isEscape ? '<雨声瞬间放大>' : '<环境声延续>'),
        weight: 0.9,
      },
    ]
  }

  if (archetype === 'hidingBreath' || archetype === 'pursuitThreat' || archetype === 'doorReveal') {
    const isPursuit = archetype === 'pursuitThreat'
    const isReveal = archetype === 'doorReveal'
    return [
      {
        camera: `全景，低机位平视，固定，广角 35mm，深景深保留${params.location}空间，常速，稳定器固定。镜头从破败环境起，最后找到${primary}的位置。`,
        frame: `${params.location}里积水、墙皮和暗处神像形成压迫背景；${primary}贴着冷墙或缩在角落，湿发黏在脸侧，${propText ? `${propText}被攥在手里；` : ''}${actionA}`,
        lighting: `${profile.keyLightLine}；${profile.fillLightLine}；${profile.contrastLine}`,
        audio: soundLines(profile),
        weight: 1,
      },
      {
        camera: `特写，微俯拍，固定，长焦 100mm，浅景深焦在手心、膝盖或${propFocus}，常速，稳定器固定。`,
        frame: `${primary}的指节因用力而发白，掌心细小伤口和雨水混在一起；${propFocus}贴着皮肤，既是防身物也是情绪锚点。`,
        lighting: `冷青环境光压低肤色，火把或实用光只在${propFocus}边缘留一点暖色反光；${profile.contrastLine}`,
        audio: soundLines(profile, '<压抑的颤抖呼吸声>'),
        weight: 0.9,
      },
      {
        camera: isReveal
          ? `中景，对门口低角度固定，标准 50mm，中景深，常速，稳定器固定。镜头锁住门缝，等待外部力量闯入。`
          : `中近景，窗棂或门缝主观视角，缓慢推近，中长焦 85mm，浅景深焦在外部火光或脚步阴影。`,
        frame: isReveal
          ? `木门猛地震动，尘土和雨水从门缝落下；下一秒门被踹开，刺眼火把光切进黑暗，先露出泥泞靴子而不是脸。`
          : isPursuit
            ? `庙外火把光一格一格扫过窗棂，追兵脚步和呼喊逼近；${primary}在暗处屏住呼吸，眼神跟着光线移动。`
            : `外部声音忽远忽近，破门和雨声把空间压得更窄；${primary}身体蜷得更紧，视线不敢离开入口。`,
        lighting: `火把暖橙 2200K 切出移动光栅，冷青雨夜填满暗部；${profile.contrastLine}`,
        audio: soundLines(profile, isReveal ? '<木门被猛地踹开的巨响>' : '<追兵呼喊声由远及近>'),
        weight: 1.1,
      },
      {
        camera: `近景，平视，缓慢推近，长焦 100mm，浅景深焦在${primary}脸部，常速，手持微抖。`,
        frame: `${primary}眼泪和雨水混在一起，嘴唇发白，瞳孔被火光突然照亮；她没有松开${propFocus}，绝望和求生同时压在眼神里。`,
        lighting: `火把暖光扫过脸部后迅速离开，只留下冷青阴影；眼眶、鼻尖和${propFocus}保留锐利高光；${profile.contrastLine}`,
        audio: soundLines(profile, dialogue || '<急促吸气声>'),
        weight: 1,
      },
      {
        camera: `大特写或低角度特写，固定，长焦 100mm，浅景深焦在门口靴子、火把边缘或${primary}瞳孔反光，常速，稳定器固定。`,
        frame: isReveal
          ? `泥泞靴子停在门口，雨水从鞋边滴落；画面只给出威胁的局部，不揭示完整身份，结尾卡在${primary}被刺眼火光逼到眯眼的瞬间。`
          : `火光在${primary}瞳孔里晃动，外部威胁还未完全进入画面；结尾留给门口方向，形成下一段钩子。`,
        lighting: `局部高光极亮但不过曝，周围暗部保持压迫；${profile.contrastLine}`,
        audio: soundLines(profile, '<火把噼啪声>', '<雨水滴在泥地上的声音>'),
        weight: 0.9,
      },
    ]
  }

  if (archetype === 'medicalRequest') {
    return [
      {
        camera: `中景，平视，固定，标准 50mm，中景深保留医院走廊和双方距离，常速，稳定器固定。镜头从英文导视牌和冷白顶灯起，落到${actorText}的站位关系。`,
        frame: `${actorText}站在${params.location}的冷白空间里；${propText ? `${propText}被拿在胸前或垂在手边；` : ''}${actionA}，紧张关系先被清楚建立。`,
        lighting: `${profile.keyLightLine}；${profile.fillLightLine}；${profile.contrastLine}`,
        audio: soundLines(profile),
        weight: 1,
      },
      {
        camera: `近景，轻微越肩，缓慢推近，中长焦 85mm，浅景深焦在说话者脸部，常速，稳定器固定。`,
        frame: `${primary}抬头，眼眶湿润但强撑镇定；${dialogue ? `按“${dialogue}”完成自然口型和停顿；` : `${actionB}；`}听者保持克制反应。`,
        lighting: `冷白主光压出眼下疲惫和泪光，背景英文标识虚化；${profile.contrastLine}`,
        audio: dialogue ? [dialogue, ...profile.audioLines.slice(0, 2)] : soundLines(profile, '<轻微吸气声>'),
        weight: 1.1,
      },
      {
        camera: `特写，微俯拍，固定，长焦 100mm，浅景深焦在${propFocus}或手部动作，常速，稳定器固定。`,
        frame: `${propFocus}边缘、手指颤动和文件纸张纹理被放大；动作结果必须清楚，不能只停留在静态摆拍。`,
        lighting: `冷白灯在纸张和金属扶手上形成硬边高光，手部阴影不过黑；${profile.contrastLine}`,
        audio: soundLines(profile, `<${propFocus}轻微翻动声>`),
        weight: 0.9,
      },
      {
        camera: `近景反打，平视，固定或轻微推近，中长焦 85mm，浅景深焦在听者微表情，常速，稳定器固定。`,
        frame: `${opposite}冷静听完，眼神有一瞬间变化但身体不动；${primary}在虚化前景中等待回应，情绪悬着不落。`,
        lighting: `顶灯让脸部轮廓清楚，副光克制，背景保持医疗空间可信；${profile.contrastLine}`,
        audio: soundLines(profile, '<医院远处提示音>'),
        weight: 1,
      },
    ]
  }

  return [
    {
      camera: `中景，平视，固定，标准 50mm，中景深保留角色与环境关系，常速，稳定器固定。镜头从${params.location}的空间关系起，落到${actorText}的起始动作。`,
      frame: `${actorText}处在剧情压力中心；${actionA}；身体姿态、视线方向和${propText ? `${propText}位置` : '关键道具位置'}先被清楚建立。`,
      lighting: `${profile.keyLightLine}；${profile.fillLightLine}；${profile.contrastLine}`,
      audio: soundLines(profile),
      weight: 1,
    },
    {
      camera: `近景，平视或轻微越肩，缓慢推近，中长焦 85mm，浅景深焦在动作主体，常速，稳定器固定。`,
      frame: `${actionB}；动作从准备、发力到结果必须连续，表情和身体反应推动剧情，不停留在静态站姿。`,
      lighting: `主光压在表情和手部动作上，道具边缘有可追踪高光；${profile.contrastLine}`,
      audio: dialogue ? [dialogue, ...profile.audioLines.slice(0, 2)] : soundLines(profile, '<衣料摩擦声>'),
      weight: 1,
    },
    {
      camera: `特写，平视，固定或轻微推近，长焦 100mm，浅景深焦在眼神、手部或${propFocus}，常速，稳定器固定。`,
      frame: `${primary}的呼吸、眼神、指节和${propFocus}状态被放大；画面必须交代情绪变化和道具连续性。`,
      lighting: `高反差但不丢细节，关键高光落在眼神或${propFocus}边缘；${profile.contrastLine}`,
      audio: soundLines(profile, propText ? `<${propFocus}轻微摩擦声>` : '<短促呼吸声>'),
      weight: 0.9,
    },
    {
      camera: `中景，侧向或背向构图，轻微后拉，标准 50mm，中景深，常速，稳定器固定。`,
      frame: `${actorText}承接上一拍的动作结果，站位关系不跳变；结尾用视线、身体重心或空间入口指向下一段剧情。`,
      lighting: `光线方向承接前镜，背景空间重新可读；${profile.contrastLine}`,
      audio: soundLines(profile, '<环境声延续>'),
      weight: 0.8,
    },
  ]
}

function buildCinematicInternalShots(params: {
  beat: string
  duration: number
  location: string
  characterNames: string[]
  propNames: string[]
  dialogueInstruction?: string
}): PreciseInternalShot[] {
  const count = inferShotCount(params.duration, params.beat, params.propNames.length)
  const drafts = buildCinematicDrafts(params).slice(0, count)
  const durations = splitDurationForInternalShots(params.duration, drafts.length, drafts.map((draft) => draft.weight || 1))

  return drafts.map((draft, index) => ({
    shotNumber: index + 1,
    durationSeconds: durations[index],
    cameraLine: draft.camera,
    frameLine: draft.frame,
    lightingLine: draft.lighting,
    audioLines: draft.audio,
  }))
}

export function buildPreciseBeatVideoPrompt(params: {
  segmentId: string
  location: string
  beat: string
  durationSeconds?: number
  characters?: PreciseSegmentCharacterRef[]
  props?: PreciseSegmentPropRef[]
  sceneOpening?: string
  lighting?: string
  dialogueInstruction?: string
  outputParams?: Partial<PreciseSegmentOutputParams>
  negativeRequirements?: string
  styleDescription?: string
}): string {
  const durationSeconds = params.durationSeconds || inferBeatDuration(params.beat)
  const assets: PreciseSegmentAssets = {
    characters: params.characters || [],
    props: params.props || [],
    environment: params.location,
  }
  const characterNames = assets.characters.map((item) => item.name)
  const propNames = assets.props.map((item) => item.name)
  const openingState: PreciseOpeningState = {
    environmentLine: params.sceneOpening || `${params.location}，按剧情片段建立真实可拍摄空间，色调、天气、入口方向和环境声保持连续<环境声、脚步声、衣料摩擦声>。`,
    blockingLines: [
      characterNames.length > 0
        ? `${characterNames.join('、')}：位于${params.location}的关键行动区域，面向核心冲突方向；身体状态和情绪承接剧本原文。`
        : '主体资产：位于画面中心行动区域，按剧情片段建立清楚起始状态。',
      propNames.length > 0
        ? `${propNames.join('、')}：位于角色可触达或画面可见的位置，状态只按剧情变化，不作为新资产变体。`
        : '',
    ].filter(Boolean),
    lightingLine: params.lighting || '主光按场景既有光源方向落在动作主体上；副光克制；实用光、环境光和阴影比例保持同一段内连续。',
  }
  return buildPreciseSegmentVideoPrompt({
    segmentId: params.segmentId,
    location: params.location,
    sourceText: params.beat,
    assets,
    outputParams: {
      durationSeconds,
      videoModel: params.outputParams?.videoModel,
      resolution: params.outputParams?.resolution,
    },
    openingState,
    shots: buildCinematicInternalShots({
      beat: params.beat,
      duration: durationSeconds,
      location: params.location,
      characterNames,
      propNames,
      dialogueInstruction: params.dialogueInstruction,
    }),
    negativeRequirements: params.negativeRequirements,
    styleDescription: params.styleDescription || buildCinematicStyleDescription(params.location, params.beat),
  })
}

export function buildShortDramaBriefVideoPrompt(params: {
  brief: ShortDramaBrief
  beat: string
  beatIndex: number
  totalBeats: number
}): string {
  const { brief, beat, beatIndex } = params
  const scene = buildBriefScene(brief)
  const beatRoles = selectBriefRolesForBeat(brief, beat)
  const propNames = unique([
    ...(brief.isMedical && /手术|文件|安排|付款|身份|护士|医生/.test(beat) ? ['手术安排文件'] : []),
    ...(/眼镜/.test(beat) ? ['黑框眼镜'] : []),
  ])
  const dialogueSnippets = extractDialogueSnippets(beat)
  const dialogueInstruction = dialogueSnippets.length > 0
    ? `${brief.isMedical ? '英文口型同步，说：' : '口型同步，说：'}${dialogueSnippets.join(' / ')}。`
    : (brief.isMedical ? '如本片段需要台词，使用简短自然英文台词并保持英文口型同步。' : undefined)

  return buildPreciseBeatVideoPrompt({
    segmentId: buildSegmentId('S1', beatIndex),
    location: scene,
    beat,
    durationSeconds: inferBeatDuration(beat),
    characters: beatRoles.map((role) => ({ name: role.name })),
    props: propNames.map((name) => ({ name })),
    sceneOpening: buildBriefSceneOpening(brief, scene),
    lighting: brief.isMedical
      ? '冷白 LED 顶灯作为主光，白蓝医院墙面形成冷色反射；脸部轮廓清楚，英文环境标识不过分抢画面。'
      : '主光稳定，环境光线和色彩保持统一；光线落在说话者脸部或动作主体上，背景适度虚化。',
    dialogueInstruction,
  })
}

function buildCharacterAssetLines(shots: ShotSheetShot[]): string[] {
  const names = unique(shots.flatMap((shot) => [
    ...parseCharacters(shot.fields['角色'] || ''),
    ...shot.scene.characters,
  ]))

  return names.map((name) => {
    if (/Ava/i.test(name)) {
      return `${name}：年轻美国女性，24-27 岁，黑框眼镜，低马尾或微乱浅棕发，奶白色针织开衫和白色内搭；焦急、委屈、脆弱但倔强，眼神湿润，有熬夜疲惫感。`
    }
    if (/Grayson/i.test(name)) {
      return `${name}：美国男外科医生，30-34 岁，深棕色短发，轮廓分明，冷静克制；白大褂版本穿白色医生大褂和深色衬衫，手术服版本穿绿色手术服、手术帽、口罩和无菌手套；气质专业、高冷、有压迫感。`
    }
    if (/Nurse Sarah/i.test(name)) {
      return `${name}：美国注册护士，30-40 岁，浅蓝色护士服，医用口罩，职业感强，眼神严厉，语速快，带质疑和指责感。`
    }
    if (/Carter/i.test(name)) {
      return `${name}：美国男医生，30-35 岁，白大褂，浅色衬衫或 scrub，外向八卦，表情轻松，负责调侃和喜剧感。`
    }
    return `${name}：按原始脚本设定保持脸部、服装、发型、体型和表演气质完全统一。`
  })
}

export function buildCompressedAgentPrompt(text: string): string {
  const shots = parseShotSheetText(text)
  if (shots.length === 0) {
    return compact(text)
  }
  const groups = groupShotsForVideoPrompts(shots)
  const beatLines = groups.map((group, index) => {
    const summary = group
      .map((shot) => field(shot, '画面') || field(shot, '动作') || shot.code)
      .filter(Boolean)
      .join('；')
    return `${index + 1}. ${group[0].code}-${group[group.length - 1].code}：${summary}`
  })
  const characters = buildCharacterAssetLines(shots)
  return [
    '请用 Agent 自动创作模式生成一支短剧转绘视频，真实真人短剧质感，英文故事保持英文口型，不要中文字幕，不要背景音乐。',
    '工作流必须先抽取并锁定全局资产，再按 Scene/Segment 拆剧情；每个 Segment 是一个视频生成单元，内部必须继续拆 Shot 1 / Shot 2 / Shot 3，并输出“◎ 参考资产、◎ 输出参数、◈ 一致性控制、◈ 视频提示词、开场状态、Shot duration/镜头/画面/光影/音效”。',
    '角色资产：',
    ...characters,
    '故事压缩节拍：',
    ...beatLines,
    '风格要求：现代美国私立医院，白蓝走廊、冷白 LED 顶灯、英文导视牌、手术室与等待区保持一致；短剧节奏紧凑，情绪强烈但不过度夸张；专业医疗画面不血腥。',
  ].join('\n')
}
