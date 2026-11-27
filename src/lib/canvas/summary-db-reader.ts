import { Prisma } from '@prisma/client'
import type { CanvasNode, CanvasNodeData, CanvasNodeSummaryV1 } from '@/features/canvas/types'
import { prisma } from '@/lib/prisma'
import { sanitizePublicCanvasData } from '@/lib/task/public-presentation'
import { withCanonicalCanvasStudioDocumentSource } from './studio-document-lifecycle'
import { reconcileCanvasGenerationNodes } from './generation-reconciliation'
import { buildCanvasNodeSummaryV1, buildCanvasNodeSummaryWithMetrics, CANVAS_CARD_SOURCE_KEYS } from './graph-summary'

const nodeFields = {
  id: true, canvasId: true, type: true, position: true, size: true,
  status: true, taskId: true, runId: true, mediaObjectId: true, parentNodeId: true, updatedAt: true,
} as const
export const canvasDetailSelect = { ...nodeFields, data: true } satisfies Prisma.CanvasNodeSelect
type FullRow = Prisma.CanvasNodeGetPayload<{ select: typeof canvasDetailSelect }>
type ProjectionRow = Omit<FullRow, 'data'> & {
  cardEntries: Prisma.JsonValue
  historyCount: bigint | number
  currentCostEntry: Prisma.JsonValue
  detailVersion: string
}

const sqlNodeFields = Prisma.sql`
  cn.id, cn.canvasId, cn.type, cn.position, cn.size, cn.status, cn.taskId, cn.runId,
  cn.mediaObjectId, cn.parentNodeId, cn.updatedAt
`
const sqlVersion = Prisma.sql`CONCAT('db2-', SHA2(JSON_ARRAY(
  DATE_FORMAT(cn.updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ'),
  cn.status, cn.taskId, cn.runId, cn.mediaObjectId, cn.parentNodeId
), 256))`

const historyRows = Prisma.sql`JSON_TABLE(
  IF(JSON_TYPE(JSON_EXTRACT(cn.data, '$.history')) = 'ARRAY', JSON_EXTRACT(cn.data, '$.history'), JSON_ARRAY()),
  '$[*]' COLUMNS (ordinal FOR ORDINALITY, item JSON PATH '$')
) AS history_rows`

function jsonString(json: Prisma.Sql, key: string) {
  const field = Prisma.sql`JSON_EXTRACT(${json}, ${`$.${key}`})`
  return Prisma.sql`IF(JSON_TYPE(${field}) = 'STRING', JSON_UNQUOTE(${field}), NULL)`
}

const nodeData = Prisma.sql`cn.data`
const historyItem = Prisma.sql`history_rows.item`
const historyUrl = jsonString(historyItem, 'url')
const mediaColumns = Prisma.join(['contentUrl', 'imageUrl', 'videoUrl', 'audioUrl', 'modelUrl']
  .map((key) => Prisma.sql`CAST(${jsonString(nodeData, key)} AS BINARY)`))

const currentCostQuery = Prisma.sql`
  SELECT JSON_ARRAY(JSON_EXTRACT(history_rows.item, '$.actualCostPoints'), JSON_EXTRACT(history_rows.item, '$.quotedCostPoints'))
  FROM ${historyRows}
  WHERE JSON_TYPE(history_rows.item) = 'OBJECT'
    AND IF(${jsonString(nodeData, 'mediaType')} = 'text',
      CAST(${jsonString(historyItem, 'text')} AS BINARY) = CAST(COALESCE(${jsonString(nodeData, 'text')}, '') AS BINARY),
      ${historyUrl} <> '' AND CAST(${historyUrl} AS BINARY) IN (${mediaColumns}))
  ORDER BY history_rows.ordinal
  LIMIT 1
`

const cardEntriesQuery = Prisma.join(CANVAS_CARD_SOURCE_KEYS.map((key) => {
  const path = `$.${key}`
  const field = Prisma.sql`JSON_EXTRACT(cn.data, ${path})`
  const value = key === 'generation'
    ? Prisma.sql`JSON_REMOVE(${field}, '$.prompt', '$.parameters.prompt', '$.parameters.references', '$.parameters.inputImages')`
    : key === 'text' ? Prisma.sql`LEFT(${jsonString(nodeData, 'text')}, 160)` : field
  // Preserve the distinction between an absent property and explicit JSON null.
  return Prisma.sql`IF(JSON_CONTAINS_PATH(cn.data, 'one', ${path}), JSON_ARRAY(${key}, ${value}), JSON_ARRAY())`
}))

function publicNode(row: FullRow, projectId: string, canvasId: string): CanvasNode {
  const { updatedAt: _updatedAt, ...node } = row
  return withCanonicalCanvasStudioDocumentSource({
    ...node,
    data: sanitizePublicCanvasData(node.data),
  }, projectId, canvasId) as CanvasNode
}

function summarizeCost(value: Prisma.JsonValue): CanvasNodeData['currentCost'] {
  if (!Array.isArray(value)) return null
  const [actual, quoted] = value
  if (typeof actual === 'number' && actual >= 0) return { kind: 'actual', points: actual }
  if (typeof quoted === 'number' && quoted >= 0) return { kind: 'quoted', points: quoted }
  return null
}

export async function readCanvasNodeSummariesWithMeta(projectId: string, canvasId: string): Promise<{
  nodes: CanvasNodeSummaryV1[]
  maxUpdatedAtMs: number
  hasRunning: boolean
}> {
  const rows = await prisma.$queryRaw<ProjectionRow[]>(Prisma.sql`
    SELECT ${sqlNodeFields}, JSON_ARRAY(${cardEntriesQuery}) AS cardEntries, ${sqlVersion} AS detailVersion,
      IF(JSON_TYPE(JSON_EXTRACT(cn.data, '$.history')) = 'ARRAY', JSON_LENGTH(cn.data, '$.history'), 0) AS historyCount,
      IF(
        JSON_TYPE(JSON_EXTRACT(cn.data, '$.history')) = 'ARRAY'
        AND JSON_LENGTH(cn.data, '$.history') > 0,
        (${currentCostQuery}),
        NULL
      ) AS currentCostEntry
    FROM canvas_nodes AS cn WHERE cn.canvasId = ${canvasId} ORDER BY cn.createdAt ASC
  `)
  const runningIds = rows.filter((row) => row.status === 'RUNNING').map((row) => row.id)
  const running = new Map<string, FullRow>()
  if (runningIds.length) {
    const fullRows = await prisma.canvasNode.findMany({
      where: { canvasId, id: { in: runningIds } },
      select: canvasDetailSelect,
    })
    for (const node of await reconcileCanvasGenerationNodes({ projectId, canvasId, nodes: fullRows })) {
      running.set(node.id, node)
    }
  }
  let maxUpdatedAtMs = 0
  let hasRunning = false
  const nodes = rows.flatMap((row) => {
    const { cardEntries, historyCount, currentCostEntry, detailVersion, ...fields } = row
    if (row.status === 'RUNNING') {
      const detail = running.get(row.id)
      // Node may have been removed after the projection query.
      if (!detail) return []
      const updatedMs = detail.updatedAt instanceof Date ? detail.updatedAt.getTime() : 0
      if (updatedMs > maxUpdatedAtMs) maxUpdatedAtMs = updatedMs
      if (detail.status === 'RUNNING') hasRunning = true
      const summary = buildCanvasNodeSummaryV1(publicNode(detail, projectId, canvasId))
      if (detail.status === row.status && detail.updatedAt.getTime() === row.updatedAt.getTime()) summary.detailVersion = detailVersion
      return [summary]
    }
    const updatedMs = row.updatedAt instanceof Date ? row.updatedAt.getTime() : 0
    if (updatedMs > maxUpdatedAtMs) maxUpdatedAtMs = updatedMs
    const entries = Array.isArray(cardEntries) ? cardEntries : []
    const data = Object.fromEntries(entries.flatMap((pair) =>
      Array.isArray(pair) && typeof pair[0] === 'string' && pair.length === 2 ? [[pair[0], pair[1]]] : []))
    return [buildCanvasNodeSummaryWithMetrics(publicNode({ ...fields, data }, projectId, canvasId), {
      historyCount: Number(historyCount), currentCost: summarizeCost(currentCostEntry), detailVersion,
    })]
  })
  return { nodes, maxUpdatedAtMs, hasRunning }
}

/** Only the SQL projection crosses the DB connection; full bodies are limited to active reconciliation. */
export async function readCanvasNodeSummaries(projectId: string, canvasId: string): Promise<CanvasNodeSummaryV1[]> {
  return (await readCanvasNodeSummariesWithMeta(projectId, canvasId)).nodes
}

export async function readCanvasNodeDetailRow(canvasId: string, nodeId: string) {
  const [row] = await prisma.$queryRaw<(FullRow & { detailVersion: string })[]>(Prisma.sql`
    SELECT ${sqlNodeFields}, cn.data, ${sqlVersion} AS detailVersion
    FROM canvas_nodes AS cn WHERE cn.canvasId = ${canvasId} AND cn.id = ${nodeId} LIMIT 1
  `)
  return row
}
