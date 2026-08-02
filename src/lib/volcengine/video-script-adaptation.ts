import { arkResponsesCompletion, convertChatMessagesToArkInput } from '@/lib/ark-llm'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import { getServiceVideoRepaintConfig } from '@/lib/service-config'

const DEFAULT_ADAPTATION_MODEL = 'doubao-seed-2-1-pro-260628'

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
  apiKey: string
  sourceScript: string
  adaptationBrief?: string
  adaptationContract?: unknown
  title?: string
  model?: string
  invoke?: typeof arkResponsesCompletion
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stripModelWrapper(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:text|txt|markdown)?\s*\n?([\s\S]*?)\n?```$/i)
  return (fenced?.[1] || trimmed).trim()
}

export function getVideoScriptAdaptationModel(): string {
  return compact(getServiceVideoRepaintConfig()?.adaptationModel)
    || compact(process.env.ARK_VIDEO_ADAPTATION_MODEL)
    || compact(process.env.ARK_VIDEO_UNDERSTANDING_MODEL)
    || DEFAULT_ADAPTATION_MODEL
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

export async function adaptVideoScriptWithArk(
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

  const apiKey = compact(options.apiKey)
  if (!apiKey) throw new Error('PROVIDER_API_KEY_MISSING: ark')
  const model = compact(options.model) || getVideoScriptAdaptationModel()
  const invoke = options.invoke || arkResponsesCompletion
  const result = await invoke({
    apiKey,
    model,
    input: convertChatMessagesToArkInput([
      {
        role: 'system',
        content: getPromptTemplate(PROMPT_IDS.VIDEO_REPAINT_SCRIPT_ADAPTATION_SYSTEM, 'zh'),
      },
      {
        role: 'user',
        content: buildVideoScriptAdaptationInput({
          title: options.title,
          sourceScript,
          adaptationBrief,
          adaptationContract: options.adaptationContract,
        }),
      },
    ]),
    thinking: { type: 'enabled' },
  })
  const script = stripModelWrapper(result.text)
  if (!script) throw new Error('EMPTY_RESPONSE: 文本模型未返回转绘剧本')

  return {
    script,
    mode: 'llm',
    model,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    },
  }
}
