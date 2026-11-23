'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { UIMessage } from 'ai'
import { apiFetch } from '@/lib/api-fetch'
import { nodeAlias } from './alias'
import type { CanvasAgentBridge } from './bridge-types'
import type { GenerationPreview } from './batch-confirmation'
import { AGENT_MODEL_KEY, AGENT_SETTINGS_KEY, defaultAgentSettings, readAgentSettings, sanitizeRestoredMessages, selectClientModel, type CanvasAgentSettings } from './client-state'
import { canvasAgentApi, useCanvasAgentChat, type AgentCard } from './useCanvasAgentChat'
import type { AgentFeedbackStore } from './feedback-store'
import { CanvasAgentTaskWatcher } from './CanvasAgentTaskWatcher'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'
import { buildCanvasAgentSuggestions } from './suggestions'

type Model = { modelKey: string; providerId: string; displayName: string }
type Thread = { id: string; title: string; messageCount: number; updatedAt: string }

const toolLabels: Record<string, string> = {
  find_nodes: '查找节点', read_node: '查看节点', list_models: '查看可用模型', quote: '估算生成费用',
  build_graph: '搭建工作流', update_nodes: '修改节点', connect_nodes: '连线', disconnect_nodes: '断开连线',
  delete_nodes: '删除节点', arrange: '整理画布', group_nodes: '分组', set_canvas_prompt: '设定画布提示词',
  add_to_playlist: '加入播放列表', focus: '在画布上定位', generate: '提交生成', open_tool: '打开工具',
  cancel_generation: '取消生成', ask_user: '请你选择',
}
const statusLabels = { running: '执行中', done: '已完成', skipped: '已跳过', failed: '未完成' }

function generationDetails(job: GenerationPreview) {
  if (job.media === 'text') return `文本 · ${job.model}`
  return [job.media === 'video' ? '视频' : '图片', job.model, job.resolution, job.aspectRatio,
    job.media === 'video' && job.duration ? `${job.duration} 秒` : `${job.count} 张`].filter(Boolean).join(' · ')
}

function AgentConfirmCard({ card, answer, focusBounds, decideQueued }: {
  card: AgentCard
  answer(value: string | boolean | null): void
  focusBounds?: CanvasAgentBridge['focusBounds']
  decideQueued(callId: string, allow: boolean): void
}) {
  if (card.kind === 'ask') return <fieldset className="nori-canvas-agent-card">
    <legend>{card.question}</legend>
    {card.options.map((option) => <button type="button" key={option} onClick={() => answer(option)}>{option}</button>)}
    <button type="button" onClick={() => answer(null)}>先不回答</button>
  </fieldset>
  if (card.kind === 'blueprint') return <fieldset className="nori-canvas-agent-card">
    <legend>{card.blueprint.title} · {card.blueprint.nodes.length} 个节点</legend>
    <p>{card.blueprint.nodes.length} 个节点 · {card.blueprint.edges.length} 条连线</p>
    <button type="button" onClick={() => focusBounds?.(card.blueprint.bounds)}>在画布上预览蓝图</button>
    <button type="button" data-primary onClick={() => answer(true)}>放到画布</button>
    <button type="button" onClick={() => answer(false)}>不要了</button>
  </fieldset>
  if (card.kind === 'delete') return <fieldset className="nori-canvas-agent-card">
    <legend>删除 {card.titles.length} 个节点？</legend>
    <p>{card.reason}</p><p>{card.titles.slice(0, 8).join('、')}{card.titles.length > 8 ? '…' : ''}</p>
    <button type="button" onClick={() => answer(false)}>保留</button>
    <button type="button" data-danger onClick={() => answer(true)}>确认删除</button>
  </fieldset>
  return <GenerationConfirmCard card={card} answer={answer} decideQueued={decideQueued} />
}

function GenerationConfirmCard({ card, answer, decideQueued }: {
  card: Extract<AgentCard, { kind: 'generate' }>
  answer(value: boolean | 'approve-all'): void
  decideQueued(callId: string, allow: boolean): void
}) {
  const balance = useAccountBalance()
  const disabled = balance.generationAllowed === false
  return <>
    <fieldset className="nori-canvas-agent-card">
    <legend>生成「{card.title}」</legend>
    <p>{generationDetails(card)} · {card.points === null ? '按实际用量计费' : `预计 ${card.points} 点`}</p>
    {disabled && <p role="status">{balance.generationDisabledReason}</p>}
    <button type="button" data-primary disabled={disabled} onClick={() => answer(true)}>确认生成</button>
    <button type="button" onClick={() => answer(false)}>先不生成</button>
    </fieldset>
    {card.batch?.jobs.slice(1).map((job, index, pendingJobs) => <fieldset className="nori-canvas-agent-card" key={job.callId}>
      <legend>生成「{job.title}」</legend>
      <p>{generationDetails(job)} · 预计 {job.points} 点</p>
      <button type="button" disabled={disabled} onClick={() => decideQueued(job.callId, true)}>批准「{job.title}」</button>
      <button type="button" onClick={() => decideQueued(job.callId, false)}>跳过「{job.title}」</button>
      {index === pendingJobs.length - 1 && <button type="button" data-primary disabled={disabled} onClick={() => answer('approve-all')}>
        全部确认（共 {Number(card.batch!.totalPoints.toPrecision(12))} 点）
      </button>}
    </fieldset>)}
  </>
}

function Conversation({ bridge, title, thread, models, modelKey, setModelKey, settings, onBusy, feedback, open }: {
  bridge: CanvasAgentBridge
  title: string
  thread: { id: string; messages: UIMessage[]; interrupted: boolean }
  models: Model[]
  modelKey: string
  setModelKey(key: string): void
  settings: CanvasAgentSettings
  onBusy(value: boolean): void
  feedback: AgentFeedbackStore
  open: boolean
}) {
  const chat = useCanvasAgentChat({ bridge, threadId: thread.id, initialMessages: thread.messages, title, modelKey, settings, feedback })
  const [draft, setDraft] = useState('')
  const [mentionCursor, setMentionCursor] = useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const running = chat.active || chat.pending > 0 || chat.status === 'streaming' || chat.status === 'submitted'
  useEffect(() => { onBusy(running); return () => onBusy(false) }, [onBusy, running])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [chat.messages, chat.steps.length, chat.card])
  const readyToType = Boolean(modelKey) && (!running || chat.card?.kind === 'ask') && !bridge.isWriteLocked()
  useEffect(() => { if (open && readyToType) composerRef.current?.focus() }, [open, readyToType])
  const graph = bridge.getGraph()
  const selected = graph.nodes.filter((node) => node.selected)
  const matches = mentionCursor ? graph.nodes.filter((node) =>
    (node.data.title || '').toLocaleLowerCase().includes(mentionCursor.query.toLocaleLowerCase())).slice(0, 8) : []
  const chooseMention = (title: string) => {
    if (!mentionCursor) return
    const text = `「${title}」`
    setDraft((current) => `${current.slice(0, mentionCursor.start)}${text}${current.slice(mentionCursor.end)}`)
    setMentionCursor(null)
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(mentionCursor.start + text.length, mentionCursor.start + text.length)
    })
  }
  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (readyToType && chat.send(draft)) { setDraft(''); setMentionCursor(null) }
  }
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      if (mentionCursor) setMentionCursor(null)
      else if (running) chat.stop()
      else composerRef.current?.blur()
    }
  }
  const labels = new Map(graph.nodes.map((node) => [nodeAlias(node.id), node.data.title || '节点']))
  return <div className="nori-canvas-agent-conversation" onKeyDown={keydown}>
    <label className="nori-canvas-agent-model">模型
      <select aria-label="喵导模型" value={modelKey} disabled={running || !models.length} onChange={(event) => setModelKey(event.target.value)}>
        {!models.length && <option value="">暂无可用模型</option>}
        {models.map((model) => <option key={model.modelKey} value={model.modelKey}>{model.displayName}</option>)}
      </select>
    </label>
    <div ref={listRef} className="nori-canvas-agent-messages" role="log" aria-live="polite">
      {thread.interrupted && <p className="nori-canvas-agent-notice">上次对话在执行中被中断，未完成的步骤已跳过。</p>}
      {!chat.messages.length && <div className="nori-canvas-agent-card">
        <strong>我是喵导，可以帮你在画布上动手</strong>
        <p>说说你想做什么，我来建节点、连线、填提示词。花积分的操作会先问你。</p>
        {buildCanvasAgentSuggestions(graph.nodes).map((text) => <button type="button" key={text} disabled={!readyToType}
          onClick={() => { if (chat.send(text)) setDraft('') }}>{text}</button>)}
      </div>}
      {chat.messages.map((message) => {
        const text = message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
        if (!text || (message.role !== 'user' && message.role !== 'assistant')) return null
        return <article className="nori-canvas-agent-message" data-role={message.role} key={message.id}>
          <strong>{message.role === 'user' ? '你' : '喵导'}</strong>
          <p>{message.role === 'assistant' ? text.replace(/\bn[0-9a-z]{6}\b/g, (ref) => `「${labels.get(ref) ?? '节点'}」`) : text}</p>
        </article>
      })}
      {!!chat.steps.length && <ol className="nori-canvas-agent-steps">{chat.steps.map((step) =>
        <li key={step.toolCallId} data-status={step.status}><span>{toolLabels[step.tool] ?? '工具调用'}</span><small>{statusLabels[step.status]}</small></li>)}</ol>}
      {chat.card && <AgentConfirmCard card={chat.card} answer={chat.answerCard} focusBounds={bridge.focusBounds} decideQueued={chat.decideQueuedGeneration} />}
      {chat.notice && <p className="nori-canvas-agent-notice">{chat.notice}</p>}
      {chat.receipt && <section className="nori-canvas-agent-card" aria-label="本轮回执">
        <strong>本轮已结束</strong><p>触达 {chat.receipt.touched} 个节点{chat.receipt.quotedPoints > 0 ? ` · 生成预计 ${chat.receipt.quotedPoints} 点` : ''}</p>
        <button type="button" disabled={!bridge.canUndoTurn(chat.receipt.turn)}
          title="仅撤销最近一段喵导编辑；不会取消已提交的生成任务" onClick={() => bridge.undoTurn(chat.receipt!.turn)}>撤销本轮</button>
      </section>}
      <CanvasAgentTaskWatcher bridge={bridge} submitted={chat.submitted} />
    </div>
    <form className="nori-canvas-agent-composer" onSubmit={submit}>
      {selected.length > 0 && <button type="button" className="nori-canvas-agent-selection" onClick={() => bridge.select([])}
        aria-label="取消画布选中">{selected.length === 1 ? `已选「${selected[0].data.title || '节点'}」` : `已选 ${selected.length} 个节点`} ×</button>}
      <textarea ref={composerRef} rows={2} value={draft} maxLength={4000} disabled={!readyToType}
        placeholder={chat.card?.kind === 'ask' ? '输入你的回答…' : '告诉喵导你想做什么…'}
        onChange={(event) => {
          const { value, selectionStart } = event.target
          setDraft(value)
          const match = /(?:^|\s)@([^@\n\s]{0,32})$/u.exec(value.slice(0, selectionStart))
          setMentionCursor(match ? { start: selectionStart - match[1].length - 1, end: selectionStart, query: match[1] } : null)
          setMentionIndex(0)
        }} onKeyDown={(event) => {
          if (matches.length && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setMentionIndex((old) => (old + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
              return
            }
            if (event.key === 'Enter') { event.preventDefault(); chooseMention(matches[mentionIndex % matches.length].data.title || '未命名'); return }
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
        }} />
      {!!matches.length && <div className="nori-canvas-agent-mentions" role="listbox" aria-label="引用画布节点">
        {matches.map((node, index) => <button type="button" key={node.id} role="option" aria-selected={index === mentionIndex}
          onClick={() => chooseMention(node.data.title || '未命名')}>{node.data.title || '未命名'}</button>)}
      </div>}
      {!models.length && <small>管理平台尚未开放可用模型。</small>}
      {running && <button type="button" onClick={chat.stop}>停止</button>}
      <button type="submit" data-primary disabled={!readyToType || !draft.trim()}>{chat.card?.kind === 'ask' ? '回答' : '发送'}</button>
    </form>
  </div>
}

const newThread = () => ({ id: crypto.randomUUID(), messages: [] as UIMessage[], interrupted: false })

export default function CanvasAgentPanel({ bridge, title, open, feedback, onClose }: {
  bridge: CanvasAgentBridge; title: string; open: boolean; onClose(): void; feedback: AgentFeedbackStore
}) {
  const [thread, setThread] = useState(newThread)
  const [history, setHistory] = useState<Thread[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [models, setModels] = useState<Model[]>([])
  const [modelKey, setModelKey] = useState('')
  const [settings, setSettings] = useState(defaultAgentSettings)
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState('')
  const endpoint = canvasAgentApi(bridge)
  useEffect(() => {
    try { setSettings(readAgentSettings(localStorage.getItem(AGENT_SETTINGS_KEY))) } catch { /* storage denied */ }
  }, [])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void apiFetch(`${endpoint}/models`, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('load')
      const payload = await response.json() as { defaultModelKey: string | null; models: Model[]; fixtureAvailable?: boolean }
      if (controller.signal.aborted) return
      let pinned = ''
      try { pinned = localStorage.getItem(AGENT_MODEL_KEY) || '' } catch { /* storage denied */ }
      const items = payload.models.length ? payload.models
        : payload.fixtureAvailable ? [{ providerId: 'local', modelKey: 'local-fixture', displayName: '本地测试模型' }] : []
      setModels(items)
      setModelKey(selectClientModel(pinned, items.map(({ modelKey }) => modelKey), payload.defaultModelKey))
      setError('')
    }).catch(() => { if (!controller.signal.aborted) setError('无法读取模型目录。') })
    return () => controller.abort()
  }, [endpoint, open])

  const updateSettings = (next: CanvasAgentSettings) => {
    setSettings(next)
    try { localStorage.setItem(AGENT_SETTINGS_KEY, JSON.stringify(next)) } catch { /* storage denied */ }
  }
  const chooseModel = (key: string) => {
    setModelKey(key)
    try { localStorage.setItem(AGENT_MODEL_KEY, key) } catch { /* storage denied */ }
  }
  const loadHistory = async () => {
    if (history) { setHistory(null); return }
    try {
      const response = await apiFetch(`${endpoint}/threads`, { cache: 'no-store' })
      if (!response.ok) throw new Error('load')
      const body = await response.json() as { threads: Thread[] }
      setHistory(body.threads)
    } catch { setError('无法读取历史对话。') }
  }
  const openThread = async (id: string) => {
    if (busy || changing) return
    setChanging(true)
    try {
      const response = await apiFetch(`${endpoint}/threads/${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('load')
      const body = await response.json() as { thread: { id: string; messages: UIMessage[] } }
      setThread({ id: body.thread.id, ...sanitizeRestoredMessages(body.thread.messages) })
      setHistory(null)
    } catch { setError('无法打开此对话。') } finally { setChanging(false) }
  }
  const deleteThread = async (id: string) => {
    if (busy || changing || !window.confirm('删除这段对话？画布内容不受影响。')) return
    setChanging(true)
    try {
      const response = await apiFetch(`${endpoint}/threads/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('delete')
      setHistory((previous) => previous?.filter((item) => item.id !== id) ?? null)
      if (thread.id === id) setThread(newThread())
    } catch { setError('无法删除此对话。') } finally { setChanging(false) }
  }

  return <aside hidden={!open} className="nori-canvas-agent-panel" aria-label="喵导 · 画布助手" onKeyDown={(event) => {
    if (event.key === 'Escape') event.stopPropagation()
  }}>
    <header><span><strong>喵导</strong> · 画布助手</span><div>
      <button type="button" disabled={busy || changing} onClick={() => void loadHistory()}>历史对话</button>
      <button type="button" disabled={busy || changing} onClick={() => { setThread(newThread()); setHistory(null) }}>新对话</button>
      <button type="button" disabled={busy} onClick={() => setSettingsOpen((value) => !value)}>设置</button>
      <button type="button" aria-label="关闭喵导" onClick={onClose}>×</button>
    </div></header>
    {history && <div className="nori-canvas-agent-thread-list" aria-label="历史对话">
      {history.length ? history.map((item) => <div key={item.id}>
        <button type="button" disabled={busy || changing} onClick={() => void openThread(item.id)}>{item.title}</button>
        <small>{item.messageCount} 条</small><button type="button" aria-label={`删除对话 ${item.title}`} disabled={busy || changing} onClick={() => void deleteThread(item.id)}>删除</button>
      </div>) : <p>暂无历史对话</p>}
    </div>}
    {settingsOpen && <fieldset className="nori-canvas-agent-card" disabled={busy}><legend>喵导设置</legend>
      <label>生成确认 <select value={settings.autonomy} onChange={(event) => updateSettings({ ...settings, autonomy: event.target.value === 'auto_budget' ? 'auto_budget' : 'confirm_costly' })}>
        <option value="confirm_costly">每次确认</option><option value="auto_budget">预算内自动</option>
      </select></label>
      <label>单轮预算 <input type="number" min={10} max={2000} value={settings.budgetPoints} onChange={(event) => {
        const number = Number(event.target.value)
        if (Number.isInteger(number) && number >= 10 && number <= 2000) updateSettings({ ...settings, budgetPoints: number })
      }} /></label>
      <label><input type="checkbox" checked={settings.follow} onChange={(event) => updateSettings({ ...settings, follow: event.target.checked })} /> 跟随节点</label>
    </fieldset>}
    {error && <p className="nori-canvas-agent-notice" role="alert">{error}</p>}
    <Conversation key={thread.id} bridge={bridge} title={title} thread={thread} models={models} modelKey={modelKey} open={open}
      setModelKey={chooseModel} settings={settings} onBusy={setBusy} feedback={feedback} />
  </aside>
}
