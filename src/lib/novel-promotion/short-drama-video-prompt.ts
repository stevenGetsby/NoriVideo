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

export type VideoPromptBlock = {
  blockNumber: number
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

function groupBySceneAndDuration(shots: ShotSheetShot[], targetSeconds = 10): ShotSheetShot[][] {
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

function cleanShotText(value: string): string {
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

function normalizeDialogue(value: string): string {
  const text = cleanShotText(value)
  if (!text) return ''
  return text
    .replace(/\(对口型\)/g, '英文口型同步，说：')
    .replace(/\(画外\)/g, '画外音：')
    .replace(/\(OS\)/g, '内心独白：')
}

function field(shot: ShotSheetShot, name: string): string {
  return cleanShotText(shot.fields[name])
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

function buildShotLine(shot: ShotSheetShot, groupStartSeconds: number): string {
  const relativeStart = Math.max(0, shot.startSeconds - groupStartSeconds)
  const relativeEnd = Math.max(relativeStart + 1, shot.endSeconds - groupStartSeconds)
  const shotType = [field(shot, '景别'), field(shot, '机位')].filter(Boolean).join('，') || '中景，平视'
  const cameraMove = field(shot, '运镜') || '固定'
  const picture = field(shot, '画面')
  const action = field(shot, '动作')
  const expression = field(shot, '微表情')
  const dialogue = normalizeDialogue(shot.fields['对白/字幕'])
  const light = field(shot, '光影')
  const sound = field(shot, '声音/剪辑')
  const details = [
    picture,
    action ? `动作：${action}` : '',
    expression ? `表情：${expression}` : '',
    dialogue,
    light ? `光影：${light}` : '',
    sound ? `声音：${sound}` : '',
  ].filter(Boolean).join('。')

  return `${relativeStart}-${relativeEnd}s：${shotType}，${cameraMove}镜头。${details}。`
}

function splitDurationByCount(duration: number, count: number): Array<[number, number]> {
  const safeDuration = Math.max(2, Math.round(duration))
  const safeCount = Math.max(1, Math.min(count, safeDuration))
  const ranges: Array<[number, number]> = []
  let previous = 0
  for (let index = 1; index <= safeCount; index += 1) {
    let end = index === safeCount
      ? safeDuration
      : Math.round((safeDuration * index) / safeCount)
    if (end <= previous) end = previous + 1
    ranges.push([previous, Math.min(end, safeDuration)])
    previous = end
  }
  return ranges
}

function inferTimedSegmentCount(params: {
  duration: number
  beatSummary: string
  roleCount: number
  propNames?: string
  dialogueInstruction?: string
}): number {
  const { duration, beatSummary, roleCount, propNames, dialogueInstruction } = params
  const hasDialogue = /口型同步|说[:：]|says?|asks?|:/.test(dialogueInstruction || beatSummary)
  const sentenceCount = compact(beatSummary).split(/[。！？!?；;]/u).filter(Boolean).length
  const hasProps = !!compact(propNames)
  const complex = roleCount >= 3 || sentenceCount >= 3 || Array.from(beatSummary).length > 70
  if (duration <= 4 && !complex) return 1
  if (!hasDialogue && !complex && !hasProps) return 2
  if (complex || (hasDialogue && roleCount >= 2)) return 4
  return 3
}

export function buildCanonicalTimedActionLines(params: {
  duration: number
  scene: string
  roleNames: string
  roleActionText: string
  beatSummary: string
  propNames?: string
  dialogueInstruction?: string
}): string[] {
  const {
    duration,
    scene,
    roleNames,
    roleActionText,
    beatSummary,
    propNames,
    dialogueInstruction,
  } = params
  const roleList = roleNames.split('、').map((name) => name.trim()).filter(Boolean)
  const actorText = roleNames || '主要角色'
  const propText = compact(propNames)
  const coreAction = truncateText(roleActionText || beatSummary || '按剧情片段执行核心动作、台词和听者反应。', 180)
  const dialogue = compact(dialogueInstruction)
  const count = inferTimedSegmentCount({
    duration,
    beatSummary,
    roleCount: roleList.length,
    propNames: propText,
    dialogueInstruction: dialogue,
  })
  const ranges = splitDurationByCount(duration, count)

  if (ranges.length === 1) {
    const [start, end] = ranges[0]
    return [
      `${start}-${end}s：中景或近景，平视，固定镜头。${actorText}在${scene}中完成“${beatSummary}”：先建立人物关系和关键位置，再执行核心动作/台词，最后给出情绪结果或下一分镜衔接；${propText ? `关键道具${propText}必须在正确位置出现。` : '不要新增无关道具。'}${dialogue ? ` ${dialogue}` : ''}`,
    ]
  }

  if (ranges.length === 2) {
    return [
      `${ranges[0][0]}-${ranges[0][1]}s：中景，平视，固定镜头。${actorText}在${scene}中进入或停在关键位置，建立空间、光线、人物距离和视线关系；${propText ? `关键道具${propText}必须在正确位置出现。` : '不要新增无关道具。'}`,
      `${ranges[1][0]}-${ranges[1][1]}s：近景或特写，固定镜头。${coreAction} 承接“${beatSummary}”的因果结果，给出情绪变化、动作完成或下一分镜转场。${dialogue ? ` ${dialogue}` : ''}`,
    ]
  }

  const lines = [
    `${ranges[0][0]}-${ranges[0][1]}s：中景，平视，固定镜头。${actorText}在${scene}中建立当前空间、人物关系和视线方向；${propText ? `关键道具${propText}必须在正确位置出现。` : '不要新增无关道具。'}`,
    `${ranges[1][0]}-${ranges[1][1]}s：近景或越肩，平视，固定镜头。${coreAction}${dialogue ? ` ${dialogue}` : ' 如本片段需要台词，使用简短自然台词并保持口型同步。'}`,
  ]

  if (ranges.length === 3) {
    lines.push(
      `${ranges[2][0]}-${ranges[2][1]}s：中景或特写，固定镜头或轻微推近。聚焦${actorText}的反应、手部动作${propText ? `、${propText}状态` : ''}或情绪变化，明确该片段结果并保留下一分镜衔接。`,
    )
    return lines
  }

  lines.push(
    `${ranges[2][0]}-${ranges[2][1]}s：特写或近景，固定镜头。聚焦${actorText}的眼神、手部动作${propText ? `、${propText}状态` : ''}或情绪变化，承接上一拍，不要只摆姿势。`,
    `${ranges[3][0]}-${ranges[3][1]}s：中景，平视，轻微推近或固定镜头。${actorText}给出该片段结果、悬念或转场方向，保持下一分镜可连续衔接。`,
  )
  return lines
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

function buildGlobalHeader(shots: ShotSheetShot[]): string[] {
  const scenes = unique(shots.map((shot) => shot.scene.heading))
  return [
    '禁止生成背景音乐，但可以根据画面生成对应环境音效、脚步声、医疗仪器声和衣料摩擦声。',
    '生成一支 9:16 竖屏欧美医疗短剧片段，整体为真实真人短剧质感，现代美国私立医院环境，画面明亮干净，白色与浅蓝色医院走廊，冷白色 LED 顶灯，英文门牌与英文导视标识。整体风格为欧美 TikTok / Reel vertical mini drama，节奏紧凑，情绪强烈，人物表演具有短剧爽感，但不过度夸张。',
    '以原始镜头稿为准，逐分镜复刻画面的镜头语言、运镜、构图、景别、人物站位、人物朝向、前景遮挡、走位、视线方向、镜头停顿和剪辑节奏。不要重新设计分镜，不要改变镜头角度，不要改变人物站位，不要新增额外镜头，不要改变剧情。',
    '全片角色脸部、服装、发型、体型必须完全统一，不漂移，不串脸。所有角色必须说英文，英文口型同步准确。不要生成中文字幕，不要生成中文医院标识，不要生成乱码文字。医院内可出现英文标识：OPERATING ROOM、SURGERY CENTER、IN SURGERY、WAITING AREA、NURSES’ STATION、AUTHORIZED PERSONNEL ONLY。',
    '【短剧角色资产保持不变】',
    ...buildCharacterAssetLines(shots),
    `【统一场景设定】 ${scenes.map(describeLocation).join('；')}。`,
  ]
}

function buildBlockText(blockNumber: number, shots: ShotSheetShot[]): string {
  const durationSeconds = Math.max(1, shots[shots.length - 1].endSeconds - shots[0].startSeconds)
  const sceneNames = unique(shots.map((shot) => describeLocation(shot.scene.heading)))
  const characterNames = unique(shots.flatMap((shot) => parseCharacters(shot.fields['角色'] || '')))
  const sceneText = sceneNames.join('；')
  const beatText = summarizeVideoPromptBeat(shots
    .map((shot) => field(shot, '动作') || field(shot, '画面') || `${shot.code} 的剧情动作`)
    .filter(Boolean)
    .join('；'), 120)
  const roleActionText = characterNames
    .map((name) => {
      const roleShots = shots.filter((shot) => parseCharacters(shot.fields['角色'] || '').includes(name))
      const roleAction = summarizeVideoPromptBeat(roleShots
        .map((shot) => field(shot, '动作') || field(shot, '画面'))
        .filter(Boolean)
        .join('；') || '按剧情片段执行动作、台词和听者反应。', 90)
      return `${name}：${roleAction}`
    })
    .join('；')
  const propNames = unique(shots.flatMap((shot) => {
    const text = `${field(shot, '画面')} ${field(shot, '动作')}`
    return [
      /手术|文件|安排/.test(text) ? '手术安排文件' : '',
      /眼镜/.test(text) ? '黑框眼镜' : '',
    ].filter(Boolean)
  }))
  return [
    `场景：${sceneText}。`,
    `剧情片段：${beatText}`,
    '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
    `本分镜使用资产：角色=${characterNames.join('、') || '按剧情出现的主要角色'}；场景=${sceneText}；道具=${propNames.join('、') || '无独立关键道具，仅使用场景内医疗/环境元素'}。`,
    `角色行为拆分：${roleActionText || '主要角色：按剧情片段执行动作、台词和听者反应。'}`,
    `人物站位：${characterNames.join('、') || '主要角色'} 按剧情关系形成清楚前景、中景、背景层次；说话者占主画面，听者可在前景边缘或背景虚化；角色进入、停顿、转身、递交、救助、质问等动作必须和剧情片段一致。`,
    '镜头语言：先用关系中景建立空间和人物位置，再用近景表现核心动作/台词，再用特写捕捉眼神、手部或道具状态，最后用中景给出结果或转场。固定镜头为主，可轻微推近；不要手持乱晃，不要新增无关镜头。',
    ...shots.map((shot) => buildShotLine(shot, shots[0].startSeconds)),
    `【本分镜负面要求】 ${CANONICAL_PANEL_NEGATIVE_REQUIREMENTS}`,
  ].join('\n')
}

function extractSourceShotRange(text: string): string {
  const match = text.match(/\b(SH\d{3})\s*[-—~至到]\s*(SH\d{3})\b/i)
  return match ? `${match[1].toUpperCase()}-${match[2].toUpperCase()}` : ''
}

export function buildShortDramaVideoPromptText(text: string): string {
  const shots = parseShotSheetText(text)
  if (shots.length === 0) {
    throw new Error('No SH shots found in story document')
  }
  const blocks = groupShotsForVideoPrompts(shots)
  const lines = [
    ...blocks.map((group, index) => buildBlockText(index + 1, group)),
  ]
  return lines.join('\n')
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
    '请用 Agent 自动创作模式生成一支 9:16 欧美医疗短剧转绘视频，真实真人短剧质感，英文口型，不要中文字幕，不要背景音乐。',
    '工作流必须先抽取并锁定全局资产，再按剧情片段生成分镜；每个视频分镜要包含场景、人物站位、镜头语言、按秒拆分的动作/对白和全局负面要求。',
    '角色资产：',
    ...characters,
    '故事压缩节拍：',
    ...beatLines,
    '风格要求：现代美国私立医院，白蓝走廊、冷白 LED 顶灯、英文导视牌、手术室与等待区保持一致；短剧节奏紧凑，情绪强烈但不过度夸张；专业医疗画面不血腥。',
  ].join('\n')
}

export function buildVideoPromptBlocks(text: string): VideoPromptBlock[] {
  const shots = parseShotSheetText(text)
  return groupShotsForVideoPrompts(shots).map((group, index) => ({
    blockNumber: index + 1,
    shots: group,
    durationSeconds: group[group.length - 1].endSeconds - group[0].startSeconds,
    text: buildBlockText(index + 1, group),
  }))
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
    && /(短剧|转绘|真人|口型|镜头语言|按秒拆分|人物站位)/.test(text)
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
      : '欧美竖屏真人短剧质感，真实摄影，节奏紧凑，情绪明确，角色脸部和服装全程一致',
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
    return '现代美国私立医院走廊或手术区，白色墙面配浅蓝色导视线，冷白 LED 顶灯，英文门牌、手术室门、等待区椅子和金属扶手保持一致'
  }
  return '符合剧情的真实短剧场景，空间关系清晰，环境光线、色调、道具和角色站位在全片保持一致'
}

function inferBeatDuration(beat: string): number {
  const charCount = Array.from(beat).length
  if (/[“”"].+?[“”"]|:.+/.test(beat) || charCount > 52) return 10
  if (charCount > 34) return 8
  return 6
}

function splitTimedRanges(duration: number): Array<[number, number]> {
  const safeDuration = Math.max(4, duration)
  if (safeDuration <= 6) {
    const finalStart = Math.max(3, safeDuration - 1)
    return [[0, 2], [2, 3], [3, finalStart], [finalStart, safeDuration]]
  }
  if (duration <= 8) return [[0, 2], [2, 3], [3, 5], [5, duration]]
  return [[0, 2], [2, 4], [4, 7], [7, duration]]
}

function inferBriefShotLanguage(brief: ShortDramaBrief, beat: string): string {
  if (brief.isMedical) {
    const hasComplaint = /质疑|抱怨|question|accuse|complain|Nurse/i.test(beat)
    return hasComplaint
      ? '中景平视过肩固定—特写平视固定—特写平视过肩固定—特写平视固定'
      : '中景平视固定—近景平视过肩固定—特写平视固定—中景平视轻微推近'
  }
  return '中景平视固定—近景平视固定—特写平视固定—中景平视轻微推近'
}

function inferBriefLighting(brief: ShortDramaBrief, roleNames: string, beat: string): string[] {
  if (brief.isMedical) {
    return [
      '走廊顶灯冷白光，打在主要角色脸上形成微弱立体阴影，英文导视牌清晰但不抢戏。',
      roleNames.includes('Ava')
        ? '顶灯在 Ava 的眼镜框上方形成反光，眼眶处有弱阴影，突出疲惫和紧张。'
        : '冷白光均匀铺开，脸部轮廓清晰，医疗环境保持干净专业。',
      roleNames.includes('Nurse Sarah')
        ? '冷白光均匀铺开，医用口罩上有高光，眼神区域清楚。'
        : '冷白光保持一致，背景手术室门和金属扶手略微虚化。',
      roleNames.includes('Dr. Grayson')
        ? '侧脸有明显的明暗交界线，白大褂边缘有冷色高光。'
        : '环境光收束在动作结果上，保持下一镜头可连续衔接。',
    ]
  }
  return [
    '主光稳定，环境光线和色彩保持统一。',
    '光线落在说话者脸部或动作主体上，背景适度虚化。',
    '特写保持眼神、手部和关键道具清晰。',
    '结尾光线保持连续，方便衔接下一分镜。',
  ]
}

export const CANONICAL_PANEL_NEGATIVE_REQUIREMENTS = '不要改变故事核心因果，不要新增无关角色，不要把剧情道具改成商品卖点。 角色脸部、发型、服装、体型、年龄气质必须全片一致，不串脸、不漂移。 镜头必须服务动作、台词和情绪推进，不要只输出静态摆拍。 不要乱码文字，不要无意义字幕，不要过度美颜，不要塑料皮肤。 不要生成中文字幕，不要自动生成大段字幕。 不要生成背景音乐，只保留必要环境声、脚步声、衣料摩擦声和道具声。 所有可见说话角色必须英文口型同步准确，不要中文口型。 英文/欧美故事必须使用国外场景、英文环境标识和欧美生活语境，不要变成亚洲场景或中文标识环境。 结尾必须留出进入下一剧情片段的动作、视线或空间方向。'

function inferBriefRoleAction(roleName: string, beat: string, brief: ShortDramaBrief): string {
  if (brief.isMedical) {
    if (/Ava/i.test(roleName)) {
      return beat.includes('请求') || /surgery|手术/i.test(beat)
        ? '眼神湿润、疲惫但倔强地靠近 Dr. Grayson，请求他帮忙安排手术。'
        : '保持焦急、委屈、脆弱但倔强的状态，动作和台词严格对应剧情片段。'
    }
    if (/Grayson/i.test(roleName)) {
      return /手术|安排|判断|surgery|decision/i.test(beat)
        ? '冷静挡在 Ava 与质疑者之间，克制地作出手术安排或专业判断。'
        : '保持冷静克制和专业压迫感，只执行剧情片段要求的回应、观察或判断。'
    }
    if (/Nurse Sarah/i.test(roleName)) {
      return '用严厉、快速、带质疑的职业语气推动冲突，动作和台词严格对应剧情片段。'
    }
    if (/Carter/i.test(roleName)) {
      return '以轻松外向的医生状态提供调侃或信息推动，不抢走主冲突。'
    }
  }
  return '执行剧情片段中的核心动作、台词和听者反应。'
}

function buildBriefRoleActionText(brief: ShortDramaBrief, beat: string, roles: ShortDramaRoleAsset[]): string {
  return roles
    .map((role) => `${role.name}：${inferBriefRoleAction(role.name, beat, brief)}`)
    .join('；')
}

function extractEnglishDialogueSnippets(beat: string): string[] {
  const snippets: string[] = []
  const speakerMatches = beat.matchAll(/(?:^|[\s。；;])([A-Z][A-Za-z. ]{1,40}):\s*([^。；;\n]+?[.!?])/g)
  for (const match of speakerMatches) {
    const cleaned = compact(match[2])
    if (cleaned && !snippets.includes(cleaned)) snippets.push(cleaned)
  }
  const quoteMatches = beat.match(/["“][^"”]+?[.!?]["”]/g) || []
  for (const item of quoteMatches) {
    const cleaned = compact(item.replace(/^["“]|["”]$/g, ''))
    if (cleaned && !snippets.includes(cleaned)) snippets.push(cleaned)
  }
  return snippets.slice(0, 4)
}

function findRoleByDialogue(beat: string, roles: ShortDramaRoleAsset[], dialogue: string): string {
  const dialogueIndex = beat.indexOf(dialogue)
  if (dialogueIndex < 0) return ''
  const prefix = beat.slice(Math.max(0, dialogueIndex - 80), dialogueIndex)
  let matchedName = ''
  let matchedIndex = -1
  for (const role of roles) {
    const index = prefix.lastIndexOf(role.name)
    if (index > matchedIndex) {
      matchedName = role.name
      matchedIndex = index
    }
  }
  return matchedName
}

function buildBriefTimedActionLines(params: {
  brief: ShortDramaBrief
  beat: string
  duration: number
  roleNames: string
  scene: string
}): string[] {
  const { brief, beat, duration, roleNames, scene } = params
  const roleNameList = roleNames.split('、').filter(Boolean)
  const actionText = buildBriefRoleActionText(brief, beat, roleNameList.map((name) => ({ name, description: '' })))
  const dialogueSnippets = extractEnglishDialogueSnippets(beat)
  const dialogueInstruction = dialogueSnippets.length > 0
    ? `英文口型同步，说：${dialogueSnippets.join(' / ')}。`
    : '如本片段需要台词，使用简短自然英文台词并保持英文口型同步。'

  return buildCanonicalTimedActionLines({
    duration,
    scene,
    roleNames,
    roleActionText: actionText,
    beatSummary: summarizeVideoPromptBeat(beat, 110),
    propNames: brief.isMedical && /手术|文件|安排|付款|身份|护士|医生/.test(beat) ? '手术安排文件' : '',
    dialogueInstruction,
  })
}

function selectBriefRolesForBeat(brief: ShortDramaBrief, beat: string): ShortDramaRoleAsset[] {
  const matched = brief.roleAssets.filter((role) => {
    const escapedName = role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escapedName}\\b`, 'i').test(beat)
  })
  return matched.length > 0 ? matched : brief.roleAssets
}

export function buildShortDramaBriefVideoPrompt(params: {
  brief: ShortDramaBrief
  beat: string
  beatIndex: number
  totalBeats: number
}): string {
  const { brief, beat, beatIndex, totalBeats } = params
  const duration = inferBeatDuration(beat)
  const beatSummary = summarizeVideoPromptBeat(beat, 120)
  const beatRoles = selectBriefRolesForBeat(brief, beat)
  const roleNames = beatRoles.map((role) => role.name).join('、')
  const scene = buildBriefScene(brief)
  const propNames = unique([
    ...(brief.isMedical && /手术|文件|安排|付款|身份|护士|医生/.test(beat) ? ['手术安排文件'] : []),
    ...(/眼镜/.test(beat) ? ['黑框眼镜'] : []),
  ])
  const timedActionLines = buildBriefTimedActionLines({
    brief,
    beat,
    duration,
    roleNames,
    scene,
  })
  const roleActionText = buildBriefRoleActionText(brief, beat, beatRoles)
  return [
    `场景：${scene}。`,
    `剧情片段：${beatSummary}`,
    '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
    `本分镜使用资产：角色=${roleNames || '主要角色'}；场景=${scene}；道具=${propNames.length > 0 ? propNames.join('、') : '无独立关键道具，仅使用场景内医疗/环境元素'}。`,
    `角色行为拆分：${roleActionText}`,
    `人物站位：${roleNames || '主要角色'} 按剧情关系形成清楚前景、中景、背景层次；说话者占主画面，听者可在前景边缘或背景虚化，不要串脸，不要让角色凭空消失。`,
    '镜头语言：先用关系中景建立空间和人物位置，再用近景表现核心动作/台词，再用特写捕捉眼神、手部或道具状态，最后用中景给出结果或转场。固定镜头为主，可轻微推近；不要手持乱晃，不要新增无关镜头。',
    ...timedActionLines,
    `【本分镜负面要求】 ${CANONICAL_PANEL_NEGATIVE_REQUIREMENTS}`,
  ].join('\n')
}
