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

const DEMO_PROJECTS: ProjectItem[] = [
  {
    id: 'demo-test',
    name: 'TEST',
    description: '精品版 2.0 · 剧情模式 · 9:16',
    createdAt: '2026-06-13T00:00:00.000+08:00',
    updatedAt: '2026-06-13T00:00:00.000+08:00',
  },
  {
    id: 'demo-deal',
    name: '$50,000 Deal with the Devil',
    description: '精品版 · 剧情模式 · 9:16 · 都市医疗冷峻风',
    createdAt: '2026-06-09T00:00:00.000+08:00',
    updatedAt: '2026-06-09T00:00:00.000+08:00',
  },
]

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' })
}

function deriveEdition(project: ProjectItem) {
  if ((project.description || '').includes('精品版 ·')) return '精品版'
  if (project.name.includes('$50,000')) return '精品版'
  return '精品版 2.0'
}

function ProjectCard({ project }: { project: ProjectItem }) {
  const desc = project.description || ''
  const style = desc.split('·').map((s) => s.trim()).find((s) => s.endsWith('风')) ?? null
  return (
    <Link href={{ pathname: `/workflow/${project.id}/workbench-premium2` }}
      className="group block w-[255px] overflow-hidden rounded-[13px] border transition-colors hover:border-[rgba(255,255,255,.16)]"
      style={{ borderColor: 'rgba(255,255,255,.06)', background: 'rgba(20,20,20,.92)' }}>
      <div className="relative flex h-[180px] items-center justify-center" style={{ background: 'linear-gradient(180deg,rgba(28,45,73,.78),rgba(19,27,48,.75) 55%,rgba(18,18,18,.95))' }}>
        <span className="absolute left-4 top-4 rounded-full border border-[#c69a30]/40 bg-[#4a3912]/80 px-3 py-1 text-[12px] font-bold text-[#f0c94a] shadow-[0_0_16px_rgba(240,201,74,.12)]">{deriveEdition(project)}</span>
        <AppIcon name="folderOpen" className="h-16 w-16 text-[#8190ad]/45" />
      </div>
      <div className="px-5 pb-4 pt-4">
        <h3 className="line-clamp-2 min-h-[44px] text-[18px] font-bold leading-[22px] text-white">{project.name}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex h-6 items-center gap-1 rounded-[7px] bg-[rgba(255,255,255,.05)] px-2 py-1 text-[12px] font-medium text-[var(--fos-text-3)]">
            <AppIcon name="film" className="h-3.5 w-3.5 text-[#4d86ff]" />剧情模式
          </span>
          <span className="inline-flex h-6 items-center gap-1 rounded-[7px] bg-[rgba(255,255,255,.05)] px-2 py-1 text-[12px] font-medium text-[var(--fos-text-3)]">
            <AppIcon name="monitor" className="h-3.5 w-3.5 text-[#2ccf96]" />9:16
          </span>
          {style ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-[7px] bg-[rgba(255,255,255,.05)] px-2 py-1 text-[12px] font-medium text-[var(--fos-text-3)]">
              <AppIcon name="sparkles" className="h-3.5 w-3.5 text-[#8b5cf6]" />{style}
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-1.5 border-t border-[rgba(255,255,255,.04)] pt-3 text-[12px] text-[var(--fos-text-4)]">
          <AppIcon name="clock" className="h-3.5 w-3.5" />{formatDate(project.createdAt)} 创建
        </div>
      </div>
    </Link>
  )
}

function WorkCollection({ projects }: { projects: ProjectItem[] }) {
  return (
    <section className="overflow-hidden rounded-[13px] border border-[rgba(110,87,31,.35)] bg-[rgba(10,10,10,.7)]">
      <div
        className="flex h-[64px] items-center justify-between px-5"
        style={{ background: 'linear-gradient(90deg,rgba(88,35,111,.75),rgba(25,13,65,.72) 42%,rgba(16,16,18,.88))' }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-full bg-[#4f3a15] px-3 py-1 text-[12px] font-bold text-[#f0c94a]">作品</span>
          <h2 className="truncate text-[18px] font-bold text-white">默认作品</h2>
        </div>
        <div className="flex flex-none items-center gap-5 text-[13px] font-medium text-[var(--fos-text-3)]">
          <span className="inline-flex items-center gap-1.5"><AppIcon name="fileFold" className="h-3.5 w-3.5" />4 个项目</span>
          <span className="inline-flex items-center gap-1.5"><AppIcon name="clock" className="h-3.5 w-3.5" />2026年6月18日 创建</span>
        </div>
      </div>
      <div className="min-h-[390px] p-4">
        <div className="flex flex-wrap gap-4">
          {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </div>
      </div>
    </section>
  )
}

export function FosProjectsClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const urlParams = useSearchParams()
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
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

  const handleCreate = async (
    draft: CreateProjectDraft,
    setStatus: (status: string) => void,
  ): Promise<boolean> => {
    setStatus('上传剧本并创建项目…')
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
    setStatus('进入工作台…')
    router.push({ pathname: `/workflow/${id}/workbench-premium2` })
    return true
  }

  const visibleProjects = useMemo(() => {
    const fallback = TEST_MODE && projects.length === 0 ? DEMO_PROJECTS : projects
    if (!searchQuery.trim()) return fallback
    const q = searchQuery.trim().toLowerCase()
    return fallback.filter((project) => project.name.toLowerCase().includes(q))
  }, [projects, searchQuery])
  const worksTotal = visibleProjects.length > 0 || loading ? 1 : 0

  if (status === 'loading' || (!session && !TEST_MODE)) {
    return <div className="fos-app"><div className="fos-loading">加载中…</div></div>
  }

  return (
    <FosShell activeKey="projects">
      <div className="fos-scroll">
        <section className="px-9 py-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-[24px] font-bold text-white">我的作品</h1>
              <button type="button" onClick={() => setShowCreate(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#7c5cff]/45 bg-[rgba(124,92,255,.18)] px-3 text-[13px] font-bold text-[#b49cff] hover:bg-[rgba(124,92,255,.26)]">
                <AppIcon name="plus" className="h-3.5 w-3.5" />新建作品
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-[var(--fos-text-3)]">{worksTotal} 个作品</span>
              <div className="relative">
                <AppIcon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fos-text-4)]" />
                <input className="fos-input" style={{ width: 240, paddingLeft: 36, height: 40, background: 'var(--fos-bg-2)' }} type="search" placeholder="搜索作品或项目..."
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()} aria-label="搜索作品或项目" />
              </div>
              {searchQuery ? (
                <button className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => { setSearchInput(''); setSearchQuery('') }}>清除</button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="animate-pulse overflow-hidden rounded-[13px] border border-[rgba(110,87,31,.25)]">
              <div className="h-[64px] bg-[var(--fos-bg-3)]" />
              <div className="h-[390px] bg-[var(--fos-bg-2)]" />
            </div>
          ) : visibleProjects.length > 0 ? (
            <WorkCollection projects={visibleProjects} />
          ) : (
            <div className="fos-card mt-8 p-6 text-center">
              <h2 className="text-[15px] font-bold text-white">{searchQuery ? '未找到匹配的作品或项目' : '暂无作品'}</h2>
              <p className="mt-2 text-[13px] text-[var(--fos-text-3)]">{searchQuery ? '换个关键词试试，或清除搜索。' : '点击新建作品开始配置。'}</p>
            </div>
          )}
        </section>
      </div>
      {showCreate ? <CreateProjectDialog onClose={() => setShowCreate(false)} onCreate={handleCreate} /> : null}
    </FosShell>
  )
}
