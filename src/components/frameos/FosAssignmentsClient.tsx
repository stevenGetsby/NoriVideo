'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { logError } from '@/lib/logging/core'
import { FosShell } from './FosShell'
import {
  AssignmentDetailDrawer,
  AssignmentFilterSelect,
  AssignmentReviewDialog,
  type AssignmentReviewMode,
} from './FosAssignmentControls'
import { FosAssignmentsTable } from './FosAssignmentsTable'
import { fetchAllWorks } from './works/fetch-all-works'
import {
  ASSIGNMENT_STAGE_LABELS,
  ASSIGNMENT_TABS,
  assignmentCountForTab,
  assignmentDestination,
  assignmentNavigationQuery,
  assignmentNavigationBlockReason,
  isAssignmentTab,
  moveAssignmentTabIndex,
  resolveDefaultAssignmentTab,
  type AssignmentCounts,
  type AssignmentStage,
  type AssignmentTab,
  type CollaborationAssignment,
  type VideoReviewAnnotationDraft,
} from './assignments-view-model'

interface WorkProjectDto {
  id: string
  name: string
  description?: string | null
  createdAt?: string
  updatedAt?: string
  workId?: string | null
}

interface WorkDto {
  id: string
  name: string
  projects?: WorkProjectDto[]
}

interface AssignmentListResponse {
  assignments?: CollaborationAssignment[]
  total?: number
  page?: number
  pageSize?: number
  showPendingReviewTab?: boolean
}

interface AssignmentCountsResponse {
  counts?: Partial<AssignmentCounts>
  showPendingReviewTab?: boolean
}

interface AssignmentNavigationResponse {
  assignment?: { episodeId?: string | null }
}

interface WorkOption {
  value: string
  label: string
  projects: Array<{ value: string; label: string }>
  unassigned?: boolean
}

interface ToastState {
  id: number
  tone: 'success' | 'error' | 'warning'
  message: string
}

type AssignmentAction = 'submit' | 'mark-complete' | 'approve' | 'reject'

const PAGE_SIZE = 10
const REQUEST_TIMEOUT_MS = 15_000
const UNASSIGNED_WORK_ID = '__unassigned__'
const TEST_MODE = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'
const EMPTY_COUNTS: AssignmentCounts = { todo: 0, inReview: 0, done: 0, pendingReview: 0 }

function unwrapPayload<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

function finiteCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(await readApiErrorMessage(response, fallback))
  return unwrapPayload<T>(await response.json())
}

export function FosAssignmentsClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const routeTab = searchParams?.get('tab')
  const hasExplicitTab = isAssignmentTab(routeTab)
  const initialTab: AssignmentTab = resolveDefaultAssignmentTab({
    routeTab,
    role: session?.user?.role,
  })
  const authReady = status === 'authenticated' || TEST_MODE

  const [activeTab, setActiveTab] = useState<AssignmentTab>(initialTab)
  const [showPendingReviewTab, setShowPendingReviewTab] = useState(initialTab === 'pending_review')
  const [countsReady, setCountsReady] = useState(false)
  const [counts, setCounts] = useState<AssignmentCounts>(EMPTY_COUNTS)
  const [countsError, setCountsError] = useState<string | null>(null)
  const [works, setWorks] = useState<WorkDto[]>([])
  const [unassignedProjects, setUnassignedProjects] = useState<WorkProjectDto[]>([])
  const [worksLoading, setWorksLoading] = useState(true)
  const [worksError, setWorksError] = useState<string | null>(null)
  const [worksRefreshToken, setWorksRefreshToken] = useState(0)
  const [workId, setWorkId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [stage, setStage] = useState<AssignmentStage | ''>('')
  const [pages, setPages] = useState<Record<AssignmentTab, number>>({ todo: 1, in_review: 1, done: 1, pending_review: 1 })
  const [assignments, setAssignments] = useState<CollaborationAssignment[]>([])
  const [total, setTotal] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedAssignment, setSelectedAssignment] = useState<CollaborationAssignment | null>(null)
  const [reviewState, setReviewState] = useState<{ assignment: CollaborationAssignment; mode: AssignmentReviewMode } | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)
  const [navigationId, setNavigationId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [toast, setToast] = useState<ToastState | null>(null)

  const currentPage = pages[activeTab]

  const workOptions = useMemo<WorkOption[]>(() => {
    const result: WorkOption[] = works.flatMap((work) => {
      const projects = (work.projects ?? []).map((project) => ({ value: project.id, label: project.name }))
      // FrameOS builds this filter from the active project list, so a work
      // without a selectable project is intentionally absent here.
      return projects.length > 0 ? [{ value: work.id, label: work.name, projects }] : []
    })
    if (unassignedProjects.length > 0) {
      result.push({
        value: UNASSIGNED_WORK_ID,
        label: '未归属作品',
        projects: unassignedProjects.map((project) => ({ value: project.id, label: project.name })),
        unassigned: true,
      })
    }
    const byId = new Map(result.map((work) => [work.value, work]))
    assignments.forEach((assignment) => {
      const fallbackWorkId = assignment.workId || UNASSIGNED_WORK_ID
      let work = byId.get(fallbackWorkId)
      if (!work) {
        const fallbackWork: WorkOption = {
          value: fallbackWorkId,
          label: assignment.workName || '未归属作品',
          projects: [],
          unassigned: !assignment.workId,
        }
        work = fallbackWork
        byId.set(fallbackWorkId, fallbackWork)
        result.push(fallbackWork)
      }
      if (assignment.projectId && !work.projects.some((project) => project.value === assignment.projectId)) {
        work.projects.push({ value: assignment.projectId, label: assignment.projectName || assignment.projectId })
      }
    })
    result.sort((left, right) => {
      if (left.unassigned) return 1
      if (right.unassigned) return -1
      return left.label.localeCompare(right.label, 'zh-CN')
    })
    result.forEach((work) => work.projects.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')))
    return result
  }, [assignments, unassignedProjects, works])

  const selectedWork = workOptions.find((work) => work.value === workId)
  const projectOptions = selectedWork?.projects ?? []

  const filterQuery = useMemo(() => {
    const query = new URLSearchParams()
    if (projectId) {
      query.set('projectId', projectId)
    } else if (workId === UNASSIGNED_WORK_ID) {
      const ids = selectedWork?.projects.map((project) => project.value).filter(Boolean) ?? []
      if (ids.length > 0) query.set('projectIds', ids.join(','))
    } else if (workId) {
      query.set('workId', workId)
    }
    if (stage) query.set('stage', stage)
    return query
  }, [projectId, selectedWork, stage, workId])
  const filterSignature = filterQuery.toString()

  const visibleTabs = useMemo(
    () => ASSIGNMENT_TABS.filter((tab) => tab.key !== 'pending_review' || showPendingReviewTab),
    [showPendingReviewTab],
  )

  const showToast = useCallback((tone: ToastState['tone'], message: string) => {
    setToast({ id: Date.now(), tone, message })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 3_000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!selectedAssignment && !reviewState) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (reviewState && !actionId) setReviewState(null)
      else if (selectedAssignment) setSelectedAssignment(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [actionId, reviewState, selectedAssignment])

  useEffect(() => {
    if (!authReady) {
      if (status !== 'loading') setWorksLoading(false)
      return
    }
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS)
    setWorksLoading(true)
    setWorksError(null)
    void fetchAllWorks({
      pageSize: 50,
      signal: controller.signal,
      fallbackErrorMessage: '加载作品失败',
    })
      .then((payload) => {
        const unassigned = payload.works.find((work) => work.virtual || work.id === UNASSIGNED_WORK_ID)
        setWorks(payload.works.filter((work) => !work.virtual && work.id !== UNASSIGNED_WORK_ID))
        setUnassignedProjects(unassigned?.projects ?? [])
      })
      .catch((error) => {
        if (controller.signal.aborted && !timedOut) return
        logError('[FosAssignmentsClient] 获取作品筛选失败', error)
        setWorksError(timedOut ? '作品筛选加载超时' : error instanceof Error ? error.message : '作品筛选加载失败')
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (!controller.signal.aborted || timedOut) setWorksLoading(false)
      })
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [authReady, status, worksRefreshToken])

  useEffect(() => {
    if (!authReady) return
    const refreshVisibleAssignments = () => {
      if (document.visibilityState === 'visible') setRefreshToken((value) => value + 1)
    }
    const timer = window.setInterval(refreshVisibleAssignments, 15_000)
    window.addEventListener('focus', refreshVisibleAssignments)
    document.addEventListener('visibilitychange', refreshVisibleAssignments)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisibleAssignments)
      document.removeEventListener('visibilitychange', refreshVisibleAssignments)
    }
  }, [authReady])

  useEffect(() => {
    if (!authReady) {
      if (status !== 'loading') setListLoading(false)
      return
    }
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS)
    const query = new URLSearchParams(filterSignature)
    setCountsError(null)
    void apiFetch(`/api/collaboration/assignments/counts${query.size ? `?${query}` : ''}`, { signal: controller.signal })
      .then((response) => readJson<AssignmentCountsResponse>(response, '加载任务计数失败'))
      .then((payload) => {
        setCounts({
          todo: finiteCount(payload.counts?.todo),
          inReview: finiteCount(payload.counts?.inReview),
          done: finiteCount(payload.counts?.done),
          pendingReview: finiteCount(payload.counts?.pendingReview),
        })
        setShowPendingReviewTab(payload.showPendingReviewTab === true)
        setCountsReady(true)
      })
      .catch((error) => {
        if (controller.signal.aborted && !timedOut) return
        logError('[FosAssignmentsClient] 获取任务计数失败', error)
        setCountsError(timedOut ? '任务计数加载超时' : error instanceof Error ? error.message : '任务计数加载失败')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [authReady, filterSignature, refreshToken, status])

  useEffect(() => {
    if (!authReady) return
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS)
    const query = new URLSearchParams(filterSignature)
    query.set('page', String(currentPage))
    query.set('pageSize', String(PAGE_SIZE))
    if (activeTab !== 'pending_review') query.set('tab', activeTab)
    const endpoint = activeTab === 'pending_review'
      ? '/api/collaboration/assignments/pending-review'
      : '/api/collaboration/assignments/my'
    setListLoading(true)
    setListError(null)
    void apiFetch(`${endpoint}?${query}`, { signal: controller.signal })
      .then((response) => readJson<AssignmentListResponse>(response, '加载任务失败'))
      .then((payload) => {
        const nextAssignments = Array.isArray(payload.assignments) ? payload.assignments : []
        const listTotal = finiteCount(payload.total)
        const lastPage = Math.max(1, Math.ceil(listTotal / PAGE_SIZE))
        setTotal(listTotal)
        if (typeof payload.showPendingReviewTab === 'boolean') setShowPendingReviewTab(payload.showPendingReviewTab)
        setCounts((current) => {
          if (activeTab === 'in_review') return { ...current, inReview: listTotal }
          if (activeTab === 'pending_review') return { ...current, pendingReview: listTotal }
          return { ...current, [activeTab]: listTotal }
        })
        if (currentPage > lastPage) {
          setPages((current) => ({ ...current, [activeTab]: lastPage }))
          return
        }
        setAssignments(nextAssignments)
      })
      .catch((error) => {
        if (controller.signal.aborted && !timedOut) return
        logError('[FosAssignmentsClient] 获取任务失败', error)
        setAssignments([])
        setTotal(0)
        setListError(timedOut ? '加载任务超时，请稍后重试。' : error instanceof Error ? error.message : '加载任务失败，请稍后重试。')
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (!controller.signal.aborted || timedOut) setListLoading(false)
      })
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [activeTab, authReady, currentPage, filterSignature, refreshToken])

  useEffect(() => {
    if (hasExplicitTab) return
    const nextTab = resolveDefaultAssignmentTab({
      role: session?.user?.role,
      showPendingReviewTab: countsReady ? showPendingReviewTab : undefined,
      pendingReviewCount: countsReady ? counts.pendingReview : undefined,
    })
    if (nextTab === activeTab) return
    setActiveTab(nextTab)
    router.replace({ pathname: '/my-assignments', query: { tab: nextTab } })
  }, [activeTab, counts.pendingReview, countsReady, hasExplicitTab, router, session?.user?.role, showPendingReviewTab])

  useEffect(() => {
    if (!countsReady || activeTab !== 'pending_review' || showPendingReviewTab) return
    setActiveTab('todo')
    router.replace({ pathname: '/my-assignments', query: { tab: 'todo' } })
  }, [activeTab, countsReady, router, showPendingReviewTab])

  const resetPages = useCallback(() => {
    setPages({ todo: 1, in_review: 1, done: 1, pending_review: 1 })
  }, [])

  const retryFilterData = () => {
    if (worksError) setWorksRefreshToken((current) => current + 1)
    if (countsError) setRefreshToken((current) => current + 1)
  }

  const changeTab = (tab: AssignmentTab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    router.replace({ pathname: '/my-assignments', query: { tab } })
  }

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, tab: AssignmentTab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = visibleTabs.findIndex((candidate) => candidate.key === tab)
    const nextIndex = moveAssignmentTabIndex(
      currentIndex,
      visibleTabs.length,
      event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
    )
    const nextTab = visibleTabs[nextIndex]?.key
    if (!nextTab) return
    changeTab(nextTab)
    window.requestAnimationFrame(() => document.getElementById(`assignment-tab-${nextTab}`)?.focus())
  }

  const navigateToAssignment = useCallback(async (assignment: CollaborationAssignment) => {
    if (navigationId) return
    const blocked = assignmentNavigationBlockReason(assignment)
    if (blocked) { showToast('warning', blocked); return }
    const intent = activeTab === 'todo' ? 'work' : activeTab === 'pending_review' ? 'review' : 'view'
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    setNavigationId(assignment.id)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${assignment.id}/navigation?intent=${intent}`, {
        signal: controller.signal,
      })
      const navigation = await readJson<AssignmentNavigationResponse>(response, '任务暂时无法进入')
      setSelectedAssignment(null)
      router.push({
        pathname: assignmentDestination(assignment),
        query: assignmentNavigationQuery(assignment, activeTab, navigation.assignment?.episodeId),
      })
    } catch (error) {
      showToast('warning', controller.signal.aborted ? '任务校验超时，请稍后重试。' : error instanceof Error ? error.message : '任务暂时无法进入')
    } finally {
      window.clearTimeout(timeout)
      setNavigationId(null)
    }
  }, [activeTab, navigationId, router, showToast])

  const runAction = useCallback(async (
    action: AssignmentAction,
    assignment: CollaborationAssignment,
    note?: string,
    videoAnnotations?: VideoReviewAnnotationDraft[],
  ): Promise<boolean> => {
    if (actionId) return false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    setActionId(assignment.id)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: assignment.id,
          ...(note ? { note } : {}),
          ...(videoAnnotations ? {
            videoAnnotations: videoAnnotations.map(({ panelId, startMs, endMs, note: annotationNote }) => ({
              panelId: panelId || null,
              startMs,
              endMs,
              note: annotationNote,
            })),
          } : {}),
        }),
        signal: controller.signal,
      })
      await readJson<unknown>(response, '任务操作失败')
      showToast('success', '操作成功')
      setRefreshToken((current) => current + 1)
      return true
    } catch (error) {
      const message = controller.signal.aborted ? '操作超时，请稍后重试。' : error instanceof Error ? error.message : '操作失败，请稍后重试。'
      logError(`[FosAssignmentsClient] 任务操作 ${action} 失败`, error)
      showToast('error', message)
      return false
    } finally {
      window.clearTimeout(timeout)
      setActionId(null)
    }
  }, [actionId, showToast])

  const confirmReview = async (
    action: 'approve' | 'reject',
    note: string,
    videoAnnotations?: VideoReviewAnnotationDraft[],
  ) => {
    const current = reviewState
    if (!current) return
    const succeeded = await runAction(action, current.assignment, note, videoAnnotations)
    if (succeeded) setReviewState(null)
  }

  return (
    <FosShell activeKey="assignments">
      <section className="fa-page" data-testid="fos-assignments-page">
        <header className="fa-header">
          <div className="fa-title-group"><h1>我的任务</h1></div>
        </header>

        <div className="fa-filters">
          <div className="fa-filter-item">
            <span>作品</span>
            <AssignmentFilterSelect
              value={workId}
              placeholder="全部作品"
              searchable
              loading={worksLoading}
              options={workOptions.map((work) => ({ value: work.value, label: work.label }))}
              testId="assignment-work-filter"
              onChange={(value) => { setWorkId(value); setProjectId(''); resetPages() }}
            />
          </div>
          <div className="fa-filter-item">
            <span>项目</span>
            <AssignmentFilterSelect
              value={projectId}
              placeholder="全部项目"
              searchable
              disabled={!workId}
              loading={worksLoading}
              options={projectOptions}
              testId="assignment-project-filter"
              onChange={(value) => { setProjectId(value); resetPages() }}
            />
          </div>
          <div className="fa-filter-item">
            <span>任务类型</span>
            <AssignmentFilterSelect
              value={stage}
              placeholder="全部类型"
              options={Object.entries(ASSIGNMENT_STAGE_LABELS).map(([value, label]) => ({ value, label }))}
              testId="assignment-stage-filter"
              onChange={(value) => { setStage(value as AssignmentStage | ''); resetPages() }}
            />
          </div>
          {worksError || countsError ? (
            <button
              type="button"
              className="fa-filter-warning"
              title={[worksError, countsError].filter(Boolean).join('；')}
              onClick={retryFilterData}
            >
              <AppIcon name="alert" className="h-3.5 w-3.5" />部分筛选信息加载失败，点击重试
            </button>
          ) : null}
        </div>

        <div className="fa-tabs" role="tablist" aria-label="任务状态">
          {visibleTabs.map((tab) => {
            const count = assignmentCountForTab(counts, tab.key)
            return (
              <button
                type="button"
                role="tab"
                id={`assignment-tab-${tab.key}`}
                aria-controls={`assignment-panel-${tab.key}`}
                aria-selected={activeTab === tab.key}
                tabIndex={activeTab === tab.key ? 0 : -1}
                className={`fa-tab${activeTab === tab.key ? ' is-active' : ''}`}
                key={tab.key}
                onClick={() => changeTab(tab.key)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.key)}
              >
                <span>{tab.label}</span>
                {count > 0 ? <span className={`fa-tab-count${tab.key === 'pending_review' ? ' is-review' : ''}`}>{count}</span> : null}
              </button>
            )
          })}
        </div>

        <FosAssignmentsTable
          assignments={assignments}
          activeTab={activeTab}
          total={total}
          currentPage={currentPage}
          pageSize={PAGE_SIZE}
          loading={listLoading}
          error={listError}
          actionId={actionId}
          navigationId={navigationId}
          onSelect={setSelectedAssignment}
          onNavigate={navigateToAssignment}
          onAction={(action, assignment) => { void runAction(action, assignment) }}
          onReview={(assignment, mode) => setReviewState({ assignment, mode })}
          onRetry={() => setRefreshToken((current) => current + 1)}
          onPageChange={(page) => setPages((current) => ({ ...current, [activeTab]: page }))}
        />
        {visibleTabs.filter((tab) => tab.key !== activeTab).map((tab) => (
          <div
            id={`assignment-panel-${tab.key}`}
            role="tabpanel"
            aria-labelledby={`assignment-tab-${tab.key}`}
            hidden
            key={tab.key}
          />
        ))}

        {selectedAssignment ? (
          <AssignmentDetailDrawer assignment={selectedAssignment} tab={activeTab} onClose={() => setSelectedAssignment(null)} onNavigate={navigateToAssignment} />
        ) : null}
        {reviewState ? (
          <AssignmentReviewDialog
            assignment={reviewState.assignment}
            mode={reviewState.mode}
            busy={actionId === reviewState.assignment.id}
            onClose={() => { if (!actionId) setReviewState(null) }}
            onConfirm={(action, note, videoAnnotations) => void confirmReview(action, note, videoAnnotations)}
          />
        ) : null}
        {toast ? <div className={`fa-toast is-${toast.tone}`} role="status"><AppIcon name={toast.tone === 'success' ? 'check' : toast.tone === 'warning' ? 'alert' : 'close'} className="h-4 w-4" />{toast.message}</div> : null}
      </section>
    </FosShell>
  )
}
