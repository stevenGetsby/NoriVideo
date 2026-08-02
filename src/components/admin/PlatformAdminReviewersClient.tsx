'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'

interface ReviewerSummary {
  id: string
  username: string
  roleLabel: string
  status: string
}

interface ReviewProject {
  id: string
  name: string
  workName: string
  collaborationMode: string
  reviewerIds: string[]
}

interface ReviewWorkspace {
  manager: { id: string; username: string; status: string }
  reviewers: ReviewerSummary[]
  projects: ReviewProject[]
}

export function PlatformAdminReviewersClient() {
  const { data: session } = useSession()
  const locale = useLocale()
  const [workspaces, setWorkspaces] = useState<ReviewWorkspace[]>([])
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/admin/reviewers', { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取审核分配失败'))
      const payload = await response.json() as { workspaces?: ReviewWorkspace[] }
      const next = Array.isArray(payload.workspaces) ? payload.workspaces : []
      setWorkspaces(next)
      setDrafts(Object.fromEntries(next.flatMap((workspace) => workspace.projects.map((project) => [project.id, project.reviewerIds]))))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '获取审核分配失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visibleWorkspaces = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return workspaces
    return workspaces
      .map((workspace) => ({
        ...workspace,
        projects: workspace.projects.filter((project) => (
          project.name.toLowerCase().includes(normalized)
          || project.workName.toLowerCase().includes(normalized)
          || workspace.manager.username.toLowerCase().includes(normalized)
        )),
      }))
      .filter((workspace) => workspace.projects.length > 0)
  }, [query, workspaces])

  const toggle = (projectId: string, reviewerId: string) => {
    setDrafts((current) => {
      const selected = new Set(current[projectId] || [])
      if (selected.has(reviewerId)) selected.delete(reviewerId)
      else selected.add(reviewerId)
      return { ...current, [projectId]: Array.from(selected) }
    })
  }

  const save = async (workspace: ReviewWorkspace, project: ReviewProject) => {
    setSavingId(project.id)
    setError('')
    setNotice('')
    try {
      const response = await apiFetch('/api/admin/reviewers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, reviewerIds: drafts[project.id] || [] }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存审核人员失败'))
      setNotice(`已更新“${workspace.manager.username} / ${project.name}”的审核人员。`)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存审核人员失败')
    } finally {
      setSavingId('')
    }
  }

  const totals = useMemo(() => ({
    workspaces: workspaces.length,
    reviewers: workspaces.reduce((sum, workspace) => sum + workspace.reviewers.length, 0),
    projects: workspaces.reduce((sum, workspace) => sum + workspace.projects.length, 0),
    assigned: workspaces.reduce((sum, workspace) => sum + workspace.projects.filter((project) => project.reviewerIds.length > 0).length, 0),
  }), [workspaces])

  return (
    <main
      className="nori-admin min-h-screen text-white"
      style={{
        '--fos-bg-1': '#0c1220', '--fos-bg-2': '#121a2a', '--fos-bg-3': '#182237', '--fos-bg-4': '#202d46',
        '--fos-text-1': '#f8faff', '--fos-text-2': '#dbe3f3', '--fos-text-3': '#aab7cd', '--fos-text-4': '#7f8da6',
        '--fos-primary': '#5c82f6', '--fos-primary-hover': '#6a8df8', '--fos-primary-soft': 'rgba(92,130,246,.13)',
        '--fos-primary-border': 'rgba(111,145,248,.34)', '--fos-border-soft': 'rgba(180,198,230,.08)',
        '--fos-border-mid': 'rgba(180,198,230,.13)', '--fos-border-strong': 'rgba(180,198,230,.2)',
        '--fos-fill-soft': 'rgba(255,255,255,.04)', '--fos-fill-mid': 'rgba(255,255,255,.08)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
      } as CSSProperties}
    >
      <header className="nori-admin-header sticky top-0 z-30 flex h-[68px] items-center px-5 lg:px-8">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/[.12] text-[#8fb0ff]"><AppIcon name="lock" className="h-[18px] w-[18px]" /></span><div><strong className="block text-[16px] font-bold">NoriVideo <span className="font-medium text-[#8fb0ff]">Admin</span></strong><span className="mt-0.5 block text-[11px] text-white/45">平台管理中心</span></div></div>
        <div className="ml-auto flex items-center gap-3"><div className="hidden text-right sm:block"><span className="block text-[13px] font-semibold text-white/90">{session?.user?.name || 'Platform Admin'}</span><span className="block text-[11px] text-white/45">平台最高管理员</span></div><button type="button" onClick={() => void signOut({ callbackUrl: `/${locale}/admin/signin` })} className="flex h-9 items-center gap-2 rounded-lg border border-white/[.12] bg-white/[.04] px-3 text-[13px] text-white/70 hover:bg-white/[.08]"><AppIcon name="logout" className="h-4 w-4" />退出</button></div>
      </header>

      <div className="nori-admin-layout mx-auto flex w-full max-w-[1560px]">
        <aside className="nori-admin-sidebar sticky top-[68px] hidden h-[calc(100vh-68px)] w-[236px] shrink-0 px-4 py-6 lg:block">
          <p className="px-3 text-[11px] font-semibold tracking-[.12em] text-white/40">平台管理</p>
          <nav className="mt-3 space-y-1.5">
            <a href={`/${locale}/admin/accounts`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] text-white/60 hover:bg-white/[.05] hover:text-white"><AppIcon name="usersRound" className="h-[18px] w-[18px]" />账号与用量</a>
            <a href={`/${locale}/admin/reviewers`} className="flex items-center gap-3 rounded-lg border border-blue-400/25 bg-blue-500/[.12] px-3 py-3 text-[14px] font-semibold text-[#b8c9ff]"><AppIcon name="clipboardCheck" className="h-[18px] w-[18px]" />审核分配</a>
            <a href={`/${locale}/admin/services`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] text-white/60 hover:bg-white/[.05] hover:text-white"><AppIcon name="settingsHex" className="h-[18px] w-[18px]" />服务配置</a>
          </nav>
          <div className="mt-8 rounded-xl border border-cyan-300/15 bg-cyan-300/[.05] p-4"><AppIcon name="infoCircle" className="h-4 w-4 text-cyan-200/80" /><p className="mt-3 text-[12px] leading-6 text-white/60">管理账号先创建“审核员”子账号；平台 Admin 再把审核员绑定到具体项目。未绑定项目时没有审核权限。</p></div>
        </aside>

        <section className="nori-admin-content min-w-0 flex-1 px-5 py-8 lg:px-9 lg:py-9">
          <div className="mb-5 flex gap-2 lg:hidden"><a href={`/${locale}/admin/accounts`} className="fos-btn fos-btn-ghost fos-btn-sm">账号</a><a href={`/${locale}/admin/reviewers`} className="fos-btn fos-btn-primary fos-btn-sm">审核分配</a><a href={`/${locale}/admin/services`} className="fos-btn fos-btn-ghost fos-btn-sm">服务</a></div>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><span className="text-[12px] font-semibold tracking-[.1em] text-[#8fb0ff]">REVIEW GOVERNANCE</span><h1 className="mt-2 text-[28px] font-bold tracking-[-.025em]">项目审核人员</h1><p className="mt-2 text-[14px] text-white/55">审核员默认只读；按项目授权后，只能处理该项目进入待审核状态的剧本、资产、分镜和视频任务。</p></div><label className="relative block w-full sm:w-80"><AppIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /><input className="fos-input h-10 w-full pl-9 text-[13px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索管理账号、作品或项目" /></label></div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
            ['管理工作区', totals.workspaces, 'usersRound'], ['审核员', totals.reviewers, 'user'], ['项目总数', totals.projects, 'package'], ['已配置审核', totals.assigned, 'clipboardCheck'],
          ].map(([label, value, icon]) => <div key={String(label)} className="nori-admin-metric rounded-xl border p-4"><div className="flex items-center justify-between text-[12px] text-white/55"><span>{label}</span><AppIcon name={icon as 'usersRound'} className="h-4 w-4 text-[#8eabff]" /></div><strong className="mt-3 block text-[22px] font-semibold">{value}</strong></div>)}</div>
          {error ? <div className="mb-5 flex items-center justify-between rounded-lg border border-red-400/25 bg-red-400/[.09] px-4 py-3 text-[13px] text-red-200"><span>{error}</span><button type="button" className="underline" onClick={() => void load()}>重试</button></div> : null}
          {notice ? <div className="mb-5 flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[.08] px-4 py-3 text-[13px] text-emerald-100"><AppIcon name="check" className="h-4 w-4" />{notice}</div> : null}

          {loading ? <div className="nori-admin-panel rounded-xl border py-24 text-center text-[13px] text-white/50">正在读取审核员与项目…</div> : visibleWorkspaces.length === 0 ? <div className="nori-admin-panel rounded-xl border py-24 text-center text-[13px] text-white/45">{query ? '没有匹配项目' : '当前没有可配置的管理工作区'}</div> : <div className="space-y-5">{visibleWorkspaces.map((workspace) => (
            <section key={workspace.manager.id} className="nori-admin-panel overflow-hidden rounded-2xl border">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.08] px-5 py-4"><div><h2 className="text-[16px] font-semibold">{workspace.manager.username}</h2><p className="mt-1 text-[11px] text-white/45">{workspace.projects.length} 个项目 · {workspace.reviewers.length} 名审核员</p></div>{workspace.reviewers.length === 0 ? <span className="rounded-full border border-amber-300/20 bg-amber-300/[.08] px-3 py-1.5 text-[11px] text-amber-200">请先由管理账号创建审核员</span> : null}</header>
              <div className="divide-y divide-white/[.06]">{workspace.projects.map((project) => {
                const selected = new Set(drafts[project.id] || [])
                const dirty = JSON.stringify([...(drafts[project.id] || [])].sort()) !== JSON.stringify([...project.reviewerIds].sort())
                return <article key={project.id} className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(220px,.8fr)_minmax(320px,1.5fr)_120px] xl:items-center"><div className="min-w-0"><strong className="block truncate text-[14px] text-white/90">{project.name}</strong><span className="mt-1 block truncate text-[11px] text-white/40">作品：{project.workName}{project.collaborationMode !== 'team' ? ' · 保存后自动开启团队协作' : ''}</span></div><div className="flex flex-wrap gap-2">{workspace.reviewers.length ? workspace.reviewers.map((reviewer) => {
                  const checked = selected.has(reviewer.id)
                  const disabled = reviewer.status !== 'active'
                  return <button key={reviewer.id} type="button" disabled={disabled && !checked} aria-pressed={checked} onClick={() => toggle(project.id, reviewer.id)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] transition ${checked ? 'border-cyan-300/35 bg-cyan-400/[.11] text-cyan-100' : 'border-white/[.08] bg-white/[.025] text-white/55 hover:bg-white/[.05]'} disabled:opacity-35`}><span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-cyan-300/50 bg-cyan-500 text-white' : 'border-white/15'}`}>{checked ? <AppIcon name="check" className="h-3 w-3" /> : null}</span><span><strong className="font-semibold">{reviewer.username}</strong><small className="ml-1 opacity-55">{reviewer.roleLabel}{disabled ? ' · 已停用' : ''}</small></span></button>
                }) : <span className="text-[11px] text-white/35">暂无审核员账号</span>}</div><button type="button" disabled={!dirty || savingId === project.id || workspace.reviewers.length === 0} onClick={() => void save(workspace, project)} className="fos-btn fos-btn-primary justify-center disabled:opacity-35"><AppIcon name={savingId === project.id ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${savingId === project.id ? 'animate-spin' : ''}`} />{savingId === project.id ? '保存中' : dirty ? '保存分配' : '已保存'}</button></article>
              })}</div>
            </section>
          ))}</div>}
        </section>
      </div>
    </main>
  )
}
