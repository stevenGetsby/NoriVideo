import type { Job } from 'bullmq'
import { safeParseJsonArray } from '@/lib/json-repair'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import { resolveAnalysisModel } from './shot-ai-persist'
import type { AnyObj } from './shot-ai-prompt'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { parsePanelCharacterReferences } from './image-task-handler-shared'
import {
  readActingNotesContinuityText,
  readPanelFrameOSMetadataFromActingNotes,
} from '@/lib/novel-promotion/panel-frameos-metadata'

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readRequiredString(value: unknown, field: string): string {
  const text = readText(value).trim()
  if (!text) {
    throw new Error(`${field} is required`)
  }
  return text
}

function parseJsonArrayResponse(responseText: string): AnyObj[] {
  return safeParseJsonArray(responseText) as AnyObj[]
}

function parsePanelCharacters(value: string | null): string {
  if (!value) return '无'
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0) return '无'
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        const record = item as Record<string, unknown>
        const name = readText(record.name)
        const appearance = readText(record.appearance)
        return appearance ? `${name}（${appearance}）` : name
      })
      .filter(Boolean)
      .join('、') || '无'
  } catch {
    return '无'
  }
}

function parsePanelProps(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return item.trim()
        if (!item || typeof item !== 'object') return ''
        const record = item as Record<string, unknown>
        return typeof record.name === 'string' ? record.name.trim() : ''
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function buildPanelContextJson(panel: {
  id: string
  panelNumber: number | null
  description: string | null
  shotType: string | null
  cameraMove: string | null
  location: string | null
  characters: string | null
  props: string | null
  srtSegment: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  sceneType: string | null
  duration: number | null
  photographyRules: string | null
  actingNotes: string | null
}): string {
  const metadata = readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)
  const panelCharacterRefs = parsePanelCharacterReferences(panel.characters)
  const panelPropRefs = parsePanelProps(panel.props)
  const sourceText = typeof metadata?.source_text === 'string' && metadata.source_text.trim()
    ? metadata.source_text
    : panel.srtSegment || ''
  const continuityNotes = [
    metadata?.continuity_notes,
    panel.photographyRules,
    readActingNotesContinuityText(panel.actingNotes),
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n')

  return JSON.stringify({
    panel_id: metadata?.panel_id || panel.id,
    panel_number: typeof metadata?.panel_number === 'number' ? metadata.panel_number : panel.panelNumber ?? null,
    description: panel.description || '',
    source_text: sourceText,
    source_anchor: metadata?.source_anchor ?? (sourceText ? { text: sourceText } : null),
    referenced_assets: metadata?.referenced_assets ?? {
      characters: panelCharacterRefs,
      location: panel.location || null,
      props: panelPropRefs,
    },
    shot_type: panel.shotType || '',
    camera_move: panel.cameraMove || '',
    image_prompt: panel.imagePrompt || '',
    visual_prompt: metadata?.visual_prompt || panel.imagePrompt || '',
    video_prompt: panel.videoPrompt || '',
    visual_style: metadata?.visual_style || '',
    visual_style_description: metadata?.visual_style_description || '',
    continuity_notes: continuityNotes,
    acting_notes: panel.actingNotes || '',
    voice_refs: metadata?.voice_refs || [],
    scene_type: panel.sceneType || '',
    duration: panel.duration ?? null,
  }, null, 2)
}

export async function handleAnalyzeShotVariantsTask(job: Job<TaskJobData>, payload: AnyObj) {
  const panelId = readRequiredString(payload.panelId, 'panelId')
  const novelData = await resolveAnalysisModel(job.data.projectId, job.data.userId)
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      panelNumber: true,
      imageUrl: true,
      description: true,
      shotType: true,
      cameraMove: true,
      location: true,
      characters: true,
      props: true,
      srtSegment: true,
      imagePrompt: true,
      videoPrompt: true,
      sceneType: true,
      duration: true,
      photographyRules: true,
      actingNotes: true,
    },
  })
  if (!panel) throw new Error('Panel not found')
  if (!panel.imageUrl) throw new Error('该镜头还没有生成图片，无法分析变体')

  const imageUrl = panel.imageUrl.startsWith('images/')
    ? getSignedUrl(panel.imageUrl, 3600)
    : panel.imageUrl
  const charactersInfo = parsePanelCharacters(panel.characters)

  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_SHOT_VARIANT_ANALYSIS,
    locale: job.data.locale,
    variables: {
      panel_description: panel.description || '无',
      shot_type: panel.shotType || '中景',
      camera_move: panel.cameraMove || '固定',
      location: panel.location || '未知',
      characters_info: charactersInfo,
      panel_context_json: buildPanelContextJson(panel),
    },
  })

  await reportTaskProgress(job, 20, {
    stage: 'analyze_shot_variants_prepare',
    stageLabel: '准备镜头变体分析参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_shot_variants_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'analyze_shot_variants')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const responseText = await (async () => {
    try {
      const result = await withInternalLLMStreamCallbacks(
        streamCallbacks,
        async () =>
          await executeAiVisionStep({
            userId: job.data.userId,
            model: novelData.analysisModel,
            prompt,
            imageUrls: [imageUrl],
            reasoning: true,
            projectId: job.data.projectId,
            action: 'analyze_shot_variants',
            meta: {
              stepId: 'analyze_shot_variants',
              stepTitle: '镜头变体分析',
              stepIndex: 1,
              stepTotal: 1,
            },
          }),
      )
      return result.text
    } finally {
      await streamCallbacks.flush()
    }
  })()
  await assertTaskActive(job, 'analyze_shot_variants_parse')

  const suggestions = parseJsonArrayResponse(responseText)
  if (!Array.isArray(suggestions) || suggestions.length < 3) {
    throw new Error('生成的变体数量不足')
  }

  await reportTaskProgress(job, 96, {
    stage: 'analyze_shot_variants_done',
    stageLabel: '镜头变体分析完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    suggestions,
    panelInfo: {
      panelNumber: panel.panelNumber,
      imageUrl,
      description: panel.description,
    },
  }
}
