import { describe, expect, it } from 'vitest'
import { reconcileDraggedNodeGroupMembership } from '@/features/canvas/actions/grouping'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

function creativeNode(
  id: string,
  x: number,
  y: number,
  width = 80,
  height = 60,
): CanvasFlowNode {
  return {
    id,
    type: 'image',
    position: { x, y },
    width,
    height,
    data: { title: id },
  }
}

function groupNode(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  memberIds: string[] = [],
): CanvasFlowNode {
  return {
    id,
    type: 'group',
    position: { x, y },
    width,
    height,
    data: { title: id, memberIds },
  }
}

function members(nodes: CanvasFlowNode[], groupId: string) {
  return nodes.find((node) => node.id === groupId)?.data.memberIds
}

describe('canvas dynamic group membership', () => {
  it('adds a node after it is dragged fully inside a group', () => {
    const nodes = [
      groupNode('group', 0, 0, 500, 400, ['existing']),
      creativeNode('existing', 40, 40),
      creativeNode('moved', 180, 140),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['moved'])

    expect(members(next, 'group')).toEqual(['existing', 'moved'])
  })

  it('removes a member after it is dragged outside the group', () => {
    const nodes = [
      groupNode('group', 0, 0, 500, 400, ['kept', 'moved']),
      creativeNode('kept', 40, 40),
      creativeNode('moved', 540, 140),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['moved'])

    expect(members(next, 'group')).toEqual(['kept'])
  })

  it('does not count a partial overlap as entering a group', () => {
    const nodes = [
      groupNode('group', 0, 0, 300, 240, ['moved']),
      creativeNode('moved', 260, 80),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['moved'])

    expect(members(next, 'group')).toEqual([])
  })

  it('does not capture a new node that only touches the group header or border gutter', () => {
    const nodes = [
      groupNode('group', 0, 0, 400, 320),
      creativeNode('moved', 8, 8),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['moved'])

    expect(members(next, 'group')).toEqual([])
  })

  it('keeps an existing member through a small boundary crossing to avoid accidental detachment', () => {
    const nodes = [
      groupNode('group', 0, 0, 300, 240, ['moved']),
      creativeNode('moved', 252, 80),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['moved'])

    expect(next).toBe(nodes)
    expect(members(next, 'group')).toEqual(['moved'])
  })

  it('assigns a node only to the smallest containing group', () => {
    const nodes = [
      groupNode('outer', 0, 0, 600, 500, ['moved']),
      groupNode('inner', 100, 100, 260, 220),
      creativeNode('moved', 140, 160),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['moved'])

    expect(members(next, 'outer')).toEqual([])
    expect(members(next, 'inner')).toEqual(['moved'])
  })

  it('updates every moved node in a multi-selection independently', () => {
    const nodes = [
      groupNode('left', 0, 0, 300, 280, ['second']),
      groupNode('right', 400, 0, 300, 280, ['first']),
      creativeNode('first', 80, 100),
      creativeNode('second', 480, 100),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['first', 'second'])

    expect(members(next, 'left')).toEqual(['first'])
    expect(members(next, 'right')).toEqual(['second'])
  })

  it('keeps membership untouched when a group carries its members', () => {
    const nodes = [
      groupNode('group', 300, 200, 500, 400, ['member']),
      creativeNode('member', 360, 280),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['group', 'member'])

    expect(next).toBe(nodes)
    expect(members(next, 'group')).toEqual(['member'])
  })

  it('returns the original array when membership is already correct', () => {
    const nodes = [
      groupNode('group', 0, 0, 500, 400, ['before', 'member', 'after']),
      creativeNode('before', 30, 30),
      creativeNode('member', 60, 80),
      creativeNode('after', 180, 180),
    ]

    const next = reconcileDraggedNodeGroupMembership(nodes, ['member'])

    expect(next).toBe(nodes)
    expect(members(next, 'group')).toEqual(['before', 'member', 'after'])
  })
})
