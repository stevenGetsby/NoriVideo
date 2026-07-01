'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { logError } from '@/lib/logging/core'
import { demoEpisodes } from '../fosDemoData'
import type { FosProjectData, FosEpisode } from '../useFosProject'

export function FosScriptReview({ data }: { data: FosProjectData }) {
  const episodes: FosEpisode[] = data.usingDemo ? demoEpisodes : data.episodes
  const [activeId, setActiveId] = useState(episodes[0]?.id ?? '')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [retryingImport, setRetryingImport] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = useMemo(
    () => episodes.find((e) => e.id === activeId) ?? episodes[0],
    [episodes, activeId],
  )

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
  }, [active?.id, active?.novelText])

  const canEdit = !data.usingDemo && !!active && !active.id.startsWith('demo-')
  const activeWordCount = canEdit ? draft.length : active?.wordCount ?? 0
  const importStatusMessage = (() => {
    if (data.scriptImportStatus === 'processing') return '剧本正在解析分集，请稍候…'
    if (data.scriptImportStatus === 'pending') return '剧本已提交，等待后台开始解析…'
    if (data.scriptImportStatus === 'failed') return '剧本解析失败，请检查文件内容后重试。'
    return '暂无分集内容。'
  })()
  const canRetryImport = !data.usingDemo
    && episodes.length === 0
    && (data.scriptImportStatus === 'pending' || data.scriptImportStatus === 'failed')
  const retryImportLabel = data.scriptImportStatus === 'pending' ? '开始解析' : '重新解析'

  const saveActiveEpisode = async () => {
    if (!active || !canEdit) return
    setSaving(true)
    setError(null)
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

  const handleApproveAndSave = async () => {
    if (!active) return
    setApproving(true)
    setError(null)
    try {
      await saveActiveEpisode()
      if (!data.scriptApproved) {
        const res = await apiFetch(`/api/workflow/projects/${data.projectId}/stages/config/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!res.ok) throw new Error(await readApiErrorMessage(res, '审阅通过失败'))
      }
      data.refetch()
    } catch (err) {
      logError('[FosScriptReview] 保存并审阅失败', err)
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setApproving(false)
    }
  }

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

          {error ? (
            <div className="mx-6 mt-4 rounded-[10px] border border-[rgba(239,68,68,.4)] bg-[rgba(239,68,68,.1)] px-3 py-2 text-[13px] font-semibold text-[#ff7777]">{error}</div>
          ) : null}

          {canEdit ? (
            <div className="px-[30px] py-[28px]">
              <textarea
                className="w-full resize-none border-0 bg-transparent p-0 text-[13px] font-semibold leading-[1.75] text-[rgba(255,255,255,.92)] outline-none"
                style={{ minHeight: 560 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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
        ) : data.usingDemo ? (
          <button className="fos-btn fos-btn-ghost" disabled title="演示数据，操作已禁用">
            审阅通过
          </button>
        ) : (
          <button
            className={`fos-btn ${data.scriptApproved ? 'fos-btn-ghost' : 'fos-btn-primary'}`}
            disabled={approving || saving || !active}
            onClick={handleApproveAndSave}
          >
            {approving || saving ? '保存中…' : data.scriptApproved ? '保存修改' : '保存并审阅通过'}
          </button>
        )}
      </div>
    </div>
  )
}
