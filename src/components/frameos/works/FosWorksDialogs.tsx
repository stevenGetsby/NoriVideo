'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { MemberCandidate, WorkMember, WorkProject, WorkSummary } from './types'
import { normalizeWorkMember, UNASSIGNED_WORK_ID } from './types'
import {
  excludeExistingMemberCandidates,
  fetchAllMemberCandidates,
} from './member-candidates'
import { buildMemberChangeSet, isProtectedMember } from './member-change-set'
import { eligibleMoveTargets } from './move-targets'

export { eligibleMoveTargets } from './move-targets'

const NO_EXISTING_MEMBER_IDS: readonly string[] = []

function Modal({
  title,
  children,
  footer,
  width = 480,
  variant,
  busy = false,
  onClose,
}: {
  title: string
  children: ReactNode
  footer: ReactNode
  width?: number
  variant?: 'create-work' | 'rename'
  busy?: boolean
  onClose: () => void
}) {
  const variantClassName = variant ? ` works-${variant}-modal` : ''
  return (
    <div
      className={`fos-overlay works-modal-overlay${variantClassName}`}
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`fos-dialog works-dialog${variantClassName}`}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (!busy && event.key === 'Escape') onClose()
        }}
      >
        <header className="fos-dialog-head">
          <h2 className="fos-dialog-title">{title}</h2>
          <button type="button" className="fos-dialog-x" disabled={busy} onClick={onClose} aria-label="关闭">
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>
        <div className="fos-dialog-body works-dialog-body">{children}</div>
        <footer className="fos-dialog-foot">{footer}</footer>
      </section>
    </div>
  )
}

function roleLabel(role: string | null | undefined) {
  if (role === 'admin') return '管理账号'
  if (role === 'writer') return '编剧'
  if (role === 'asset') return '资产师'
  if (role === 'storyboard') return '分镜师'
  if (role === 'reviewer') return '审核员'
  if (role === 'creator') return '创建者'
  return role || '成员'
}

function CandidatePicker({
  candidatesPath,
  selectedIds,
  existingMemberIds = NO_EXISTING_MEMBER_IDS,
  disabled = false,
  onToggle,
}: {
  candidatesPath: string
  selectedIds: string[]
  existingMemberIds?: readonly string[]
  disabled?: boolean
  onToggle: (candidate: MemberCandidate) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<MemberCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listboxId = useId()
  const query = keyword.trim()

  useEffect(() => {
    if (!open) {
      setCandidates([])
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void fetchAllMemberCandidates({
        path: candidatesPath,
        keyword: query,
        signal: controller.signal,
      })
        .then((items) => {
          if (!controller.signal.aborted) {
            setCandidates(excludeExistingMemberCandidates(items, existingMemberIds))
          }
        })
        .catch((candidateError) => {
          if (!controller.signal.aborted) setError(candidateError instanceof Error ? candidateError.message : '加载成员失败')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [candidatesPath, existingMemberIds, open, query])

  return (
    <div
      className="works-member-picker"
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className="works-member-search">
        <AppIcon name="search" />
        <input
          className="fos-input"
          value={keyword}
          disabled={disabled}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索并添加成员"
          aria-label="搜索成员"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
        />
      </div>
      {open ? <div id={listboxId} className="works-candidate-list" role="listbox" aria-label="可添加成员">
        {loading ? <div className="works-list-hint"><AppIcon name="loader" className="h-4 w-4 animate-spin" />加载中…</div> : null}
        {!loading && error ? <div className="works-list-hint is-error">{error}</div> : null}
        {!loading && !error && candidates.length === 0 ? <div className="works-list-hint">暂无数据</div> : null}
        {!loading && !error ? candidates.map((candidate) => {
          const selected = selectedIds.includes(candidate.id)
          return (
            <button
              type="button"
              key={candidate.id}
              role="option"
              aria-selected={selected}
              className={`works-candidate${selected ? ' is-selected' : ''}`}
              disabled={disabled}
              onClick={() => onToggle(candidate)}
            >
              <span className="works-member-avatar"><AppIcon name="user" className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1 text-left">
                <strong>{candidate.name}</strong>
                <small>{candidate.roleLabel || roleLabel(candidate.role)}{candidate.status === 'disabled' ? ' · 已停用' : ''}</small>
              </span>
              <span className="works-candidate-check">{selected ? <AppIcon name="check" className="h-3.5 w-3.5" /> : <AppIcon name="plus" className="h-3.5 w-3.5" />}</span>
            </button>
          )
        }) : null}
      </div> : null}
    </div>
  )
}

export function CreateWorkDialog({
  busy,
  existingNames,
  onClose,
  onCreate,
}: {
  busy: boolean
  existingNames: string[]
  onClose: () => void
  onCreate: (input: { name: string; memberUserIds: string[] }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<MemberCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const duplicate = existingNames.some((existing) => existing.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = name.trim()
    if (!normalized) {
      setError('请输入作品名称')
      return
    }
    setError(null)
    try {
      await onCreate({ name: normalized, memberUserIds: selected.map((member) => member.id) })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建作品失败')
    }
  }
  return (
    <Modal
      title="新建作品"
      variant="create-work"
      width={480}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" form="create-work-form" className="fos-btn fos-btn-primary" disabled={busy || !name.trim()}>
            {busy ? <><AppIcon name="loader" className="h-4 w-4 animate-spin" />创建中…</> : '创建'}
          </button>
        </>
      )}
    >
      <form
        id="create-work-form"
        className="works-form"
        onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.target as HTMLElement).closest('.works-member-picker')) event.preventDefault()
        }}
      >
        <p className="works-dialog-intro">作品是一部完整的剧，可包含多个项目</p>
        <label className="works-field">
          <span>作品名称</span>
          <span className="works-counted-input">
            <input autoFocus className="fos-input" maxLength={50} value={name} onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="请输入作品名称" />
            <small>{name.length} / 50</small>
          </span>
        </label>
        {duplicate ? <div className="works-inline-notice">已存在同名作品，仍可继续创建。</div> : null}
        <label className="works-field"><span>成员（可选）</span></label>
        <CandidatePicker
          candidatesPath="/api/works/member-candidates"
          selectedIds={selected.map((member) => member.id)}
          onToggle={(candidate) => setSelected((current) => current.some((item) => item.id === candidate.id)
            ? current.filter((item) => item.id !== candidate.id)
            : [...current, candidate])}
        />
        {selected.length ? (
          <div className="works-selected-members">
            {selected.map((member) => (
              <button type="button" key={member.id} onClick={() => setSelected((current) => current.filter((item) => item.id !== member.id))}>
                {member.name}<AppIcon name="close" className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}
        <p className="works-permission-note">成员可查看作品下所有项目；作品重命名、成员管理与删除仅作品创建者、作品管理员或工作区管理员可操作。</p>
        {error ? <div className="works-form-error">{error}</div> : null}
      </form>
    </Modal>
  )
}

export function RenameDialog({
  kind,
  initialName,
  busy,
  duplicate,
  onClose,
  onSave,
}: {
  kind: '作品' | '项目'
  initialName: string
  busy: boolean
  duplicate?: (name: string) => boolean
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const hasDuplicate = duplicate?.(name.trim()) || false
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      await onSave(name.trim())
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `重命名${kind}失败`)
    }
  }
  return (
    <Modal
      title={`重命名${kind}`}
      variant="rename"
      width={418}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" form="rename-work-form" className="fos-btn fos-btn-primary" disabled={busy || !name.trim()}>确定</button>
        </>
      )}
    >
      <form id="rename-work-form" className="works-form" onSubmit={(event) => void save(event)}>
        <label className="works-field">
          <span>请输入新的{kind}名称</span>
          <input autoFocus className="fos-input" maxLength={kind === '作品' ? 50 : 40} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {hasDuplicate ? <div className="works-inline-notice">已有同名作品，保存后仍会保留两个独立作品。</div> : null}
        {error ? <div className="works-form-error">{error}</div> : null}
      </form>
    </Modal>
  )
}

export function MoveProjectsDialog({
  projects,
  sourceWorkId,
  works,
  busy,
  onClose,
  onMove,
}: {
  projects: WorkProject[]
  sourceWorkId: string
  works: WorkSummary[]
  busy: boolean
  onClose: () => void
  onMove: (targetWorkId: string) => Promise<void>
}) {
  const targets = eligibleMoveTargets(works, sourceWorkId)
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const move = async () => {
    if (!target) return
    setError(null)
    try {
      await onMove(target)
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : '移动项目失败')
    }
  }
  return (
    <Modal
      title={projects.length > 1 ? '批量移动项目' : '移动项目'}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="fos-btn fos-btn-primary" disabled={busy || !target} onClick={() => void move()}>确定</button>
        </>
      )}
    >
      <div className="works-form">
        <p className="works-dialog-intro">{projects.length > 1 ? `将已选 ${projects.length} 个项目移动到：` : `将项目「${projects[0]?.name || ''}」移动到：`}</p>
        <label className="works-field">
          <span className="sr-only">目标作品</span>
          <select className="fos-input" aria-label="搜索并选择目标作品" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="" disabled>搜索并选择目标作品</option>
            {targets.map((work) => <option key={work.id} value={work.id}>{work.name}</option>)}
          </select>
        </label>
        {targets.length === 0 ? <div className="works-inline-notice">没有其他可管理的目标作品。</div> : null}
        {error ? <div className="works-form-error">{error}</div> : null}
      </div>
    </Modal>
  )
}

export function MemberManagerDialog({
  title,
  endpoint,
  candidatesPath,
  readOnly = false,
  onClose,
  onChanged,
}: {
  title: string
  endpoint: string
  candidatesPath: string
  readOnly?: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [members, setMembers] = useState<WorkMember[]>([])
  const [selected, setSelected] = useState<MemberCandidate[]>([])
  const [pendingRemovalIds, setPendingRemovalIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(endpoint)
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载成员失败'))
      const payload = await response.json() as Record<string, unknown>
      const raw = Array.isArray(payload.members) ? payload.members : []
      setMembers(raw.flatMap((member) => normalizeWorkMember(member) || []))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载成员失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    setSelected([])
    setPendingRemovalIds([])
    void reload()
  }, [reload])

  const changeSet = useMemo(
    () => buildMemberChangeSet(members, selected, pendingRemovalIds),
    [members, pendingRemovalIds, selected],
  )
  const hasChanges = changeSet.additions.length > 0 || changeSet.removals.length > 0

  const saveChanges = async () => {
    if (!hasChanges) return
    setSaving(true)
    setError(null)
    try {
      for (const candidate of changeSet.additions) {
        const response = await apiFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: candidate.id }),
        })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, `添加 ${candidate.name} 失败`))
      }
      for (const member of changeSet.removals) {
        const response = await apiFetch(endpoint, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: member.userId }),
        })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, `移除 ${member.name} 失败`))
      }
      setSelected([])
      setPendingRemovalIds([])
      await reload()
      onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存成员失败')
    } finally {
      setSaving(false)
    }
  }

  const selectedIds = useMemo(() => selected.map((member) => member.id), [selected])
  const existingMemberIds = useMemo(() => members.map((member) => member.userId), [members])
  return (
    <Modal
      title={title}
      width={520}
      busy={saving}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={saving} onClick={onClose}>关闭</button>
          {!readOnly ? <button type="button" className="fos-btn fos-btn-primary" disabled={saving || loading || !hasChanges} onClick={() => void saveChanges()}>{saving ? '保存中…' : '保存'}</button> : null}
        </>
      )}
    >
      <div className="works-form">
        {!readOnly ? (
          <CandidatePicker
            candidatesPath={candidatesPath}
            selectedIds={selectedIds}
            existingMemberIds={existingMemberIds}
            disabled={saving}
            onToggle={(candidate) => setSelected((current) => current.some((item) => item.id === candidate.id)
              ? current.filter((item) => item.id !== candidate.id)
              : [...current, candidate])}
          />
        ) : <p className="works-dialog-intro">你可以查看当前成员，但没有修改权限。</p>}
        {!readOnly && selected.length ? (
          <div className="works-selected-members" aria-label="待添加成员">
            {selected.map((member) => (
              <button
                type="button"
                key={member.id}
                disabled={saving}
                onClick={() => { setSelected((current) => current.filter((item) => item.id !== member.id)); setError(null) }}
                aria-label={`取消添加 ${member.name}`}
              >
                {member.name}<span>待添加</span><AppIcon name="close" className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="works-member-list">
          <div className="works-member-list-title">
            <span>成员 · {members.length + changeSet.additions.length - changeSet.removals.length}</span>
            {hasChanges ? <span>待保存 {changeSet.additions.length + changeSet.removals.length} 项变更</span> : null}
          </div>
          {loading ? <div className="works-list-hint"><AppIcon name="loader" className="h-4 w-4 animate-spin" />加载中…</div> : null}
          {!loading && members.length === 0 ? <div className="works-list-hint">暂无成员</div> : null}
          {!loading ? members.map((member) => {
            const protectedMember = isProtectedMember(member)
            const pendingRemoval = pendingRemovalIds.includes(member.userId)
            return (
              <div className={`works-member-row${pendingRemoval ? ' is-pending-removal' : ''}`} key={member.userId}>
                <span className="works-member-avatar"><AppIcon name="user" className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><strong>{member.name}</strong><small>{member.roleLabel || roleLabel(member.accountRole || member.role)}{member.status === 'disabled' ? ' · 已停用' : ''}</small></span>
                {protectedMember ? <span className="works-role-badge">管理员</span> : null}
                {pendingRemoval ? <span className="works-pending-badge">待移除</span> : null}
                {!readOnly && !protectedMember && member.canRemove !== false ? (
                  <button
                    type="button"
                    className={`works-member-remove${pendingRemoval ? ' is-undo' : ''}`}
                    disabled={saving}
                    onClick={() => {
                      setPendingRemovalIds((current) => current.includes(member.userId)
                        ? current.filter((id) => id !== member.userId)
                        : [...current, member.userId])
                      setError(null)
                    }}
                    aria-label={pendingRemoval ? `撤销移除 ${member.name}` : `移除 ${member.name}`}
                  >
                    <AppIcon name={pendingRemoval ? 'refresh' : 'trash'} className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            )
          }) : null}
        </div>
        <p className="works-permission-note">成员沿用账号身份权限：编剧仅可编辑剧本，资产师仅可编辑资产，分镜师仅可编辑分镜；把审核员加入项目后，该账号即可审核该项目任务。管理员拥有全部权限且不可移除。</p>
        {error ? <div className="works-form-error">{error}</div> : null}
      </div>
    </Modal>
  )
}

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  busy,
  onClose,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  busy: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const confirm = async () => {
    setError(null)
    try {
      await onConfirm()
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : '操作失败')
    }
  }
  return (
    <Modal
      title={title}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className={`fos-btn ${danger ? 'works-danger-btn' : 'fos-btn-primary'}`} disabled={busy} onClick={() => void confirm()}>{busy ? '处理中…' : confirmLabel}</button>
        </>
      )}
    >
      <div className="works-confirm-copy"><AppIcon name={danger ? 'alert' : 'infoCircle'} className="h-6 w-6" /><p>{description}</p></div>
      {error ? <div className="works-form-error mt-4">{error}</div> : null}
    </Modal>
  )
}

export function workMembersEndpoint(workId: string) {
  return `/api/works/${encodeURIComponent(workId)}/members`
}

export function workMemberCandidatesEndpoint(workId: string) {
  return `/api/works/${encodeURIComponent(workId)}/member-candidates`
}

export function projectMembersEndpoint(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/members`
}

export function projectMemberCandidatesEndpoint(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/member-candidates`
}

export function canMoveFromWork(work: WorkSummary) {
  return work.id === UNASSIGNED_WORK_ID || work.canMoveProjects || work.canManage
}
