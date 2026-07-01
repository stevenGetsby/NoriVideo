import { prisma } from '@/lib/prisma'
import type { StoryboardPanel } from '@/lib/storyboard-phases'
import { persistStoryboardsAndPanels } from '@/lib/workers/handlers/script-to-storyboard-helpers'
import { buildPreciseSegmentVideoPrompt } from '@/lib/novel-promotion/short-drama-video-prompt'

type Shot = {
  id: string
  sceneId: string
  sceneTitle: string
  sceneLocation: string
  sceneCharacters: string[]
  start: number
  end: number
  fields: Record<string, string>
  rawText: string
}

type ShotGroup = {
  groupIndex: number
  sceneTitle: string
  sceneLocation: string
  shots: Shot[]
}

const SHOT_HEADER_RE = /^###\s*(SH\d+)\s*\[(\d{2}:\d{2})-(\d{2}:\d{2})\]/i
const SCENE_HEADER_RE = /^##\s*(S\d+)\s*\[([^\]]+)\]\s*角色[:：]\s*(.+)$/i
const EMPTY_MARKERS = new Set(['', '（空）', '(空)', '无', 'none', 'null'])

function isEmptyField(value: string | null | undefined): boolean {
  return EMPTY_MARKERS.has((value || '').trim())
}

function timeToSeconds(value: string): number {
  const [minute, second] = value.split(':').map((item) => Number.parseInt(item, 10))
  if (!Number.isFinite(minute) || !Number.isFinite(second)) return 0
  return minute * 60 + second
}

function splitNames(value: string): string[] {
  return value
    .split(/[\/、,，]/)
    .map((item) => item.trim())
    .filter((item) => item && !isEmptyField(item))
}

function extractSceneLocation(sceneTitle: string): string {
  return sceneTitle.split(/[·|｜]/)[0]?.trim() || sceneTitle.trim() || '当前剧情场景'
}

function parseFields(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of lines) {
    const match = line.match(/^([^：:]{1,16})[：:]\s*([\s\S]*)$/)
    if (!match) continue
    fields[match[1].trim()] = match[2].trim()
  }
  return fields
}

function sceneSetting(location: string): string {
  if (/走廊/.test(location)) {
    return '现代美国私立医院走廊，白色墙面配浅蓝色横向导视线，冷白顶灯，英文导视牌、手术室门、等待区椅子和金属扶手保持一致'
  }
  if (/手术室/.test(location)) {
    return '现代美国医院手术室，冷绿色医疗灯光，绿色无菌布，英文监护仪界面，无影灯和金属器械清晰可见，专业克制，不血腥'
  }
  if (/更衣|准备室|术后/.test(location)) {
    return '现代美国医院术后准备室或更衣区，冷白照明、浅蓝墙面、洗手池和医疗器械背景保持一致'
  }
  if (/医院/.test(location)) {
    return `现代美国私立医院内的${location}，冷白医疗照明、英文环境标识和专业医疗空间质感保持一致`
  }
  return location
}

function cleanDialogue(raw: string): string {
  return raw
    .replace(/^\((?:对口型|画外|内心独白)\)\s*/i, '')
    .replace(/^（(?:对口型|画外|内心独白)）\s*/i, '')
    .trim()
}

function dialogueLine(raw: string): string {
  if (isEmptyField(raw)) return ''
  const text = cleanDialogue(raw)
  if (!text) return ''
  if (/^\s*[\(（]画外/.test(raw)) return `画外音： ${text}。`
  if (/^\s*[\(（]内心独白/.test(raw)) return `内心独白： ${text}。`
  if (/^\s*[\(（]对口型/.test(raw) || /[A-Za-z]{2,}/.test(text)) return `英文口型同步，说： ${text}。`
  return `对白： ${text}。`
}

function groupCharacters(group: ShotGroup): string[] {
  const names = new Set<string>()
  for (const shot of group.shots) {
    const fieldNames = splitNames(shot.fields['角色'] || '')
    const source = fieldNames.length > 0 ? fieldNames : shot.sceneCharacters
    for (const name of source) names.add(name)
  }
  return Array.from(names)
}

function groupProps(group: ShotGroup): string[] {
  const props = new Set<string>()
  for (const shot of group.shots) {
    const value = shot.fields['道具']
    if (isEmptyField(value)) continue
    for (const prop of splitNames(value || '')) props.add(prop)
  }
  return Array.from(props)
}

function buildVideoPrompt(group: ShotGroup): string {
  const first = group.shots[0]
  const last = group.shots[group.shots.length - 1]
  const sourceRange = `${first.id}-${last.id}`
  const scene = sceneSetting(group.sceneLocation)
  const characters = groupCharacters(group)
  const props = groupProps(group)
  const durationSeconds = Math.max(2, Math.min(15, last.end - first.start))
  return buildPreciseSegmentVideoPrompt({
    segmentId: `S${String(group.groupIndex).padStart(2, '0')}-SEG01`,
    location: group.sceneLocation,
    sourceText: `${sourceRange}：${group.shots.map((shot) => shot.fields['动作'] || shot.fields['画面'] || shot.id).join('；')}`,
    assets: {
      characters: characters.map((name) => ({ name })),
      props: props.map((name) => ({ name })),
      environment: group.sceneLocation,
    },
    outputParams: {
      durationSeconds,
    },
    openingState: {
      environmentLine: `${scene}，按原始镜头稿开场，空间结构、入口方向、前景遮挡和环境声保持连续<环境底噪、脚步声、衣料摩擦声>。`,
      blockingLines: [
        characters.length > 0
          ? `${characters.join('、')}：按原始镜头稿中的前景、中景、背景关系站位，保持左右关系、视线方向和距离变化连续。`
          : '主体：按原始镜头稿保持主体、前景遮挡、背景层次和视线方向连续。',
        props.length > 0 ? `${props.join('、')}：位于镜头稿指定位置，状态只随动作变化，不新增道具变体。` : '',
      ].filter(Boolean),
      lightingLine: first.fields['光影'] || '主光按原始镜头稿方向照亮主体动作区；角色脸部、手部和关键道具清晰。',
    },
    shots: group.shots.map((shot, index) => {
      const shotType = shot.fields['景别'] || '中景'
      const camera = shot.fields['机位'] || '平视'
      const move = shot.fields['运镜'] || '固定'
      const dialogue = dialogueLine(shot.fields['对白/字幕'] || '')
      const sound = shot.fields['声音/剪辑']
      return {
        shotNumber: index + 1,
        durationSeconds: Math.max(1, shot.end - shot.start),
        cameraLine: `${shotType}，${camera}，${move}，标准 50mm，浅景深焦在动作主体，常速，稳定器固定。镜头从 ${shot.id} 的起始构图进入，保持原始站位和视线方向，最后落到该镜头动作结果。`,
        frameLine: [
          shot.fields['画面'] || '按原始镜头稿推进画面',
          !isEmptyField(shot.fields['动作']) ? `动作：${shot.fields['动作']}` : '',
          !isEmptyField(shot.fields['微表情']) ? `微表情：${shot.fields['微表情']}` : '',
          dialogue,
        ].filter(Boolean).join('；'),
        lightingLine: shot.fields['光影'] || '主光稳定落在主体动作区；背景不过曝；关键表情和道具状态清晰。',
        audioLines: [
          dialogue ? dialogue : '',
          !isEmptyField(sound) ? `<${sound}>` : '',
        ].filter(Boolean),
      }
    }),
  })
}

function parseStructuredShotScript(sourceText: string): { shots: Shot[]; groups: ShotGroup[] } {
  const lines = sourceText.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim())
  const shots: Shot[] = []
  let sceneId = ''
  let sceneTitle = ''
  let sceneLocationValue = ''
  let sceneCharacters: string[] = []
  let currentHeader: { id: string; start: number; end: number } | null = null
  let currentLines: string[] = []

  const flushShot = () => {
    if (!currentHeader) return
    const fields = parseFields(currentLines)
    shots.push({
      id: currentHeader.id,
      sceneId,
      sceneTitle,
      sceneLocation: sceneLocationValue || fields['场景'] || '当前剧情场景',
      sceneCharacters,
      start: currentHeader.start,
      end: currentHeader.end,
      fields,
      rawText: [currentHeader.id, ...currentLines].join('\n'),
    })
    currentHeader = null
    currentLines = []
  }

  for (const line of lines) {
    const sceneMatch = line.match(SCENE_HEADER_RE)
    if (sceneMatch) {
      flushShot()
      sceneId = sceneMatch[1].trim()
      sceneTitle = sceneMatch[2].trim()
      sceneLocationValue = extractSceneLocation(sceneTitle)
      sceneCharacters = splitNames(sceneMatch[3])
      continue
    }
    const shotMatch = line.match(SHOT_HEADER_RE)
    if (shotMatch) {
      flushShot()
      currentHeader = {
        id: shotMatch[1].toUpperCase(),
        start: timeToSeconds(shotMatch[2]),
        end: timeToSeconds(shotMatch[3]),
      }
      continue
    }
    if (currentHeader && line) currentLines.push(line)
  }
  flushShot()

  const groups: ShotGroup[] = []
  let current: Shot[] = []
  const closeGroup = () => {
    if (current.length === 0) return
    groups.push({
      groupIndex: groups.length + 1,
      sceneTitle: current[0].sceneTitle,
      sceneLocation: current[0].sceneLocation,
      shots: current,
    })
    current = []
  }

  for (const shot of shots) {
    if (current.length > 0 && shot.sceneId !== current[0].sceneId) closeGroup()
    current.push(shot)
    const duration = current[current.length - 1].end - current[0].start
    if (current.length >= 4 || (current.length >= 3 && duration >= 8) || duration >= 12) {
      closeGroup()
    }
  }
  closeGroup()

  return { shots, groups }
}

export function isStructuredShotScript(sourceText: string): boolean {
  return /###\s*SH\d+\s*\[\d{2}:\d{2}-\d{2}:\d{2}\]/i.test(sourceText)
    && /^##\s*S\d+\s*\[/m.test(sourceText)
}

export async function persistStructuredShotScriptStage2(params: {
  projectId: string
  episodeId: string
  sourceText: string
}): Promise<{
  characterCount: number
  locationCount: number
  clipCount: number
  hasScript: boolean
}> {
  const parsed = parseStructuredShotScript(params.sourceText)
  if (parsed.groups.length === 0) {
    throw new Error('Structured shot script contains no usable shot groups')
  }

  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
    select: { id: true },
  })
  if (!project) throw new Error(`NovelPromotionProject not found: ${params.projectId}`)

  await prisma.novelPromotionClip.deleteMany({ where: { episodeId: params.episodeId } })

  const locationNames = new Set<string>()
  const characterNames = new Set<string>()
  for (const group of parsed.groups) {
    locationNames.add(group.sceneLocation)
    for (const character of groupCharacters(group)) characterNames.add(character)
  }

  for (const name of characterNames) {
    const existing = await prisma.novelPromotionCharacter.findFirst({
      where: {
        novelPromotionProjectId: project.id,
        name,
      },
      select: { id: true },
    })
    if (!existing) {
      await prisma.novelPromotionCharacter.create({
        data: {
          novelPromotionProjectId: project.id,
          name,
          aliases: JSON.stringify([name]),
          introduction: `从结构化镜头稿抽取的角色资产：${name}。`,
          profileConfirmed: true,
        },
      })
    }
  }

  for (const name of locationNames) {
    const existing = await prisma.novelPromotionLocation.findFirst({
      where: {
        novelPromotionProjectId: project.id,
        name,
        assetKind: 'location',
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.novelPromotionLocation.update({
        where: { id: existing.id },
        data: { summary: sceneSetting(name) },
      })
    } else {
      await prisma.novelPromotionLocation.create({
        data: {
          novelPromotionProjectId: project.id,
          name,
          assetKind: 'location',
          summary: sceneSetting(name),
        },
      },
      )
    }
  }

  for (const group of parsed.groups) {
    const first = group.shots[0]
    const last = group.shots[group.shots.length - 1]
    const characters = groupCharacters(group)
    const props = groupProps(group)
    const summary = `${first.id}-${last.id}：${first.fields['画面'] || ''}${last !== first ? ` / ${last.fields['画面'] || ''}` : ''}`.trim()
    await prisma.novelPromotionClip.create({
      data: {
        episodeId: params.episodeId,
        start: first.start,
        end: last.end,
        duration: Math.max(1, last.end - first.start),
        summary,
        location: group.sceneLocation,
        characters: characters.length > 0 ? JSON.stringify(characters) : null,
        props: props.length > 0 ? JSON.stringify(props) : null,
        content: group.shots.map((shot) => shot.rawText).join('\n\n'),
        startText: first.id,
        endText: last.id,
        shotCount: group.shots.length,
        screenplay: JSON.stringify({
          source: 'structured-shot-script',
          sourceRange: `${first.id}-${last.id}`,
          sceneTitle: group.sceneTitle,
          shots: group.shots,
        }),
      },
    })
  }

  return {
    characterCount: characterNames.size,
    locationCount: locationNames.size,
    clipCount: parsed.groups.length,
    hasScript: true,
  }
}

export async function persistStructuredShotScriptStage3(params: {
  episodeId: string
}): Promise<{
  storyboardCount: number
  panelCount: number
  voiceLineCount: number
  hasStoryboard: boolean
}> {
  const clips = await prisma.novelPromotionClip.findMany({
    where: { episodeId: params.episodeId },
    orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
  })
  const clipPanels = clips.map((clip, index) => {
    const screenplay = (() => {
      try {
        return JSON.parse(clip.screenplay || '{}') as { source?: string; shots?: Shot[]; sceneTitle?: string }
      } catch {
        return null
      }
    })()
    if (screenplay?.source !== 'structured-shot-script' || !Array.isArray(screenplay.shots) || screenplay.shots.length === 0) {
      throw new Error(`Clip ${clip.id} is not a structured shot script clip`)
    }
    const group: ShotGroup = {
      groupIndex: index + 1,
      sceneTitle: screenplay.sceneTitle || clip.location || '',
      sceneLocation: clip.location || screenplay.shots[0].sceneLocation,
      shots: screenplay.shots,
    }
    const characters = (() => {
      try {
        const parsed = JSON.parse(clip.characters || '[]')
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
      } catch {
        return []
      }
    })()
    const props = (() => {
      try {
        const parsed = JSON.parse(clip.props || '[]')
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
      } catch {
        return []
      }
    })()
    const panel: StoryboardPanel = {
      panel_number: 1,
      description: clip.summary,
      location: clip.location || undefined,
      source_text: clip.content,
      characters,
      props,
      shot_type: group.shots.map((shot) => shot.fields['景别']).filter(Boolean).join('—') || '按原始镜头稿',
      camera_move: group.shots.map((shot) => shot.fields['运镜']).filter(Boolean).join('—') || '固定',
      video_prompt: buildVideoPrompt(group),
      duration: clip.duration || Math.max(1, group.shots[group.shots.length - 1].end - group.shots[0].start),
    }
    return {
      clipId: clip.id,
      clipIndex: index,
      finalPanels: [panel],
    }
  })

  const persisted = await persistStoryboardsAndPanels({
    episodeId: params.episodeId,
    clipPanels,
  })

  return {
    storyboardCount: persisted.length,
    panelCount: clipPanels.length,
    voiceLineCount: 0,
    hasStoryboard: clipPanels.length > 0,
  }
}
