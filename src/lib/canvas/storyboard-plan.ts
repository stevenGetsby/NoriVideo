import { safeParseJsonObject } from '@/lib/json-repair'

export type CanvasStoryboardShot = {
  index: number
  title: string
  prompt: string
}

export function canvasStoryboardSystemPrompt(count: number) {
  return [
    '你是影视分镜导演，负责把一个可在 10–15 秒内完成的剧情片段拆成连续关键帧。',
    `必须输出严格 JSON 对象：{"shots":[{"index":1,"title":"镜头名","prompt":"图像生成提示词"}]}，shots 必须正好 ${count} 条。`,
    '所有镜头必须保持人物身份、服装、环境、时间、天气与美术风格一致，并形成清楚的起承转合。',
    '每条 prompt 必须是可独立生图的中文描述，包含景别、机位、构图、人物站位、动作表情、环境细节、光影色调及与前后镜头的连续性。',
    '相邻镜头要有明确的画面变化，禁止仅替换“镜头1/2”编号；禁止字幕、文字、水印、UI、拼贴和多宫格。',
    '只输出 JSON，不要 Markdown 代码围栏，不要解释。',
  ].join('\n')
}

function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export function parseCanvasStoryboardPlan(raw: string, count: number): CanvasStoryboardShot[] {
  const parsed = safeParseJsonObject(raw)
  const source = Array.isArray(parsed.shots) ? parsed.shots : []
  if (source.length !== count) throw new Error(`分镜规划应返回 ${count} 个镜头，实际返回 ${source.length} 个`)
  const shots = source.map((item, index) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null
    const title = cleanText(record?.title, 80) || `镜头 ${index + 1}`
    const prompt = cleanText(record?.prompt, 4_000)
    if (prompt.length < 40) throw new Error(`镜头 ${index + 1} 的提示词过短`)
    return { index: index + 1, title, prompt }
  })
  if (new Set(shots.map((shot) => shot.prompt)).size !== shots.length) throw new Error('分镜规划返回了重复提示词')
  return shots
}
