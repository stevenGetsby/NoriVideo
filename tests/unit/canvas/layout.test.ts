import { describe, expect, it } from 'vitest'
import {
  CANVAS_GROUP_PADDING,
  arrangeCanvasGroupMembers,
  arrangeCanvasGroupNodes,
  arrangeCanvasNodes,
  canResizeCanvasGroupToMembers,
  fitCanvasGroupsToMembers,
  normalizeCanvasGroupMemberships,
} from '@/features/canvas/actions/layout'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'

function node(id: string, x: number, y: number, selected = false): CanvasFlowNode {
  return {
    id,
    type: 'image',
    position: { x, y },
    width: 300,
    height: 200,
    selected,
    data: {},
  }
}

function edge(source: string, target: string): CanvasFlowEdge {
  return { id: `${source}-${target}`, source, target, type: 'bezier', data: { role: 'INPUT_DEFAULT' } }
}

function typed(id: string, type: string, x: number, y: number): CanvasFlowNode {
  return { ...node(id, x, y), type }
}

function rect(item: CanvasFlowNode) {
  return { left: item.position.x, top: item.position.y, right: item.position.x + (item.width || 300), bottom: item.position.y + (item.height || 200) }
}

function overlappingPairs(nodes: CanvasFlowNode[]) {
  const pairs: string[] = []
  nodes.forEach((a, index) => nodes.slice(index + 1).forEach((b) => {
    const left = rect(a)
    const right = rect(b)
    if (left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom) pairs.push(`${a.id}/${b.id}`)
  }))
  return pairs
}

describe('canvas content-based organize rules', () => {
  it('lays one column per content type in production order, top aligned', () => {
    const result = arrangeCanvasNodes(
      [
        typed('clip-a', 'video', 0, 0),
        typed('shot-b', 'image', 40, 500),
        typed('script', 'text', 900, 40),
        typed('shot-a', 'image', 20, 120),
        typed('clip-b', 'video', 700, 900),
      ],
      [],
      'type',
    )
    const byId = new Map(result.map((item) => [item.id, item.position]))

    expect(byId.get('script')!.x).toBeLessThan(byId.get('shot-a')!.x)
    expect(byId.get('shot-a')!.x).toBeLessThan(byId.get('clip-a')!.x)
    expect(byId.get('shot-a')!.x).toBe(byId.get('shot-b')!.x)
    expect(byId.get('clip-a')!.x).toBe(byId.get('clip-b')!.x)
    expect(byId.get('script')!.y).toBe(byId.get('shot-a')!.y)
    expect(byId.get('shot-a')!.y).toBe(byId.get('clip-a')!.y)
    expect(byId.get('shot-b')!.y - byId.get('shot-a')!.y).toBe(200 + 76)
    expect(overlappingPairs(result)).toEqual([])
  })

  it('wraps a crowded type into balanced sub-columns instead of one long strip', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => typed(`shot-${index}`, 'image', 0, index * 40))
    const result = arrangeCanvasNodes(nodes, [], 'type')
    const columns = new Map<number, number>()
    result.forEach((item) => columns.set(item.position.x, (columns.get(item.position.x) || 0) + 1))

    expect(Array.from(columns.values())).toEqual([4, 4, 4])
    expect(overlappingPairs(result)).toEqual([])
  })

  it('keeps a group and its members together and places groups after every content column', () => {
    const member = typed('member', 'text', 620, 120)
    const group: CanvasFlowNode = {
      id: 'group', type: 'group', position: { x: 560, y: 40 }, width: 420, height: 330,
      data: { memberIds: ['member'], title: '镜头组' },
    }
    const result = arrangeCanvasNodes([group, member, typed('shot', 'image', 0, 0), typed('clip', 'video', 0, 400)], [], 'type')
    const byId = new Map(result.map((item) => [item.id, item]))

    expect(byId.get('group')!.position.x).toBeGreaterThan(byId.get('clip')!.position.x)
    expect(byId.get('member')!.position.x).toBeGreaterThan(byId.get('group')!.position.x)
    expect(byId.get('member')!.position.x - byId.get('group')!.position.x).toBe(CANVAS_GROUP_PADDING.left)
    expect(byId.get('member')!.position.y - byId.get('group')!.position.y).toBe(CANVAS_GROUP_PADDING.top)
  })

  it('tidies staggered rows into aligned rows while keeping row membership and order', () => {
    const result = arrangeCanvasNodes(
      [
        node('a', 10, 3), node('b', 460, 40), node('c', 700, 12),
        node('d', 90, 600), node('e', 420, 641),
      ],
      [],
      'tidy',
    )
    const byId = new Map(result.map((item) => [item.id, item.position]))

    expect(byId.get('a')!.y).toBe(byId.get('b')!.y)
    expect(byId.get('b')!.y).toBe(byId.get('c')!.y)
    expect(byId.get('d')!.y).toBe(byId.get('e')!.y)
    expect(byId.get('d')!.y - byId.get('a')!.y).toBe(200 + 76)
    expect(byId.get('a')!.x).toBe(byId.get('d')!.x)
    expect(byId.get('b')!.x - byId.get('a')!.x).toBe(300 + 132)
    expect(byId.get('c')!.x - byId.get('b')!.x).toBe(300 + 132)
    expect(overlappingPairs(result)).toEqual([])
  })

  it('never overlaps nodes in any rule, even when the source is a pile at one point', () => {
    const pile = Array.from({ length: 9 }, (_, index) => typed(`n-${index}`, ['text', 'image', 'video'][index % 3], 100, 100))
    for (const mode of ['grid', 'horizontal', 'vertical', 'type', 'tidy'] as const) {
      const result = arrangeCanvasNodes(pile, [edge('n-0', 'n-3'), edge('n-3', 'n-6')], mode)
      expect(result).toHaveLength(pile.length)
      expect(overlappingPairs(result), mode).toEqual([])
    }
  })
})

describe('canvas dependency layout', () => {
  it('lays a branching workflow from left to right without overlapping siblings', () => {
    const result = arrangeCanvasNodes(
      [node('root', 600, 500), node('left', 20, 10), node('right', 40, 20), node('leaf', 80, 30)],
      [edge('root', 'left'), edge('root', 'right'), edge('left', 'leaf'), edge('right', 'leaf')],
      'horizontal',
    )
    const positions = new Map(result.map((item) => [item.id, item.position]))

    expect(positions.get('root')!.x).toBeLessThan(positions.get('left')!.x)
    expect(positions.get('left')!.x).toBe(positions.get('right')!.x)
    expect(positions.get('right')!.x).toBeLessThan(positions.get('leaf')!.x)
    expect(Math.abs(positions.get('left')!.y - positions.get('right')!.y)).toBeGreaterThanOrEqual(264)
  })

  it('organizes the whole canvas even when several nodes are selected', () => {
    const result = arrangeCanvasNodes(
      [node('a', 0, 0, true), node('b', 0, 300, true), node('c', -900, -900)],
      [edge('a', 'b'), edge('b', 'c')],
      'horizontal',
    )
    const positions = new Map(result.map((item) => [item.id, item.position]))

    expect(positions.get('a')!.x).toBeLessThan(positions.get('b')!.x)
    expect(positions.get('b')!.x).toBeLessThan(positions.get('c')!.x)
  })

  it('moves cyclic nodes into a readable final column', () => {
    const result = arrangeCanvasNodes(
      [node('root', 0, 0), node('child', 0, 0), node('cycle-a', 0, 0), node('cycle-b', 0, 0)],
      [edge('root', 'child'), edge('cycle-a', 'cycle-b'), edge('cycle-b', 'cycle-a')],
      'horizontal',
    )
    const positions = new Map(result.map((item) => [item.id, item.position]))

    expect(positions.get('cycle-a')!.x).toBeGreaterThan(positions.get('child')!.x)
    expect(positions.get('cycle-a')!.x).toBe(positions.get('cycle-b')!.x)
  })

  it('moves a group and its members as one tree unit', () => {
    const root = node('root', 0, 0)
    const memberA = node('member-a', 600, 120)
    const memberB = node('member-b', 930, 120)
    const group: CanvasFlowNode = {
      id: 'group',
      type: 'group',
      position: { x: 550, y: 50 },
      width: 730,
      height: 340,
      data: { memberIds: ['member-a', 'member-b'], title: '镜头组' },
    }
    const leaf = node('leaf', 1500, 0)
    const result = arrangeCanvasNodes(
      [root, group, memberA, memberB, leaf],
      [edge('root', 'member-a'), edge('member-b', 'leaf')],
      'horizontal',
    )
    const byId = new Map(result.map((item) => [item.id, item]))
    const arrangedGroup = byId.get('group')!
    const arrangedA = byId.get('member-a')!
    const arrangedB = byId.get('member-b')!

    expect(byId.get('root')!.position.x).toBeLessThan(arrangedGroup.position.x)
    expect(arrangedGroup.position.x).toBeLessThan(byId.get('leaf')!.position.x)
    expect(arrangedA.position.x).toBeGreaterThan(arrangedGroup.position.x)
    expect(arrangedB.position.x + (arrangedB.width || 300)).toBeLessThanOrEqual(arrangedGroup.position.x + (arrangedGroup.width || 0))
    expect(arrangedGroup.data.memberIds).toEqual(['member-a', 'member-b'])
  })

  it('resolves duplicate legacy membership to one deterministic group before layout', () => {
    const member = node('member', 620, 120)
    const broadGroup: CanvasFlowNode = {
      id: 'broad-group',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 1_200,
      height: 700,
      data: { memberIds: ['member'] },
    }
    const closeGroup: CanvasFlowNode = {
      id: 'close-group',
      type: 'group',
      position: { x: 560, y: 50 },
      width: 420,
      height: 340,
      data: { memberIds: ['member', 'member'] },
    }

    const normalized = normalizeCanvasGroupMemberships([broadGroup, closeGroup, member])
    const byId = new Map(normalized.map((item) => [item.id, item]))
    expect(byId.get('broad-group')!.data.memberIds).toEqual([])
    expect(byId.get('close-group')!.data.memberIds).toEqual(['member'])

    const arranged = arrangeCanvasNodes(normalized, [], 'horizontal')
    const arrangedById = new Map(arranged.map((item) => [item.id, item]))
    const group = arrangedById.get('close-group')!
    const arrangedMember = arrangedById.get('member')!
    expect(arrangedMember.position.x).toBeGreaterThan(group.position.x)
    expect(arrangedMember.position.y).toBeGreaterThan(group.position.y)
    expect(arrangedMember.position.x + 300).toBeLessThan(group.position.x + (group.width || 0))
    expect(arrangedMember.position.y + 200).toBeLessThan(group.position.y + (group.height || 0))
  })

  it('orders a selected set vertically by wire dependency and centres mixed widths', () => {
    const upstream = node('upstream', 500, 600)
    const downstream = { ...node('downstream', 40, 20), width: 180 }

    const arranged = arrangeCanvasGroupNodes(
      [downstream, upstream],
      'vertical',
      [edge('upstream', 'downstream')],
    )
    const byId = new Map(arranged.map((item) => [item.id, item]))
    const first = byId.get('upstream')!
    const second = byId.get('downstream')!

    expect(first.position.y).toBeLessThan(second.position.y)
    expect(first.position.x + 150).toBe(second.position.x + 90)
    expect(second.position.y - (first.position.y + 200)).toBe(48)
  })

  it('anchors group organisation and keeps every member inside the resized frame', () => {
    const group: CanvasFlowNode = {
      id: 'group',
      type: 'group',
      position: { x: 400, y: 240 },
      width: 260,
      height: 180,
      data: { memberIds: ['second', 'first'] },
    }
    const first = node('first', 1200, 800)
    const second = { ...node('second', -400, -200), width: 180 }

    const arranged = arrangeCanvasGroupMembers(
      [group, first, second],
      'group',
      'vertical',
      [edge('first', 'second')],
    )
    const byId = new Map(arranged.map((item) => [item.id, item]))
    const nextGroup = byId.get('group')!
    const nextFirst = byId.get('first')!
    const nextSecond = byId.get('second')!

    expect(nextGroup.position).toEqual({ x: 400, y: 240 })
    expect(nextFirst.position.y).toBeLessThan(nextSecond.position.y)
    for (const member of [nextFirst, nextSecond]) {
      expect(member.position.x).toBeGreaterThan(nextGroup.position.x)
      expect(member.position.y).toBeGreaterThan(nextGroup.position.y)
      expect(member.position.x + (member.width || 300)).toBeLessThan(nextGroup.position.x + (nextGroup.width || 0))
      expect(member.position.y + (member.height || 200)).toBeLessThan(nextGroup.position.y + (nextGroup.height || 0))
    }
    expect(nextGroup.data.memberIds).toEqual(['first', 'second'])
  })

  it('refits a stale group frame after selected members are rearranged', () => {
    const group: CanvasFlowNode = {
      id: 'group',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 260,
      height: 180,
      data: { memberIds: ['a', 'b'] },
    }
    const members = arrangeCanvasGroupNodes([node('a', 900, 200), node('b', 900, 800)], 'vertical')
    const fitted = fitCanvasGroupsToMembers([group, ...members])
    const byId = new Map(fitted.map((item) => [item.id, item]))
    const nextGroup = byId.get('group')!

    for (const memberId of ['a', 'b']) {
      const member = byId.get(memberId)!
      expect(member.position.x).toBeGreaterThan(nextGroup.position.x)
      expect(member.position.y).toBeGreaterThan(nextGroup.position.y)
      expect(member.position.x + 300).toBeLessThan(nextGroup.position.x + (nextGroup.width || 0))
      expect(member.position.y + 200).toBeLessThan(nextGroup.position.y + (nextGroup.height || 0))
    }
  })

  it('stops every group edge at the padded member envelope', () => {
    const group: CanvasFlowNode = {
      id: 'group',
      type: 'group',
      position: { x: 58, y: 36 },
      width: 384,
      height: 306,
      data: { memberIds: ['member'] },
    }
    const member = node('member', 100, 100)
    const nodes = [group, member]

    expect(canResizeCanvasGroupToMembers(nodes, 'group', { x: 58, y: 36, width: 384, height: 306 })).toBe(true)
    expect(canResizeCanvasGroupToMembers(nodes, 'group', { x: 59, y: 36, width: 383, height: 306 })).toBe(false)
    expect(canResizeCanvasGroupToMembers(nodes, 'group', { x: 58, y: 37, width: 384, height: 305 })).toBe(false)
    expect(canResizeCanvasGroupToMembers(nodes, 'group', { x: 58, y: 36, width: 383, height: 306 })).toBe(false)
    expect(canResizeCanvasGroupToMembers(nodes, 'group', { x: 58, y: 36, width: 384, height: 305 })).toBe(false)
  })

  it('allows empty groups and lets a legacy undersized frame expand without worsening another edge', () => {
    const emptyGroup: CanvasFlowNode = {
      id: 'empty',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 260,
      height: 180,
      data: { memberIds: [] },
    }
    expect(canResizeCanvasGroupToMembers([emptyGroup], 'empty', { x: 0, y: 0, width: 300, height: 220 })).toBe(true)

    const staleGroup: CanvasFlowNode = {
      ...emptyGroup,
      id: 'stale',
      width: 240,
      data: { memberIds: ['member'] },
    }
    const member = node('member', 100, 100)
    expect(canResizeCanvasGroupToMembers([staleGroup, member], 'stale', { x: 0, y: 0, width: 300, height: 180 })).toBe(true)
    expect(canResizeCanvasGroupToMembers([staleGroup, member], 'stale', { x: 60, y: 0, width: 240, height: 180 })).toBe(false)
  })
})
