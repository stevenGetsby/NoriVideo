'use client'

/**
 * 项目元数据抽屉（§11.2.2）：新建（关联作品 / 外部）+ 编辑 + 归档（无删除）。
 * 结构照 ActivityDrawer：ViewportDialogLayer + fos-activity-scrim/drawer + useDialogDismiss。
 * 关联了 Work 的项目名称只读（跟随平台作品）；改预算 / 归档都行内二次确认。
 */
import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { CATEGORIES, CATEGORY_LABELS, PROJECT_STATUSES, STATUS_LABELS, type Category, type ProjectStatus } from '@/lib/compute-ledger/calc'
import { ViewportDialogLayer } from '../ViewportDialogLayer'
import { useDialogDismiss } from '../use-dialog-dismiss'
import { formatCny } from './ledger-format'
import type { OverviewRow, WorkCandidate } from './ledger-types'

function numOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

export function LedgerProjectDrawer({
  mode,
  row,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  row?: OverviewRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(row?.name ?? '')
  const [workId, setWorkId] = useState('')
  const [candidates, setCandidates] = useState<WorkCandidate[]>([])
  const [category, setCategory] = useState<Category | ''>(row?.category ?? '')
  const [status, setStatus] = useState<ProjectStatus>(row?.status ?? 'in_progress')
  const [startDate, setStartDate] = useState(row?.startDate ?? '')
  const [targetDeliveryDate, setTargetDeliveryDate] = useState(row?.targetDeliveryDate ?? '')
  const [budget, setBudget] = useState(row?.budgetCny == null ? '' : String(row.budgetCny))
  const [duration, setDuration] = useState(row?.durationMinutes == null ? '' : String(row.durationMinutes))
  const [totalEpisodes, setTotalEpisodes] = useState(row?.totalEpisodes == null ? '' : String(row.totalEpisodes))
  const [doneEpisodes, setDoneEpisodes] = useState(row?.doneEpisodes == null ? '' : String(row.doneEpisodes))
  const [note, setNote] = useState(row?.note ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [budgetAck, setBudgetAck] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const loadedRef = useRef(false)

  useDialogDismiss(true, onClose)

  useEffect(() => {
    if (mode !== 'create' || loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const response = await apiFetch('/api/admin/compute-ledger/work-candidates', { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as { works: WorkCandidate[] }
        setCandidates(payload.works)
      } catch {
        /* 候选作品加载失败不阻塞外部项目创建 */
      }
    })()
  }, [mode])

  const nameEditable = mode === 'create' ? !workId : row?.workId == null
  const originalBudget = row?.budgetCny ?? null
  const nextBudget = numOrNull(budget)
  const budgetChanged = mode === 'edit' && nextBudget !== originalBudget
  const totalNum = numOrNull(totalEpisodes)
  const doneNum = numOrNull(doneEpisodes)
  const episodesError = totalNum != null && doneNum != null && doneNum > totalNum ? '已完成集数不能超过总集数。' : ''
  const budgetError = nextBudget != null && nextBudget < 0 ? '算力预算不能为负数。' : ''
  const canSubmit = !submitting && !episodesError && !budgetError
    && (mode === 'edit' || !!workId || !!name.trim())
    && (!budgetChanged || budgetAck)

  const buildBody = () => {
    const body: Record<string, unknown> = {
      category: category === '' ? null : category,
      status,
      startDate: startDate || null,
      targetDeliveryDate: targetDeliveryDate || null,
      budgetCny: nextBudget,
      durationMinutes: numOrNull(duration),
      totalEpisodes: totalNum,
      doneEpisodes: doneNum,
      note: note.trim() ? note.trim() : null,
    }
    if (mode === 'create') {
      body.workId = workId || null
      if (!workId) body.name = name.trim()
    } else if (nameEditable) {
      body.name = name.trim()
    }
    return body
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const url = mode === 'create' ? '/api/admin/compute-ledger/projects' : `/api/admin/compute-ledger/projects/${row?.projectId}`
      const response = await apiFetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存失败'))
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleArchive = async (archived: boolean) => {
    if (!row) return
    setSubmitting(true)
    setError('')
    try {
      const response = await apiFetch(`/api/admin/compute-ledger/projects/${row.projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '归档失败'))
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '归档失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ViewportDialogLayer>
      <div className="fos-activity-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <aside role="dialog" aria-modal="true" aria-label={mode === 'create' ? '新建账本项目' : `编辑 ${row?.name ?? ''}`} className="fos-activity-drawer">
          <header className="fos-activity-drawer-head">
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-bold text-white">{mode === 'create' ? '新建账本项目' : '编辑项目'}</h2>
              <p className="mt-0.5 text-[11px] text-white/40">归档后默认不显示，累计数字不变；不提供删除。</p>
            </div>
            <button type="button" className="fos-dialog-x" aria-label="关闭" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
          </header>

          <div className="fos-activity-drawer-body">
            {mode === 'create' ? (
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">关联作品（留空 = 外部项目）</span>
                <select className="fos-input" value={workId} onChange={(event) => {
                  const id = event.target.value
                  setWorkId(id)
                  const work = candidates.find((item) => item.id === id)
                  if (work) setName(work.name)
                }}>
                  <option value="">不关联（外部项目）</option>
                  {candidates.map((work) => <option key={work.id} value={work.id}>{work.name}</option>)}
                </select>
              </label>
            ) : null}

            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">名称{nameEditable ? '' : '（跟随平台作品）'}</span>
              <input type="text" className="fos-input" value={name} maxLength={191} disabled={!nameEditable} onChange={(event) => setName(event.target.value)} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">类型</span>
                <select className="fos-input" value={category} onChange={(event) => setCategory(event.target.value as Category | '')}>
                  <option value="">未分类</option>
                  {CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">状态</span>
                <select className="fos-input" value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>
                  {PROJECT_STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">开工日期</span>
                <input type="date" className="fos-input" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">目标交付日期</span>
                <input type="date" className="fos-input" value={targetDeliveryDate} onChange={(event) => setTargetDeliveryDate(event.target.value)} />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">算力预算（元，清空 = 未设预算）</span>
              <input type="number" className="fos-input" value={budget} step={0.01} min={0} onChange={(event) => { setBudget(event.target.value); setBudgetAck(false) }} />
              {budgetError ? <span className="text-[11px] text-[var(--fos-danger-text)]">{budgetError}</span> : null}
            </label>

            {budgetChanged ? (
              <div className="flex items-center justify-between gap-3 rounded-[9px] border border-[var(--fos-warning)]/40 bg-[var(--fos-warning)]/10 px-3 py-2 text-[12px] text-white/80">
                <span>预算将从 {originalBudget == null ? '未设' : formatCny(originalBudget)} 改为 {nextBudget == null ? '未设' : formatCny(nextBudget)}。</span>
                <button type="button" className="fos-btn fos-btn-sm fos-btn-soft shrink-0" onClick={() => setBudgetAck(true)}>{budgetAck ? '已确认' : '确认修改'}</button>
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-3">
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">成片时长（分钟）</span>
                <input type="number" className="fos-input" value={duration} step={0.01} min={0} onChange={(event) => setDuration(event.target.value)} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">总集数</span>
                <input type="number" className="fos-input" value={totalEpisodes} step={1} min={0} onChange={(event) => setTotalEpisodes(event.target.value)} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">已完成集数</span>
                <input type="number" className="fos-input" value={doneEpisodes} step={1} min={0} onChange={(event) => setDoneEpisodes(event.target.value)} />
              </label>
            </div>
            {episodesError ? <span className="text-[11px] text-[var(--fos-danger-text)]">{episodesError}</span> : null}

            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">备注</span>
              <textarea className="fos-input" rows={3} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </label>

            {error ? <div role="alert" className="rounded-[9px] border border-[var(--fos-danger)]/40 bg-[var(--fos-danger)]/10 px-3 py-2 text-[12px] text-[var(--fos-danger-text)]">{error}</div> : null}

            <div className="flex items-center gap-3">
              <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" disabled={!canSubmit} onClick={() => void handleSubmit()}>{submitting ? '保存中…' : '保存'}</button>
              <button type="button" className="fos-btn fos-btn-ghost fos-btn-lg" onClick={onClose}>取消</button>
            </div>

            {mode === 'edit' && row ? (
              <div className="border-t border-white/[.07] pt-4">
                {archiveConfirm ? (
                  <div className="flex items-center justify-between gap-3 rounded-[9px] border border-[var(--fos-warning)]/40 bg-[var(--fos-warning)]/10 px-3 py-2 text-[12px] text-white/80">
                    <span>{row.archived ? '取消归档后项目会重新显示。' : '归档后默认不显示，累计数字不变。'}</span>
                    <span className="flex shrink-0 gap-2">
                      <button type="button" className="fos-btn fos-btn-sm fos-btn-soft" onClick={() => void handleArchive(!row.archived)}>{row.archived ? '取消归档' : '确认归档'}</button>
                      <button type="button" className="fos-btn fos-btn-sm fos-btn-ghost" onClick={() => setArchiveConfirm(false)}>返回</button>
                    </span>
                  </div>
                ) : (
                  <button type="button" className="fos-btn fos-btn-ghost" onClick={() => setArchiveConfirm(true)}>{row.archived ? '取消归档此项目' : '归档此项目'}</button>
                )}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </ViewportDialogLayer>
  )
}
