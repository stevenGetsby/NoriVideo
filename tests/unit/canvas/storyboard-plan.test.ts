import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canvasStoryboardSystemPrompt, parseCanvasStoryboardPlan } from '@/lib/canvas/storyboard-plan'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('canvas storyboard planning contract', () => {
  it('offers 4–8 shots and submits the same bounded count to the planning route', () => {
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const route = readSource('src/app/api/projects/[projectId]/canvas/[canvasId]/generate-storyboard/route.ts')

    expect(generator).toContain('const STORYBOARD_COUNTS = [4, 5, 6, 7, 8] as const')
    expect(generator).toContain('count: storyboard ? normalizeStoryboardCount(count) : count')
    expect(generator).toContain("storyboard ? STORYBOARD_COUNTS : [1, 2, 4]")
    const submitStart = graph.indexOf("if (request.type === 'image' && request.storyboard)")
    const submitEnd = graph.indexOf("if (request.type !== 'image'", submitStart)
    expect(submitStart).toBeGreaterThan(-1)
    expect(submitEnd).toBeGreaterThan(submitStart)
    const submission = graph.slice(submitStart, submitEnd)
    expect(submission).toContain("/generate-storyboard`, {")
    expect(submission).toContain('count: request.count,')
    expect(route).toContain('Math.max(4, Math.min(8, Math.floor(Number(body?.count) || 4)))')
  })

  it('materializes unique fan-out destinations in the worker, not the browser', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const worker = readSource('src/lib/workers/handlers/canvas-generation-task-handler.ts')
    const fanout = readSource('src/lib/canvas/storyboard-fanout.ts')
    const materializeStart = graph.indexOf('const materializeStoryboardPlan = useCallback')
    const materializeEnd = graph.indexOf('const runNodeAction = useCallback', materializeStart)

    expect(materializeStart).toBeGreaterThan(-1)
    expect(materializeEnd).toBeGreaterThan(materializeStart)
    const materialize = graph.slice(materializeStart, materializeEnd)
    expect(materialize).toContain('await loadAutosaveServerVersion()')
    expect(materialize).not.toContain('/generate`')
    expect(materialize).not.toContain('submitPreparedNode')
    expect(worker).toContain('materializeCanvasStoryboardFanout({')
    expect(fanout).toContain('canvasStoryboardFanoutIds(input.planningTaskId')
    expect(fanout).toContain('const plannedShots = prepared.shots')
    expect(fanout).toContain('const ordered = [...plannedShots.slice(1), plannedShots[0]]')
  })

  it('keeps the planning source bound until every additional shot is handled', () => {
    const fanout = readSource('src/lib/canvas/storyboard-fanout.ts')
    expect(fanout).toContain('Submit the source shot last')
    expect(fanout).toContain('const ordered = [...plannedShots.slice(1), plannedShots[0]]')
    expect(fanout).toContain('claimStoryboardShotNode({')
    expect(fanout).toContain('dedupeKey: `${TASK_TYPE.TOOLBOX_IMAGE}:${asset.id}`')
  })
  it('clears a previous image binding before starting a storyboard plan', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const generateStart = graph.indexOf('const handleGenerate = useCallback')
    const materializeStart = graph.indexOf('const materializeStoryboardPlan = useCallback', generateStart)
    const generate = graph.slice(generateStart, materializeStart)

    expect(generate).toContain('if (request.storyboard || multiImageRevision) {')
    expect(generate).toContain('delete generation.assetId')
    expect(generate).toContain('delete generation.taskId')
  })

  it('persists generation option drafts continuously and once more before closing', () => {
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    expect(generator).toContain('onDraftChangeRef.current(draftPatch)')
    expect(generator).toContain('modelKey,')
    expect(generator).toContain('aspectRatio,')
    expect(generator).toContain('duration,')
    expect(generator).toContain('inputMode,')
    expect(generator).toContain('generateAudio,')
    expect(generator).toContain('const closeEditor = () => {')
    expect(generator).toContain('persistDraft()\n    onClose()')
    expect(generator).toContain('aria-label="关闭节点编辑器" title="关闭节点编辑器" onClick={closeEditor}')
  })

  it('requires the exact requested shot count and continuity rules', () => {
    const prompt = canvasStoryboardSystemPrompt(4)
    expect(prompt).toContain('正好 4 条')
    expect(prompt).toContain('保持人物身份、服装、环境、时间、天气与美术风格一致')
    expect(prompt).toContain('禁止字幕')
  })

  it('normalizes a repaired JSON storyboard response', () => {
    const raw = `\`\`\`json
    {"shots":[
      {"index":8,"title":"建立空间","prompt":"全景，低机位，雨夜的旧车站，女主站在画面左侧握紧车票，冷青顶光与远处暖灯形成对比，保持灰色风衣和湿发造型一致。"},
      {"index":9,"title":"发现追踪者","prompt":"中景，越肩机位，女主回头看向月台入口，黑衣人从背景阴影走出，镜头压缩空间，雨水反光延续上一镜的冷青色调。"},
      {"index":10,"title":"准备逃离","prompt":"近景，侧面构图，女主收紧下颌并把车票藏入口袋，脚尖转向出口，背景黑衣人逐渐靠近，服装与湿发细节严格连续。"},
      {"index":11,"title":"冲入列车","prompt":"广角动态构图，女主冲向刚开启的列车门，风衣下摆被气流扬起，黑衣人在后方伸手扑空，车厢暖光成为结尾视觉落点。"}
    ]}
    \`\`\``
    const shots = parseCanvasStoryboardPlan(raw, 4)
    expect(shots).toHaveLength(4)
    expect(shots.map((shot) => shot.index)).toEqual([1, 2, 3, 4])
    expect(shots[0].title).toBe('建立空间')
  })

  it('rejects missing and repeated shot prompts', () => {
    const samePrompt = '中景，人物站在雨夜车站中央，冷青光照亮面部，保持服装环境和连续动作，画面没有字幕与水印。'
    expect(() => parseCanvasStoryboardPlan(JSON.stringify({ shots: [{ title: '1', prompt: samePrompt }] }), 4)).toThrow('实际返回 1 个')
    expect(() => parseCanvasStoryboardPlan(JSON.stringify({ shots: Array.from({ length: 4 }, (_, index) => ({ title: String(index), prompt: samePrompt })) }), 4)).toThrow('重复提示词')
  })
})
