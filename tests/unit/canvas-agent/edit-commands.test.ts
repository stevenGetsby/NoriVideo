import { expect, it } from 'vitest'
import { fitCanvasGroupsToMembers } from '@/features/canvas/actions/layout'
import { removeDeletedCanvasReferences } from '@/features/canvas/reference-resolution'
import { removeDisconnectedCanvasReferences } from '@/features/canvas/types'
import type { CanvasFlowNode, CanvasFlowEdge } from '@/features/canvas/editor-types'
import { planDeleteNodes } from '@/features/canvas/agent/commands/delete-nodes'
import { planGroupNodes } from '@/features/canvas/agent/commands/group'
import { planConnect, planDisconnect } from '@/features/canvas/agent/commands/connect'
import { planUpdateNodes } from '@/features/canvas/agent/commands/update-nodes'
import { planCanvasPrompt } from '@/features/canvas/agent/commands/canvas-prompt'
import { planArrange } from '@/features/canvas/agent/commands/arrange'
import { planPlaylist } from '@/features/canvas/agent/commands/playlist'

const limits = { maxNodes: 1000, maxEdges: 4000 }
const point = { x: 0, y: 0 }
const make = (id: string, type = 'text', x = 0, data: CanvasFlowNode['data'] = {}): CanvasFlowNode => ({
  id, type, position: { x, y: 0 }, width: 300, height: 200, data: { title: id, ...data },
})
const edge = (source: string, target: string): CanvasFlowEdge => ({ id: `${source}-${target}`, source, target, data: { role: 'INPUT_DEFAULT' } })
const graph = (nodes: CanvasFlowNode[], edges: CanvasFlowEdge[] = []) => ({ nodes, edges })

it('deletion matches the current editor’s group and reference cleanup and rejects in-progress nodes', () => {
  const a = make('a', 'image')
  const b = make('b', 'video', 800, { generation: { referenceNodeIds: ['a'] } })
  const g = make('g', 'group', -88, { memberIds: ['a', 'b'] })
  const original = graph([a, b, g], [edge('a', 'b')])
  const ids = new Set(['a'])
  const oldEdges = original.edges.filter((item) => ids.has(item.source) || ids.has(item.target))
  const remaining = original.edges.filter((item) => !oldEdges.includes(item))
  const oldNodes = removeDeletedCanvasReferences(fitCanvasGroupsToMembers(original.nodes
    .filter((node) => !ids.has(node.id)).map((node) => node.type === 'group' ? {
      ...node, data: { ...node.data, memberIds: node.data.memberIds?.filter((id) => !ids.has(id)) },
    } : node)), ids).map((node) => {
    const refs = node.data.generation?.referenceNodeIds
    const next = removeDisconnectedCanvasReferences(refs, node.id, oldEdges, remaining)
    return next === refs ? node : { ...node, data: { ...node.data, generation: { ...node.data.generation, referenceNodeIds: next } } }
  })
  expect(planDeleteNodes({ nodes: ['a'], includeGroupMembers: false }, original).change).toMatchObject({
    nodes: oldNodes, edges: remaining, deletedNodeIds: ['a'], deletedEdgeIds: ['a-b'],
  })
  expect(planDeleteNodes({ nodes: ['g'], includeGroupMembers: true }, original).change.nodes).toEqual([])
  expect(() => planDeleteNodes({ nodes: ['a', 'missing'], includeGroupMembers: false }, original)).toThrow(/NODE_NOT_FOUND/)
  expect(() => planDeleteNodes({ nodes: ['a'], includeGroupMembers: false }, graph([{ ...a, data: {
    ...a.data, __server: { status: 'RUNNING', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null },
  } }]))).toThrow(/RUNNING_NODE/)
})

it('groups with the editor padding, removes a now-empty old group, and rejects nesting and overflow', () => {
  const original = graph([make('a'), make('b', 'image', 400), make('g', 'group', -50, { memberIds: ['a', 'b'] })])
  const result = planGroupNodes({ nodes: ['a', 'b'], color: 'sky' }, original, limits)
  expect(result.deletedNodeIds).toEqual(['g'])
  expect(result.nodes.at(-1)).toMatchObject({
    type: 'group', position: { x: -42, y: -64 }, width: 784, height: 306, selected: false,
    data: { memberIds: ['a', 'b'], groupColor: '#38bdf8' },
  })
  expect(() => planGroupNodes({ nodes: ['g', 'a'] }, original, limits)).toThrow(/UNSUPPORTED_NODE/)
  expect(() => planGroupNodes({ nodes: ['a', 'b'] }, original, { ...limits, maxNodes: 3 })).toThrow(/NODE_LIMIT/)
})

it('connects and disconnects directed edges with the existing type and reference constraints', () => {
  const a = make('a', 'image')
  const b = make('b', 'video', 400, { generation: { referenceNodeIds: [] } })
  const c = make('c', 'text', 800)
  const links = [{ from: 'a', to: 'c' }, { from: 'a', to: 'b' }]
  const original = graph([a, b, c])
  const connected = planConnect(links, original, limits)
  expect(connected.skipped).toEqual([{ ...links[0], reason: 'INCOMPATIBLE' }])
  expect(connected.change.nodes[1]?.data.generation?.referenceNodeIds).toEqual(['a'])
  expect(() => planConnect([links[1]], original, { ...limits, maxEdges: 0 })).toThrow(/EDGE_LIMIT/)
  const disconnected = planDisconnect([links[1]], connected.change)
  expect(disconnected.change.nodes[1]?.data.generation?.referenceNodeIds).toEqual([])
  expect(disconnected.change.deletedEdgeIds).toEqual(connected.change.edges.map((item) => item.id))
  expect(() => planDisconnect([{ from: 'b', to: 'a' }], connected.change)).toThrow(/NODE_NOT_FOUND/)
})

it('applies valid edits independently and never replaces unrelated model settings', () => {
  const original = graph([make('a', 'text', 0, { text: '旧' }), make('b', 'image', 200, { generation: { modelKey: 'fixture' } })])
  const result = planUpdateNodes({ updates: [{ node: 'a', text: '新' }, { node: 'b', generation: { resolution: '1K' } }] }, original)
  expect(result.change.nodes[0].data).toMatchObject({ text: '新', textMarks: [] })
  expect(result.change.nodes[1].data.generation).toEqual({ modelKey: 'fixture', resolution: '1K' })
  expect(() => planUpdateNodes({ updates: [{ node: 'b', text: 'wrong type' }] }, original)).toThrow(/UNSUPPORTED_NODE/)
})

it('creates the global style alongside the canvas and clears only its flag', () => {
  const original = graph([make('a', 'image', 300)])
  const added = planCanvasPrompt({ kind: 'global_style', text: '  暖色  ' }, original, limits, point)!
  expect(added.nodes.at(-1)).toMatchObject({ position: { x: -60, y: 0 }, data: { text: '暖色', globalStylePrompt: true } })
  const cleared = planCanvasPrompt({ kind: 'global_style', text: '' }, added, limits, point)
  expect(cleared?.nodes.at(-1)?.data).toMatchObject({ text: '暖色', globalStylePrompt: false })
  expect(() => planCanvasPrompt({ kind: 'video_prefix', text: '色彩' }, original, { ...limits, maxNodes: 1 }, point)).toThrow(/NODE_LIMIT/)
})

it('keeps the original origin when arranging a selection and adds only ready videos to playlists', () => {
  const original = graph([make('a', 'text', 400), make('b', 'text', 800), make('out', 'text', 1600)])
  const result = planArrange({ scope: 'nodes', nodes: ['a', 'b'], mode: 'vertical' }, original)
  expect(Math.min(...result.nodes.slice(0, 2).map((item) => item.position.x))).toBe(400)
  expect(result.nodes[2]).toBe(original.nodes[2])
  const list = graph([make('playlist', 'playlist'), make('ready', 'video', 0, { videoUrl: '/sample.mp4' }), make('empty', 'video')])
  const added = planPlaylist({ playlist: 'playlist', videos: ['ready', 'empty'] }, list, limits)
  expect(added).toMatchObject({ added: 1, skipped: [{ reason: 'not_ready' }] })
  expect(added.change.edges[0]).toMatchObject({ source: 'ready', target: 'playlist' })
})
