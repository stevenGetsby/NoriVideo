import { getCompletionContent } from '@/lib/llm-client'
import { runModelGatewayTextCompletion } from '@/lib/model-gateway/llm'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import { recordTextUsage } from '@/lib/billing/runtime-usage'
import { withTextBilling } from '@/lib/billing'
import {
  REPAINT_OUTLINE_SECTION_TITLES,
  VIDEO_REPAINT_PROJECT_ID,
  type RepaintOutlineResult,
} from './contract'

/**
 * Stage C of the 转绘: the text model writes the 目标设定总纲 from the user's brief, the source script and an excerpt
 * of what the video model understood. It always runs, even with an empty brief; the outline then pins the source's own
 * names, props and limits so the repaint does not drift.
 */

/** Stable business model key. The administrator-selected route is resolved by the protected model gateway; this
 * module never picks a provider key or reads provider configuration directly. */
export const VIDEO_REPAINT_OUTLINE_MODEL = 'nori::nori-gpt'
export const MAX_OUTLINE_INPUT_TOKENS = 256_000
export const MAX_OUTLINE_OUTPUT_TOKENS = 32_000

// The excerpt is context, not the script: it keeps the characters, places, props and the adaptation contract, and
// leaves out the scene-by-scene beats the source script already carries.
const EXCERPT_LIMITS = [
  { items: 40, text: 600 },
  { items: 12, text: 200 },
] as const
const MAX_EXCERPT_CHARS = 60_000
const MAX_EXCERPT_DEPTH = 5
const OMITTED_KEYS = new Set(['evidence_ranges'])
const EMPTY_BRIEF_NOTE = '（用户没有填写转绘需求）'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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

function tidyValue(value: unknown, depth: number, limits: { items: number; text: number }): unknown {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? text.slice(0, limits.text) : undefined
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (depth >= MAX_EXCERPT_DEPTH) return undefined
  if (Array.isArray(value)) {
    const items = value
      .slice(0, limits.items)
      .map((item) => tidyValue(item, depth + 1, limits))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([key]) => !OMITTED_KEYS.has(key))
      .map(([key, item]) => [key, tidyValue(item, depth + 1, limits)] as const)
      .filter(([, item]) => item !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  return undefined
}

/**
 * The part of the video model's analysis the head writer needs, as JSON text. Empty fields are dropped and long lists
 * and strings are cut so a long video cannot push the prompt past the text model's window.
 */
export function compactSourceUnderstanding(analysis: unknown): string {
  if (!isRecord(analysis)) return '{}'
  const episode = isRecord(analysis.source_episode) ? analysis.source_episode : {}
  const assets = isRecord(analysis.asset_candidates) ? analysis.asset_candidates : {}
  const quality = isRecord(analysis.quality_report) ? analysis.quality_report : {}
  const excerpt = {
    series_metadata: analysis.series_metadata,
    source_episode: {
      episode_title: episode.episode_title,
      episode_synopsis: episode.episode_synopsis,
      duration_seconds: episode.duration_seconds,
      opening_hook: episode.opening_hook,
      turning_points: episode.turning_points,
      ending_hook: episode.ending_hook,
    },
    asset_candidates: {
      characters: assets.characters,
      locations: assets.locations,
      props: assets.props,
    },
    adaptation_contract: analysis.adaptation_contract,
    quality_report: {
      uncertainties: quality.uncertainties,
      unresolved_speakers: quality.unresolved_speakers,
    },
  }
  let text = '{}'
  for (const limits of EXCERPT_LIMITS) {
    text = JSON.stringify(tidyValue(excerpt, 0, limits) ?? {}, null, 2)
    if (text.length <= MAX_EXCERPT_CHARS) return text
  }
  return text.slice(0, MAX_EXCERPT_CHARS)
}

/** The user message, in the order the system prompt promises: brief, source script, source understanding. */
export function buildTargetOutlineInput(options: {
  title?: string
  brief?: string
  sourceScript: string
  sourceAnalysis?: unknown
}): string {
  return [
    `任务名称：${compact(options.title) || '未命名单集'}`,
    '',
    '转绘需求：',
    compact(options.brief) || EMPTY_BRIEF_NOTE,
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

// A chapter heading is "N. 标题" in the contract, but models decorate it: "## 3、标题", "**3. 标题**", a bare title.
const HEADING_LINE = /^[\s>#*_]*(?:\d{1,2}\s*[.．、)）]\s*)?(.+?)[\s*_:：]*$/
const HEADING_KEYS = REPAINT_OUTLINE_SECTION_TITLES.map((title) => squash(title))

function squash(text: string): string {
  return text.replace(/[\s#*_`>:：。.,，、（）()]/g, '')
}

/**
 * The chapter a line heads, 1 to 10, or 0. Only chapters after `after` count, so a body line that happens to repeat a
 * title is not taken for a heading, and the numeral is ignored: the title decides.
 */
function headingNumber(line: string, after: number): number {
  const match = line.match(HEADING_LINE)
  if (!match) return 0
  const label = squash(match[1].replace(/[（(][^）)]*[）)]\s*$/, ''))
  for (let index = Math.max(after, 0); index < HEADING_KEYS.length; index += 1) {
    const key = HEADING_KEYS[index]
    if (label === key || (label.startsWith(key) && label.length <= key.length + 4)) return index + 1
  }
  return 0
}

/**
 * The outline as the contract wants it: no code fence, nothing before the first chapter, every heading written exactly
 * "N. 标题", one blank line between chapters. The body of the chapters is left as the model wrote it.
 */
export function tidyOutline(raw: string): string {
  const stripped = stripModelWrapper(raw)
  const lines: string[] = []
  let chapter = 0
  for (const line of stripped.split(/\r?\n/)) {
    const heading = headingNumber(line, chapter)
    if (heading > 0) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      lines.push(`${heading}. ${REPAINT_OUTLINE_SECTION_TITLES[heading - 1]}`)
      chapter = heading
      continue
    }
    if (chapter > 0) lines.push(line.replace(/\s+$/, ''))
  }
  if (chapter === 0) return stripped
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Chapter numbers (1-10) that are absent or have nothing under their heading. "无" with its grounds counts as written. */
export function missingOutlineSections(outline: string): number[] {
  const written = new Set<number>()
  let chapter = 0
  for (const line of outline.split(/\r?\n/)) {
    const heading = headingNumber(line, chapter)
    if (heading > 0) {
      chapter = heading
      continue
    }
    if (chapter > 0 && line.trim()) written.add(chapter)
  }
  return REPAINT_OUTLINE_SECTION_TITLES
    .map((_, index) => index + 1)
    .filter((number) => !written.has(number))
}

export interface GenerateTargetOutlineOptions {
  userId: string
  title?: string
  brief?: string
  sourceScript: string
  sourceAnalysis?: unknown
  requestId?: string
  projectId?: string
}

export async function generateTargetOutline(options: GenerateTargetOutlineOptions): Promise<RepaintOutlineResult> {
  const sourceScript = compact(options.sourceScript)
  if (!sourceScript) throw new Error('SOURCE_SCRIPT_MISSING: 源剧本为空，无法生成目标设定总纲')
  const userId = compact(options.userId)
  if (!userId) throw new Error('USER_ID_MISSING: 无法确定当前账号')

  const brief = compact(options.brief)
  const systemPrompt = getPromptTemplate(PROMPT_IDS.VIDEO_REPAINT_TARGET_OUTLINE_SYSTEM, 'zh')
  const userPrompt = buildTargetOutlineInput({
    title: options.title,
    brief,
    sourceScript,
    sourceAnalysis: options.sourceAnalysis,
  })
  const maxInputTokens = Math.min(
    MAX_OUTLINE_INPUT_TOKENS,
    Math.max(4_000, Math.ceil((systemPrompt.length + userPrompt.length) * 1.25)),
  )
  const projectId = compact(options.projectId) || VIDEO_REPAINT_PROJECT_ID

  const completion = await withTextBilling(
    userId,
    VIDEO_REPAINT_OUTLINE_MODEL,
    maxInputTokens,
    MAX_OUTLINE_OUTPUT_TOKENS,
    {
      projectId,
      action: 'video_repaint_target_outline',
      requestId: options.requestId,
      metadata: {
        operation: 'target-outline',
        sourceCharacters: sourceScript.length,
        hasBrief: brief.length > 0,
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
          maxTokens: MAX_OUTLINE_OUTPUT_TOKENS,
          projectId,
          action: 'video_repaint_target_outline',
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

  const outline = tidyOutline(getCompletionContent(completion) || '')
  if (!outline) throw new Error('EMPTY_RESPONSE: 文本模型未返回目标设定总纲')

  return {
    outline,
    model: VIDEO_REPAINT_OUTLINE_MODEL,
    usage: {
      inputTokens: toInt(completion.usage?.prompt_tokens),
      outputTokens: toInt(completion.usage?.completion_tokens),
    },
    missingSections: missingOutlineSections(outline),
  }
}
