import { streamText, type UIMessage } from 'ai'
import { afterEach, expect, it, vi } from 'vitest'
import { createCanvasAgentFakeModel } from '@/lib/canvas-agent/fake-model'
import { canvasAgentTools } from '@/lib/canvas-agent/tools'
import type { CanvasAgentDigest } from '@/lib/canvas-agent/context-schema'

const digest: CanvasAgentDigest = {
  v: 1,
  canvas: { title: '测试', nodeCount: 0, edgeCount: 0, groupCount: 0 },
  selection: [], rows: [], edges: [], omitted: { nodes: 0, byType: {}, edges: 0 },
}
const user = (text: string): UIMessage => ({ id: 'm1', role: 'user', parts: [{ type: 'text', text }] })

afterEach(() => vi.unstubAllEnvs())

it('never enables the fake model in production', () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('CANVAS_AGENT_FAKE_MODEL', '1')
  expect(createCanvasAgentFakeModel([user('水墨短片')], digest)).toBeNull()
})

it('uses the real AI SDK stream contract to request a local seven-node blueprint', async () => {
  vi.stubEnv('CANVAS_AGENT_FAKE_MODEL', '1')
  const model = createCanvasAgentFakeModel([user('做水墨短片')], digest)
  expect(model).not.toBeNull()
  const response = streamText({ model: model!, tools: canvasAgentTools, prompt: '做水墨短片', maxRetries: 0 })
  const calls = await response.toolCalls
  expect(calls.map((call) => call.toolName)).toEqual(['set_canvas_prompt', 'build_graph'])
  expect(calls[1]?.input).toMatchObject({ title: '猫咪咖啡馆', nodes: expect.any(Array), links: expect.any(Array) })
  const scene = calls[1]!.input as { nodes: unknown[]; links: unknown[] }
  expect(scene.nodes).toHaveLength(7)
  expect(scene.links).toHaveLength(6)
})
