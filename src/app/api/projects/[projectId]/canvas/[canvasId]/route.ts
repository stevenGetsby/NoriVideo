import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sanitizePublicCanvasData } from '@/lib/task/public-presentation'

import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { parseUpdateCanvasInput } from '@/lib/canvas/validators'
import { reconcileCanvasGenerationNodes } from '@/lib/canvas/generation-reconciliation'
import { withCanonicalCanvasStudioDocumentSource } from '@/lib/canvas/studio-document-lifecycle'
import { CANVAS_SUMMARY_VIEW } from '@/lib/canvas/graph-summary'
import { canvasDetailSelect, readCanvasNodeSummariesWithMeta } from '@/lib/canvas/summary-db-reader'

const MAX_ETAG_CACHE = 2_000
const canvasEtagCache = new Map<string, string>()

function getCachedCanvasEtag(fingerprint: string): string | undefined {
  const etag = canvasEtagCache.get(fingerprint)
  if (!etag) return undefined
  canvasEtagCache.delete(fingerprint)
  canvasEtagCache.set(fingerprint, etag)
  return etag
}

function setCachedCanvasEtag(fingerprint: string, etag: string): void {
  canvasEtagCache.delete(fingerprint)
  canvasEtagCache.set(fingerprint, etag)
  if (canvasEtagCache.size > MAX_ETAG_CACHE) {
    const oldest = canvasEtagCache.keys().next().value
    if (oldest !== undefined) canvasEtagCache.delete(oldest)
  }
}

function canvasUpdatedTimestamp(canvas: { updatedAt?: Date | string | null }): number {
  if (canvas.updatedAt instanceof Date) return canvas.updatedAt.getTime()
  if (typeof canvas.updatedAt === 'string') {
    const parsed = Date.parse(canvas.updatedAt)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function canvasFingerprint(
  canvasId: string,
  summary: boolean,
  canvas: { revision: number; updatedAt?: Date | string | null },
  nodeCount: number,
  maxNodeUpdatedMs: number,
  edgeCount: number,
): string {
  return `${canvasId}:${summary ? 's' : 'f'}:${canvas.revision}:${canvasUpdatedTimestamp(canvas)}:${nodeCount}:${maxNodeUpdatedMs}:${edgeCount}`
}

async function readFullNodesWithMeta(projectId: string, canvasId: string) {
  const nodes = await prisma.canvasNode.findMany({
    where: { canvasId },
    orderBy: { createdAt: 'asc' },
    select: canvasDetailSelect,
  })
  const reconciled = await reconcileCanvasGenerationNodes({ projectId, canvasId, nodes })
  let maxUpdatedAtMs = 0
  let hasRunning = false
  const mapped = reconciled.map(({ updatedAt, ...node }) => {
    const updatedMs = updatedAt instanceof Date ? updatedAt.getTime() : 0
    if (updatedMs > maxUpdatedAtMs) maxUpdatedAtMs = updatedMs
    if (node.status === 'RUNNING') hasRunning = true
    return withCanonicalCanvasStudioDocumentSource({
      ...node,
      data: sanitizePublicCanvasData(node.data),
    }, projectId, canvasId)
  })
  return { nodes: mapped, maxUpdatedAtMs, hasRunning }
}

// GET - 获取画布元数据 + 节点 + 边（一次性返回，前端单次加载）
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const canvas = await requireCanvasInProject(canvasId, projectId)
  const summary = request.nextUrl.searchParams.get('view') === CANVAS_SUMMARY_VIEW
  const ifNoneMatch = request.headers.get('if-none-match')

  // Cheap index-only pre-check avoids reading multi-MB node JSON on unchanged 304 revalidations.
  if (
    ifNoneMatch
    && typeof prisma.canvasNode?.aggregate === 'function'
    && typeof prisma.canvasNode?.count === 'function'
    && typeof prisma.canvasEdge?.count === 'function'
  ) {
    const [nodeMeta, runningCount, edgeCount] = await Promise.all([
      prisma.canvasNode.aggregate({
        where: { canvasId },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      prisma.canvasNode.count({ where: { canvasId, status: 'RUNNING' } }),
      prisma.canvasEdge.count({ where: { canvasId } }),
    ])
    if (runningCount === 0) {
      const maxNodeUpdatedMs = nodeMeta._max.updatedAt instanceof Date ? nodeMeta._max.updatedAt.getTime() : 0
      const fingerprint = canvasFingerprint(canvasId, summary, canvas, nodeMeta._count._all, maxNodeUpdatedMs, edgeCount)
      const cachedEtag = getCachedCanvasEtag(fingerprint)
      if (cachedEtag && cachedEtag === ifNoneMatch) {
        return new NextResponse(null, { status: 304, headers: { ETag: cachedEtag, 'Cache-Control': 'private, no-cache' } })
      }
    }
  }

  const [nodeResult, edges] = await Promise.all([
    summary ? readCanvasNodeSummariesWithMeta(projectId, canvasId) : readFullNodesWithMeta(projectId, canvasId),
    prisma.canvasEdge.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        canvasId: true,
        sourceNodeId: true,
        targetNodeId: true,
        sourceHandle: true,
        targetHandle: true,
        role: true,
      },
    }),
  ])
  const nodes = nodeResult.nodes
  const body = JSON.stringify(summary ? { kind: CANVAS_SUMMARY_VIEW, canvas, nodes, edges } : { canvas, nodes, edges })
  const etag = `"${createHash('sha1').update(body).digest('hex')}"`
  if (!nodeResult.hasRunning) {
    setCachedCanvasEtag(
      canvasFingerprint(canvasId, summary, canvas, nodes.length, nodeResult.maxUpdatedAtMs, edges.length),
      etag,
    )
  }
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers })
  }
  return new NextResponse(body, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
})

// PATCH - 更新画布元数据（标题/主题色/viewport）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const body = await request.json().catch(() => null)
  const parsed = parseUpdateCanvasInput(body)
  if (!parsed || Object.keys(parsed).length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  const canvas = await prisma.canvas.update({
    where: { id: canvasId },
    data: parsed,
    select: {
      id: true,
      projectId: true,
      title: true,
      themeColor: true,
      viewport: true,
      revision: true,
      visibility: true,
      forkedFromId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ canvas })
})

// DELETE - 删除画布（级联删除节点与边）
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  await prisma.canvas.delete({ where: { id: canvasId } })

  return NextResponse.json({ success: true })
})
