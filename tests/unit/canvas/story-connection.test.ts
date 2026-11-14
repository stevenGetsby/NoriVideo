import { describe, expect, it } from 'vitest'
import { isCanvasConnectionAllowed } from '@/features/canvas/batch-node-connection'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'
import { applyStoryConnection, pruneStoryFlows, resolveStoryConnection, storyReplaceNotice, storySourceHandles } from '@/features/canvas/story/story-connection'

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

describe('story interaction connections', () => {
  const tap = node('i1', 'story_interaction', { interaction: 'tap' })
  const timing = node('i2', 'story_interaction', { interaction: 'timing' })
  const timedChoice = node('i3', 'story_interaction', { interaction: 'choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], timeoutMode: 'exit' })
  const defaultChoice = node('i4', 'story_interaction', { interaction: 'choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })
  const all = [...nodes, tap, timing, timedChoice, defaultChoice]
  const mount = (source: string, target: string): CanvasFlowEdge => ({ id: `${source}>${target}`, source, target, sourceHandle: 'interact', targetHandle: 'mount', data: { role: 'STORY_MOUNT' } })
  const fresh = () => 'fresh'

  it('lists the result ports of each interaction kind', () => {
    expect(storySourceHandles(tap)).toEqual(['success', 'fail'])
    expect(storySourceHandles(timing)).toEqual(['perfect', 'normal', 'miss'])
    expect(storySourceHandles(timedChoice)).toEqual(['a', 'b', 'timeout'])
    expect(storySourceHandles(defaultChoice)).toEqual(['a', 'b'])
  })

  it('mounts an interaction on a scene from either end of the wire', () => {
    expect(resolveStoryConnection({ source: 's1', sourceHandle: 'interact', target: 'i1', targetHandle: 'mount' }, all))
      .toEqual({ kind: 'mount', source: 's1', target: 'i1' })
    expect(resolveStoryConnection({ source: 'i1', sourceHandle: 'mount', target: 's1', targetHandle: 'interact' }, all))
      .toEqual({ kind: 'mount', source: 's1', target: 'i1' })
  })

  it('only lets interactions hang on a scene port', () => {
    const reason = (source: string, sourceHandle: string, target: string, targetHandle: string) => {
      const plan = resolveStoryConnection({ source, sourceHandle, target, targetHandle }, all)
      return plan.kind === 'invalid' ? plan.reason : plan.kind
    }
    expect(reason('s1', 'interact', 's2', 'mount')).toContain('互动节点')
    expect(reason('s1', 'interact', 'c', 'mount')).toContain('互动节点')
    expect(reason('v', 'output', 's1', 'interact')).toContain('互动节点')
    expect(reason('i1', 'mount', 'i2', 'mount')).toContain('剧情片段')
    expect(reason('s1', 'interact', 's1', 'mount')).toContain('自身')
  })

  it('lets the connection gate allow a mount from either end and refuse a scene port wired to anything else', () => {
    const allowed = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
      isCanvasConnectionAllowed({ source, sourceHandle, target, targetHandle }, all, [])
    expect(allowed('s1', 'interact', 'i1', 'mount')).toBe(true)
    expect(allowed('i1', 'mount', 's1', 'interact')).toBe(true)
    expect(allowed('s1', 'interact', 'c', 'mount')).toBe(false)
    expect(allowed('v', 'output', 's1', 'interact')).toBe(false)
  })

  it('keeps an interaction on exactly one scene and takes it off the story line', () => {
    const onStoryLine = [flow('s2', 'output', 'i1'), mount('s1', 'i2')]
    const mounted = applyStoryConnection(onStoryLine, { kind: 'mount', source: 's1', target: 'i1' }, fresh)
    expect(mounted?.map((edge) => edge.id)).toEqual(['s1>i2', 'fresh'])
    expect(mounted?.[1]).toMatchObject({ source: 's1', target: 'i1', sourceHandle: 'interact', targetHandle: 'mount', data: { role: 'STORY_MOUNT' } })

    const moved = applyStoryConnection([mount('s1', 'i1')], { kind: 'mount', source: 's2', target: 'i1' }, fresh)
    expect(moved?.map((edge) => [edge.source, edge.target])).toEqual([['s2', 'i1']])
    expect(applyStoryConnection([mount('s1', 'i1')], { kind: 'mount', source: 's1', target: 'i1' }, fresh)).toBeNull()

    const several = applyStoryConnection([mount('s1', 'i1')], { kind: 'mount', source: 's1', target: 'i2' }, fresh)
    expect(several?.map((edge) => edge.target)).toEqual(['i1', 'i2'])
  })

  it('unmounts an interaction that is wired into the story flow instead', () => {
    const next = applyStoryConnection([mount('s1', 'i1'), flow('s1', 'output', 's2')], { kind: 'flow', source: 's2', sourceHandle: 'output', target: 'i1' }, fresh)
    expect(next?.map((edge) => [edge.data?.role, edge.source, edge.target])).toEqual([['STORY_FLOW', 's1', 's2'], ['STORY_FLOW', 's2', 'i1']])
  })

  it('does not treat a mount as a picture or a story line of the scene', () => {
    const edges = [mount('s1', 'i1'), flow('s1', 'output', 's2')]
    const picture = applyStoryConnection(edges, { kind: 'media', source: 'v', target: 's1' }, fresh)
    expect(picture?.map((edge) => edge.id)).toEqual(['s1>i1', 's1:output', 'fresh'])
    const sibling = applyStoryConnection(edges, { kind: 'flow', source: 's1', sourceHandle: 'output', target: 's2' }, fresh)
    expect(sibling).toBeNull()
  })

  it('explains what a replacing mount did, and stays quiet when it only added a wire', () => {
    const fromFlow = [flow('s2', 'output', 'i1')]
    const plan = { kind: 'mount', source: 's1', target: 'i1' } as const
    expect(storyReplaceNotice(fromFlow, applyStoryConnection(fromFlow, plan, fresh)!, plan)).toBe('互动已从剧情连线上取下，改为挂在这个片段上')
    const fromScene = [mount('s2', 'i1')]
    expect(storyReplaceNotice(fromScene, applyStoryConnection(fromScene, plan, fresh)!, plan)).toBe('已改挂到这个片段')
    expect(storyReplaceNotice([], applyStoryConnection([], plan, fresh)!, plan)).toBeNull()
    const flowPlan = { kind: 'flow', source: 's2', sourceHandle: 'output', target: 'i1' } as const
    const wasMounted = [mount('s1', 'i1')]
    expect(storyReplaceNotice(wasMounted, applyStoryConnection(wasMounted, flowPlan, fresh)!, flowPlan)).toBe('互动已从片段上取下，改为接在剧情线上')
  })

  it('prunes result wires when the interaction changes kind, and leaves the scene mount alone', () => {
    const edges = [flow('i1', 'success', 's1'), flow('i1', 'fail', 's2'), mount('s1', 'i1')]
    expect(pruneStoryFlows(edges, tap)).toBe(edges)
    const asTiming = node('i1', 'story_interaction', { interaction: 'timing' })
    expect(pruneStoryFlows(edges, asTiming).map((edge) => edge.id)).toEqual(['s1>i1'])
    expect(pruneStoryFlows(edges, node('s1', 'story_scene'))).toBe(edges)
  })

  it('removes the timeout wire when a timed choice falls back to its default option', () => {
    const edges = [flow('i3', 'a', 's1'), flow('i3', 'timeout', 's2')]
    const defaulted = node('i3', 'story_interaction', { interaction: 'choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], timeoutMode: 'default' })
    expect(pruneStoryFlows(edges, defaulted).map((edge) => edge.id)).toEqual(['i3:a'])
  })
})
