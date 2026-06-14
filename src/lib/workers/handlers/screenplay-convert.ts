import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { buildCharactersIntroduction } from '@/lib/constants'
import { TaskTerminatedError } from '@/lib/task/errors'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { logAIAnalysis } from '@/lib/logging/semantic'
import { onProjectNameAvailable } from '@/lib/logging/file-writer'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import {
  type AnyObj,
  parseScreenplayPayload,
  readText,
} from './screenplay-convert-helpers'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { buildFrameosProductionContext } from '@/lib/novel-promotion/frameos-production-context'

const MAX_SCREENPLAY_ATTEMPTS = 2

function readAssetKind(value: Record<string, unknown>): string {
  return typeof value.assetKind === 'string' ? value.assetKind : 'location'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSourceAnchorObject(value: unknown): { start: string; end: string } | null {
  if (!isRecord(value)) return null
  const start = readText(value.start).trim()
  const end = readText(value.end).trim()
  if (!start && !end) return null
  return { start, end }
}

function buildClipSourceAnchor(
  clip: { startText?: string | null; endText?: string | null },
): { start: string; end: string } | null {
  const start = readText(clip.startText).trim()
  const end = readText(clip.endText).trim()
  if (!start && !end) return null
  return { start, end }
}

function withFrameosArtDirection(screenplay: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(screenplay.art_direction)) return screenplay

  const worlds = Array.isArray(screenplay.worlds) ? screenplay.worlds : []
  const defaultVisualStyle = isRecord(screenplay.default_visual_style)
    ? screenplay.default_visual_style
    : null

  if (worlds.length === 0 && !defaultVisualStyle) return screenplay

  return {
    ...screenplay,
    art_direction: {
      flow_status: readText(screenplay.status).trim() || 'draft',
      flow_id: readText(screenplay.clip_id).trim(),
      current_label: defaultVisualStyle
        ? readText(defaultVisualStyle.name).trim()
        : '',
      derived_phase: 'screenplay_conversion',
      default_world_label: isRecord(worlds[0]) ? readText(worlds[0].world_label).trim() : '',
      worlds,
    },
  }
}

function withClipBoundaryMetadata(
  screenplay: Record<string, unknown>,
  clip: { startText?: string | null; endText?: string | null; summary?: string | null },
): Record<string, unknown> {
  const next = withFrameosArtDirection({ ...screenplay })
  const existingSourceAnchor = readSourceAnchorObject(next.source_anchor)
  const fallbackSourceAnchor = buildClipSourceAnchor(clip)
  const summary = readText(clip.summary).trim()

  if (!existingSourceAnchor && fallbackSourceAnchor) {
    next.source_anchor = fallbackSourceAnchor
  } else if (existingSourceAnchor) {
    next.source_anchor = existingSourceAnchor
  }
  if (summary && !Array.isArray(next.info_points)) {
    next.info_points = [summary]
  }

  return next
}

export async function handleScreenplayConvertTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const episodeId = readText(payload.episodeId || job.data.episodeId).trim()
  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: true,
    },
  })
  if (!novelData) {
    throw new Error('Novel promotion data not found')
  }
  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!episode) {
    throw new Error('Episode not found')
  }
  if (episode.novelPromotionProjectId !== novelData.id) {
    throw new Error('Episode does not belong to this project')
  }
  if (episode.clips.length === 0) {
    throw new Error('No clips found, please split clips first')
  }

  const locationAssets = novelData.locations.filter((item) => readAssetKind(item as unknown as Record<string, unknown>) !== 'prop')
  const propAssets = novelData.locations.filter((item) => readAssetKind(item as unknown as Record<string, unknown>) === 'prop')
  const charactersLibName = novelData.characters.map((item) => item.name).join('、') || '无'
  const locationsLibName = locationAssets.map((item) => item.name).join('、') || '无'
  const propsLibName = propAssets.map((item) => item.name).join('、') || '无'
  const charactersIntroduction = buildCharactersIntroduction(novelData.characters)
  const projectProductionContext = buildFrameosProductionContext({
    project,
    novelProject: novelData as unknown as Record<string, unknown>,
    episode: episode as unknown as Record<string, unknown>,
    payload,
  })

  await reportTaskProgress(job, 10, {
    stage: 'screenplay_convert_prepare',
    stageLabel: '准备剧本转换参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'screenplay_convert_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'screenplay_convert')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const total = episode.clips.length
  const results: Array<{
    clipId: string
    success: boolean
    sceneCount?: number
    error?: string
  }> = []

  for (let i = 0; i < total; i += 1) {
    const clip = episode.clips[i]
    const stepIndex = i + 1
    const stepId = `screenplay_clip_${clip.id}`
    const stepTitle = `片段剧本转换 ${stepIndex}/${total}`
    const progress = 15 + Math.min(70, Math.floor((stepIndex / Math.max(1, total)) * 70))

    await assertTaskActive(job, `screenplay_convert_step:${clip.id}`)
    await reportTaskProgress(job, progress, {
      stage: 'screenplay_convert_step',
      stageLabel: '执行剧本转换',
      displayMode: 'detail',
      message: stepTitle,
      stepId,
      stepTitle,
      stepIndex,
      stepTotal: total,
    })

    try {
      const clipContent = readText(clip.content).trim()
      if (!clipContent) {
        throw new Error(`clip ${clip.id} content is empty`)
      }

      const prompt = buildPrompt({
        promptId: PROMPT_IDS.NP_SCREENPLAY_CONVERSION,
        locale: job.data.locale,
        variables: {
          clip_content: clipContent,
          locations_lib_name: locationsLibName,
          characters_lib_name: charactersLibName,
          props_lib_name: propsLibName,
          characters_introduction: charactersIntroduction,
          project_production_context: projectProductionContext,
          clip_id: clip.id,
        },
      })

      // 记录 prompt 输入
      onProjectNameAvailable(projectId, project.name)
      logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
        action: `SCREENPLAY_CONVERT_PROMPT`,
        input: { stepId, stepTitle, prompt },
        model: analysisModel,
      })

      let screenplayStored = false
      let stepLastError: Error | null = null
      for (let attempt = 1; attempt <= MAX_SCREENPLAY_ATTEMPTS; attempt += 1) {
        try {
          const completion = await (async () => {
            try {
              return await withInternalLLMStreamCallbacks(
                streamCallbacks,
                async () =>
                  await executeAiTextStep({
                    userId: job.data.userId,
                    model: analysisModel,
                    messages: [{ role: 'user', content: prompt }],
                    reasoning: true,
                    maxTokens: 5_500,
                    projectId,
                    action: 'screenplay_conversion',
                    meta: {
                      stepId,
                      stepAttempt: attempt,
                      stepTitle,
                      stepIndex,
                      stepTotal: total,
                    },
                  }),
              )
            } finally {
              await streamCallbacks.flush()
            }
          })()

          const responseText = completion.text
          if (!responseText || !responseText.trim()) {
            throw new Error('AI returned empty response')
          }

          // 记录 AI 输出
          logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
            action: `SCREENPLAY_CONVERT_OUTPUT`,
            output: {
              stepId,
              stepTitle,
              attempt,
              rawText: responseText,
              textLength: responseText.length,
            },
            model: analysisModel,
          })

          const parsedScreenplay = parseScreenplayPayload(responseText)
          parsedScreenplay.clip_id = clip.id
          parsedScreenplay.original_text = clipContent
          const screenplay = withClipBoundaryMetadata(parsedScreenplay, clip)

          await prisma.novelPromotionClip.update({
            where: { id: clip.id },
            data: {
              screenplay: JSON.stringify(screenplay),
            },
          })

          const scenes = Array.isArray(screenplay.scenes) ? screenplay.scenes : []
          results.push({
            clipId: clip.id,
            success: true,
            sceneCount: scenes.length,
          })
          screenplayStored = true
          break
        } catch (error) {
          if (error instanceof TaskTerminatedError) {
            throw error
          }
          stepLastError = error instanceof Error ? error : new Error(String(error))
        }
      }

      if (!screenplayStored) {
        throw stepLastError || new Error(`clip ${clip.id} screenplay conversion failed`)
      }
    } catch (error) {
      if (error instanceof TaskTerminatedError) {
        throw error
      }
      results.push({
        clipId: clip.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const successCount = results.filter((item) => item.success).length
  const failCount = results.length - successCount
  const totalScenes = results.reduce((sum, item) => sum + (item.sceneCount || 0), 0)

  if (failCount > 0) {
    const failedItems = results
      .filter((item) => !item.success)
      .map((item) => `${item.clipId}:${item.error || 'unknown error'}`)
    const preview = failedItems.slice(0, 3).join(' | ')
    throw new Error(
      `SCREENPLAY_CONVERT_PARTIAL_FAILED: ${failCount}/${total} clips failed. ${preview}`,
    )
  }

  await reportTaskProgress(job, 96, {
    stage: 'screenplay_convert_done',
    stageLabel: '剧本转换结果已保存',
    displayMode: 'detail',
    message: `完成 ${successCount}/${total} 个片段`,
  })

  return {
    episodeId,
    total,
    successCount,
    failCount,
    totalScenes,
    results,
  }
}
