import { describe, expect, it } from 'vitest'
import { resolvePastedWires, selectCopiedWires } from '@/features/canvas/clipboard-wires'
import { STORY_FLOW_ROLE, STORY_MOUNT_ROLE } from '@/lib/interactive/types'

const wire = (id: string, source: string, target: string, role = 'REF') => ({ id, source, target, data: { role } })

describe('canvas copy keeps the wires that feed the copied nodes', () => {
  const edges = [
    wire('image-in', 'image', 'video'),
    wire('audio-in', 'audio', 'video'),
    wire('video-out', 'video', 'next'),
    wire('unrelated', 'image', 'other'),
  ]

  it('carries every input wire of a copied video node, but not its output wires', () => {
    expect(selectCopiedWires(edges, new Set(['video']), false).map((edge) => edge.id)).toEqual(['image-in', 'audio-in'])
  })

  it('keeps wires between copied nodes and input wires from outside in one selection', () => {
    const selection = new Set(['image', 'video'])
    expect(selectCopiedWires(edges, selection, false).map((edge) => edge.id)).toEqual(['image-in', 'audio-in'])
    expect(selectCopiedWires(edges, new Set(['video', 'next']), false).map((edge) => edge.id)).toEqual(['image-in', 'audio-in', 'video-out'])
  })

  it('keeps a copied group self-contained', () => {
    expect(selectCopiedWires(edges, new Set(['image', 'video']), true).map((edge) => edge.id)).toEqual(['image-in'])
  })

  it('never takes over an outside card story line', () => {
    const story = [wire('story-in', 'scene', 'shot', STORY_FLOW_ROLE), wire('story-inside', 'shot', 'shot-2', STORY_FLOW_ROLE)]
    expect(selectCopiedWires(story, new Set(['shot']), false)).toEqual([])
    expect(selectCopiedWires(story, new Set(['shot', 'shot-2']), false).map((edge) => edge.id)).toEqual(['story-inside'])
    expect(selectCopiedWires(story, new Set(['scene', 'shot']), false).map((edge) => edge.id)).toEqual(['story-in'])
  })
})

describe('canvas copy and interaction mounts', () => {
  const mounts = [
    wire('mount-out', 'scene', 'tap', STORY_MOUNT_ROLE),
    wire('mount-in', 'scene', 'swipe', STORY_MOUNT_ROLE),
    wire('result', 'tap', 'ending', STORY_FLOW_ROLE),
  ]

  it('never takes an interaction off the scene it hangs on', () => {
    expect(selectCopiedWires(mounts, new Set(['tap']), false)).toEqual([])
    expect(selectCopiedWires(mounts, new Set(['tap', 'ending']), false).map((edge) => edge.id)).toEqual(['result'])
  })

  it('keeps the mount when the scene is copied together with its interactions', () => {
    expect(selectCopiedWires(mounts, new Set(['scene', 'tap', 'swipe']), false).map((edge) => edge.id)).toEqual(['mount-out', 'mount-in'])
    expect(selectCopiedWires(mounts, new Set(['scene', 'tap']), true).map((edge) => edge.id)).toEqual(['mount-out'])
  })

  it('re-targets a copied mount at the pasted scene and interaction', () => {
    const idMap = new Map([['scene', 'scene-copy'], ['tap', 'tap-copy']])
    const pasted = resolvePastedWires(selectCopiedWires(mounts, new Set(['scene', 'tap']), false), idMap, new Set(['scene', 'tap']))
    expect(pasted.map((edge) => [edge.source, edge.target, edge.data.role])).toEqual([['scene-copy', 'tap-copy', STORY_MOUNT_ROLE]])
  })
})

describe('canvas paste reconnects the copied inputs', () => {
  const copied = [wire('image-in', 'image', 'video'), wire('inside', 'video', 'next'), wire('audio-in', 'audio', 'video')]

  it('points copied wires at the new node and keeps inputs that still exist on the canvas', () => {
    const idMap = new Map([['video', 'video-copy'], ['next', 'next-copy']])
    const pasted = resolvePastedWires(copied, idMap, new Set(['image', 'audio', 'video']))
    expect(pasted.map((edge) => [edge.source, edge.target])).toEqual([
      ['image', 'video-copy'],
      ['video-copy', 'next-copy'],
      ['audio', 'video-copy'],
    ])
  })

  it('drops an input whose asset is not on this canvas and ignores wires into nodes that were not pasted', () => {
    const idMap = new Map([['video', 'video-copy']])
    const pasted = resolvePastedWires(copied, idMap, new Set(['image']))
    expect(pasted.map((edge) => [edge.source, edge.target])).toEqual([['image', 'video-copy']])
  })
})
