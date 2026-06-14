import type { Job } from 'bullmq'
import { safeParseJsonObject } from '@/lib/json-repair'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { countWords } from '@/lib/word-count'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { getProjectModelConfig } from '@/lib/config-service'
import { LUMINA_GPT55_MODEL_KEY } from '@/lib/lumina-fixed-models'
import { buildEpisodeFrameOSMetadata, type EpisodeFrameOSMetadata } from '@/lib/novel-promotion/episode-frameos-metadata'
import { createTextMarkerMatcher } from '@/lib/novel-promotion/story-to-script/clip-matching'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

type EpisodeSplit = {
  number?: number
  episode_id?: string
  episode_number?: number
  title?: string
  summary?: string
  estimatedWords?: number
  content_kilo?: number
  startMarker?: string
  endMarker?: string
  startIndex?: number
  endIndex?: number
  source_anchor?: unknown
  info_points?: unknown
  reasoning?: unknown
  status?: string
  scenes?: unknown
}

type SplitResponse = {
  status?: string
  steps?: unknown
  default_visual_style?: unknown
  script_kilo?: number
  adapted_kilo?: number
  analysis?: unknown
  episodes?: EpisodeSplit[]
  items?: EpisodeSplit[]
  validation?: unknown
}

const MAX_EPISODE_SPLIT_ATTEMPTS = 2
const EPISODE_SPLIT_BOUNDARY_SUFFIX = `

[Boundary Constraints]
1. Each episode MUST include both startMarker and endMarker from the original text.
2. Markers must be locatable in the original text; allow punctuation/whitespace differences only.
3. If boundaries cannot be located reliably, return an empty episodes array.`

function parseSplitResponse(aiResponse: string): SplitResponse {
  const parsed = safeParseJsonObject(aiResponse) as SplitResponse
  const rows = Array.isArray(parsed.episodes) && parsed.episodes.length > 0
    ? parsed.episodes
    : parsed.items
  if (!parsed || !Array.isArray(rows) || rows.length === 0) {
    throw new Error('Failed to parse AI response: invalid episodes payload')
  }
  if (!Array.isArray(parsed.episodes) || parsed.episodes.length === 0) {
    parsed.episodes = rows
  }
  return parsed
}

function readBoundaryMarker(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const marker = value.trim()
  return marker.length > 0 ? marker : null
}

function toValidBoundaryIndex(value: unknown, textLength: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const idx = Math.floor(value)
  if (idx < 0 || idx > textLength) return null
  return idx
}

export async function handleEpisodeSplitTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const projectId = job.data.projectId
  const content = typeof payload.content === 'string' ? payload.content : ''
  if (!content || content.length < 100) {
    throw new Error('文本太短，至少需要 100 字')
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }

  const novelProject = await prisma.novelPromotionProject.findFirst({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    throw new Error('Novel promotion data not found')
  }

  const projectConfig = await getProjectModelConfig(projectId, job.data.userId)
  const analysisModel = projectConfig.analysisModel || LUMINA_GPT55_MODEL_KEY

  const promptBase = buildPrompt({
    promptId: PROMPT_IDS.NP_EPISODE_SPLIT,
    locale: job.data.locale,
    variables: {
      CONTENT: content,
    },
  })
  const prompt = `${promptBase}${EPISODE_SPLIT_BOUNDARY_SUFFIX}`

  await reportTaskProgress(job, 20, {
    stage: 'episode_split_prepare',
    stageLabel: '准备分集参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'episode_split_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'episode_split')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  type EpisodeOutput = {
    number: number
    title: string
    summary: string
    content: string
    wordCount: number
    frameosMetadata?: EpisodeFrameOSMetadata
  }
  let episodes: EpisodeOutput[] | null = null
  let lastError: Error | null = null

  try {
    for (let attempt = 1; attempt <= MAX_EPISODE_SPLIT_ATTEMPTS; attempt += 1) {
      try {
        await assertTaskActive(job, `episode_split_attempt:${attempt}`)
        const completion = await withInternalLLMStreamCallbacks(
          streamCallbacks,
          async () =>
            await executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.3,
              reasoning: true,
              reasoningEffort: 'high',
              projectId,
              action: 'episode_split',
              meta: {
                stepId: 'episode_split',
                stepAttempt: attempt,
                stepTitle: '智能分集',
                stepIndex: 1,
                stepTotal: 1,
              },
            }),
        )

        const aiResponse = completion.text
        if (!aiResponse) {
          throw new Error('AI 返回为空')
        }

        await reportTaskProgress(job, 60, {
          stage: 'episode_split_parse',
          stageLabel: attempt === 1 ? '解析分集结果' : `解析分集结果（重试 ${attempt - 1}）`,
          displayMode: 'detail',
        })
        await assertTaskActive(job, 'episode_split_parse')

        const splitResult = parseSplitResponse(aiResponse)
        const splitEpisodes = splitResult.episodes || []
        if (splitEpisodes.length === 0) {
          throw new Error('分集结果为空')
        }

        await reportTaskProgress(job, 80, {
          stage: 'episode_split_match',
          stageLabel: '匹配剧集内容范围',
          displayMode: 'detail',
        })
        const markerMatcher = createTextMarkerMatcher(content)
        const resolved: EpisodeOutput[] = []
        let searchFrom = 0

        for (let idx = 0; idx < splitEpisodes.length; idx += 1) {
          await assertTaskActive(job, `episode_split_match:${idx + 1}`)
          const ep = splitEpisodes[idx]
          const episodeNumber =
            typeof ep.number === 'number' && Number.isFinite(ep.number) && ep.number > 0
              ? Math.floor(ep.number)
              : null
          if (episodeNumber === null) {
            throw new Error(`episode_${idx + 1} 缺少有效 number`)
          }

          const title = typeof ep.title === 'string' ? ep.title.trim() : ''
          if (!title) {
            throw new Error(`episode_${idx + 1} 缺少 title`)
          }

          const startMarker = readBoundaryMarker(ep.startMarker)
          const endMarker = readBoundaryMarker(ep.endMarker)
          if (!startMarker || !endMarker) {
            throw new Error(`episode_${idx + 1} 必须同时提供 startMarker/endMarker`)
          }

          const startMatch = markerMatcher.matchMarker(startMarker, searchFrom)
          if (!startMatch) {
            throw new Error(`episode_${idx + 1} startMarker 无法定位`)
          }
          const endMatch = markerMatcher.matchMarker(endMarker, startMatch.endIndex)
          if (!endMatch) {
            throw new Error(`episode_${idx + 1} endMarker 无法定位`)
          }

          const rawStartIndex = toValidBoundaryIndex(ep.startIndex, content.length)
          if (rawStartIndex !== null && Math.abs(rawStartIndex - startMatch.startIndex) > 200) {
            throw new Error(`episode_${idx + 1} startIndex 与 marker 偏差过大`)
          }
          const rawEndIndex = toValidBoundaryIndex(ep.endIndex, content.length)
          if (rawEndIndex !== null && Math.abs(rawEndIndex - endMatch.endIndex) > 200) {
            throw new Error(`episode_${idx + 1} endIndex 与 marker 偏差过大`)
          }

          const startPos = startMatch.startIndex
          const endPos = endMatch.endIndex
          if (startPos < searchFrom || endPos <= startPos || endPos > content.length) {
            throw new Error(`episode_${idx + 1} 边界区间无效`)
          }

          const episodeContent = content.slice(startPos, endPos).trim()
          if (!episodeContent) {
            throw new Error(`episode_${idx + 1} 匹配内容为空`)
          }

          const frameosMetadata = buildEpisodeFrameOSMetadata({
            episode_id: ep.episode_id,
            episode_number: ep.episode_number ?? episodeNumber,
            status: ep.status ?? splitResult.status,
            content_kilo: ep.content_kilo,
            estimatedWords: ep.estimatedWords,
            source_anchor: ep.source_anchor,
            info_points: ep.info_points,
            reasoning: ep.reasoning,
            scenes: ep.scenes,
            analysis: splitResult.analysis,
            validation: splitResult.validation,
          })

          resolved.push({
            number: episodeNumber,
            title,
            summary: typeof ep.summary === 'string' ? ep.summary : '',
            content: episodeContent,
            wordCount: countWords(episodeContent),
            ...(frameosMetadata ? { frameosMetadata } : {}),
          })
          searchFrom = endPos
        }

        episodes = resolved
        break
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
  } finally {
    await streamCallbacks.flush()
  }

  if (!episodes) {
    throw lastError || new Error('分集边界匹配失败')
  }

  await reportTaskProgress(job, 96, {
    stage: 'episode_split_done',
    stageLabel: '智能分集完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    episodes,
  }
}
