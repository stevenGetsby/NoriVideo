import { expect, it } from 'vitest'
import { planBuildGraph } from '@/features/canvas/agent/commands/build-graph'
import { canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import { nodeAlias } from '@/features/canvas/agent/alias'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

const empty = { nodes: [], edges: [] }
const limits = { maxNodes: 1000, maxEdges: 4000 }
const center = { x: 100, y: 200 }
const plan = (input: unknown, graph = empty as { nodes: CanvasFlowNode[]; edges: typeof empty.edges }, cap = limits) =>
  planBuildGraph(canvasAgentToolSchemas.build_graph.parse(input), graph, cap, center)

it('places a 40-node, 80-link blueprint without mutating or partially modifying the input graph', () => {
  const nodes = Array.from({ length: 40 }, (_, id) => ({ key: `n${id}`, type: 'text', text: `镜头 ${id}` }))
  const links = Array.from({ length: 80 }, (_, id) => ({
    from: { key: `n${id % 10}` }, to: { key: `n${10 + Math.floor(id / 10)}` },
  }))
  const result = plan({ title: '蓝图', nodes, links })
  expect(result.change.nodes).toHaveLength(40)
  expect(result.change.edges).toHaveLength(80)
  expect(result.linkResults).toEqual({ added: 80, failed: [] })
  expect(result.change.nodes.every((item) => !item.selected)).toBe(true)
  expect(result.blueprint.nodes).toHaveLength(40)
  expect(empty).toEqual({ nodes: [], edges: [] })
  const bounds = result.blueprint.bounds
  expect(bounds.x + bounds.width / 2).toBe(center.x)
  expect(bounds.y + bounds.height / 2).toBe(center.y)
})

it('computes all-or-nothing capacity, reports failed edges, and does not disguise unsupported generation options', () => {
  const nodes = [{ key: 'a', type: 'video' }, { key: 'b', type: 'text' }]
  expect(() => plan({ title: '蓝图', nodes, group: true }, empty, { ...limits, maxNodes: 2 })).toThrow(/NODE_LIMIT/)
  expect(() => plan({ title: '蓝图', nodes: [...nodes, nodes[0]] })).toThrow(/BAD_INPUT/)
  expect(() => plan({ title: '蓝图', nodes: [{ key: 'a', type: 'image', generation: { resolution: '1080p' } }] })).toThrow(/INVALID_PARAM/)
  const result = plan({ title: '蓝图', nodes, links: [
    { from: { key: 'a' }, to: { key: 'b' } },
    { from: { key: 'b' }, to: { key: 'a' } },
    { from: { key: 'missing' }, to: { key: 'a' } },
  ] }, empty, { ...limits, maxEdges: 1 })
  expect(result.linkResults).toMatchObject({
    added: 1, failed: [{ reason: 'INCOMPATIBLE' }, { reason: 'NODE_NOT_FOUND' }],
  })
})

it('places blueprints beside existing content, moving a near blueprint aside only to avoid collisions', () => {
  const anchor: CanvasFlowNode = { id: 'existing', type: 'text', position: { x: 0, y: 0 }, width: 320, height: 200, data: { title: '锚点' } }
  const other = { ...anchor, id: 'blocker', position: { x: 500, y: 0 } }
  const nodes = [{ key: 'a', type: 'image' }, { key: 'b', type: 'video' }]
  const nearPlan = plan({ title: '蓝图', nodes, near: nodeAlias(anchor.id) }, { nodes: [anchor], edges: [] })
  expect(nearPlan.blueprint.bounds.x).toBe(480)
  const collision = plan({ title: '蓝图', nodes, near: nodeAlias(anchor.id) }, { nodes: [anchor, other], edges: [] })
  expect(collision.blueprint.bounds.x).toBeGreaterThan(other.position.x + other.width!)
  const right = plan({ title: '蓝图', nodes }, { nodes: [anchor, other], edges: [] })
  expect(right.blueprint.bounds.x).toBe(1060)
})
