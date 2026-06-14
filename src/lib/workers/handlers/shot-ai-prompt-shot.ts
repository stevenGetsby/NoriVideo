import type { Job } from 'bullmq'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskJobData } from '@/lib/task/types'
import { prisma } from '@/lib/prisma'
import { resolveAnalysisModel } from './shot-ai-persist'
import { runShotPromptCompletion } from './shot-ai-prompt-runtime'
import {
  parseShotPromptResponse,
  readRequiredString,
  readText,
  type AnyObj,
} from './shot-ai-prompt-utils'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  readActingNotesContinuityText,
  readPanelFrameOSMetadataFromActingNotes,
} from '@/lib/novel-promotion/panel-frameos-metadata'

function readPanelId(job: Job<TaskJobData>, payload: AnyObj): string {
  const payloadPanelId = readText(payload.panelId).trim()
  if (payloadPanelId) return payloadPanelId
  return job.data.targetType === 'NovelPromotionPanel' ? job.data.targetId : ''
}

async function readPanelContext(panelId: string) {
  if (!panelId) return null
  return await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      imagePrompt: true,
      videoPrompt: true,
      srtSegment: true,
      photographyRules: true,
      actingNotes: true,
    },
  })
}

export async function handleModifyShotPromptTask(job: Job<TaskJobData>, payload: AnyObj) {
  const currentPrompt = readRequiredString(payload.currentPrompt, 'currentPrompt')
  const currentVideoPrompt = readText(payload.currentVideoPrompt)
  const currentVisualPrompt = readText(payload.currentVisualPrompt)
  const modifyInstruction = readRequiredString(payload.modifyInstruction, 'modifyInstruction')
  const referencedAssets = Array.isArray(payload.referencedAssets) ? payload.referencedAssets : []
  const panel = await readPanelContext(readPanelId(job, payload))
  const metadata = readPanelFrameOSMetadataFromActingNotes(panel?.actingNotes)
  const metadataReferencedAssets = metadata?.referenced_assets ?? null
  const sourceText = readText(payload.sourceText).trim() || metadata?.source_text || panel?.srtSegment || ''
  const visualPrompt = currentVisualPrompt.trim() || metadata?.visual_prompt || panel?.imagePrompt || ''
  const videoPrompt = currentVideoPrompt.trim() || panel?.videoPrompt || ''
  const continuityNotes = [
    metadata?.continuity_notes,
    readText(payload.continuityNotes).trim(),
    panel?.photographyRules,
    readActingNotesContinuityText(panel?.actingNotes),
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n')
  const contextReferencedAssets = referencedAssets.length > 0
    ? referencedAssets
    : metadataReferencedAssets || []
  const panelContext = {
    panel_id: metadata?.panel_id || panel?.id || readText(payload.panelId),
    source_text: sourceText,
    source_anchor: payload.sourceAnchor ?? metadata?.source_anchor ?? (sourceText ? { text: sourceText } : null),
    visual_prompt: visualPrompt,
    video_prompt: videoPrompt,
    visual_style: metadata?.visual_style || '',
    visual_style_description: metadata?.visual_style_description || '',
    continuity_notes: continuityNotes,
    referenced_assets: contextReferencedAssets,
    voice_refs: metadata?.voice_refs || [],
  }
  const novelData = await resolveAnalysisModel(job.data.projectId, job.data.userId)

  const assetDescriptions = referencedAssets
    .map((asset) => {
      if (!asset || typeof asset !== 'object') return ''
      const record = asset as Record<string, unknown>
      const name = readText(record.name).trim()
      const description = readText(record.description).trim()
      if (!name && !description) return ''
      return `${name}(${description})`
    })
    .filter(Boolean)
    .join('，')
  const userInput = assetDescriptions
    ? `${modifyInstruction}\n\n引用的资产描述：${assetDescriptions}`
    : modifyInstruction
  const finalPrompt = buildPrompt({
    promptId: PROMPT_IDS.NP_IMAGE_PROMPT_MODIFY,
    locale: job.data.locale,
    variables: {
      prompt_input: currentPrompt,
      video_prompt_input: videoPrompt || '无',
      panel_context_json: JSON.stringify(panelContext, null, 2),
      referenced_assets_json: JSON.stringify(contextReferencedAssets, null, 2),
      user_input: userInput,
    },
  })

  await reportTaskProgress(job, 22, {
    stage: 'ai_modify_shot_prompt_prepare',
    stageLabel: '准备镜头提示词修改参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'ai_modify_shot_prompt_prepare')

  const responseText = await runShotPromptCompletion({
    job,
    model: novelData.analysisModel,
    prompt: finalPrompt,
    action: 'ai_modify_shot_prompt',
    streamContextKey: 'ai_modify_shot_prompt',
    streamStepId: 'ai_modify_shot_prompt',
    streamStepTitle: '镜头提示词修改',
  })
  await assertTaskActive(job, 'ai_modify_shot_prompt_parse')

  const parsed = parseShotPromptResponse(responseText)

  await reportTaskProgress(job, 96, {
    stage: 'ai_modify_shot_prompt_done',
    stageLabel: '镜头提示词修改完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    modifiedImagePrompt: parsed.imagePrompt,
    modifiedVisualPrompt: parsed.visualPrompt,
    modifiedVideoPrompt: parsed.videoPrompt,
    referencedAssets: parsed.referencedAssets ?? contextReferencedAssets,
    continuityNotes: parsed.continuityNotes,
    changeSummary: parsed.changeSummary,
  }
}
