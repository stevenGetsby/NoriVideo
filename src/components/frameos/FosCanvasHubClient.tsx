'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Link, useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { CanvasWorkspace } from '@/features/canvas/CanvasWorkspace'
import type { CanvasProjectOption, CanvasWorkOption } from '@/features/canvas/types'
import { FosShell } from './FosShell'
import { fetchAllWorks } from './works/fetch-all-works'
import { UNASSIGNED_WORK_ID } from './works/types'
import { canvasNavigationSurfaceKey } from '@/lib/frameos/navigation-surface-key'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { createWorkInProjectHref } from '@/lib/projects/hierarchy'

const TEST_MODE = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'

function createProjectHref(workId: string) {
  return createWorkInProjectHref(workId)
}

function CanvasProjectChooser({
  works,
  projects,
  selectedWork,
  canCreateProjects,
  loading,
  error,
  onRetry,
  onSelectWork,
  onSelect,
}: {
  works: CanvasWorkOption[]
  projects: CanvasProjectOption[]
  selectedWork: CanvasWorkOption | null
  canCreateProjects: boolean
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelectWork: (workId: string) => void
  onSelect: (projectId: string) => void
}) {
  const [picker, setPicker] = useState<'work' | 'project' | null>(null)
  const [keyword, setKeyword] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const workProjects = useMemo(
    () => selectedWork ? projects.filter((project) => project.workId === selectedWork.id) : [],
    [projects, selectedWork],
  )
  const directProjects = selectedWork ? workProjects : projects
  const visibleWorks = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    if (!query || picker !== 'work') return works
    return works.filter((work) => work.name.toLocaleLowerCase().includes(query))
  }, [keyword, picker, works])
  const visibleProjects = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    if (!query || picker !== 'project') return workProjects
    return workProjects.filter((project) => project.name.toLocaleLowerCase().includes(query))
  }, [keyword, picker, workProjects])

  useEffect(() => {
    if (!picker) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPicker(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [picker])

  const togglePicker = (next: 'work' | 'project') => {
    setKeyword('')
    setPicker((current) => current === next ? null : next)
  }

  return (
    <div className="nori-canvas-workspace nori-canvas-hub-empty">
      <div className="nori-canvas-hub-breadcrumbs" ref={rootRef}>
        <Link href={{ pathname: '/projects' }} title="返回我的项目"><AppIcon name="chevronLeft" /></Link>
        <button type="button" data-testid="global-canvas-work-picker" onClick={() => togglePicker('work')}>
          <span>{selectedWork?.name || '选择项目'}</span><AppIcon name="chevronDown" />
        </button>
        <i>/</i>
        <button type="button" data-testid="global-canvas-project-picker" disabled={!selectedWork} onClick={() => togglePicker('project')}>
          <span>选择作品</span><AppIcon name="chevronDown" />
        </button>
        <i>/</i><span aria-current="step"><span>选择画布</span></span>
        {picker === 'work' ? (
          <div className="nori-canvas-hub-project-menu nori-canvas-hub-work-menu">
            <header><strong>选择项目</strong><span>{works.length} 个</span></header>
            <label><AppIcon name="search" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索项目" autoFocus /></label>
            <div>
              {visibleWorks.map((work) => (
                <button type="button" key={work.id} className={work.id === selectedWork?.id ? 'is-active' : ''} onClick={() => { onSelectWork(work.id); setPicker(null) }}>
                  <span>{work.name}</span><small>{work.projectCount} 个作品</small>
                </button>
              ))}
              {visibleWorks.length === 0 ? <p>没有匹配的项目</p> : null}
            </div>
          </div>
        ) : null}
        {picker === 'project' && selectedWork ? (
          <div className="nori-canvas-hub-project-menu nori-canvas-hub-project-picker-menu">
            <header><strong>{selectedWork.name} · 作品</strong><span>{workProjects.length} 个</span></header>
            <label><AppIcon name="search" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索作品" autoFocus /></label>
            <div>
              {visibleProjects.map((project) => (
                <button type="button" key={project.id} onClick={() => onSelect(project.id)}>
                  <span>{project.name}</span><small>进入画布列表</small>
                </button>
              ))}
              {visibleProjects.length === 0 ? <p>{workProjects.length ? '没有匹配的作品' : '该项目下暂无作品'}</p> : null}
            </div>
            {canCreateProjects && selectedWork.id !== UNASSIGNED_WORK_ID ? (
              <div className="nori-canvas-hub-menu-actions">
                <Link href={createProjectHref(selectedWork.id)} data-testid="global-canvas-create-project"><AppIcon name="plus" />在此项目中新建作品</Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="nori-canvas-hub-content">
        <section className="nori-canvas-hub-message">
          <i><AppIcon name="monitor" /></i>
          <h1>{loading ? '正在加载项目' : error ? '项目加载失败' : !works.length ? (canCreateProjects ? '暂无可用项目' : '暂无已分配作品') : selectedWork ? '选择作品进入画布' : '进入无限画布'}</h1>
          <p>{loading
            ? '正在读取当前账号可以访问的项目、作品与画布…'
            : error
              ? error
              : !works.length
                ? canCreateProjects
                  ? '请先在“我的项目”中创建项目和作品，再进入无限画布。'
                  : '当前账号尚未分配可访问的项目或作品，请联系管理账号完成分配。'
                : selectedWork
                  ? `已选择项目「${selectedWork.name}」，可直接从下方作品进入画布。`
                  : '直接选择一个作品进入画布，或先按项目筛选作品。'}</p>
          {error ? <button type="button" onClick={onRetry}><AppIcon name="refresh" />重新加载</button> : !works.length ? <Link href={{ pathname: '/projects' }}><AppIcon name="folder" />{canCreateProjects ? '创建或管理项目' : '查看我的项目'}</Link> : selectedWork ? <button type="button" onClick={() => togglePicker('project')}><AppIcon name="folderOpen" />选择作品</button> : <button type="button" onClick={() => togglePicker('work')}><AppIcon name="folderOpen" />按项目筛选</button>}
        </section>

        {!loading && !error && directProjects.length > 0 ? (
          <section className="nori-canvas-hub-direct-projects" aria-label="可进入无限画布的作品">
            <header>
              <div>
                <strong>{selectedWork ? `${selectedWork.name} · 作品` : '可用作品'}</strong>
                <span>{directProjects.length} 个</span>
              </div>
              {selectedWork ? <button type="button" onClick={() => onSelectWork('')}>查看全部作品</button> : <Link href={{ pathname: '/projects' }}>管理项目</Link>}
            </header>
            <div>
              {directProjects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  data-testid="global-canvas-direct-project-entry"
                  aria-label={`进入 ${project.name} 的无限画布`}
                  onClick={() => onSelect(project.id)}
                >
                  <i><AppIcon name="clapperboard" /></i>
                  <span><strong>{project.name}</strong><small>{project.workName || '未归属项目'} · 打开或创建画布</small></span>
                  <AppIcon name="arrowRight" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {!loading && !error && selectedWork && directProjects.length === 0 ? (
          <section className="nori-canvas-hub-no-projects">
            <AppIcon name="folderOpen" />
            <span><strong>这个项目还没有作品</strong><small>创建作品后即可使用无限画布。</small></span>
            {canCreateProjects && selectedWork.id !== UNASSIGNED_WORK_ID ? <Link href={createProjectHref(selectedWork.id)}><AppIcon name="plus" />新建作品</Link> : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}

export function FosCanvasHubClient({
  initialProjectId,
  initialCanvasId,
}: {
  initialProjectId?: string
  initialCanvasId?: string
}) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [works, setWorks] = useState<CanvasWorkOption[]>([])
  const [projects, setProjects] = useState<CanvasProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const authReady = status === 'authenticated' || TEST_MODE

  useEffect(() => {
    if (!authReady) {
      if (status !== 'loading') setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void fetchAllWorks({ pageSize: 50, signal: controller.signal, fallbackErrorMessage: '加载作品失败' })
      .then((payload) => {
        const seen = new Set<string>()
        const nextWorks = payload.works.map((work) => ({
          id: work.id,
          name: work.virtual ? '未归属项目' : work.name,
          projectCount: work.projectCount,
        }))
        const nextProjects = payload.works.flatMap((work) => work.projects.flatMap((project) => {
          if (seen.has(project.id)) return []
          seen.add(project.id)
          return [{ id: project.id, name: project.name, workId: work.id, workName: work.virtual ? '未归属项目' : work.name }]
        }))
        setWorks(nextWorks)
        setProjects(nextProjects)
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return
        setWorks([])
        setProjects([])
        setError(loadError instanceof Error ? loadError.message : '加载作品失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [authReady, refreshKey, status])

  const selectedProject = projects.find((project) => project.id === initialProjectId) || null
  const requestedWorkId = searchParams?.get('work_id') || ''
  const selectedWork = works.find((work) => work.id === requestedWorkId) || null
  const selectWork = (workId: string) => {
    if (!workId) {
      router.replace('/canvas')
      return
    }
    router.replace(`/canvas?work_id=${encodeURIComponent(workId)}`)
  }
  const selectProject = (projectId: string) => router.push(`/canvas/${encodeURIComponent(projectId)}`)
  const canCreateProjects = hasAccountPermissions(session?.user || {}, ['projectCreate'])
  const selectedProjectCreateHref = canCreateProjects
    && selectedProject?.workId
    && selectedProject.workId !== UNASSIGNED_WORK_ID
    ? createProjectHref(selectedProject.workId)
    : undefined
  const navigationSurfaceKey = canvasNavigationSurfaceKey(selectedProject?.id)

  return (
    <FosShell activeKey="canvas" canvasShell={Boolean(selectedProject)} titlebarTitle={selectedProject?.name}>
      <div key={navigationSurfaceKey} className="contents">
        {selectedProject ? (
          <CanvasWorkspace
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            initialCanvasId={initialCanvasId}
            routeBase={`/canvas/${encodeURIComponent(selectedProject.id)}`}
            projectOptions={projects}
            onSelectProject={selectProject}
            canvasHomeHref="/canvas"
            createProjectHref={selectedProjectCreateHref}
          />
        ) : (
          <CanvasProjectChooser
            works={works}
            projects={projects}
            selectedWork={selectedWork}
            canCreateProjects={canCreateProjects}
            loading={loading}
            error={!loading && initialProjectId && !error ? '该作品不存在，或当前账号没有访问权限。' : error}
            onRetry={() => setRefreshKey((current) => current + 1)}
            onSelectWork={selectWork}
            onSelect={selectProject}
          />
        )}
      </div>
    </FosShell>
  )
}
