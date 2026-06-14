'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useState, useEffect, useCallback } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'
import { FrameWorkbenchShell } from '@/components/workspace/FrameWorkbenchShell'
import { shouldGuideToModelSetup } from '@/lib/workspace/model-setup'
import { Link, useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { validateProjectDraft } from '@/lib/projects/validation'

interface ProjectStats {
  episodes: number
  images: number
  videos: number
  panels: number
  firstEpisodePreview: string | null
}

type ProjectWorkflowStageKey = 'config' | 'script' | 'storyboard' | 'videos' | 'voice' | 'editor'
type ProjectWorkflowSummaryStatus = 'draft' | 'ready' | 'running' | 'blocked' | 'review' | 'stale'
type ProductionOverviewStageKey = 'draft' | 'script' | 'storyboard' | 'delivery'

interface ProjectWorkflowSummary {
  source: 'workflow-stage-state'
  currentStage: ProjectWorkflowStageKey
  status: ProjectWorkflowSummaryStatus
  progress: number
  activeTaskCount: number
  activeStages: ProjectWorkflowStageKey[]
  blockedStages: ProjectWorkflowStageKey[]
  reviewStages: ProjectWorkflowStageKey[]
  staleStages: ProjectWorkflowStageKey[]
  approvedStages: ProjectWorkflowStageKey[]
  blocker: string | null
  updatedAt: string | null
}

interface Project {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  totalCost?: number  // 项目总费用（CNY）
  stats?: ProjectStats
  workflowSummary?: ProjectWorkflowSummary
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const PAGE_SIZE = 7 // 加上新建项目按钮正好8个，4列布局下2行
const DEFAULT_BILLING_CURRENCY = 'CNY'
const TEST_MODE_ENABLED = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'
const DEFAULT_CREATION_SETUP = {
  projectLevel: 'efficient',
  contentType: 'shortDrama',
  resolution: '1080p',
  aspectRatio: '9:16',
  language: 'zh-CN',
  sourceType: 'text',
}

function formatProjectCost(amount: number, currency = DEFAULT_BILLING_CURRENCY): string {
  if (currency === 'USD') return `$${amount.toFixed(2)}`
  return `¥${amount.toFixed(2)}`
}

function toProjectValidationMessage(
  issue: ReturnType<typeof validateProjectDraft>,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (!issue) return null

  switch (issue.code) {
    case 'PROJECT_NAME_REQUIRED':
      return t('validation.nameRequired')
    case 'PROJECT_NAME_TOO_LONG':
      return t('validation.nameTooLong')
    case 'PROJECT_DESCRIPTION_TOO_LONG':
      return t('validation.descriptionTooLong')
  }

  return null
}

function readCreatedProjectId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const project = (payload as { project?: unknown }).project
  if (!project || typeof project !== 'object') return null
  const id = (project as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id : null
}

function readPageParam(value: string | null): number {
  const page = Number.parseInt(value || '1', 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function sanitizeProjectPreview(value?: string | null): string {
  const text = value || ''
  if (/agent/i.test(text)) return ''
  return text
    .replace(/\[[^\]]*agent[^\]]*\]/gi, '')
    .replace(/【[^】]*agent[^】]*】/gi, '')
    .replace(/\{[^{}]*agent[^{}]*\}/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveProductionOverviewStage(project: Pick<Project, 'stats' | 'workflowSummary'>): ProductionOverviewStageKey {
  switch (project.workflowSummary?.currentStage) {
    case 'config':
      return 'draft'
    case 'script':
      return 'script'
    case 'storyboard':
      return 'storyboard'
    case 'videos':
    case 'voice':
    case 'editor':
      return 'delivery'
  }

  if (!project.stats || ((project.stats.episodes || 0) === 0 && (project.stats.panels || 0) === 0 && (project.stats.videos || 0) === 0)) {
    return 'draft'
  }
  if ((project.stats.videos || 0) > 0) return 'delivery'
  if ((project.stats.panels || 0) > 0) return 'storyboard'
  return 'script'
}

function resolveProjectBadgeKey(project: Pick<Project, 'stats' | 'workflowSummary'>) {
  const status = project.workflowSummary?.status
  if (status === 'running') return 'running'
  if (status === 'blocked') return 'blocked'
  if (status === 'review' || status === 'stale') return 'review'
  const hasContent = Boolean(project.stats && (
    project.stats.episodes > 0
    || project.stats.images > 0
    || project.stats.videos > 0
    || project.stats.panels > 0
  ))
  return hasContent || status === 'ready' ? 'active' : 'draft'
}

export default function WorkspacePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const urlSearchParams = useSearchParams()
  const initialSearch = urlSearchParams?.get('search') || ''
  const initialPage = readPageParam(urlSearchParams?.get('page') || null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  })
  const [creationSetup, setCreationSetup] = useState(DEFAULT_CREATION_SETUP)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState({
    name: '',
    description: ''
  })
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)

  // 分页和搜索状态
  const [pagination, setPagination] = useState<Pagination>({ page: initialPage, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
  const [searchQuery, setSearchQuery] = useState(initialSearch)
  const [searchInput, setSearchInput] = useState(initialSearch)
  const [modelNotConfigured, setModelNotConfigured] = useState(false)

  const t = useTranslations('workspace')
  const tc = useTranslations('common')

  const syncListUrl = useCallback((page: number, search: string) => {
    const params = new URLSearchParams()
    const trimmedSearch = search.trim()
    if (trimmedSearch) params.set('search', trimmedSearch)
    if (page > 1) params.set('page', String(page))
    const query = params.toString()
    router.replace(query ? `/workspace?${query}` : '/workspace')
  }, [router])

  // 检查用户是否已登录
  useEffect(() => {
    if (status === 'loading') return
    if (!session && !TEST_MODE_ENABLED) {
      router.push({ pathname: '/auth/signin' })
      return
    }
  }, [session, status, router])

  useEffect(() => {
    if (!urlSearchParams) return
    const nextSearch = urlSearchParams.get('search') || ''
    const nextPage = readPageParam(urlSearchParams.get('page'))
    setSearchInput(nextSearch)
    setSearchQuery(nextSearch)
    setPagination(prev => (
      prev.page === nextPage ? prev : { ...prev, page: nextPage }
    ))
  }, [urlSearchParams])

  // 获取项目列表
  const fetchProjects = useCallback(async (page: number = 1, search: string = '') => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: PAGE_SIZE.toString()
      })
      if (search.trim()) {
        params.set('search', search.trim())
      }

      const response = await apiFetch(`/api/projects?${params}`)
      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects)
        setPagination(data.pagination)
      }
    } catch (error) {
      _ulogError('获取项目失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载和搜索/分页变化时重新获取
  useEffect(() => {
    if (session || TEST_MODE_ENABLED) {
      fetchProjects(pagination.page, searchQuery)
    }
  }, [session, pagination.page, searchQuery, fetchProjects])

  // 搜索处理
  const handleSearch = () => {
    const nextSearch = searchInput.trim()
    setSearchInput(nextSearch)
    setSearchQuery(nextSearch)
    setPagination(prev => ({ ...prev, page: 1 }))
    syncListUrl(1, nextSearch)
  }

  // 打开新建项目弹窗并检测模型配置
  const openCreateModal = useCallback(() => {
    setCreateError(null)
    setShowCreateModal(true)
    // 异步检测模型配置状态
    void (async () => {
      try {
        const res = await apiFetch('/api/user-preference')
        if (res.ok) {
          const payload: unknown = await res.json()
          setModelNotConfigured(shouldGuideToModelSetup(payload))
        }
      } catch {
        // 忽略检测失败
      }
    })()
  }, [])

  // 分页处理
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }))
    syncListUrl(newPage, searchQuery)
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationMessage = toProjectValidationMessage(validateProjectDraft(formData), t)
    if (validationMessage) {
      setCreateError(validationMessage)
      return
    }

    setCreateError(null)
    setCreateLoading(true)
    try {
      const response = await apiFetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      if (response.ok) {
        const payload: unknown = await response.json()
        const createdProjectId = readCreatedProjectId(payload)
        if (!createdProjectId) {
          throw new Error(t('createFailed'))
        }

        setSearchQuery('')
        setSearchInput('')
        setPagination(prev => ({ ...prev, page: 1 }))
        syncListUrl(1, '')
        setShowCreateModal(false)
        setFormData({ name: '', description: '' })
        router.push({ pathname: `/workspace/${createdProjectId}` })
      } else if (response.status === 401 && !TEST_MODE_ENABLED) {
        await signOut({ redirect: false })
        router.push({ pathname: '/auth/signin' })
      } else {
        setCreateError(await readApiErrorMessage(response, t('createFailed')))
      }
    } catch (error) {
      _ulogError('创建项目失败:', error)
      setCreateError(error instanceof Error ? error.message : t('createFailed'))
    } finally {
      setCreateLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    // 转换为北京时间 (UTC+8)
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    return beijingTime.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai'
    })
  }

  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingProject) return

    const validationMessage = toProjectValidationMessage(validateProjectDraft(editFormData), t)
    if (validationMessage) {
      setEditError(validationMessage)
      return
    }

    setEditError(null)
    setCreateLoading(true)
    try {
      const response = await apiFetch(`/api/projects/${editingProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editFormData)
      })

      if (response.ok) {
        const data = await response.json()
        setProjects(projects.map(p => p.id === editingProject.id ? data.project : p))
        setShowEditModal(false)
        setEditingProject(null)
        setEditFormData({ name: '', description: '' })
      } else {
        setEditError(await readApiErrorMessage(response, t('updateFailed')))
      }
    } catch (error) {
      setEditError(error instanceof Error ? error.message : t('updateFailed'))
    } finally {
      setCreateLoading(false)
    }
  }

  const handleDeleteProject = async () => {
    if (!projectToDelete) return

    setDeletingProjectId(projectToDelete.id)
    setShowDeleteConfirm(false)

    try {
      const response = await apiFetch(`/api/projects/${projectToDelete.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        // 删除成功后重新获取当前页
        fetchProjects(pagination.page, searchQuery)
      } else {
        alert(t('deleteFailed'))
      }
    } catch {
      alert(t('deleteFailed'))
    } finally {
      setDeletingProjectId(null)
      setProjectToDelete(null)
    }
  }

  const openDeleteConfirm = (project: Project, e: React.MouseEvent) => {
    e.preventDefault()  // 阻止 Link 导航
    e.stopPropagation()
    setProjectToDelete(project)
    setShowDeleteConfirm(true)
  }

  const cancelDelete = () => {
    setShowDeleteConfirm(false)
    setProjectToDelete(null)
  }

  const openEditModal = (project: Project, e: React.MouseEvent) => {
    e.preventDefault()  // 阻止 Link 导航
    e.stopPropagation()
    setEditingProject(project)
    setEditError(null)
    setEditFormData({
      name: project.name,
      description: project.description || ''
    })
    setShowEditModal(true)
  }

  const creationSections = [
    { key: 'script', label: t('createModal.pipeline.script'), icon: 'fileText' },
    { key: 'assets', label: t('createModal.pipeline.assets'), icon: 'folderHeart' },
    { key: 'storyboard', label: t('createModal.pipeline.storyboard'), icon: 'clapperboard' },
    { key: 'delivery', label: t('createModal.pipeline.delivery'), icon: 'download' },
  ] as const
  const projectLevelOptions = [
    { value: 'efficient', label: t('createModal.levels.efficient'), hint: t('createModal.levelHints.efficient') },
    { value: 'premium', label: t('createModal.levels.premium'), hint: t('createModal.levelHints.premium') },
    { value: 'premium2', label: t('createModal.levels.premium2'), hint: t('createModal.levelHints.premium2') },
  ] as const
  const sourceTypeOptions = [
    { value: 'text', label: t('createModal.sourceTypes.text'), icon: 'fileText' },
    { value: 'upload', label: t('createModal.sourceTypes.upload'), icon: 'cloudUpload' },
  ] as const
  const compactSelects = [
    {
      key: 'contentType',
      label: t('createModal.contentType'),
      options: [
        { value: 'shortDrama', label: t('createModal.contentTypes.shortDrama') },
        { value: 'animation', label: t('createModal.contentTypes.animation') },
      ],
    },
    {
      key: 'resolution',
      label: t('createModal.resolution'),
      options: [
        { value: '1080p', label: '1080p' },
        { value: '720p', label: '720p' },
        { value: '4k', label: '4K' },
      ],
    },
    {
      key: 'aspectRatio',
      label: t('createModal.aspectRatio'),
      options: [
        { value: '9:16', label: '9:16' },
        { value: '16:9', label: '16:9' },
        { value: '1:1', label: '1:1' },
      ],
    },
    {
      key: 'language',
      label: t('createModal.language'),
      options: [
        { value: 'zh-CN', label: t('createModal.languages.zh') },
        { value: 'en-US', label: t('createModal.languages.en') },
      ],
    },
  ] as const

  const productionRows = (['draft', 'script', 'storyboard', 'delivery'] as const).map((key) => {
    const count = projects.filter(project => resolveProductionOverviewStage(project) === key).length
    return {
      key,
      count,
      ready: key !== 'draft' && count > 0,
    }
  })

  if (status === 'loading' || (!session && !TEST_MODE_ENABLED)) {
    return (
      <div className="glass-page min-h-screen flex items-center justify-center">
        <div className="text-[var(--glass-text-secondary)]">{tc('loading')}</div>
      </div>
    )
  }

  return (
    <FrameWorkbenchShell activeKey="projects">
          <section className="mb-6 rounded-lg border border-white/10 bg-[#171922] p-5 shadow-[0_18px_50px_rgba(0,0,0,.20)]">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/62">
                  <AppIcon name="monitor" className="h-3.5 w-3.5" />
                  {t('workbenchEyebrow')}
                </div>
                <h1 className="text-2xl font-bold text-white md:text-3xl">{t('title')}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">{t('subtitle')}</p>
              </div>

              {/* 搜索框 */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder={t('searchPlaceholder')}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#0f1117] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/32 focus:border-[#2c6ef2] sm:w-72"
                />
                <button
                  onClick={handleSearch}
                  className="h-10 rounded-md bg-[#2c6ef2] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f5edd]"
                >
                  {t('searchButton')}
                </button>
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchInput('')
                      setSearchQuery('')
                      setPagination(prev => ({ ...prev, page: 1 }))
                      syncListUrl(1, '')
                    }}
                    className="h-10 rounded-md border border-white/10 px-4 text-sm font-semibold text-white/72 transition-colors hover:bg-white/7 hover:text-white"
                  >
                    {t('clearButton')}
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="mb-6 overflow-hidden rounded-lg border border-white/10 bg-[#151820] shadow-[0_18px_50px_rgba(0,0,0,.18)]">
            <div className="flex flex-col gap-1 border-b border-white/10 bg-white/5 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                  <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#9bc3ff]" />
                  {t('productionOverview.title')}
                </div>
                <p className="mt-1 text-xs leading-5 text-white/40">{t('productionOverview.subtitle')}</p>
              </div>
              <span className="w-fit rounded border border-white/10 bg-[#10131b] px-2 py-1 text-[11px] font-medium text-white/42">
                {t('productionOverview.source')}
              </span>
            </div>
            <div className="grid grid-cols-[.75fr_.55fr_.65fr_1fr] gap-2 border-b border-white/10 bg-[#10131b] px-4 py-2 text-[11px] font-medium text-white/42">
              <div>{t('productionOverview.columns.stage')}</div>
              <div>{t('productionOverview.columns.projects')}</div>
              <div>{t('productionOverview.columns.status')}</div>
              <div>{t('productionOverview.columns.next')}</div>
            </div>
            <div className="divide-y divide-white/8">
              {productionRows.map(row => (
                <div key={row.key} className="grid grid-cols-[.75fr_.55fr_.65fr_1fr] gap-2 px-4 py-3 text-xs">
                  <div className="truncate font-medium text-white/74">{t(`productionOverview.stages.${row.key}.title`)}</div>
                  <div className="text-white/56">{row.count}</div>
                  <div>
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                      row.ready
                        ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                        : row.key === 'draft'
                          ? 'border-[#ffd98a]/30 bg-[#ffd98a]/10 text-[#ffd98a]'
                          : 'border-white/10 bg-white/5 text-white/38'
                    }`}>
                      {row.ready ? t('productionOverview.ready') : row.key === 'draft' ? t('productionOverview.pending') : t('productionOverview.waiting')}
                    </span>
                  </div>
                  <div className="truncate text-white/42">{t(`productionOverview.stages.${row.key}.hint`)}</div>
                </div>
              ))}
            </div>
          </section>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="group flex min-h-[282px] flex-col overflow-hidden rounded-lg border border-dashed border-[#2c6ef2]/55 bg-[#141821] text-left transition-all duration-300 hover:border-[#63a4ff] hover:bg-[#182033] hover:shadow-[0_18px_50px_rgba(44,110,242,.18)]"
          >
            <div className="flex h-36 items-center justify-center border-b border-white/8 bg-[#0f121a]">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#2c6ef2] text-white shadow-[0_14px_36px_rgba(44,110,242,.35)] transition-transform group-hover:scale-105">
                <AppIcon name="plus" className="h-7 w-7" />
              </div>
            </div>
            <div className="flex flex-1 flex-col justify-between p-4">
              <div>
                <div className="text-base font-semibold text-white">{t('newProject')}</div>
                <p className="mt-2 text-sm leading-6 text-white/52">{t('newProjectDesc')}</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {[t('featureChips.script'), t('featureChips.assets'), t('featureChips.storyboard')].map((chip) => (
                  <span key={chip} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/58">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </button>

          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="min-h-[282px] animate-pulse rounded-lg border border-white/10 bg-[#151820]">
                <div className="h-36 border-b border-white/8 bg-white/5" />
                <div className="space-y-3 p-4">
                  <div className="h-4 rounded bg-white/8" />
                  <div className="h-3 rounded bg-white/8" />
                  <div className="h-3 w-2/3 rounded bg-white/8" />
                </div>
              </div>
            ))
          ) : (
            projects.map((project) => {
              const hasContent = Boolean(project.stats && (project.stats.episodes > 0 || project.stats.images > 0 || project.stats.videos > 0 || project.stats.panels > 0))
              const projectBadgeKey = resolveProjectBadgeKey(project)
              const previewText = sanitizeProjectPreview(project.description) || sanitizeProjectPreview(project.stats?.firstEpisodePreview) || t('noContent')

              return (
                <Link
                  key={project.id}
                  href={{ pathname: `/workspace/${project.id}` }}
                  className="group block min-h-[282px] overflow-hidden rounded-lg border border-white/10 bg-[#151820] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2c6ef2]/70 hover:bg-[#181d28] hover:shadow-[0_18px_50px_rgba(0,0,0,.28)]"
                >
                  <div className="relative flex h-36 items-center justify-center overflow-hidden border-b border-white/8 bg-[#0d1017]">
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(44,110,242,.22),transparent_45%,rgba(20,184,166,.12))]" />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-lg border border-white/10 bg-white/8 text-white/80">
                      <AppIcon name={projectBadgeKey !== 'draft' || hasContent ? 'film' : 'folderOpen'} className="h-7 w-7" />
                    </div>
                    <span className="absolute left-3 top-3 rounded bg-[#2c6ef2]/90 px-2 py-1 text-[11px] font-semibold text-white">
                      {t(`projectBadge.${projectBadgeKey}`)}
                    </span>
                    <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => openEditModal(project, e)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/35 text-white/72 backdrop-blur hover:bg-white/12 hover:text-white"
                        title={t('editProject')}
                      >
                        <AppIcon name="editSquare" className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => openDeleteConfirm(project, e)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/35 text-white/72 backdrop-blur hover:bg-red-500/18 hover:text-red-200"
                        title={t('deleteProject')}
                        disabled={deletingProjectId === project.id}
                      >
                        {deletingProjectId === project.id ? (
                          <TaskStatusInline
                            state={resolveTaskPresentationState({
                              phase: 'processing',
                              intent: 'process',
                              resource: 'text',
                              hasOutput: true,
                            })}
                            className="[&>span]:sr-only"
                          />
                        ) : (
                          <AppIcon name="trash" className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex min-h-[146px] flex-col p-4">
                    <h3 className="line-clamp-1 text-base font-semibold text-white transition-colors group-hover:text-[#7eb0ff]">
                      {project.name}
                    </h3>
                    <p className="mt-2 line-clamp-2 min-h-[44px] text-sm leading-6 text-white/55">
                      {previewText}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/58">
                        <AppIcon name="fileText" className="h-3 w-3" />
                        {project.stats?.episodes || 0} {t('statsEpisodes')}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/58">
                        <AppIcon name="clapperboard" className="h-3 w-3" />
                        {project.stats?.panels || 0}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/58">
                        <AppIcon name="video" className="h-3 w-3" />
                        {project.stats?.videos || 0}
                      </span>
                    </div>

                    <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-white/38">
                      <div className="flex min-w-0 items-center gap-1">
                        <AppIcon name="clock" className="h-3 w-3 shrink-0" />
                        <span className="truncate">{formatDate(project.updatedAt)}</span>
                      </div>
                      {project.totalCost !== undefined && project.totalCost > 0 && (
                        <span className="shrink-0 font-mono font-medium text-white/62">
                          {formatProjectCost(project.totalCost)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })
          )}
        </div>

        {/* Empty State */}
        {!loading && projects.length === 0 && (
          <div className="mt-8 rounded-lg border border-white/10 bg-[#151820] px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-[#0f121a]">
              <AppIcon name="clapperboard" className="h-8 w-8 text-white/45" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-white">
              {searchQuery ? t('noResults') : t('noProjects')}
            </h3>
            <p className="mx-auto mb-5 max-w-lg text-sm leading-6 text-white/55">
              {searchQuery ? t('noResultsDesc') : t('noProjectsDesc')}
            </p>
            {!searchQuery && (
              <div className="mb-6 flex flex-wrap justify-center gap-2">
                {[t('featureChips.script'), t('featureChips.assets'), t('featureChips.storyboard')].map((chip) => (
                  <span key={chip} className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/58">
                    {chip}
                  </span>
                ))}
              </div>
            )}
            {!searchQuery && (
              <button
                onClick={() => openCreateModal()}
                className="rounded-md bg-[#2c6ef2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f5edd]"
              >
                {t('newProject')}
              </button>
            )}
          </div>
        )}

        {/* 分页控件 */}
        {!loading && pagination.totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="glass-btn-base glass-btn-secondary px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <AppIcon name="chevronLeft" className="w-5 h-5" />
            </button>

            {/* 页码按钮 */}
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
              .filter(page => {
                // 显示第一页、最后一页、当前页及其前后两页
                return page === 1 ||
                  page === pagination.totalPages ||
                  Math.abs(page - pagination.page) <= 2
              })
              .map((page, index, array) => (
                <span key={page} className="flex items-center">
                  {/* 显示省略号 */}
                  {index > 0 && array[index - 1] !== page - 1 && (
                    <span className="px-2 text-[var(--glass-text-tertiary)]">...</span>
                  )}
                  <button
                    onClick={() => handlePageChange(page)}
                    className={`glass-btn-base px-4 py-2 ${page === pagination.page
                      ? 'glass-btn-primary'
                      : 'glass-btn-secondary'
                      }`}
                  >
                    {page}
                  </button>
                </span>
              ))}

            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="glass-btn-base glass-btn-secondary px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <AppIcon name="chevronRight" className="w-5 h-5" />
            </button>

            <span className="ml-4 text-sm text-[var(--glass-text-tertiary)]">
              {t('totalProjects', { count: pagination.total })}
            </span>
          </div>
        )}


      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-[#151820] shadow-[0_24px_80px_rgba(0,0,0,.45)]">
            <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="text-xl font-bold text-white">{t('createProject')}</h2>
                <p className="mt-1 text-sm text-white/48">{t('createModal.subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false)
                  setCreateError(null)
                  setFormData({ name: '', description: '' })
                  setCreationSetup(DEFAULT_CREATION_SETUP)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-white/48 hover:bg-white/8 hover:text-white"
                disabled={createLoading}
              >
                <AppIcon name="close" className="h-4 w-4" />
              </button>
            </div>
            {modelNotConfigured && (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-amber-200">
                <AppIcon name="alert" className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="text-[12px] leading-relaxed">
                  {t('modelNotConfigured.before')}
                  <Link
                    href={{ pathname: '/profile' }}
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300 mx-0.5"
                    onClick={() => setShowCreateModal(false)}
                  >
                    {t('modelNotConfigured.link')}
                  </Link>
                  {t('modelNotConfigured.after')}
                </span>
              </div>
            )}
            <form onSubmit={handleCreateProject} className="max-h-[calc(92vh-73px)] overflow-y-auto">
              <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_.85fr]">
                <div className="space-y-5">
                  <section className="rounded-lg border border-white/10 bg-[#10131b] p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                      <AppIcon name="fileText" className="h-4 w-4 text-[#7eb0ff]" />
                      {t('createModal.basicInfo')}
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="name" className="mb-2 block text-xs font-semibold text-white/62">
                          {t('projectName')} *
                        </label>
                        <input
                          id="name"
                          type="text"
                          value={formData.name}
                          onChange={(e) => {
                            setFormData({ ...formData, name: e.target.value })
                            if (createError) {
                              setCreateError(null)
                            }
                          }}
                          className="h-10 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-[#2c6ef2]"
                          placeholder={t('projectNamePlaceholder')}
                          maxLength={100}
                          required
                          autoFocus
                        />
                      </div>
                      <div>
                        <label htmlFor="description" className="mb-2 block text-xs font-semibold text-white/62">
                          {t('projectDescription')}
                        </label>
                        <textarea
                          id="description"
                          value={formData.description}
                          onChange={(e) => {
                            setFormData({ ...formData, description: e.target.value })
                            if (createError) {
                              setCreateError(null)
                            }
                          }}
                          className="min-h-[104px] w-full resize-y rounded-md border border-white/10 bg-[#0b0e14] px-3 py-2 text-sm leading-6 text-white outline-none transition-colors placeholder:text-white/28 focus:border-[#2c6ef2]"
                          placeholder={t('projectDescriptionPlaceholder')}
                          rows={4}
                          maxLength={500}
                        />
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-white/10 bg-[#10131b] p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                      <AppIcon name="monitor" className="h-4 w-4 text-[#7eb0ff]" />
                      {t('createModal.productionSetup')}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {compactSelects.map((select) => (
                        <label key={select.key} className="block">
                          <span className="mb-2 block text-xs font-semibold text-white/62">{select.label}</span>
                          <select
                            value={creationSetup[select.key]}
                            onChange={(e) => setCreationSetup(prev => ({ ...prev, [select.key]: e.target.value }))}
                            className="h-10 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none focus:border-[#2c6ef2]"
                          >
                            {select.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-white/10 bg-[#10131b] p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <AppIcon name="cloudUpload" className="h-4 w-4 text-[#7eb0ff]" />
                        {t('createModal.source')}
                      </div>
                      <span className="text-xs text-white/38">{t('createModal.sourceHint')}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {sourceTypeOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setCreationSetup(prev => ({ ...prev, sourceType: option.value }))}
                          className={`flex items-center gap-3 rounded-md border px-3 py-3 text-left text-sm transition-colors ${
                            creationSetup.sourceType === option.value
                              ? 'border-[#2c6ef2] bg-[#2c6ef2]/14 text-white'
                              : 'border-white/10 bg-white/4 text-white/58 hover:bg-white/7 hover:text-white'
                          }`}
                        >
                          <AppIcon name={option.icon} className="h-4 w-4" />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>

                <aside className="space-y-5">
                  <section className="rounded-lg border border-white/10 bg-[#10131b] p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                      <AppIcon name="diamond" className="h-4 w-4 text-[#7eb0ff]" />
                      {t('createModal.projectLevel')}
                    </div>
                    <div className="space-y-2">
                      {projectLevelOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setCreationSetup(prev => ({ ...prev, projectLevel: option.value }))}
                          className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                            creationSetup.projectLevel === option.value
                              ? 'border-[#2c6ef2] bg-[#2c6ef2]/14'
                              : 'border-white/10 bg-white/4 hover:bg-white/7'
                          }`}
                        >
                          <div className="text-sm font-semibold text-white">{option.label}</div>
                          <div className="mt-1 text-xs leading-5 text-white/45">{option.hint}</div>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-lg border border-white/10 bg-[#10131b] p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                      <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#7eb0ff]" />
                      {t('createModal.pipelineTitle')}
                    </div>
                    <div className="space-y-3">
                      {creationSections.map((section, index) => (
                        <div key={section.key} className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/62">
                            <AppIcon name={section.icon} className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white/76">{section.label}</div>
                            <div className="text-xs text-white/34">{t('createModal.step', { index: index + 1 })}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </aside>
              </div>
              {createError && (
                <p className="mx-5 mb-4 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {createError}
                </p>
              )}
              <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-xs leading-5 text-white/38">{t('createModal.persistenceNote')}</p>
                  <p className="text-xs leading-5 text-white/30">{t('createModal.workflowBoundaryNote')}</p>
                </div>
                <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setCreateError(null)
                    setFormData({ name: '', description: '' })
                    setCreationSetup(DEFAULT_CREATION_SETUP)
                  }}
                  className="rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-white/68 transition-colors hover:bg-white/8 hover:text-white"
                  disabled={createLoading}
                >
                  {tc('cancel')}
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[#2c6ef2] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f5edd] disabled:opacity-50"
                  disabled={createLoading || !formData.name.trim()}
                >
                  {createLoading ? t('creating') : t('createProject')}
                </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditModal && editingProject && (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="glass-surface-modal p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-[var(--glass-text-primary)] mb-4">{t('editProject')}</h2>
            <form onSubmit={handleEditProject}>
              <div className="mb-4">
                <label htmlFor="edit-name" className="glass-field-label block mb-2">
                  {t('projectName')} *
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => {
                    setEditFormData({ ...editFormData, name: e.target.value })
                    if (editError) {
                      setEditError(null)
                    }
                  }}
                  className="glass-input-base w-full px-3 py-2"
                  placeholder={t('projectNamePlaceholder')}
                  maxLength={100}
                  required
                />
              </div>
              <div className="mb-6">
                <label htmlFor="edit-description" className="glass-field-label block mb-2">
                  {t('projectDescription')}
                </label>
                <textarea
                  id="edit-description"
                  value={editFormData.description}
                  onChange={(e) => {
                    setEditFormData({ ...editFormData, description: e.target.value })
                    if (editError) {
                      setEditError(null)
                    }
                  }}
                  className="glass-textarea-base w-full px-3 py-2"
                  placeholder={t('projectDescriptionPlaceholder')}
                  rows={3}
                  maxLength={500}
                />
              </div>
              {editError && (
                <p className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  {editError}
                </p>
              )}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingProject(null)
                    setEditError(null)
                    setEditFormData({ name: '', description: '' })
                  }}
                  className="glass-btn-base glass-btn-secondary px-4 py-2"
                  disabled={createLoading}
                >
                  {tc('cancel')}
                </button>
                <button
                  type="submit"
                  className="glass-btn-base glass-btn-primary px-4 py-2 disabled:opacity-50"
                  disabled={createLoading || !editFormData.name.trim()}
                >
                  {createLoading ? t('saving') : tc('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      <ConfirmDialog
        show={showDeleteConfirm}
        title={t('deleteProject')}
        message={t('deleteConfirm', { name: projectToDelete?.name || '' })}
        confirmText={tc('delete')}
        cancelText={tc('cancel')}
        type="danger"
        onConfirm={handleDeleteProject}
        onCancel={cancelDelete}
      />
    </FrameWorkbenchShell>
  )
}
