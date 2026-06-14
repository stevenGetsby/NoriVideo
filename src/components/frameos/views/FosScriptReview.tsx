'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { logError } from '@/lib/logging/core'
import { demoEpisodes } from '../fosDemoData'
import type { FosProjectData, FosEpisode, FosScene } from '../useFosProject'

const DEMO_WORLD = {
  label: '真人',
  background: '民国省城督军府',
  artStylePrompt: '院线电影王家卫式光影交错与浅景深，Lomo 复古褪色暖橘调配 Halation 胶片光晕，Cinematic',
}

function SceneBlock({ scene }: { scene: FosScene }) {
  return (
    <div className="rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-[rgba(59,130,246,.18)] px-2 py-0.5 text-[12px] font-bold text-[#6ea0ff]">{scene.sceneNumber}</span>
        {scene.heading ? <span className="text-[13px] font-bold text-white">{scene.heading}</span> : null}
        {scene.location ? <span className="fos-meta-tag">{scene.location}</span> : null}
        {scene.intExt ? <span className="fos-meta-tag">{scene.intExt}</span> : null}
        {scene.time ? <span className="fos-meta-tag">{scene.time}</span> : null}
      </div>
      {scene.characters.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {scene.characters.map((c) => (
            <span key={c} className="rounded-full border border-[var(--fos-border-mid)] px-2 py-0.5 text-[11px] text-[var(--fos-text-3)]">{c}</span>
          ))}
        </div>
      ) : null}
      {scene.content ? (
        <p className="whitespace-pre-wrap text-[13px] leading-7 text-[var(--fos-text-2)]">{scene.content}</p>
      ) : null}
    </div>
  )
}

export function FosScriptReview({ data }: { data: FosProjectData }) {
  const episodes: FosEpisode[] = data.usingDemo ? demoEpisodes : data.episodes
  const [activeId, setActiveId] = useState(episodes[0]?.id ?? '')
  const [worldCollapsed, setWorldCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
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
    setEditing(false)
    setDraft(active?.novelText ?? '')
    setError(null)
  }, [active?.id, active?.novelText])

  const canEdit = !data.usingDemo && !!active && !active.id.startsWith('demo-')
  const world = data.usingDemo
    ? { label: DEMO_WORLD.label, background: DEMO_WORLD.background, artStylePrompt: DEMO_WORLD.artStylePrompt }
    : data.world
      ? { label: data.world.label, background: data.world.background, artStylePrompt: data.world.artStylePrompt }
      : null

  const handleSave = async () => {
    if (!active) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/novel-promotion/${data.projectId}/episodes/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: draft }),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '保存失败'))
      setEditing(false)
      data.refetch()
    } catch (err) {
      logError('[FosScriptReview] 保存正文失败', err)
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleApprove = async () => {
    setApproving(true)
    setError(null)
    const action = data.scriptApproved ? 'unapprove' : 'approve'
    try {
      const res = await apiFetch(`/api/workflow/projects/${data.projectId}/stages/config/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '操作失败'))
      data.refetch()
    } catch (err) {
      logError('[FosScriptReview] 审阅状态切换失败', err)
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* world setting */}
      <div className="flex-none border-b border-[var(--fos-border-soft)] px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-bold text-white">世界设定</h2>
          <span className="fos-pill" style={{ height: 22 }}>{world ? 1 : 0} 个</span>
          <button className="fos-pill" style={{ height: 22 }} onClick={() => setWorldCollapsed((v) => !v)}>
            {worldCollapsed ? '展开' : '收起'}
          </button>
        </div>
        {worldCollapsed || !world ? null : (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] px-4 py-3 text-[13px]">
            <span className="rounded-md bg-[rgba(59,130,246,.18)] px-2.5 py-1 text-[12px] text-[#6ea0ff]">世界</span>
            <span className="text-[14px] font-bold text-white">{world.background ?? world.label}</span>
            <span className="fos-meta-tag">{world.label}</span>
            <span className="text-[var(--fos-text-5)]">|</span>
            <span className="text-[12px] text-[var(--fos-text-3)]">画风描述</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--fos-text-2)]">{world.artStylePrompt ?? '默认全局画风'}</span>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '300px 1fr' }}>
        <aside className="overflow-y-auto border-r border-[var(--fos-border-soft)]">
          <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-4 py-3">
            <h3 className="text-[14px] font-bold text-white">分集列表</h3>
            <span className="text-[12px] text-[var(--fos-text-3)]">共 {episodes.length} 集</span>
          </div>
          <div className="space-y-1.5 p-2.5">
            {episodes.map((ep) => {
              const isActive = ep.id === active?.id
              return (
                <button key={ep.id} onClick={() => setActiveId(ep.id)}
                  className="w-full rounded-[10px] px-3 py-3 text-left transition-colors"
                  style={{
                    height: 56,
                    border: isActive ? '1px solid var(--fos-primary)' : '1px solid transparent',
                    background: isActive ? 'var(--fos-primary-soft)' : 'transparent',
                  }}>
                  <div className="text-[13px] font-bold text-white">
                    <span className="mr-2 text-[#4f85ff]">E{ep.episodeNumber}</span>{ep.name}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">字数 {ep.wordCount} 字</div>
                </button>
              )
            })}
          </div>
        </aside>

        <article className="overflow-y-auto">
          <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-6 py-3.5">
            <h3 className="text-[15px] font-bold text-white">
              <span className="mr-2 rounded-md bg-[rgba(59,130,246,.18)] px-2.5 py-1 text-[12px] text-[#6ea0ff]">E{active?.episodeNumber}</span>
              {active?.name}
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-[var(--fos-text-3)]">字数 {active?.wordCount ?? 0} 字</span>
              {canEdit ? (
                editing ? (
                  <>
                    <button className="fos-btn fos-btn-ghost fos-btn-sm" disabled={saving} onClick={() => { setEditing(false); setDraft(active?.novelText ?? ''); setError(null) }}>取消</button>
                    <button className="fos-btn fos-btn-primary fos-btn-sm" disabled={saving} onClick={handleSave}>{saving ? '保存中…' : '保存'}</button>
                  </>
                ) : (
                  <button className="fos-btn fos-btn-soft fos-btn-sm" onClick={() => setEditing(true)}>
                    <AppIcon name="edit" className="h-3.5 w-3.5" />编辑正文
                  </button>
                )
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="mx-6 mt-4 rounded-[10px] border border-[rgba(239,68,68,.4)] bg-[rgba(239,68,68,.1)] px-3 py-2 text-[13px] font-semibold text-[#ff7777]">{error}</div>
          ) : null}

          {editing ? (
            <div className="px-7 py-6">
              <textarea
                className="fos-textarea w-full"
                style={{ minHeight: 480 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="输入本集正文内容…"
              />
            </div>
          ) : active?.scenes && active.scenes.length ? (
            <div className="max-w-[860px] space-y-3 px-7 py-6">
              {active.scenes.map((scene) => <SceneBlock key={scene.id} scene={scene} />)}
            </div>
          ) : (
            <div className="max-w-[860px] space-y-3 px-7 py-6 text-[14px] leading-8 text-[var(--fos-text-2)] whitespace-pre-wrap">
              {active?.novelText ?? '本集暂无正文内容。'}
            </div>
          )}
        </article>
      </div>

      <div className="fos-bottom-bar">
        {data.usingDemo ? (
          <button className="fos-btn fos-btn-ghost" disabled title="演示数据，操作已禁用">
            <AppIcon name="check" className="h-4 w-4" />审阅通过
          </button>
        ) : (
          <button
            className={`fos-btn ${data.scriptApproved ? 'fos-btn-ghost' : 'fos-btn-primary'}`}
            disabled={approving}
            onClick={handleToggleApprove}
          >
            <AppIcon name="check" className="h-4 w-4" />
            {approving ? '处理中…' : data.scriptApproved ? '撤销审阅通过' : '审阅通过'}
          </button>
        )}
      </div>
    </div>
  )
}
