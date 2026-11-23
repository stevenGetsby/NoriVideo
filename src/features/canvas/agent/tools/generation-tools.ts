import type { z } from 'zod'
import type { canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import { firstLastFrameInputSchema, imageToVideoInputSchema, resolveCanvasGenerationInputSchema, validateCanvasReferenceMedia, validateCanvasRequiredFields, validateVideoReferenceMediaCombination } from '@/lib/canvas/generation-input-schema'
import { readCanvasGlobalStylePrompt, readCanvasVideoPrefixPrompt } from '@/lib/canvas/global-style-prompt'
import type { CanvasFlowNode } from '../../editor-types'
import {
  buildCanvasGenerateRequest, buildQuoteParams, canvasProviderResolution, compatibleIncomingReferences,
  mediaTypeForReference, nodeKind, orderedReferenceSummaries, type CanvasGenerateRequest, type CanvasGenerationServiceConfig,
} from '../../generation/generate-request-core'
import { createNodeResolver } from '../alias'
import type { CanvasAgentBridge } from '../bridge-types'
import { normalizeAgentGenerationParams } from '../commands/generation-params'
import { isNodeBusy } from '../commands/node-state'
import { redactCanvasAgentText } from '../digest'
import { CanvasAgentToolError } from '../tool-error'
import type { BatchApproval, GenerationPreview } from '../batch-confirmation'

type QuoteInput = z.output<typeof canvasAgentToolSchemas.quote>
type GenerateInput = z.output<typeof canvasAgentToolSchemas.generate>
type ServiceConfig = Pick<CanvasGenerationServiceConfig, 'textModels' | 'imageModels' | 'videoModels'> & {
  defaults: Partial<CanvasGenerationServiceConfig['defaults']>
}
type GenerationCtx = {
  bridge: CanvasAgentBridge
  turn: { quotedPoints: number }
  stopped(): boolean
  settings: { autonomy: 'confirm_costly' | 'auto_budget'; budgetPoints: number }
  loadConfig(): Promise<ServiceConfig>
  quote(query: URLSearchParams): Promise<number | null>
  confirm(input: GenerationPreview, callId?: string): Promise<boolean>
  consumeBatchApproval?(callId: string, input: GenerationPreview): BatchApproval
  onSubmitted?(id: string): void
}

const done = (payload: Record<string, unknown>) => ({ status: 'done', ...payload })
const selectableTypes = new Set(['text', 'note', 'image', 'video'])

export function createGenerationTools(ctx: GenerationCtx) {
  let config: Promise<ServiceConfig> | undefined
  const getConfig = () => config ??= ctx.loadConfig()
  const graph = () => ctx.bridge.getGraph()
  const find = (ref: string) => createNodeResolver(graph().nodes)(ref)
  const guard = () => {
    if (ctx.stopped()) throw new CanvasAgentToolError('STOPPED')
    if (ctx.bridge.isWriteLocked() || ctx.bridge.readOnly || ctx.bridge.mode === 'story') throw new CanvasAgentToolError('CANVAS_LOCKED')
  }
  const collect = (nodeId: string, state = graph()) => {
    const byId = new Map(state.nodes.map((item) => [item.id, item]))
    const node = byId.get(nodeId)
    if (!node) throw new CanvasAgentToolError('NODE_NOT_FOUND')
    const incoming = state.edges.filter((edge) => edge.target === node.id).flatMap((edge) => {
      const source = byId.get(edge.source)
      return source ? [source] : []
    })
    return { node, incoming, nodes: state.nodes, byId }
  }
  const prepare = async (nodeId: string, write: boolean) => {
    if (!write) return
    const { node, incoming, byId } = collect(nodeId)
    const ids = [node, ...incoming, ...(node.data.generation?.referenceNodeIds ?? []).flatMap((id) => byId.get(id) ?? [])]
      .filter((item) => item.data.__canvasUnhydrated).map((item) => item.id)
    if (!ids.length) return
    if (!ctx.bridge.prepareNodesForWrite) throw new CanvasAgentToolError('NODE_DETAIL_REQUIRED')
    await ctx.bridge.prepareNodesForWrite([...new Set(ids)])
    guard()
    const now = new Map(graph().nodes.map((item) => [item.id, item]))
    if (ids.some((id) => now.get(id)?.data.__canvasUnhydrated)) throw new CanvasAgentToolError('NODE_DETAIL_REQUIRED')
  }

  function plan(nodeId: string, input: GenerateInput | QuoteInput, config: ServiceConfig, snapshot = graph()) {
    const { node, incoming, nodes, byId } = collect(nodeId, snapshot)
    if (!selectableTypes.has(node.type || '')) throw new CanvasAgentToolError('UNSUPPORTED_NODE')
    const type = nodeKind(node) as 'text' | 'image' | 'video'
    if (node.data.processType === 'image_edit' || node.data.processType === 'storyboard') throw new CanvasAgentToolError('UNSUPPORTED_NODE', '请使用生成面板')
    const list = type === 'text' ? config.textModels : type === 'image' ? config.imageModels : config.videoModels
    const fallback = type === 'text' ? config.defaults.textModel : type === 'image' ? config.defaults.imageModel : config.defaults.videoModel
    const modelKey = input.modelKey || node.data.generation?.modelKey || fallback
    const model = list.find((item) => item.modelKey === modelKey)
    if (!model || model.available === false) throw new CanvasAgentToolError('MODEL_UNAVAILABLE', redactCanvasAgentText(model?.unavailableReason, 80))
    if (type === 'text' && input.params) throw new CanvasAgentToolError('INVALID_PARAM')
    const settings = {
      ...node.data.generation,
      ...(type !== 'text' && input.params ? normalizeAgentGenerationParams(type, input.params, node.data.generation) : {}),
    }
    const prompt = ('prompt' in input && input.prompt !== undefined ? input.prompt : node.data.prompt)?.trim()
      || incoming.filter((item) => item.type === 'text' || item.type === 'note' || item.data.mediaType === 'text')
        .map((item) => item.data.text?.trim()).filter(Boolean).join('\n\n')
    if (!prompt) throw new CanvasAgentToolError('NO_PROMPT')
    const inputMode = type === 'video' && (settings.inputMode === 'image' || settings.inputMode === 'firstlastframe') ? settings.inputMode : 'text'
    const compatible = compatibleIncomingReferences(type, incoming)
    const ids = type === 'text' ? [] : [...new Set(settings.referenceNodeIds ?? compatible.map((item) => item.id))]
    if (ids.some((id) => !byId.has(id))) throw new CanvasAgentToolError('NODE_NOT_FOUND')
    const references = orderedReferenceSummaries(ids, nodes, inputMode === 'firstlastframe')
    if (inputMode === 'firstlastframe' && (references.length !== 2 || ids.length !== 2 || ids.some((id) => mediaTypeForReference(byId.get(id)!) !== 'image'))) {
      throw new CanvasAgentToolError('INVALID_PARAM', '首尾帧需要连接 2 张图片')
    }
    if (inputMode === 'firstlastframe' && model.firstLastFrame === false) throw new CanvasAgentToolError('INVALID_PARAM')
    const request = buildCanvasGenerateRequest({
      nodeId, type, modelKey: model.modelKey, modelLabel: model.name, prompt, inputMode,
      referenceNodeIds: ids, referenceSummary: references,
      aspectRatio: settings.aspectRatio || '16:9',
      resolution: canvasProviderResolution(type, settings.resolution || (type === 'video' ? '720p' : '2K'), model),
      quality: settings.quality === 'medium' || settings.quality === 'low' ? settings.quality : 'high',
      duration: settings.duration ?? 5, generateAudio: settings.generateAudio ?? true, count: input.count ?? 1,
      storyboard: false, audioMode: 'tts', audioVoice: '', audioGenre: '', audioSfxKind: '',
    })
    if (type !== 'text') {
      const schema = inputMode === 'firstlastframe' ? firstLastFrameInputSchema()
        : inputMode === 'image' ? imageToVideoInputSchema(model.inputSchema?.image.max)
          : model.inputSchema ?? resolveCanvasGenerationInputSchema(type)
      const [error] = [
        ...validateCanvasRequiredFields(schema, request),
        ...validateCanvasReferenceMedia(schema, references),
        ...(type === 'video' ? validateVideoReferenceMediaCombination(references) : []),
      ]
      if (error) throw new CanvasAgentToolError('INVALID_PARAM', error.slice(0, 80))
    }
    const fingerprint = JSON.stringify([
      request, node.data.processType, node.data.contentUrl, node.data.videoUrl, node.data.imageUrl,
      node.data.generation?.parameters?.referenceMaterialId,
      type === 'text' ? '' : readCanvasGlobalStylePrompt(nodes),
      type === 'video' ? readCanvasVideoPrefixPrompt(nodes) : '',
      ids.map((id) => {
        const data = byId.get(id)?.data
        return [data?.materialId, data?.contentUrl, data?.imageUrl, data?.videoUrl, data?.audioUrl, data?.voiceDetached]
      }),
    ])
    return { request, nodes, fingerprint, title: redactCanvasAgentText(node.data.title, 40) || '节点' }
  }

  const getQuote = async (request: CanvasGenerateRequest, nodes: CanvasFlowNode[]) => {
    if (request.type === 'text') return null
    const result = await ctx.quote(buildQuoteParams(request, nodes))
    return typeof result === 'number' && Number.isFinite(result) && result >= 0 ? result : null
  }

  const previewOf = async (planned: ReturnType<typeof plan>): Promise<GenerationPreview> => ({
    nodeId: planned.request.nodeId, fingerprint: planned.fingerprint, title: planned.title,
    model: planned.request.modelLabel, count: planned.request.count,
    media: planned.request.type as 'text' | 'image' | 'video',
    resolution: planned.request.resolution, aspectRatio: planned.request.aspectRatio, duration: planned.request.duration,
    points: await getQuote(planned.request, planned.nodes).catch(() => null),
  })

  return {
    async preview(input: GenerateInput) {
      guard()
      const serviceConfig = await getConfig()
      const snapshot = graph()
      const { id } = createNodeResolver(snapshot.nodes)(input.node)
      const { node, incoming, byId } = collect(id, snapshot)
      if (isNodeBusy(node)) throw new CanvasAgentToolError('RUNNING_NODE')
      const details = new Map<string, CanvasFlowNode>()
      const readDetails = async (item: CanvasFlowNode) => {
        if (!item.data.__canvasUnhydrated || details.has(item.id)) return
        const detail = await ctx.bridge.readNodeDetails?.(item.id)
        if (!detail || detail.id !== item.id || detail.data.__canvasUnhydrated) throw new CanvasAgentToolError('NODE_DETAIL_REQUIRED')
        details.set(item.id, detail)
      }
      await readDetails(node)
      const referenceIds = (details.get(id) ?? node).data.generation?.referenceNodeIds ?? []
      const relevant = new Map([
        ...incoming,
        ...referenceIds.flatMap((ref) => byId.get(ref) ?? []),
        ...snapshot.nodes.filter((item) => item.data.globalStylePrompt || item.data.videoPrefixPrompt),
      ].map((item) => [item.id, item]))
      for (const item of relevant.values()) { guard(); await readDetails(item) }
      guard()
      // Quote from a private snapshot; never replace shells in the editor to show a card.
      return previewOf(plan(id, input, serviceConfig, {
        ...snapshot, nodes: details.size ? snapshot.nodes.map((item) => details.get(item.id) ?? item) : snapshot.nodes,
      }))
    },
    async contentModels(type: 'text' | 'image' | 'video') {
      const config = await getConfig()
      const list = type === 'text' ? config.textModels : type === 'image' ? config.imageModels : config.videoModels
      const models = [...list].sort((a, b) => Number(a.available === false) - Number(b.available === false)).slice(0, 20)
        .map(({ modelKey, name, available, unavailableReason, options }) => ({
          modelKey: redactCanvasAgentText(modelKey, 120), name: redactCanvasAgentText(name, 60),
          available: available !== false, unavailableReason: redactCanvasAgentText(unavailableReason, 80),
          options: { aspectRatio: options?.aspectRatio, resolution: options?.resolution, duration: options?.duration },
        }))
      return done({ models, defaultModelKey: config.defaults[`${type}Model`] ?? null })
    },
    async quote(input: QuoteInput) {
      const node = find(input.node)
      const next = plan(node.id, input, await getConfig())
      if (next.request.type === 'text') return done({ points: null, note: '按实际用量计费' })
      const points = await getQuote(next.request, next.nodes).catch(() => null)
      if (points === null) throw new CanvasAgentToolError('QUOTE_FAILED')
      return done({ points })
    },
    async generate(input: GenerateInput, callId?: string) {
      guard()
      const id = find(input.node).id
      if (!selectableTypes.has(collect(id).node.type || '')) {
        ctx.bridge.select([id])
        throw new CanvasAgentToolError('UNSUPPORTED_NODE', '请使用生成面板')
      }
      await prepare(id, true)
      const serviceConfig = await getConfig()
      guard()
      const initial = collect(id).node
      if (isNodeBusy(initial)) throw new CanvasAgentToolError('RUNNING_NODE')
      if (input.prompt !== undefined || input.params) {
        if (input.params && initial.type !== 'image' && initial.type !== 'video') throw new CanvasAgentToolError('INVALID_PARAM')
        const generation = input.params && (initial.type === 'image' || initial.type === 'video')
          ? { ...initial.data.generation, ...normalizeAgentGenerationParams(initial.type, input.params, initial.data.generation) }
          : initial.data.generation
        await ctx.bridge.run(() => {
          guard()
          const state = graph()
          ctx.bridge.commit({
            label: '修改生成草稿', nodes: state.nodes.map((item) => item.id === id
              ? { ...item, data: { ...item.data, generation, ...(input.prompt === undefined ? {} : { prompt: input.prompt }) } } : item),
            edges: state.edges, touchedNodeIds: [id], deletedNodeIds: [], deletedEdgeIds: [],
          })
        })
      }
      const original = plan(id, input, serviceConfig)
      const confirmation = await previewOf(original)
      const { points } = confirmation
      guard()
      const batchApproval = callId ? ctx.consumeBatchApproval?.(callId, confirmation) : undefined
      if (batchApproval === 'declined') return { status: 'declined' }
      const automatic = batchApproval !== 'changed' && ctx.settings.autonomy === 'auto_budget' && points !== null
        && ctx.turn.quotedPoints + points <= ctx.settings.budgetPoints
      if (!automatic && batchApproval !== 'approved' && !(await ctx.confirm(confirmation, callId))) {
        return { status: 'declined' }
      }
      guard()
      if (isNodeBusy(collect(id).node)) throw new CanvasAgentToolError('RUNNING_NODE')
      const verifyApproval = () => {
        guard()
        if (original.fingerprint !== plan(id, input, serviceConfig).fingerprint) {
          throw new CanvasAgentToolError('CANVAS_CHANGED')
        }
      }
      try {
        await ctx.bridge.run(() => {
          verifyApproval()
          return ctx.bridge.generate({ ...original.request, quotedCostPoints: points }, verifyApproval)
        })
      } catch (error) {
        if (error instanceof CanvasAgentToolError) throw error
        throw new CanvasAgentToolError('GENERATE_FAILED', error instanceof Error ? redactCanvasAgentText(error.message, 80) : '')
      }
      ctx.turn.quotedPoints += points ?? 0
      ctx.onSubmitted?.(id)
      return done({ submitted: true, points, automatic, note: '生成在后台进行，完成后节点会自动更新' })
    },
  }
}
