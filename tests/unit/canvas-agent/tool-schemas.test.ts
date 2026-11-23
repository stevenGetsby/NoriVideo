import { describe, expect, it } from 'vitest'
import { CANVAS_AGENT_TOOL_NAMES, canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import { canvasAgentTools } from '@/lib/canvas-agent/tools'

const examples = {
  find_nodes: [{ query: '对白', limit: 5 }, { limit: 51 }],
  read_node: [{ node: 'n3k9x2a' }, { node: '  ' }],
  list_models: [{ type: 'video' }, { type: 'audio' }],
  quote: [{ node: '首镜', count: 2 }, { node: '首镜', count: 0 }],
  build_graph: [{ title: '分镜', nodes: [{ key: 'n1', type: 'video' }] }, { title: '分镜', nodes: [{ key: 'A!', type: 'text' }] }],
  update_nodes: [{ updates: [{ node: '首镜', title: '开场' }] }, { updates: [] }],
  connect_nodes: [{ links: [{ from: '开场', to: '第二镜' }] }, { links: [{ from: '开场', to: '' }] }],
  disconnect_nodes: [{ links: [{ from: '开场', to: '第二镜' }] }, { links: [] }],
  delete_nodes: [{ nodes: ['草稿'], reason: '用户明确要求' }, { nodes: ['草稿'], reason: '' }],
  arrange: [{ scope: 'canvas', mode: 'tidy' }, { scope: 'everything' }],
  group_nodes: [{ nodes: ['开场', '第二镜'], color: 'sky' }, { nodes: ['开场'] }],
  set_canvas_prompt: [{ kind: 'video_prefix', text: '' }, { kind: 'global_style', text: '文'.repeat(2001) }],
  add_to_playlist: [{ playlist: '终版', videos: ['开场'] }, { playlist: '终版', videos: [] }],
  focus: [{ nodes: ['开场'], select: true }, { select: 'yes' }],
  generate: [{ node: '开场', params: { duration: 4 }, count: 1 }, { node: '开场', params: { priceOverride: 0 } }],
  open_tool: [{ node: '开场', tool: 'history' }, { node: '开场', tool: 'arbitrary_action' }],
  cancel_generation: [{ node: '开场' }, { node: undefined }],
  ask_user: [{ question: '选哪版？', options: ['A', 'B'] }, { question: '选哪版？', options: ['A'] }],
} as const

describe('canvas agent tool contracts', () => {
  it('registers exactly the 18 specified tools', () => {
    expect([...CANVAS_AGENT_TOOL_NAMES].sort()).toEqual(Object.keys(examples).sort())
    expect(Object.keys(canvasAgentTools).sort()).toEqual(Object.keys(examples).sort())
    for (const item of Object.values(canvasAgentTools)) {
      expect(item.execute).toBeUndefined()
      expect(item.description?.length).toBeLessThanOrEqual(160)
    }
  })
  for (const name of Object.keys(examples) as (keyof typeof examples)[]) {
    it(`${name} accepts its contract and rejects invalid values and extra fields`, () => {
      const [valid, invalid] = examples[name]
      const schema = canvasAgentToolSchemas[name]
      expect(schema.safeParse(valid).success).toBe(true)
      expect(schema.safeParse(invalid).success).toBe(false)
      expect(schema.safeParse({ ...valid, unrecognized: true }).success).toBe(false)
    })
  }
  it('also rejects unknown input fields inside nested blueprint endpoints', () => {
    expect(canvasAgentToolSchemas.build_graph.safeParse({
      title: '分镜', nodes: [{ key: 'n1', type: 'text' }], links: [{ from: { key: 'n1', hidden: true }, to: '第二镜' }],
    }).success).toBe(false)
  })
})
