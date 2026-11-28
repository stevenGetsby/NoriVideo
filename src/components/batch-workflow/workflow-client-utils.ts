import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type {
  BatchItemDTO,
  BatchRunDTO,
  WorkflowQcReport,
  WorkflowQcViolation,
  WorkflowSkillDTO,
  WorkflowStage,
} from '@/lib/batch-workflow/types'

export interface VideoCapabilityModel {
  modelKey: string
  firstLastFrame?: boolean
  options?: Record<string, unknown> | null
}

export function resolveVideoCapabilities(
  videoModelKey: string,
  rawVideoModels: VideoCapabilityModel[],
): { supportsFirstLastFrame: boolean; minDurationSec: number; maxDurationSec: number } {
  const hit = rawVideoModels.find((model) => model.modelKey === videoModelKey)
  const options = hit?.options && typeof hit.options === 'object' ? hit.options : null
  const rawModes = options?.generationModeOptions || options?.generationMode
  const generationModes = Array.isArray(rawModes)
    ? rawModes.map((value) => String(value).trim()).filter(Boolean)
    : []
  const supportsFirstLastFrame = hit?.firstLastFrame === true
    && (generationModes.length === 0 || generationModes.includes('firstlastframe'))
  let minDurationSec = 4
  let maxDurationSec = 15
  const durationOptions = options?.durationOptions || options?.duration
  if (Array.isArray(durationOptions)) {
    const values = durationOptions.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    if (values.length > 0) {
      minDurationSec = Math.min(...values)
      maxDurationSec = Math.max(...values)
    }
  }
  const maxDuration = Number(options?.maxDurationSeconds ?? options?.maxDuration)
  if (Number.isFinite(maxDuration) && maxDuration > minDurationSec) {
    maxDurationSec = Math.min(30, maxDuration)
  }
  return { supportsFirstLastFrame, minDurationSec, maxDurationSec }
}

export class WorkflowMutationError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'WorkflowMutationError'
  }
}

export function expectedRevisionFor(item?: Pick<BatchItemDTO, 'revision'> | null): number {
  return typeof item?.revision === 'number' && Number.isFinite(item.revision) ? item.revision : 0
}

export function withExpectedRevision<T extends Record<string, unknown>>(
  body: T,
  item?: Pick<BatchItemDTO, 'revision'> | null,
): T & { expectedRevision: number } {
  return { ...body, expectedRevision: expectedRevisionFor(item) }
}

export function describeWorkflowApiError(
  code: string | undefined,
  fallback: string,
  context: 'generic' | 'asset' | 'take' = 'generic',
): string {
  if (code === 'STALE_REVISION') return `服务器已有更新：${fallback}`
  if (code === 'STAGE_ALREADY_RUNNING') return '该环节正在执行，请稍候'
  if (code === 'QC_FAILED') return '质量检查未通过，已保留上一版内容，请查看违规项后重试或手工修改'
  if (code === 'ASSET_NOT_READY') {
    if (context === 'take') return '该镜头版本尚未生成完成，不能采用'
    if (context === 'asset') return '该资产版本尚未就绪'
    return '资产或视频版本尚未就绪'
  }
  if (code === 'MODEL_UNAVAILABLE') return '所选模型当前不可用，请换一个模型后重试'
  return fallback
}

export async function readWorkflowMutationError(
  response: Response,
  fallback: string,
  context: 'generic' | 'asset' | 'take' = 'generic',
): Promise<WorkflowMutationError> {
  let code: string | undefined
  try {
    const payload = await response.clone().json() as {
      code?: unknown
      error?: string | { code?: unknown } | null
    }
    const rawCode = payload.code ?? (typeof payload.error === 'object' ? payload.error?.code : undefined)
    if (typeof rawCode === 'string') code = rawCode
  } catch {
    // The user-facing parser below also handles non-JSON responses.
  }
  const serverMessage = await readApiErrorMessage(response, fallback)
  return new WorkflowMutationError(describeWorkflowApiError(code, serverMessage, context), code)
}

export function isStaleRevisionError(error: unknown): boolean {
  return error instanceof WorkflowMutationError && error.code === 'STALE_REVISION'
}

export function hasMeaningfulStageOutput(item: BatchItemDTO, stage: WorkflowStage, draft?: unknown): boolean {
  const output = draft ?? item.stageOutputs?.[stage]
  if (!output || typeof output !== 'object') return false
  if (stage === 'script_analysis') {
    const artifact = output as { beats?: unknown[]; fullScriptText?: string; editedScriptText?: string }
    return Boolean(artifact.beats?.length || artifact.editedScriptText?.trim() || artifact.fullScriptText?.trim())
  }
  if (stage === 'script_rewrite') return Boolean((output as { scenes?: unknown[] }).scenes?.length)
  if (stage === 'asset_extraction') return Boolean((output as { items?: unknown[] }).items?.length)
  if (stage === 'storyboard') return Boolean((output as { shots?: unknown[] }).shots?.length)
  return Boolean((output as { shots?: unknown[] }).shots?.length)
}

export function getStageRunBlockReason(item: BatchItemDTO, stage: WorkflowStage): string | null {
  if (hasMeaningfulStageOutput(item, stage)) return null
  const input = item.inputPayload
  const hasSource = Boolean(
    input.pastedScript?.trim()
    || input.sourceVideoMaterialId
    || input.sourceVideoStorageKey
    || input.sourceVideoUrl,
  )
  if (stage === 'script_analysis' && !hasSource) return '请先上传参考视频或粘贴剧本，再运行剧本解析。'
  if (stage === 'script_rewrite' && !hasMeaningfulStageOutput(item, 'script_analysis') && !input.pastedScript?.trim()) {
    return '请先完成剧本解析或粘贴原剧本，再运行洗稿。'
  }
  if (stage === 'asset_extraction'
    && !hasMeaningfulStageOutput(item, 'script_rewrite')
    && !hasMeaningfulStageOutput(item, 'script_analysis')
    && !input.pastedScript?.trim()) {
    return '请先完成剧本解析或洗稿，再提取资产。'
  }
  if (stage === 'storyboard' && !hasMeaningfulStageOutput(item, 'asset_extraction')) {
    return '请先生成资产清单，再制作分镜。'
  }
  if (stage === 'video_gen' && !hasMeaningfulStageOutput(item, 'storyboard')) {
    return '请先保存包含镜头的分镜，再生成视频。'
  }
  return null
}

export function getApprovalBlockReason(item: BatchItemDTO, stage: WorkflowStage, draft?: unknown): string | null {
  if (!hasMeaningfulStageOutput(item, stage, draft)) return '当前草稿为空或尚无产物，请先运行本环节。'
  const upstreamStage: Partial<Record<WorkflowStage, WorkflowStage>> = {
    script_rewrite: 'script_analysis',
    asset_extraction: 'script_rewrite',
    storyboard: 'asset_extraction',
    video_gen: 'storyboard',
  }
  const upstream = upstreamStage[stage]
  if (upstream && !hasMeaningfulStageOutput(item, upstream)) {
    if (stage === 'script_rewrite' && item.inputPayload.pastedScript?.trim()) return null
    if (stage === 'asset_extraction' && hasMeaningfulStageOutput(item, 'script_analysis')) return null
    return '上游产物为空，请先完成上一环节再确认。'
  }
  return null
}

export function isTrialForSkill(
  trial: { skillId: string; skillVersion: number; stage: WorkflowStage } | null,
  skill: Pick<WorkflowSkillDTO, 'id' | 'version' | 'stage'> | null,
): boolean {
  return Boolean(trial && skill && trial.skillId === skill.id && trial.skillVersion === skill.version && trial.stage === skill.stage)
}

export function hasBatchRunRunningStages(
  items?: readonly Pick<BatchItemDTO, 'stageStates'>[] | null,
): boolean {
  if (!items || items.length === 0) return false
  return items.some((item) => Object.values(item.stageStates || {}).some((state) => state?.status === 'running'))
}

export function getAutoWaitingReviewMessage(run: BatchRunDTO, item: BatchItemDTO): string | null {
  if (run.runMode !== 'auto') return null
  const state = item.stageStates?.[item.currentStage]
  if (state?.status !== 'waiting_review') return null
  return '自动模式已生成本环节产物，当前停在待确认状态；确认后才会继续提交下游生成。'
}

export function mergePolledRun(
  current: BatchRunDTO | null,
  incoming: BatchRunDTO,
  dirtyItemId?: string | null,
): BatchRunDTO {
  if (!current || current.id !== incoming.id || !dirtyItemId || !incoming.items) return incoming
  const previousItem = current.items?.find((item) => item.id === dirtyItemId)
  if (!previousItem) return incoming
  return {
    ...incoming,
    items: incoming.items.map((item) => item.id === dirtyItemId
      ? { ...item, stageOutputs: previousItem.stageOutputs }
      : item),
  }
}

export async function flushWorkflowDraft(options: {
  request: () => Promise<Response>
  onStaleConflict: () => Promise<void>
  onSaved: (payload: { run?: BatchRunDTO }) => void
  readError: (response: Response) => Promise<Error>
}): Promise<void> {
  const response = await options.request()
  if (!response.ok) {
    const error = await options.readError(response)
    if (isStaleRevisionError(error)) await options.onStaleConflict()
    throw error
  }
  const payload = await response.json() as { run?: BatchRunDTO }
  if (!payload.run) throw new Error('保存成功但未返回最新批次数据。')
  options.onSaved(payload)
}

export interface WorkflowResponseGuard {
  runId: string
  sequence: number
}

export function shouldAcceptWorkflowResponse(
  guard: WorkflowResponseGuard,
  activeRunId: string | null | undefined,
  latestSequence: number,
): boolean {
  return guard.runId === activeRunId && guard.sequence === latestSequence
}

export function shouldClearDirtyAfterRun(
  hadDirty: boolean,
  flushSaved: boolean,
): boolean {
  return !hadDirty || flushSaved
}

export function buildQcPanelViewModel(report: WorkflowQcReport | null | undefined): {
  level: 'failed' | 'warning'
  visibleViolations: WorkflowQcViolation[]
  hiddenCount: number
} | null {
  if (!report || report.status === 'passed') return null
  const violations = Array.isArray(report.violations) ? report.violations : []
  return {
    level: report.status,
    visibleViolations: violations.slice(0, 5),
    hiddenCount: Math.max(0, violations.length - 5),
  }
}

export function hasSkillTrialScopeChanged(
  previous: { itemId: string; skillId: string | null },
  next: { itemId: string; skillId: string | null },
): boolean {
  return previous.itemId !== next.itemId || previous.skillId !== next.skillId
}

export function createInFlightKeyGuard() {
  const active = new Set<string>()
  return {
    acquire(key: string): () => void {
      if (active.has(key)) throw new Error('该镜头正在试跑，请稍候')
      active.add(key)
      let released = false
      return () => {
        if (released) return
        released = true
        active.delete(key)
      }
    },
    has(key: string): boolean {
      return active.has(key)
    },
  }
}

export async function performWithDraftFlush<T>(
  flush: () => Promise<void>,
  action: () => T | Promise<T>,
): Promise<T> {
  // Flush first: a failed draft save must abort the navigation/rerun instead of dropping edits.
  await flush()
  return action()
}

export function startWorkflowSyncPolling(
  callback: (signal: AbortSignal) => void | Promise<void>,
  intervalMs: number,
): () => void {
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null

  const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
  const run = async () => {
    if (stopped || running || isHidden()) return
    running = true
    controller = new AbortController()
    try {
      await callback(controller.signal)
    } catch {
      // Polling errors are reported by the caller and must not create unhandled rejections.
    } finally {
      running = false
      controller = null
      if (!stopped) timer = setTimeout(run, intervalMs)
    }
  }
  const onVisibilityChange = () => {
    if (stopped || isHidden()) return
    if (timer) clearTimeout(timer)
    void run()
  }

  void run()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    controller?.abort()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
