'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { AppIcon } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { FosShell } from './FosShell'
import { AssignmentStatusChip } from './FosAssignmentControls'
import type { AssignmentStatus, AssignmentTab } from './assignments-view-model'

interface StoryboardReviewPanel {
  panelId: string
  storyboardId: string
  sequence: number
  sceneLabel: string
  segmentLabel: string
  label: string
  sourceText?: string | null
  description?: string | null
  location?: string | null
  shotType?: string | null
  cameraMove?: string | null
  durationSeconds?: number | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  characters?: string[]
  props?: string[]
  imageUrl?: string | null
}

interface StoryboardReviewContext {
  assignment: {
    id: string
    projectId: string
    projectName?: string | null
    workName?: string | null
    episodeId?: string | null
    episodeNumber?: number | null
    episodeName?: string | null
    status: AssignmentStatus
    submittedAt?: string | null
    lastReviewNote?: string | null
    canReview?: boolean
  }
  submissionCapturedAt?: string | null
  snapshotSource?: 'submission' | 'live'
  totalPanelCount: number
  panels: StoryboardReviewPanel[]
}

function formatDuration(seconds: number | null | undefined) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '时长未填'
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`
}

function formatSubmittedAt(value: string | null | undefined) {
  if (!value) return '提交时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

export function FosStoryboardReviewWorkspace({
  assignmentId,
  returnTab = 'pending_review',
}: {
  assignmentId: string
  returnTab?: AssignmentTab
}) {
  const router = useRouter()
  const [context, setContext] = useState<StoryboardReviewContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedPanelId, setSelectedPanelId] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [showDecisionBox, setShowDecisionBox] = useState(false)
  const [busyAction, setBusyAction] = useState<'approve' | 'reject' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${encodeURIComponent(assignmentId)}/storyboard-review`, { signal })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载分镜审核内容失败'))
      const payload = await response.json() as StoryboardReviewContext
      const panels = Array.isArray(payload.panels) ? payload.panels : []
      setContext({ ...payload, panels })
      setSelectedPanelId((current) => panels.some((panel) => panel.panelId === current)
        ? current
        : panels[0]?.panelId || '')
    } catch (error) {
      if (signal?.aborted) return
      setLoadError(error instanceof Error ? error.message : '加载分镜审核内容失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [assignmentId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const panels = useMemo(() => context?.panels || [], [context?.panels])
  const selectedPanel = panels.find((panel) => panel.panelId === selectedPanelId) || panels[0] || null
  const selectedIndex = selectedPanel ? panels.findIndex((panel) => panel.panelId === selectedPanel.panelId) : -1
  const imageUrl = toDisplayImageUrl(selectedPanel?.imageUrl)
  const canReview = context?.assignment.canReview === true
  const scenes = useMemo(() => new Set(panels.map((panel) => panel.sceneLabel)).size, [panels])

  const runReview = async (action: 'approve' | 'reject') => {
    if (!canReview || busyAction) return
    if (action === 'reject' && !reviewNote.trim()) {
      setActionError('请填写需要分镜师修改的具体意见。')
      return
    }
    setBusyAction(action)
    setActionError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId,
          ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, action === 'approve' ? '分镜审核通过失败' : '提交修改意见失败'))
      }
      router.push({ pathname: '/my-assignments', query: { tab: action === 'approve' ? 'done' : 'pending_review' } })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '审核操作失败')
    } finally {
      setBusyAction(null)
    }
  }

  const backToTasks = () => router.push({ pathname: '/my-assignments', query: { tab: returnTab } })
  const openStoryboardProduction = () => {
    if (!context) return
    router.push({
      pathname: `/workflow/${context.assignment.projectId}/workbench-premium2/storyboard`,
      query: context.assignment.episodeId ? { episode_id: context.assignment.episodeId, from: 'my-assignments' } : {},
    })
  }

  return (
    <FosShell activeKey="assignments">
      <section className="fvr-page fsr-page" data-testid="storyboard-review-workspace">
        <header className="fvr-header">
          <button type="button" className="fvr-back" onClick={backToTasks}><AppIcon name="chevronLeft" />返回我的任务</button>
          <div className="fvr-heading">
            <span>{context?.assignment.workName || '作品'} / {context?.assignment.projectName || '项目'}</span>
            <h1>第 {context?.assignment.episodeNumber ?? '—'} 集分镜内容审核</h1>
            <p>{context?.assignment.episodeName || '未命名分集'} · {scenes} 个场景 · {panels.length} 个 Segment · 不含视频成片</p>
          </div>
          <div className="fsr-header-actions">
            {context ? <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" onClick={openStoryboardProduction}><AppIcon name="film" className="h-3.5 w-3.5" />进入分镜制作</button> : null}
            {context ? <AssignmentStatusChip status={context.assignment.status} /> : null}
          </div>
        </header>

        {loading ? <div className="fvr-state"><AppIcon name="loader" className="animate-spin" />正在读取分镜提交内容…</div> : null}
        {!loading && loadError ? <div className="fvr-state is-error"><AppIcon name="alert" />{loadError}<button type="button" onClick={() => void load()}>重新加载</button></div> : null}

        {!loading && !loadError && context ? (
          <div className="fvr-layout fsr-layout">
            <aside className="fvr-segments">
              <div className="fvr-rail-title"><span>分镜列表</span><small>{panels.length}</small></div>
              {panels.map((panel) => (
                <button
                  type="button"
                  className={`fvr-source-card${selectedPanel?.panelId === panel.panelId ? ' is-active' : ''}`}
                  key={panel.panelId}
                  onClick={() => setSelectedPanelId(panel.panelId)}
                >
                  <span className="fvr-source-index">{String(panel.sequence).padStart(2, '0')}</span>
                  <div><strong>{panel.label}</strong><small>{panel.shotType || '景别未填'} · {formatDuration(panel.durationSeconds)}</small></div>
                </button>
              ))}
              <div className={`fvr-snapshot-note${context.snapshotSource === 'live' ? ' is-warning' : ''}`}>
                <AppIcon name={context.snapshotSource === 'submission' ? 'check' : 'alert'} />
                <span>{context.snapshotSource === 'submission' ? '当前展示提交时的分镜版本快照，不会被后续编辑覆盖。' : '这是旧任务，提交时未保存快照；当前展示项目中的现有分镜内容。'}</span>
              </div>
            </aside>

            <main className="fvr-preview-column fsr-preview-column">
              <div className="fvr-preview-head">
                <div><span>{selectedPanel?.label || '暂无分镜'}</span><small>只读审核</small></div>
                <time>{selectedIndex >= 0 ? `${selectedIndex + 1} / ${panels.length}` : `0 / ${panels.length}`}</time>
              </div>

              <div className="fsr-image-stage">
                {imageUrl ? (
                  <MediaImage src={imageUrl} alt={selectedPanel?.label || '分镜画面'} fill sizes="(max-width: 1100px) 70vw, 48vw" style={{ objectFit: 'contain' }} />
                ) : (
                  <div className="fvr-player-empty"><AppIcon name="imageLandscape" /><strong>该 Segment 暂无分镜图片</strong><span>仍可审核下方的画面描述与生成提示词。</span></div>
                )}
              </div>

              {selectedPanel ? (
                <section className="fvr-storyboard fsr-storyboard-detail">
                  <div className="fvr-section-heading"><div><AppIcon name="fileText" /><span>{selectedPanel.label} · 分镜内容</span></div><small>{selectedPanel.location || '场景未填'}</small></div>
                  <div className="fsr-detail-body">
                    <div className="fvr-metadata">
                      <span>{selectedPanel.shotType || '景别未填'}</span>
                      <span>{selectedPanel.cameraMove || '运镜未填'}</span>
                      <span>{formatDuration(selectedPanel.durationSeconds)}</span>
                    </div>
                    <div className="fsr-copy-grid">
                      <article><h3>剧本原文</h3><p>{selectedPanel.sourceText || '未填写剧本原文。'}</p></article>
                      <article><h3>画面描述</h3><p>{selectedPanel.description || '未填写画面描述。'}</p></article>
                      <article><h3>分镜图提示词</h3><p>{selectedPanel.imagePrompt || '未填写分镜图提示词。'}</p></article>
                      <article className="is-prompt-wide"><h3>生视频提示词</h3><p>{selectedPanel.videoPrompt || '未填写生视频提示词。'}</p></article>
                    </div>
                    <div className="fvr-assets fsr-assets">
                      {(selectedPanel.characters || []).map((name) => <span key={`character-${name}`}>角色 · <b>@{name}</b></span>)}
                      {(selectedPanel.props || []).map((name) => <span key={`prop-${name}`}>物品 · <b>@{name}</b></span>)}
                      {!(selectedPanel.characters?.length || selectedPanel.props?.length) ? <em>该 Segment 未绑定资产</em> : null}
                    </div>
                  </div>
                </section>
              ) : <div className="fsr-empty"><AppIcon name="film" />本集没有可审核的分镜 Segment</div>}
            </main>

            <aside className="fvr-review-panel">
              <div className="fvr-review-title"><div><AppIcon name="clipboardCheck" /><span>分镜评审</span></div><small>{canReview ? '待审核' : '只读'}</small></div>
              <div className="fsr-stage-notice"><AppIcon name="video" /><p><strong>当前审核对象是分镜内容，不是视频。</strong><span>分镜师在剪辑页保存时间线并提交后，会产生单独的“本集视频审核”任务。</span></p></div>
              <div className="fsr-review-summary">
                <span>本次提交</span>
                <strong>{panels.length} 个 Segment</strong>
                <p>{formatSubmittedAt(context.assignment.submittedAt || context.submissionCapturedAt)}</p>
              </div>
              <div className="fsr-review-guidance">
                <h3>审核要点</h3>
                <p>核对剧情覆盖、镜头衔接、角色变体与资产映射，以及相邻 Segment 的生视频提示词是否连续。</p>
              </div>

              {canReview ? <button type="button" className={`fsr-mark-revision${showDecisionBox ? ' is-open' : ''}`} onClick={() => setShowDecisionBox((value) => !value)}><AppIcon name="alert" />标记需修改</button> : null}
              {canReview && showDecisionBox ? <div className="fsr-decision-box">
                <label className="fvr-overall fsr-review-note"><span>审核人员修改意见</span><textarea autoFocus rows={9} maxLength={4_000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="请明确指出需要修改的 Segment、视频提示词、角色变体或镜头衔接问题。" /><small>{reviewNote.length} / 4000</small></label>
                <div className="fsr-decision-actions"><button type="button" className="is-publish" disabled={Boolean(busyAction) || !reviewNote.trim()} onClick={() => void runReview('reject')}>{busyAction === 'reject' ? <AppIcon name="loader" className="animate-spin" /> : <AppIcon name="alert" />}发布修改意见</button><button type="button" className="is-approve" disabled={Boolean(busyAction)} onClick={() => void runReview('approve')}>{busyAction === 'approve' ? <AppIcon name="loader" className="animate-spin" /> : <AppIcon name="check" />}审核通过</button></div>
              </div> : null}
              {!canReview ? <div className={`fsr-review-result is-${context.assignment.status}`}><strong>{context.assignment.status === 'completed' ? '审核已通过' : context.assignment.status === 'rejected' ? '标记需修改' : '只读查看'}</strong><p>{context.assignment.lastReviewNote || (context.assignment.status === 'completed' ? '审核人员已通过本集分镜内容。' : '当前任务不在待审核状态。')}</p></div> : null}
              {actionError ? <div className="fvr-action-error"><AppIcon name="alert" />{actionError}</div> : null}
            </aside>
          </div>
        ) : null}
      </section>
    </FosShell>
  )
}
