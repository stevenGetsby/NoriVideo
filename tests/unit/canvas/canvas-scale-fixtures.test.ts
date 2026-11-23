import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CONTROL_PAIRS,
  SCALE_SCENARIOS,
  buildScaleGraph,
  graphStats,
  resolveScenario,
} from '../../browser/canvas-scale-fixtures.mjs'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

describe('canvas scale fixtures', () => {
  it.each([
    ['small-40', 40, 60],
    ['small-80', 80, 120],
    ['laotou-a', 179, 1111],
    ['laotou-b', 176, 724],
    ['limit-1000', 1000, 4000],
    ['p5-5000', 5000, 20000],
  ])('builds %s with exactly %i nodes and %i edges', (name, nodes, edges) => {
    const stats = graphStats(buildScaleGraph(name))
    expect(stats.nodes).toBe(nodes)
    expect(stats.edges).toBe(edges)
  })

  it('every scenario is structurally valid and acyclic', () => {
    for (const name of Object.keys(SCALE_SCENARIOS)) {
      const graph = buildScaleGraph(name)
      const stats = graphStats(graph)
      expect(stats.dangling, name).toBe(0)
      expect(stats.duplicateEdgeIds, name).toBe(0)
      expect(stats.duplicatePairs, name).toBe(0)
      expect(stats.selfLoops, name).toBe(0)
      const order = new Map(graph.nodes.map((node: { id: string }, index: number) => [node.id, index]))
      for (const edge of graph.edges) {
        expect(order.get(edge.sourceNodeId)!, `${name} ${edge.id}`).toBeLessThan(order.get(edge.targetNodeId)!)
      }
    }
  })

  it('reproduces the measured shape of the large reference canvas', () => {
    const stats = graphStats(buildScaleGraph('laotou-a'))
    expect(stats.videos).toBe(108)
    expect(stats.maxInbound).toBe(22)
    expect(stats.historyEntries).toBe(640)
    expect(stats.promptMiB).toBeGreaterThan(5.4)
    expect(stats.promptMiB).toBeLessThan(5.8)
    expect(stats.referenceMiB).toBeGreaterThan(1.5)
    expect(stats.referenceMiB).toBeLessThan(1.8)
    expect(stats.historyMiB).toBeGreaterThan(7.2)
    expect(stats.historyMiB).toBeLessThan(7.9)
  })

  it('reproduces the second reference canvas at a far zoom level', () => {
    const graph = buildScaleGraph('laotou-b')
    expect(graphStats(graph).videos).toBe(126)
    expect(graph.canvas.viewport.zoom).toBe(0.2)
  })

  it('keeps the hub opt-in so small graphs are not skewed', () => {
    expect(graphStats(buildScaleGraph('small-40')).maxInbound).toBeLessThan(22)
    expect(graphStats(buildScaleGraph('limit-1000')).maxInbound).toBeLessThan(22)
  })

  it('is deterministic and seed-sensitive', () => {
    expect(digest(buildScaleGraph('laotou-a'))).toBe(digest(buildScaleGraph('laotou-a')))
    const other = buildScaleGraph(resolveScenario('limit-1000', { seed: 2 }))
    expect(digest(other)).not.toBe(digest(buildScaleGraph('limit-1000')))
  })

  it('produces the four requested layouts', () => {
    const dense = graphStats(buildScaleGraph('limit-1000'))
    const sparse = graphStats(buildScaleGraph('limit-1000-sparse'))
    const long = graphStats(buildScaleGraph('limit-1000-long'))
    const grouped = buildScaleGraph('limit-1000-grouped')
    const width = (stats: typeof dense) => stats.bounds.maxX - stats.bounds.minX
    expect(width(sparse)).toBeGreaterThan(width(dense) * 3)
    expect(long.maxOutbound).toBeGreaterThan(100)
    expect(dense.maxOutbound).toBeLessThan(20)

    const groups = grouped.nodes.filter((node: { type: string }) => node.type === 'group')
    expect(grouped.nodes).toHaveLength(1000)
    expect(groups).toHaveLength(40)
    const ids = new Set(grouped.nodes.map((node: { id: string }) => node.id))
    for (const group of groups) {
      const members = group.data.memberIds as string[]
      expect(members.length).toBeGreaterThan(0)
      expect(members.every((id) => ids.has(id) && !id.startsWith('group-'))).toBe(true)
    }
  })

  it('keeps control pairs identical except for the one variable under test', () => {
    const [fewEdges, manyEdges] = CONTROL_PAIRS.sameNodesDifferentEdges.map((entry) =>
      buildScaleGraph(resolveScenario(entry.base, entry.overrides)),
    )
    expect(fewEdges.nodes.map((node: { id: string }) => node.id)).toEqual(manyEdges.nodes.map((node: { id: string }) => node.id))
    expect(fewEdges.edges).toHaveLength(198)
    expect(manyEdges.edges).toHaveLength(1111)

    const [bare, heavy] = CONTROL_PAIRS.sameTopologyDifferentHistory.map((entry) =>
      buildScaleGraph(resolveScenario(entry.base, entry.overrides)),
    )
    expect(bare.edges).toEqual(heavy.edges)
    expect(bare.nodes.map((node: { position: unknown }) => node.position)).toEqual(heavy.nodes.map((node: { position: unknown }) => node.position))
    expect(graphStats(bare).historyMiB).toBe(0)
    expect(graphStats(heavy).historyMiB).toBeGreaterThan(7)
  })

  it('never embeds real-looking content', () => {
    const graph = buildScaleGraph('laotou-a')
    const serialized = JSON.stringify(graph)
    expect(serialized).not.toMatch(/https?:\/\//)
    for (const node of graph.nodes) {
      for (const entry of node.data?.history ?? []) expect(entry.prompt.startsWith('合成')).toBe(true)
    }
  })

  it('rejects impossible scenarios instead of silently changing them', () => {
    expect(() => resolveScenario('missing')).toThrow(/Unknown/)
    expect(() => buildScaleGraph({ nodes: 20, edges: 5000, videos: 5, layout: 'dense' })).toThrow(/capacity/)
    expect(() => buildScaleGraph({ nodes: 10, edges: 0, videos: 50, layout: 'dense' })).toThrow(/videos/)
  })
})
