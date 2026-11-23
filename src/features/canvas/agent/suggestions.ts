import type { CanvasFlowNode } from '../editor-types'

export function buildCanvasAgentSuggestions(nodes: readonly CanvasFlowNode[]): string[] {
  const content = nodes.filter((node) => node.type !== 'group')
  const selected = content.filter((node) => node.selected)
  const images = selected.filter((node) => node.type === 'image' || node.data.mediaType === 'image')
  const list: string[] = []
  if (!content.length) list.push('从一句话搭一个短片工作流', '帮我搭一个「文生图 → 图生视频」的基础流程')
  if (images.length >= 2) list.push('用选中的图片各生成一段 5 秒视频')
  if (images.length === 1) list.push('给这张图做 3 个不同景别的变体')
  if (selected.length >= 2) list.push('把选中的节点分成一组并整理')
  if (content.some((node) => node.data.__server?.status === 'FAILED' || node.data.errorMessage)) list.push('看看哪些节点生成失败了，帮我重试')
  if (content.length >= 20 && content.length === nodes.length) list.push('按类型帮我把画布整理一下')
  if (content.length >= 3 && !content.some((node) => node.data.globalStylePrompt)) list.push('帮我设定一个统一的画面风格')
  return [...list, '总结一下这张画布现在有什么'].slice(0, 3)
}
