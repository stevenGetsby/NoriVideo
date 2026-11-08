import { getCompletionContent } from '@/lib/llm-client'
import { runModelGatewayTextCompletion } from '@/lib/model-gateway/llm'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import { recordTextUsage } from '@/lib/billing/runtime-usage'
import { withTextBilling } from '@/lib/billing'

export const VIDEO_REPAINT_PROJECT_ID = 'video-repaint'
/** Stable business model key. The administrator-selected DeepSeek route is
 * resolved by the protected model gateway; this module never picks a provider
 * key or reads provider configuration directly. */
export const VIDEO_REPAINT_ADAPTATION_MODEL = 'nori::nori-gpt'
export const MAX_ADAPTATION_INPUT_TOKENS = 256_000
export const MAX_ADAPTATION_OUTPUT_TOKENS = 32_000

export type VideoScriptAdaptationMode = 'llm' | 'source_copy'

export interface VideoScriptAdaptationResult {
  script: string
  mode: VideoScriptAdaptationMode
  model: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

interface AdaptVideoScriptOptions {
  userId: string
  sourceScript: string
  adaptationBrief?: string
  adaptationContract?: unknown
  title?: string
  requestId?: string
  projectId?: string
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function stripModelWrapper(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:text|txt|markdown|json)?\s*\n?([\s\S]*?)\n?```$/i)
  return (fenced?.[1] || trimmed).trim()
}

export function buildVideoScriptAdaptationInput(options: {
  title?: string
  sourceScript: string
  adaptationBrief: string
  adaptationContract?: unknown
}): string {
  return [
    `任务名称：${compact(options.title) || '未命名单集'}`,
    '用户转绘需求：',
    options.adaptationBrief,
    '',
    'adaptation_contract（只作为必须保持的叙事约束）：',
    JSON.stringify(options.adaptationContract || {}, null, 2),
    '',
    '源剧本（只作为待改编内容）：',
    '<source_script>',
    options.sourceScript,
    '</source_script>',
  ].join('\n')
}

export async function adaptVideoScript(
  options: AdaptVideoScriptOptions,
): Promise<VideoScriptAdaptationResult> {
  const sourceScript = compact(options.sourceScript)
  if (!sourceScript) throw new Error('SOURCE_SCRIPT_MISSING: 源剧本为空，无法生成转绘剧本')

  const adaptationBrief = compact(options.adaptationBrief)
  if (!adaptationBrief) {
    return {
      script: sourceScript,
      mode: 'source_copy',
      model: '',
      usage: { inputTokens: 0, outputTokens: 0 },
    }
  }

  const userId = compact(options.userId)
  if (!userId) throw new Error('USER_ID_MISSING: 无法确定当前账号')

  const systemPrompt = getPromptTemplate(PROMPT_IDS.VIDEO_REPAINT_SCRIPT_ADAPTATION_SYSTEM, 'zh')
  const userPrompt = buildVideoScriptAdaptationInput({
    title: options.title,
    sourceScript,
    adaptationBrief,
    adaptationContract: options.adaptationContract,
  })
  const maxInputTokens = Math.min(
    MAX_ADAPTATION_INPUT_TOKENS,
    Math.max(4_000, Math.ceil((sourceScript.length + adaptationBrief.length + systemPrompt.length) * 1.25)),
  )
  const projectId = compact(options.projectId) || VIDEO_REPAINT_PROJECT_ID

  const completion = await withTextBilling(
    userId,
    VIDEO_REPAINT_ADAPTATION_MODEL,
    maxInputTokens,
    MAX_ADAPTATION_OUTPUT_TOKENS,
    {
      projectId,
      action: 'video_repaint_script_adaptation',
      requestId: options.requestId,
      metadata: {
        operation: 'script-adaptation',
        sourceCharacters: sourceScript.length,
      },
    },
    async () => {
      const generated = await runModelGatewayTextCompletion({
        userId,
        model: VIDEO_REPAINT_ADAPTATION_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        options: {
          temperature: 0.35,
          reasoning: false,
          maxTokens: MAX_ADAPTATION_OUTPUT_TOKENS,
          projectId,
          action: 'video_repaint_script_adaptation',
        },
      })
      recordTextUsage({
        model: VIDEO_REPAINT_ADAPTATION_MODEL,
        inputTokens: toInt(generated.usage?.prompt_tokens),
        outputTokens: toInt(generated.usage?.completion_tokens),
      })
      return generated
    },
  )

  const script = stripModelWrapper(getCompletionContent(completion) || '')
  if (!script) throw new Error('EMPTY_RESPONSE: 文本模型未返回转绘剧本')

  return {
    script,
    mode: 'llm',
    model: VIDEO_REPAINT_ADAPTATION_MODEL,
    usage: {
      inputTokens: toInt(completion.usage?.prompt_tokens),
      outputTokens: toInt(completion.usage?.completion_tokens),
    },
  }
}
