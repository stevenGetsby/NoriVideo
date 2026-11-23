import { expect, it } from 'vitest'
import { buildCanvasDigest } from '@/features/canvas/agent/digest'
import { nodeAlias, resolveNodeRef } from '@/features/canvas/agent/alias'
import { canvasAgentDigestSchema } from '@/lib/canvas-agent/context-schema'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'

function node(id: string, x: number, extra: Partial<CanvasFlowNode> = {}): CanvasFlowNode {
  return { id, type: 'image', position: { x, y: 0 }, width: 20, height: 20, data: { title: id }, ...extra }
}

it('prioritizes selected, visible, touched, global prompts, neighbors and active nodes without mutating the graph', () => {
  const nodes = [
    node('plain', -400),
    node('active', -350, { data: { progress: 1, generationTask: { kind: 'text', completed: false } } } as Partial<CanvasFlowNode>),
    node('neighbor', -300),
    node('global', -200, { type: 'text', data: { globalStylePrompt: true, text: '风格' } }),
    node('touched', -150),
    node('visible', 5),
    node('selected', 800, { selected: true }),
  ]
  const edges = [{ id: 'edge', source: 'neighbor', target: 'selected', data: { role: 'INPUT_DEFAULT' } }]
  const original = structuredClone({ nodes, edges })
  const digest = buildCanvasDigest({ nodes, edges }, {
    title: '作品', viewportBounds: { x: 0, y: 0, width: 100, height: 100 }, touchedIds: ['touched'],
  })
  expect(digest.rows.map(({ ref }) => ref)).toEqual(['selected', 'visible', 'touched', 'global', 'neighbor', 'active', 'plain'].map(nodeAlias))
  expect(digest.edges).toEqual([[nodeAlias('neighbor'), nodeAlias('selected')]])
  expect(digest.globalStyle).toBe('风格')
  expect({ nodes, edges }).toEqual(original)
})

it('stays in the size and time budgets for 1,000 nodes and 4,000 edges without exposing private references', () => {
  const uuid = '1a8e3539-cb1e-4bb6-9428-c610c0582761'
  const nodes = Array.from({ length: 1000 }, (_, index) => node(`synthetic-${index}`, index * 30, {
    data: { title: `场景${index} ${uuid}`, prompt: `描述 https://example.invalid/private.jpg ${'画'.repeat(80)}`, materialId: uuid,
      videoUrl: 'https://example.invalid/original.mp4' },
  }))
  const edges: CanvasFlowEdge[] = Array.from({ length: 4000 }, (_, i) => ({
    id: `e-${i}`, source: nodes[i % 1000].id, target: nodes[(i * 3 + 1) % 1000].id, data: { role: 'INPUT_DEFAULT' },
  }))
  const opts = { title: '项目', viewportBounds: { x: 0, y: 0, width: 900, height: 600 } }
  buildCanvasDigest({ nodes, edges }, opts)
  const start = performance.now()
  const result = buildCanvasDigest({ nodes, edges }, opts)
  expect(performance.now() - start).toBeLessThan(50)
  const serialized = JSON.stringify(result)
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(48 * 1024)
  expect(serialized).not.toMatch(/http|materialId|synthetic-|1a8e3539-cb1e-4bb6-9428-c610c0582761/)
  expect(result.omitted.nodes + result.rows.length).toBe(1000)
  expect(result.omitted.edges + result.edges.length).toBe(4000)
  expect(canvasAgentDigestSchema.safeParse(result).success).toBe(true)
})

it('never guesses between identical labels or resolves a hidden group when disallowed', () => {
  const a = node('a', 0, { data: { title: '分镜' } })
  const b = node('b', 10, { data: { title: '分镜' } })
  const group = node('g', 20, { type: 'group' })
  expect(resolveNodeRef(nodeAlias('b'), [a, b, group])).toBe(b)
  expect(() => resolveNodeRef('分镜', [a, b, group])).toThrow(/AMBIGUOUS_NODE/)
  expect(() => resolveNodeRef(nodeAlias('g'), [group], { allowGroup: false })).toThrow(/NODE_NOT_FOUND/)
})
