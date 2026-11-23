import type { z } from 'zod'
import { canvasAgentToolSchemas, type CanvasAgentToolName } from '@/lib/canvas-agent/tool-schemas'
import type { AgentGraphChange, CanvasAgentBridge } from './bridge-types'
import { createNodeResolver, nodeAlias } from './alias'
import { planArrange } from './commands/arrange'
import { planBuildGraph } from './commands/build-graph'
import { planCanvasPrompt } from './commands/canvas-prompt'
import { planConnect, planDisconnect } from './commands/connect'
import { planDeleteNodes } from './commands/delete-nodes'
import { planGroupNodes } from './commands/group'
import { hasNodeMedia, isNodeBusy, nodeMedia } from './commands/node-state'
import { planPlaylist } from './commands/playlist'
import { planUpdateNodes } from './commands/update-nodes'
import { redactCanvasAgentText, type AgentGraph } from './digest'
import { CanvasAgentToolError } from './tool-error'
import { findAgentNodes, readAgentNode } from './tools/read-tools'

type ToolInput<Name extends CanvasAgentToolName> = z.output<(typeof canvasAgentToolSchemas)[Name]>
type Result = Record<string, unknown>
export type CanvasAgentToolResult = { tool: string; toolCallId: string } & (
  { output: Result; state?: never } | { state: 'output-error'; errorText: string }
)
type ContentType = ToolInput<'list_models'>['type']
type Blueprint = ReturnType<typeof planBuildGraph>['blueprint']
type DeletePlan = ReturnType<typeof planDeleteNodes>

export type CanvasAgentExecutionContext = {
  bridge: CanvasAgentBridge
  turn: { toolCalls: number; questions: number; quotedPoints: number; touchedNodeIds?: Set<string> }
  stopped(): boolean
  confirmBlueprint(blueprint: Blueprint): Promise<boolean>
  confirmDelete(plan: DeletePlan, reason: string): Promise<boolean>
  ask(question: string, options: string[]): Promise<string | null>
  hasExplicitDeleteIntent?(): boolean
  follow?: boolean
  contentModels?(type: ContentType): Promise<Result>
  quote?(input: ToolInput<'quote'>): Promise<Result>
  generate?(input: ToolInput<'generate'>, callId: string): Promise<Result>
  step?(input: { toolCallId: string; tool: string; status: 'running' | 'done' | 'skipped' | 'failed' }): void
}

const done = (output: Result = {}) => ({ status: 'done', ...output })
function assertWritable(ctx: CanvasAgentExecutionContext) {
  if (ctx.stopped()) throw new CanvasAgentToolError('STOPPED')
  if (ctx.bridge.readOnly || ctx.bridge.mode !== 'canvas' || ctx.bridge.isWriteLocked()) throw new CanvasAgentToolError('CANVAS_LOCKED')
}

type Plan = { change: AgentGraphChange | null; output: Result }
async function commitPlan(ctx: CanvasAgentExecutionContext, plan: (graph: AgentGraph) => Plan, initial?: Plan) {
  assertWritable(ctx)
  const graph = ctx.bridge.getGraph()
  const proposed = initial ?? plan(graph)
  if (!proposed.change) return proposed.output
  const next = new Map(proposed.change.nodes.map((node) => [node.id, node]))
  const needsDetail = graph.nodes.filter((node) => {
    const updated = next.get(node.id)
    return node.data.__canvasUnhydrated && updated && updated.data !== node.data
  }).map((node) => node.id)
  if (needsDetail.length) {
    if (!ctx.bridge.prepareNodesForWrite) throw new CanvasAgentToolError('NODE_DETAIL_REQUIRED')
    await ctx.bridge.prepareNodesForWrite(needsDetail)
  }
  const current = ctx.bridge.getGraph()
  const prepared = needsDetail.length || current.nodes !== graph.nodes || current.edges !== graph.edges ? plan(current) : proposed
  if (!prepared.change) return prepared.output
  const change = prepared.change
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]))
  if (change.nodes.some((node) => currentNodes.get(node.id)?.data.__canvasUnhydrated && currentNodes.get(node.id)?.data !== node.data)) {
    throw new CanvasAgentToolError('NODE_DETAIL_REQUIRED')
  }
  await ctx.bridge.run(() => { assertWritable(ctx); ctx.bridge.commit(change) })
  if (change.touchedNodeIds.length) {
    ctx.turn.touchedNodeIds ??= new Set()
    change.touchedNodeIds.forEach((id) => ctx.turn.touchedNodeIds!.add(id))
    ctx.bridge.flash(change.touchedNodeIds, ctx.follow)
  }
  return prepared.output
}

function tool<Name extends CanvasAgentToolName>(
  name: Name,
  handler: (input: ToolInput<Name>, ctx: CanvasAgentExecutionContext, callId: string) => Result | Promise<Result>,
  mutating = false,
) {
  return (raw: unknown, ctx: CanvasAgentExecutionContext, callId: string) => {
    const parsed = canvasAgentToolSchemas[name].safeParse(raw)
    if (!parsed.success) throw new CanvasAgentToolError('BAD_INPUT', parsed.error.issues[0]?.path.join('.') || name)
    if (mutating) assertWritable(ctx)
    return handler(parsed.data as ToolInput<Name>, ctx, callId)
  }
}

const handlers = {
  find_nodes: tool('find_nodes', findAgentNodes),
  read_node: tool('read_node', (input, ctx) => readAgentNode(input.node, ctx)),
  list_models: tool('list_models', (input, ctx) => ctx.contentModels?.(input.type) ?? done({ models: [], defaultModelKey: null })),
  quote: tool('quote', (input, ctx) => {
    if (!ctx.quote) throw new CanvasAgentToolError('QUOTE_FAILED')
    return ctx.quote(input)
  }),
  build_graph: tool('build_graph', async (input, ctx) => {
    if (input.nodes.length > 6) {
      const preview = planBuildGraph(input, ctx.bridge.getGraph(), ctx.bridge.limits, ctx.bridge.centerPosition())
      if (!(await ctx.confirmBlueprint(preview.blueprint))) return { status: 'declined' }
    }
    return commitPlan(ctx, (graph) => {
      const { change, created, linkResults } = planBuildGraph(input, graph, ctx.bridge.limits, ctx.bridge.centerPosition())
      return { change, output: done({ created: created.map((item) => ({ ...item, title: redactCanvasAgentText(item.title, 40) })), links: linkResults }) }
    })
  }, true),
  update_nodes: tool('update_nodes', (input, ctx) => commitPlan(ctx, (graph) => {
    const { change, results } = planUpdateNodes(input, graph)
    return { change, output: done({ results }) }
  }), true),
  connect_nodes: tool('connect_nodes', (input, ctx) => commitPlan(ctx, (graph) => {
    const { change, added, skipped } = planConnect(input.links, graph, ctx.bridge.limits)
    return { change, output: done({ added, skipped }) }
  }), true),
  disconnect_nodes: tool('disconnect_nodes', (input, ctx) => commitPlan(ctx, (graph) => {
    const { change, removed } = planDisconnect(input.links, graph)
    return { change, output: done({ removed }) }
  }), true),
  delete_nodes: tool('delete_nodes', async (input, ctx) => {
    const proposal = planDeleteNodes(input, ctx.bridge.getGraph())
    const signature = (result: DeletePlan) => [...result.change.deletedNodeIds].sort().join('\0')
    const proposedIds = signature(proposal)
    if (proposal.needsConfirmation || !ctx.hasExplicitDeleteIntent?.()) {
      if (!(await ctx.confirmDelete(proposal, input.reason))) return { status: 'declined' }
    }
    return commitPlan(ctx, (graph) => {
      const latest = planDeleteNodes(input, graph)
      if (signature(latest) !== proposedIds || (latest.needsConfirmation && !proposal.needsConfirmation && ctx.hasExplicitDeleteIntent?.())) {
        throw new CanvasAgentToolError('CANVAS_CHANGED')
      }
      return { change: latest.change, output: done({ deleted: latest.deleted }) }
    })
  }, true),
  arrange: tool('arrange', (input, ctx) => commitPlan(ctx, (graph) => {
    const change = planArrange(input, graph)
    return { change: change.touchedNodeIds.length ? change : null, output: done({ moved: change.touchedNodeIds.length }) }
  }), true),
  group_nodes: tool('group_nodes', (input, ctx) => commitPlan(ctx, (graph) => {
    const change = planGroupNodes(input, graph, ctx.bridge.limits)
    return { change, output: done({ group: nodeAlias(change.nodes.at(-1)!.id) }) }
  }), true),
  set_canvas_prompt: tool('set_canvas_prompt', (input, ctx) => commitPlan(ctx, (graph) => {
    const change = planCanvasPrompt(input, graph, ctx.bridge.limits, ctx.bridge.centerPosition())
    return { change, output: done({ changed: Boolean(change) }) }
  }), true),
  add_to_playlist: tool('add_to_playlist', (input, ctx) => commitPlan(ctx, (graph) => {
    const { change, added, skipped } = planPlaylist(input, graph, ctx.bridge.limits)
    return { change, output: done({ added, skipped }) }
  }), true),
  focus: tool('focus', (input, ctx) => {
    const resolve = createNodeResolver(ctx.bridge.getGraph().nodes)
    const ids = input.nodes?.map((ref) => resolve(ref).id) || []
    ctx.bridge.focus(ids.length ? ids : 'all')
    if (input.select) ctx.bridge.select(ids)
    return done({ focused: ids.length || 'all' })
  }),
  generate: tool('generate', (input, ctx, callId) => {
    if (!ctx.generate) throw new CanvasAgentToolError('UNSUPPORTED_ACTION')
    return ctx.generate(input, callId)
  }, true),
  open_tool: tool('open_tool', async (input, ctx) => {
    const node = createNodeResolver(ctx.bridge.getGraph().nodes)(input.node)
    const media = nodeMedia(node)
    if (input.tool === 'generator') {
      if (!['note', 'text', 'image', 'video', 'audio', 'model_3d'].includes(node.type || '')) throw new CanvasAgentToolError('UNSUPPORTED_ACTION')
      ctx.bridge.select([node.id])
      return done({ opened: input.tool })
    }
    if ((['image_edit', 'grid_split', 'lens_focus', 'panorama_720'].includes(input.tool) && media !== 'image')
      || (input.tool === 'superresolve' && media !== 'video' && media !== 'image')
      || (['subtitle_erase', 'audio_extract'].includes(input.tool) && media !== 'video')
      || (input.tool === 'preview' && (!hasNodeMedia(node) || media === 'model3d'))
      || (input.tool === 'studio_3d' && node.type !== 'studio_3d' && media !== 'model3d')) {
      throw new CanvasAgentToolError('UNSUPPORTED_ACTION')
    }
    const action = input.tool
    if (action === 'panorama_720') await ctx.bridge.run(() => ctx.bridge.runNodeAction(node.id, action))
    else await ctx.bridge.runNodeAction(node.id, action)
    return done({ opened: action, note: '已打开，等待用户在对话框里确认' })
  }, true),
  cancel_generation: tool('cancel_generation', async (input, ctx) => {
    const node = createNodeResolver(ctx.bridge.getGraph().nodes)(input.node)
    if (!isNodeBusy(node)) return done({ changed: false })
    if (!node.data.generationTask?.taskId || node.data.__server?.status !== 'RUNNING') throw new CanvasAgentToolError('UNSUPPORTED_ACTION')
    const cancelled = await ctx.bridge.run(() => ctx.bridge.runNodeAction(node.id, 'cancel_generation'))
    if (cancelled === false) throw new CanvasAgentToolError('CANCEL_FAILED')
    return done({ changed: true })
  }, true),
  ask_user: tool('ask_user', async (input, ctx) => {
    if (++ctx.turn.questions > 2) throw new CanvasAgentToolError('TURN_LIMIT', '问题太多')
    const answer = await ctx.ask(input.question, input.options)
    if (answer === null || ctx.stopped()) throw new CanvasAgentToolError('STOPPED')
    return done({ answer })
  }),
} satisfies Record<CanvasAgentToolName, (input: unknown, ctx: CanvasAgentExecutionContext, callId: string) => Result | Promise<Result>>

function boundedOutput(output: Result): Result {
  const encoder = new TextEncoder()
  const fits = (value: Result) => encoder.encode(JSON.stringify(value)).byteLength <= 8192
  const trim = (value: unknown, limit: number): unknown => typeof value === 'string' ? value.slice(0, limit)
    : Array.isArray(value) ? value.slice(0, Math.min(24, Math.max(1, limit / 32))).map((item) => trim(item, limit))
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trim(item, limit)])) : value
  if (fits(output)) return output
  for (const limit of [1400, 600, 180, 60]) {
    const candidate = { ...(trim(output, limit) as Result), truncated: true }
    if (fits(candidate)) return candidate
  }
  return { status: output.status, truncated: true }
}

export function createToolExecutor(getCtx: () => CanvasAgentExecutionContext, write: (value: CanvasAgentToolResult) => void) {
  let queue = Promise.resolve()
  const callsByTurn = new WeakMap<CanvasAgentExecutionContext['turn'], Set<string>>()
  return (call: { toolCallId: string; toolName: string; input: unknown }) => {
    const ctx = getCtx()
    let seen = callsByTurn.get(ctx.turn)
    if (!seen) { seen = new Set(); callsByTurn.set(ctx.turn, seen) }
    if (seen.has(call.toolCallId)) return queue
    seen.add(call.toolCallId)
    const run = queue.then(async () => {
      const result = { tool: call.toolName, toolCallId: call.toolCallId }
      const step = (status: 'running' | 'done' | 'skipped' | 'failed') => ctx.step?.({ ...result, status })
      try {
        if (++ctx.turn.toolCalls > 24) throw new CanvasAgentToolError('TURN_LIMIT')
        if (ctx.stopped() || ctx.turn !== getCtx().turn) throw new CanvasAgentToolError('STOPPED')
        if (!Object.hasOwn(handlers, call.toolName)) throw new CanvasAgentToolError('BAD_INPUT', 'unknown tool')
        step('running')
        const output = await handlers[call.toolName as CanvasAgentToolName](call.input, ctx, call.toolCallId)
        if (ctx.stopped() || ctx.turn !== getCtx().turn) throw new CanvasAgentToolError('STOPPED')
        write({ ...result, output: boundedOutput(output) })
        step(output.status === 'declined' ? 'skipped' : 'done')
      } catch (error) {
        const known = error instanceof CanvasAgentToolError
        const reason = known ? error.reason : call.toolName === 'generate' ? 'GENERATE_FAILED' : 'BAD_INPUT'
        write({ ...result, state: 'output-error', errorText: `${reason}: ${known ? redactCanvasAgentText(error.detail, 80) : 'internal'}` })
        step('failed')
      }
    })
    queue = run.catch(() => undefined)
    return run
  }
}
