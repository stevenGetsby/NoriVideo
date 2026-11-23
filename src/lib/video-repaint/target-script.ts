import { withTextBilling } from '@/lib/billing'
import { recordTextUsage } from '@/lib/billing/runtime-usage'
import { getCompletionContent } from '@/lib/llm-client'
import { runModelGatewayTextCompletion } from '@/lib/model-gateway/llm'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import { VIDEO_REPAINT_PROJECT_ID, type RepaintTargetScriptResult } from './contract'
import { compactSourceUnderstanding, stripModelWrapper, VIDEO_REPAINT_OUTLINE_MODEL } from './outline'
import { countStoryboardDialogue, isSpokenDialogueLine } from './storyboard-text'

export const MAX_TARGET_SCRIPT_INPUT_TOKENS = 256_000
export const MAX_TARGET_SCRIPT_OUTPUT_TOKENS = 48_000

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function sourceDialogueCount(sourceScript: string): number {
  return sourceScript.split(/\r?\n/).filter(isSpokenDialogueLine).length
}

export function buildTargetScriptInput(options: {
  title?: string
  brief?: string
  outline: string
  sourceScript: string
  sourceAnalysis?: unknown
  durationSeconds?: number
}): string {
  return [
    `任务名称：${compact(options.title) || '未命名单集'}`,
    `视频总时长：${typeof options.durationSeconds === 'number' && options.durationSeconds > 0 ? `${options.durationSeconds.toFixed(1)} 秒（最后一镜结束于此）` : '以源剧本时长信息为准'}`,
    `源剧本共有 ${sourceDialogueCount(options.sourceScript)} 行对白、画外音或内心独白。只要此数大于 0，目标剧本就必须逐条保留对应台词，按“目标名 (对口型·情绪)：{完整台词}”写入所属 SH 镜内，不能省略。`,
    '',
    '转绘需求：',
    compact(options.brief) || '（用户没有填写转绘需求）',
    '',
    '目标设定总纲：',
    '<target_outline>',
    compact(options.outline),
    '</target_outline>',
    '',
    '源剧本：',
    '<source_script>',
    compact(options.sourceScript),
    '</source_script>',
    '',
    '源内容理解（节选）：',
    '<source_understanding>',
    compactSourceUnderstanding(options.sourceAnalysis),
    '</source_understanding>',
  ].join('\n')
}

export interface GenerateTargetScriptOptions {
  userId: string
  title?: string
  brief?: string
  sourceScript: string
  sourceAnalysis?: unknown
  durationSeconds?: number
  outline: string
  requestId?: string
  projectId?: string
}

export async function generateTargetScript(options: GenerateTargetScriptOptions): Promise<RepaintTargetScriptResult> {
  const sourceScript = compact(options.sourceScript)
  const outline = compact(options.outline)
  const userId = compact(options.userId)
  if (!sourceScript) throw new Error('SOURCE_SCRIPT_MISSING: 源剧本为空，无法生成目标剧本')
  if (!outline) throw new Error('TARGET_OUTLINE_MISSING: 目标设定总纲为空，无法生成目标剧本')
  if (!userId) throw new Error('USER_ID_MISSING: 无法确定当前账号')

  const systemPrompt = getPromptTemplate(PROMPT_IDS.VIDEO_REPAINT_TARGET_SCRIPT_SYSTEM, 'zh')
  const userPrompt = buildTargetScriptInput({ ...options, sourceScript, outline })
  const maxInputTokens = Math.min(
    MAX_TARGET_SCRIPT_INPUT_TOKENS,
    Math.max(4_000, Math.ceil((systemPrompt.length + userPrompt.length) * 1.25)),
  )
  const projectId = compact(options.projectId) || VIDEO_REPAINT_PROJECT_ID
  const completion = await withTextBilling(
    userId,
    VIDEO_REPAINT_OUTLINE_MODEL,
    maxInputTokens,
    MAX_TARGET_SCRIPT_OUTPUT_TOKENS,
    {
      projectId,
      action: 'video_repaint_target_script',
      requestId: options.requestId,
      metadata: {
        operation: 'target-script',
        sourceCharacters: sourceScript.length,
        outlineCharacters: outline.length,
        hasBrief: compact(options.brief).length > 0,
      },
    },
    async () => {
      const generated = await runModelGatewayTextCompletion({
        userId,
        model: VIDEO_REPAINT_OUTLINE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        options: {
          temperature: 0.35,
          reasoning: false,
          maxTokens: MAX_TARGET_SCRIPT_OUTPUT_TOKENS,
          projectId,
          action: 'video_repaint_target_script',
        },
      })
      recordTextUsage({
        model: VIDEO_REPAINT_OUTLINE_MODEL,
        inputTokens: toInt(generated.usage?.prompt_tokens),
        outputTokens: toInt(generated.usage?.completion_tokens),
      })
      return generated
    },
  )

  const targetScript = stripModelWrapper(getCompletionContent(completion) || '')
  if (!targetScript) throw new Error('EMPTY_RESPONSE: 文本模型未返回目标剧本')
  const sourceDialogues = sourceDialogueCount(sourceScript)
  const targetDialogues = countStoryboardDialogue(targetScript)
  if (sourceDialogues > 0 && targetDialogues < sourceDialogues) {
    throw new Error(`DIALOGUE_MISSING: 目标剧本只保留了 ${targetDialogues}/${sourceDialogues} 行源台词，请重新生成`)
  }
  return {
    targetScript,
    model: VIDEO_REPAINT_OUTLINE_MODEL,
    usage: {
      inputTokens: toInt(completion.usage?.prompt_tokens),
      outputTokens: toInt(completion.usage?.completion_tokens),
    },
  }
}
