'use client'

import './batch-workflow.css'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useRouter } from '@/i18n/navigation'
import { FosShell, type FosProjectNavigation } from '@/components/frameos/FosShell'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { confirmAction } from '@/lib/ui/feedback'
import { toCanvasDisplayImageUrl, toVideoPosterUrl } from '@/lib/media/image-url'
import {
  DEFAULT_WORKFLOW_MODEL_CONFIG,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_META,
  WORKFLOW_TRACK_LABELS,
  getNextWorkflowStage,
  hasBatchRunPendingAsyncTasks,
  hasItemPendingAsyncTasks,
  normalizeWorkflowModelConfig,
  type AssetsArtifact,
  type BatchItemDTO,
  type BatchRunDTO,
  type BatchRunMode,
  type BatchStageState,
  type OriginalScriptArtifact,
  type RewrittenScriptArtifact,
  type SkillRefineProposal,
  type StageParams,
  type StageSkillDraftPatch,
  type StoryboardArtifact,
  type VideoGenArtifact,
  type WorkflowAssetItem,
  type WorkflowModelConfig,
  type WorkflowQcReport,
  type WorkflowSkillDTO,
  type WorkflowStage,
  type WorkflowTemplateDTO,
} from '@/lib/batch-workflow/types'
import {
  ModelConfigPopover,
  type GenerationConfigOption,
  type ModelSlotKind,
} from './ModelConfigPopover'
import { SkillRefinementDock } from './SkillRefinementDock'
import { SkillLibraryModal } from './SkillLibraryModal'
import { RecipeSummaryPopover } from './RecipeSummaryPopover'
import {
  describeWorkflowApiError,
  buildQcPanelViewModel,
  createInFlightKeyGuard,
  expectedRevisionFor,
  flushWorkflowDraft,
  getApprovalBlockReason,
  getAutoWaitingReviewMessage,
  getStageRunBlockReason,
  hasBatchRunRunningStages,
  isStaleRevisionError,
  isTrialForSkill,
  mergePolledRun,
  performWithDraftFlush,
  readWorkflowMutationError,
  resolveVideoCapabilities,
  shouldAcceptWorkflowResponse,
  shouldClearDirtyAfterRun,
  startWorkflowSyncPolling,
  withExpectedRevision,
  WorkflowMutationError,
} from './workflow-client-utils'
import { Stage1ScriptAnalysisView } from './stages/Stage1ScriptAnalysisView'
import { Stage2ScriptRewriteView } from './stages/Stage2ScriptRewriteView'
import { Stage3AssetsLookbookView } from './stages/Stage3AssetsLookbookView'
import {
  Stage4StoryboardView,
  type StoryboardVideoCapabilities,
} from './stages/Stage4StoryboardView'
import { Stage5ScreeningRoomView } from './stages/Stage5ScreeningRoomView'
import {
  buildVideoGenerationBody,
  deriveVideoShotOverrides,
  getRegenerateAllCostConfirmation,
  type VideoGenerationOptions,
} from './video-generation-logic'
import {
  decideCanvasAction,
  decideCanvasSyncConflict,
  describeSkippedCanvasShots,
  isLegacyCanvasSyncConflict,
} from './canvas-sync-logic'

interface RawGenerationModel {
  modelKey: string
  name?: string
  label?: string
  description?: string | null
  available?: boolean
  configured?: boolean
  unavailableReason?: string | null
  runtimeModelKey?: string | null
  healthStatus?: string | null
  healthMessage?: string | null
  healthCheckedAt?: string | null
  options?: GenerationConfigOption['options']
  inputSchema?: Record<string, unknown> | null
  supportsInpaint?: boolean
  firstLastFrame?: boolean
  supportGenerateAudio?: boolean
  [key: string]: unknown
}

interface GenerationConfigState {
  textModels: GenerationConfigOption[]
  imageModels: GenerationConfigOption[]
  videoModels: GenerationConfigOption[]
  rawVideoModels: RawGenerationModel[]
  rawTextModels: RawGenerationModel[]
  rawImageModels: RawGenerationModel[]
}

interface ToastMessage {
  id: string
  text: string
  tone: 'success' | 'error' | 'info'
}

interface TrialState {
  stage: WorkflowStage
  itemId: string
  skillId: string
  skillVersion: number
  trialOutput: unknown
  proposal: SkillRefineProposal | null
  draftPatch: StageSkillDraftPatch
}

interface ProjectOption {
  id: string
  name: string
}

function mapRawToOption(raw: RawGenerationModel): GenerationConfigOption {
  const displayName = (raw.name || raw.label || raw.modelKey || '').trim() || raw.modelKey
  return {
    modelKey: raw.modelKey,
    name: displayName,
    label: displayName,
    description: raw.description ?? null,
    available: raw.available !== false,
    configured: raw.configured,
    unavailableReason: raw.unavailableReason ?? null,
    runtimeModelKey: raw.runtimeModelKey ?? null,
    healthStatus: raw.healthStatus ?? null,
    healthMessage: raw.healthMessage ?? null,
    healthCheckedAt: raw.healthCheckedAt ?? null,
    options: raw.options ?? null,
    firstLastFrame: raw.firstLastFrame,
    supportGenerateAudio: raw.supportGenerateAudio,
    supportsInpaint: raw.supportsInpaint,
    inputSchema: raw.inputSchema ?? null,
    raw,
  }
}

function resolveModelDisplayLabel(
  modelKey: string,
  list: RawGenerationModel[],
): string {
  const hit = list.find((m) => m.modelKey === modelKey)
  if (hit) return (hit.name || hit.label || modelKey).trim()
  const parts = modelKey.split('::')
  return parts[parts.length - 1] || modelKey
}

export function extractVideoCapabilities(
  videoModelKey: string,
  rawVideoModels: RawGenerationModel[],
): StoryboardVideoCapabilities {
  return resolveVideoCapabilities(videoModelKey, rawVideoModels)
}

const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  running: '运行中',
  waiting_review: '待审阅',
  approved: '已确认',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

function stageStatusTooltip(stage: WorkflowStage, state?: BatchStageState | null): string {
  const label = WORKFLOW_STAGE_META[stage].label
  if (state?.qcStatus === 'failed') return `${label}：质量检查未通过`
  if (state?.stale) return `${label}：上游已更新`
  const statusText = STAGE_STATUS_LABELS[state?.status || 'pending'] || '待执行'
  return `${label}：${statusText}`
}

function stageStatusClass(state?: BatchStageState | null, optimisticRunning = false): string {
  if (optimisticRunning) return 'is-running'
  if (!state) return ''
  if (state.qcStatus === 'failed') return 'is-failed'
  if (state.stale) return 'is-stale'
  if (state.status === 'running') return 'is-running'
  if (state.status === 'failed') return 'is-failed'
  if (state.status === 'waiting_review') return 'is-waiting'
  if (state.status === 'approved' || state.status === 'completed') return 'is-done'
  if (state.status === 'skipped') return 'is-skipped'
  return ''
}

function stageOutputBadge(
  stage: WorkflowStage,
  item: BatchItemDTO | null,
  state?: BatchStageState | null,
  optimisticRunning = false,
): string {
  if (optimisticRunning || state?.status === 'running') {
    return '运行中'
  }
  if (state?.qcStatus === 'failed') return '质检未通过'
  if (state?.status === 'failed') return '失败'
  if (state?.status === 'skipped') return '已跳过'
  if (!item) return '待执行'

  if (stage === 'script_analysis') {
    const s1 = item.stageOutputs.script_analysis
    if (s1 && s1.beats.length > 0) return `${s1.beats.length} 拍`
    return state?.status === 'waiting_review' ? '待审阅' : '待导入'
  }
  if (stage === 'script_rewrite') {
    const s2 = item.stageOutputs.script_rewrite
    if (s2 && s2.scenes.length > 0) return `${s2.scenes.length} 场`
    return '待洗稿'
  }
  if (stage === 'asset_extraction') {
    const s3 = item.stageOutputs.asset_extraction
    if (s3 && s3.items.length > 0) {
      const c = s3.items.filter((a) => a.kind === 'character').length
      const l = s3.items.filter((a) => a.kind === 'location').length
      const p = s3.items.filter((a) => a.kind === 'prop').length
      return `${c}角·${l}景·${p}物`
    }
    return '待抽取'
  }
  if (stage === 'storyboard') {
    const s4 = item.stageOutputs.storyboard
    if (s4 && s4.shots.length > 0) return `${s4.shots.length} 镜`
    return '待分镜'
  }
  const s5 = item.stageOutputs.video_gen
  if (s5 && s5.totalCount > 0) return `${s5.readyCount}/${s5.totalCount} 成片`
  return '待生视频'
}

function predictNextAutoStage(
  item: BatchItemDTO | null,
  templateStages?: ReadonlyArray<{ stage: WorkflowStage; enabled?: boolean }> | null,
): WorkflowStage | null {
  if (!item) return null
  const enabledStages = templateStages && templateStages.length > 0
    ? templateStages.filter((s) => s.enabled !== false).map((s) => s.stage)
    : [...WORKFLOW_STAGES]

  const resolveAtIndex = (index: number): WorkflowStage | null => {
    const st = enabledStages[index]
    if (!st) return null
    const state = item.stageStates?.[st]
    if (!state || state.status === 'pending' || state.status === 'failed' || state.status === 'running') {
      return st
    }
    if (state.status === 'waiting_review') {
      if (
        st === 'asset_extraction'
        && item.stageOutputs?.asset_extraction?.items?.some((a) => a.status === 'pending')
      ) {
        return st
      }
      return enabledStages[index + 1] ?? st
    }
    return null
  }

  const currentIdx = item.currentStage ? enabledStages.indexOf(item.currentStage) : -1
  if (currentIdx >= 0) {
    const direct = resolveAtIndex(currentIdx)
    if (direct) return direct
    for (let i = currentIdx + 1; i < enabledStages.length; i += 1) {
      const next = resolveAtIndex(i)
      if (next) return next
    }
    return null
  }

  for (let i = 0; i < enabledStages.length; i += 1) {
    const fallback = resolveAtIndex(i)
    if (fallback) return fallback
  }
  return null
}

function resolveItemCoverThumb(item: BatchItemDTO): string | null {
  const s3Ready = item.stageOutputs.asset_extraction?.items.find((a) => a.imageUrl || a.storageKey)
  if (s3Ready) return toCanvasDisplayImageUrl(s3Ready.imageUrl || s3Ready.storageKey || null, 480)
  const rawVideo = item.inputPayload.sourceVideoUrl || item.inputPayload.sourceVideoStorageKey
  if (rawVideo) return toVideoPosterUrl(rawVideo, 480)
  return null
}

function isItemReadyToAutoContinue(item: BatchItemDTO): boolean {
  if (hasItemPendingAsyncTasks(item)) return false
  if (item.status === 'failed' || item.status === 'completed') return false
  const s3 = item.stageStates.asset_extraction
  const s4 = item.stageStates.storyboard
  const s5 = item.stageStates.video_gen
  const s3Ready = s3 && (s3.status === 'completed' || s3.status === 'approved' || s3.status === 'waiting_review')
  if (s3Ready && s4?.status === 'pending') return true
  const s4Ready = s4 && (s4.status === 'completed' || s4.status === 'approved' || s4.status === 'waiting_review')
  if (s4Ready && s5?.status === 'pending') return true
  return false
}

function findAutoContinueItemId(
  run: BatchRunDTO,
  preferredItemId?: string | null,
): string | null {
  if (run.runMode !== 'auto') return null
  const items = run.items || []
  if (preferredItemId) {
    const preferred = items.find((item) => item.id === preferredItemId)
    if (preferred && isItemReadyToAutoContinue(preferred)) {
      return preferred.id
    }
  }
  const fallback = items.find((item) => isItemReadyToAutoContinue(item))
  return fallback?.id || null
}

function getUngeneratedReferencedAssets(
  item: BatchItemDTO,
  targetShotIds?: string[],
): WorkflowAssetItem[] {
  const s3Assets = item.stageOutputs.asset_extraction?.items || []
  if (s3Assets.length === 0) return []
  const s3ById = new Map(s3Assets.map((a) => [a.id, a]))
  const sbShots = item.stageOutputs.storyboard?.shots || []
  const s5Shots = item.stageOutputs.video_gen?.shots || []
  const filterSet = targetShotIds && targetShotIds.length > 0 ? new Set(targetShotIds) : null
  const missing: WorkflowAssetItem[] = []
  const seen = new Set<string>()
  const collectIds = (ids?: string[]) => {
    for (const id of ids || []) {
      if (seen.has(id)) continue
      const asset = s3ById.get(id)
      if (asset && !((asset.status === 'ready' || asset.status === 'reused') && Boolean(asset.materialId))) {
        seen.add(id)
        missing.push(asset)
      }
    }
  }
  for (const sh of sbShots) {
    if (filterSet && !filterSet.has(sh.shotId)) continue
    collectIds(sh.referencedAssetIds)
  }
  for (const sh of s5Shots) {
    if (filterSet && !filterSet.has(sh.shotId)) continue
    collectIds(sh.referencedAssetIds)
  }
  return missing
}

let elapsedValue = 0
let elapsedTimer: ReturnType<typeof setInterval> | null = null
const elapsedListeners = new Set<() => void>()
function publishElapsed(value: number) {
  if (elapsedValue === value) return
  elapsedValue = value
  elapsedListeners.forEach((listener) => listener())
}
function setElapsedStartedAt(startedAt: string | number | null | undefined) {
  if (elapsedTimer) clearInterval(elapsedTimer)
  elapsedTimer = null
  const started = typeof startedAt === 'string' ? Date.parse(startedAt) : startedAt
  if (!started || !Number.isFinite(started)) {
    publishElapsed(0)
    return
  }
  const update = () => publishElapsed(Math.max(1, Math.floor((Date.now() - started) / 1000)))
  update()
  elapsedTimer = setInterval(update, 1000)
}
function subscribeElapsed(listener: () => void) {
  elapsedListeners.add(listener)
  return () => elapsedListeners.delete(listener)
}
function getElapsedSnapshot() {
  return elapsedValue
}
function ElapsedSeconds() {
  const elapsed = useSyncExternalStore(subscribeElapsed, getElapsedSnapshot, () => 0)
  return <>{elapsed > 0 ? ` ${elapsed}s` : '…'}</>
}
function WithElapsedSeconds({ active, children }: { active: boolean; children: (elapsed: number) => ReactNode }) {
  const elapsed = useSyncExternalStore(subscribeElapsed, getElapsedSnapshot, () => 0)
  return <>{children(active ? elapsed : 0)}</>
}

export function BatchWorkflowClient({
  projectId,
  canManageSkills = false,
}: {
  projectId?: string
  canManageSkills?: boolean
}) {
  const router = useRouter()

  const [projectName, setProjectName] = useState('')
  const [skills, setSkills] = useState<WorkflowSkillDTO[]>([])
  const [skillCacheById, setSkillCacheById] = useState<Record<string, WorkflowSkillDTO>>({})
  const [templates, setTemplates] = useState<WorkflowTemplateDTO[]>([])
  const [runs, setRuns] = useState<BatchRunDTO[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<BatchRunDTO | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<WorkflowStage>('script_analysis')

  const [genConfig, setGenConfig] = useState<GenerationConfigState>({
    textModels: [],
    imageModels: [],
    videoModels: [],
    rawTextModels: [],
    rawImageModels: [],
    rawVideoModels: [],
  })

  // Popover & Modal anchors/toggles
  const runSwitcherRef = useRef<HTMLButtonElement>(null)
  const textModelBtnRef = useRef<HTMLButtonElement>(null)
  const imageModelBtnRef = useRef<HTMLButtonElement>(null)
  const videoModelBtnRef = useRef<HTMLButtonElement>(null)
  const stageSkillAnchorRefs = useRef<Record<WorkflowStage, HTMLButtonElement | null>>({
    script_analysis: null,
    script_rewrite: null,
    asset_extraction: null,
    storyboard: null,
    video_gen: null,
  })
  const stageSkillPopoverAnchorRef = useRef<HTMLElement | null>(null)

  const [openRunSwitcher, setOpenRunSwitcher] = useState(false)
  const [openModelPopover, setOpenModelPopover] = useState<ModelSlotKind | null>(null)
  const [openStageSkillPopover, setOpenStageSkillPopover] = useState<WorkflowStage | null>(null)
  const [showCreateRunModal, setShowCreateRunModal] = useState(false)
  const [showAddItemModal, setShowAddItemModal] = useState(false)

  // Admin-only Skill Refinement & Library state
  const [skillDockOpen, setSkillDockOpen] = useState(false)
  const [skillLibraryOpen, setSkillLibraryOpen] = useState(false)
  const [quotedSnippet, setQuotedSnippet] = useState<{ label: string; text: string } | null>(null)

  // A/B Trial Comparison State
  const [trialState, setTrialState] = useState<TrialState | null>(null)
  const [trialViewMode, setTrialViewMode] = useState<'original' | 'trial'>('trial')

  // Loading & Mutation Flags
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingRun, setLoadingRun] = useState(false)
  const [savingModelConfig, setSavingModelConfig] = useState(false)
  const [runningStageKey, setRunningStageKey] = useState<WorkflowStage | null>(null)
  const [advancingRun, setAdvancingRun] = useState(false)
  const [generatingAssets, setGeneratingAssets] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [adoptingTrial, setAdoptingTrial] = useState(false)
  const [materializingCanvas, setMaterializingCanvas] = useState(false)
  const [canvasStaleByItemId, setCanvasStaleByItemId] = useState<Record<string, boolean>>({})
  const [dismissedStaleKeys, setDismissedStaleKeys] = useState<Set<string>>(new Set())
  const [draftSyncNonce, setDraftSyncNonce] = useState(0)
  const [optimisticRunningSince, setOptimisticRunningSince] = useState<number | null>(null)
  const runningStage = runningStageKey !== null

  // Create Run Modal State
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([])
  const [newRunProjectId, setNewRunProjectId] = useState(projectId || '')
  const [newRunTitle, setNewRunTitle] = useState('')
  const [newRunTemplateId, setNewRunTemplateId] = useState('')
  const [newRunMode, setNewRunMode] = useState<BatchRunMode>('gated')
  const [newRunPastedScript, setNewRunPastedScript] = useState('')
  const [creatingRun, setCreatingRun] = useState(false)

  // Add Item Modal State
  const [addItemTitle, setAddItemTitle] = useState('')
  const [addItemMode, setAddItemMode] = useState<'video' | 'script'>('video')
  const [addItemVideo, setAddItemVideo] = useState<FrameosMaterialItem | null>(null)
  const [addItemScript, setAddItemScript] = useState('')
  const [addItemUploading, setAddItemUploading] = useState(false)
  const [showAddItemVideoPicker, setShowAddItemVideoPicker] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  const addItemFileRef = useRef<HTMLInputElement>(null)

  // Floating Toasts (rendered via ViewportDialogLayer)
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  // Latest draft getter, dirty flag, mutation ordering & in-flight flush guard
  const activeDraftGetterRef = useRef<(() => unknown) | null>(null)
  const activeStageDirtyRef = useRef(false)
  const activeItemIdRef = useRef<string | null>(null)
  const activeRevisionItemRef = useRef<BatchItemDTO | null>(null)
  const activeRunRef = useRef<BatchRunDTO | null>(activeRun)
  activeRunRef.current = activeRun
  const activeStageRef = useRef<WorkflowStage>(activeStage)
  activeStageRef.current = activeStage
  const mutationSeqRef = useRef(0)
  const detailRequestSeqRef = useRef(0)
  const flushInFlightRef = useRef<Promise<void> | null>(null)
  const lastFlushSavedRef = useRef(true)
  const staleConflictHandlerRef = useRef<(() => Promise<void>) | null>(null)
  const flushBeforeSwitchRef = useRef<(() => Promise<void>) | null>(null)
  const realShotTrialGuardRef = useRef(createInFlightKeyGuard())
  const registerActiveDraftGetter = useCallback((getter: (() => unknown) | null) => {
    activeDraftGetterRef.current = getter
  }, [])
  const handleActiveStageDirtyChange = useCallback((isDirty: boolean) => {
    activeStageDirtyRef.current = isDirty
    if (!isDirty && activeRunRef.current && activeItemIdRef.current) {
      const latest = activeRunRef.current.items?.find((item) => item.id === activeItemIdRef.current)
      if (latest) activeRevisionItemRef.current = latest
    }
  }, [])

  const lastToastRef = useRef<{ text: string; tone: string; at: number } | null>(null)
  const notify = useCallback((text: string, tone: 'success' | 'error' | 'info' = 'info') => {
    const now = Date.now()
    if (
      lastToastRef.current
      && lastToastRef.current.tone === tone
      && now - lastToastRef.current.at < 750
      && (
        lastToastRef.current.text === text
        || (text.includes('试跑') && lastToastRef.current.text.includes('试跑'))
      )
    ) {
      return
    }
    lastToastRef.current = { text, tone, at: now }
    const id = `${now}_${Math.random().toString(36).slice(2, 6)}`
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4600)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Sync run helper
  const syncRunState = useCallback((
    updated: BatchRunDTO,
    preferredItemId?: string | null,
    options?: { preserveDirtyDraft?: boolean; requestSeq?: number },
  ): boolean => {
    if (options?.requestSeq !== undefined && !shouldAcceptWorkflowResponse(
      { runId: updated.id, sequence: options.requestSeq },
      activeRunRef.current?.id,
      mutationSeqRef.current,
    )) return false
    setRuns((prev) => prev.some((run) => run.id === updated.id)
      ? prev.map((run) => run.id === updated.id ? { ...run, ...updated } : run)
      : prev)
    const currentRunId = activeRunRef.current?.id || null
    if (!currentRunId || updated.id !== currentRunId) return false
    const dirtyItemId = options?.preserveDirtyDraft && activeStageDirtyRef.current
      ? activeItemIdRef.current
      : null
    const merged = mergePolledRun(activeRunRef.current, updated, dirtyItemId)
    activeRunRef.current = merged
    setActiveRun(merged)
    setRuns((prev) => {
      const exists = prev.some((r) => r.id === merged.id)
      return exists ? prev.map((r) => (r.id === merged.id ? { ...r, ...merged } : r)) : [merged, ...prev]
    })
    const items = merged.items || []
    setSelectedItemId((cur) => {
      const next = preferredItemId && items.some((i) => i.id === preferredItemId)
        ? preferredItemId
        : cur && items.some((i) => i.id === cur)
          ? cur
          : items[0]?.id || null
      activeItemIdRef.current = next
      activeRevisionItemRef.current = items.find((item) => item.id === next) || null
      return next
    })
    return true
  }, [])

  const loadRunDetail = useCallback(async (
    runId: string,
    silent = false,
    signal?: AbortSignal,
    preserveDirtyDraft = false,
    syncPending = false,
  ): Promise<BatchRunDTO | null> => {
    if (!silent) setLoadingRun(true)
    const requestSeq = ++detailRequestSeqRef.current
    mutationSeqRef.current += 1
    try {
      const response = syncPending
        ? await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(runId)}/sync`, { method: 'POST', signal })
        : await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(runId)}`, { cache: 'no-store', signal })
      if (!response.ok) throw await readWorkflowMutationError(response, '加载工作流批次失败')
      const payload = await response.json() as { run?: BatchRunDTO }
      if (payload.run && shouldAcceptWorkflowResponse(
        { runId, sequence: requestSeq },
        activeRunRef.current?.id || runId,
        detailRequestSeqRef.current,
      )) {
        syncRunState(payload.run, undefined, { preserveDirtyDraft })
        return payload.run
      }
      return null
    } catch (err) {
      if (!silent) notify(err instanceof Error ? err.message : '加载工作流批次失败', 'error')
      return null
    } finally {
      if (!silent) setLoadingRun(false)
    }
  }, [notify, syncRunState])

  const loadSkillsAndTemplates = useCallback(async () => {
    try {
      const [skillsRes, templatesRes] = await Promise.all([
        apiFetch(`/api/batch-workflow/skills${canManageSkills ? '' : '?view=summary'}`, { cache: 'no-store' }),
        apiFetch('/api/batch-workflow/templates', { cache: 'no-store' }),
      ])
      if (skillsRes.ok) {
        const sp = await skillsRes.json() as { skills?: WorkflowSkillDTO[] }
        if (Array.isArray(sp.skills)) setSkills(sp.skills)
      }
      if (templatesRes.ok) {
        const tp = await templatesRes.json() as { templates?: WorkflowTemplateDTO[] }
        if (Array.isArray(tp.templates)) setTemplates(tp.templates)
      }
    } catch {
      // Keep existing state on transient error.
    }
  }, [canManageSkills])

  const loadAll = useCallback(async () => {
    setLoadingInitial(true)
    try {
      const runsQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}&limit=50` : '?limit=50'
      const genConfigQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''

      const [skillsRes, templatesRes, runsRes, genConfigRes, projectRes] = await Promise.all([
        apiFetch(`/api/batch-workflow/skills${canManageSkills ? '' : '?view=summary'}`, { cache: 'no-store' }),
        apiFetch('/api/batch-workflow/templates', { cache: 'no-store' }),
        apiFetch(`/api/batch-workflow/runs${runsQuery}`, { cache: 'no-store' }),
        apiFetch(`/api/frameos/generation-config${genConfigQuery}`, { cache: 'no-store' }).catch(() => null),
        projectId
          ? apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' }).catch(() => null)
          : apiFetch('/api/projects?pageSize=50', { cache: 'no-store' }).catch(() => null),
      ])

      if (!skillsRes.ok) throw new Error(await readApiErrorMessage(skillsRes, '加载 Skill 列表失败'))
      if (!templatesRes.ok) throw new Error(await readApiErrorMessage(templatesRes, '加载赛道模板失败'))
      if (!runsRes.ok) throw new Error(await readApiErrorMessage(runsRes, '加载工作流批次失败'))

      const skillsPayload = await skillsRes.json() as { skills?: WorkflowSkillDTO[] }
      const templatesPayload = await templatesRes.json() as { templates?: WorkflowTemplateDTO[] }
      const runsPayload = await runsRes.json() as { runs?: BatchRunDTO[] }

      const nextSkills = Array.isArray(skillsPayload.skills) ? skillsPayload.skills : []
      const nextTemplates = Array.isArray(templatesPayload.templates) ? templatesPayload.templates : []
      const nextRuns = Array.isArray(runsPayload.runs) ? runsPayload.runs : []

      setSkills(nextSkills)
      setTemplates(nextTemplates)
      setRuns(nextRuns)
      if (!newRunTemplateId && nextTemplates.length > 0) {
        const defTpl = nextTemplates.find((t) => t.isDefault) || nextTemplates[0]
        setNewRunTemplateId(defTpl.id)
      }

      if (genConfigRes && genConfigRes.ok) {
        const gp = await genConfigRes.json() as {
          textModels?: RawGenerationModel[]
          imageModels?: RawGenerationModel[]
          videoModels?: RawGenerationModel[]
        }
        const rawText = Array.isArray(gp.textModels) ? gp.textModels : []
        const rawImg = Array.isArray(gp.imageModels) ? gp.imageModels : []
        const rawVid = Array.isArray(gp.videoModels) ? gp.videoModels : []
        setGenConfig({
          textModels: rawText.map(mapRawToOption),
          imageModels: rawImg.map(mapRawToOption),
          videoModels: rawVid.map(mapRawToOption),
          rawTextModels: rawText,
          rawImageModels: rawImg,
          rawVideoModels: rawVid,
        })
      }

      if (projectRes && projectRes.ok) {
        const projPayload = await projectRes.json() as {
          name?: string
          project?: { name?: string }
          work?: { name?: string }
          projects?: Array<{ id?: string; name?: string }>
          works?: Array<{ id?: string; name?: string }>
        }
        if (projectId) {
          setProjectName(projPayload.work?.name || projPayload.project?.name || projPayload.name || '')
          setNewRunProjectId(projectId)
        } else {
          const list = (projPayload.projects || projPayload.works || [])
            .filter((p): p is { id: string; name: string } => Boolean(p?.id && p?.name))
          setProjectOptions(list)
          if (list.length > 0 && !newRunProjectId) setNewRunProjectId(list[0].id)
        }
      }

      if (nextRuns.length > 0) {
        const targetId = selectedRunId && nextRuns.some((r) => r.id === selectedRunId)
          ? selectedRunId
          : nextRuns[0].id
        if (activeRunRef.current && activeRunRef.current.id !== targetId) {
          await flushBeforeSwitchRef.current?.()
        }
        activeRunRef.current = null
        activeRevisionItemRef.current = null
        activeStageDirtyRef.current = false
        setActiveRun(null)
        setSelectedItemId(null)
        setSelectedRunId(targetId)
        const detailed = await loadRunDetail(targetId)
        const firstItem = detailed?.items?.[0]
        if (firstItem) {
          setSelectedItemId(firstItem.id)
          setActiveStage(firstItem.currentStage || 'script_analysis')
        }
      } else {
        setSelectedRunId(null)
        setActiveRun(null)
        setSelectedItemId(null)
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '加载视频工作流失败', 'error')
    } finally {
      setLoadingInitial(false)
    }
  }, [canManageSkills, loadRunDetail, newRunProjectId, newRunTemplateId, notify, projectId, selectedRunId])

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Derived active item, modelConfig, stage state, and skills
  const items = useMemo(() => activeRun?.items || [], [activeRun?.items])
  const activeItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) || items[0] || null,
    [items, selectedItemId],
  )
  useEffect(() => {
    activeItemIdRef.current = activeItem?.id || null
    activeRevisionItemRef.current = activeItem
  }, [activeItem])
  const modelConfig: WorkflowModelConfig = useMemo(
    () => normalizeWorkflowModelConfig(activeRun?.modelConfig, DEFAULT_WORKFLOW_MODEL_CONFIG),
    [activeRun?.modelConfig],
  )
  const activeStageState: BatchStageState = useMemo(() => (
    activeItem?.stageStates?.[activeStage] || {
      status: 'pending',
      skillSlug: '',
      skillVersion: 1,
    }
  ), [activeItem, activeStage])

  const stageSkillsByStage = useMemo(() => {
    const map: Record<WorkflowStage, WorkflowSkillDTO[]> = {
      script_analysis: [],
      script_rewrite: [],
      asset_extraction: [],
      storyboard: [],
      video_gen: [],
    }
    for (const sk of skills) {
      if (map[sk.stage]) map[sk.stage].push(sk)
    }
    return map
  }, [skills])

  const resolveStageSkill = useCallback((stage: WorkflowStage): WorkflowSkillDTO | null => {
    const stageList = stageSkillsByStage[stage]
    const stageCfg = activeRun?.templateSnapshot?.stages?.find((s) => s.stage === stage)
    const itemStage = activeItem?.stageStates?.[stage]
    const targetId = stageCfg?.skillId || itemStage?.skillId || null
    const targetSlug = stageCfg?.skillSlug || itemStage?.skillSlug || ''
    if (targetId) {
      if (skillCacheById[targetId]) return skillCacheById[targetId]
      const byId = stageList.find((s) => s.id === targetId)
      if (byId) return byId
    }
    if (targetSlug) {
      const bySlug = stageList.find((s) => s.slug === targetSlug)
      if (bySlug) return bySlug
    }
    return stageList.find((s) => s.isDefault) || stageList[0] || null
  }, [activeItem?.stageStates, activeRun?.templateSnapshot?.stages, skillCacheById, stageSkillsByStage])

  // Hydrate rolled-back / non-latest skill versions referenced by activeRun so exact v1 metadata displays after reload
  const fetchedMissingSkillIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const candidateIds = new Set<string>()
    for (const s of activeRun?.templateSnapshot?.stages || []) {
      if (s.skillId) candidateIds.add(s.skillId)
    }
    for (const st of WORKFLOW_STAGES) {
      const id = activeItem?.stageStates?.[st]?.skillId
      if (id) candidateIds.add(id)
    }
    const missing = Array.from(candidateIds).filter(
      (id) => !skills.some((s) => s.id === id) && !skillCacheById[id] && !fetchedMissingSkillIdsRef.current.has(id),
    )
    if (missing.length === 0) return
    let cancelled = false
    for (const id of missing) {
      fetchedMissingSkillIdsRef.current.add(id)
      void apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(id)}`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok || cancelled) return
          const payload = await res.json() as { skill?: WorkflowSkillDTO }
          if (payload.skill && !cancelled) {
            setSkillCacheById((prev) => ({ ...prev, [payload.skill!.id]: payload.skill! }))
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [activeItem?.stageStates, activeRun?.templateSnapshot?.stages, skillCacheById, skills])

  const activeStageSkill = useMemo(
    () => resolveStageSkill(activeStage),
    [activeStage, resolveStageSkill],
  )

  const videoCapabilities = useMemo(
    () => extractVideoCapabilities(modelConfig.videoModelKey, genConfig.rawVideoModels),
    [genConfig.rawVideoModels, modelConfig.videoModelKey],
  )
  const activeStageStartedAt = activeItem?.stageStates?.[activeStage]?.startedAt || optimisticRunningSince
  useEffect(() => {
    setElapsedStartedAt(runningStageKey ? activeStageStartedAt : null)
    return () => setElapsedStartedAt(null)
  }, [activeStageStartedAt, runningStageKey])

  const activeTrialForStage = useMemo(() => (
    trialState && activeItem && trialState.stage === activeStage && trialState.itemId === activeItem.id
      && isTrialForSkill(trialState, activeStageSkill)
      ? trialState
      : null
  ), [activeItem, activeStage, activeStageSkill, trialState])

  const isActiveTrialDryRun = Boolean(
    activeTrialForStage
    && (
      activeTrialForStage.stage === 'video_gen'
      || (
        activeTrialForStage.trialOutput
        && typeof activeTrialForStage.trialOutput === 'object'
        && (activeTrialForStage.trialOutput as Record<string, unknown>).dryRun === true
      )
    ),
  )

  const isViewingTrial = Boolean(activeTrialForStage && !isActiveTrialDryRun && trialViewMode === 'trial')

  // Full-Pipeline Auto-Continue Polling when async tasks (S3B images / S5 videos) are in flight
  const hasRunningStages = hasBatchRunRunningStages(activeRun?.items)
  const hasPendingAsync = Boolean(
    activeRun?.hasPendingAsyncTasks || hasBatchRunPendingAsyncTasks(activeRun?.items) || hasRunningStages,
  )
  activeItemIdRef.current = activeItem?.id || null
  const mountedRunIdRef = useRef<string | null>(activeRun?.id || null)
  useEffect(() => {
    mountedRunIdRef.current = activeRun?.id || null
    return () => {
      mountedRunIdRef.current = null
    }
  }, [activeRun?.id])

  const autoLoopRunningRef = useRef(false)

  const runAutoPipelineLoop = useCallback(async (
    runId: string,
    targetItemId: string,
    initialRun?: BatchRunDTO | null,
    opts?: { silentStart?: boolean },
  ) => {
    if (autoLoopRunningRef.current) return
    autoLoopRunningRef.current = true
    setAdvancingRun(true)
    let totalSteps = 0
    let stoppedWithMessage = false

    try {
      if (flushInFlightRef.current) {
        await flushInFlightRef.current
      }
      mutationSeqRef.current += 1
      let currentRun = (activeRunRef.current?.id === runId ? activeRunRef.current : null) || initialRun
      let currentRevisionItem = currentRun?.items?.find((item) => item.id === targetItemId) || null
      const maxIterations = 8
      for (let iter = 0; iter < maxIterations; iter += 1) {
        if (mountedRunIdRef.current && mountedRunIdRef.current !== runId) break
        const curItem = currentRun?.items?.find((i) => i.id === targetItemId) || currentRun?.items?.[0] || null
        const nextPredicted = predictNextAutoStage(curItem, currentRun?.templateSnapshot?.stages)
        if (nextPredicted) {
          setRunningStageKey(nextPredicted)
          setActiveStage(nextPredicted)
        }

        mutationSeqRef.current += 1
        const requestSeq = mutationSeqRef.current
        const response = await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(runId)}/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({
            maxSteps: 1,
            itemIds: [targetItemId],
            approveWaitingReview: true,
          }, currentRevisionItem)),
        })
        if (!response.ok) {
          throw await readWorkflowMutationError(response, '推进工作流失败')
        }
        const payload = await response.json() as {
          run?: BatchRunDTO
          hasPendingAsyncTasks?: boolean
          executedSteps?: Array<{ stage: WorkflowStage; outcome: string; error?: string | null }>
          result?: {
            run?: BatchRunDTO
            hasPendingAsyncTasks?: boolean
            executedSteps?: Array<{ stage: WorkflowStage; outcome: string; error?: string | null }>
          }
        }

        const nextRun = payload.run || payload.result?.run || null
        const steps = payload.executedSteps || payload.result?.executedSteps || []
        const pendingAsync = Boolean(
          payload.hasPendingAsyncTasks
          ?? payload.result?.hasPendingAsyncTasks
          ?? (nextRun ? hasBatchRunPendingAsyncTasks(nextRun.items) : false),
        )

        if (nextRun) {
          currentRun = nextRun
          currentRevisionItem = nextRun.items?.find((item) => item.id === targetItemId) || null
          syncRunState(nextRun, targetItemId, { requestSeq, preserveDirtyDraft: true })
          const updatedItem = nextRun.items?.find((i) => i.id === targetItemId) || nextRun.items?.[0]
          if (updatedItem && activeRunRef.current?.id === runId && activeItemIdRef.current === targetItemId) {
            setActiveStage(updatedItem.currentStage)
          }
        }

        totalSteps += steps.length
        const failedStep = steps.find((s) => s.outcome === 'failed')
        if (failedStep) {
          notify(failedStep.error || `环节「${WORKFLOW_STAGE_META[failedStep.stage].label}」执行失败`, 'error')
          stoppedWithMessage = true
          break
        }

        if (steps.length === 0) {
          break
        }

        if (pendingAsync) {
          const lastStage = steps[steps.length - 1]?.stage
          notify(
            lastStage === 'video_gen'
              ? '已批量提交分镜视频渲染任务，状态将自动轮询刷新…'
              : '已启动云端异步出图，完成后将自动继续推进分镜与生视频…',
            lastStage === 'video_gen' ? 'success' : 'info',
          )
          stoppedWithMessage = true
          break
        }

        const updatedItem = nextRun?.items?.find((i) => i.id === targetItemId)
        if (!updatedItem || updatedItem.status === 'completed' || updatedItem.status === 'failed') {
          break
        }
      }

      if (!stoppedWithMessage) {
        if (totalSteps === 0) {
          if (!opts?.silentStart) {
            notify('当前条目暂无可自动推进的待执行环节', 'info')
          }
        } else {
          notify(`全流程已连续推进 ${totalSteps} 个环节`, 'success')
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '全流程推进失败', 'error')
    } finally {
      setRunningStageKey(null)
      setAdvancingRun(false)
      autoLoopRunningRef.current = false
    }
  }, [notify, syncRunState])

  const runAutoPipelineLoopRef = useRef(runAutoPipelineLoop)
  runAutoPipelineLoopRef.current = runAutoPipelineLoop

  useEffect(() => {
    const runId = activeRun?.id
    if (!runId) return
    let wasPending = hasPendingAsync

    return startWorkflowSyncPolling(async (signal) => {
      if (mountedRunIdRef.current !== runId || autoLoopRunningRef.current) return
      let refreshed: BatchRunDTO | null = null
      if (wasPending || hasPendingAsync) {
        const response = await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(runId)}/sync`, {
          method: 'POST',
          signal,
        })
        if (!response.ok) {
          if (response.status === 404) {
            refreshed = await loadRunDetail(runId, true, signal, true)
          } else {
            throw await readWorkflowMutationError(response, '同步工作流状态失败')
          }
        } else {
          const payload = await response.json() as { run?: BatchRunDTO }
      if (payload.run) {
        refreshed = payload.run
        if (activeRunRef.current?.id === runId) {
          syncRunState(payload.run, undefined, { preserveDirtyDraft: true })
        }
      }
        }
      } else {
        refreshed = await loadRunDetail(runId, true, signal, true)
      }
      if (!refreshed || mountedRunIdRef.current !== runId || signal.aborted) return
      const stillPending = Boolean(
        refreshed.hasPendingAsyncTasks
        || hasBatchRunPendingAsyncTasks(refreshed.items)
        || hasBatchRunRunningStages(refreshed.items),
      )
      if (wasPending && !stillPending && refreshed.runMode === 'auto') {
        const targetItemId = findAutoContinueItemId(refreshed, activeItemIdRef.current)
        if (targetItemId) {
          notify('异步生成已完成，自动模式继续推进后续环节…', 'info')
          void runAutoPipelineLoopRef.current(runId, targetItemId, refreshed, { silentStart: true })
        }
      }
      wasPending = stillPending
    }, 4000)
  }, [activeRun?.id, hasPendingAsync, loadRunDetail, notify, syncRunState])

  // Mutations
  const handleApplyModelConfig = useCallback(async (patch: Partial<WorkflowModelConfig>) => {
    if (!activeRun) return
    mutationSeqRef.current += 1
    const requestSeq = mutationSeqRef.current
    setSavingModelConfig(true)
    try {
      const response = await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withExpectedRevision({ modelConfig: { ...modelConfig, ...patch } }, activeItem)),
      })
      if (!response.ok) throw await readWorkflowMutationError(response, '更新模型配置失败')
      const payload = await response.json() as { run?: BatchRunDTO }
      if (payload.run) syncRunState(payload.run, activeItem?.id, { requestSeq })
      notify('已更新工作流模型配置', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : '更新模型配置失败', 'error')
      throw err
    } finally {
      setSavingModelConfig(false)
    }
  }, [activeItem?.id, activeRun, modelConfig, notify, syncRunState])

  const handleToggleRunMode = useCallback(async (nextMode: BatchRunMode) => {
    if (!activeRun || activeRun.runMode === nextMode) return
    mutationSeqRef.current += 1
    const requestSeq = mutationSeqRef.current
    try {
      const response = await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withExpectedRevision({ runMode: nextMode }, activeItem)),
      })
      if (!response.ok) throw await readWorkflowMutationError(response, '切换执行模式失败')
      const payload = await response.json() as { run?: BatchRunDTO }
      if (payload.run) syncRunState(payload.run, activeItem?.id, { requestSeq })
      notify(nextMode === 'auto' ? '已切换为「一键全流程」自动模式' : '已切换为「分阶段审阅」模式', 'info')
    } catch (err) {
      notify(err instanceof Error ? err.message : '切换执行模式失败', 'error')
    }
  }, [activeItem?.id, activeRun, notify, syncRunState])

  const handleStaleConflictChoice = useCallback(async () => {
    const keepLocal = await confirmAction({
      title: '服务器已有更新',
      message: '本地草稿仍保留。选择「保留我的编辑」继续编辑，或选择「刷新服务端版本」放弃未保存修改并载入最新内容。',
      confirmLabel: '保留我的编辑',
      cancelLabel: '刷新服务端版本',
    })
    if (keepLocal) {
      if (activeRunRef.current) await loadRunDetail(activeRunRef.current.id, true, undefined, true)
      return
    }
    if (!activeRunRef.current) return
    activeStageDirtyRef.current = false
    await loadRunDetail(activeRunRef.current.id)
    setDraftSyncNonce((n) => n + 1)
  }, [loadRunDetail])
  staleConflictHandlerRef.current = handleStaleConflictChoice

  // Auto-flush dirty stage draft before switching stage or batch item (awaitable to avoid write-overwrite races)
  const flushDirtyDraftBeforeSwitch = useCallback(async (): Promise<void> => {
    lastFlushSavedRef.current = false
    if (flushInFlightRef.current) await flushInFlightRef.current
    if (!activeStageDirtyRef.current) {
      lastFlushSavedRef.current = true
      return
    }
    if (!activeRun || !activeItem || isViewingTrial || activeStage === 'video_gen') return
    const snapshot = activeDraftGetterRef.current?.()
    if (!snapshot) return
    mutationSeqRef.current += 1
    const requestSeq = mutationSeqRef.current
    const runId = activeRun.id
    const itemId = activeItem.id
    const stageToSave = activeStage
    const revisionItem = activeRevisionItemRef.current?.id === itemId ? activeRevisionItemRef.current : activeItem

    const runPromise = flushWorkflowDraft({
      request: () => apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({
            stage: stageToSave,
            action: 'save_draft',
            editedOutput: snapshot as Record<string, unknown>,
          }, revisionItem)),
        },
      ),
      readError: (response) => readWorkflowMutationError(response, '保存草稿失败'),
      onStaleConflict: async () => {
        notify('服务器已有更新，本地草稿已保留。', 'error')
        await staleConflictHandlerRef.current?.()
      },
      onSaved: (payload) => {
        if (!payload.run || !syncRunState(payload.run, itemId, { requestSeq, preserveDirtyDraft: true })) return
        if (activeRunRef.current?.id !== runId || activeItemIdRef.current !== itemId || activeStageRef.current !== stageToSave) return
        activeStageDirtyRef.current = false
        lastFlushSavedRef.current = true
        setDraftSyncNonce((n) => n + 1)
      },
    })
    const guarded = runPromise.finally(() => {
      if (flushInFlightRef.current === guarded) flushInFlightRef.current = null
    })
    flushInFlightRef.current = guarded
    return guarded
  }, [activeItem, activeRun, activeStage, isViewingTrial, notify, syncRunState])
  flushBeforeSwitchRef.current = flushDirtyDraftBeforeSwitch

  const handleRunStage = useCallback(async (
    stage: WorkflowStage,
    opts?: {
      skillIdOverride?: string | null
      stageParamsOverride?: StageParams | null
      forceRerun?: boolean
      shotIds?: string[]
      pastedScript?: string | null
      sourceVideoMaterialId?: string | null
      sourceVideoStorageKey?: string | null
      sourceVideoUrl?: string | null
      sourceVideoFileName?: string | null
      jumpAfterRun?: WorkflowStage
    },
  ) => {
    if (!activeRun || !activeItem) throw new Error('当前没有可执行的工作流条目。')
    try {
      const hadDirty = activeStageDirtyRef.current
      await flushDirtyDraftBeforeSwitch()
      if (!shouldClearDirtyAfterRun(hadDirty, lastFlushSavedRef.current)) {
        notify('有未保存的修改，未随本次运行提交', 'info')
      }
      const blockReason = getStageRunBlockReason(activeRevisionItemRef.current || activeItem, stage)
      if (blockReason) throw new Error(blockReason)
      if (activeStageDirtyRef.current && opts?.forceRerun) {
        const ok = await confirmAction({
          title: '按已保存草稿重新运行？',
          message: '当前有尚未保存的编辑。重新运行会替换当前环节产物，请先保存草稿或取消重跑。',
          confirmLabel: '已了解，仍然重跑',
          cancelLabel: '取消',
        })
        if (!ok) return
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '草稿保存失败，未重跑', 'error')
      throw err
    }
    let requestSeq = 0
    const hadDirty = activeStageDirtyRef.current
    setRunningStageKey(stage)
    setOptimisticRunningSince(Date.now())
    let autoChainPayload: { runId: string; itemId: string; run: BatchRunDTO } | null = null
    try {
      if (flushInFlightRef.current) await flushInFlightRef.current
      mutationSeqRef.current += 1
      requestSeq = mutationSeqRef.current
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items/${encodeURIComponent(activeItem.id)}/step`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({
            stage,
            ...(opts?.skillIdOverride ? { skillIdOverride: opts.skillIdOverride } : {}),
            ...(opts?.stageParamsOverride ? { stageParamsOverride: opts.stageParamsOverride } : {}),
            ...(opts?.forceRerun ? { forceRerun: true } : {}),
            ...(opts?.shotIds ? { shotIds: opts.shotIds } : {}),
            ...(opts?.pastedScript !== undefined ? { pastedScript: opts.pastedScript } : {}),
            ...(opts?.sourceVideoMaterialId !== undefined ? { sourceVideoMaterialId: opts.sourceVideoMaterialId } : {}),
            ...(opts?.sourceVideoStorageKey !== undefined ? { sourceVideoStorageKey: opts.sourceVideoStorageKey } : {}),
            ...(opts?.sourceVideoUrl !== undefined ? { sourceVideoUrl: opts.sourceVideoUrl } : {}),
            ...(opts?.sourceVideoFileName !== undefined ? { sourceVideoFileName: opts.sourceVideoFileName } : {}),
          }, activeRevisionItemRef.current || activeItem)),
        },
      )
      if (!response.ok) {
        const mutationError = await readWorkflowMutationError(response, `执行「${WORKFLOW_STAGE_META[stage].label}」失败`)
        if (mutationError.code === 'STAGE_ALREADY_RUNNING') {
          notify(mutationError.message, 'info')
          const synced = await loadRunDetail(activeRun.id, true, undefined, true, true)
          if (!synced) throw mutationError
          return
        }
        throw mutationError
      }
      const payload = await response.json() as { run?: BatchRunDTO; item?: BatchItemDTO; outcome?: string }
      const targetItemId = payload.item?.id || activeItem.id
      if (payload.run) {
        syncRunState(payload.run, targetItemId, { requestSeq, preserveDirtyDraft: true })
      }
      if (activeRunRef.current?.id !== activeRun.id || activeItemIdRef.current !== targetItemId) return
      if (trialState?.stage === stage) {
        setTrialState(null)
        setTrialViewMode('original')
      }
      setDismissedStaleKeys(new Set())
      if (shouldClearDirtyAfterRun(hadDirty, lastFlushSavedRef.current)) {
        activeStageDirtyRef.current = false
      }
      notify(payload.outcome === 'running'
        ? `已提交「${WORKFLOW_STAGE_META[stage].label}」，将自动刷新结果…`
        : `已完成「${WORKFLOW_STAGE_META[stage].label}」`, 'success')

      const effectiveRunMode = payload.run?.runMode || activeRun.runMode
      if (
        stage === 'script_analysis'
        && effectiveRunMode === 'auto'
        && payload.outcome !== 'failed'
        && payload.run
      ) {
        autoChainPayload = { runId: activeRun.id, itemId: targetItemId, run: payload.run }
      } else if (opts?.jumpAfterRun) {
        setActiveStage(opts.jumpAfterRun)
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '执行环节失败', 'error')
      throw err
    } finally {
      setRunningStageKey(null)
      setOptimisticRunningSince(null)
    }

    if (autoChainPayload) {
      void runAutoPipelineLoopRef.current(
        autoChainPayload.runId,
        autoChainPayload.itemId,
        autoChainPayload.run,
        { silentStart: true },
      )
    }
  }, [activeItem, activeRun, flushDirtyDraftBeforeSwitch, loadRunDetail, notify, syncRunState, trialState?.stage])

  const handleReviewStage = useCallback(async (
    stage: WorkflowStage,
    action: 'save_draft' | 'approve',
    editedOutput: unknown,
    options?: boolean | { silent?: boolean; clearStale?: boolean },
  ) => {
    if (!activeRun || !activeItem) throw new Error('当前没有可保存的工作流条目。')
    const requestRunId = activeRun.id
    const requestItemId = activeItem.id
    const silent = typeof options === 'boolean' ? options : Boolean(options?.silent)
    const clearStale = typeof options === 'object' && options?.clearStale === true
    setSavingDraft(true)
    try {
      if (flushInFlightRef.current) await flushInFlightRef.current
      const revisionItem = activeRevisionItemRef.current?.id === activeItem.id ? activeRevisionItemRef.current : activeItem
      mutationSeqRef.current += 1
      const requestSeq = mutationSeqRef.current
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items/${encodeURIComponent(activeItem.id)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({
            stage,
            action,
            editedOutput: editedOutput as Record<string, unknown>,
            ...(clearStale ? { clearStale: true } : {}),
          }, revisionItem)),
        },
      )
      if (!response.ok) throw await readWorkflowMutationError(response, '保存审阅状态失败')
      const payload = await response.json() as { run?: BatchRunDTO; item?: BatchItemDTO }
      const accepted = shouldAcceptWorkflowResponse(
        { runId: requestRunId, sequence: requestSeq },
        activeRunRef.current?.id,
        mutationSeqRef.current,
      )
      if (!accepted || activeItemIdRef.current !== requestItemId) {
        if (action === 'save_draft' && activeStageDirtyRef.current && activeStageRef.current === stage) {
          throw new Error('保存请求已被其他操作取消，请重试；本地草稿已保留。')
        }
        return
      }
      if (payload.run) syncRunState(payload.run, payload.item?.id || requestItemId, { requestSeq, preserveDirtyDraft: action === 'save_draft' })
      activeStageDirtyRef.current = false
      if (activeStageRef.current === stage) {
        setDraftSyncNonce((n) => n + 1)
      }

      if (action === 'approve') {
        const nextStage = getNextWorkflowStage(stage, activeRun.templateSnapshot?.stages)
        if (nextStage) {
          setTrialState((cur) => (cur && cur.stage !== nextStage ? null : cur))
          setTrialViewMode('original')
          setActiveStage(nextStage)
          if (!silent) {
            const approvedItem = payload.run?.items?.find((item) => item.id === requestItemId)
            const canContinue = approvedItem
              ? !getStageRunBlockReason(approvedItem, nextStage)
              : false
            notify(
              canContinue
                ? `已确认「${WORKFLOW_STAGE_META[stage].label}」，点击「确认并继续生成」运行「${WORKFLOW_STAGE_META[nextStage].label}」。`
                : `已确认「${WORKFLOW_STAGE_META[stage].label}」，进入「${WORKFLOW_STAGE_META[nextStage].label}」。`,
              'success',
            )
          }
        } else if (!silent) {
          notify('已确认当前环节', 'success')
        }
      } else if (!silent) {
        notify('已保存手改内容', 'success')
      }
    } catch (err) {
      if (isStaleRevisionError(err)) {
        notify('服务器已有更新，本地草稿已保留。', 'error')
        await handleStaleConflictChoice()
      } else if (!silent) {
        notify(err instanceof Error ? err.message : '保存失败', 'error')
      }
      throw err
    } finally {
      setSavingDraft(false)
    }
  }, [activeItem, activeRun, handleStaleConflictChoice, notify, syncRunState])

  const handleGenerateAssets = useCallback(async (assetItemIds?: string[]) => {
    if (!activeRun || !activeItem) return
    setGeneratingAssets(true)
    try {
      if (flushInFlightRef.current) {
        await flushInFlightRef.current
      }
      mutationSeqRef.current += 1
      const requestSeq = mutationSeqRef.current
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items/${encodeURIComponent(activeItem.id)}/assets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({
            action: 'generate',
            ...(assetItemIds && assetItemIds.length > 0 ? { assetItemIds } : {}),
          }, activeRevisionItemRef.current || activeItem)),
        },
      )
      if (!response.ok) throw await readWorkflowMutationError(response, '提交资产出图失败', 'asset')
      const payload = await response.json() as { run?: BatchRunDTO; item?: BatchItemDTO }
      if (payload.run) syncRunState(payload.run, payload.item?.id || activeItem.id, { requestSeq })
      notify(assetItemIds?.length ? '已提交单卡资产重新出图，自动轮询进度…' : '已批量提交缺失资产出图任务…', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : '资产出图失败', 'error')
      throw err
    } finally {
      setGeneratingAssets(false)
    }
  }, [activeItem, activeRun, notify, syncRunState])

  const handleBindAssetMaterial = useCallback(async (bindPayload: {
    assetItemId: string
    materialId?: string
    voiceMaterialId?: string
    clearVoice?: boolean
    selectVersionIndex?: number
  }) => {
    if (!activeRun || !activeItem) return
    try {
      if (flushInFlightRef.current) {
        await flushInFlightRef.current
      }
      mutationSeqRef.current += 1
      const requestSeq = mutationSeqRef.current
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items/${encodeURIComponent(activeItem.id)}/assets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({
            action: 'bind',
            ...bindPayload,
          }, activeRevisionItemRef.current || activeItem)),
        },
      )
      if (!response.ok) throw await readWorkflowMutationError(response, '更新资产绑定失败', 'asset')
      const payload = await response.json() as { run?: BatchRunDTO; item?: BatchItemDTO }
      if (payload.run) syncRunState(payload.run, payload.item?.id || activeItem.id, { requestSeq })
      if (bindPayload.materialId) notify('已替换为资产库素材', 'success')
      else if (bindPayload.voiceMaterialId) notify('已绑定角色音色', 'success')
      else if (bindPayload.clearVoice) notify('已解绑角色音色', 'info')
    } catch (err) {
      notify(err instanceof Error ? err.message : '更新资产绑定失败', 'error')
      throw err
    }
  }, [activeItem, activeRun, notify, syncRunState])

  const handleGenerateVideos = useCallback(async (opts?: VideoGenerationOptions) => {
    if (!activeRun || !activeItem) throw new Error('当前没有可生成视频的工作流条目。')
    if (flushInFlightRef.current) await flushInFlightRef.current
    let revisionItem = activeRevisionItemRef.current || activeItem
    const confirmation = opts?.forceRerun && !opts.shotIds?.length
      ? getRegenerateAllCostConfirmation(revisionItem)
      : null
    if (confirmation) {
      const ok = await confirmAction({
        title: '确认整体重抽并重新消耗视频额度？',
        message: confirmation,
        confirmLabel: '确认整体重抽',
        cancelLabel: '取消',
        danger: true,
      })
      if (!ok) return
    }
    setRunningStageKey('video_gen')
    try {
      if (opts?.updatedStoryboard) {
        await handleReviewStage('storyboard', 'save_draft', opts.updatedStoryboard, true)
        revisionItem = activeRevisionItemRef.current || activeItem
      }
      mutationSeqRef.current += 1
      const requestSeq = mutationSeqRef.current
      const body = buildVideoGenerationBody(revisionItem, {
        ...opts,
        shotOverrides: opts?.shotOverrides || deriveVideoShotOverrides(opts?.updatedStoryboard, opts?.shotIds),
      })
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items/${encodeURIComponent(activeItem.id)}/videos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision(body, revisionItem)),
        },
      )
      if (!response.ok) throw await readWorkflowMutationError(response, '提交视频生成任务失败')
      const payload = await response.json() as { run?: BatchRunDTO; item?: BatchItemDTO }
      if (payload.run) syncRunState(payload.run, payload.item?.id || activeItem.id, { requestSeq })
      notify(
        opts?.shotIds?.length === 1
          ? '已提交单镜重新抽卡，新版本将自动刷新…'
          : '已批量提交视频生成任务，自动轮询渲染状态…',
        'success',
      )
    } catch (err) {
      notify(err instanceof Error ? err.message : '视频任务提交失败', 'error')
      throw err
    } finally {
      setRunningStageKey(null)
    }
  }, [activeItem, activeRun, handleReviewStage, notify, syncRunState])

  const handleRealShotTrial = useCallback(async ({ shotId }: { shotId: string }) => {
    if (!activeRun || !activeItem || !activeStageSkill) throw new Error('当前没有可试跑的视频条目或 Skill。')
    if (flushInFlightRef.current) await flushInFlightRef.current
    const releaseTrial = realShotTrialGuardRef.current.acquire(`${activeItem.id}:${shotId}`)
    try {
      const revisionItem = activeRevisionItemRef.current || activeItem
      const response = await apiFetch(
      `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items/${encodeURIComponent(activeItem.id)}/trial`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withExpectedRevision({
          stage: 'video_gen',
          skillIdOverride: activeStageSkill.id,
          confirmCost: true,
          shotId,
        }, revisionItem)),
      },
    )
      if (!response.ok) throw await readWorkflowMutationError(response, '真实单镜试跑失败')
      notify('真实单镜试跑已提交并消耗视频额度；试跑结果不会写入当前产物，请在任务中心查看。', 'success')
    } finally {
      releaseTrial()
    }
  }, [activeItem, activeRun, activeStageSkill, notify])

  const handleSelectShotTake = useCallback(async (shotId: string, takeIndex: number) => {
    if (!activeRun || !activeItem) return
    mutationSeqRef.current += 1
    const requestSeq = mutationSeqRef.current
    try {
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items/${encodeURIComponent(activeItem.id)}/videos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({ action: 'select_take', shotId, takeIndex }, activeRevisionItemRef.current || activeItem)),
        },
      )
      if (!response.ok) throw await readWorkflowMutationError(response, '切换视频版本失败', 'take')
      const payload = await response.json() as { run?: BatchRunDTO; item?: BatchItemDTO }
      if (payload.run) syncRunState(payload.run, payload.item?.id || activeItem.id, { requestSeq })
    } catch (err) {
      notify(err instanceof Error ? err.message : '切换版本失败', 'error')
      throw err
    }
  }, [activeItem, activeRun, notify, syncRunState])

  const handleSwitchStageSkill = useCallback(async (
    stage: WorkflowStage,
    skillId: string,
    rerunNow: boolean,
    opts?: { silent?: boolean; skillDto?: WorkflowSkillDTO },
  ) => {
    if (!activeRun) return
    setOpenStageSkillPopover(null)
    try {
      let requestSeq = 0
      let resolvedSkill: WorkflowSkillDTO | null =
        opts?.skillDto
        || skillCacheById[skillId]
        || skills.find((s) => s.id === skillId)
        || null

      if (!resolvedSkill) {
        const skillRes = await apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(skillId)}`, { cache: 'no-store' }).catch(() => null)
        if (skillRes?.ok) {
          const sp = await skillRes.json() as { skill?: WorkflowSkillDTO }
          if (sp.skill) resolvedSkill = sp.skill
        }
      }
      if (resolvedSkill) {
        setSkillCacheById((prev) => ({ ...prev, [resolvedSkill!.id]: resolvedSkill! }))
      }

      mutationSeqRef.current += 1
      requestSeq = mutationSeqRef.current
      const response = await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withExpectedRevision({
          stageSkillOverrides: { [stage]: skillId },
        }, activeItem)),
      })
      if (!response.ok) throw await readWorkflowMutationError(response, '切换环节 Skill 失败')
      const payload = await response.json() as { run?: BatchRunDTO }
      if (payload.run) syncRunState(payload.run, activeItem?.id, { requestSeq })
      if (!opts?.silent) {
        const versionSuffix = resolvedSkill ? ` v${resolvedSkill.version}` : ''
        notify(`已切换「${resolvedSkill?.name || '目标 Skill'}${versionSuffix}」绑定；历史版本未修改。${rerunNow ? '' : '如需更新产物，请确认后重跑本环节。'}`, 'success')
      }
      setTrialState((current) => current && (current.stage !== stage || !isTrialForSkill(current, resolvedSkill)) ? null : current)
      setTrialViewMode('original')
      if (rerunNow && activeItem) {
        setActiveStage(stage)
        await handleRunStage(stage, { skillIdOverride: skillId, forceRerun: true })
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '切换 Skill 失败', 'error')
      throw err
    }
  }, [activeItem, activeRun, handleRunStage, notify, skillCacheById, skills, syncRunState])

  interface CanvasMaterializeResponse {
    canvasId?: string
    projectId?: string
    canvasUrl?: string
    href?: string
    stale?: boolean
    item?: BatchItemDTO
    skippedShots?: Array<{ shotId: string; reason: string }>
  }

  const handleMaterializeCanvas = useCallback(async (forceNew = false) => {
    if (!activeRun || !activeItem) throw new Error('当前没有可展开的工作流条目。')
    const runId = activeRun.id
    const itemId = activeItem.id
    const revisionItem = activeRevisionItemRef.current || activeItem
    const requestCanvas = async (
      mode: 'create' | 'sync' | 'check',
      createNew = false,
      errorFallback = '展开至无限画布失败',
    ): Promise<CanvasMaterializeResponse> => {
      mutationSeqRef.current += 1
      const requestSeq = mutationSeqRef.current
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/materialize-canvas`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withExpectedRevision({
            mode,
            ...(createNew ? { forceNew: true } : {}),
          }, revisionItem)),
        },
      )
      if (!response.ok) throw await readWorkflowMutationError(response, errorFallback)
      const payload = await response.json() as CanvasMaterializeResponse
      if (payload.item && activeRunRef.current) {
        const latestItems = activeRunRef.current.items?.map((item) => item.id === itemId ? payload.item! : item) || []
        syncRunState({ ...activeRunRef.current, items: latestItems }, itemId, { preserveDirtyDraft: true, requestSeq })
      }
      if (typeof payload.stale === 'boolean') {
        setCanvasStaleByItemId((prev) => ({ ...prev, [itemId]: payload.stale! }))
      }
      const skippedMessage = describeSkippedCanvasShots(payload.skippedShots?.length || 0)
      if (skippedMessage && mode !== 'check') notify(skippedMessage, 'info')
      return payload
    }
    const openCanvas = (payload: CanvasMaterializeResponse) => {
      const targetHref = payload.canvasUrl
        || payload.href
        || (payload.projectId && payload.canvasId
          ? `/canvas/${encodeURIComponent(payload.projectId)}/${encodeURIComponent(payload.canvasId)}`
          : null)
      if (!targetHref) throw new Error('画布已就绪但未返回跳转地址。')
      router.push(targetHref)
    }

    setMaterializingCanvas(true)
    try {
      if (forceNew) {
        const created = await requestCanvas('create', true)
        notify('已新建一份画布，正在进入…', 'success')
        openCanvas(created)
        return
      }
      if (activeItem.stageOutputs.canvasId) {
        let check: CanvasMaterializeResponse | null = null
        try {
          check = await requestCanvas('check', false, '检查画布状态失败')
        } catch (error) {
          if (!(error instanceof WorkflowMutationError && error.code === 'NOT_FOUND')) {
            notify('暂时无法检查画布是否过期，仍可直接打开现有画布。', 'info')
          }
        }
        if (check && decideCanvasAction({
          hasCanvas: true,
          checkStatus: 200,
          stale: check.stale,
        }) === 'open') {
          openCanvas(check)
          return
        }
        if (!check) {
          openCanvas({ canvasId: activeItem.stageOutputs.canvasId, projectId: activeRun.projectId })
          return
        }
        const syncCurrent = await confirmAction({
          title: '画布与当前采用版不一致',
          message: '同步可保留画布中的手工位置、新增节点和文案；也可以直接打开现有画布。',
          confirmLabel: '同步当前采用版',
          cancelLabel: '直接打开现有画布',
        })
        if (!syncCurrent) {
          openCanvas(check)
          return
        }
        const createNew = await confirmAction({
          title: '同步当前采用版？',
          message: '确认同步并保留手工修改；若要保留当前画布不动并另建一份，请选择「新建一份画布」。',
          confirmLabel: '确认同步',
          cancelLabel: '新建一份画布',
        })
        if (!createNew) {
          const created = await requestCanvas('create', true)
          notify('已新建一份画布，正在进入…', 'success')
          openCanvas(created)
          return
        }
        try {
          const synced = await requestCanvas('sync')
          notify('已同步当前采用版，保留画布中的手工修改。', 'success')
          openCanvas(synced)
          return
        } catch (error) {
          if (!isLegacyCanvasSyncConflict(error)) {
            throw error
          }
          notify('这份画布早于同步功能，无法安全同步。', 'error')
          const createNew = await confirmAction({
            title: '无法同步旧画布',
            message: '这份画布早于同步功能，无法安全同步。是否保留原画布并新建一份当前采用版画布？',
            confirmLabel: '新建一份画布',
            cancelLabel: '直接打开现有画布',
          })
          if (createNew) {
            const created = await requestCanvas('create', true)
            openCanvas(created)
          } else {
            openCanvas(check)
          }
          return
        }
      }
      const created = await requestCanvas('create')
      notify('已展开 4 列完整制作链路至无限画布，正在进入…', 'success')
      openCanvas(created)
    } catch (err) {
      notify(err instanceof Error ? err.message : '展开画布失败', 'error')
      throw err
    } finally {
      setMaterializingCanvas(false)
    }
  }, [activeItem, activeRun, notify, router, syncRunState])

  const switchSelectedRun = useCallback(async (nextId: string): Promise<void> => {
    if (nextId === activeRunRef.current?.id) {
      setOpenRunSwitcher(false)
      return
    }
    try {
      await performWithDraftFlush(flushDirtyDraftBeforeSwitch, () => {
        activeRunRef.current = null
        activeRevisionItemRef.current = null
        activeStageDirtyRef.current = false
        setOpenRunSwitcher(false)
        setSelectedRunId(nextId)
        setActiveRun(null)
        setSelectedItemId(null)
        setTrialState(null)
        setTrialViewMode('original')
      })
      await loadRunDetail(nextId)
    } catch (err) {
      notify(err instanceof Error ? err.message : '草稿保存失败，未切换批次', 'error')
    }
  }, [flushDirtyDraftBeforeSwitch, loadRunDetail, notify])

  const handleDeleteRun = useCallback(async (run: BatchRunDTO) => {
    const ok = await confirmAction({
      title: `删除工作流批次「${run.title}」？`,
      message: '将移除此批次下的全部中间产出记录（已同步到资产库和画布的素材不受影响）。',
      confirmLabel: '确认删除',
      danger: true,
    })
    if (!ok) return
    try {
      await performWithDraftFlush(flushDirtyDraftBeforeSwitch, async () => {
        const response = await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(run.id)}`, {
          method: 'DELETE',
        })
        if (!response.ok) throw await readWorkflowMutationError(response, '删除工作流批次失败')
        setOpenRunSwitcher(false)
        const remaining = runs.filter((r) => r.id !== run.id)
        setRuns(remaining)
        if (selectedRunId === run.id) {
          const nextId = remaining[0]?.id || null
          activeRunRef.current = null
          activeRevisionItemRef.current = null
          activeStageDirtyRef.current = false
          setSelectedRunId(nextId)
          if (nextId) await loadRunDetail(nextId)
          else {
            setActiveRun(null)
            setSelectedItemId(null)
          }
        }
        notify(`已删除批次「${run.title}」`, 'info')
      })
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除批次失败', 'error')
    }
  }, [flushDirtyDraftBeforeSwitch, loadRunDetail, notify, runs, selectedRunId])

  const handleDeleteItem = useCallback(async (item: BatchItemDTO) => {
    if (!activeRun) return
    const ok = await confirmAction({
      title: `移除条目「${item.title}」？`,
      message: '将从当前工作流批次中删除该条视频任务及其 5 步产出。',
      confirmLabel: '确认移除',
      danger: true,
    })
    if (!ok) return
    try {
      mutationSeqRef.current += 1
      const requestSeq = mutationSeqRef.current
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items?itemId=${encodeURIComponent(item.id)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) throw await readWorkflowMutationError(response, '移除条目失败')
      const payload = await response.json() as { run?: BatchRunDTO }
      if (payload.run) syncRunState(payload.run, undefined, { requestSeq })
      notify(`已移除条目「${item.title}」`, 'info')
    } catch (err) {
      notify(err instanceof Error ? err.message : '移除条目失败', 'error')
    }
  }, [activeRun, notify, syncRunState])

  const handleCreateRun = async () => {
    const targetProjectId = projectId || newRunProjectId
    if (!targetProjectId) {
      notify('请先选择一个所属作品项目。', 'error')
      return
    }
    setCreatingRun(true)
    try {
      await flushDirtyDraftBeforeSwitch()
      const tpl = templates.find((t) => t.id === newRunTemplateId) || templates[0]
      const initialItems = newRunPastedScript.trim()
        ? [{
            title: newRunTitle.trim() || '粘贴剧本条目 1',
            input: {
              sourceType: 'pasted_script' as const,
              skipVideoAnalysis: true,
              pastedScript: newRunPastedScript.trim(),
            },
          }]
        : [{
            title: newRunTitle.trim() || '视频创作 1',
            input: { sourceType: 'video' as const },
          }]

      mutationSeqRef.current += 1
      const response = await apiFetch('/api/batch-workflow/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: targetProjectId,
          templateId: tpl?.id || undefined,
          track: tpl?.track || undefined,
          title: newRunTitle.trim() || `${tpl?.name || '视频工作流'} · ${new Date().toLocaleDateString('zh-CN')}`,
          runMode: newRunMode,
          items: initialItems,
        }),
      })
      if (!response.ok) throw await readWorkflowMutationError(response, '新建工作流批次失败')
      const payload = await response.json() as { run?: BatchRunDTO }
      if (payload.run) {
        activeRunRef.current = payload.run
        activeRevisionItemRef.current = null
        activeStageDirtyRef.current = false
        setActiveRun(payload.run)
        setSelectedItemId(null)
        setTrialState(null)
        setTrialViewMode('original')
        setShowCreateRunModal(false)
        setNewRunTitle('')
        setNewRunPastedScript('')
        setSelectedRunId(payload.run.id)
        syncRunState(payload.run, payload.run.items?.[0]?.id)
        setActiveStage(payload.run.items?.[0]?.currentStage || 'script_analysis')
        notify(`已新建工作流批次「${payload.run.title}」`, 'success')
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '新建批次失败', 'error')
    } finally {
      setCreatingRun(false)
    }
  }

  const handleUploadAddItemVideo = async (file: File) => {
    setAddItemUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const baseTitle = file.name.replace(/\.[^.]+$/, '').trim() || '追加参考视频'
      form.set('title', baseTitle)
      form.set('projectId', projectId || activeRun?.projectId || 'personal')
      const response = await apiFetch('/api/frameos/materials', { method: 'POST', body: form })
      if (!response.ok) throw await readWorkflowMutationError(response, '上传视频失败')
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material) throw new Error('上传未返回视频素材。')
      setAddItemVideo(payload.material)
      if (!addItemTitle.trim()) setAddItemTitle(payload.material.title || baseTitle)
    } catch (err) {
      notify(err instanceof Error ? err.message : '上传视频失败', 'error')
    } finally {
      setAddItemUploading(false)
    }
  }

  const handleAddItemSubmit = async () => {
    if (!activeRun) return
    mutationSeqRef.current += 1
    const requestSeq = mutationSeqRef.current
    setAddingItem(true)
    try {
      const seed = addItemMode === 'script'
        ? {
            title: addItemTitle.trim() || `剧本条目 ${items.length + 1}`,
            input: {
              sourceType: 'pasted_script' as const,
              skipVideoAnalysis: true,
              pastedScript: addItemScript.trim() || null,
            },
          }
        : {
            title: addItemTitle.trim() || addItemVideo?.title || `视频条目 ${items.length + 1}`,
            input: {
              sourceType: 'video' as const,
              sourceVideoMaterialId: addItemVideo?.id || null,
              sourceVideoStorageKey: addItemVideo?.storageKey || null,
              sourceVideoUrl: addItemVideo?.url || addItemVideo?.resultUrl || null,
              sourceVideoFileName: addItemVideo?.title || null,
            },
          }
      const response = await apiFetch(`/api/batch-workflow/runs/${encodeURIComponent(activeRun.id)}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withExpectedRevision({ items: [seed] }, activeItem)),
      })
      if (!response.ok) throw await readWorkflowMutationError(response, '追加视频任务失败')
      const payload = await response.json() as { run?: BatchRunDTO; addedItems?: BatchItemDTO[] }
      const addedItem = payload.addedItems?.[0]
      if (payload.run) {
        syncRunState(payload.run, addedItem?.id, { requestSeq })
        setActiveStage(addedItem?.currentStage || 'script_analysis')
      }
      setShowAddItemModal(false)
      setAddItemTitle('')
      setAddItemVideo(null)
      setAddItemScript('')
      notify('已追加新的视频制作条目', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : '追加条目失败', 'error')
    } finally {
      setAddingItem(false)
    }
  }

  const switchActiveStage = useCallback(async (targetStage: WorkflowStage): Promise<void> => {
    if (targetStage === activeStage) {
      if (flushInFlightRef.current) await flushInFlightRef.current
      return
    }
    try {
      await performWithDraftFlush(flushDirtyDraftBeforeSwitch, () => {
        setTrialState((cur) => (cur && cur.stage !== targetStage ? null : cur))
        setTrialViewMode('original')
        setActiveStage(targetStage)
      })
    } catch (err) {
      notify(err instanceof Error ? err.message : '草稿保存失败，未切换环节', 'error')
      throw err
    }
  }, [activeStage, flushDirtyDraftBeforeSwitch, notify])

  const switchSelectedItem = useCallback(async (item: BatchItemDTO): Promise<void> => {
    if (item.id === activeItem?.id) return
    try {
      await performWithDraftFlush(flushDirtyDraftBeforeSwitch, () => {
        setTrialState(null)
        setTrialViewMode('original')
        setSelectedItemId(item.id)
        activeItemIdRef.current = item.id
        activeRevisionItemRef.current = item
        activeStageDirtyRef.current = false
        setActiveStage(item.currentStage || 'script_analysis')
      })
    } catch (err) {
      notify(err instanceof Error ? err.message : '草稿保存失败，未切换条目', 'error')
      throw err
    }
  }, [activeItem?.id, flushDirtyDraftBeforeSwitch, notify])

  const handleJumpToAssetsAndGenerate = useCallback(() => {
    const missingAssets = (activeItem?.stageOutputs.asset_extraction?.items || []).filter(
      (a) => a.status === 'pending' || a.status === 'failed',
    )
    const flushPromise = switchActiveStage('asset_extraction').catch(() => {})
    if (missingAssets.length > 0 && !generatingAssets) {
      void (async () => {
        await flushPromise
        await handleGenerateAssets().catch(() => {})
      })()
    }
  }, [activeItem?.stageOutputs.asset_extraction?.items, generatingAssets, handleGenerateAssets, switchActiveStage])

  // Global Keyboard Shortcuts: 1-5 stage switch, Cmd/Ctrl+Enter approve & advance, layered Esc close
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showAddItemVideoPicker) {
          setShowAddItemVideoPicker(false)
          return
        }
        // Let nested portaled dialogs (e.g. MaterialPickerDialog, ImagePreviewModal, confirmAction) handle Esc first
        const modalNodes = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
        const ownModalOpenCount = (showAddItemModal ? 1 : 0) + (showCreateRunModal ? 1 : 0) + (skillLibraryOpen ? 1 : 0)
        if (modalNodes.length > ownModalOpenCount) return

        if (openModelPopover) setOpenModelPopover(null)
        else if (openStageSkillPopover) setOpenStageSkillPopover(null)
        else if (openRunSwitcher) setOpenRunSwitcher(false)
        else if (skillLibraryOpen) setSkillLibraryOpen(false)
        else if (showAddItemModal && !addingItem && !addItemUploading) setShowAddItemModal(false)
        else if (showCreateRunModal && !creatingRun) setShowCreateRunModal(false)
        return
      }

      const hasOpenOverlay = Boolean(
        openModelPopover
        || openStageSkillPopover
        || openRunSwitcher
        || showCreateRunModal
        || showAddItemModal
        || showAddItemVideoPicker
        || skillLibraryOpen
        || document.querySelector('[role="dialog"][aria-modal="true"], .wf-popover, .fos-viewport-popover'),
      )

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (hasOpenOverlay) return
        if (!activeRun || !activeItem || runningStage || savingDraft || isViewingTrial) return
        if (activeStage === 'video_gen') {
          event.preventDefault()
          notify('视频生成请使用「批量生成视频」，⌘Enter 仅用于确认中间环节草稿。', 'info')
          return
        }
        const latestDraft = activeDraftGetterRef.current?.()
        const blockReason = getApprovalBlockReason(activeItem, activeStage, latestDraft)
        if (blockReason) {
          event.preventDefault()
          notify(blockReason, 'error')
          return
        }
        event.preventDefault()
        void handleReviewStage(activeStage, 'approve', latestDraft).catch(() => {})
        return
      }

      if (hasOpenOverlay) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select'))
      ) {
        return
      }
      if (/^[1-5]$/.test(event.key)) {
        const idx = Number(event.key) - 1
        const targetStage = WORKFLOW_STAGES[idx]
        if (targetStage) {
          event.preventDefault()
          void switchActiveStage(targetStage).catch(() => {})
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeItem,
    activeRun,
    activeStage,
    addItemUploading,
    addingItem,
    creatingRun,
    handleReviewStage,
    isViewingTrial,
    openModelPopover,
    openRunSwitcher,
    openStageSkillPopover,
    runningStage,
    savingDraft,
    showAddItemModal,
    showAddItemVideoPicker,
    showCreateRunModal,
    skillLibraryOpen,
    switchActiveStage,
  ])

  const canMaterializeCanvas = Boolean(
    activeItem && (
      activeItem.stageOutputs.asset_extraction
      || activeItem.stageOutputs.storyboard
      || activeItem.stageOutputs.video_gen
    ),
  )
  const activeItemId = activeItem?.id
  const activeCanvasId = activeItem?.stageOutputs.canvasId
  const activeItemRevision = activeItem?.revision
  const activeRunId = activeRun?.id
  useEffect(() => {
    if (!activeRunId || !activeItemId || !activeCanvasId) return
    const runId = activeRunId
    const canvasId = activeCanvasId
    let cancelled = false
    void (async () => {
      try {
        const response = await apiFetch(
          `/api/batch-workflow/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(activeItemId)}/materialize-canvas`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'check',
              expectedRevision: activeItemRevision || 0,
            }),
          },
        )
        if (!response.ok || cancelled) return
        const payload = await response.json() as { canvasId?: string; stale?: boolean }
        if (payload.canvasId === canvasId && typeof payload.stale === 'boolean') {
          setCanvasStaleByItemId((prev) => ({ ...prev, [activeItemId]: payload.stale! }))
        }
      } catch {
        // A failed read-only check must not block opening the existing canvas.
      }
    })()
    return () => { cancelled = true }
  }, [activeCanvasId, activeItemId, activeItemRevision, activeRunId])

  const handleQuoteSnippet = useCallback((snippet: { label: string; text: string }) => {
    if (!canManageSkills) return
    setQuotedSnippet(snippet)
    setSkillDockOpen(true)
  }, [canManageSkills])

  const handleSeedSkillFeedback = useCallback((feedbackText: string) => {
    if (!canManageSkills) return
    setQuotedSnippet({ label: '来自洗稿快捷微调', text: feedbackText })
    setSkillDockOpen(true)
  }, [canManageSkills])

  const handleSkillSavedFromDock = useCallback(async (
    savedSkill: WorkflowSkillDTO,
    appliedOutput?: unknown,
  ) => {
    setSkills((prev) => {
      const deduped = prev.filter(
        (s) => s.id !== savedSkill.id && !(s.slug === savedSkill.slug && s.stage === savedSkill.stage),
      )
      return [savedSkill, ...deduped]
    })
    setSkillCacheById((prev) => ({ ...prev, [savedSkill.id]: savedSkill }))
    if (activeRun) {
      await handleSwitchStageSkill(savedSkill.stage, savedSkill.id, false, {
        silent: true,
        skillDto: savedSkill,
      })
    }
    const isDryRunOutput = Boolean(
      appliedOutput
      && typeof appliedOutput === 'object'
      && (appliedOutput as Record<string, unknown>).dryRun === true,
    )
    if (appliedOutput && savedSkill.stage !== 'video_gen' && !isDryRunOutput && activeRun && activeItem) {
      await handleReviewStage(savedSkill.stage, 'save_draft', appliedOutput, true)
    }
    setTrialState(null)
    setTrialViewMode('original')
  }, [activeItem, activeRun, handleReviewStage, handleSwitchStageSkill])

  const handleAdoptTrialFromAbBar = useCallback(async () => {
    if (!activeTrialForStage || adoptingTrial || !isTrialForSkill(activeTrialForStage, activeStageSkill)) {
      notify('试跑与当前配方版本不一致，无法采用。请重新试跑。', 'error')
      return
    }
    const targetSkill = activeStageSkill
    if (!targetSkill) {
      setSkillDockOpen(true)
      return
    }
    const nextSystemPrompt = activeTrialForStage.draftPatch.systemPrompt?.trim() || targetSkill.systemPrompt
    if (!nextSystemPrompt) {
      setSkillDockOpen(true)
      return
    }
    setAdoptingTrial(true)
    try {
      let derivedName: string | undefined
      if (targetSkill.isBuiltin) {
        derivedName = window.prompt('派生团队配方：请输入新配方名称', `${targetSkill.name} · 团队版`)?.trim()
        if (!derivedName) throw new Error('已取消派生团队配方，未发布新版本。')
      }
      const response = await apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(targetSkill.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saveAsNewVersion: true,
          ...(derivedName ? { name: derivedName } : {}),
          changeNote:
            activeTrialForStage.proposal?.changeNote
            || activeTrialForStage.proposal?.changeSummary?.[0]
            || `A/B 对比采纳试跑方案 v${targetSkill.version + 1}`,
          description: activeTrialForStage.proposal?.nextDescription ?? targetSkill.description,
          systemPrompt: nextSystemPrompt,
          fewShotExamples: activeTrialForStage.draftPatch.fewShotExamples ?? targetSkill.fewShotExamples,
          qcRules:
            activeTrialForStage.draftPatch.qcRules !== undefined
              ? activeTrialForStage.draftPatch.qcRules
              : targetSkill.qcRules,
          modelPreferences:
            activeTrialForStage.draftPatch.modelPreferences !== undefined
              ? activeTrialForStage.draftPatch.modelPreferences
              : targetSkill.modelPreferences,
        }),
      })
      if (!response.ok) {
        throw await readWorkflowMutationError(response, '采纳并发布 Skill 新版本失败')
      }
      const payload = await response.json() as { skill?: WorkflowSkillDTO }
      if (!payload.skill) throw new Error('发布成功但未返回 Skill 数据。')
      await handleSkillSavedFromDock(payload.skill, activeTrialForStage.trialOutput)
      setQuotedSnippet(null)
      notify(`已采纳试跑产出并发布「${payload.skill.name}」v${payload.skill.version}！`, 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : '采纳试跑失败', 'error')
    } finally {
      setAdoptingTrial(false)
    }
  }, [activeStageSkill, activeTrialForStage, adoptingTrial, handleSkillSavedFromDock, notify])

  const handleTopbarGenerateVideos = useCallback(async (shotIds?: string[]) => {
    if (!activeItem) return
    const missingAssets = getUngeneratedReferencedAssets(activeItem, shotIds)
    if (missingAssets.length > 0) {
      const namesPreview = missingAssets.slice(0, 4).map((a) => `@${a.name}`).join('、')
      const suffix = missingAssets.length > 4 ? ` 等 ${missingAssets.length} 项` : ''
      const ok = await confirmAction({
        title: '被引用资产尚未出图，仍要提交生视频？',
        message: `有 ${missingAssets.length} 项被引用资产（${namesPreview}${suffix}）尚未出图，生视频将无法保持角色/场景一致且会消耗视频生成额度。建议先返回第 3 步一键出图。`,
        confirmLabel: '仍要生视频',
        cancelLabel: '去第 3 步出图',
      })
      if (!ok) {
        void switchActiveStage('asset_extraction').catch(() => {})
        return
      }
    }
    await handleGenerateVideos({
      ...(shotIds && shotIds.length > 0 ? { shotIds } : {}),
      forceRerun: false,
    })
  }, [activeItem, handleGenerateVideos, switchActiveStage])

  // Context-aware topbar Primary CTA (non-destructive in gated mode; step-loop in auto mode)
  const topbarPrimaryCta = useMemo<{
    label: string
    icon: 'play' | 'monitor' | 'sparkles' | 'check' | 'arrowRight'
    disabled: boolean
    busy: boolean
    onClick: () => void
  }>(() => {
    if (!activeRun || !activeItem) {
      return {
        label: '运行当前环节',
        icon: 'play',
        disabled: true,
        busy: false,
        onClick: () => {},
      }
    }
    if (activeRun.runMode === 'auto') {
      const waitingMessage = getAutoWaitingReviewMessage(activeRun, activeItem)
      return {
        label: waitingMessage ? '待确认后继续' : advancingRun ? '全流程运行中…' : '一键全流程运行',
        icon: waitingMessage ? 'check' : 'play',
        disabled: runningStage || advancingRun,
        busy: runningStage || advancingRun,
        onClick: () => {
          if (autoLoopRunningRef.current) return
          void (async () => {
            await flushDirtyDraftBeforeSwitch()
            const waitingMessage = getAutoWaitingReviewMessage(activeRun, activeItem)
            if (waitingMessage) {
              notify(waitingMessage, 'info')
              return
            }
            await runAutoPipelineLoop(activeRun.id, activeItem.id, activeRunRef.current || activeRun)
          })()
        },
      }
    }

    if (activeStage === 'video_gen') {
      const s5 = activeItem.stageOutputs.video_gen
      const s5Shots = Array.isArray(s5?.shots) ? s5.shots : []
      const pendingOrFailed = s5Shots.filter((sh) => {
        const takes = Array.isArray(sh.takes) ? sh.takes : []
        const sel = sh.selectedTakeIndex >= 0 && sh.selectedTakeIndex < takes.length
          ? takes[sh.selectedTakeIndex]
          : takes[takes.length - 1]
        return !sel || sel.status === 'pending' || sel.status === 'failed'
      })
      const rendering = s5Shots.filter((sh) => {
        const takes = Array.isArray(sh.takes) ? sh.takes : []
        const sel = sh.selectedTakeIndex >= 0 && sh.selectedTakeIndex < takes.length
          ? takes[sh.selectedTakeIndex]
          : takes[takes.length - 1]
        return sel?.status === 'queued' || sel?.status === 'processing'
      })
      if (s5Shots.length > 0 && pendingOrFailed.length === 0 && rendering.length > 0) {
        return {
          label: `云端渲染中 (${s5?.readyCount || 0}/${s5Shots.length})…`,
          icon: 'play',
          disabled: true,
          busy: true,
          onClick: () => {},
        }
      }
      if (s5Shots.length > 0 && pendingOrFailed.length === 0) {
        return {
          label: '展开到无限画布',
          icon: 'monitor',
          disabled: materializingCanvas,
          busy: materializingCanvas,
          onClick: () => {
            void handleMaterializeCanvas(false)
          },
        }
      }
      return {
        label: runningStage ? '提交视频中…' : '批量生成视频',
        icon: 'sparkles',
        disabled: runningStage || advancingRun,
        busy: runningStage,
        onClick: () => {
          const targetShotIds = s5Shots.length > 0 ? pendingOrFailed.map((sh) => sh.shotId) : undefined
          void handleTopbarGenerateVideos(targetShotIds)
        },
      }
    }

    const stageOutput = activeItem.stageOutputs?.[activeStage]
    const nextStage = getNextWorkflowStage(activeStage, activeRun.templateSnapshot?.stages)
    if (!stageOutput || activeStageState.status === 'failed') {
      return {
        label: runningStage ? '运行中…' : '运行当前环节',
        icon: 'play',
        disabled: runningStage || advancingRun,
        busy: runningStage,
        onClick: () => {
          const blockReason = getStageRunBlockReason(activeItem, activeStage)
          if (blockReason) {
            notify(blockReason, 'error')
            return
          }
          void handleRunStage(activeStage, { forceRerun: true }).catch(() => {})
        },
      }
    }
    if (activeStageState.status === 'waiting_review' || activeStageState.status === 'pending') {
      return {
        label: savingDraft ? '保存确认中…' : '确认并继续生成',
        icon: 'check',
        disabled: runningStage || advancingRun || savingDraft || isViewingTrial,
        busy: savingDraft,
        onClick: () => {
          const latestDraft = activeDraftGetterRef.current?.() ?? stageOutput
          const blockReason = getApprovalBlockReason(activeItem, activeStage, latestDraft)
          if (blockReason) {
            notify(blockReason, 'error')
            return
          }
          void handleReviewStage(activeStage, 'approve', latestDraft).catch(() => {})
        },
      }
    }
    if (nextStage) {
      return {
        label: '进入下一环节',
        icon: 'arrowRight',
        disabled: runningStage || advancingRun || savingDraft,
        busy: false,
        onClick: () => {
          void switchActiveStage(nextStage).catch(() => {})
        },
      }
    }
    return {
      label: '运行当前环节',
      icon: 'play',
      disabled: runningStage || advancingRun,
      busy: runningStage,
      onClick: () => {
        void handleRunStage(activeStage, { forceRerun: true })
      },
    }
  }, [
    activeItem,
    activeRun,
    activeStage,
    activeStageState.status,
    advancingRun,
    flushDirtyDraftBeforeSwitch,
    handleMaterializeCanvas,
    handleReviewStage,
    handleRunStage,
    handleTopbarGenerateVideos,
    isViewingTrial,
    materializingCanvas,
    runAutoPipelineLoop,
    runningStage,
    savingDraft,
    switchActiveStage,
  ])

  const projectNavigation: FosProjectNavigation | undefined = projectId
    ? {
        projectId,
        projectName: projectName || activeRun?.title || '视频工作流作品',
        activeItem: 'batch',
        creationMode: 'batch_workflow',
      }
    : undefined

  const showVideoRail = items.length >= 2
  const currentStaleKey = activeItem ? `${activeItem.id}:${activeStage}:${activeStageState.finishedAt || ''}` : null
  const autoWaitingReviewMessage = activeRun && activeItem ? getAutoWaitingReviewMessage(activeRun, activeItem) : null
  const showStaleBanner = Boolean(
    activeStageState.stale && currentStaleKey && !dismissedStaleKeys.has(currentStaleKey),
  )

  const textModelLabel = resolveModelDisplayLabel(modelConfig.textModelKey, genConfig.rawTextModels)
  const imageModelLabel = resolveModelDisplayLabel(modelConfig.imageModelKey, genConfig.rawImageModels)
  const videoModelLabel = resolveModelDisplayLabel(modelConfig.videoModelKey, genConfig.rawVideoModels)

  const stageOutputForDock = activeItem?.stageOutputs?.[activeStage] ?? null
  const stageQcReport = ((stageOutputForDock as { qc?: WorkflowQcReport } | null)?.qc || null)
  const qcPanel = useMemo(() => buildQcPanelViewModel(stageQcReport), [stageQcReport])
  const handleLocateQcPath = useCallback((path: string) => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-qc-path]'))
    const target = targets.find((element) => element.dataset.qcPath === path)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    notify(`请在 ${path} 处修改`, 'info')
  }, [notify])
  const realTrialShotOptions = useMemo(
    () => (activeItem?.stageOutputs?.storyboard?.shots ?? []).map((shot) => ({
      shotId: shot.shotId,
      label: `镜头 ${shot.shotIndex}${shot.title ? ` · ${shot.title}` : ''}`,
    })),
    [activeItem?.stageOutputs?.storyboard?.shots],
  )

  const activeModelPopoverAnchorRef =
    openModelPopover === 'text'
      ? textModelBtnRef
      : openModelPopover === 'image'
        ? imageModelBtnRef
        : videoModelBtnRef

  const activeModelPopoverList =
    openModelPopover === 'text'
      ? genConfig.textModels
      : openModelPopover === 'image'
        ? genConfig.imageModels
        : genConfig.videoModels

  return (
    <FosShell
      activeKey="batchWorkflow"
      titlebarTitle={projectId ? `${projectName || '作品'} · 视频工作流` : '视频工作流工作台'}
      projectNavigation={projectNavigation}
    >
      <div className="wf-studio">
        {/* Adaptive Command Header */}
        <header className="wf-topbar">
          <div className="wf-topbar-left">
            <span className="wf-brand-icon">
              <AppIcon name="clapperboard" className="h-4 w-4" />
            </span>

            <button
              ref={runSwitcherRef}
              type="button"
              className="wf-run-switcher"
              aria-haspopup="menu"
              aria-expanded={openRunSwitcher}
              onClick={() => setOpenRunSwitcher((v) => !v)}
            >
              <span>{activeRun?.title || (projectName ? `${projectName} · 工作流` : '新建视频工作流')}</span>
              <AppIcon name="chevronDown" className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </button>

            {activeRun ? (
              <span className="wf-badge is-accent">
                {WORKFLOW_TRACK_LABELS[activeRun.track] || activeRun.track}
              </span>
            ) : null}

            {activeRun && !showVideoRail ? (
              <button
                type="button"
                className="wf-btn wf-btn-subtle wf-btn-xs"
                title="向当前批次追加参考视频或剧本"
                onClick={() => setShowAddItemModal(true)}
              >
                <AppIcon name="plus" className="h-3 w-3" />
                <span>追加视频</span>
              </button>
            ) : null}

            {activeRun ? (
              <button
                type="button"
                className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                disabled={loadingRun}
                title="刷新当前批次状态"
                aria-label="刷新当前批次状态"
                onClick={() => void loadRunDetail(activeRun.id)}
              >
                <AppIcon name="refresh" className={`h-3.5 w-3.5${loadingRun ? ' animate-spin' : ''}`} />
              </button>
            ) : null}

            {hasPendingAsync ? (
              <span className="wf-badge is-info">
                <span className="wf-spinner" style={{ width: 10, height: 10 }} />
                <span>云端生成中</span>
              </span>
            ) : null}
          </div>

          {/* Center Interactive Model Pill Bar */}
          {activeRun ? (
            <div className="wf-model-bar" role="group" aria-label="工作流模型配置">
              <button
                ref={textModelBtnRef}
                type="button"
                className={`wf-model-pill${openModelPopover === 'text' ? ' is-open' : ''}`}
                aria-expanded={openModelPopover === 'text'}
                data-stage="script_rewrite"
                onClick={() => setOpenModelPopover((cur) => (cur === 'text' ? null : 'text'))}
              >
                <span className="wf-model-pill-dot" />
                <span className="wf-model-pill-label">文本</span>
                <span className="wf-model-pill-val" title={textModelLabel}>{textModelLabel}</span>
              </button>

              <button
                ref={imageModelBtnRef}
                type="button"
                className={`wf-model-pill${openModelPopover === 'image' ? ' is-open' : ''}`}
                aria-expanded={openModelPopover === 'image'}
                data-stage="asset_extraction"
                onClick={() => setOpenModelPopover((cur) => (cur === 'image' ? null : 'image'))}
              >
                <span className="wf-model-pill-dot" />
                <span className="wf-model-pill-label">生图</span>
                <span className="wf-model-pill-val" title={imageModelLabel}>{imageModelLabel}</span>
              </button>

              <button
                ref={videoModelBtnRef}
                type="button"
                className={`wf-model-pill is-video${openModelPopover === 'video' ? ' is-open' : ''}`}
                aria-expanded={openModelPopover === 'video'}
                data-stage="video_gen"
                onClick={() => setOpenModelPopover((cur) => (cur === 'video' ? null : 'video'))}
              >
                <span className="wf-model-pill-dot" />
                <span className="wf-model-pill-label">生视频</span>
                <span className="wf-model-pill-val" title={`${videoModelLabel} · ${modelConfig.videoAspectRatio} · ${modelConfig.videoResolution}`}>
                  {videoModelLabel} · {modelConfig.videoAspectRatio} · {modelConfig.videoResolution}
                </span>
              </button>
            </div>
          ) : null}

          {/* Right Actions: Mode Toggle + Primary Run + Canvas + ADMIN-ONLY Skill Controls */}
          <div className="wf-topbar-actions">
            {activeRun ? (
              <>
                <div className="wf-mode-pill" role="group" aria-label="执行模式">
                  <button
                    type="button"
                    className={`wf-mode-pill-btn is-gated${activeRun.runMode === 'gated' ? ' is-active' : ''}`}
                    onClick={() => void handleToggleRunMode('gated')}
                  >
                    分阶段审阅
                  </button>
                  <button
                    type="button"
                    className={`wf-mode-pill-btn is-auto${activeRun.runMode === 'auto' ? ' is-active' : ''}`}
                    onClick={() => void handleToggleRunMode('auto')}
                  >
                    一键全流程
                  </button>
                </div>

                <button
                  type="button"
                  className="wf-btn wf-btn-primary wf-btn-sm"
                  disabled={topbarPrimaryCta.disabled}
                  onClick={topbarPrimaryCta.onClick}
                >
                  {topbarPrimaryCta.busy ? (
                    <span className="wf-spinner" />
                  ) : (
                    <AppIcon name={topbarPrimaryCta.icon} className="h-3.5 w-3.5" />
                  )}
                  <span>{topbarPrimaryCta.label}</span>
                </button>

                {canMaterializeCanvas ? (
                  <button
                    type="button"
                    className="wf-btn wf-btn-sm"
                    disabled={materializingCanvas}
                    onClick={() => void handleMaterializeCanvas(false)}
                  >
                    {materializingCanvas ? (
                      <span className="wf-spinner" />
                    ) : (
                      <AppIcon name="monitor" className="h-3.5 w-3.5" />
                    )}
                    <span>展开到无限画布</span>
                  </button>
                ) : null}
                {activeItem && canvasStaleByItemId[activeItem.id] ? (
                  <span className="wf-badge is-danger" title="当前采用版与画布内容不一致">
                    画布已过期
                  </span>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="wf-btn wf-btn-primary wf-btn-sm"
                onClick={() => setShowCreateRunModal(true)}
              >
                <AppIcon name="plus" className="h-3.5 w-3.5" />新建工作流批次
              </button>
            )}

            {/* STRICT ADMIN-ONLY Skill Controls (Completely hidden when !canManageSkills) */}
            {canManageSkills ? (
              <>
                {activeRun && activeItem ? (
                  <button
                    type="button"
                    className={`wf-btn wf-btn-sm${skillDockOpen ? ' wf-btn-stage' : ''}`}
                    data-stage={activeStage}
                    aria-pressed={skillDockOpen}
                    onClick={() => setSkillDockOpen((v) => !v)}
                  >
                    <AppIcon name="sparkles" className="h-3.5 w-3.5" />
                    <span>✦ 调优 Skill</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wf-btn wf-btn-subtle wf-btn-sm"
                  onClick={() => setSkillLibraryOpen(true)}
                >
                  <AppIcon name="bookOpen" className="h-3.5 w-3.5" />
                  <span>配方库</span>
                </button>
              </>
            ) : null}
          </div>
        </header>

        {/* Compact Persistent 5-Stage Interactive Pipeline Ribbon */}
        {activeRun ? (
          <nav className="wf-ribbon" aria-label="视频工作流管线">
            <div className="wf-ribbon-track">
              {WORKFLOW_STAGES.map((stage, idx) => {
                const meta = WORKFLOW_STAGE_META[stage]
                const st = activeItem?.stageStates?.[stage]
                const isActive = activeStage === stage
                const isOptimisticRunning = runningStageKey === stage
                const stClass = stageStatusClass(st, isOptimisticRunning)
                const skillForStage = resolveStageSkill(stage)
                const hasTrialForStage = Boolean(
                  trialState && activeItem && trialState.stage === stage && trialState.itemId === activeItem.id,
                )
                const nextStage = WORKFLOW_STAGES[idx + 1]
                const nextSt = nextStage ? activeItem?.stageStates?.[nextStage] : null
                const isNextOptimisticRunning = Boolean(nextStage && runningStageKey === nextStage)
                const connectorClass = nextStage
                  ? nextSt?.stale
                    ? 'is-stale'
                    : isOptimisticRunning || isNextOptimisticRunning || st?.status === 'running' || nextSt?.status === 'running'
                      ? 'is-running'
                      : st?.status === 'failed' || st?.qcStatus === 'failed'
                        ? 'is-failed'
                        : st?.status === 'completed' || st?.status === 'approved'
                          ? 'is-done'
                          : ''
                  : ''

                return (
                  <div key={stage} className="contents">
                    <div
                      role="button"
                      tabIndex={0}
                      data-stage={stage}
                      className={`wf-stage-node${isActive ? ' is-active' : ''}${stClass ? ` ${stClass}` : ''}`}
                      title={`${meta.code} ${stageStatusTooltip(stage, st)} · ${meta.description}`}
                      onClick={() => { void switchActiveStage(stage).catch(() => {}) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void switchActiveStage(stage).catch(() => {})
                        }
                      }}
                    >
                      <div className="wf-stage-node-head">
                        <div className="wf-stage-node-left">
                          <span className="wf-stage-index">{idx + 1}</span>
                          <span className="wf-stage-title">{meta.label}</span>
                        </div>
                        <span className="wf-stage-status-dot" />
                      </div>

                      <div className="wf-stage-node-foot">
                        <button
                          ref={(el) => { stageSkillAnchorRefs.current[stage] = el }}
                          type="button"
                          className={`wf-stage-skill-pill${openStageSkillPopover === stage ? ' is-open' : ''}${hasTrialForStage ? ' is-trial' : ''}`}
                          aria-haspopup={canManageSkills ? 'menu' : 'dialog'}
                          aria-expanded={openStageSkillPopover === stage}
                          title={`当前使用配方：${skillForStage?.name || st?.skillName || '默认'}${skillForStage ? ` v${skillForStage.version}` : ''}（点击查看${canManageSkills ? '切换' : '摘要'}）`}
                          onClick={(e) => {
                            e.stopPropagation()
                            stageSkillPopoverAnchorRef.current = e.currentTarget
                            setOpenStageSkillPopover((cur) => (cur === stage ? null : stage))
                          }}
                        >
                          <AppIcon name="sparkles" className="h-2.5 w-2.5 shrink-0" />
                          <span>{skillForStage?.name || st?.skillName || '默认 Skill'}</span>
                          <AppIcon name={canManageSkills ? 'chevronDown' : 'bookOpen'} className="h-2.5 w-2.5 shrink-0 opacity-70" />
                        </button>

                        <span className="wf-stage-status-tag wf-num">
                          {stageOutputBadge(stage, activeItem, st, isOptimisticRunning)}
                          {(isOptimisticRunning || st?.status === 'running') ? <ElapsedSeconds /> : null}
                        </span>
                      </div>
                    </div>

                    {idx < WORKFLOW_STAGES.length - 1 ? (
                      <div
                        className={`wf-stage-connector${connectorClass ? ` ${connectorClass}` : ''}`}
                        data-stage={nextStage}
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </nav>
        ) : null}

        {/* Main Adaptive Workspace Grid */}
        <div className="wf-body">
          {loadingInitial ? (
            <div className="wf-workbench">
              <div className="wf-empty" style={{ flex: 1 }}>
                <span className="wf-spinner" style={{ width: 22, height: 22 }} />
                <div className="wf-empty-title">正在初始化 5 步视频工作流工作台…</div>
              </div>
            </div>
          ) : !activeRun ? (
            <div className="wf-workbench">
              <div className="wf-empty" style={{ flex: 1 }}>
                <span className="wf-empty-icon">
                  <AppIcon name="clapperboard" className="h-6 w-6" />
                </span>
                <div className="wf-empty-title">开启你的第一条 5 步 Skill 视频工作流</div>
                <div className="wf-empty-desc">
                  从参考视频或文字剧本出发，依次完成剧本解析 → 风格洗稿 → 角色/场景/道具一致性出图 → @资产分镜 → 批量生视频，并一键展开到无限画布精修。
                </div>
                <div className="wf-empty-actions">
                  <button
                    type="button"
                    className="wf-btn wf-btn-primary"
                    onClick={() => setShowCreateRunModal(true)}
                  >
                    <AppIcon name="plus" className="h-4 w-4" />新建工作流批次
                  </button>
                  {canManageSkills ? (
                    <button
                      type="button"
                      className="wf-btn"
                      onClick={() => setSkillLibraryOpen(true)}
                    >
                      <AppIcon name="bookOpen" className="h-4 w-4" />浏览 Skill 配方库
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Adaptive Left Video Rail (Auto-hidden when items.length <= 1) */}
              <aside
                className={`wf-video-rail${showVideoRail ? '' : ' is-hidden'}`}
                aria-label="批次视频列表"
              >
                <div className="wf-rail-head">
                  <span>批次视频 ({items.length})</span>
                  <button
                    type="button"
                    className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                    title="追加视频或剧本"
                    aria-label="追加视频或剧本"
                    onClick={() => setShowAddItemModal(true)}
                  >
                    <AppIcon name="plus" className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="wf-rail-list">
                  {items.map((item) => {
                    const isSelected = activeItem?.id === item.id
                    const cover = resolveItemCoverThumb(item)
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        className={`wf-rail-item${isSelected ? ' is-active' : ''}`}
                        onClick={() => { void switchSelectedItem(item).catch(() => {}) }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            void switchSelectedItem(item).catch(() => {})
                          }
                        }}
                      >
                        <div className="wf-rail-thumb">
                          {cover ? (
                            <MediaImage src={cover} alt={item.title} className="w-full h-full object-cover" />
                          ) : (
                            <AppIcon
                              name={item.inputPayload.skipVideoAnalysis ? 'fileText' : 'video'}
                              className="h-4 w-4"
                            />
                          )}
                        </div>
                        <div className="wf-rail-meta">
                          <div className="wf-rail-title" title={item.title}>{item.title}</div>
                          <div className="wf-rail-dots" aria-label="5 步进度">
                            {WORKFLOW_STAGES.map((st) => (
                              <span
                                key={st}
                                className={`wf-rail-dot ${stageStatusClass(item.stageStates?.[st])}`}
                                title={stageStatusTooltip(st, item.stageStates?.[st])}
                              />
                            ))}
                          </div>
                        </div>
                        {items.length > 1 ? (
                          <button
                            type="button"
                            className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm shrink-0"
                            aria-label={`移除 ${item.title}`}
                            title="移除此条目"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDeleteItem(item)
                            }}
                          >
                            <AppIcon name="trash" className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                <div className="wf-rail-foot">
                  <button
                    type="button"
                    className="wf-btn wf-btn-subtle wf-btn-sm w-full"
                    onClick={() => setShowAddItemModal(true)}
                  >
                    <AppIcon name="plus" className="h-3.5 w-3.5" />追加视频 / 剧本
                  </button>
                </div>
              </aside>

              {/* Center Stage Workbench (Redundant workbench header removed — active ribbon node displays stage context) */}
              <section className="wf-workbench" data-stage={activeStage}>
                <div className="wf-workbench-scroll">
                  <div className="wf-workbench-inner">
                    {qcPanel && activeStage !== 'storyboard' ? (
                      <div className={`wf-qc-banner is-${qcPanel.level}`} role={qcPanel.level === 'failed' ? 'alert' : 'status'}>
                        <div className="wf-stale-banner-main">
                          <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
                          <span>质量检查：{qcPanel.level === 'failed' ? '未通过' : '警告'}</span>
                        </div>
                        <ul className="wf-qc-violation-list">
                          {qcPanel.visibleViolations.map((violation, index) => (
                            <li key={`${violation.path}:${violation.rule}:${index}`} className="wf-qc-violation-item">
                              <span className="wf-qc-rule">{violation.rule}</span>
                              <button type="button" className="wf-qc-path wf-qc-path-link" onClick={() => handleLocateQcPath(violation.path)}>
                                {violation.path}
                              </button>
                              <span className="wf-qc-msg">{violation.message}</span>
                            </li>
                          ))}
                          {qcPanel.hiddenCount > 0 ? <li className="wf-qc-violation-item is-more">另有 {qcPanel.hiddenCount} 条</li> : null}
                        </ul>
                      </div>
                    ) : null}
                    {activeStageState.qcStatus === 'failed' ? (
                      <div className="wf-stale-banner" role="alert">
                        <div className="wf-stale-banner-main">
                          <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
                          <span>质量检查未通过，已保留上一版内容；请查看违规项后重试或手工修改。</span>
                        </div>
                        <span className="wf-badge is-danger">质检未通过</span>
                      </div>
                    ) : null}
                    {autoWaitingReviewMessage ? (
                      <div className="wf-stale-banner" role="status">
                        <div className="wf-stale-banner-main">
                          <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
                          <span>{autoWaitingReviewMessage}</span>
                        </div>
                      </div>
                    ) : null}
                    {/* A/B Trial Comparison Bar (when Admin ran a Skill Trial on active stage) */}
                    {activeTrialForStage ? (
                      <div className="wf-ab-bar" role="region" aria-label="Skill 试跑 A/B 对比">
                        <div className="wf-ab-left">
                          {!isActiveTrialDryRun ? (
                            <div className="wf-ab-seg">
                              <button
                                type="button"
                                className={`wf-ab-seg-btn${trialViewMode === 'original' ? ' is-active' : ''}`}
                                onClick={() => setTrialViewMode('original')}
                              >
                                原产出
                              </button>
                              <button
                                type="button"
                                className={`wf-ab-seg-btn${trialViewMode === 'trial' ? ' is-active' : ''}`}
                                onClick={() => setTrialViewMode('trial')}
                              >
                                ✦ 试跑产出
                              </button>
                            </div>
                          ) : null}
                          <div className="wf-ab-meta">
                            <span className="wf-badge is-accent">
                              {isActiveTrialDryRun ? '演练试跑（未消耗额度）' : '锁上游 A/B 对比'}
                            </span>
                            <span>
                              {activeTrialForStage.proposal?.changeSummary?.[0]
                                || (isActiveTrialDryRun
                                  ? '演练试跑已完成（仅校验提示词，未触发视频渲染）'
                                  : '正在对比优化后的 Skill 试跑产出（未覆盖正式稿）')}
                            </span>
                          </div>
                        </div>
                        <div className="wf-ab-actions">
                          <button
                            type="button"
                            className="wf-btn wf-btn-primary wf-btn-xs"
                            disabled={adoptingTrial}
                            onClick={() => void handleAdoptTrialFromAbBar()}
                          >
                            {adoptingTrial ? <span className="wf-spinner" /> : <AppIcon name="check" className="h-3 w-3" />}
                            <span>{adoptingTrial ? '保存中…' : isActiveTrialDryRun ? '发布新版本' : '采用并保存此试跑'}</span>
                          </button>
                          <button
                            type="button"
                            className="wf-btn wf-btn-ghost wf-btn-xs"
                            disabled={adoptingTrial}
                            onClick={() => {
                              setTrialState(null)
                              setTrialViewMode('original')
                            }}
                          >
                            放弃试跑
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Stale Downstream Banner */}
                    {showStaleBanner ? (
                      <div className="wf-stale-banner" role="alert">
                        <div className="wf-stale-banner-main">
                          <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
                          <span>
                            <strong>上游内容已更新</strong>，是否按最新上游重跑本环节？
                            {activeStageState.staleReason ? `（${activeStageState.staleReason}）` : ''}
                          </span>
                        </div>
                        <div className="wf-stale-banner-actions">
                          <button
                            type="button"
                            className="wf-btn wf-btn-warning wf-btn-xs"
                            disabled={runningStage}
                            onClick={() => {
                              if (activeStage === 'video_gen') {
                                void handleGenerateVideos({ forceRerun: true }).catch(() => {})
                              } else if (activeItem) {
                                const blockReason = getStageRunBlockReason(activeItem, activeStage)
                                if (blockReason) {
                                  notify(blockReason, 'error')
                                  return
                                }
                                void handleRunStage(activeStage, { forceRerun: true }).catch(() => {})
                              }
                            }}
                          >
                            重新生成本环节
                          </button>
                          <button
                            type="button"
                            className="wf-btn wf-btn-ghost wf-btn-xs"
                            onClick={() => {
                              if (currentStaleKey) setDismissedStaleKeys((prev) => new Set(prev).add(currentStaleKey))
                              const existing = activeDraftGetterRef.current?.() || activeItem?.stageOutputs?.[activeStage]
                              if (existing) {
                                void handleReviewStage(activeStage, 'save_draft', existing, {
                                  silent: true,
                                  clearStale: true,
                                })
                              }
                            }}
                          >
                            忽略并保留手改稿
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Active Stage Workbench View */}
                    {!activeItem ? (
                      <div className="wf-card">
                        <div className="wf-empty">
                          <div className="wf-empty-title">当前批次还没有视频条目</div>
                          <div className="wf-empty-actions">
                            <button
                              type="button"
                              className="wf-btn wf-btn-primary"
                              onClick={() => setShowAddItemModal(true)}
                            >
                              <AppIcon name="plus" className="h-4 w-4" />添加视频或剧本
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : activeStage === 'script_analysis' ? (
                      <WithElapsedSeconds active={runningStageKey === 'script_analysis'}>
                        {(elapsed) => (
                          <Stage1ScriptAnalysisView
                            projectId={projectId || activeRun.projectId}
                            item={activeItem}
                            artifact={
                              (isViewingTrial
                                ? activeTrialForStage?.trialOutput
                                : activeItem.stageOutputs.script_analysis) as OriginalScriptArtifact | null
                            }
                            isTrialView={isViewingTrial}
                            stageState={activeItem.stageStates.script_analysis}
                            stageParams={activeRun.templateSnapshot?.stageParams?.script_analysis}
                            runMode={activeRun.runMode}
                            running={runningStageKey === 'script_analysis'}
                            elapsedSeconds={elapsed}
                            saving={savingDraft}
                            draftSyncNonce={draftSyncNonce}
                            canManageSkills={canManageSkills}
                            onRunStage={(opts) => handleRunStage('script_analysis', opts)}
                            onFlushBeforeRun={flushDirtyDraftBeforeSwitch}
                            onSaveDraft={(edited) => handleReviewStage('script_analysis', 'save_draft', edited)}
                            onApproveAndNext={(edited) => handleReviewStage('script_analysis', 'approve', edited)}
                            onRegisterGetDraft={registerActiveDraftGetter}
                            onDirtyChange={handleActiveStageDirtyChange}
                            onQuoteSnippet={canManageSkills ? handleQuoteSnippet : undefined}
                            onNotify={notify}
                          />
                        )}
                      </WithElapsedSeconds>
                    ) : activeStage === 'script_rewrite' ? (
                      <WithElapsedSeconds active={runningStageKey === 'script_rewrite'}>
                        {(elapsed) => (
                          <Stage2ScriptRewriteView
                            item={activeItem}
                            originalArtifact={activeItem.stageOutputs.script_analysis || null}
                            artifact={
                              (isViewingTrial
                                ? activeTrialForStage?.trialOutput
                                : activeItem.stageOutputs.script_rewrite) as RewrittenScriptArtifact | null
                            }
                            isTrialView={isViewingTrial}
                            stageState={activeItem.stageStates.script_rewrite}
                            stageParams={activeRun.templateSnapshot?.stageParams?.script_rewrite}
                            running={runningStageKey === 'script_rewrite'}
                            elapsedSeconds={elapsed}
                            saving={savingDraft}
                            draftSyncNonce={draftSyncNonce}
                            canManageSkills={canManageSkills}
                            onRunStage={(paramsOverride, forceRerun) => handleRunStage('script_rewrite', {
                              stageParamsOverride: paramsOverride,
                              forceRerun,
                            })}
                            onSaveDraft={(edited) => handleReviewStage('script_rewrite', 'save_draft', edited)}
                            onFlushBeforeRun={flushDirtyDraftBeforeSwitch}
                            onApproveAndNext={(edited) => handleReviewStage('script_rewrite', 'approve', edited)}
                            onRegisterGetDraft={registerActiveDraftGetter}
                            onDirtyChange={handleActiveStageDirtyChange}
                            onQuoteSnippet={canManageSkills ? handleQuoteSnippet : undefined}
                            onSeedSkillFeedback={canManageSkills ? handleSeedSkillFeedback : undefined}
                            onJumpToStage1={() => { void switchActiveStage('script_analysis').catch(() => {}) }}
                            onNotify={notify}
                          />
                        )}
                      </WithElapsedSeconds>
                    ) : activeStage === 'asset_extraction' ? (
                      <WithElapsedSeconds active={runningStageKey === 'asset_extraction'}>
                        {(elapsed) => (
                          <Stage3AssetsLookbookView
                            projectId={projectId || activeRun.projectId}
                            item={activeItem}
                            artifact={
                              (isViewingTrial
                                ? activeTrialForStage?.trialOutput
                                : activeItem.stageOutputs.asset_extraction) as AssetsArtifact | null
                            }
                            hasUpstreamScript={Boolean(
                              activeItem.stageOutputs.script_rewrite
                              || activeItem.stageOutputs.script_analysis
                              || activeItem.inputPayload.pastedScript,
                            )}
                            isTrialView={isViewingTrial}
                            stageState={activeItem.stageStates.asset_extraction}
                            stageParams={activeRun.templateSnapshot?.stageParams?.asset_extraction}
                            running={runningStageKey === 'asset_extraction'}
                            elapsedSeconds={elapsed}
                            generatingAssets={generatingAssets}
                            saving={savingDraft}
                            draftSyncNonce={draftSyncNonce}
                            canManageSkills={canManageSkills}
                            onRunExtract={(paramsOverride, forceRerun) => handleRunStage('asset_extraction', {
                              stageParamsOverride: paramsOverride,
                              forceRerun,
                            })}
                            onGenerateAssets={handleGenerateAssets}
                            onFlushBeforeRun={flushDirtyDraftBeforeSwitch}
                            onBindAssetMaterial={handleBindAssetMaterial}
                            onSaveDraft={(edited) => handleReviewStage('asset_extraction', 'save_draft', edited)}
                            onApproveAndNext={(edited) => handleReviewStage('asset_extraction', 'approve', edited)}
                            onRegisterGetDraft={registerActiveDraftGetter}
                            onDirtyChange={handleActiveStageDirtyChange}
                            onQuoteSnippet={canManageSkills ? handleQuoteSnippet : undefined}
                            onNotify={notify}
                          />
                        )}
                      </WithElapsedSeconds>
                    ) : activeStage === 'storyboard' ? (
                      <WithElapsedSeconds active={runningStageKey === 'storyboard'}>
                        {(elapsed) => (
                          <Stage4StoryboardView
                            item={activeItem}
                            assetsArtifact={activeItem.stageOutputs.asset_extraction || null}
                            hasUpstreamScript={Boolean(
                              activeItem.stageOutputs.script_rewrite
                              || activeItem.stageOutputs.script_analysis
                              || activeItem.inputPayload.pastedScript,
                            )}
                            artifact={
                              (isViewingTrial
                                ? activeTrialForStage?.trialOutput
                                : activeItem.stageOutputs.storyboard) as StoryboardArtifact | null
                            }
                            modelConfig={modelConfig}
                            videoCapabilities={videoCapabilities}
                            isTrialView={isViewingTrial}
                            stageState={activeItem.stageStates.storyboard}
                            stageParams={activeRun.templateSnapshot?.stageParams?.storyboard}
                            running={runningStageKey === 'storyboard'}
                            elapsedSeconds={elapsed}
                            saving={savingDraft}
                            draftSyncNonce={draftSyncNonce}
                            canManageSkills={canManageSkills}
                            onRunStage={(paramsOverride, forceRerun) => handleRunStage('storyboard', {
                              stageParamsOverride: paramsOverride,
                              forceRerun,
                            })}
                            onUpdateModelConfig={handleApplyModelConfig}
                            onFlushBeforeRun={flushDirtyDraftBeforeSwitch}
                            onSaveDraft={(edited) => handleReviewStage('storyboard', 'save_draft', edited)}
                            onApproveAndNext={(edited) => handleReviewStage('storyboard', 'approve', edited)}
                            onRegisterGetDraft={registerActiveDraftGetter}
                            onDirtyChange={handleActiveStageDirtyChange}
                            onQuoteSnippet={canManageSkills ? handleQuoteSnippet : undefined}
                            onNotify={notify}
                            onJumpToAssets={handleJumpToAssetsAndGenerate}
                          />
                        )}
                      </WithElapsedSeconds>
                    ) : (
                      <Stage5ScreeningRoomView
                        item={activeItem}
                        assetsArtifact={activeItem.stageOutputs.asset_extraction || null}
                        storyboardArtifact={activeItem.stageOutputs.storyboard || null}
                        artifact={activeItem.stageOutputs.video_gen || null}
                        stageState={activeItem.stageStates.video_gen}
                        running={runningStageKey === 'video_gen'}
                        materializing={materializingCanvas}
                        onGenerateVideos={handleGenerateVideos}
                        onSelectTake={handleSelectShotTake}
                        onMaterializeCanvas={handleMaterializeCanvas}
                        onJumpToStoryboard={() => { void switchActiveStage('storyboard').catch(() => {}) }}
                        onJumpToAssets={handleJumpToAssetsAndGenerate}
                        onNotify={notify}
                        videoCapabilities={videoCapabilities}
                      />
                    )}
                  </div>
                </div>
              </section>

              {/* Click-away scrim for slide-over Skill Dock on <= 1480px laptops */}
              {canManageSkills && activeItem && skillDockOpen ? (
                <div
                  className="wf-dock-scrim"
                  aria-hidden="true"
                  onClick={() => setSkillDockOpen(false)}
                />
              ) : null}

              {/* ADMIN-ONLY Right Collapsible Skill Refinement Dock */}
              {canManageSkills && activeItem ? (
                <SkillRefinementDock
                  open={skillDockOpen}
                  stage={activeStage}
                  currentSkill={activeStageSkill}
                  allStageSkills={stageSkillsByStage[activeStage]}
                  runId={activeRun.id}
                  itemId={activeItem.id}
                  itemRevision={expectedRevisionFor(activeRevisionItemRef.current || activeItem)}
                  stageOutput={stageOutputForDock}
                  qcReport={stageQcReport}
                  onLocateQcPath={handleLocateQcPath}
                  quotedSnippet={quotedSnippet}
                  onClearQuotedSnippet={() => setQuotedSnippet(null)}
                  trialShotOptions={realTrialShotOptions}
                  onRealTrial={handleRealShotTrial}
                  trialActive={Boolean(activeTrialForStage)}
                  onClose={() => setSkillDockOpen(false)}
                onTrialResult={(result) => {
                    if (!activeStageSkill) {
                      notify('当前没有可绑定的 Skill，无法保存试跑结果。', 'error')
                      return
                    }
                    const isDryRun =
                      activeStage === 'video_gen'
                      || Boolean(
                        result.trialOutput
                        && typeof result.trialOutput === 'object'
                        && (result.trialOutput as Record<string, unknown>).dryRun === true,
                      )
                    setTrialState({
                      stage: activeStage,
                      itemId: activeItem.id,
                      skillId: activeStageSkill.id,
                      skillVersion: activeStageSkill.version,
                      trialOutput: result.trialOutput,
                      proposal: result.proposal,
                      draftPatch: result.draftPatch,
                    })
                    setTrialViewMode(isDryRun ? 'original' : 'trial')
                    notify(
                      isDryRun
                        ? '演练试跑已完成，可在上方点击「发布新版本」保存 Skill 配方'
                        : 'Skill 试跑已完成，可在上方切换「原产出 ⇄ 试跑产出」对比效果',
                      'success',
                    )
                  }}
                  onDiscardTrial={() => {
                    setTrialState(null)
                    setTrialViewMode('original')
                  }}
                  onSkillSaved={handleSkillSavedFromDock}
                  onSwitchSkill={(skillId, rerunNow, skillDto) => handleSwitchStageSkill(activeStage, skillId, rerunNow, { skillDto })}
                  onNotify={notify}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Zoom-Safe Run Switcher Popover */}
      {openRunSwitcher ? (
        <ViewportPopover
          anchorRef={runSwitcherRef}
          onClose={() => setOpenRunSwitcher(false)}
          width={320}
          maxHeight={420}
          className="wf-popover"
          lockAnchorWhileOpen
        >
          <div className="wf-popover-head">
            <span>工作流批次 ({runs.length})</span>
            <button
              type="button"
              className="wf-btn wf-btn-primary wf-btn-xs"
              onClick={() => {
                setOpenRunSwitcher(false)
                setShowCreateRunModal(true)
              }}
            >
              <AppIcon name="plus" className="h-3 w-3" />新建批次
            </button>
          </div>
          <div className="wf-popover-body">
            {runs.length === 0 ? (
              <div className="p-4 text-center text-[12px] text-[var(--fos-text-4)]">
                暂无工作流批次，点击右上角「新建批次」开始创作。
              </div>
            ) : (
              runs.map((run) => {
                const isCurrent = run.id === activeRun?.id
                return (
                  <div
                    key={run.id}
                    role="button"
                    tabIndex={0}
                    className={`wf-popover-item${isCurrent ? ' is-active' : ''}`}
                    onClick={() => {
                      void switchSelectedRun(run.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void switchSelectedRun(run.id)
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="wf-popover-item-title truncate">{run.title}</div>
                      <div className="wf-popover-item-desc wf-num">
                        {WORKFLOW_TRACK_LABELS[run.track] || run.track} · {run.totalItems} 条任务 · {run.runMode === 'auto' ? '全流程' : '分阶段'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm shrink-0"
                      aria-label={`删除批次 ${run.title}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeleteRun(run)
                      }}
                    >
                      <AppIcon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </ViewportPopover>
      ) : null}

      {/* Zoom-Safe Model Config Popover */}
      {openModelPopover && activeRun ? (
        <ModelConfigPopover
          kind={openModelPopover}
          anchorRef={activeModelPopoverAnchorRef}
          open={Boolean(openModelPopover)}
          onClose={() => setOpenModelPopover(null)}
          modelConfig={modelConfig}
          models={activeModelPopoverList}
          saving={savingModelConfig}
          onApply={handleApplyModelConfig}
        />
      ) : null}

      {/* Zoom-Safe Per-Stage Inline Skill Switcher Popover */}
      {openStageSkillPopover && activeRun && !canManageSkills ? (
        <RecipeSummaryPopover
          skill={resolveStageSkill(openStageSkillPopover)}
          anchorRef={stageSkillPopoverAnchorRef}
          onClose={() => setOpenStageSkillPopover(null)}
        />
      ) : null}
      {openStageSkillPopover && activeRun && canManageSkills ? (
        <ViewportPopover
          anchorRef={stageSkillPopoverAnchorRef}
          onClose={() => setOpenStageSkillPopover(null)}
          width={348}
          maxHeight={440}
          className="wf-popover"
          lockAnchorWhileOpen
        >
          <div className="wf-popover-head">
            <span>{WORKFLOW_STAGE_META[openStageSkillPopover].label} · 切换 Skill</span>
            <span className="wf-badge is-muted wf-num">
              {stageSkillsByStage[openStageSkillPopover].length} 个配方
            </span>
          </div>
          <div className="wf-popover-body">
            {stageSkillsByStage[openStageSkillPopover].map((sk) => {
              const current = resolveStageSkill(openStageSkillPopover)
              const isSelected = current?.id === sk.id
              return (
                <div key={sk.id} className={`wf-popover-item flex-col gap-2${isSelected ? ' is-active' : ''}`}>
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="min-w-0 flex-1">
                      <div className="wf-popover-item-title flex items-center gap-1.5">
                        <span className="truncate">{sk.name}</span>
                        <span className="wf-badge is-muted wf-num">v{sk.version}</span>
                        {sk.isBuiltin ? <span className="wf-badge is-muted">内置</span> : <span className="wf-badge is-accent">自定义</span>}
                      </div>
                      {sk.description ? (
                        <div className="wf-popover-item-desc">{sk.description}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 w-full">
                    <button
                      type="button"
                      className="wf-btn wf-btn-subtle wf-btn-xs flex-1"
                      onClick={() => void handleSwitchStageSkill(openStageSkillPopover, sk.id, false)}
                    >
                      {isSelected ? '当前默认' : '设为本环节默认'}
                    </button>
                    {activeItem ? (
                      <button
                        type="button"
                        className="wf-btn wf-btn-primary wf-btn-xs flex-1"
                        disabled={runningStage}
                        onClick={() => void handleSwitchStageSkill(openStageSkillPopover, sk.id, true)}
                      >
                        切换并重跑本环节
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          {canManageSkills ? (
            <div className="wf-popover-foot">
              <span className="wf-field-hint">管理员可微调提示词并锁上游试跑</span>
              <button
                type="button"
                className="wf-btn wf-btn-stage wf-btn-xs"
                data-stage={openStageSkillPopover}
                onClick={() => {
                  const targetStage = openStageSkillPopover
                  setOpenStageSkillPopover(null)
                  void switchActiveStage(targetStage).catch(() => {})
                  setSkillDockOpen(true)
                }}
              >
                <AppIcon name="sparkles" className="h-3 w-3" />✦ 调优此 Skill
              </button>
            </div>
          ) : null}
        </ViewportPopover>
      ) : null}

      {/* ADMIN-ONLY Skill & Track Template Library Modal */}
      {canManageSkills ? (
        <SkillLibraryModal
          open={skillLibraryOpen}
          initialStage={activeStage}
          skills={skills}
          templates={templates}
          onClose={() => setSkillLibraryOpen(false)}
          onChanged={loadSkillsAndTemplates}
          onNotify={notify}
        />
      ) : null}

      {/* Quick Create Batch Run Modal (Portalled) */}
      {showCreateRunModal ? (
        <ViewportDialogLayer>
          <div
            className="wf-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="新建工作流批次"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !creatingRun) setShowCreateRunModal(false)
            }}
          >
            <div className="wf-modal is-sm">
              <div className="wf-modal-head">
                <div className="wf-modal-title">
                  <AppIcon name="clapperboard" className="h-4 w-4" />
                  <span>新建 5 步视频工作流批次</span>
                </div>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                  aria-label="关闭"
                  disabled={creatingRun}
                  onClick={() => setShowCreateRunModal(false)}
                >
                  <AppIcon name="close" className="h-4 w-4" />
                </button>
              </div>
              <div className="wf-modal-body">
                {!projectId ? (
                  <div className="wf-field">
                    <label className="wf-label">所属作品项目</label>
                    <select
                      className="wf-select"
                      value={newRunProjectId}
                      onChange={(e) => setNewRunProjectId(e.target.value)}
                    >
                      <option value="">请选择作品项目…</option>
                      {projectOptions.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="wf-field">
                  <label className="wf-label">批次名称</label>
                  <input
                    className="wf-input"
                    value={newRunTitle}
                    placeholder="例：短剧二创第 1 批"
                    onChange={(e) => setNewRunTitle(e.target.value)}
                  />
                </div>

                <div className="wf-field-row">
                  <div className="wf-field">
                    <label className="wf-label">赛道组合模板</label>
                    <select
                      className="wf-select"
                      value={newRunTemplateId}
                      onChange={(e) => setNewRunTemplateId(e.target.value)}
                    >
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name}（{WORKFLOW_TRACK_LABELS[tpl.track] || tpl.track}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="wf-field">
                    <label className="wf-label">默认执行模式</label>
                    <div className="wf-mode-pill w-full justify-center" style={{ height: 34 }}>
                      <button
                        type="button"
                        className={`wf-mode-pill-btn is-gated flex-1 justify-center${newRunMode === 'gated' ? ' is-active' : ''}`}
                        onClick={() => setNewRunMode('gated')}
                      >
                        分阶段审阅
                      </button>
                      <button
                        type="button"
                        className={`wf-mode-pill-btn is-auto flex-1 justify-center${newRunMode === 'auto' ? ' is-active' : ''}`}
                        onClick={() => setNewRunMode('auto')}
                      >
                        一键全流程
                      </button>
                    </div>
                  </div>
                </div>

                <div className="wf-field">
                  <label className="wf-label">可选：直接粘贴首条剧本（留空则进入工作台后上传或选择参考视频）</label>
                  <textarea
                    className="wf-textarea"
                    rows={4}
                    value={newRunPastedScript}
                    placeholder="留空即可先建空工作流，稍后在 S1 拖入参考视频或粘贴剧本…"
                    onChange={(e) => setNewRunPastedScript(e.target.value)}
                  />
                </div>
              </div>
              <div className="wf-modal-foot">
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost"
                  disabled={creatingRun}
                  onClick={() => setShowCreateRunModal(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-primary"
                  disabled={creatingRun}
                  onClick={() => void handleCreateRun()}
                >
                  {creatingRun ? <span className="wf-spinner" /> : <AppIcon name="check" className="h-3.5 w-3.5" />}
                  <span>创建并进入工作台</span>
                </button>
              </div>
            </div>
          </div>
        </ViewportDialogLayer>
      ) : null}

      {/* Add Video / Script Item Modal (Portalled) */}
      {showAddItemModal && activeRun ? (
        <ViewportDialogLayer>
          <div
            className="wf-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="追加视频或剧本条目"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !addingItem && !addItemUploading) setShowAddItemModal(false)
            }}
          >
            <div className="wf-modal is-sm">
              <div className="wf-modal-head">
                <div className="wf-modal-title">
                  <AppIcon name="plus" className="h-4 w-4" />
                  <span>向当前批次追加创作条目</span>
                </div>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                  aria-label="关闭"
                  disabled={addingItem || addItemUploading}
                  onClick={() => setShowAddItemModal(false)}
                >
                  <AppIcon name="close" className="h-4 w-4" />
                </button>
              </div>
              <div className="wf-modal-body">
                <input
                  ref={addItemFileRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,.mp4,.mov,.webm,.avi"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void handleUploadAddItemVideo(file)
                  }}
                />

                <div className="wf-field">
                  <label className="wf-label">输入方式</label>
                  <div className="wf-param-pills">
                    <button
                      type="button"
                      className={`wf-param-pill${addItemMode === 'video' ? ' is-active' : ''}`}
                      onClick={() => setAddItemMode('video')}
                    >
                      参考视频
                    </button>
                    <button
                      type="button"
                      className={`wf-param-pill${addItemMode === 'script' ? ' is-active' : ''}`}
                      onClick={() => setAddItemMode('script')}
                    >
                      直接粘贴剧本
                    </button>
                  </div>
                </div>

                <div className="wf-field">
                  <label className="wf-label">条目标题</label>
                  <input
                    className="wf-input"
                    value={addItemTitle}
                    placeholder={`例：第 ${items.length + 1} 条视频`}
                    onChange={(e) => setAddItemTitle(e.target.value)}
                  />
                </div>

                {addItemMode === 'video' ? (
                  <div className="wf-field">
                    <label className="wf-label">参考视频（可选，也可先建条目再在 S1 导入）</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="wf-btn wf-btn-sm"
                        disabled={addItemUploading}
                        onClick={() => addItemFileRef.current?.click()}
                      >
                        {addItemUploading ? <span className="wf-spinner" /> : <AppIcon name="upload" className="h-3.5 w-3.5" />}
                        <span>{addItemUploading ? '上传中…' : '上传本地视频'}</span>
                      </button>
                      <button
                        type="button"
                        className="wf-btn wf-btn-subtle wf-btn-sm"
                        disabled={addItemUploading}
                        onClick={() => setShowAddItemVideoPicker(true)}
                      >
                        <AppIcon name="folderOpen" className="h-3.5 w-3.5" />从资产库选取
                      </button>
                    </div>
                    {addItemVideo ? (
                      <div className="wf-badge is-success mt-1">
                        <AppIcon name="video" className="h-3 w-3" />
                        <span>已选视频：{addItemVideo.title || addItemVideo.id}</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="wf-field">
                    <label className="wf-label">粘贴剧本文本</label>
                    <textarea
                      className="wf-textarea"
                      rows={5}
                      value={addItemScript}
                      placeholder="粘贴分场剧本、口播稿或故事梗概…"
                      onChange={(e) => setAddItemScript(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="wf-modal-foot">
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost"
                  disabled={addingItem || addItemUploading}
                  onClick={() => setShowAddItemModal(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-primary"
                  disabled={addingItem || addItemUploading}
                  onClick={() => void handleAddItemSubmit()}
                >
                  {addingItem ? <span className="wf-spinner" /> : <AppIcon name="plus" className="h-3.5 w-3.5" />}
                  <span>追加到批次</span>
                </button>
              </div>
            </div>
          </div>
        </ViewportDialogLayer>
      ) : null}

      {showAddItemVideoPicker ? (
        <MaterialPickerDialog
          projectId={projectId || activeRun?.projectId}
          type="video"
          title="选择追加的参考视频"
          onSelect={(mat) => {
            setShowAddItemVideoPicker(false)
            setAddItemVideo(mat)
            if (!addItemTitle.trim() && mat.title) setAddItemTitle(mat.title)
          }}
          onClose={() => setShowAddItemVideoPicker(false)}
        />
      ) : null}

      {/* Floating Toasts inside ViewportDialogLayer (never clipped by .fos-app 120% zoom) */}
      {toasts.length > 0 ? (
        <ViewportDialogLayer>
          <div className="wf-toast-stack" role="status" aria-live="polite">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`wf-toast${toast.tone === 'success' ? ' is-success' : toast.tone === 'error' ? ' is-error' : ''}`}
              >
                <span>{toast.text}</span>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                  aria-label="关闭提示"
                  onClick={() => dismissToast(toast.id)}
                >
                  <AppIcon name="close" className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </ViewportDialogLayer>
      ) : null}
    </FosShell>
  )
}
