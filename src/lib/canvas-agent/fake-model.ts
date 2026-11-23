import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import type { UIMessage } from 'ai'
import type { CanvasAgentDigest } from './context-schema'
import type { CanvasAgentToolName } from './tool-schemas'

const styles = ['吉卜力', '水墨', '赛博朋克', '皮克斯']
type Call = { name: CanvasAgentToolName; input: Record<string, unknown> }
type Script = { text?: string; calls?: Call[] }

function styleIn(value: string) {
  return styles.find((style) => value.includes(style))
}

function blueprint(style: string): Script {
  const shots = ['猫咪打开咖啡馆', '客人坐到窗边', '猫咪端上热咖啡']
  return {
    text: '先把骨架搭出来，你看看。',
    calls: [
      { name: 'set_canvas_prompt', input: { kind: 'global_style', text: `${style}风格，温暖光线，角色一致。` } },
      {
        name: 'build_graph',
        input: {
          title: '猫咪咖啡馆',
          nodes: [
            { key: 'script', type: 'text', text: shots.join('。') },
            ...shots.flatMap((title, index) => [
              { key: `still_${index}`, type: 'image', title, prompt: `${title}，傍晚咖啡馆，窗前暖光，中景。` },
              { key: `clip_${index}`, type: 'video', title: `${title} · 视频`, prompt: '缓慢向前推镜，动作自然。' },
            ]),
          ],
          links: shots.flatMap((_, index) => [
            { from: { key: 'script' }, to: { key: `still_${index}` } },
            { from: { key: `still_${index}` }, to: { key: `clip_${index}` } },
          ]),
        },
      },
    ],
  }
}

function scriptFor(messages: readonly UIMessage[], digest: CanvasAgentDigest): Script {
  const last = messages.at(-1)
  const results = last?.parts.filter((part) => 'state' in part && (part.state === 'output-available' || part.state === 'output-error')) ?? []
  const answer = results.find((part) => part.type === 'tool-ask_user')
  if (answer && 'output' in answer && answer.output && typeof answer.output === 'object' && 'answer' in answer.output) {
    const style = styleIn(String(answer.output.answer))
    if (style) return blueprint(style)
  }
  if (results.length) return { text: '好了。' }
  const text = last?.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join(' ') ?? ''
  if (text.includes('短片')) {
    const style = styleIn(text)
    return style ? blueprint(style) : { calls: [{ name: 'ask_user', input: { question: '想要什么风格？', options: styles } }] }
  }
  const images = digest.rows.filter((row) => row.type === 'image')
  const second = images[1]
  if (/重画|太暗/u.test(text) && second) return { calls: [
    { name: 'update_nodes', input: { updates: [{ node: second.ref, prompt: `${second.snippet ?? ''}，画面明亮` }] } },
    { name: 'generate', input: { node: second.ref } },
  ] }
  if (text.includes('生成') && images.length) return { calls: images.slice(0, 3).map(({ ref }) => ({ name: 'generate', input: { node: ref } })) }
  if (text.includes('整理')) return { calls: [{ name: 'arrange', input: { scope: 'canvas', mode: 'type' } }] }
  if (text.includes('分组') && digest.selection.length >= 2) return { calls: [{ name: 'group_nodes', input: { nodes: digest.selection.slice(0, 2) } }] }
  if (text.includes('删除') && digest.selection.length) return { calls: [{ name: 'delete_nodes', input: { nodes: digest.selection, reason: '测试' } }] }
  return { text: `我是假模型，收到：${Array.from(text).slice(0, 20).join('')}` }
}

function chunks(text: string, length: number) {
  const chars = Array.from(text)
  return Array.from({ length: Math.ceil(chars.length / length) }, (_, index) =>
    chars.slice(index * length, (index + 1) * length).join(''))
}

export function createCanvasAgentFakeModel(messages: readonly UIMessage[], digest: CanvasAgentDigest) {
  if (process.env.NODE_ENV === 'production' || process.env.CANVAS_AGENT_FAKE_MODEL !== '1') return null
  return new MockLanguageModelV3({
    provider: 'canvas-agent-fixture',
    modelId: 'canvas-agent-fixture',
    doStream: async () => {
      const script = scriptFor(messages, digest)
      const parts: LanguageModelV3StreamPart[] = [{ type: 'stream-start', warnings: [] }]
      if (script.text) {
        parts.push({ type: 'text-start', id: 'message' })
        for (const delta of chunks(script.text, 4)) parts.push({ type: 'text-delta', id: 'message', delta })
        parts.push({ type: 'text-end', id: 'message' })
      }
      script.calls?.forEach((call, index) => {
        const id = `call-${index}-${crypto.randomUUID()}`
        const input = JSON.stringify(call.input)
        parts.push({ type: 'tool-input-start', id, toolName: call.name })
        for (const delta of chunks(input, 48)) parts.push({ type: 'tool-input-delta', id, delta })
        parts.push({ type: 'tool-input-end', id })
        parts.push({ type: 'tool-call', toolCallId: id, toolName: call.name, input })
      })
      parts.push({
        type: 'finish',
        finishReason: { unified: script.calls?.length ? 'tool-calls' : 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
      })
      return { stream: simulateReadableStream({ chunks: parts, chunkDelayInMs: 5 }) }
    },
  })
}
