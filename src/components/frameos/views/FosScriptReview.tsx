'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { hasAccountPermissions, isManagementRole } from '@/lib/account/permissions'
import { logError } from '@/lib/logging/core'
import type { CollaborationAssignment } from '../assignments-view-model'
import type { FosProjectData, FosEpisode } from '../useFosProject'

interface AssignmentOverviewResponse {
  assignments?: CollaborationAssignment[]
}

export function FosScriptReview({ data }: { data: FosProjectData }) {
  const { data: session, status: sessionStatus } = useSession()
  const episodes: FosEpisode[] = data.episodes
  const [activeId, setActiveId] = useState(episodes[0]?.id ?? '')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [retryingImport, setRetryingImport] = useState(false)
  const [scriptAssignment, setScriptAssignment] = useState<CollaborationAssignment | null>(null)
  const [assignmentLoading, setAssignmentLoading] = useState(true)
  const [assignmentError, setAssignmentError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const active = useMemo(
    () => episodes.find((e) => e.id === activeId) ?? episodes[0],
    [episodes, activeId],
  )

  const loadScriptAssignment = useCallback(async (signal?: AbortSignal) => {
    setAssignmentLoading(true)
    setAssignmentError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/list?projectId=${encodeURIComponent(data.projectId)}`, { signal })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载剧本任务失败'))
      const payload = await response.json() as AssignmentOverviewResponse
      if (!signal?.aborted) {
        setScriptAssignment((payload.assignments || []).find((assignment) => assignment.stage === 'script') || null)
      }
    } catch (loadError) {
      if (signal?.aborted) return
      logError('[FosScriptReview] 加载剧本协作任务失败', loadError)
      setAssignmentError(loadError instanceof Error ? loadError.message : '加载剧本任务失败')
    } finally {
      if (!signal?.aborted) setAssignmentLoading(false)
    }
  }, [data.projectId])

  useEffect(() => {
    const controller = new AbortController()
    void loadScriptAssignment(controller.signal)
    return () => controller.abort()
  }, [loadScriptAssignment])

  // Keep selection valid as episodes load in.
  useEffect(() => {
    if (episodes.length && !episodes.some((e) => e.id === activeId)) {
      setActiveId(episodes[0].id)
    }
  }, [episodes, activeId])

  // Reset editor when switching episodes.
  useEffect(() => {
    setDraft(active?.novelText ?? '')
    setError(null)
    setNotice(null)
  }, [active?.id, active?.novelText])

  const role = session?.user?.role
  const hasScriptWrite = sessionStatus === 'authenticated'
    && hasAccountPermissions({ role, permissions: session?.user?.permissions }, ['scriptWrite'])
  const isManagement = sessionStatus === 'authenticated' && isManagementRole(role)
  const managementCanEdit = isManagement && !assignmentLoading && !assignmentError && (
    !scriptAssignment
    || scriptAssignment.status === 'unassigned'
    || scriptAssignment.status === 'in_progress'
    || scriptAssignment.status === 'rejected'
  )
  const assignmentAllowsEdit = managementCanEdit || (
    !assignmentLoading
    && !assignmentError
    && (!scriptAssignment || scriptAssignment.canSubmit === true)
  )
  const canOperateScript = hasScriptWrite && assignmentAllowsEdit
  const canEdit = Boolean(active) && canOperateScript
  const activeWordCount = canEdit ? draft.length : active?.wordCount ?? 0
  const importStatusMessage = (() => {
    if (data.scriptImportStatus === 'processing') return '剧本正在解析分集，请稍候…'
    if (data.scriptImportStatus === 'pending') return '剧本已提交，等待后台开始解析…'
    if (data.scriptImportStatus === 'failed') return '剧本解析失败，请检查文件内容后重试。'
    return '暂无分集内容。'
  })()
  const canRetryImport = canOperateScript && episodes.length === 0
    && (data.scriptImportStatus === 'pending' || data.scriptImportStatus === 'failed')
  const retryImportLabel = data.scriptImportStatus === 'pending' ? '开始解析' : '重新解析'

  const saveActiveEpisode = async () => {
    if (!active || !canEdit) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await apiFetch(`/api/novel-promotion/${data.projectId}/episodes/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: draft }),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '保存失败'))
      data.refetch()
    } catch (err) {
      logError('[FosScriptReview] 保存正文失败', err)
      setError(err instanceof Error ? err.message : '保存失败')
      throw err
    } finally {
      setSaving(false)
    }
  }

  const retryImport = async () => {
    if (!canRetryImport) return
    setRetryingImport(true)
    setError(null)
    setNotice(null)
    try {
      const res = await apiFetch(`/api/novel-promotion/${data.projectId}/import-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '剧本解析失败'))
      data.refetch()
    } catch (err) {
      logError('[FosScriptReview] 重新解析剧本失败', err)
      setError(err instanceof Error ? err.message : '剧本解析失败')
    } finally {
      setRetryingImport(false)
    }
  }

  const handleSubmit = async () => {
    if (!active || !scriptAssignment?.canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      await saveActiveEpisode()
      const response = await apiFetch('/api/collaboration/assignments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: scriptAssignment.id }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交剧本任务失败'))
      const payload = await response.json() as { assignment?: CollaborationAssignment }
      if (payload.assignment) setScriptAssignment(payload.assignment)
      setNotice('剧本已提交，审核人员可在“我的任务 → 待我审核”中处理。')
      data.refetch()
      await loadScriptAssignment()
    } catch (err) {
      logError('[FosScriptReview] 提交剧本任务失败', err)
      setError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDirectSave = async () => {
    try {
      await saveActiveEpisode()
      setNotice('剧本修改已保存。')
    } catch {
      // saveActiveEpisode has already exposed the actionable error.
    }
  }

  const assignmentState = (() => {
    if (sessionStatus === 'loading') return { tone: 'neutral', title: '正在读取账号权限', detail: '请稍候…' }
    if (assignmentLoading) return { tone: 'neutral', title: '正在读取任务状态', detail: '请稍候…' }
    if (assignmentError) return { tone: 'error', title: '任务状态加载失败', detail: assignmentError }
    if (!hasScriptWrite) return { tone: 'neutral', title: '当前为只读模式', detail: '只有编剧账号和管理账号可以编辑剧本。' }
    if (!scriptAssignment) return null
    if (scriptAssignment.status === 'rejected') {
      return {
        tone: 'error',
        title: '审核未通过',
        detail: scriptAssignment.lastReviewNote?.trim() || '审核人员未填写修改意见，请联系项目管理员。',
      }
    }
    if (scriptAssignment.status === 'pending_review') {
      return {
        tone: 'info',
        title: isManagement ? '剧本等待审核' : '已提交，等待审核',
        detail: isManagement
          ? '请在“我的任务 → 待我审核”中通过，或填写修改意见后驳回。'
          : '审核前内容已锁定；如果被驳回，修改意见会显示在这里。',
      }
    }
    if (scriptAssignment.status === 'completed') {
      return { tone: 'success', title: '剧本已审核通过', detail: scriptAssignment.lastReviewNote?.trim() || '该剧本任务已完成。' }
    }
    if (scriptAssignment.status === 'unassigned') {
      return { tone: 'neutral', title: '剧本任务待分配', detail: '请由管理账号在项目协作任务中指定编剧。' }
    }
    if (!scriptAssignment.canSubmit && !isManagement) {
      return { tone: 'neutral', title: '当前为只读模式', detail: `该任务已分配给${scriptAssignment.assigneeName || '其他账号'}。` }
    }
    return { tone: 'info', title: '剧本任务进行中', detail: '完成本项目剧本修改后，点击底部“提交”进入审核。' }
  })()

  const assignmentToneClass = assignmentState?.tone === 'error'
    ? 'border-red-400/35 bg-red-500/10 text-red-100'
    : assignmentState?.tone === 'success'
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
      : assignmentState?.tone === 'info'
        ? 'border-blue-400/30 bg-blue-500/10 text-blue-100'
        : 'border-white/10 bg-white/[.035] text-[var(--fos-text-2)]'

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0b0b0b]">
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '280px 1fr' }}>
        <aside className="overflow-y-auto border-r border-[rgba(255,255,255,.08)] bg-[#101010]">
          <div className="flex h-[40px] items-center justify-between border-b border-[rgba(255,255,255,.06)] px-4">
            <h3 className="text-[14px] font-bold text-white">分集列表</h3>
            <span className="text-[13px] font-semibold text-[#a3a3a3]">共 {episodes.length} 集</span>
          </div>
          <div className="space-y-1 p-2">
            {episodes.map((ep) => {
              const isActive = ep.id === active?.id
              return (
                <button key={ep.id} onClick={() => setActiveId(ep.id)}
                  className="w-full rounded-[7px] px-3 py-2.5 text-left transition-colors"
                  style={{
                    minHeight: 56,
                    border: isActive ? '1px solid rgba(74,120,211,.82)' : '1px solid transparent',
                    background: isActive ? 'rgba(37,62,102,.46)' : 'transparent',
                  }}>
                  <div className="text-[13px] font-bold text-white">
                    <span className="mr-2 text-[#4f85ff]">E{ep.episodeNumber}</span>
                    <span>{ep.name}</span>
                  </div>
                  <div className="mt-1 text-[12px] font-medium text-[#8c8c8c]">字数 {ep.wordCount} 字</div>
                </button>
              )
            })}
            {episodes.length === 0 ? (
              <div className="px-3 py-6 text-[13px] leading-6 text-[var(--fos-text-3)]">
                <p>{importStatusMessage}</p>
                {canRetryImport ? (
                  <button
                    type="button"
                    className="fos-btn fos-btn-primary fos-btn-sm mt-3"
                    disabled={retryingImport}
                    onClick={retryImport}
                  >
                    {retryingImport ? '解析中…' : retryImportLabel}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>

        <article className="overflow-y-auto">
          <div className="flex h-[40px] items-center justify-between border-b border-[rgba(255,255,255,.06)] px-5">
            <h3 className="text-[15px] font-bold text-white">
              {active ? (
                <>
                  <span className="mr-2 rounded-[4px] bg-[rgba(59,130,246,.24)] px-2 py-0.5 text-[12px] text-[#6ea0ff]">E{active.episodeNumber}</span>
                  {active.name}
                </>
              ) : '剧本解析'}
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold text-[#a3a3a3]">字数 {activeWordCount} 字</span>
              {canEdit ? <span className="text-[12px] text-[var(--fos-text-4)]">可直接编辑</span> : null}
            </div>
          </div>

          {assignmentState ? (
            <div className={`mx-6 mt-4 flex items-start gap-3 rounded-[10px] border px-4 py-3 ${assignmentToneClass}`} data-testid="script-assignment-state">
              <AppIcon
                name={assignmentState.tone === 'error' ? 'alert' : assignmentState.tone === 'success' ? 'check' : 'info'}
                className="mt-0.5 h-4 w-4 flex-none"
              />
              <div className="min-w-0">
                <div className="text-[13px] font-bold">{assignmentState.title}</div>
                <p className="mt-1 whitespace-pre-wrap text-[12px] font-medium leading-5 opacity-80">{assignmentState.detail}</p>
                {assignmentError ? (
                  <button type="button" className="mt-2 text-[12px] font-bold text-[#8fa9ff]" onClick={() => void loadScriptAssignment()}>重新加载</button>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mx-6 mt-4 rounded-[10px] border border-[rgba(239,68,68,.4)] bg-[rgba(239,68,68,.1)] px-3 py-2 text-[13px] font-semibold text-[#ff7777]">{error}</div>
          ) : null}
          {notice ? (
            <div className="mx-6 mt-4 rounded-[10px] border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-[13px] font-semibold text-blue-100">{notice}</div>
          ) : null}

          {canEdit ? (
            <div className="px-[30px] py-[28px]">
              <textarea
                className="w-full resize-none border-0 bg-transparent p-0 text-[13px] font-semibold leading-[1.75] text-[rgba(255,255,255,.92)] outline-none"
                style={{ minHeight: 560 }}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setNotice(null) }}
                placeholder="输入本集正文内容…"
              />
            </div>
          ) : (
            <div className="px-[30px] py-[28px] text-[13px] font-semibold leading-[1.75] text-[rgba(255,255,255,.92)] whitespace-pre-wrap">
              {active?.novelText ?? importStatusMessage}
            </div>
          )}
        </article>
      </div>

      <div className="fos-bottom-bar">
        {canRetryImport ? (
          <button
            className="fos-btn fos-btn-primary"
            disabled={retryingImport}
            onClick={retryImport}
          >
            {retryingImport ? '解析中…' : retryImportLabel}
          </button>
        ) : scriptAssignment?.canSubmit && canEdit ? (
          <button
            className="fos-btn fos-btn-primary"
            disabled={submitting || saving || !active}
            onClick={() => void handleSubmit()}
            data-testid="script-submit-button"
          >
            {submitting || saving ? '提交中…' : scriptAssignment.status === 'rejected' ? '重新提交' : '提交'}
          </button>
        ) : canEdit && (isManagement || !scriptAssignment) ? (
          <button className="fos-btn fos-btn-primary" disabled={saving || !active} onClick={() => void handleDirectSave()}>
            {saving ? '保存中…' : '保存修改'}
          </button>
        ) : (
          <span className="text-[12px] font-medium text-[var(--fos-text-3)]">
            {assignmentLoading ? '正在加载任务…' : scriptAssignment?.status === 'pending_review' ? '内容已锁定，等待审核' : scriptAssignment?.status === 'completed' ? '审核已完成' : '当前为只读模式'}
          </span>
        )}
      </div>
    </div>
  )
}
