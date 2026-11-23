'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, getPageLocale } from '@/lib/api-fetch'
import type { CanvasGenerationServiceConfig } from '../generation/generate-request-core'
import type { CanvasAgentBridge, CanvasAgentTurnState } from './bridge-types'
import type { CanvasAgentSettings } from './client-state'
import { buildCanvasDigest } from './digest'
import { createToolExecutor, type CanvasAgentExecutionContext } from './executor'
import type { AgentFeedbackStore } from './feedback-store'
import type { SubmittedAgentTask } from './task-watcher'
import { isNodeBusy } from './commands/node-state'
import { createGenerationTools } from './tools/generation-tools'
import { canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import { createBatchConfirmations, type GenerationBatchOffer, type GenerationPreview } from './batch-confirmation'

type Turn = CanvasAgentExecutionContext['turn'] & {
  roundTrips: number
  modelKey: string
  settings: CanvasAgentSettings
  explicitDelete: boolean
  stopped: boolean
  batch: ReturnType<typeof createBatchConfirmations>
  previewGeneration?(input: unknown): Promise<GenerationPreview>
}
export type AgentCard =
  | { kind: 'blueprint'; blueprint: Parameters<CanvasAgentExecutionContext['confirmBlueprint']>[0] }
  | { kind: 'delete'; titles: string[]; reason: string }
  | ({ kind: 'generate'; callId?: string; batch?: GenerationBatchOffer } & GenerationPreview)
  | { kind: 'ask'; question: string; options: string[] }
type AgentStep = Parameters<NonNullable<CanvasAgentExecutionContext['step']>>[0]

const MAX_ROUND_TRIPS = 8
const makeTurn = (text: string, modelKey: string, settings: CanvasAgentSettings): Turn => ({
  roundTrips: 0, modelKey, settings: { ...settings }, toolCalls: 0, questions: 0, quotedPoints: 0, stopped: false,
  explicitDelete: /^(?:(?:请|帮我|请帮我)\s*)?(?:删除|删掉|删去|(?:please\s+)?(?:delete|remove)\b)/iu.test(text)
    && !/(?:不要删|不删|别删|如何|怎么|能否|能不能|\bdo not\b|\bdon't\b|\bhow\b)/iu.test(text),
  batch: createBatchConfirmations(),
})

export function canvasAgentApi(bridge: CanvasAgentBridge) {
  return `/api/projects/${encodeURIComponent(bridge.projectId)}/canvas/${encodeURIComponent(bridge.canvasId)}/agent`
}

export function useCanvasAgentChat({ bridge, threadId, initialMessages, title, modelKey, settings, feedback }: {
  bridge: CanvasAgentBridge
  threadId: string
  initialMessages: UIMessage[]
  title: string
  modelKey: string
  settings: CanvasAgentSettings
  feedback: AgentFeedbackStore
}) {
  const turnRef = useRef<Turn | null>(null)
  const pendingRef = useRef(0)
  const recent = useRef<Set<string>[]>([])
  const cardRef = useRef<{ value: AgentCard; resolve(value: string | boolean | null): void } | null>(null)
  const stagedBatches = useRef(new WeakSet<NonNullable<typeof cardRef.current>>())
  const [card, setCard] = useState<AgentCard | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [receipt, setReceipt] = useState<{ turn: CanvasAgentTurnState; touched: number; quotedPoints: number } | null>(null)
  const [notice, setNotice] = useState('')
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState(0)
  const [submitted, setSubmitted] = useState<SubmittedAgentTask[]>([])
  const executorRef = useRef<ReturnType<typeof createToolExecutor> | null>(null)
  const ctxRef = useRef<CanvasAgentExecutionContext | null>(null)
  const titleRef = useRef(title)
  titleRef.current = title

  const answerCard = useCallback((value: string | boolean | null) => {
    const previous = cardRef.current
    if (previous?.value.kind === 'generate' && value === 'approve-all') {
      const turn = turnRef.current
      if (!turn || turn.stopped || !previous.value.batch || bridge.isWriteLocked()) return
      turn.batch.approve(previous.value.batch)
      value = true
    }
    cardRef.current = null
    setCard(null)
    feedback.ghost.set(null)
    previous?.resolve(value)
  }, [bridge, feedback])
  const presentCard = useCallback(async (value: AgentCard) => {
    if (!turnRef.current || turnRef.current.stopped) return null
    return await new Promise<string | boolean | null>((resolve) => {
      cardRef.current = { value, resolve }
      if (value.kind === 'blueprint') feedback.ghost.set(value.blueprint)
      setCard(value)
    })
  }, [feedback])
  const decideQueuedGeneration = (callId: string, allow: boolean) => {
    const turn = turnRef.current
    const pendingCard = cardRef.current
    if (!turn || turn.stopped || (allow && bridge.isWriteLocked())
      || pendingCard?.value.kind !== 'generate' || !pendingCard.value.batch) return
    pendingCard.value = { ...pendingCard.value, batch: turn.batch.decide(pendingCard.value.batch, callId, allow) }
    setCard(pendingCard.value)
  }

  const finish = useCallback((reason?: string) => {
    const current = turnRef.current
    if (!current) return
    turnRef.current = null
    current.stopped = true
    answerCard(null)
    const ending = bridge.endTurn()
    const touched = current.touchedNodeIds ?? new Set<string>()
    recent.current = [touched, ...recent.current].slice(0, 2)
    if (ending) setReceipt({ turn: ending, touched: touched.size, quotedPoints: current.quotedPoints })
    setActive(false)
    if (reason) setNotice(reason)
  }, [answerCard, bridge])

  const transport = useMemo(() => new DefaultChatTransport({
    api: `${canvasAgentApi(bridge)}/chat`,
    fetch: apiFetch,
    prepareSendMessagesRequest: ({ id, messages }) => {
      const turn = turnRef.current
      if (!turn || turn.stopped || turn.roundTrips >= MAX_ROUND_TRIPS) throw new Error('TURN_LIMIT')
      const touched = [...(turn.touchedNodeIds ?? []), ...recent.current.flatMap((ids) => [...ids])]
      const digest = buildCanvasDigest(bridge.getGraph(), { title: titleRef.current, viewportBounds: bridge.getViewportBounds(), touchedIds: touched })
      return { body: { threadId: id, messages, context: {
        mode: bridge.mode, locale: getPageLocale() === 'en' ? 'en' : 'zh',
        ...(turn.modelKey && turn.modelKey !== 'local-fixture' ? { modelKey: turn.modelKey } : {}),
        digest, autonomy: turn.settings.autonomy,
        ...(turn.settings.autonomy === 'auto_budget' ? { budgetPoints: turn.settings.budgetPoints } : {}),
        turnIndex: turn.roundTrips++,
      } } }
    },
  }), [bridge])

  const chat = useChat({
    id: threadId, messages: initialMessages, transport,
    sendAutomaticallyWhen: (input) => Boolean(turnRef.current && !turnRef.current.stopped
      && turnRef.current.roundTrips < MAX_ROUND_TRIPS && lastAssistantMessageIsCompleteWithToolCalls(input)),
    onToolCall: ({ toolCall }) => {
      const turn = turnRef.current
      if (!turn || turn.stopped || toolCall.dynamic) return
      turn.batch.enqueue(turn.roundTrips, toolCall.toolCallId, toolCall.toolName, toolCall.input)
      pendingRef.current += 1
      setPending(pendingRef.current)
      void executorRef.current?.(toolCall).finally(() => {
        pendingRef.current = Math.max(0, pendingRef.current - 1)
        setPending(pendingRef.current)
      }).catch(() => undefined)
    },
    onError: () => finish('本轮未能完成，请检查模型、连接或积分后重试。'),
  })
  const latestChat = useRef(chat)
  latestChat.current = chat
  if (!executorRef.current) executorRef.current = createToolExecutor(() => ctxRef.current!, (output) => {
    if (!turnRef.current || turnRef.current.stopped) return
    void latestChat.current.addToolOutput(output).catch(() => finish('无法保存工具结果，本轮已停止。'))
  })

  useEffect(() => {
    const turn = turnRef.current
    const pendingCard = cardRef.current
    // Wait for the provider response to end before enumerating queued calls.
    // A late streamed tool must not silently expand an already shown offer.
    if (chat.status !== 'ready' || !turn?.previewGeneration || !pendingCard
      || pendingCard.value.kind !== 'generate' || !pendingCard.value.callId || stagedBatches.current.has(pendingCard)) return
    stagedBatches.current.add(pendingCard)
    void turn.batch.offer(pendingCard.value.callId, pendingCard.value, turn.previewGeneration).then((offer) => {
      if (!offer || turnRef.current !== turn || turn.stopped || cardRef.current !== pendingCard || pendingCard.value.kind !== 'generate') return
      pendingCard.value = { ...pendingCard.value, batch: offer }
      setCard(pendingCard.value)
    }).catch(() => undefined)
  }, [card, chat.status])

  useEffect(() => {
    const turn = turnRef.current
    if (!turn || chat.status !== 'ready' || pending || card || !turn.roundTrips) return
    if (lastAssistantMessageIsCompleteWithToolCalls({ messages: chat.messages })) {
      if (turn.roundTrips >= MAX_ROUND_TRIPS) finish('这一轮步骤太多，请分开继续。')
      return
    }
    finish()
  }, [card, chat.messages, chat.status, finish, pending])

  useEffect(() => () => {
    const turn = turnRef.current
    if (turn) { turn.stopped = true; turnRef.current = null; bridge.endTurn() }
    cardRef.current?.resolve(null)
    cardRef.current = null
    feedback.ghost.set(null)
    void latestChat.current.stop().catch(() => undefined)
  }, [bridge, feedback])

  const stop = () => {
    if (turnRef.current) turnRef.current.stopped = true
    void chat.stop().catch(() => undefined)
    finish('已停止本轮，已完成的操作仍保留。')
  }

  const send = (raw: string) => {
    const text = raw.trim().slice(0, 4000)
    if (!text) return false
    if (cardRef.current?.value.kind === 'ask' && turnRef.current) {
      answerCard(text.slice(0, 200))
      return true
    }
    if (turnRef.current || pendingRef.current || !modelKey || bridge.isWriteLocked()) return false
    let turn: Turn
    try {
      bridge.beginTurn(text)
      turn = makeTurn(text, modelKey, settings)
    } catch { return false }
    turnRef.current = turn
    const stopped = () => turn.stopped || turnRef.current !== turn
    const tools = createGenerationTools({
      bridge, turn, stopped, settings: turn.settings,
      loadConfig: async () => {
        const response = await apiFetch(`/api/frameos/generation-config?projectId=${encodeURIComponent(bridge.projectId)}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('MODEL_UNAVAILABLE')
        return await response.json() as CanvasGenerationServiceConfig
      },
      quote: async (query) => {
        const response = await apiFetch(`/api/frameos/generation-quote?${query}`, { cache: 'no-store' })
        if (!response.ok) return null
        const data = await response.json() as { points?: number }
        return typeof data.points === 'number' ? data.points : null
      },
      confirm: async (request, callId) => await presentCard({ kind: 'generate', callId, ...request }) === true,
      consumeBatchApproval: turn.batch.consume,
      onSubmitted: (id) => {
        const node = bridge.getGraph().nodes.find((item) => item.id === id)
        const submission = { id, token: crypto.randomUUID(), observedBusy: Boolean(node && isNodeBusy(node)) }
        setSubmitted((previous) => [...previous.filter((item) => item.id !== id).slice(-49), submission])
      },
    })
    turn.previewGeneration = (input) => tools.preview(canvasAgentToolSchemas.generate.parse(input))
    ctxRef.current = {
      bridge, turn, stopped,
      confirmBlueprint: async (blueprint) => await presentCard({ kind: 'blueprint', blueprint }) === true,
      confirmDelete: async (plan, reason) => await presentCard({
        kind: 'delete', reason, titles: plan.targets.map((node) => node.data.title || '未命名节点'),
      }) === true,
      ask: async (question, options) => {
        const value = await presentCard({ kind: 'ask', question, options })
        return typeof value === 'string' ? value : null
      },
      hasExplicitDeleteIntent: () => turn.explicitDelete,
      follow: turn.settings.follow,
      ...tools,
      step: (row) => setSteps((previous) => {
        const existing = previous.findIndex((item) => item.toolCallId === row.toolCallId)
        return existing === -1 ? [...previous, row] : previous.map((item, index) => index === existing ? row : item)
      }),
    }
    setActive(true)
    setReceipt(null)
    setNotice('')
    setSteps([])
    void chat.sendMessage({ text }).catch(() => finish('本轮未能完成，请重试。'))
    return true
  }
  return { messages: chat.messages, status: chat.status, active, pending, send, stop, card, answerCard, decideQueuedGeneration, steps, notice, receipt, submitted }
}
