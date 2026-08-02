'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Clock3, Copy, History, LoaderCircle, RefreshCw, Server, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { CanvasFlowNode } from '../editor-types'
import {
  canvasHistoryHasRestorableValue,
  isCanvasHistoryItemCurrent,
  type CanvasGenerationHistoryItem,
} from '../types'
import type { CanvasRevision } from '../types'
import type { CanvasOfflineDraft } from '../state/canvas-offline-store'

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
  return (
    <div className="nori-canvas-dialog-scrim">
      <div className="nori-canvas-dialog nori-canvas-conflict-dialog nori-canvas-offline-recovery-dialog" role="dialog" aria-modal="true" aria-label="恢复本地未同步画布">
        <header><span><History />发现本地未同步版本</span></header>
        <div className="nori-canvas-dialog-body">
          <p>此账号曾在当前画布留下未同步修改。请选择恢复本地副本，或明确放弃它并继续使用服务器版本。</p>
          <div className="nori-canvas-offline-recovery-meta">
            <span><Clock3 />{new Date(draft.updatedAt).toLocaleString('zh-CN')}</span>
            <span>{draft.document.nodes.length} 个节点 · {draft.document.edges.length} 条连线</span>
            <span>本地基于版本 {draft.baseRevision} · 服务器版本 {serverRevision}</span>
          </div>
          <div className="nori-canvas-conflict-option"><Server /><span><b>使用服务器版本</b><small>删除当前浏览器中的未同步副本，保留刚加载的服务器内容。</small></span><button type="button" disabled={loading} onClick={onUseServer}>使用服务器</button></div>
          <div className="nori-canvas-conflict-option is-primary"><RefreshCw /><span><b>恢复本地版本</b><small>把本地节点、连线和视口恢复到画布，并立即继续自动同步。</small></span><button type="button" disabled={loading} onClick={onRestoreLocal}>恢复本地</button></div>
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
  if (mediaType === 'video') return <video src={url} muted playsInline />
  if (mediaType === 'audio') return <audio src={url} controls />
  return <MediaImage src={url} alt="" width={320} height={180} />
}

export function canvasHistorySourceLabel(item: CanvasGenerationHistoryItem) {
  if (item.source === 'generation') return '生成'
  if (item.source === 'upload') return '本地上传'
  if (item.source === 'project') return '项目同步'
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

export function CanvasHistoryDialog({ node, canUse = true, onUse, onClose }: { node: CanvasFlowNode; canUse?: boolean; onUse: (item: CanvasGenerationHistoryItem) => void; onClose: () => void }) {
  const history = node.data.history || []
  const mediaType = node.data.mediaType || node.type || 'image'
  const [copyState, setCopyState] = useState<{ id: string; status: 'copied' | 'failed' } | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const copyPrompt = async (item: CanvasGenerationHistoryItem) => {
    const prompt = item.prompt?.trim()
    if (!prompt) return
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
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
          {history.length === 0 ? <div className="nori-canvas-history-zero"><History /><span>暂无历史生成结果</span></div> : (
            <div className="nori-canvas-history-grid">
              {history.map((item, index) => {
                const current = isCanvasHistoryItemCurrent(item, node.data, mediaType)
                const restorable = canvasHistoryHasRestorableValue(item, mediaType)
                const prompt = item.prompt?.trim() || ''
                const parameters = historyParameterSummary(item)
                const references = historyReferenceSummary(item)
                const currentCopyState = copyState?.id === item.id ? copyState.status : null
                return (
                  <article key={item.id}>
                    <div className="nori-canvas-history-preview">{historyPreview(item, mediaType)}<span className={`is-${item.status}`}>{item.status === 'ready' ? '完成' : item.status === 'failed' ? '失败' : item.status === 'processing' ? '生成中' : '排队中'}</span></div>
                    <div className="nori-canvas-history-meta"><div><b>版本 {history.length - index}</b><em>{canvasHistorySourceLabel(item)}</em></div><span><Clock3 />{new Date(item.createdAt).toLocaleString('zh-CN')}</span><small>{item.modelKey || '未记录模型'}</small></div>
                    <div className="nori-canvas-history-prompt">
                      <div><span>提示词</span><button type="button" disabled={!prompt} title={prompt ? '复制提示词' : '未记录提示词'} aria-label={`复制版本 ${history.length - index} 提示词`} onClick={() => void copyPrompt(item)}>{currentCopyState === 'copied' ? <Check /> : <Copy />}{currentCopyState === 'copied' ? '已复制' : currentCopyState === 'failed' ? '复制失败' : '复制'}</button></div>
                      <p title={prompt || undefined}>{prompt || '（未记录提示词）'}</p>
                    </div>
                    {parameters ? <div className="nori-canvas-history-prompt"><div><span>生成参数</span></div><p title={parameters}>{parameters}</p></div> : null}
                    {references ? <div className="nori-canvas-history-prompt"><div><span>参考媒体</span></div><p title={references}>{references}</p></div> : null}
                    <button type="button" disabled={!canUse || current || item.status !== 'ready' || !restorable} title={canUse ? undefined : '当前账号只有查看权限'} onClick={() => onUse(item)}>{current ? <><Check />当前版本</> : '选用此版本'}</button>
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
