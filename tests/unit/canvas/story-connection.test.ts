import { describe, expect, it } from 'vitest'
import { isCanvasConnectionAllowed } from '@/features/canvas/batch-node-connection'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'
import { applyStoryConnection, pruneStoryFlows, resolveStoryConnection, storySourceHandles } from '@/features/canvas/story/story-connection'

function node(id: string, type: string, data: Record<string, unknown> = {}): CanvasFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { title: id, ...data } } as CanvasFlowNode
}
const choice = node('c', 'story_choice', { options: [{ id: 'o1', label: 'A', effects: [] }, { id: 'o2', label: 'B', effects: [] }] })
const condition = node('k', 'story_condition', { branches: [{ id: 'b1', label: '勇敢', match: 'all', conditions: [] }] })
const nodes = [node('e', 'story_entry'), node('s1', 'story_scene'), node('s2', 'story_scene'), choice, condition, node('x', 'story_exit'), node('v', 'video'), node('t', 'text')]
const flow = (source: string, sourceHandle: string, target: string, id = `${source}:${sourceHandle}`): CanvasFlowEdge => ({ id, source, target, sourceHandle, targetHandle: 'input', data: { role: 'STORY_FLOW' } })
let next = 0
const createId = () => `new-${++next}`

describe('story canvas connections', () => {
  it('lists the outgoing handles of each story node', () => {
    expect(storySourceHandles(nodes[0])).toEqual(['output'])
    expect(storySourceHandles(choice)).toEqual(['o1', 'o2'])
    expect(storySourceHandles(condition)).toEqual(['b1', 'else'])
    expect(storySourceHandles(nodes[5])).toEqual([])
  })

  it('keeps the option handle and normalises drags that start on the left side', () => {
    expect(resolveStoryConnection({ source: 'c', sourceHandle: 'o2', target: 's1', targetHandle: 'input' }, nodes))
      .toEqual({ kind: 'flow', source: 'c', sourceHandle: 'o2', target: 's1' })
    expect(resolveStoryConnection({ source: 's1', sourceHandle: 'input', target: 'k', targetHandle: 'else' }, nodes))
      .toEqual({ kind: 'flow', source: 'k', sourceHandle: 'else', target: 's1' })
  })

  it('rejects wiring that the player could not follow', () => {
    const reason = (source: string, sourceHandle: string, target: string) => {
      const plan = resolveStoryConnection({ source, sourceHandle, target, targetHandle: 'input' }, nodes)
      return plan.kind === 'invalid' ? plan.reason : plan.kind
    }
    expect(reason('s1', 'output', 'e')).toContain('入口不能被连入')
    expect(reason('x', 'output', 's1')).toContain('出口和结局之后')
    expect(reason('c', 'output', 's1')).toContain('具体选项')
    expect(reason('s1', 'output', 's1')).toContain('自身')
    expect(reason('t', 'output', 's1')).toContain('只有视频或图片')
    expect(reason('s1', 'output', 't')).toContain('只能连接剧情节点')
    expect(reason('t', 'output', 'v')).toBe('not_story')
  })

  it('treats video into a scene as its picture, and allows loops through the regular gate', () => {
    expect(resolveStoryConnection({ source: 'v', sourceHandle: 'output', target: 's1', targetHandle: 'input' }, nodes))
      .toEqual({ kind: 'media', source: 'v', target: 's1' })
    const edges = [flow('s1', 'output', 's2')]
    expect(isCanvasConnectionAllowed({ source: 's2', sourceHandle: 'output', target: 's1', targetHandle: 'input' }, nodes, edges)).toBe(true)
    expect(isCanvasConnectionAllowed({ source: 's2', sourceHandle: 'output', target: 'e', targetHandle: 'input' }, nodes, edges)).toBe(false)
  })

  it('gives each handle a single outgoing flow and ignores duplicates', () => {
    const edges = [flow('c', 'o1', 's1'), flow('c', 'o2', 's1')]
    const replaced = applyStoryConnection(edges, { kind: 'flow', source: 'c', sourceHandle: 'o1', target: 's2' }, createId)
    expect(replaced?.map((edge) => [edge.sourceHandle, edge.target])).toEqual([['o2', 's1'], ['o1', 's2']])
    expect(replaced?.[1].data?.role).toBe('STORY_FLOW')
    expect(applyStoryConnection(edges, { kind: 'flow', source: 'c', sourceHandle: 'o1', target: 's1' }, createId)).toBeNull()
  })

  it('prunes flows whose option was deleted', () => {
    const edges = [flow('c', 'o1', 's1'), flow('c', 'o2', 's2'), flow('s1', 'output', 's2')]
    const trimmed = node('c', 'story_choice', { options: [{ id: 'o2', label: 'B', effects: [] }] })
    expect(pruneStoryFlows(edges, trimmed).map((edge) => edge.id)).toEqual(['c:o2', 's1:output'])
    expect(pruneStoryFlows(edges, choice)).toBe(edges)
  })
})
