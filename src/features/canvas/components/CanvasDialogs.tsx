'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Clock3, Copy, History, LoaderCircle, RefreshCw, Server, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl, toVideoPosterUrl } from '@/lib/media/image-url'
import type { CanvasFlowNode } from '../editor-types'
import { canvasApi } from '../api/client'
import {
  canvasHistoryHasRestorableValue,
  isCanvasHistoryItemCurrent,
  type CanvasGenerationHistoryItem,
} from '../types'
import type { CanvasRevision } from '../types'
import { isCanvasGeometryOfflineDraft, type CanvasOfflineDraft } from '../state/canvas-offline-store'

export function CanvasConflictDialog({ loading, onLoadServer, onMerge }: { loading: boolean; onLoadServer: () => void; onMerge: () => void }) {
  return (
    <div className="nori-canvas-dialog-scrim">
      <div className="nori-canvas-dialog nori-canvas-conflict-dialog" role="dialog" aria-modal="true" aria-label="处理多标签页冲突">
        <header><span><AlertTriangle />多标签页冲突</span></header>
        <div className="nori-canvas-dialog-body">
          <p>检测到同一画布持续同时编辑；系统已尝试自动同步与合并，请确认最终采用的版本。</p>
          <div className="nori-canvas-conflict-option"><Server /><span><b>采用服务端版本</b><small>丢弃本标签页未保存的更改，加载最新画布。</small></span><button type="button" disabled={loading} onClick={onLoadServer}>加载</button></div>
          <div className="nori-canvas-conflict-option"><RefreshCw /><span><b>重新合并</b><small>保留本地节点，同时合并服务端新增与最新生成结果。</small></span><button type="button" disabled={loading} onClick={onMerge}>合并</button></div>
        </div>
        {loading ? <div className="nori-canvas-dialog-loading"><LoaderCircle className="animate-spin" />正在恢复画布…</div> : null}
      </div>
    </div>
  )
}

export function CanvasOfflineRecoveryDialog({
  draft,
  serverRevision,
  loading,
  onRestoreLocal,
  onUseServer,
}: {
  draft: CanvasOfflineDraft
  serverRevision: number
  loading: boolean
  onRestoreLocal: () => void
  onUseServer: () => void
}) {
  const geometryOnly = isCanvasGeometryOfflineDraft(draft)
  const movedNodes = geometryOnly ? new Set(draft.pendingOps.flatMap((operation) => operation.type === 'node.update_geometry' ? [operation.id] : [])) : null
  return (
    <div className="nori-canvas-dialog-scrim">
      <div className="nori-canvas-dialog nori-canvas-conflict-dialog nori-canvas-offline-recovery-dialog" role="dialog" aria-modal="true" aria-label="恢复本地未同步画布">
        <header><span><History />发现本地未同步版本</span></header>
        <div className="nori-canvas-dialog-body">
          <p>此账号曾在当前画布留下未同步修改。请选择恢复本地副本，或明确放弃它并继续使用服务器版本。</p>
          <div className="nori-canvas-offline-recovery-meta">
            <span><Clock3 />{new Date(draft.updatedAt).toLocaleString('zh-CN')}</span>
            <span>{movedNodes ? `${movedNodes.size} 个节点的位置或尺寸改动` : `${draft.document.nodes.length} 个节点 · ${draft.document.edges.length} 条连线`}</span>
            <span>本地基于版本 {draft.baseRevision} · 服务器版本 {serverRevision}</span>
          </div>
          <div className="nori-canvas-conflict-option"><Server /><span><b>使用服务器版本</b><small>删除当前浏览器中的未同步副本，保留刚加载的服务器内容。</small></span><button type="button" disabled={loading} onClick={onUseServer}>使用服务器</button></div>
          <div className="nori-canvas-conflict-option is-primary"><RefreshCw /><span><b>恢复本地版本</b><small>{geometryOnly ? '恢复本地布局，保留服务器的节点正文、连线和历史。' : '把本地节点、连线和视口恢复到画布，并立即继续自动同步。'}</small></span><button type="button" disabled={loading} onClick={onRestoreLocal}>恢复本地</button></div>
        </div>
        {loading ? <div className="nori-canvas-dialog-loading"><LoaderCircle className="animate-spin" />正在处理本地版本…</div> : null}
      </div>
    </div>
  )
}

function historyPreview(item: CanvasGenerationHistoryItem, mediaType: string) {
  if (mediaType === 'text') {
    return (
      <pre className="m-0 max-h-[180px] min-h-[110px] overflow-auto whitespace-pre-wrap break-words p-3 text-left text-[11px] leading-5 text-white/75">
        {typeof item.text === 'string' && item.text.length > 0 ? item.text : '（空文本）'}
      </pre>
    )
  }
  const url = toDisplayImageUrl(item.url)
  if (!url) return <div className="nori-canvas-history-empty"><History /></div>
  if (mediaType === 'video') {
    const poster = toVideoPosterUrl(item.url, 480)
    return poster ? <img src={poster} alt="" loading="lazy" decoding="async" /> : <History />
  }
  if (mediaType === 'audio') return <audio src={url} controls />
  return <MediaImage src={url} alt="" width={320} height={180} />
}

export function canvasHistorySourceLabel(item: CanvasGenerationHistoryItem) {
  if (item.source === 'generation') return '生成'
  if (item.source === 'upload') return '本地上传'
  if (item.source === 'project') return '作品同步'
  if (item.source === 'canvas') return '画布版本'
  if (item.taskId || item.assetId || item.modelKey) return '生成'
  if (item.prompt === '本地替换内容') return '本地上传'
  if (item.materialId) return '素材库'
  return '画布版本'
}

function historyParameterSummary(item: CanvasGenerationHistoryItem) {
  const parameters = item.parameters || {}
  const labels: Record<string, string> = {
    inputMode: '模式',
    aspectRatio: '比例',
    resolution: '分辨率',
    quality: '质量',
    duration: '时长',
    generateAudio: '有声',
    count: '数量',
    audioMode: '音频模式',
    mode: '音频模式',
    voice: '嗓音',
  }
  return Object.entries(parameters).flatMap(([key, value]) => {
    if (value === null || value === undefined || value === '') return []
    const normalized = key === 'inputMode'
      ? value === 'firstlastframe' ? '首尾帧' : '全能参考'
      : key === 'quality'
        ? value === 'high' ? '高' : value === 'medium' ? '中' : '低'
        : key === 'generateAudio'
          ? value ? '是' : '否'
          : key === 'duration'
            ? `${String(value)}s`
            : String(value)
    return [`${labels[key] || key}：${normalized}`]
  }).join(' · ')
}

function historyReferenceSummary(item: CanvasGenerationHistoryItem) {
  const referenceCount = (item as CanvasGenerationHistoryItem & { referenceCount?: number }).referenceCount
  if (!item.references && typeof referenceCount === 'number') return `${referenceCount} 个引用（展开后加载）`
  return (item.references || []).map((reference) => {
    const type = reference.type === 'image' ? '图片' : reference.type === 'video' ? '视频' : '音频'
    const duration = reference.type === 'audio' && typeof reference.durationSeconds === 'number'
      ? ` · ${Math.round(reference.durationSeconds * 10) / 10}s`
      : ''
    return `@${reference.title} · ${type}${duration}`
  }).join('，')
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('复制失败')
}

export function CanvasHistoryDialog({ node, projectId, canvasId, onDemand = false, canUse = true, onUse, onClose }: { node: CanvasFlowNode; projectId?: string; canvasId?: string; onDemand?: boolean; canUse?: boolean; onUse: (item: CanvasGenerationHistoryItem) => void; onClose: () => void }) {
  const mediaType = node.data.mediaType || node.type || 'image'
  const [history, setHistory] = useState<CanvasGenerationHistoryItem[]>(node.data.history || [])
  const [loading, setLoading] = useState(onDemand)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<{ id: string; status: 'copied' | 'failed' } | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  useEffect(() => {
    if (!onDemand) return
    let active = true
    const controller = new AbortController()
    setLoading(true)
    void canvasApi.getNodeHistory(projectId || '', canvasId || '', node.id, { signal: controller.signal })
      .then((page) => {
        if (!active) return
        setHistory(page.items)
        setNextCursor(page.nextCursor)
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : '历史加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [node.id, onDemand])

  const loadMore = async () => {
    if (!nextCursor || loading) return
    setLoading(true)
    try {
      const page = await canvasApi.getNodeHistory(projectId || '', canvasId || '', node.id, { cursor: nextCursor })
      setHistory((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))])
      setNextCursor(page.nextCursor)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '历史加载失败')
    } finally { setLoading(false) }
  }

  const fullItem = async (item: CanvasGenerationHistoryItem) => {
    if (!onDemand || item.references !== undefined) return item
    const response = await canvasApi.getNodeHistoryItem(projectId || '', canvasId || '', node.id, item.id)
    setHistory((current) => current.map((entry) => entry.id === item.id ? response.item : entry))
    return response.item
  }

  const copyPrompt = async (item: CanvasGenerationHistoryItem) => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
      const full = await fullItem(item)
      const prompt = full.prompt?.trim()
      if (!prompt) return
      await copyText(prompt)
      setCopyState({ id: item.id, status: 'copied' })
    } catch {
      setCopyState({ id: item.id, status: 'failed' })
    }
    copyTimer.current = setTimeout(() => setCopyState(null), 1_800)
  }

  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <div className="nori-canvas-dialog nori-canvas-history-dialog">
        <header><span><History />生成历史 · {node.data.title || '未命名节点'}</span><button type="button" title="关闭" onClick={onClose}><X /></button></header>
        <div className="nori-canvas-dialog-body">
          {error ? <div role="alert">{error}</div> : null}
          {!loading && history.length === 0 ? <div className="nori-canvas-history-zero"><History /><span>暂无历史生成结果</span></div> : (
            <div className="nori-canvas-history-grid">
              {history.map((item, index) => {
                const current = isCanvasHistoryItemCurrent(item, node.data, mediaType)
                const restorable = canvasHistoryHasRestorableValue(item, mediaType)
                const prompt = item.prompt?.trim() || ''
                const parameters = historyParameterSummary(item)
                const references = historyReferenceSummary(item)
                const currentCopyState = copyState?.id === item.id ? copyState.status : null
                const actualCost = typeof item.actualCostPoints === 'number' && item.actualCostPoints >= 0 ? item.actualCostPoints : null
                const quotedCost = typeof item.quotedCostPoints === 'number' && item.quotedCostPoints >= 0 ? item.quotedCostPoints : null
                const costLabel = actualCost !== null ? `实际 ${actualCost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 积分` : quotedCost !== null ? `预计 ${quotedCost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 积分` : null
                return (
                  <article key={item.id}>
                    <div className="nori-canvas-history-preview">{historyPreview(item, mediaType)}<span className={`is-${item.status}`}>{item.status === 'ready' ? '完成' : item.status === 'failed' ? '失败' : item.status === 'processing' ? '生成中' : '排队中'}</span></div>
                    <div className="nori-canvas-history-meta"><div><b>版本 {(node.data.historyCount ?? history.length) - index}</b><em>{canvasHistorySourceLabel(item)}</em></div><span><Clock3 />{new Date(item.createdAt).toLocaleString('zh-CN')}</span><small>{item.modelKey || '未记录模型'}</small>{costLabel ? <strong className="nori-canvas-history-cost">{costLabel}</strong> : null}</div>
                    <div className="nori-canvas-history-prompt"><div><span>提示词</span><button type="button" title="复制提示词" aria-label={`复制版本 ${(node.data.historyCount ?? history.length) - index} 提示词`} onClick={() => void copyPrompt(item)}>{currentCopyState === 'copied' ? <Check /> : <Copy />}{currentCopyState === 'copied' ? '已复制' : currentCopyState === 'failed' ? '复制失败' : '复制'}</button></div><p title={prompt || undefined}>{prompt || (onDemand ? '复制或选用时加载完整提示词' : '（未记录提示词）')}</p></div>
                    {parameters ? <div className="nori-canvas-history-prompt"><div><span>生成参数</span></div><p title={parameters}>{parameters}</p></div> : null}
                    {references ? <div className="nori-canvas-history-prompt"><div><span>参考媒体</span></div><p title={references}>{references}</p></div> : null}
                    <button type="button" disabled={!canUse || current || item.status !== 'ready' || !restorable} title={canUse ? undefined : '当前账号只有查看权限'} onClick={() => { if (onDemand) void fullItem(item).then(onUse).catch((useError: unknown) => setError(useError instanceof Error ? useError.message : '历史条目加载失败')); else onUse(item) }}>{current ? <><Check />当前版本</> : '选用此版本'}</button>
                  </article>
                )
              })}
            </div>
          )}
          {loading ? <div className="nori-canvas-dialog-loading"><LoaderCircle className="animate-spin" />正在加载历史…</div> : null}
          {nextCursor ? <button type="button" disabled={loading} onClick={() => void loadMore()}>加载更多</button> : null}
        </div>
      </div>
    </div>
  )
}

export function CanvasTaskIdDialog({ taskId, title, onClose }: { taskId: string; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const copyTaskId = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
      await copyText(taskId)
      setCopied(true)
    } catch {
      return
    }
    copyTimer.current = setTimeout(() => setCopied(false), 1_800)
  }

  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <div className="nori-canvas-dialog nori-canvas-taskid-dialog" role="dialog" aria-modal="true" aria-label="生成任务 ID">
        <header><span><Server />生成任务 ID · {title}</span><button type="button" title="关闭" onClick={onClose}><X /></button></header>
        <div className="nori-canvas-dialog-body">
          <p className="nori-canvas-taskid-value"><code>{taskId}</code></p>
          <p>凭此 ID 可查询提交给上游的生成任务，包含实际发送的提示词内容。</p>
        </div>
        <footer>
          <button type="button" onClick={onClose}>关闭</button>
          <button type="button" className="is-primary" onClick={() => void copyTaskId()}>{copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制 ID'}</button>
        </footer>
      </div>
    </div>
  )
}

export function CanvasRevisionDialog({
  revisions,
  currentRevision,
  loading,
  restoringId,
  canRestore,
  error,
  onReload,
  onRestore,
  onClose,
}: {
  revisions: CanvasRevision[]
  currentRevision: number
  loading: boolean
  restoringId: string | null
  canRestore: boolean
  error: string | null
  onReload: () => void
  onRestore: (revision: CanvasRevision) => void
  onClose: () => void
}) {
  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target && !restoringId) onClose() }}>
      <div className="nori-canvas-dialog nori-canvas-revision-dialog">
        <header><span><History />画布历史版本</span><button type="button" title="关闭" disabled={Boolean(restoringId)} onClick={onClose}><X /></button></header>
        <div className="nori-canvas-dialog-body">
          <div className="nori-canvas-revision-note"><Clock3 /><span>每次自动保存都会留下版本，最多保留最近 40 条。恢复也会生成新版本，可以再次撤回。</span><button type="button" disabled={loading || Boolean(restoringId)} onClick={onReload}><RefreshCw />刷新</button></div>
          {error ? <div className="nori-canvas-revision-error"><AlertTriangle />{error}</div> : null}
          {loading ? <div className="nori-canvas-dialog-loading"><LoaderCircle className="animate-spin" />正在读取历史版本…</div> : revisions.length === 0 ? (
            <div className="nori-canvas-history-zero"><History /><span>编辑并自动保存后，版本会显示在这里</span></div>
          ) : (
            <div className="nori-canvas-revision-list">
              {revisions.map((revision) => {
                const current = revision.revision === currentRevision
                const restoring = restoringId === revision.id
                return (
                  <article key={revision.id} className={current ? 'is-current' : ''}>
                    <i>{current ? <Check /> : <History />}</i>
                    <div><b>版本 {revision.revision}{current ? <em>当前</em> : null}</b><span>{revision.changeSummary || '编辑画布'}</span><small>{new Date(revision.createdAt).toLocaleString('zh-CN')}</small></div>
                    <button type="button" disabled={!canRestore || current || Boolean(restoringId)} title={canRestore ? undefined : '当前账号只有查看权限'} onClick={() => onRestore(revision)}>{restoring ? <><LoaderCircle className="animate-spin" />恢复中</> : '恢复此版本'}</button>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
