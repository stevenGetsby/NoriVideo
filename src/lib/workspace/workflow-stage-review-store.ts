import fs from 'node:fs/promises'
import path from 'node:path'

export type WorkflowStageReviewState = 'confirmed' | 'review'

export type WorkflowStageReviewMap = Record<string, WorkflowStageReviewState>

interface StoreShape {
  updatedAt: string
  states: WorkflowStageReviewMap
}

const VALID_STATES = new Set<WorkflowStageReviewState>(['confirmed', 'review'])
const STORE_DIR = path.join(process.cwd(), '.runtime', 'workflow-stage-review')

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function storePath(params: { userId: string; projectId: string; episodeId?: string | null }) {
  const scope = params.episodeId || 'project'
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
      typeof entry[0] === 'string' && VALID_STATES.has(entry[1] as WorkflowStageReviewState)
    )),
  )
}

export async function readWorkflowStageReview(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}): Promise<WorkflowStageReviewMap> {
  try {
    const raw = await fs.readFile(storePath(params), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return normalizeStates(parsed.states)
  } catch {
    return {}
  }
}

export async function writeWorkflowStageReview(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  states: WorkflowStageReviewMap
}) {
  const filePath = storePath(params)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const payload: StoreShape = {
    updatedAt: new Date().toISOString(),
    states: normalizeStates(params.states),
  }
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}
