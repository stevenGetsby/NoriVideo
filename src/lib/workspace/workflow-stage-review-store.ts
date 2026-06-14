import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'

export type WorkflowStageReviewState = 'confirmed' | 'review'
export type WorkflowStageReviewSource = 'database'

export type WorkflowStageReviewMap = Record<string, WorkflowStageReviewState>

interface StoreShape {
  updatedAt: string
  states: WorkflowStageReviewMap
}

export interface WorkflowStageReviewPayload extends StoreShape {
  source: WorkflowStageReviewSource
}

const VALID_STATES = new Set<WorkflowStageReviewState>(['confirmed', 'review'])
const WORKFLOW_STAGE_ORDER = ['config', 'script', 'storyboard', 'videos', 'voice', 'editor'] as const
const REVIEW_CONTROL_STATUSES = ['approved', 'pending_review', 'stale'] as const
const STORE_DIR = path.join(process.cwd(), '.runtime', 'workflow-stage-review')
const PROJECT_SCOPE_ID = 'project'
const MAX_STAGE_KEY_LENGTH = 64

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function resolveScopeId(params: { episodeId?: string | null }) {
  return params.episodeId || PROJECT_SCOPE_ID
}

export function resolveWorkflowStageStatusFromReviewState(state: WorkflowStageReviewState) {
  return state === 'confirmed' ? 'approved' : 'pending_review'
}

export function resolveDownstreamWorkflowStageKeys(stageKey: string) {
  const index = WORKFLOW_STAGE_ORDER.indexOf(stageKey as (typeof WORKFLOW_STAGE_ORDER)[number])
  if (index < 0) return []
  return WORKFLOW_STAGE_ORDER.slice(index + 1)
}

export function buildWorkflowStageReviewEffectiveStates(params: {
  previousStates: WorkflowStageReviewMap
  nextStates: WorkflowStageReviewMap
}) {
  const staleStages = new Set<string>()
  for (const [stageKey, previousState] of Object.entries(params.previousStates)) {
    if (previousState !== 'confirmed') continue
    if (params.nextStates[stageKey] === 'confirmed') continue
    for (const downstream of resolveDownstreamWorkflowStageKeys(stageKey)) {
      staleStages.add(downstream)
    }
  }

  const effectiveStates: WorkflowStageReviewMap = { ...params.nextStates }
  for (const stageKey of staleStages) {
    effectiveStates[stageKey] = 'review'
  }

  return {
    states: effectiveStates,
    staleStages: Array.from(staleStages),
  }
}

function storePath(params: { userId: string; projectId: string; episodeId?: string | null }) {
  const scope = resolveScopeId(params)
  return path.join(
    STORE_DIR,
    safeSegment(params.userId),
    safeSegment(params.projectId),
    `${safeSegment(scope)}.json`,
  )
}

function normalizeStates(value: unknown): WorkflowStageReviewMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, WorkflowStageReviewState] => (
      typeof entry[0] === 'string'
      && entry[0].length > 0
      && entry[0].length <= MAX_STAGE_KEY_LENGTH
      && VALID_STATES.has(entry[1] as WorkflowStageReviewState)
    )),
  )
}

function toDate(value: string | null | undefined) {
  if (!value) return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

async function readWorkflowStageReviewFile(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}): Promise<StoreShape | null> {
  try {
    const raw = await fs.readFile(storePath(params), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      states: normalizeStates(parsed.states),
    }
  } catch {
    return null
  }
}

async function removeWorkflowStageReviewFile(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}) {
  await fs.rm(storePath(params), { force: true }).catch(() => undefined)
}

function rowsToStates(rows: Array<{ stageKey: string; reviewState: string | null }>) {
  return Object.fromEntries(
    rows
      .filter((row): row is { stageKey: string; reviewState: WorkflowStageReviewState } => (
        VALID_STATES.has(row.reviewState as WorkflowStageReviewState)
      ))
      .map((row) => [row.stageKey, row.reviewState]),
  ) as WorkflowStageReviewMap
}

async function migrateWorkflowStageReviewFileIfNeeded(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  scopeId: string
}) {
  const filePayload = await readWorkflowStageReviewFile(params)
  if (!filePayload || Object.keys(filePayload.states).length === 0) return
  const updatedAt = toDate(filePayload.updatedAt)

  await Promise.all(Object.entries(filePayload.states).map(([stageKey, reviewState]) => prisma.workflowStageState.upsert({
    where: {
      userId_projectId_scopeId_stageKey: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId: params.scopeId,
        stageKey,
      },
    },
    create: {
      userId: params.userId,
      projectId: params.projectId,
      scopeId: params.scopeId,
      stageKey,
      status: resolveWorkflowStageStatusFromReviewState(reviewState),
      reviewState,
      approvedAt: reviewState === 'confirmed' ? updatedAt : null,
      approvedBy: reviewState === 'confirmed' ? params.userId : null,
      updatedAt,
    },
    update: {
      status: resolveWorkflowStageStatusFromReviewState(reviewState),
      reviewState,
      approvedAt: reviewState === 'confirmed' ? updatedAt : null,
      approvedBy: reviewState === 'confirmed' ? params.userId : null,
      blocker: null,
      updatedAt,
    },
  })))

  await removeWorkflowStageReviewFile(params)
}

export async function readWorkflowStageReviewWithMeta(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}): Promise<WorkflowStageReviewPayload> {
  const scopeId = resolveScopeId(params)

  let rows = await prisma.workflowStageState.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
      reviewState: {
        in: Array.from(VALID_STATES),
      },
    },
    select: {
      stageKey: true,
      reviewState: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  })

  let states = rowsToStates(rows)
  if (Object.keys(states).length === 0) {
    await migrateWorkflowStageReviewFileIfNeeded({ ...params, scopeId })
    rows = await prisma.workflowStageState.findMany({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        reviewState: {
          in: Array.from(VALID_STATES),
        },
      },
      select: {
        stageKey: true,
        reviewState: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })
    states = rowsToStates(rows)
  }

  if (Object.keys(states).length > 0) {
    return {
      source: 'database',
      updatedAt: rows[0]?.updatedAt.toISOString() ?? new Date().toISOString(),
      states,
    }
  }

  return {
    source: 'database',
    updatedAt: new Date().toISOString(),
    states: {},
  }
}

export async function readWorkflowStageReview(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}): Promise<WorkflowStageReviewMap> {
  const payload = await readWorkflowStageReviewWithMeta(params)
  return payload.states
}

export async function writeWorkflowStageReview(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  states: WorkflowStageReviewMap
}): Promise<WorkflowStageReviewPayload> {
  const scopeId = resolveScopeId(params)
  const states = normalizeStates(params.states)
  const updatedAt = new Date()
  let effectiveStates = states

  await prisma.$transaction(async (tx) => {
    const previousRows = await tx.workflowStageState.findMany({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        OR: [
          { reviewState: { in: Array.from(VALID_STATES) } },
          { status: { in: [...REVIEW_CONTROL_STATUSES] } },
        ],
      },
      select: {
        stageKey: true,
        status: true,
        reviewState: true,
      },
    })
    const previousStates = rowsToStates(previousRows.map((row) => ({
      stageKey: row.stageKey,
      reviewState: row.reviewState === 'confirmed' || row.status === 'approved'
        ? 'confirmed'
        : row.reviewState === 'review' || row.status === 'pending_review' || row.status === 'stale'
          ? 'review'
          : null,
    })))
    const plan = buildWorkflowStageReviewEffectiveStates({
      previousStates,
      nextStates: states,
    })
    effectiveStates = plan.states

    await tx.workflowStageState.updateMany({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        OR: [
          { reviewState: { not: null } },
          { status: { in: [...REVIEW_CONTROL_STATUSES] } },
        ],
      },
      data: {
        status: 'idle',
        reviewState: null,
        approvedAt: null,
        approvedBy: null,
      },
    })

    await Promise.all(Object.entries(plan.states).map(([stageKey, reviewState]) => tx.workflowStageState.upsert({
      where: {
        userId_projectId_scopeId_stageKey: {
          userId: params.userId,
          projectId: params.projectId,
          scopeId,
          stageKey,
        },
      },
      create: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        stageKey,
        status: resolveWorkflowStageStatusFromReviewState(reviewState),
        reviewState,
        approvedAt: reviewState === 'confirmed' ? updatedAt : null,
        approvedBy: reviewState === 'confirmed' ? params.userId : null,
      },
      update: {
        status: resolveWorkflowStageStatusFromReviewState(reviewState),
        reviewState,
        approvedAt: reviewState === 'confirmed' ? updatedAt : null,
        approvedBy: reviewState === 'confirmed' ? params.userId : null,
        blocker: null,
      },
    })))

    await Promise.all(plan.staleStages.map((stageKey) => tx.workflowStageState.upsert({
      where: {
        userId_projectId_scopeId_stageKey: {
          userId: params.userId,
          projectId: params.projectId,
          scopeId,
          stageKey,
        },
      },
      create: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        stageKey,
        status: 'stale',
        reviewState: 'review',
        summary: {
          reason: 'upstream_review_revoked',
        },
      },
      update: {
        status: 'stale',
        reviewState: 'review',
        approvedAt: null,
        approvedBy: null,
        summary: {
          reason: 'upstream_review_revoked',
        },
        blocker: null,
      },
    })))
  })

  await removeWorkflowStageReviewFile(params)

  return {
    source: 'database',
    updatedAt: updatedAt.toISOString(),
    states: effectiveStates,
  }
}
