import { expect, it } from 'vitest'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'
import { buildCanvasAgentSuggestions } from '@/features/canvas/agent/suggestions'

const node = (id: string, type = 'text', selected = false, errorMessage?: string): CanvasFlowNode => ({
  id, type, selected, position: { x: 0, y: 0 }, data: { errorMessage },
})

it('chooses empty-canvas, image, grouping, failure, layout and style suggestions in priority order', () => {
  expect(buildCanvasAgentSuggestions([node('group', 'group')]).slice(0, 2)).toEqual([
    '从一句话搭一个短片工作流', '帮我搭一个「文生图 → 图生视频」的基础流程',
  ])
  expect(buildCanvasAgentSuggestions([node('a', 'image', true)])[0]).toBe('给这张图做 3 个不同景别的变体')
  expect(buildCanvasAgentSuggestions([node('a', 'image', true), node('b', 'image', true), node('c', 'video', false, '失败')]))
    .toEqual(['用选中的图片各生成一段 5 秒视频', '把选中的节点分成一组并整理', '看看哪些节点生成失败了，帮我重试'])
  expect(buildCanvasAgentSuggestions(Array.from({ length: 20 }, (_, i) => node(String(i))))).toEqual([
    '按类型帮我把画布整理一下', '帮我设定一个统一的画面风格', '总结一下这张画布现在有什么',
  ])
})
