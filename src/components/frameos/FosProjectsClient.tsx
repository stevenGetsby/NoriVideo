'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useRouter, Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { logError } from '@/lib/logging/core'
import { FosShell } from './FosShell'
import { CreateProjectDialog, type CreateProjectDraft } from './CreateProjectDialog'

interface ProjectItem {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

const PAGE_SIZE = 12
const TEST_MODE = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' })
}

function deriveEdition(p: ProjectItem) {
  return (p.description || '').includes('精品') ? '精品版 2.0' : '精品版 2.0'
}

function ProjectCard({ project }: { project: ProjectItem }) {
  const desc = project.description || ''
  const style = /画风|风$/.test(desc) ? desc.split('·').map((s) => s.trim()).find((s) => s.endsWith('风')) : null
  return (
    <Link href={{ pathname: `/workflow/${project.id}/workbench-premium2` }}
      className="group block overflow-hidden rounded-[10px] border transition-colors hover:border-[var(--fos-border-strong)]"
      style={{ borderColor: 'var(--fos-border-mid)', background: 'var(--fos-bg-2)' }}>
      <div className="relative flex items-center justify-center" style={{ aspectRatio: '16 / 10', background: 'linear-gradient(135deg,#1b2330,#0f1320)' }}>
        <span className="absolute left-3 top-3 rounded-full border border-[#a9892d]/60 bg-[#3a2f12]/70 px-2.5 py-0.5 text-[11px] font-bold text-[#e4c553]">{deriveEdition(project)}</span>
        <AppIcon name="folderOpen" className="h-14 w-14 text-white/15" />
      </div>
      <div className="p-4">
        <h3 className="truncate text-[15px] font-bold text-white">{project.name}</h3>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className="fos-pill" style={{ height: 24 }}><AppIcon name="film" className="h-3 w-3 text-[#5c8dff]" />剧情模式</span>
          <span className="fos-pill" style={{ height: 24 }}><AppIcon name="monitor" className="h-3 w-3 text-[#5c8dff]" />9:16</span>
          {style ? <span className="fos-pill" style={{ height: 24 }}><AppIcon name="settingsHexMinor" className="h-3 w-3 text-[#5c8dff]" />{style}</span> : null}
        </div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--fos-border-soft)] pt-3 text-[12px] text-[var(--fos-text-4)]">
          <AppIcon name="clock" className="h-3.5 w-3.5" />{formatDate(project.createdAt)} 创建
        </div>
      </div>
    </Link>
  )
}

export function FosProjectsClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const urlParams = useSearchParams()
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState(urlParams?.get('search') || '')
  const [searchQuery, setSearchQuery] = useState(urlParams?.get('search') || '')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session && !TEST_MODE) router.push({ pathname: '/auth/signin' })
  }, [router, session, status])

  const fetchProjects = useCallback(async (search: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE) })
      if (search.trim()) params.set('search', search.trim())
      const res = await apiFetch(`/api/projects?${params}`)
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '获取项目失败'))
      const data = await res.json() as { projects?: ProjectItem[]; pagination?: { total: number } }
      setProjects(Array.isArray(data.projects) ? data.projects : [])
      setTotal(data.pagination?.total ?? 0)
    } catch (err) {
      logError('[FosProjectsClient] 获取项目失败', err)
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session || TEST_MODE) void fetchProjects(searchQuery)
  }, [fetchProjects, searchQuery, session])

  const handleSearch = () => setSearchQuery(searchInput.trim())

  const handleCreate = async (draft: CreateProjectDraft): Promise<boolean> => {
    const form = new FormData()
    form.set('name', draft.name.trim())
    form.set('projectLevel', draft.projectLevel)
    form.set('projectStyle', draft.projectStyle)
    form.set('targetAudience', draft.targetAudience)
    form.set('videoRatio', draft.videoRatio)
    form.set('videoResolution', draft.videoResolution)
    form.set('targetEpisodeDurationSeconds', String(draft.targetEpisodeDurationSeconds))
    if (draft.artStylePrompt.trim()) form.set('artStylePrompt', draft.artStylePrompt.trim())
    if (draft.scriptFile) form.set('scriptFile', draft.scriptFile)
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      body: form,
    })
    if (!res.ok) throw new Error(await readApiErrorMessage(res, '创建项目失败'))
    const payload = await res.json() as { project?: { id?: string } }
    const id = payload.project?.id
    if (!id) throw new Error('创建项目失败')
    router.push({ pathname: `/workflow/${id}/workbench-premium2` })
    return true
  }

  const displayTotal = useMemo(() => total || projects.length, [total, projects.length])

  if (status === 'loading' || (!session && !TEST_MODE)) {
    return <div className="fos-app"><div className="fos-loading">加载中…</div></div>
  }

  return (
    <FosShell activeKey="projects">
      <div className="fos-scroll">
        <section className="px-6 py-8">
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-bold text-white">我的项目</h1>
              <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">管理您的AI短剧项目</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <AppIcon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fos-text-4)]" />
                <input className="fos-input pl-9" style={{ width: 280 }} type="search" placeholder="搜索项目名称…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()} aria-label="按项目名称搜索" />
              </div>
              {searchQuery ? (
                <button className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => { setSearchInput(''); setSearchQuery('') }}>清除</button>
              ) : null}
              <span className="fos-pill">{displayTotal} 个项目</span>
            </div>
          </div>

          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            <button type="button" onClick={() => setShowCreate(true)}
              className="group flex flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed transition-colors hover:border-[var(--fos-primary-border)]"
              style={{ aspectRatio: '16 / 14', borderColor: 'var(--fos-border-mid)', background: 'var(--fos-bg-2)' }}>
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--fos-bg-4)] text-white transition-transform group-hover:scale-105">
                <AppIcon name="plus" className="h-7 w-7" />
              </div>
              <div className="text-[13px] font-semibold text-[var(--fos-text-2)]">新建项目</div>
            </button>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-[10px]" style={{ aspectRatio: '16 / 14', background: 'var(--fos-bg-2)' }} />
              ))
            ) : (
              projects.map((p) => <ProjectCard key={p.id} project={p} />)
            )}
          </div>

          {!loading && projects.length === 0 ? (
            <div className="fos-card mt-8 p-6 text-center">
              <h2 className="text-[15px] font-bold text-white">{searchQuery ? '未找到匹配的项目' : '暂无项目'}</h2>
              <p className="mt-2 text-[13px] text-[var(--fos-text-3)]">{searchQuery ? '换个关键词试试，或清除搜索。' : '点击新建项目开始配置。'}</p>
            </div>
          ) : null}
        </section>
      </div>
      {showCreate ? <CreateProjectDialog onClose={() => setShowCreate(false)} onCreate={handleCreate} /> : null}
    </FosShell>
  )
}
