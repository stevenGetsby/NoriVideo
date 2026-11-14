import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import type { StoryProgram, StoryShop, StoryVariable } from '@/lib/interactive/types'

export const variables: StoryVariable[] = [
  { id: 'coin', name: '金币', type: 'number', initial: 3, max: 10, icon: '🪙', showInHud: true },
  { id: 'key', name: '钥匙', type: 'number', initial: 0 },
  { id: 'brave', name: '勇气', type: 'number', initial: 0, scope: 'permanent' },
  { id: 'seen', name: '见过', type: 'boolean', initial: false, scope: 'permanent' },
  { id: 'stars', name: '星星', type: 'number', initial: 0, max: 3, scope: 'permanent' },
  { id: 'hp', name: '生命', type: 'number', initial: 4, max: 5 },
]

export const shop: StoryShop = {
  enabled: true,
  currencyVariableId: 'coin',
  items: [
    { id: 'key_item', name: '钥匙', icon: '🔑', description: '能打开金库门', price: 5, limit: 1, effects: [{ variableId: 'key', op: 'add', value: 1 }] },
    { id: 'tonic', name: '补品', icon: null, description: '', price: 1, limit: 0, effects: [{ variableId: 'brave', op: 'add', value: 1 }] },
    { id: 'heal', name: '急救包', icon: null, description: '', price: 1, limit: 0, effects: [{ variableId: 'hp', op: 'add', value: 3 }] },
  ],
}

export const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })
export const mount = (id: string, sceneId: string, beatId: string): CanvasEdgeLike =>
  ({ id, source: sceneId, target: beatId, sourceHandle: 'interact', role: 'STORY_MOUNT' })
export const entry: CanvasNodeLike = { id: 'in', type: 'story_entry', data: {} }
export const scene = (id: string, data: Record<string, unknown> = {}): CanvasNodeLike =>
  ({ id, type: 'story_scene', data: { title: id, videoUrl: `/${id}.mp4`, ...data } })
export const ending = (id: string, endingType = 'good'): CanvasNodeLike => ({ id, type: 'story_ending', data: { title: id, endingType } })
export const beat = (id: string, data: Record<string, unknown>): CanvasNodeLike => ({ id, type: 'story_interaction', data: { title: id, ...data } })

/** An option the viewer cannot pick until they hold a key; locked cards link to the key's shop item. */
export const keyUnlock = (mode: 'hidden' | 'locked' = 'locked', shopItemId: string | null = 'key_item') =>
  ({ mode, match: 'all', conditions: [{ variableId: 'key', op: '>=', value: 1 }], shopItemId })

export const braveUnlock = { mode: 'hidden', match: 'all', conditions: [{ variableId: 'brave', op: '>=', value: 3 }], shopItemId: null }

export function programOf(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[], extra: { shop?: StoryShop | undefined; variables?: StoryVariable[] } = {}): StoryProgram {
  const shopValue = 'shop' in extra ? extra.shop : shop
  return {
    variables: extra.variables ?? variables,
    chapters: [compileChapter({ projectId: 'p', title: '章' }, nodes, edges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
    ...(shopValue ? { shop: shopValue } : {}),
  }
}

/** hall → door; 「硬闯」 is always there, 「开门」 needs a key, 「偷看」 needs courage and stays hidden until then. */
export function vaultStory(extra: { shop?: StoryShop | undefined; door?: Record<string, unknown> } = {}): StoryProgram {
  const nodes = [
    entry,
    scene('hall', { videoDurationSec: 10 }),
    {
      id: 'door',
      type: 'story_choice',
      data: {
        title: '大门',
        options: [
          { id: 'o_push', label: '硬闯' },
          { id: 'o_open', label: '开门', unlock: keyUnlock('locked') },
          { id: 'o_peek', label: '偷看', unlock: braveUnlock },
        ],
        ...extra.door,
      },
    },
    ending('bad', 'bad'),
    scene('vault'),
    ending('secret', 'hidden'),
    ending('peeked', 'normal'),
  ]
  const edges = [
    flow('f1', 'in', 'hall'),
    flow('f2', 'hall', 'door'),
    flow('f3', 'door', 'bad', 'o_push'),
    flow('f4', 'door', 'vault', 'o_open'),
    flow('f5', 'door', 'peeked', 'o_peek'),
    flow('f6', 'vault', 'secret'),
  ]
  return programOf(nodes, edges, 'shop' in extra ? { shop: extra.shop } : {})
}
