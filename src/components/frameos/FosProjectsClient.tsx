'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import {
  readStyleReferenceFailureIndex,
  submitProjectCreationWithProgress,
  type ProjectStyleReferenceProgressUpdate,
} from '@/lib/projects/create-project-request'
import { PROJECT_STYLE_REFERENCE_FIELD } from '@/lib/projects/style-reference-contract'
import { logError } from '@/lib/logging/core'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { FosShell } from './FosShell'
import { CreateProjectDialog, type CreateProjectDraft } from './CreateProjectDialog'
import { FosProjectModelConfigDialog } from './FosProjectModelConfigDialog'
import { notifyProjectChanged } from '@/lib/projects/change-client'
import { WorkPanel } from './works/FosWorkPanels'
import { fetchAllWorks } from './works/fetch-all-works'
import { filterWorksByQuery } from './works/work-search'
import {
  ConfirmActionDialog,
  CreateWorkDialog,
  MemberManagerDialog,
  MoveProjectsDialog,
  projectMemberCandidatesEndpoint,
  projectMembersEndpoint,
  ProjectCoverDialog,
  RenameDialog,
  workMemberCandidatesEndpoint,
  workMembersEndpoint,
} from './works/FosWorksDialogs'
import type { WorkProject, WorkSummary } from './works/types'
import type { RecycleBinProject, RecycleBinWork } from './works/types'

const WORKS_REQUEST_TIMEOUT_MS = 15_000
const WORKS_PAGE_SIZE = 50
const TEST_MODE = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'

type RenameTarget =
  | { kind: 'work'; work: WorkSummary }
  | { kind: 'project'; project: WorkProject }

type MemberTarget =
  | { kind: 'work'; work: WorkSummary }
  | { kind: 'project'; project: WorkProject }

type MoveTarget = { projects: WorkProject[]; work: WorkSummary }

type ConfirmTarget =
  | { kind: 'work'; work: WorkSummary }
  | { kind: 'project'; project: WorkProject }

function WorksSkeleton() {
  return (
    <div className="works-skeleton" aria-label="正在加载项目">
      {[0, 1].map((item) => (
        <div key={item} className="works-skeleton-panel">
          <div className="works-skeleton-head" />
          <div className="works-skeleton-body"><div /><div /></div>
        </div>
      ))}
    </div>
  )
}

export function FosProjectsClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const urlParams = useSearchParams()
  const [works, setWorks] = useState<WorkSummary[]>([])
  const [worksTotal, setWorksTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState(urlParams?.get('search') || '')
  const [searchQuery, setSearchQuery] = useState(urlParams?.get('search') || '')
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)
  const [batchWorkId, setBatchWorkId] = useState<string | null>(null)
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [showCreateWork, setShowCreateWork] = useState(false)
  const [createProjectWork, setCreateProjectWork] = useState<WorkSummary | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [editingProject, setEditingProject] = useState<WorkProject | null>(null)
  const [coverTarget, setCoverTarget] = useState<WorkProject | null>(null)
  const [memberTarget, setMemberTarget] = useState<MemberTarget | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [recycleOpen, setRecycleOpen] = useState(false)
  const [recycleProjects, setRecycleProjects] = useState<RecycleBinProject[]>([])
  const [recycledWorks, setRecycledWorks] = useState<RecycleBinWork[]>([])
  const [recycleLoading, setRecycleLoading] = useState(false)
  const [recycleError, setRecycleError] = useState<string | null>(null)
  const [restoringProjectId, setRestoringProjectId] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const requestSequenceRef = useRef(0)
  const requestAbortRef = useRef<AbortController | null>(null)
  const handledCreateProjectRequestRef = useRef('')

  const canCreateWorks = session?.user?.role === 'admin' || TEST_MODE
  const canCreateProjects = hasAccountPermissions(session?.user || {}, ['projectCreate']) || TEST_MODE

  useEffect(() => {
    if (status === 'loading') return
    if (!session && !TEST_MODE) router.replace({ pathname: '/auth/signin' })
  }, [router, session, status])

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 220)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!activeMenuId) return
    const close = () => setActiveMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [activeMenuId])

  const fetchWorks = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    requestAbortRef.current?.abort()
    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    const controller = new AbortController()
    requestAbortRef.current = controller
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, WORKS_REQUEST_TIMEOUT_MS)
    if (silent) setRefreshing(true)
    else setLoading(true)
    setLoadError(null)
    try {
      const normalized = await fetchAllWorks({
        pageSize: WORKS_PAGE_SIZE,
        // Keep the authoritative project directory complete. Search is a
        // display projection below, not the source for move/create actions.
        signal: controller.signal,
        fallbackErrorMessage: '获取项目失败',
      })
      if (requestSequenceRef.current !== requestId) return
      setWorks(normalized.works)
      setWorksTotal(normalized.pagination.total)
    } catch (error) {
      if (requestSequenceRef.current !== requestId) return
      if (controller.signal.aborted && !timedOut) return
      logError('[FosProjectsClient] 获取项目失败', error)
      setLoadError(timedOut
        ? '加载项目超时，请检查网络或服务状态后重试。'
        : error instanceof Error && error.message
          ? `加载项目失败：${error.message}`
          : '加载项目失败，请稍后重试。')
    } finally {
      window.clearTimeout(timeoutId)
      if (requestSequenceRef.current === requestId) {
        requestAbortRef.current = null
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => () => {
    requestSequenceRef.current += 1
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
  }, [])

  const sessionUserId = session?.user?.id
  useEffect(() => {
    if (sessionUserId) void fetchWorks()
    else if (TEST_MODE && status !== 'loading') setLoading(false)
  }, [fetchWorks, sessionUserId, status])

  useEffect(() => {
    const requested = urlParams?.get('create_work') === '1' || urlParams?.get('create_project') === '1'
    const requestedWorkId = urlParams?.get('parent_project_id')?.trim() || urlParams?.get('work_id')?.trim() || ''
    if (!requested) {
      handledCreateProjectRequestRef.current = ''
      return
    }
    if (!requestedWorkId || loading || status === 'loading') return
    const requestKey = `${requestedWorkId}:${urlParams?.toString() || ''}`
    if (handledCreateProjectRequestRef.current === requestKey) return
    handledCreateProjectRequestRef.current = requestKey

    const requestedWork = works.find((work) => work.id === requestedWorkId && !work.virtual)
    if (!requestedWork) {
      setActionError('目标项目不存在，或当前账号没有访问权限。')
    } else if (!requestedWork.canCreateProjects) {
      setActionError('当前账号没有在该项目中新建作品的权限。')
    } else {
      setActionError(null)
      setCreateProjectWork(requestedWork)
    }

    const remainingParams = new URLSearchParams(urlParams?.toString() || '')
    remainingParams.delete('create_project')
    remainingParams.delete('work_id')
    remainingParams.delete('create_work')
    remainingParams.delete('parent_project_id')
    const query = remainingParams.toString()
    router.replace(query ? `/projects?${query}` : '/projects')
  }, [loading, router, status, urlParams, works])

  const visibleWorks = useMemo(() => filterWorksByQuery(works, searchQuery), [searchQuery, works])
  const allProjectNames = useMemo(() => works.flatMap((work) => work.projects.map((project) => project.name)), [works])
  const clearSearch = useCallback(() => {
    setSearchInput('')
    setSearchQuery('')
  }, [])

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setActionBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败'
      setActionError(message)
      throw error
    } finally {
      setActionBusy(false)
    }
  }, [])

  const createWork = async (input: { name: string; memberUserIds: string[] }) => runAction(async () => {
    const response = await apiFetch('/api/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '创建项目失败'))
    setShowCreateWork(false)
    await fetchWorks({ silent: true })
  })

  const createProject = async (
    draft: CreateProjectDraft,
    setProgress: (message: string) => void,
    onStyleReferenceProgress: (update: ProjectStyleReferenceProgressUpdate) => void,
  ): Promise<boolean> => {
    if (!createProjectWork) throw new Error('未选择项目')
    setProgress(
      draft.scriptFile || draft.importedScriptText?.trim()
        ? '导入剧本并创建作品…'
        : draft.initializeEpisodeRange
          ? '创建作品和空白剧集…'
          : '创建空白作品…',
    )
    const form = new FormData()
    form.set('name', draft.name.trim())
    form.set('parentProjectId', createProjectWork.id)
    form.set('workId', createProjectWork.id)
    form.set('collaborationMode', draft.collaborationMode)
    form.set('projectLevel', draft.projectLevel)
    form.set('contentType', draft.projectType)
    form.set('projectStyle', draft.projectStyle)
    form.set('materialType', draft.materialType)
    form.set('targetEpisodeCount', String(draft.targetEpisodeCount))
    form.set('targetAudience', draft.targetAudience)
    form.set('videoRatio', draft.videoRatio)
    form.set('videoResolution', draft.videoResolution)
    form.set('episodeDurationMode', draft.episodeDurationMode)
    form.set('episodeDurationValue', String(draft.episodeDurationValue))
    form.set('targetEpisodeDurationSeconds', String(draft.episodeDurationValue))
    if (draft.artStylePrompt.trim()) form.set('customArtStylePrompt', draft.artStylePrompt.trim())
    if (draft.referenceArtStylePrompt.trim()) form.set('referenceArtStylePrompt', draft.referenceArtStylePrompt.trim())
    if (draft.collaborationMode === 'team') {
      if (draft.writerAssigneeUserId) form.set('writerAssigneeUserId', draft.writerAssigneeUserId)
      if (draft.assetAssigneeUserId) form.set('assetAssigneeUserId', draft.assetAssigneeUserId)
      if (draft.storyboardAssigneeUserId) form.set('storyboardAssigneeUserId', draft.storyboardAssigneeUserId)
    }
    if (draft.scriptFile) form.set('scriptFile', draft.scriptFile)
    if (draft.importedScriptText?.trim()) {
      form.set('initialNovelText', draft.importedScriptText.trim())
      form.set('initialEpisodeName', draft.importedScriptTitle?.trim() || '第 1 集')
    }
    if (draft.initializeEpisodeRange) {
      form.set('initialEpisodeStart', String(draft.initialEpisodeStart))
      form.set('initialEpisodeEnd', String(draft.initialEpisodeEnd))
    }
    for (const reference of draft.styleReferenceFiles) {
      form.append(PROJECT_STYLE_REFERENCE_FIELD, reference.file, reference.file.name)
    }
    if (draft.styleReferenceFiles.length > 0) {
      setProgress(`上传 ${draft.styleReferenceFiles.length} 个画风参考…`)
    }
    const response = draft.styleReferenceFiles.length > 0
      ? await submitProjectCreationWithProgress({
        form,
        references: draft.styleReferenceFiles,
        onProgress: onStyleReferenceProgress,
      })
      : await apiFetch('/api/projects', { method: 'POST', body: form })
    if (!response.ok) {
      const errorPayload = await response.clone().json().catch(() => null) as {
        error?: { message?: string }
        message?: string
      } | null
      const failedIndex = readStyleReferenceFailureIndex(errorPayload)
      if (failedIndex != null) {
        const failedReference = draft.styleReferenceFiles[failedIndex]
        if (failedReference) {
          onStyleReferenceProgress({
            id: failedReference.id,
            progress: 0,
            status: 'failed',
            error: errorPayload?.error?.message || errorPayload?.message || '上传失败',
          })
        }
      }
      throw new Error(await readApiErrorMessage(response, '创建作品失败'))
    }
    const payload = await response.json() as { work?: { id?: string }; project?: { id?: string } }
    const projectId = payload.work?.id || payload.project?.id
    if (!projectId) throw new Error('创建作品失败：服务未返回作品 ID')
    setProgress('进入工作台…')
    setCreateProjectWork(null)
    router.push({ pathname: `/workflow/${projectId}/workbench-premium2` })
    return true
  }

  const saveRename = async (name: string) => {
    if (!renameTarget) return
    await runAction(async () => {
      const endpoint = renameTarget.kind === 'work'
        ? `/api/works/${encodeURIComponent(renameTarget.work.id)}`
        : `/api/projects/${encodeURIComponent(renameTarget.project.id)}`
      const response = await apiFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '重命名失败'))
      if (renameTarget.kind === 'project') notifyProjectChanged(renameTarget.project.id)
      setRenameTarget(null)
      setActiveMenuId(null)
      await fetchWorks({ silent: true })
    })
  }

  const moveProjects = async (targetWorkId: string) => {
    if (!moveTarget) return
    await runAction(async () => {
      const response = await apiFetch('/api/works/projects/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workIds: moveTarget.projects.map((project) => project.id), targetProjectId: targetWorkId,
          projectIds: moveTarget.projects.map((project) => project.id), targetWorkId,
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '移动作品失败'))
      setMoveTarget(null)
      setBatchWorkId(null)
      setSelectedProjectIds([])
      setActiveMenuId(null)
      await fetchWorks({ silent: true })
    })
  }

  const confirmDelete = async () => {
    if (!confirmTarget) return
    await runAction(async () => {
      const endpoint = confirmTarget.kind === 'work'
        ? `/api/works/${encodeURIComponent(confirmTarget.work.id)}`
        : `/api/projects/${encodeURIComponent(confirmTarget.project.id)}`
      const response = await apiFetch(endpoint, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除失败'))
      setConfirmTarget(null)
      setActiveMenuId(null)
      await fetchWorks({ silent: true })
    })
  }

  const loadRecycleBin = useCallback(async () => {
    setRecycleLoading(true)
    setRecycleError(null)
    try {
      const response = await apiFetch('/api/projects/recycle-bin', { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载回收站失败'))
      const payload = await response.json() as { projects?: RecycleBinProject[]; works?: RecycleBinWork[] }
      setRecycleProjects(Array.isArray(payload.projects) ? payload.projects : [])
      setRecycledWorks(Array.isArray(payload.works) ? payload.works : [])
    } catch (error) {
      setRecycleError(error instanceof Error ? error.message : '加载回收站失败')
    } finally {
      setRecycleLoading(false)
    }
  }, [])

  const openRecycleBin = () => {
    setRecycleOpen(true)
    void loadRecycleBin()
  }

  const restoreProject = async (projectId: string) => {
    setRestoringProjectId(projectId)
    setRecycleError(null)
    try {
      const response = await apiFetch(`/api/projects/recycle-bin/${encodeURIComponent(projectId)}/restore`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '恢复作品失败'))
      setRecycleProjects((current) => current.filter((project) => project.id !== projectId))
      await fetchWorks({ silent: true })
    } catch (error) {
      setRecycleError(error instanceof Error ? error.message : '恢复作品失败')
    } finally {
      setRestoringProjectId(null)
    }
  }

  const restoreWork = async (workId: string) => {
    setRestoringProjectId(workId)
    setRecycleError(null)
    try {
      const response = await apiFetch(`/api/works/recycle-bin/${encodeURIComponent(workId)}/restore`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '恢复项目失败'))
      await loadRecycleBin()
      await fetchWorks({ silent: true })
    } catch (error) {
      setRecycleError(error instanceof Error ? error.message : '恢复项目失败')
    } finally {
      setRestoringProjectId(null)
    }
  }

  if (status === 'loading' || (!session && !TEST_MODE)) {
    return <div className="fos-app"><div className="fos-loading">加载中…</div></div>
  }

  return (
    <FosShell activeKey="projects">
      <div className="fos-scroll works-scroll">
        <section className="works-view">
          <header className="works-view-header">
            <div className="works-heading">
              <h1 className="works-view-title">我的项目</h1>
              {canCreateWorks ? (
                <button type="button" className="works-create-work" onClick={() => setShowCreateWork(true)}>
                  <AppIcon name="plus" />新建项目
                </button>
              ) : null}
              <button type="button" className="works-recycle-trigger" onClick={openRecycleBin}>
                <AppIcon name="trash" />回收站
              </button>
              {refreshing ? <span className="works-refreshing"><AppIcon name="loader" className="animate-spin" />正在刷新</span> : null}
            </div>
            <div className="works-search-group">
              <span>{worksTotal} 个项目</span>
              <label className="works-search">
                <AppIcon name="search" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    event.stopPropagation()
                    clearSearch()
                  }}
                  placeholder="搜索项目或作品…"
                  aria-label="搜索项目或作品"
                />
                {searchInput ? <button type="button" onClick={clearSearch} aria-label="清除搜索"><AppIcon name="close" /></button> : null}
              </label>
            </div>
          </header>

          {actionError ? (
            <div className="works-action-error" role="alert">
              <AppIcon name="alert" />
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)}><AppIcon name="close" /></button>
            </div>
          ) : null}

          {loading ? <WorksSkeleton /> : loadError ? (
            <div className="works-state-card is-error" role="alert" data-testid="project-list-error">
              <span><AppIcon name="alert" /></span>
              <h2>项目加载失败</h2>
              <p>{loadError}</p>
              <button type="button" className="fos-btn fos-btn-primary" data-testid="project-list-retry" onClick={() => void fetchWorks()}><AppIcon name="refresh" />重新加载</button>
            </div>
          ) : visibleWorks.length === 0 ? searchQuery ? (
            <div className="works-search-empty" data-testid="project-list-empty">
              没有匹配「{searchQuery}」的项目或作品
            </div>
          ) : (
            <div className="works-state-card" data-testid="project-list-empty">
              <span><AppIcon name="folderOpen" /></span>
              <h2>暂无项目</h2>
              <p>{canCreateWorks ? '创建第一个项目，再向其中添加作品。' : '管理员还没有为当前工作区创建项目。'}</p>
              {canCreateWorks ? <button type="button" className="fos-btn fos-btn-primary" data-testid="project-list-empty-create" onClick={() => setShowCreateWork(true)}><AppIcon name="plus" />新建项目</button> : null}
            </div>
          ) : (
            <div className="works-panel-list">
              {visibleWorks.map((work) => (
                <WorkPanel
                  key={work.id}
                  work={work}
                  keyword={searchQuery}
                  activeMenuId={activeMenuId}
                  batchWorkId={batchWorkId}
                  selectedProjectIds={batchWorkId === work.id ? selectedProjectIds : []}
                  canCreateProjects={Boolean(work.canCreateProjects && canCreateProjects)}
                  onMenuChange={setActiveMenuId}
                  onBatchWorkChange={(id) => { setBatchWorkId(id); setSelectedProjectIds([]) }}
                  onSelectedProjectIdsChange={setSelectedProjectIds}
                  workActions={{
                    createProject: setCreateProjectWork,
                    rename: (target) => { setRenameTarget({ kind: 'work', work: target }); setActiveMenuId(null) },
                    members: (target) => { setMemberTarget({ kind: 'work', work: target }); setActiveMenuId(null) },
                    delete: (target) => { setConfirmTarget({ kind: 'work', work: target }); setActiveMenuId(null) },
                    moveSelected: (projects, sourceWork) => setMoveTarget({ projects, work: sourceWork }),
                  }}
                  projectActions={{
                    edit: (target) => { setEditingProject(target); setActiveMenuId(null) },
                    cover: (target) => { setCoverTarget(target); setActiveMenuId(null) },
                    rename: (target) => { setRenameTarget({ kind: 'project', project: target }); setActiveMenuId(null) },
                    members: (target) => { setMemberTarget({ kind: 'project', project: target }); setActiveMenuId(null) },
                    move: (target, sourceWork) => { setMoveTarget({ projects: [target], work: sourceWork }); setActiveMenuId(null) },
                    delete: (target) => { setConfirmTarget({ kind: 'project', project: target }); setActiveMenuId(null) },
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {showCreateWork ? (
        <CreateWorkDialog
          busy={actionBusy}
          existingNames={works.map((work) => work.name)}
          onClose={() => setShowCreateWork(false)}
          onCreate={createWork}
        />
      ) : null}
      {createProjectWork ? (
        <CreateProjectDialog
          workName={createProjectWork.name}
          onClose={() => setCreateProjectWork(null)}
          onCreate={createProject}
        />
      ) : null}
      {renameTarget ? (
        <RenameDialog
          kind={renameTarget.kind === 'work' ? '项目' : '作品'}
          initialName={renameTarget.kind === 'work' ? renameTarget.work.name : renameTarget.project.name}
          busy={actionBusy}
          duplicate={renameTarget.kind === 'work'
            ? (name) => works.some((work) => work.id !== renameTarget.work.id && work.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
            : (name) => allProjectNames.some((projectName) => projectName !== renameTarget.project.name && projectName.trim().toLocaleLowerCase() === name.toLocaleLowerCase())}
          onClose={() => setRenameTarget(null)}
          onSave={saveRename}
        />
      ) : null}
      {editingProject ? <FosProjectModelConfigDialog
        projectId={editingProject.id}
        open
        onClose={() => setEditingProject(null)}
        onSaved={() => void fetchWorks({ silent: true })}
      /> : null}
      {coverTarget ? <ProjectCoverDialog
        project={coverTarget}
        onClose={() => setCoverTarget(null)}
        onChanged={() => void fetchWorks({ silent: true })}
      /> : null}
      {memberTarget ? memberTarget.kind === 'work' ? (
        <MemberManagerDialog
          title={`${memberTarget.work.canManage ? '设置' : '查看'}项目成员 · ${memberTarget.work.name}`}
          endpoint={workMembersEndpoint(memberTarget.work.id)}
          candidatesPath={workMemberCandidatesEndpoint(memberTarget.work.id)}
          readOnly={!memberTarget.work.canManage}
          onClose={() => setMemberTarget(null)}
          onChanged={() => void fetchWorks({ silent: true })}
        />
      ) : (
        <MemberManagerDialog
          title={`${memberTarget.project.canManage ? '设置' : '查看'}作品协作者 · ${memberTarget.project.name}`}
          endpoint={projectMembersEndpoint(memberTarget.project.id)}
          candidatesPath={projectMemberCandidatesEndpoint(memberTarget.project.id)}
          readOnly={!memberTarget.project.canManage}
          onClose={() => setMemberTarget(null)}
          onChanged={() => void fetchWorks({ silent: true })}
        />
      ) : null}
      {moveTarget ? (
        <MoveProjectsDialog
          projects={moveTarget.projects}
          sourceWorkId={moveTarget.work.id}
          works={works}
          busy={actionBusy}
          onClose={() => setMoveTarget(null)}
          onMove={moveProjects}
        />
      ) : null}
      {confirmTarget ? (
        <ConfirmActionDialog
          title={confirmTarget.kind === 'work' ? '删除项目' : '删除作品'}
          description={confirmTarget.kind === 'work'
            ? `确定删除项目「${confirmTarget.work.name}」吗？项目及其中 ${confirmTarget.work.projectCount} 个作品会一起移入回收站，15 天内可恢复，不会立即清除素材。`
            : `确定删除作品「${confirmTarget.project.name}」吗？作品会移入回收站，15 天内可恢复。`}
          confirmLabel="确认删除"
          danger
          busy={actionBusy}
          onClose={() => setConfirmTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
      {recycleOpen ? (
        <div className="fos-overlay works-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !restoringProjectId) setRecycleOpen(false) }}>
          <section className="fos-dialog works-dialog" style={{ maxWidth: 720 }} role="dialog" aria-modal="true" aria-label="作品回收站">
            <header className="fos-dialog-head">
              <div>
                <h2 className="fos-dialog-title">作品回收站</h2>
                <p className="works-recycle-subtitle">已删除作品保留 15 天，到期后自动彻底清理。</p>
              </div>
              <button type="button" className="fos-dialog-x" disabled={Boolean(restoringProjectId)} onClick={() => setRecycleOpen(false)} aria-label="关闭"><AppIcon name="close" /></button>
            </header>
            <div className="works-dialog-body">
              {recycleError ? <div className="works-form-error">{recycleError}</div> : null}
              {!recycleLoading && recycledWorks.length > 0 ? <div className="works-recycle-list">
                {recycledWorks.map((work) => <article key={work.id} className="works-recycle-item">
                  <div><strong>项目 · {work.name}</strong><small>恢复项目及本次随项目删除的作品；原先已删除的作品仍留在回收站。</small></div>
                  <div><span>{work.expired ? '已到期' : '15 天内可恢复'}</span><button type="button" className="fos-btn fos-btn-primary" disabled={work.expired || restoringProjectId === work.id} onClick={() => void restoreWork(work.id)}>{restoringProjectId === work.id ? '恢复中…' : '恢复整个项目'}</button></div>
                </article>)}
              </div> : null}
              {recycleLoading ? <div className="works-recycle-state">正在加载回收站…</div> : recycleProjects.length === 0 && recycledWorks.length === 0 ? <div className="works-recycle-state">回收站为空</div> : recycleProjects.length > 0 ? (
                <div className="works-recycle-list">
                  {recycleProjects.map((project) => (
                    <article key={project.id} className="works-recycle-item">
                      <div>
                        <strong>{project.name}</strong>
                        <small>{project.workName || '未归属项目'} · 删除于 {project.deletedAt ? new Date(project.deletedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—'}</small>
                      </div>
                      <div>
                        <span>{project.expired ? '已到期' : `剩 ${project.remainingDays ?? 0} 天`}</span>
                        <button type="button" className="fos-btn fos-btn-primary" disabled={project.expired || restoringProjectId === project.id} onClick={() => void restoreProject(project.id)}>
                          {restoringProjectId === project.id ? '恢复中…' : '恢复'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </FosShell>
  )
}
