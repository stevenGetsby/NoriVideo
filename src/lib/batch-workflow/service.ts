/**
 * Workspace-scoped CRUD, Immutable Skill Versioning, Built-in Catalog Merge,
 * and BatchRun Management Service for the 5-Stage Skill-Pluggable Video Workflow.
 *
 * Workspace isolation invariants:
 * - Built-in system records have `userId = null` and are read-only (publish new version / clone to customize).
 * - Custom workspace records are always scoped by `userId = workspaceOwnerId`.
 * - Workspace custom skills (highest immutable version) override built-ins with the same slug.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { workspaceUserWhere } from '@/lib/collaboration/access'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'
import {
  resolveModelKeyForViewer,
  resolveSelectableModelKeyForViewer,
  type ModelViewerContext,
} from '@/lib/platform-services/model-selection'
import {
  BUILTIN_WORKFLOW_SKILLS,
  BUILTIN_WORKFLOW_TEMPLATES,
  getBuiltinWorkflowSkillById,
  getBuiltinWorkflowSkillBySlug,
  getBuiltinWorkflowSkills,
  getBuiltinWorkflowTemplateById,
  getBuiltinWorkflowTemplates,
  isBuiltinSkillId,
  isBuiltinTemplateId,
} from './builtin-presets'
import {
  BATCH_RUN_MODE_VALUES,
  DEFAULT_WORKFLOW_MODEL_CONFIG,
  WORKFLOW_STAGES,
  WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
  buildOriginalScriptFromPastedText,
  createInitialStageStates,
  getFirstEnabledStage,
  hasBatchRunPendingAsyncTasks,
  hasItemPendingAsyncTasks,
  isWorkflowStage,
  normalizeBatchItemInputPayload,
  normalizeWorkflowModelConfig,
  type BatchItemDTO,
  type BatchItemInputPayload,
  type BatchItemStageOutputs,
  type BatchItemStatus,
  type BatchRunDTO,
  type BatchRunItemSeedInput,
  type BatchRunMode,
  type BatchRunStatus,
  type BatchStageState,
  type CreateBatchRunInput,
  type CreateInitialBatchRunForProjectInput,
  type CreateWorkflowSkillInput,
  type CreateWorkflowTemplateInput,
  type PublishWorkflowSkillVersionInput,
  type StageParams,
  type UpdateBatchRunInput,
  type UpdateWorkflowSkillInput,
  type UpdateWorkflowTemplateInput,
  type WorkflowGateMode,
  type WorkflowModelConfig,
  type WorkflowSkillDTO,
  type WorkflowSkillFewShotExample,
  type WorkflowSkillModelPreferences,
  type WorkflowSkillQcRules,
  type WorkflowStage,
  type WorkflowStageParamsMap,
  type WorkflowTemplateDTO,
  type WorkflowTemplateSnapshot,
  type WorkflowTemplateStageConfig,
} from './types'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function cleanText(value: unknown, maxLen = 191): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : ''
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue
}

function toSlug(name: string, prefix: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${ascii || 'custom'}-${suffix}`
}

function normalizeFewShotExamples(value: unknown): WorkflowSkillFewShotExample[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const obj = asRecord(entry)
      const title = cleanText(obj.title, 120)
      const input = typeof obj.input === 'string' ? obj.input.trim() : ''
      const output = typeof obj.output === 'string' ? obj.output.trim() : ''
      if (!title && !input && !output) return null
      return { title: title || '示例', input, output }
    })
    .filter((item): item is WorkflowSkillFewShotExample => Boolean(item))
    .slice(0, 10)
}

function normalizeStageParamsMap(raw: unknown): WorkflowStageParamsMap {
  const obj = asRecord(raw)
  const result: WorkflowStageParamsMap = {}
  for (const stage of WORKFLOW_STAGES) {
    const val = obj[stage]
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[stage] = { ...(val as Record<string, unknown>) } as StageParams
    }
  }
  return result
}

function normalizeTemplateStages(
  rawStages: unknown,
  trackFallback?: string,
): WorkflowTemplateStageConfig[] {
  const incoming = Array.isArray(rawStages) ? rawStages : []
  const byStage = new Map<WorkflowStage, WorkflowTemplateStageConfig>()
  for (const item of incoming) {
    const obj = asRecord(item)
    if (!isWorkflowStage(obj.stage)) continue
    const gateMode: WorkflowGateMode = obj.gateMode === 'auto' ? 'auto' : 'manual_review'
    byStage.set(obj.stage, {
      stage: obj.stage,
      label: cleanText(obj.label, 80) || obj.stage,
      skillSlug: cleanText(obj.skillSlug, 128),
      skillId: cleanText(obj.skillId, 191) || null,
      gateMode,
      enabled: obj.enabled !== false,
      modelKey: cleanText(obj.modelKey, 128) || null,
      options: obj.options && typeof obj.options === 'object' && !Array.isArray(obj.options)
        ? obj.options as Record<string, unknown>
        : null,
    })
  }

  const defaultTemplate =
    BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.track === trackFallback)
    || BUILTIN_WORKFLOW_TEMPLATES[0]

  return WORKFLOW_STAGES.map((stage) => {
    const existing = byStage.get(stage)
    const fallback = defaultTemplate.stages.find((s) => s.stage === stage)!
    if (!existing) return { ...fallback }
    return {
      ...fallback,
      ...existing,
      skillSlug: existing.skillSlug || fallback.skillSlug,
      label: existing.label || fallback.label,
    }
  })
}

export function mapWorkflowSkillRow(row: {
  id: string
  userId: string | null
  slug: string
  name: string
  track: string
  stage: string
  version: number
  parentSkillId?: string | null
  changeNote?: string | null
  isDefault: boolean
  description: string | null
  systemPrompt: string
  fewShotExamples: unknown
  outputSchema: unknown
  modelPreferences: unknown
  qcRules: unknown
  createdAt: Date
  updatedAt: Date
}): WorkflowSkillDTO {
  return {
    id: row.id,
    userId: row.userId,
    isBuiltin: row.userId === null,
    slug: row.slug,
    name: row.name,
    track: row.track,
    stage: isWorkflowStage(row.stage) ? row.stage : 'script_analysis',
    version: row.version,
    parentSkillId: row.parentSkillId ?? null,
    changeNote: row.changeNote ?? null,
    isDefault: row.isDefault,
    description: row.description,
    systemPrompt: row.systemPrompt,
    fewShotExamples: normalizeFewShotExamples(row.fewShotExamples),
    outputSchema: row.outputSchema && typeof row.outputSchema === 'object' && !Array.isArray(row.outputSchema)
      ? row.outputSchema as Record<string, unknown>
      : null,
    modelPreferences: row.modelPreferences && typeof row.modelPreferences === 'object' && !Array.isArray(row.modelPreferences)
      ? row.modelPreferences as WorkflowSkillModelPreferences
      : null,
    qcRules: row.qcRules && typeof row.qcRules === 'object' && !Array.isArray(row.qcRules)
      ? row.qcRules as WorkflowSkillQcRules
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export interface WorkflowSkillSummaryDTO {
  id: string
  userId: string | null
  isBuiltin: boolean
  slug: string
  name: string
  track: string
  stage: WorkflowStage
  version: number
  parentSkillId: string | null
  changeNote: string | null
  isDefault: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}

/** Strips systemPrompt/fewShotExamples/qcRules/modelPreferences/outputSchema for non-admin readers. */
export function toWorkflowSkillSummary(skill: WorkflowSkillDTO): WorkflowSkillSummaryDTO {
  return {
    id: skill.id,
    userId: skill.userId,
    isBuiltin: skill.isBuiltin,
    slug: skill.slug,
    name: skill.name,
    track: skill.track,
    stage: skill.stage,
    version: skill.version,
    parentSkillId: skill.parentSkillId,
    changeNote: skill.changeNote,
    isDefault: skill.isDefault,
    description: skill.description,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }
}

export function mapWorkflowTemplateRow(row: {
  id: string
  userId: string | null
  slug: string
  name: string
  track: string
  description: string | null
  stages: unknown
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}): WorkflowTemplateDTO {
  return {
    id: row.id,
    userId: row.userId,
    isBuiltin: row.userId === null,
    slug: row.slug,
    name: row.name,
    track: row.track,
    description: row.description,
    stages: normalizeTemplateStages(row.stages, row.track),
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapBatchItemRow(row: {
  id: string
  batchRunId: string
  revision?: number | null
  executionKey?: string | null
  index: number
  title: string
  inputPayload: unknown
  currentStage: string
  status: string
  stageStates: unknown
  stageOutputs?: unknown
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}): BatchItemDTO {
  const rawStates = asRecord(row.stageStates)
  const stageStates = {} as Record<WorkflowStage, BatchStageState>
  for (const stage of WORKFLOW_STAGES) {
    const entry = asRecord(rawStates[stage])
    stageStates[stage] = {
      status: (typeof entry.status === 'string' ? entry.status : 'pending') as BatchStageState['status'],
      skillSlug: typeof entry.skillSlug === 'string' ? entry.skillSlug : '',
      skillId: typeof entry.skillId === 'string' ? entry.skillId : null,
      skillName: typeof entry.skillName === 'string' ? entry.skillName : null,
      skillVersion: typeof entry.skillVersion === 'number' && Number.isFinite(entry.skillVersion) ? entry.skillVersion : 1,
      ...(entry.qcStatus === 'passed' || entry.qcStatus === 'warning' || entry.qcStatus === 'failed' ? { qcStatus: entry.qcStatus } : {}),
      ...(typeof entry.attempt === 'number' && Number.isFinite(entry.attempt) ? { attempt: entry.attempt } : {}),
      ...(typeof entry.modelKey === 'string' ? { modelKey: entry.modelKey } : {}),
      startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : null,
      finishedAt: typeof entry.finishedAt === 'string' ? entry.finishedAt : null,
      durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
      error: typeof entry.error === 'string' ? entry.error : null,
      reviewNote: typeof entry.reviewNote === 'string' ? entry.reviewNote : null,
      taskIds: Array.isArray(entry.taskIds) ? entry.taskIds.filter((id): id is string => typeof id === 'string') : [],
      stale: entry.stale === true,
      staleReason: typeof entry.staleReason === 'string' ? entry.staleReason : null,
      trialPending: entry.trialPending === true,
    }
  }

  const stageOutputs = asRecord(row.stageOutputs) as BatchItemStageOutputs
  const currentStage: WorkflowStage = isWorkflowStage(row.currentStage)
    ? row.currentStage
    : 'script_analysis'

  return {
    id: row.id,
    batchRunId: row.batchRunId,
    revision: typeof row.revision === 'number' && Number.isFinite(row.revision) ? row.revision : 0,
    executionKey: typeof row.executionKey === 'string' ? row.executionKey : null,
    index: row.index,
    title: row.title,
    inputPayload: normalizeBatchItemInputPayload(asRecord(row.inputPayload) as Partial<BatchItemInputPayload>),
    currentStage,
    status: row.status as BatchItemStatus,
    stageStates,
    stageOutputs,
    errorMessage: row.errorMessage,
    hasPendingAsyncTasks: hasItemPendingAsyncTasks({ stageOutputs, stageStates }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * A lightweight item shape for `GET /runs` (list view) that deliberately omits stageOutputs
 * (heavy per-asset/take payloads). Detects pending async work from stageStates.taskIds + status
 * since the heavy column is not loaded.
 */
export interface BatchItemSummaryDTO extends Omit<BatchItemDTO, 'stageOutputs' | 'hasPendingAsyncTasks'> {
  stageOutputs: Record<string, never>
  hasPendingAsyncTasks: boolean
  summary: true
}

export function toBatchItemSummary(detail: BatchItemDTO): BatchItemSummaryDTO {
  const hasPendingAsync = WORKFLOW_STAGES.some((stage) => {
    const stg = detail.stageStates[stage]
    if (!stg) return false
    if (stg.status === 'running' && (stg.taskIds?.length ?? 0) > 0) return true
    return false
  })
  return {
    id: detail.id,
    batchRunId: detail.batchRunId,
    revision: detail.revision,
    executionKey: detail.executionKey,
    index: detail.index,
    title: detail.title,
    inputPayload: detail.inputPayload,
    currentStage: detail.currentStage,
    status: detail.status,
    stageStates: detail.stageStates,
    stageOutputs: {},
    errorMessage: detail.errorMessage,
    hasPendingAsyncTasks: hasPendingAsync,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    summary: true,
  }
}

export function mapBatchRunRow(row: {
  id: string
  userId: string
  createdById: string
  workId: string | null
  projectId: string
  templateId: string
  templateSnapshot: unknown
  title: string
  track: string
  runMode: string
  status: string
  totalItems: number
  completedItems: number
  failedItems: number
  createdAt: Date
  updatedAt: Date
  items?: Array<Parameters<typeof mapBatchItemRow>[0]>
}, options?: { summaryItems?: boolean }): BatchRunDTO {
  const snapshotObj = asRecord(row.templateSnapshot)
  const fallbackTemplate =
    BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.track === row.track)
    || BUILTIN_WORKFLOW_TEMPLATES[0]
  const modelConfig = normalizeWorkflowModelConfig(asRecord(snapshotObj.modelConfig))
  const stageParams = normalizeStageParamsMap(snapshotObj.stageParams)

  const templateSnapshot: WorkflowTemplateSnapshot = {
    id: cleanText(snapshotObj.id) || row.templateId,
    userId: typeof snapshotObj.userId === 'string' ? snapshotObj.userId : null,
    isBuiltin: snapshotObj.isBuiltin === true || snapshotObj.userId == null,
    slug: cleanText(snapshotObj.slug) || fallbackTemplate.slug,
    name: cleanText(snapshotObj.name) || fallbackTemplate.name,
    track: cleanText(snapshotObj.track) || row.track,
    description: typeof snapshotObj.description === 'string' ? snapshotObj.description : null,
    stages: normalizeTemplateStages(snapshotObj.stages, row.track),
    isDefault: snapshotObj.isDefault === true,
    createdAt: typeof snapshotObj.createdAt === 'string' ? snapshotObj.createdAt : row.createdAt.toISOString(),
    updatedAt: typeof snapshotObj.updatedAt === 'string' ? snapshotObj.updatedAt : row.updatedAt.toISOString(),
    modelConfig,
    stageParams,
  }

  const mappedItems = row.items
    ? (options?.summaryItems
        ? row.items.map((item) => toBatchItemSummary(mapBatchItemRow(item)))
        : row.items.map(mapBatchItemRow))
    : undefined

  return {
    id: row.id,
    userId: row.userId,
    createdById: row.createdById,
    workId: row.workId,
    projectId: row.projectId,
    templateId: row.templateId,
    templateSnapshot,
    modelConfig,
    title: row.title,
    track: row.track,
    runMode: row.runMode === 'auto' ? 'auto' : 'gated',
    status: row.status as BatchRunStatus,
    totalItems: row.totalItems,
    completedItems: row.completedItems,
    failedItems: row.failedItems,
    hasPendingAsyncTasks: hasBatchRunPendingAsyncTasks(mappedItems),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(mappedItems ? { items: mappedItems } : {}),
  }
}

// ============================================================
// Pure Skill Resolution Precedence Helper (exported for tests)
// ============================================================

/**
 * Resolves the active Skill with strict precedence:
 * 1. Explicit `skillId` (workspace custom or built-in)
 * 2. Explicit `skillSlug` -> workspace custom skill (highest version) beats built-in
 * 3. Default skill for `(track, stage)` -> workspace custom default beats built-in default
 * 4. Any workspace or built-in skill for `stage` (so shared S5 skills work across all tracks!)
 */
export function selectResolvedWorkflowSkill(params: {
  workspaceSkills: readonly WorkflowSkillDTO[]
  builtinSkills?: readonly WorkflowSkillDTO[]
  skillId?: string | null
  skillSlug?: string | null
  track?: string
  stage: WorkflowStage
}): WorkflowSkillDTO | null {
  const builtins = params.builtinSkills || BUILTIN_WORKFLOW_SKILLS
  const track = params.track || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE

  if (params.skillId) {
    const wsMatch = params.workspaceSkills.find((s) => s.id === params.skillId && s.stage === params.stage)
    if (wsMatch) return wsMatch
    const biMatch = builtins.find((s) => s.id === params.skillId && s.stage === params.stage)
    if (biMatch) return biMatch
  }

  if (params.skillSlug) {
    const wsBySlug = params.workspaceSkills
      .filter((s) => s.slug === params.skillSlug && s.stage === params.stage)
      .sort((a, b) => b.version - a.version)
    if (wsBySlug[0]) return wsBySlug[0]
    const biBySlug = builtins.find((s) => s.slug === params.skillSlug && s.stage === params.stage)
    if (biBySlug) return biBySlug
  }

  const wsDefault = params.workspaceSkills
    .filter((s) => s.track === track && s.stage === params.stage && s.isDefault)
    .sort((a, b) => b.version - a.version)
  if (wsDefault[0]) return wsDefault[0]

  const biDefault = builtins.find((s) => s.track === track && s.stage === params.stage && s.isDefault)
  if (biDefault) return biDefault

  const wsTrackAny = params.workspaceSkills
    .filter((s) => s.track === track && s.stage === params.stage)
    .sort((a, b) => b.version - a.version)
  if (wsTrackAny[0]) return wsTrackAny[0]

  const biTrackAny = builtins.find((s) => s.track === track && s.stage === params.stage)
  if (biTrackAny) return biTrackAny

  const wsAny = params.workspaceSkills
    .filter((s) => s.stage === params.stage)
    .sort((a, b) => b.version - a.version)
  if (wsAny[0]) return wsAny[0]

  return builtins.find((s) => s.stage === params.stage) || null
}

// ============================================================
// Skills CRUD & Immutable Versioning
// ============================================================

export async function listWorkflowSkills(params: {
  workspaceOwnerId: string
  track?: string
  stage?: WorkflowStage
  includeAllVersions?: boolean
}): Promise<WorkflowSkillDTO[]> {
  const dbRows = await prisma.workflowSkill.findMany({
    where: {
      OR: [{ userId: null }, { userId: params.workspaceOwnerId }],
      ...(params.track ? { track: params.track } : {}),
      ...(params.stage ? { stage: params.stage } : {}),
    },
    orderBy: [{ stage: 'asc' }, { version: 'desc' }, { updatedAt: 'desc' }],
  })

  const dbSkills = dbRows
    .filter((row) => isWorkflowStage(row.stage))
    .map(mapWorkflowSkillRow)

  const builtins = getBuiltinWorkflowSkills({ track: params.track, stage: params.stage })

  let customSkills = dbSkills.filter((s) => !s.isBuiltin)
  if (!params.includeAllVersions) {
    // Keep only the latest immutable version per custom slug in the main picker
    const latestBySlug = new Map<string, WorkflowSkillDTO>()
    for (const skill of customSkills) {
      const existing = latestBySlug.get(skill.slug)
      if (!existing || skill.version > existing.version) {
        latestBySlug.set(skill.slug, skill)
      }
    }
    customSkills = Array.from(latestBySlug.values())
  }

  const dbBuiltinSkills = dbSkills.filter((s) => s.isBuiltin)
  const dbIds = new Set(dbSkills.map((s) => s.id))
  const overriddenSlugs = new Set(customSkills.map((s) => s.slug))

  const visibleBuiltins = [
    ...dbBuiltinSkills,
    ...builtins.filter((s) => !dbIds.has(s.id)),
  ].filter((s) => params.includeAllVersions || !overriddenSlugs.has(s.slug))

  const merged = [...customSkills, ...visibleBuiltins]

  const stageOrder = new Map(WORKFLOW_STAGES.map((stage, idx) => [stage, idx]))
  return merged.sort((a, b) => {
    const stageDiff = (stageOrder.get(a.stage) ?? 99) - (stageOrder.get(b.stage) ?? 99)
    if (stageDiff !== 0) return stageDiff
    if (a.isBuiltin !== b.isBuiltin) return a.isBuiltin ? 1 : -1
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return b.version - a.version
  })
}

/**
 * Lists all immutable versions of a Skill `slug` in this workspace (newest first),
 * including the built-in v1 ancestor when `slug` originated from a built-in Skill.
 */
export async function listSkillVersions(params: {
  workspaceOwnerId: string
  slug: string
}): Promise<WorkflowSkillDTO[]> {
  const slug = cleanText(params.slug, 128)
  if (!slug) return []

  const dbRows = await prisma.workflowSkill.findMany({
    where: {
      slug,
      OR: [{ userId: null }, { userId: params.workspaceOwnerId }],
    },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  })

  const versions = dbRows
    .filter((row) => isWorkflowStage(row.stage))
    .map(mapWorkflowSkillRow)

  const builtin = getBuiltinWorkflowSkillBySlug(slug)
  if (builtin && !versions.some((v) => v.id === builtin.id)) {
    versions.push(builtin)
  }

  return versions.sort((a, b) => b.version - a.version)
}

export async function getWorkflowSkillById(params: {
  workspaceOwnerId: string
  skillId: string
}): Promise<WorkflowSkillDTO | null> {
  if (isBuiltinSkillId(params.skillId)) {
    return getBuiltinWorkflowSkillById(params.skillId)
  }
  const row = await prisma.workflowSkill.findFirst({
    where: {
      id: params.skillId,
      OR: [{ userId: null }, { userId: params.workspaceOwnerId }],
    },
  })
  if (row && isWorkflowStage(row.stage)) return mapWorkflowSkillRow(row)
  return getBuiltinWorkflowSkillById(params.skillId) || getBuiltinWorkflowSkillBySlug(params.skillId)
}

export async function resolveWorkflowSkill(params: {
  workspaceOwnerId: string
  skillId?: string | null
  skillSlug?: string | null
  track?: string
  stage: WorkflowStage
}): Promise<WorkflowSkillDTO> {
  const track = params.track || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE
  const rows = await prisma.workflowSkill.findMany({
    where: {
      userId: params.workspaceOwnerId,
      stage: params.stage,
    },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
  })
  const workspaceSkills = rows
    .filter((row) => isWorkflowStage(row.stage))
    .map(mapWorkflowSkillRow)

  const resolved = selectResolvedWorkflowSkill({
    workspaceSkills,
    skillId: params.skillId,
    skillSlug: params.skillSlug,
    track,
    stage: params.stage,
  })
  if (!resolved) {
    throw new ApiError('NOT_FOUND', { message: `未找到阶段 ${params.stage} 可用的 Skill 配置。` })
  }
  return resolved
}

export async function createWorkflowSkill(params: {
  workspaceOwnerId: string
  input: CreateWorkflowSkillInput
}): Promise<WorkflowSkillDTO> {
  const sourceSkill = params.input.cloneFromSkillId
    ? await getWorkflowSkillById({ workspaceOwnerId: params.workspaceOwnerId, skillId: params.input.cloneFromSkillId })
    : null

  const stage = params.input.stage || sourceSkill?.stage
  if (!isWorkflowStage(stage)) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 所属阶段无效，必须为 5 个标准阶段之一。' })
  }
  const name = cleanText(params.input.name) || (sourceSkill ? `${sourceSkill.name}（自定义版）` : '')
  if (!name) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 名称不能为空。' })
  }
  const systemPrompt = (typeof params.input.systemPrompt === 'string' && params.input.systemPrompt.trim())
    ? params.input.systemPrompt.trim()
    : (sourceSkill?.systemPrompt || '')
  if (!systemPrompt) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 提示词（systemPrompt）不能为空。' })
  }

  const track = cleanText(params.input.track, 64) || sourceSkill?.track || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE
  const slug = cleanText(params.input.slug, 128)
    || (sourceSkill ? `${sourceSkill.slug}-custom-${Date.now().toString(36).slice(-4)}` : toSlug(name, 'skill'))

  const latestVersion = await prisma.workflowSkill.findFirst({
    where: { userId: params.workspaceOwnerId, slug },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const builtinBase = getBuiltinWorkflowSkillBySlug(slug, stage)
  const baseVersion = Math.max(latestVersion?.version || 0, builtinBase?.version || 0)
  const version = baseVersion + 1

  if (params.input.isDefault === true) {
    await prisma.workflowSkill.updateMany({
      where: { userId: params.workspaceOwnerId, track, stage, isDefault: true },
      data: { isDefault: false },
    })
  }

  const created = await prisma.workflowSkill.create({
    data: {
      userId: params.workspaceOwnerId,
      slug,
      name,
      track,
      stage,
      version,
      parentSkillId: cleanText(params.input.parentSkillId, 191) || sourceSkill?.id || null,
      changeNote: cleanText(params.input.changeNote, 2000) || (sourceSkill ? `克隆自 ${sourceSkill.name} v${sourceSkill.version}` : '初始创建'),
      isDefault: params.input.isDefault === true,
      description: params.input.description !== undefined
        ? (cleanText(params.input.description, 1000) || null)
        : (sourceSkill?.description ?? null),
      systemPrompt,
      fewShotExamples: toJsonInput(
        params.input.fewShotExamples !== undefined
          ? normalizeFewShotExamples(params.input.fewShotExamples)
          : (sourceSkill?.fewShotExamples ?? []),
      ),
      outputSchema: params.input.outputSchema !== undefined
        ? (params.input.outputSchema ? toJsonInput(params.input.outputSchema) : undefined)
        : (sourceSkill?.outputSchema ? toJsonInput(sourceSkill.outputSchema) : undefined),
      modelPreferences: params.input.modelPreferences !== undefined
        ? (params.input.modelPreferences ? toJsonInput(params.input.modelPreferences) : undefined)
        : (sourceSkill?.modelPreferences ? toJsonInput(sourceSkill.modelPreferences) : undefined),
      qcRules: params.input.qcRules !== undefined
        ? (params.input.qcRules ? toJsonInput(params.input.qcRules) : undefined)
        : (sourceSkill?.qcRules ? toJsonInput(sourceSkill.qcRules) : undefined),
    },
  })

  return mapWorkflowSkillRow(created)
}

/**
 * Publishes an immutable `version + 1` row under the same `slug` with `parentSkillId` and `changeNote`.
 * Supports publishing from EITHER a workspace custom Skill OR a built-in Skill (which forks into
 * workspace override version `v2` preserving built-in `v1` as its immutable parent!).
 *
 * Wrapped in a transaction so the (userId, slug, version) unique constraint is the authoritative
 * arbiter under concurrent publishes: P2002 → re-read latest version → retry once → surface conflict.
 */
export async function publishWorkflowSkillVersion(params: {
  workspaceOwnerId: string
  skillId: string
  input: PublishWorkflowSkillVersionInput
}): Promise<WorkflowSkillDTO> {
  const source = await getWorkflowSkillById({
    workspaceOwnerId: params.workspaceOwnerId,
    skillId: params.skillId,
  })
  if (!source) {
    throw new ApiError('NOT_FOUND', { message: '基础 Skill 不存在或无权发布新版本。' })
  }

  const nextName = params.input.name !== undefined ? cleanText(params.input.name) : source.name
  if (!nextName) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 名称不能为空。' })
  }
  const nextPrompt = params.input.systemPrompt !== undefined
    ? params.input.systemPrompt.trim()
    : source.systemPrompt
  if (!nextPrompt) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 提示词不能为空。' })
  }

  const builtinBase = getBuiltinWorkflowSkillBySlug(source.slug, source.stage)
  const nextIsDefault = params.input.isDefault !== undefined ? params.input.isDefault : source.isDefault

  const attemptPublish = async () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const latestDbRow = await tx.workflowSkill.findFirst({
      where: { userId: params.workspaceOwnerId, slug: source.slug },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const highestVersion = Math.max(latestDbRow?.version || 0, source.version, builtinBase?.version || 0)
    const nextVersion = highestVersion + 1

    if (nextIsDefault) {
      await tx.workflowSkill.updateMany({
        where: {
          userId: params.workspaceOwnerId,
          track: source.track,
          stage: source.stage,
          isDefault: true,
        },
        data: { isDefault: false },
      })
    }

    const created = await tx.workflowSkill.create({
      data: {
        userId: params.workspaceOwnerId,
        slug: source.slug,
        name: nextName,
        track: source.track,
        stage: source.stage,
        version: nextVersion,
        parentSkillId: source.id,
        changeNote: cleanText(params.input.changeNote, 2000) || `基于 v${source.version} 发布 v${nextVersion}`,
        isDefault: nextIsDefault,
        description: params.input.description !== undefined
          ? (cleanText(params.input.description, 1000) || null)
          : source.description,
        systemPrompt: nextPrompt,
        fewShotExamples: toJsonInput(
          params.input.fewShotExamples !== undefined
            ? normalizeFewShotExamples(params.input.fewShotExamples)
            : source.fewShotExamples,
        ),
        outputSchema: params.input.outputSchema !== undefined
          ? (params.input.outputSchema ? toJsonInput(params.input.outputSchema) : undefined)
          : (source.outputSchema ? toJsonInput(source.outputSchema) : undefined),
        modelPreferences: params.input.modelPreferences !== undefined
          ? (params.input.modelPreferences ? toJsonInput(params.input.modelPreferences) : undefined)
          : (source.modelPreferences ? toJsonInput(source.modelPreferences) : undefined),
        qcRules: params.input.qcRules !== undefined
          ? (params.input.qcRules ? toJsonInput(params.input.qcRules) : undefined)
          : (source.qcRules ? toJsonInput(source.qcRules) : undefined),
      },
    })
    return created
  })

  try {
    const created = await attemptPublish()
    return mapWorkflowSkillRow(created)
  } catch (err) {
    if (isPrismaUniqueConflict(err)) {
      try {
        const retry = await attemptPublish()
        return mapWorkflowSkillRow(retry)
      } catch (retryErr) {
        if (isPrismaUniqueConflict(retryErr)) {
          throw new ApiError('INVALID_PARAMS', {
            message: `Skill「${source.slug}」发布冲突：版本号已被并发占用，请稍后重试。`,
          })
        }
        throw retryErr
      }
    }
    throw err
  }
}

function isPrismaUniqueConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'P2002'
}

/** Fields whose content edits must always create a new immutable version. */
const SKILL_CONTENT_FIELDS: Array<keyof UpdateWorkflowSkillInput> = [
  'systemPrompt',
  'fewShotExamples',
  'qcRules',
  'modelPreferences',
  'outputSchema',
]

function stableSkillContentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableSkillContentJson(entry ?? null)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSkillContentJson(entry ?? null)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hasSkillContentChange(
  existing: {
    systemPrompt: string
    fewShotExamples: unknown
    outputSchema: unknown
    modelPreferences: unknown
    qcRules: unknown
  },
  input: UpdateWorkflowSkillInput,
): boolean {
  if (input.systemPrompt !== undefined && input.systemPrompt.trim() !== existing.systemPrompt) return true
  if (input.fewShotExamples !== undefined) {
    const next = normalizeFewShotExamples(input.fewShotExamples)
    const prev = normalizeFewShotExamples(existing.fewShotExamples)
    if (stableSkillContentJson(next) !== stableSkillContentJson(prev)) return true
  }
  if (input.outputSchema !== undefined) {
    if (stableSkillContentJson(input.outputSchema ?? null) !== stableSkillContentJson(existing.outputSchema ?? null)) return true
  }
  if (input.modelPreferences !== undefined) {
    if (stableSkillContentJson(input.modelPreferences ?? null) !== stableSkillContentJson(existing.modelPreferences ?? null)) return true
  }
  if (input.qcRules !== undefined) {
    if (stableSkillContentJson(input.qcRules ?? null) !== stableSkillContentJson(existing.qcRules ?? null)) return true
  }
  return false
}

export async function updateWorkflowSkill(params: {
  workspaceOwnerId: string
  skillId: string
  input: UpdateWorkflowSkillInput
  /** When true, route to publishWorkflowSkillVersion instead of mutating in place. */
  saveAsNewVersion?: boolean
}): Promise<WorkflowSkillDTO> {
  if (isBuiltinSkillId(params.skillId)) {
    if (params.saveAsNewVersion) {
      return await publishWorkflowSkillVersion({
        workspaceOwnerId: params.workspaceOwnerId,
        skillId: params.skillId,
        input: params.input,
      })
    }
    throw new ApiError('FORBIDDEN', { message: '系统内置 Skill 为只读，请通过发布新版本（saveAsNewVersion）或克隆后编辑。' })
  }
  const existing = await prisma.workflowSkill.findFirst({
    where: { id: params.skillId, userId: params.workspaceOwnerId },
  })
  if (!existing) {
    const builtin = await prisma.workflowSkill.findFirst({ where: { id: params.skillId, userId: null } })
    if (builtin) {
      throw new ApiError('FORBIDDEN', { message: '系统内置 Skill 为只读，请先发布新版本或克隆后再编辑。' })
    }
    throw new ApiError('NOT_FOUND', { message: '自定义 Skill 不存在或无权修改。' })
  }

  const nextName = params.input.name !== undefined ? cleanText(params.input.name) : existing.name
  if (!nextName) throw new ApiError('INVALID_PARAMS', { message: 'Skill 名称不能为空。' })

  if (params.saveAsNewVersion) {
    return await publishWorkflowSkillVersion({
      workspaceOwnerId: params.workspaceOwnerId,
      skillId: params.skillId,
      input: params.input,
    })
  }

  // Immutable version contract: content edits must go through publishWorkflowSkillVersion.
  if (hasSkillContentChange(existing, params.input)) {
    throw new ApiError('INVALID_PARAMS', {
      message: '已发布版本不可原地修改，请发布为新版本。',
    })
  }

  const nextPrompt = existing.systemPrompt

  // Reset other defaults in the same transaction as the metadata update.
  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (params.input.isDefault === true) {
      await tx.workflowSkill.updateMany({
        where: {
          userId: params.workspaceOwnerId,
          track: existing.track,
          stage: existing.stage,
          id: { not: existing.id },
          isDefault: true,
        },
        data: { isDefault: false },
      })
    }
    return await tx.workflowSkill.update({
      where: { id: existing.id },
      data: {
        name: nextName,
        description: params.input.description !== undefined
          ? (cleanText(params.input.description, 1000) || null)
          : existing.description,
        systemPrompt: nextPrompt,
        ...(params.input.changeNote !== undefined
          ? { changeNote: cleanText(params.input.changeNote, 2000) || null }
          : {}),
        ...(params.input.isDefault !== undefined ? { isDefault: params.input.isDefault } : {}),
      },
    })
  })

  return mapWorkflowSkillRow(updated)
}

export async function deleteWorkflowSkill(params: {
  workspaceOwnerId: string
  skillId: string
}): Promise<{ deleted: true; id: string }> {
  if (isBuiltinSkillId(params.skillId)) {
    throw new ApiError('FORBIDDEN', { message: '系统内置 Skill 不允许删除。' })
  }
  const existing = await prisma.workflowSkill.findFirst({
    where: { id: params.skillId, userId: params.workspaceOwnerId },
    select: { id: true },
  })
  if (!existing) {
    const builtin = await prisma.workflowSkill.findFirst({
      where: { id: params.skillId, userId: null },
      select: { id: true },
    })
    if (builtin) {
      throw new ApiError('FORBIDDEN', { message: '系统内置 Skill 不允许删除。' })
    }
    throw new ApiError('NOT_FOUND', { message: '自定义 Skill 不存在或无权删除。' })
  }

  await prisma.workflowSkill.delete({ where: { id: existing.id } })
  return { deleted: true, id: existing.id }
}

// ============================================================
// Templates CRUD
// ============================================================

export async function listWorkflowTemplates(params: {
  workspaceOwnerId: string
  track?: string
}): Promise<WorkflowTemplateDTO[]> {
  const dbRows = await prisma.workflowTemplate.findMany({
    where: {
      OR: [{ userId: null }, { userId: params.workspaceOwnerId }],
      ...(params.track ? { track: params.track } : {}),
    },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  })
  const dbTemplates = dbRows.map(mapWorkflowTemplateRow)
  const builtins = getBuiltinWorkflowTemplates(params.track)
  const dbIds = new Set(dbTemplates.map((t) => t.id))

  return [
    ...dbTemplates.filter((t) => !t.isBuiltin),
    ...dbTemplates.filter((t) => t.isBuiltin),
    ...builtins.filter((t) => !dbIds.has(t.id)),
  ]
}

export async function getWorkflowTemplateById(params: {
  workspaceOwnerId: string
  templateId: string
}): Promise<WorkflowTemplateDTO | null> {
  if (isBuiltinTemplateId(params.templateId)) {
    return getBuiltinWorkflowTemplateById(params.templateId)
  }
  const row = await prisma.workflowTemplate.findFirst({
    where: {
      id: params.templateId,
      OR: [{ userId: null }, { userId: params.workspaceOwnerId }],
    },
  })
  if (row) return mapWorkflowTemplateRow(row)
  return getBuiltinWorkflowTemplateById(params.templateId)
}

export async function createWorkflowTemplate(params: {
  workspaceOwnerId: string
  input: CreateWorkflowTemplateInput
}): Promise<WorkflowTemplateDTO> {
  const source = params.input.cloneFromTemplateId
    ? await getWorkflowTemplateById({
        workspaceOwnerId: params.workspaceOwnerId,
        templateId: params.input.cloneFromTemplateId,
      })
    : null

  const name = cleanText(params.input.name) || (source ? `${source.name}（副本）` : '')
  if (!name) throw new ApiError('INVALID_PARAMS', { message: '赛道模板名称不能为空。' })

  const track = cleanText(params.input.track, 64) || source?.track || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE
  const stages = normalizeTemplateStages(
    Array.isArray(params.input.stages) && params.input.stages.length > 0
      ? params.input.stages
      : source?.stages,
    track,
  )
  const slug = cleanText(params.input.slug, 128) || toSlug(name, 'tpl')

  if (params.input.isDefault === true) {
    await prisma.workflowTemplate.updateMany({
      where: { userId: params.workspaceOwnerId, track, isDefault: true },
      data: { isDefault: false },
    })
  }

  const created = await prisma.workflowTemplate.create({
    data: {
      userId: params.workspaceOwnerId,
      slug,
      name,
      track,
      description: params.input.description !== undefined
        ? (cleanText(params.input.description, 1000) || null)
        : (source?.description ?? null),
      stages: toJsonInput(stages),
      isDefault: params.input.isDefault === true,
    },
  })

  return mapWorkflowTemplateRow(created)
}

export async function updateWorkflowTemplate(params: {
  workspaceOwnerId: string
  templateId: string
  input: UpdateWorkflowTemplateInput
}): Promise<WorkflowTemplateDTO> {
  if (isBuiltinTemplateId(params.templateId)) {
    throw new ApiError('FORBIDDEN', { message: '系统内置模板为只读，请先克隆为自定义模板后再修改。' })
  }
  const existing = await prisma.workflowTemplate.findFirst({
    where: { id: params.templateId, userId: params.workspaceOwnerId },
  })
  if (!existing) {
    const builtin = await prisma.workflowTemplate.findFirst({ where: { id: params.templateId, userId: null } })
    if (builtin) {
      throw new ApiError('FORBIDDEN', { message: '系统内置模板为只读，请先克隆后再修改。' })
    }
    throw new ApiError('NOT_FOUND', { message: '自定义赛道模板不存在或无权修改。' })
  }

  const nextName = params.input.name !== undefined ? cleanText(params.input.name) : existing.name
  if (!nextName) throw new ApiError('INVALID_PARAMS', { message: '赛道模板名称不能为空。' })

  if (params.input.stages !== undefined) {
    await assertTemplateSkillBindingsInWorkspace({
      workspaceOwnerId: params.workspaceOwnerId,
      stages: params.input.stages,
    })
  }

  if (params.input.isDefault === true) {
    await prisma.workflowTemplate.updateMany({
      where: {
        userId: params.workspaceOwnerId,
        track: existing.track,
        id: { not: existing.id },
        isDefault: true,
      },
      data: { isDefault: false },
    })
  }

  const updated = await prisma.workflowTemplate.update({
    where: { id: existing.id },
    data: {
      name: nextName,
      description: params.input.description !== undefined
        ? (cleanText(params.input.description, 1000) || null)
        : existing.description,
      ...(params.input.stages !== undefined
        ? { stages: toJsonInput(normalizeTemplateStages(params.input.stages, existing.track)) }
        : {}),
      ...(params.input.isDefault !== undefined ? { isDefault: params.input.isDefault } : {}),
    },
  })

  return mapWorkflowTemplateRow(updated)
}

/**
 * Validates every non-empty skillId in stage bindings is either a built-in skill id
 * or a Skill row owned by this workspace (built-in rows have userId = null). Prevents
 * cross-workspace rebinding through template PATCH, which would otherwise leak prompts.
 */
async function assertTemplateSkillBindingsInWorkspace(params: {
  workspaceOwnerId: string
  stages: readonly WorkflowTemplateStageConfig[]
}): Promise<void> {
  const ids = new Set<string>()
  for (const stage of params.stages) {
    const id = typeof stage.skillId === 'string' ? stage.skillId.trim() : ''
    if (id && !isBuiltinSkillId(id)) ids.add(id)
  }
  if (ids.size === 0) return
  const owned = await prisma.workflowSkill.findMany({
    where: {
      id: { in: Array.from(ids) },
      OR: [{ userId: null }, { userId: params.workspaceOwnerId }],
    },
    select: { id: true },
  })
  const allowed = new Set(owned.map((row) => row.id))
  for (const id of ids) {
    if (!allowed.has(id)) {
      throw new ApiError('INVALID_PARAMS', {
        message: `模板阶段绑定的 Skill（${id}）不属于本工作区或不存在，无法绑定。`,
      })
    }
  }
}

export async function deleteWorkflowTemplate(params: {
  workspaceOwnerId: string
  templateId: string
}): Promise<{ deleted: true; id: string }> {
  if (isBuiltinTemplateId(params.templateId)) {
    throw new ApiError('FORBIDDEN', { message: '系统内置模板不允许删除。' })
  }
  const existing = await prisma.workflowTemplate.findFirst({
    where: { id: params.templateId, userId: params.workspaceOwnerId },
    select: { id: true },
  })
  if (!existing) {
    const builtin = await prisma.workflowTemplate.findFirst({ where: { id: params.templateId, userId: null }, select: { id: true } })
    if (builtin) throw new ApiError('FORBIDDEN', { message: '系统内置模板不允许删除。' })
    throw new ApiError('NOT_FOUND', { message: '自定义赛道模板不存在或无权删除。' })
  }

  await prisma.workflowTemplate.delete({ where: { id: existing.id } })
  return { deleted: true, id: existing.id }
}

// ============================================================
// Model Config Resolution & NovelPromotionProject Default Sync
// ============================================================

async function resolveProjectDefaultModelConfig(params: {
  projectId: string
  workspaceOwnerId: string
  actorId: string
  template: WorkflowTemplateDTO
  overrides?: Partial<WorkflowModelConfig> | null
}): Promise<WorkflowModelConfig> {
  const novelProj = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
    select: {
      analysisModel: true,
      imageModel: true,
      characterModel: true,
      videoModel: true,
      videoRatio: true,
      videoResolution: true,
      imageResolution: true,
    },
  }).catch(() => null)

  const s5Opts = asRecord(params.template.stages.find((s) => s.stage === 'video_gen')?.options)
  const platformConfig = getPlatformServiceConfigResponse()
  const viewer: ModelViewerContext = {
    userId: params.actorId,
    actorId: params.actorId,
    workspaceOwnerId: params.workspaceOwnerId,
  }

  const pickViewerDefault = (candidate: string | null | undefined, type: 'llm' | 'image' | 'video', fallback: string): string => {
    const resolved = resolveSelectableModelKeyForViewer(platformConfig, cleanText(candidate) || fallback, type, viewer)
    return resolved || cleanText(candidate) || fallback
  }

  const baseConfig = normalizeWorkflowModelConfig({
    textModelKey: pickViewerDefault(novelProj?.analysisModel, 'llm', DEFAULT_WORKFLOW_MODEL_CONFIG.textModelKey),
    imageModelKey: pickViewerDefault(novelProj?.imageModel || novelProj?.characterModel, 'image', DEFAULT_WORKFLOW_MODEL_CONFIG.imageModelKey),
    videoModelKey: pickViewerDefault(novelProj?.videoModel, 'video', DEFAULT_WORKFLOW_MODEL_CONFIG.videoModelKey),
    imageResolution: cleanText(novelProj?.imageResolution) || DEFAULT_WORKFLOW_MODEL_CONFIG.imageResolution,
    videoAspectRatio: cleanText(s5Opts.aspectRatio) || cleanText(novelProj?.videoRatio) || DEFAULT_WORKFLOW_MODEL_CONFIG.videoAspectRatio,
    videoResolution: cleanText(s5Opts.resolution) || cleanText(novelProj?.videoResolution) || DEFAULT_WORKFLOW_MODEL_CONFIG.videoResolution,
    videoDurationSeconds: typeof s5Opts.durationSeconds === 'number' ? s5Opts.durationSeconds : DEFAULT_WORKFLOW_MODEL_CONFIG.videoDurationSeconds,
    videoGenerateAudio: typeof s5Opts.generateAudio === 'boolean' ? s5Opts.generateAudio : DEFAULT_WORKFLOW_MODEL_CONFIG.videoGenerateAudio,
    videoInputMode: cleanText(s5Opts.inputMode) || DEFAULT_WORKFLOW_MODEL_CONFIG.videoInputMode,
  })

  if (!params.overrides) return baseConfig
  return normalizeWorkflowModelConfig({ ...baseConfig, ...params.overrides }, baseConfig)
}

function validateModelConfigForViewer(
  modelConfig: Partial<WorkflowModelConfig>,
  viewer: ModelViewerContext,
): Partial<WorkflowModelConfig> {
  const platformConfig = getPlatformServiceConfigResponse()
  const validated: Partial<WorkflowModelConfig> = { ...modelConfig }

  if (typeof modelConfig.textModelKey === 'string' && modelConfig.textModelKey.trim()) {
    const access = resolveModelKeyForViewer(platformConfig, modelConfig.textModelKey, 'llm', viewer)
    if (!access.allowed) {
      throw new ApiError('FORBIDDEN', { message: `文本模型不可用：${access.reason}` })
    }
    validated.textModelKey = access.modelKey
  }
  if (typeof modelConfig.imageModelKey === 'string' && modelConfig.imageModelKey.trim()) {
    const access = resolveModelKeyForViewer(platformConfig, modelConfig.imageModelKey, 'image', viewer)
    if (!access.allowed) {
      throw new ApiError('FORBIDDEN', { message: `图片模型不可用：${access.reason}` })
    }
    validated.imageModelKey = access.modelKey
  }
  if (typeof modelConfig.videoModelKey === 'string' && modelConfig.videoModelKey.trim()) {
    const access = resolveModelKeyForViewer(platformConfig, modelConfig.videoModelKey, 'video', viewer)
    if (!access.allowed) {
      throw new ApiError('FORBIDDEN', { message: `视频模型不可用：${access.reason}` })
    }
    validated.videoModelKey = access.modelKey
  }

  return validated
}

async function syncProjectModelDefaults(projectId: string, modelConfig: WorkflowModelConfig): Promise<void> {
  await prisma.novelPromotionProject.updateMany({
    where: { projectId },
    data: {
      analysisModel: modelConfig.textModelKey,
      imageModel: modelConfig.imageModelKey,
      characterModel: modelConfig.imageModelKey,
      locationModel: modelConfig.imageModelKey,
      videoModel: modelConfig.videoModelKey,
      videoRatio: modelConfig.videoAspectRatio,
      videoResolution: modelConfig.videoResolution,
      imageResolution: modelConfig.imageResolution,
    },
  }).catch(() => undefined)
}

function extractDefaultStageParamsFromTemplate(template: WorkflowTemplateDTO): WorkflowStageParamsMap {
  const map: WorkflowStageParamsMap = {}
  for (const stg of template.stages) {
    if (stg.options && typeof stg.options === 'object' && Object.keys(stg.options).length > 0) {
      map[stg.stage] = { ...stg.options } as StageParams
    }
  }
  return map
}

async function hydrateBatchItemSeeds(
  workspaceOwnerId: string,
  rawItems: readonly BatchRunItemSeedInput[],
): Promise<Array<{ title: string; inputPayload: BatchItemInputPayload }>> {
  const materialIds = Array.from(new Set(
    rawItems
      .map((entry) => cleanText(entry.input?.sourceVideoMaterialId))
      .filter(Boolean),
  ))

  let matById = new Map<string, { id: string; title: string | null; storageKey: string | null; resultUrl: string | null; metadata: unknown }>()
  if (materialIds.length > 0) {
    const workspaceUsers = await prisma.user.findMany({
      where: workspaceUserWhere(workspaceOwnerId),
      select: { id: true },
    })
    const rows = await prisma.frameosMaterial.findMany({
      where: {
        id: { in: materialIds },
        userId: { in: workspaceUsers.map((u) => u.id) },
        deletedAt: null,
      },
      select: { id: true, title: true, storageKey: true, resultUrl: true, metadata: true },
    })
    matById = new Map(rows.map((r) => [r.id, r]))
  }

  return rawItems.map((entry, idx) => {
    const rawInput = entry.input || {}
    const mat = rawInput.sourceVideoMaterialId ? matById.get(rawInput.sourceVideoMaterialId) : null
    const matMeta = asRecord(mat?.metadata)
    const durationFromMeta = Number(matMeta.durationSeconds ?? matMeta.duration)

    const hydrated = normalizeBatchItemInputPayload({
      ...rawInput,
      ...(mat
        ? {
            sourceVideoStorageKey: rawInput.sourceVideoStorageKey || mat.storageKey || null,
            sourceVideoUrl: rawInput.sourceVideoUrl || mat.resultUrl || null,
            sourceVideoFileName: rawInput.sourceVideoFileName || mat.title || null,
            sourceVideoDurationSec: rawInput.sourceVideoDurationSec
              ?? (Number.isFinite(durationFromMeta) && durationFromMeta > 0 ? durationFromMeta : null),
          }
        : {}),
    })

    const explicitTitle = cleanText(entry.title, 191)
    const fallbackTitle =
      cleanText(hydrated.sourceVideoFileName, 80)
      || cleanText(hydrated.productName, 80)
      || (hydrated.pastedScript ? hydrated.pastedScript.split('\n')[0]?.trim().slice(0, 36) : '')
      || `工作流条目 #${idx + 1}`

    return {
      title: (explicitTitle || fallbackTitle).slice(0, 191),
      inputPayload: hydrated,
    }
  })
}

function buildInitialBatchItemRecord(params: {
  index: number
  title: string
  inputPayload: BatchItemInputPayload
  templateSnapshot: WorkflowTemplateSnapshot
}) {
  const firstStage = getFirstEnabledStage(params.templateSnapshot.stages)
  const stageStates = createInitialStageStates(params.templateSnapshot)
  const stageOutputs: BatchItemStageOutputs = {}
  let currentStage: WorkflowStage = firstStage

  // When skipping Stage 1 video analysis with a pasted script, immediately populate
  // OriginalScriptArtifact so the item can jump straight to Stage 2 or Stage 3!
  if (params.inputPayload.skipVideoAnalysis && params.inputPayload.pastedScript) {
    const nowIso = new Date().toISOString()
    stageOutputs.script_analysis = buildOriginalScriptFromPastedText({
      title: params.title,
      pastedScript: params.inputPayload.pastedScript,
      durationTargetSec: params.inputPayload.durationTargetSec,
    })
    stageStates.script_analysis = {
      ...stageStates.script_analysis,
      status: 'completed',
      skillSlug: stageStates.script_analysis.skillSlug || 'pasted-script-import',
      skillName: '粘贴剧本直入（跳过视频解析）',
      startedAt: nowIso,
      finishedAt: nowIso,
      durationMs: 1,
      stale: false,
      staleReason: null,
    }
    currentStage = 'script_rewrite'
  }

  return {
    index: params.index,
    title: params.title.slice(0, 191),
    inputPayload: toJsonInput(params.inputPayload),
    currentStage,
    status: 'queued' as BatchItemStatus,
    stageStates: toJsonInput(stageStates),
    stageOutputs: toJsonInput(stageOutputs),
  }
}

// ============================================================
// BatchRun & BatchItem CRUD
// ============================================================

export async function listBatchRuns(params: {
  workspaceOwnerId: string
  projectId?: string
  track?: string
  status?: BatchRunStatus
  limit?: number
}): Promise<BatchRunDTO[]> {
  const take = Math.max(1, Math.min(100, params.limit ?? 30))
  // Exclude heavy per-item `stageOutputs` from list view to keep payload bounded.
  // The detail GET (`getBatchRunById`) still returns full outputs.
  const rows = await prisma.batchRun.findMany({
    where: {
      userId: params.workspaceOwnerId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.track ? { track: params.track } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      items: {
        orderBy: { index: 'asc' },
        select: {
          id: true,
          batchRunId: true,
          revision: true,
          executionKey: true,
          index: true,
          title: true,
          inputPayload: true,
          currentStage: true,
          status: true,
          stageStates: true,
          stageOutputs: false,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })
  // `stageOutputs` is intentionally excluded from the SELECT — Prisma omits the key entirely,
  // so `mapBatchItemRow` treats it as `undefined` and the summary mapper coerces to `{}`.
  return rows.map((row) => mapBatchRunRow(row, { summaryItems: true }))
}

export async function getBatchRunById(params: {
  workspaceOwnerId: string
  runId: string
  includeItems?: boolean
}): Promise<BatchRunDTO | null> {
  const row = await prisma.batchRun.findFirst({
    where: {
      id: params.runId,
      userId: params.workspaceOwnerId,
    },
    ...(params.includeItems !== false
      ? {
          include: {
            items: { orderBy: { index: 'asc' } },
          },
        }
      : {}),
  })
  if (!row) return null
  return mapBatchRunRow(row)
}

/**
 * Read-only GET accessor. Used to also flush S3/S5 async task statuses via executor sync;
 * that write path is now the responsibility of `POST /runs/[runId]/sync` (Phase 1, package B).
 * The exported name is kept for backward compat — callers must not rely on it triggering writes.
 */
export async function getBatchRunWithStatusSync(params: {
  workspaceOwnerId: string
  runId: string
}): Promise<BatchRunDTO | null> {
  return await getBatchRunById({
    workspaceOwnerId: params.workspaceOwnerId,
    runId: params.runId,
    includeItems: true,
  })
}

async function applyStageSkillOverridesToTemplate(params: {
  workspaceOwnerId: string
  template: WorkflowTemplateDTO
  overrides?: Record<string, string> | null
}): Promise<WorkflowTemplateStageConfig[]> {
  const overrides = params.overrides && typeof params.overrides === 'object' ? params.overrides : {}
  const resolvedStages: WorkflowTemplateStageConfig[] = []
  for (const stageCfg of params.template.stages) {
    const overrideRaw = cleanText(overrides[stageCfg.stage], 191)
    if (!overrideRaw) {
      resolvedStages.push({ ...stageCfg })
      continue
    }
    const skill = await resolveWorkflowSkill({
      workspaceOwnerId: params.workspaceOwnerId,
      skillId: overrideRaw,
      skillSlug: overrideRaw,
      track: params.template.track,
      stage: stageCfg.stage,
    }).catch(() => null)
    resolvedStages.push({
      ...stageCfg,
      skillId: skill?.id ?? stageCfg.skillId ?? null,
      skillSlug: skill?.slug ?? overrideRaw,
    })
  }
  return resolvedStages
}

export async function createBatchRun(params: {
  workspaceOwnerId: string
  actorId: string
  input: CreateBatchRunInput
}): Promise<BatchRunDTO> {
  const projectId = cleanText(params.input.projectId)
  if (!projectId) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择目标作品（projectId）。' })
  }

  let template: WorkflowTemplateDTO | null = null
  if (cleanText(params.input.templateId)) {
    template = await getWorkflowTemplateById({
      workspaceOwnerId: params.workspaceOwnerId,
      templateId: cleanText(params.input.templateId),
    })
  }
  if (!template) {
    const track = cleanText(params.input.track, 64) || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE
    const templates = await listWorkflowTemplates({ workspaceOwnerId: params.workspaceOwnerId, track })
    template = templates.find((t) => t.isDefault) || templates[0] || BUILTIN_WORKFLOW_TEMPLATES[0]
  }

  const runMode: BatchRunMode = params.input.runMode && BATCH_RUN_MODE_VALUES.includes(params.input.runMode)
    ? params.input.runMode
    : 'gated'

  const viewer: ModelViewerContext = {
    userId: params.actorId,
    actorId: params.actorId,
    workspaceOwnerId: params.workspaceOwnerId,
  }
  const validatedOverrides = params.input.modelConfig
    ? validateModelConfigForViewer(params.input.modelConfig, viewer)
    : null

  const modelConfig = await resolveProjectDefaultModelConfig({
    projectId,
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    template,
    overrides: validatedOverrides,
  })

  const resolvedStages = await applyStageSkillOverridesToTemplate({
    workspaceOwnerId: params.workspaceOwnerId,
    template,
    overrides: params.input.stageSkillOverrides,
  })

  const defaultStageParams = extractDefaultStageParamsFromTemplate(template)
  const mergedStageParams: WorkflowStageParamsMap = {
    ...defaultStageParams,
    ...normalizeStageParamsMap(params.input.stageParams),
  }

  const templateSnapshot: WorkflowTemplateSnapshot = {
    ...template,
    stages: resolvedStages,
    modelConfig,
    stageParams: mergedStageParams,
  }

  const rawItems = Array.isArray(params.input.items) ? params.input.items : []
  if (rawItems.length > 50) {
    throw new ApiError('INVALID_PARAMS', { message: '单次工作流批次最多支持 50 条条目，请分批创建。' })
  }
  const hydratedSeeds = await hydrateBatchItemSeeds(params.workspaceOwnerId, rawItems)

  const title = cleanText(params.input.title)
    || (hydratedSeeds.length > 0
      ? `${template.name} · ${hydratedSeeds[0].title}（${hydratedSeeds.length}条）`.slice(0, 191)
      : `${template.name} · 工作流批次`.slice(0, 191))

  const created = await prisma.batchRun.create({
    data: {
      userId: params.workspaceOwnerId,
      createdById: params.actorId,
      workId: cleanText(params.input.workId) || null,
      projectId,
      templateId: templateSnapshot.id,
      templateSnapshot: toJsonInput(templateSnapshot),
      title,
      track: templateSnapshot.track,
      runMode,
      status: 'draft',
      totalItems: hydratedSeeds.length,
      completedItems: 0,
      failedItems: 0,
      ...(hydratedSeeds.length > 0
        ? {
            items: {
              create: hydratedSeeds.map((seed, index) =>
                buildInitialBatchItemRecord({
                  index,
                  title: seed.title,
                  inputPayload: seed.inputPayload,
                  templateSnapshot,
                }),
              ),
            },
          }
        : {}),
    },
    include: {
      items: { orderBy: { index: 'asc' } },
    },
  })

  if (validatedOverrides) {
    await syncProjectModelDefaults(projectId, modelConfig)
  }

  return mapBatchRunRow(created)
}

/**
 * Called by `POST /api/projects` when `creationMode === 'batch_workflow'` to seed
 * the project's initial 5-stage BatchRun. Supports empty draft workbench, video items,
 * pasted-script items, and legacy `initialProduct` config gracefully.
 */
export async function createInitialBatchRunForProject(params: {
  workspaceOwnerId: string
  actorId: string
  workId?: string | null
  projectId: string
  projectName: string
  config?: CreateInitialBatchRunForProjectInput | null
}): Promise<BatchRunDTO> {
  const config = params.config || {}
  const items: BatchRunItemSeedInput[] = []

  if (Array.isArray(config.items) && config.items.length > 0) {
    items.push(...config.items.slice(0, 50))
  } else if (
    cleanText(config.sourceVideoMaterialId)
    || cleanText(config.sourceVideoStorageKey)
    || cleanText(config.sourceVideoUrl)
    || cleanText(config.pastedScript, 200000)
  ) {
    items.push({
      title: cleanText(config.sourceVideoFileName) || params.projectName,
      input: normalizeBatchItemInputPayload({
        sourceVideoMaterialId: config.sourceVideoMaterialId ?? null,
        sourceVideoStorageKey: config.sourceVideoStorageKey ?? null,
        sourceVideoUrl: config.sourceVideoUrl ?? null,
        sourceVideoFileName: config.sourceVideoFileName ?? null,
        pastedScript: config.pastedScript ?? null,
        skipVideoAnalysis: Boolean(config.pastedScript && !config.sourceVideoStorageKey && !config.sourceVideoMaterialId),
      }),
    })
  } else if (config.initialProduct && typeof config.initialProduct === 'object') {
    const prod = asRecord(config.initialProduct)
    const productName = cleanText(prod.productName)
    if (productName) {
      const sellingPoints = Array.isArray(prod.sellingPoints)
        ? prod.sellingPoints.map((s) => cleanText(s)).filter(Boolean)
        : []
      const angles = Array.isArray(config.hookAngles)
        ? config.hookAngles.map((a) => cleanText(a, 120)).filter(Boolean)
        : []
      const effectiveAngles = angles.length > 0 ? angles : [cleanText(prod.hookAngle, 120) || '强痛点反转开场']
      for (const angle of effectiveAngles.slice(0, 20)) {
        const scriptDraft = [
          `商品：${productName}`,
          sellingPoints.length > 0 ? `核心卖点：${sellingPoints.join(' / ')}` : '',
          `切入钩子：${angle}`,
          cleanText(prod.ctaText) ? `收口引导：${cleanText(prod.ctaText)}` : '',
        ].filter(Boolean).join('\n')
        items.push({
          title: `${productName} · ${angle.slice(0, 24)}`,
          input: normalizeBatchItemInputPayload({
            skipVideoAnalysis: true,
            pastedScript: scriptDraft,
            productName,
            sellingPoints,
            hookAngle: angle,
            ctaText: cleanText(prod.ctaText) || undefined,
            aspectRatio: (cleanText(prod.aspectRatio) || '9:16') as BatchItemInputPayload['aspectRatio'],
          }),
        })
      }
    }
  }

  // Always seed 1 draft item on empty project workflow creation so users land directly on the Stage 1 dropzone/paste hero.
  if (items.length === 0) {
    items.push({
      title: cleanText(params.projectName, 120) || '视频 1',
      input: { sourceType: 'video' },
    })
  }

  return await createBatchRun({
    workspaceOwnerId: params.workspaceOwnerId,
    actorId: params.actorId,
    input: {
      projectId: params.projectId,
      workId: params.workId ?? null,
      templateId: config.templateId ?? null,
      track: config.track ?? null,
      title: cleanText(config.title) || `${params.projectName} · 5步工作流`,
      runMode: config.runMode,
      modelConfig: config.modelConfig ?? null,
      stageSkillOverrides: config.stageSkillOverrides ?? null,
      stageParams: config.stageParams ?? null,
      items,
    },
  })
}

export async function updateBatchRunModelConfig(params: {
  workspaceOwnerId: string
  actorId: string
  runId: string
  modelConfig: Partial<WorkflowModelConfig>
}): Promise<BatchRunDTO> {
  const existing = await prisma.batchRun.findFirst({
    where: { id: params.runId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }

  const mapped = mapBatchRunRow(existing)
  const viewer: ModelViewerContext = {
    userId: params.actorId,
    actorId: params.actorId,
    workspaceOwnerId: params.workspaceOwnerId,
  }
  const validatedPatch = validateModelConfigForViewer(params.modelConfig, viewer)
  const nextModelConfig = normalizeWorkflowModelConfig(
    { ...mapped.modelConfig, ...validatedPatch },
    mapped.modelConfig,
  )

  const nextSnapshot: WorkflowTemplateSnapshot = {
    ...mapped.templateSnapshot,
    modelConfig: nextModelConfig,
  }

  const updated = await prisma.batchRun.update({
    where: { id: existing.id },
    data: {
      templateSnapshot: toJsonInput(nextSnapshot),
    },
    include: { items: { orderBy: { index: 'asc' } } },
  })

  await syncProjectModelDefaults(existing.projectId, nextModelConfig)
  return mapBatchRunRow(updated)
}

export async function updateBatchRunStageConfig(params: {
  workspaceOwnerId: string
  runId: string
  stage: WorkflowStage
  patch: {
    skillId?: string | null
    skillSlug?: string | null
    gateMode?: WorkflowGateMode
    enabled?: boolean
    stageParams?: StageParams | null
  }
}): Promise<BatchRunDTO> {
  if (!isWorkflowStage(params.stage)) {
    throw new ApiError('INVALID_PARAMS', { message: `无效的阶段标识：${String(params.stage)}` })
  }
  const existing = await prisma.batchRun.findFirst({
    where: { id: params.runId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }

  const mapped = mapBatchRunRow(existing)
  let resolvedSkill: WorkflowSkillDTO | null = null
  if (params.patch.skillId || params.patch.skillSlug) {
    resolvedSkill = await resolveWorkflowSkill({
      workspaceOwnerId: params.workspaceOwnerId,
      skillId: params.patch.skillId,
      skillSlug: params.patch.skillSlug,
      track: mapped.track,
      stage: params.stage,
    })
  }

  const nextStages = mapped.templateSnapshot.stages.map((stg) => {
    if (stg.stage !== params.stage) return stg
    return {
      ...stg,
      ...(resolvedSkill ? { skillId: resolvedSkill.id, skillSlug: resolvedSkill.slug } : {}),
      ...(params.patch.gateMode ? { gateMode: params.patch.gateMode } : {}),
      ...(typeof params.patch.enabled === 'boolean' ? { enabled: params.patch.enabled } : {}),
    }
  })

  const nextStageParams: WorkflowStageParamsMap = {
    ...mapped.templateSnapshot.stageParams,
    ...(params.patch.stageParams !== undefined
      ? {
          [params.stage]: {
            ...asRecord(mapped.templateSnapshot.stageParams[params.stage]),
            ...asRecord(params.patch.stageParams),
          } as StageParams,
        }
      : {}),
  }

  const nextSnapshot: WorkflowTemplateSnapshot = {
    ...mapped.templateSnapshot,
    stages: nextStages,
    stageParams: nextStageParams,
  }

  const updated = await prisma.batchRun.update({
    where: { id: existing.id },
    data: {
      templateSnapshot: toJsonInput(nextSnapshot),
    },
    include: { items: { orderBy: { index: 'asc' } } },
  })

  return mapBatchRunRow(updated)
}

export async function updateBatchRun(params: {
  workspaceOwnerId: string
  actorId?: string
  runId: string
  input: UpdateBatchRunInput
}): Promise<BatchRunDTO> {
  const existing = await prisma.batchRun.findFirst({
    where: { id: params.runId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }

  const mapped = mapBatchRunRow(existing)
  const nextTitle = params.input.title !== undefined ? cleanText(params.input.title) : existing.title
  if (!nextTitle) throw new ApiError('INVALID_PARAMS', { message: '批次标题不能为空。' })

  const nextRunMode = params.input.runMode !== undefined
    ? (params.input.runMode === 'auto' ? 'auto' : 'gated')
    : existing.runMode

  const nextStatus = params.input.status !== undefined
    ? params.input.status
    : existing.status

  let nextSnapshot: WorkflowTemplateSnapshot = { ...mapped.templateSnapshot }
  let snapshotDirty = false
  let nextModelConfig = mapped.modelConfig

  if (params.input.modelConfig) {
    const viewer: ModelViewerContext = {
      userId: params.actorId || params.workspaceOwnerId,
      actorId: params.actorId || params.workspaceOwnerId,
      workspaceOwnerId: params.workspaceOwnerId,
    }
    const validatedPatch = validateModelConfigForViewer(params.input.modelConfig, viewer)
    nextModelConfig = normalizeWorkflowModelConfig(
      { ...mapped.modelConfig, ...validatedPatch },
      mapped.modelConfig,
    )
    nextSnapshot = { ...nextSnapshot, modelConfig: nextModelConfig }
    snapshotDirty = true
  }

  if (params.input.stageSkillOverrides) {
    const nextStages = await applyStageSkillOverridesToTemplate({
      workspaceOwnerId: params.workspaceOwnerId,
      template: nextSnapshot,
      overrides: params.input.stageSkillOverrides,
    })
    nextSnapshot = { ...nextSnapshot, stages: nextStages }
    snapshotDirty = true
  }

  if (params.input.stageGateOverrides) {
    const gateOverrides = params.input.stageGateOverrides
    nextSnapshot = {
      ...nextSnapshot,
      stages: nextSnapshot.stages.map((stg) => {
        const overrideGate = gateOverrides[stg.stage]
        return overrideGate === 'auto' || overrideGate === 'manual_review'
          ? { ...stg, gateMode: overrideGate }
          : stg
      }),
    }
    snapshotDirty = true
  }

  if (params.input.stageParams) {
    const mergedParams: WorkflowStageParamsMap = { ...nextSnapshot.stageParams }
    for (const stage of WORKFLOW_STAGES) {
      const incoming = params.input.stageParams[stage]
      if (incoming && typeof incoming === 'object') {
        mergedParams[stage] = {
          ...asRecord(mergedParams[stage]),
          ...asRecord(incoming),
        } as StageParams
      }
    }
    nextSnapshot = { ...nextSnapshot, stageParams: mergedParams }
    snapshotDirty = true
  }

  const updated = await prisma.batchRun.update({
    where: { id: existing.id },
    data: {
      title: nextTitle,
      runMode: nextRunMode,
      status: nextStatus,
      ...(snapshotDirty ? { templateSnapshot: toJsonInput(nextSnapshot) } : {}),
    },
    include: {
      items: { orderBy: { index: 'asc' } },
    },
  })

  if (params.input.modelConfig) {
    await syncProjectModelDefaults(existing.projectId, nextModelConfig)
  }

  return mapBatchRunRow(updated)
}

export async function addItemsToBatchRun(params: {
  workspaceOwnerId: string
  runId: string
  items: BatchRunItemSeedInput[]
}): Promise<{ run: BatchRunDTO; addedItems: BatchItemDTO[] }> {
  const existing = await prisma.batchRun.findFirst({
    where: { id: params.runId, userId: params.workspaceOwnerId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: '请至少提供 1 条要添加的视频或剧本文本条目。' })
  }
  if (existing.items.length + params.items.length > 50) {
    throw new ApiError('INVALID_PARAMS', { message: '单个工作流批次最多包含 50 条条目。' })
  }

  const mappedRun = mapBatchRunRow(existing)
  const hydratedSeeds = await hydrateBatchItemSeeds(params.workspaceOwnerId, params.items)
  const startIndex = (mappedRun.items || []).reduce((max, row) => Math.max(max, row.index), -1) + 1

  const createdRows = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const inserted = []
    for (let i = 0; i < hydratedSeeds.length; i += 1) {
      const seed = hydratedSeeds[i]
      const record = buildInitialBatchItemRecord({
        index: startIndex + i,
        title: seed.title,
        inputPayload: seed.inputPayload,
        templateSnapshot: mappedRun.templateSnapshot,
      })
      const createdRow = await tx.batchItem.create({
        data: {
          batchRunId: existing.id,
          ...record,
        },
      })
      inserted.push(createdRow)
    }
    return inserted
  })

  const updatedRun = (await recomputeBatchRunSummary(existing.id)) || mappedRun
  return {
    run: updatedRun,
    addedItems: createdRows.map(mapBatchItemRow),
  }
}

export async function removeBatchItem(params: {
  workspaceOwnerId: string
  runId: string
  itemId: string
}): Promise<{ deleted: true; id: string; run: BatchRunDTO }> {
  const run = await prisma.batchRun.findFirst({
    where: { id: params.runId, userId: params.workspaceOwnerId },
    select: { id: true },
  })
  if (!run) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  const item = await prisma.batchItem.findFirst({
    where: { id: params.itemId, batchRunId: run.id },
    select: { id: true },
  })
  if (!item) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  }

  await prisma.batchItem.delete({ where: { id: item.id } })
  const updatedRun = await recomputeBatchRunSummary(run.id)
  if (!updatedRun) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在。' })
  }
  return { deleted: true, id: item.id, run: updatedRun }
}

export async function deleteBatchRun(params: {
  workspaceOwnerId: string
  runId: string
}): Promise<{ deleted: true; id: string }> {
  const existing = await prisma.batchRun.findFirst({
    where: { id: params.runId, userId: params.workspaceOwnerId },
    select: { id: true },
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权删除。' })
  }
  await prisma.batchRun.delete({ where: { id: existing.id } })
  return { deleted: true, id: existing.id }
}

/**
 * Recomputes aggregate counts and run status from current item statuses.
 */
export async function recomputeBatchRunSummary(runId: string): Promise<BatchRunDTO | null> {
  const run = await prisma.batchRun.findUnique({
    where: { id: runId },
    include: { items: { orderBy: { index: 'asc' } } },
  })
  if (!run) return null

  const mappedRun = mapBatchRunRow(run)
  const mappedItems = mappedRun.items || []
  const totalItems = mappedItems.length
  const completedItems = mappedItems.filter((item) => item.status === 'completed').length
  const failedItems = mappedItems.filter((item) => item.status === 'failed').length
  const waitingReviewItems = mappedItems.filter((item) => item.status === 'waiting_review').length
  const runningItems = mappedItems.filter((item) => item.status === 'running').length

  let nextStatus: BatchRunStatus = run.status as BatchRunStatus
  if (run.status !== 'paused') {
    if (totalItems > 0 && completedItems === totalItems) {
      nextStatus = 'completed'
    } else if (runningItems > 0) {
      nextStatus = 'running'
    } else if (waitingReviewItems > 0) {
      nextStatus = 'waiting_review'
    } else if (failedItems > 0 && completedItems + failedItems === totalItems) {
      nextStatus = 'failed'
    } else if (completedItems > 0 || failedItems > 0) {
      nextStatus = 'running'
    } else {
      nextStatus = 'draft'
    }
  }

  const updated = await prisma.batchRun.update({
    where: { id: run.id },
    data: {
      totalItems,
      completedItems,
      failedItems,
      status: nextStatus,
    },
    include: { items: { orderBy: { index: 'asc' } } },
  })

  return mapBatchRunRow(updated)
}
