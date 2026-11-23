import { afterEach, expect, it, vi } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { streamText, type ModelMessage } from 'ai'
import { resolveCanvasAgentLanguageModel } from '@/lib/canvas-agent/model-runtime'
import { canvasAgentTools } from '@/lib/canvas-agent/tools'
import { CANVAS_RECORDING_MAX_BYTES, parseCanvasAgentRecording } from '../../helpers/canvas-agent-recording'

// Synthetic protocol fixtures: they exercise the actual installed adapter but
// must never be used as evidence that a real provider/model passed recording QA.
const fixture = vi.hoisted(() => ({
  registry: [
    { providerId: 'deepseek', modelId: 'fixture-ds', displayName: 'Fixture DS', protocol: 'chat-completions', toolStreamingVerified: true },
    { providerId: 'kimi', modelId: 'fixture-kimi', displayName: 'Fixture Kimi', protocol: 'chat-completions', toolStreamingVerified: true },
    { providerId: 'openai', modelId: 'fixture-openai', displayName: 'Fixture OpenAI', protocol: 'responses', toolStreamingVerified: true },
  ],
}))
vi.mock('@/lib/canvas-agent/provider-registry', async (original) => ({
  ...await original<typeof import('@/lib/canvas-agent/provider-registry')>(),
  CANVAS_AGENT_MODEL_CANDIDATES: fixture.registry,
}))
vi.mock('@/lib/service-config', () => ({
  readServiceConfig: () => ({ llm: {
    providers: fixture.registry.map(({ providerId }) => ({ id: providerId, apiKey: 'local-contract-test-key' })),
    agentModels: Object.fromEntries(fixture.registry.map(({ providerId, modelId }) =>
      [`${providerId}::${modelId}`, { canvasAgent: true }])),
  } }),
}))
vi.mock('@/lib/model-pricing/catalog', () => ({ findBuiltinPricingCatalogEntry: () => ({}) }))
vi.mock('@/lib/model-pricing/lookup', () => ({ resolveBuiltinPricing: () => ({ status: 'resolved', amount: 1 }) }))
afterEach(() => vi.unstubAllGlobals())

const steps = [
  { name: 'build_graph', args: { title: '合成蓝图', nodes: [{ key: 'n1', type: 'text' }] } },
  { name: 'find_nodes', args: { query: '合成蓝图' } },
]
const sse = (events: object[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'

function chatStream(model: string, step: number) {
  const { name, args } = steps[step]
  const base = { id: `chat-${step}`, object: 'chat.completion.chunk', created: 1_795_346_000, model }
  return sse([
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '已理解。' }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } },
  ])
}

function responsesStream(model: string, step: number) {
  const { name, args } = steps[step]
  const item = { type: 'function_call', id: `fc_${step}`, call_id: `call-${step}`, name, arguments: '' }
  const message = { type: 'message', id: `msg-${step}`, role: 'assistant', content: [] }
  return sse([
    { type: 'response.created', response: { id: `resp_${step}`, created_at: 1_795_346_000, model } },
    { type: 'response.output_item.added', output_index: 0, item: message },
    { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: '已理解。' },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.output_item.added', output_index: 1, item },
    { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 1, delta: JSON.stringify(args) },
    { type: 'response.output_item.done', output_index: 1, item: { ...item, status: 'completed', arguments: JSON.stringify(args) } },
    { type: 'response.completed', response: { usage: { input_tokens: 9, output_tokens: 4 } } },
  ])
}

it.each([
  ['deepseek::fixture-ds', 'https://api.deepseek.com/v1/chat/completions', false],
  ['kimi::fixture-kimi', 'https://api.moonshot.ai/v1/chat/completions', false],
  ['openai::fixture-openai', 'https://api.openai.com/v1/responses', true],
] as const)('decodes two tool streams and usage via the installed SDK for %s', async (modelKey, endpoint, responses) => {
  let call = 0
  const mock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe(endpoint)
    const envelope = JSON.parse(String(init?.body))
    const model = modelKey.split('::')[1]
    expect(envelope.model).toBe(model)
    if (modelKey.startsWith('deepseek::')) expect(envelope.thinking).toEqual({ type: 'disabled' })
    return new Response(responses ? responsesStream(model, call++) : chatStream(model, call++), {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    })
  })
  vi.stubGlobal('fetch', mock)
  const resolved = await resolveCanvasAgentLanguageModel({ userId: 'fixture', requestedModelKey: modelKey })
  for (const step of steps) {
    const output = streamText({ model: resolved.languageModel, tools: canvasAgentTools, prompt: '测试', maxRetries: 0 })
    expect(await output.text).toBe('已理解。')
    expect((await output.toolCalls).map((item) => item.toolName)).toEqual([step.name])
    expect(await output.totalUsage).toMatchObject({ inputTokens: 9, outputTokens: 4 })
  }
  expect(mock).toHaveBeenCalledTimes(2)
})

const recordingPath = process.env.NORI_CANVAS_AGENT_RECORDING
it.skipIf(!recordingPath)('replays a separately reviewed, sanitized provider capture without network access', async () => {
  const metadata = await stat(recordingPath!)
  if (!metadata.isFile() || metadata.size > CANVAS_RECORDING_MAX_BYTES) throw new Error('脱敏录制不是限额内的文件')
  const capture = parseCanvasAgentRecording(await readFile(recordingPath!, 'utf8'))
  const provider = capture.providerId
  const addresses = {
    deepseek: 'https://api.deepseek.com/v1/chat/completions',
    kimi: 'https://api.moonshot.ai/v1/chat/completions',
    openai: 'https://api.openai.com/v1/responses',
  }
  const key = `${provider}::${capture.modelId}`
  const index = fixture.registry.length
  // This override exists in this test process only. It cannot change the
  // registry shipped to users or certify that the bytes came from a vendor.
  fixture.registry.push({
    providerId: provider, modelId: capture.modelId, displayName: '离线录制回放',
    protocol: provider === 'openai' ? 'responses' : 'chat-completions', toolStreamingVerified: true,
  })
  try {
    let call = 0
    const segments = [capture.first, capture.followUp]
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) !== addresses[provider] || call >= segments.length) throw new Error('Unexpected replay request')
      const request = JSON.parse(String(init?.body))
      if (request.model !== capture.modelId || (provider === 'deepseek' && request.thinking?.type !== 'disabled')) {
        throw new Error('Unexpected replay parameters')
      }
      return new Response(segments[call++].stream, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const resolved = await resolveCanvasAgentLanguageModel({ userId: 'offline-review', requestedModelKey: key })
    const messages: ModelMessage[] = [{ role: 'user', content: '构建一张合成蓝图，然后查找建好的节点。' }]
    for (const [step, expectedTool] of ['build_graph', 'find_nodes'].entries()) {
      const output = streamText({ model: resolved.languageModel, tools: canvasAgentTools, messages, maxRetries: 0 })
      const [tools, usage, response] = await Promise.all([output.toolCalls, output.totalUsage, output.response])
      const tool = tools[0]
      if (tools.length !== 1 || tool.toolName !== expectedTool || !(usage.inputTokens! > 0) || !(usage.outputTokens! > 0)
        || response.modelId !== segments[step].reportedModelId || (step === 0 && !(await output.text).trim())) {
        throw new Error('脱敏录制没有重现预期工具、型号和用量')
      }
      messages.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: tool.toolCallId, toolName: tool.toolName, input: tool.input }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: tool.toolCallId, toolName: tool.toolName,
          output: { type: 'json', value: { status: 'done', ref: 'nfixture' } } }] })
    }
    if (call !== 2) throw new Error('Expected two offline requests')
  } catch {
    throw new Error('脱敏录制离线回放失败，未启用任何真实模型')
  } finally {
    fixture.registry.splice(index, 1)
  }
})
