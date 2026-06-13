import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import mammoth from 'mammoth'
import { prisma } from '../src/lib/prisma'
import { getOrCreateTestModeSession } from '../src/lib/test-mode'
import { SuperAgentOrchestrator } from '../src/lib/super-agent/orchestrator'
import { normalizeAgentExecutionPlan } from '../src/lib/super-agent/plan-utils'
import { persistStoryboardsAndPanels } from '../src/lib/workers/handlers/script-to-storyboard-helpers'
import type { AgentContext, AgentExecutionPlan } from '../src/lib/super-agent/types'
import type { StoryboardPanel } from '../src/lib/storyboard-phases'

dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

const DESKTOP = '/Users/headmasterx/Desktop'
const STORY_CANDIDATES = [
  path.join(DESKTOP, '压缩故事.txt'),
  path.join(DESKTOP, 'Agent压缩故事测试输入.txt'),
]
const VIDEO_PROMPT_DOCX = path.join(DESKTOP, '视频提示词.docx')
const REPORT_PATH = path.join(process.cwd(), '.runtime', 'agent-lock-assets-fill-docx-prompts-report.json')

type FixedVideoPrompt = {
  index: number
  title: string
  text: string
  duration: number
  location: string
  characters: string[]
  props: string[]
}

function ensureRuntimeDir() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
}

function writeReport(payload: Record<string, unknown>) {
  ensureRuntimeDir()
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function readStoryFile() {
  const filePath = STORY_CANDIDATES.find((candidate) => fs.existsSync(candidate))
  if (!filePath) {
    throw new Error(`Story input not found. Tried: ${STORY_CANDIDATES.join(', ')}`)
  }
  const text = fs.readFileSync(filePath, 'utf8').trim()
  if (!text) throw new Error(`Story input is empty: ${filePath}`)
  return { filePath, text }
}

function cleanDocxText(raw: string) {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readDocxText(filePath: string) {
  if (!fs.existsSync(filePath)) throw new Error(`Video prompt docx not found: ${filePath}`)
  const result = await mammoth.extractRawText({ path: filePath })
  const text = cleanDocxText(result.value || '')
  if (!text) throw new Error(`Video prompt docx has no readable text: ${filePath}`)
  return text
}

function extractBetween(text: string, label: string) {
  const match = text.match(new RegExp(`${label}[：:]\\s*([^\\n]+)`))
  return match?.[1]?.trim() || ''
}

function extractDuration(text: string) {
  const titleDuration = text.match(/秒数参考[：:]\s*(\d+(?:\.\d+)?)\s*秒/)
  if (titleDuration) return Math.max(1, Math.round(Number(titleDuration[1])))

  const ranges = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*[-—–]\s*(\d+(?:\.\d+)?)\s*s/gi))
  if (ranges.length === 0) return 6
  const last = ranges[ranges.length - 1]
  return Math.max(1, Math.ceil(Number(last[2])))
}

function splitNames(raw: string) {
  return raw
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/按|在|从|与|和|关系|站位/.test(item))
}

function extractCharacters(text: string) {
  const station = extractBetween(text, '人物站位')
  if (station) {
    const beforeRule = station.split(/按|在|形成|保持/)[0] || station
    const names = splitNames(beforeRule)
    if (names.length > 0) return names
  }

  const knownNames = ['Ava', 'Dr. Grayson', 'Nurse Sarah', 'Dr. Carter']
  return knownNames.filter((name) => text.includes(name))
}

function extractProps(text: string) {
  const assetLine = extractBetween(text, '本分镜使用资产')
  const propMatch = assetLine.match(/道具\s*=\s*([^；;。\n]+)/)
  if (!propMatch) return []
  return splitNames(propMatch[1])
}

function parseVideoPrompts(docxText: string): FixedVideoPrompt[] {
  const headingPattern = /(?:^|\n)[—\-－]{4,}\s*【分镜\s*(\d+)[^】]*】\s*[—\-－]{4,}/g
  const matches = Array.from(docxText.matchAll(headingPattern))
  if (matches.length === 0) {
    throw new Error('No 分镜 blocks found in 视频提示词.docx')
  }

  return matches.map((match, index) => {
    const start = match.index || 0
    const end = index + 1 < matches.length ? matches[index + 1].index || docxText.length : docxText.length
    const text = docxText.slice(start, end).trim()
    const title = (text.split('\n').find((line) => line.includes('【分镜')) || `分镜${match[1]}`).trim()
    return {
      index: Number(match[1]),
      title,
      text,
      duration: extractDuration(text),
      location: extractBetween(text, '场景') || '现代美国私立医院',
      characters: extractCharacters(text),
      props: extractProps(text),
    }
  })
}

function inferMedicalArtStylePrompt(story: string) {
  return [
    '9:16 竖屏欧美医疗短剧转绘视频，真实真人短剧质感，英文口型同步。',
    '角色脸部、发型、服装、体型、年龄气质全片一致；不要中文字幕，不要背景音乐。',
    '现代美国私立医院场景，英文导视牌，冷白顶灯，白色墙面和浅蓝色导视线。',
    story.includes('Ava') ? '重点锁定 Ava、Dr. Grayson、Nurse Sarah、Dr. Carter 的角色资产。' : '',
  ].filter(Boolean).join('\n')
}

function parseStringArrayField(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  } catch {
    return []
  }
}

async function readStoryClips(episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: {
        orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })
  const clips = episode?.clips || []
  if (clips.length === 0) {
    throw new Error('No story clips found after STORY_TO_SCRIPT_RUN; refusing to create storyboard panels without clip-level story structure.')
  }

  const sourceText = episode?.novelText || ''
  if (!sourceText.trim()) return clips

  return [...clips].sort((a, b) => {
    const aNeedle = (a.content || a.summary || '').slice(0, 80)
    const bNeedle = (b.content || b.summary || '').slice(0, 80)
    const aSourceIndex = aNeedle ? sourceText.indexOf(aNeedle) : -1
    const bSourceIndex = bNeedle ? sourceText.indexOf(bNeedle) : -1
    if (aSourceIndex >= 0 && bSourceIndex >= 0 && aSourceIndex !== bSourceIndex) {
      return aSourceIndex - bSourceIndex
    }
    if (aSourceIndex >= 0 && bSourceIndex < 0) return -1
    if (aSourceIndex < 0 && bSourceIndex >= 0) return 1
    return (a.start || 0) - (b.start || 0)
  })
}

function distributePromptsToStoryClips<Clip extends { id: string }>(clips: Clip[], prompts: FixedVideoPrompt[]) {
  const assignments = clips.map((clip) => ({ clip, prompts: [] as FixedVideoPrompt[] }))
  for (let index = 0; index < prompts.length; index += 1) {
    const clipIndex = Math.min(clips.length - 1, Math.floor((index * clips.length) / prompts.length))
    assignments[clipIndex].prompts.push(prompts[index])
  }
  return assignments.filter((assignment) => assignment.prompts.length > 0)
}

async function fillVideoPrompts(episodeId: string, prompts: FixedVideoPrompt[]) {
  const clips = await readStoryClips(episodeId)
  const assignments = distributePromptsToStoryClips(clips, prompts)

  const clipPanels = assignments.map((assignment, clipIndex) => {
    const { clip } = assignment
    const clipCharacters = parseStringArrayField(clip.characters)
    const clipProps = parseStringArrayField(clip.props)
    const clipLocation = clip.location || assignment.prompts[0]?.location || ''
    const finalPanels = assignment.prompts.map((prompt, panelIndex): StoryboardPanel => ({
      panel_number: panelIndex + 1,
      description: prompt.title,
      location: clipLocation,
      source_text: clip.content || prompt.title,
      characters: clipCharacters,
      props: clipProps,
      shot_type: '按视频提示词执行',
      camera_move: '按视频提示词执行',
      video_prompt: prompt.text,
      duration: prompt.duration,
    }))
    return {
      clipId: clip.id,
      clipIndex,
      finalPanels,
    }
  })

  let timelineCursor = 0
  for (const assignment of assignments) {
    const duration = Math.max(1, assignment.prompts.reduce((sum, prompt) => sum + prompt.duration, 0))
    await prisma.novelPromotionClip.update({
      where: { id: assignment.clip.id },
      data: {
        start: timelineCursor,
        end: timelineCursor + duration,
        duration,
        shotCount: assignment.prompts.length,
      },
    })
    timelineCursor += duration
  }

  return await persistStoryboardsAndPanels({ episodeId, clipPanels })
}

async function main() {
  const startedAt = new Date().toISOString()
  const story = readStoryFile()
  const docxText = await readDocxText(VIDEO_PROMPT_DOCX)
  const videoPrompts = parseVideoPrompts(docxText)
  const existingEpisodeId = process.env.AGENT_EXISTING_EPISODE_ID?.trim()

  if (existingEpisodeId) {
    const persisted = await fillVideoPrompts(existingEpisodeId, videoPrompts)
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: existingEpisodeId },
      include: {
        clips: {
          orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
          include: { storyboard: { include: { panels: true } } },
        },
        novelPromotionProject: true,
      },
    })
    const panelCount = episode?.clips.reduce((sum, clip) => sum + (clip.storyboard?.panels.length || 0), 0) || 0
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: 'fill-existing',
      episodeId: existingEpisodeId,
      projectId: episode?.novelPromotionProject.projectId,
      fixedVideoPromptCount: videoPrompts.length,
      storyboardCount: persisted.length,
      clipCount: episode?.clips.length || 0,
      panelCount,
    }, null, 2)}\n`)
    return
  }

  const session = await getOrCreateTestModeSession()
  const orchestrator = new SuperAgentOrchestrator()
  const context: AgentContext = {
    userId: session.user.id,
    locale: 'zh',
    userInput: story.text,
    executionMode: 'live',
    parameters: {
      storyboardOnly: true,
      narration: 'off',
      shotCount: videoPrompts.length,
      panelsPerShot: 1,
      durationSeconds: videoPrompts.reduce((sum, item) => sum + item.duration, 0),
      tone: '真实、克制、强情绪医疗短剧',
    },
  }

  let plan = await orchestrator.createExecutionPlan(context)
  plan = normalizeAgentExecutionPlan({
    ...plan,
    projectConfig: {
      ...plan.projectConfig,
      name: `Agent资产锁定+固定VideoPrompt ${new Date().toISOString().replace(/[:.]/g, '-')}`,
      videoRatio: '9:16',
      artStyle: 'realistic',
      artStylePrompt: inferMedicalArtStylePrompt(story.text),
    },
    episodeConfig: {
      ...plan.episodeConfig,
      name: '固定视频提示词测试',
    },
    creativeParameters: {
      ...plan.creativeParameters,
      storyboardOnly: true,
      narration: 'off',
      shotCount: videoPrompts.length,
      panelsPerShot: 1,
      durationSeconds: videoPrompts.reduce((sum, item) => sum + item.duration, 0),
      tone: '真实、克制、强情绪医疗短剧',
    },
  } satisfies AgentExecutionPlan)

  const report: Record<string, unknown> = {
    ok: false,
    startedAt,
    storyFile: story.filePath,
    videoPromptDocx: VIDEO_PROMPT_DOCX,
    fixedVideoPromptCount: videoPrompts.length,
    progress: [],
  }
  writeReport(report)

  const recordProgress = (stage: string, details: Record<string, unknown>) => {
    const progress = report.progress as Array<Record<string, unknown>>
    progress.push({ stage, at: new Date().toISOString(), ...details })
    writeReport(report)
    process.stdout.write(`[agent-fixed-docx] ${stage} ${JSON.stringify(details)}\n`)
  }

  recordProgress('stage1.project-init.start', {})
  const stage1 = await (orchestrator as unknown as {
    executeStage1: typeof SuperAgentOrchestrator.prototype['createExecutionPlan']
  } as any).executeStage1(plan, context)
  report.projectId = stage1.projectId
  report.episodeId = stage1.episodeId
  recordProgress('stage1.project-init.done', stage1)

  recordProgress('stage2.llm-script-assets.start', { expectedShotCount: videoPrompts.length })
  const stage2 = await (orchestrator as any).executeStage2(stage1.projectId, stage1.episodeId, context, plan)
  report.stage2 = stage2
  recordProgress('stage2.llm-script-assets.done', stage2)

  recordProgress('stage3.asset-lock.start', {})
  const assetLock = await (orchestrator as any).executeAssetConsistencyStage(stage1.projectId, stage1.episodeId, plan, context)
  report.assetLock = assetLock
  recordProgress('stage3.asset-lock.done', assetLock)

  recordProgress('stage4.asset-image-generation.start', {
    characterAppearanceCount: assetLock.characterAppearanceCount,
    locationImageSlotCount: assetLock.locationImageSlotCount,
    propImageSlotCount: assetLock.propImageSlotCount,
  })
  const assetImageGeneration = await (orchestrator as any).executeAssetImageGenerationStage(
    stage1.projectId,
    context,
    async (progress: Record<string, unknown>) => {
      recordProgress('stage4.asset-image-generation.progress', progress)
    },
  )
  report.assetImageGeneration = assetImageGeneration
  recordProgress('stage4.asset-image-generation.done', assetImageGeneration)

  recordProgress('stage5.fill-fixed-video-prompts.start', { fixedVideoPromptCount: videoPrompts.length })
  const persisted = await fillVideoPrompts(stage1.episodeId, videoPrompts)
  recordProgress('stage5.fill-fixed-video-prompts.done', { storyboardCount: persisted.length })

  const [project, episode, novelProject] = await Promise.all([
    prisma.project.findUnique({ where: { id: stage1.projectId } }),
    prisma.novelPromotionEpisode.findUnique({
      where: { id: stage1.episodeId },
      include: {
        clips: true,
        storyboards: { include: { panels: true } },
      },
    }),
    prisma.novelPromotionProject.findUnique({
      where: { projectId: stage1.projectId },
      include: {
        characters: { include: { appearances: true } },
        locations: { include: { images: true } },
      },
    }),
  ])

  const panelCount = episode?.storyboards.reduce((sum, storyboard) => sum + storyboard.panels.length, 0) || 0
  report.ok = true
  report.completedAt = new Date().toISOString()
  report.workspaceUrl = `/zh/workspace/${stage1.projectId}`
  report.summary = {
    projectName: project?.name,
    clipCount: episode?.clips.length || 0,
    storyboardCount: episode?.storyboards.length || 0,
    panelCount,
    characterCount: novelProject?.characters.length || 0,
    locationCount: novelProject?.locations.filter((item) => item.assetKind !== 'prop').length || 0,
    propCount: novelProject?.locations.filter((item) => item.assetKind === 'prop').length || 0,
    characterAppearanceCount: novelProject?.characters.reduce((sum, item) => sum + item.appearances.length, 0) || 0,
    locationImageSlotCount: novelProject?.locations.reduce((sum, item) => sum + item.images.length, 0) || 0,
    characterAssetImagesReady: novelProject?.characters.reduce(
      (sum, item) => sum + item.appearances.filter((appearance) => appearance.imageUrl || appearance.imageMediaId || appearance.imageUrls).length,
      0,
    ) || 0,
    locationAssetImagesReady: novelProject?.locations.reduce(
      (sum, item) => sum + item.images.filter((image) => image.imageUrl || image.imageMediaId).length,
      0,
    ) || 0,
    firstVideoPromptPreview: videoPrompts[0]?.text.slice(0, 500),
  }
  writeReport(report)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main()
  .catch((error) => {
    const payload = {
      ok: false,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
    writeReport(payload)
    console.error(payload.error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
