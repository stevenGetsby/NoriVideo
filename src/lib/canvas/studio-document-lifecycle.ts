import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { normalizeStudioDocumentSeed } from '@/lib/canvas/studio-document'

export const STUDIO_DOCUMENT_SOURCE_KEY = '__studioDocumentSource'

type StudioDocumentCanvasSource = {
  kind: 'canvas-node'
  projectId: string
  canvasId: string
  nodeId: string
}

type StudioDocumentTemplateSource = {
  kind: 'workflow-template'
  templateId: string
  nodeId: string
}

export type StudioDocumentSource = StudioDocumentCanvasSource | StudioDocumentTemplateSource

export type StudioDocumentNodeLike = {
  id: string
  type: string
  data?: unknown
}

export type StudioDocumentArchiveEntry = {
  nodeId: string
  revision: number
  document: unknown
}

type ResolvedStudioDocumentCopy = StudioDocumentArchiveEntry & {
  targetNodeId: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const output = value.trim()
  return output && output.length <= 191 ? output : null
}

export function studioDocumentSourceFromData(value: unknown): StudioDocumentSource | null {
  const source = record(record(value)?.[STUDIO_DOCUMENT_SOURCE_KEY])
  if (!source) return null
  if (source.kind === 'canvas-node') {
    const projectId = boundedId(source.projectId)
    const canvasId = boundedId(source.canvasId)
    const nodeId = boundedId(source.nodeId)
    return projectId && canvasId && nodeId
      ? { kind: 'canvas-node', projectId, canvasId, nodeId }
      : null
  }
  if (source.kind === 'workflow-template') {
    const templateId = boundedId(source.templateId)
    const nodeId = boundedId(source.nodeId)
    return templateId && nodeId
      ? { kind: 'workflow-template', templateId, nodeId }
      : null
  }
  return null
}

export function canvasStudioDocumentSource(
  projectId: string,
  canvasId: string,
  nodeId: string,
): StudioDocumentCanvasSource {
  return { kind: 'canvas-node', projectId, canvasId, nodeId }
}

export function workflowTemplateStudioDocumentSource(
  templateId: string,
  nodeId: string,
): StudioDocumentTemplateSource {
  return { kind: 'workflow-template', templateId, nodeId }
}

export function withStudioDocumentSource<T extends StudioDocumentNodeLike>(
  node: T,
  source: StudioDocumentSource,
): T {
  if (node.type !== 'studio_3d') return node
  return {
    ...node,
    data: {
      ...(record(node.data) || {}),
      [STUDIO_DOCUMENT_SOURCE_KEY]: source,
    },
  }
}

export function withCanonicalCanvasStudioDocumentSource<T extends StudioDocumentNodeLike>(
  node: T,
  projectId: string,
  canvasId: string,
): T {
  return withStudioDocumentSource(node, canvasStudioDocumentSource(projectId, canvasId, node.id))
}

function unavailableSource(): never {
  throw new ApiError('INVALID_PARAMS', {
    message: '3D 导演台的源场景不可用，请重新复制节点或重新加载工作流模板。',
    reason: 'STUDIO_DOCUMENT_SOURCE_UNAVAILABLE',
  })
}

async function resolveCanvasNodeSource(
  tx: Prisma.TransactionClient,
  projectId: string,
  source: StudioDocumentCanvasSource,
): Promise<{ revision: number; document: unknown }> {
  // Check the project/canvas boundary before looking up the globally unique
  // node id. This keeps a forged clipboard payload from becoming a BOLA read.
  if (source.projectId !== projectId) unavailableSource()
  const sourceCanvas = await tx.canvas.findFirst({
    where: { id: source.canvasId, projectId },
    select: { id: true },
  })
  if (!sourceCanvas) unavailableSource()
  const sourceNode = await tx.canvasNode.findFirst({
    where: { id: source.nodeId, canvasId: source.canvasId, type: 'studio_3d' },
    select: { id: true, data: true },
  })
  if (!sourceNode) unavailableSource()
  const stored = await tx.canvasStudio3DDocument.findFirst({
    where: {
      projectId,
      canvasId: source.canvasId,
      nodeId: source.nodeId,
    },
    select: { revision: true, document: true },
  })
  return {
    revision: stored?.revision ?? 0,
    document: normalizeStudioDocumentSeed(stored?.document ?? record(sourceNode.data)?.studioScene),
  }
}

async function resolveTemplateSource(
  tx: Prisma.TransactionClient,
  projectId: string,
  templateOwnerId: string,
  source: StudioDocumentTemplateSource,
): Promise<{ revision: number; document: unknown }> {
  const template = await tx.canvasWorkflowTemplate.findFirst({
    where: {
      id: source.templateId,
      projectId,
      userId: templateOwnerId,
    },
    select: {
      id: true,
      studioDocuments: {
        where: { sourceNodeId: source.nodeId },
        take: 1,
        select: { sourceRevision: true, document: true },
      },
    },
  })
  const stored = template?.studioDocuments[0]
  if (!stored) unavailableSource()
  return {
    revision: stored.sourceRevision,
    document: normalizeStudioDocumentSeed(stored.document),
  }
}

async function resolveSource(
  tx: Prisma.TransactionClient,
  {
    projectId,
    templateOwnerId,
    source,
  }: {
    projectId: string
    templateOwnerId: string
    source: StudioDocumentSource
  },
) {
  return source.kind === 'canvas-node'
    ? await resolveCanvasNodeSource(tx, projectId, source)
    : await resolveTemplateSource(tx, projectId, templateOwnerId, source)
}

/**
 * Resolve all copy sources before graph rows are deleted. This is important
 * for cut/paste and history replacement, where the source node may disappear
 * later in the same transaction.
 */
export async function prepareStudioDocumentCopiesInTransaction(
  tx: Prisma.TransactionClient,
  {
    projectId,
    templateOwnerId,
    nodes,
  }: {
    projectId: string
    templateOwnerId: string
    nodes: StudioDocumentNodeLike[]
  },
): Promise<ResolvedStudioDocumentCopy[]> {
  const copies: ResolvedStudioDocumentCopy[] = []
  for (const node of nodes) {
    if (node.type !== 'studio_3d') continue
    const source = studioDocumentSourceFromData(node.data)
    if (!source) continue
    const resolved = await resolveSource(tx, { projectId, templateOwnerId, source })
    copies.push({
      targetNodeId: node.id,
      nodeId: node.id,
      revision: resolved.revision,
      document: resolved.document,
    })
  }
  return copies
}

export async function createStudioDocumentCopiesInTransaction(
  tx: Prisma.TransactionClient,
  {
    projectId,
    canvasId,
    updatedBy,
    copies,
  }: {
    projectId: string
    canvasId: string
    updatedBy: string
    copies: ResolvedStudioDocumentCopy[]
  },
) {
  if (copies.length === 0) return
  await tx.canvasStudio3DDocument.createMany({
    data: copies.map((copy) => ({
      projectId,
      canvasId,
      nodeId: copy.targetNodeId,
      revision: 1,
      document: normalizeStudioDocumentSeed(copy.document) as unknown as Prisma.InputJsonValue,
      updatedBy,
    })),
  })
}

export async function recordStudioDocumentsForSnapshotInTransaction(
  tx: Prisma.TransactionClient,
  {
    snapshotId,
    canvasId,
    nodes,
  }: {
    snapshotId: string
    canvasId: string
    nodes: StudioDocumentNodeLike[]
  },
) {
  const studioNodes = nodes.filter((node) => node.type === 'studio_3d')
  if (studioNodes.length === 0) return
  const stored = await tx.canvasStudio3DDocument.findMany({
    where: { canvasId, nodeId: { in: studioNodes.map((node) => node.id) } },
    select: { nodeId: true, revision: true, document: true },
  })
  const storedByNode = new Map(stored.map((item) => [item.nodeId, item]))
  await tx.canvasStudio3DDocumentSnapshot.createMany({
    data: studioNodes.map((node) => {
      const row = storedByNode.get(node.id)
      return {
        snapshotId,
        nodeId: node.id,
        revision: row?.revision ?? 0,
        document: normalizeStudioDocumentSeed(
          row?.document ?? record(node.data)?.studioScene,
        ) as unknown as Prisma.InputJsonValue,
      }
    }),
  })
}

export async function restoreStudioDocumentsInTransaction(
  tx: Prisma.TransactionClient,
  {
    projectId,
    canvasId,
    updatedBy,
    nodes,
    documents,
  }: {
    projectId: string
    canvasId: string
    updatedBy: string
    nodes: StudioDocumentNodeLike[]
    documents: StudioDocumentArchiveEntry[]
  },
) {
  const studioNodes = nodes.filter((node) => node.type === 'studio_3d')
  const studioNodeIds = new Set(studioNodes.map((node) => node.id))
  if (studioNodeIds.size === 0) return
  const archived = new Map(
    documents
      .filter((item) => studioNodeIds.has(item.nodeId))
      .map((item) => [item.nodeId, item]),
  )
  // Snapshots created before the lifecycle migration have no side rows. Their
  // legacy inline scene (if any) is still the best exact restoration seed.
  for (const node of studioNodes) {
    if (!archived.has(node.id)) {
      archived.set(node.id, {
        nodeId: node.id,
        revision: 0,
        document: normalizeStudioDocumentSeed(record(node.data)?.studioScene),
      })
    }
  }

  const current = await tx.canvasStudio3DDocument.findMany({
    where: { projectId, canvasId, nodeId: { in: Array.from(studioNodeIds) } },
    select: { id: true, nodeId: true, revision: true },
  })
  const currentByNode = new Map(current.map((item) => [item.nodeId, item]))
  for (const [nodeId, archivedDocument] of archived) {
    const existing = currentByNode.get(nodeId)
    if (existing) {
      const updated = await tx.canvasStudio3DDocument.updateMany({
        where: { id: existing.id, projectId, canvasId, nodeId, revision: existing.revision },
        data: {
          revision: { increment: 1 },
          document: normalizeStudioDocumentSeed(archivedDocument.document) as unknown as Prisma.InputJsonValue,
          updatedBy,
        },
      })
      if (updated.count !== 1) {
        throw new ApiError('CONFLICT', {
          message: '恢复历史版本时 3D 导演台已被其他窗口更新，请重新加载后重试。',
          reason: 'STUDIO_DOCUMENT_RESTORE_CONFLICT',
          nodeId,
        })
      }
    } else {
      await tx.canvasStudio3DDocument.create({
        data: {
          projectId,
          canvasId,
          nodeId,
          revision: 1,
          document: normalizeStudioDocumentSeed(archivedDocument.document) as unknown as Prisma.InputJsonValue,
          updatedBy,
        },
      })
    }
  }
}

export async function createWorkflowTemplateStudioDocumentsInTransaction(
  tx: Prisma.TransactionClient,
  {
    templateId,
    projectId,
    templateOwnerId,
    nodes,
  }: {
    templateId: string
    projectId: string
    templateOwnerId: string
    nodes: StudioDocumentNodeLike[]
  },
) {
  const rows: Array<{
    templateId: string
    sourceNodeId: string
    sourceRevision: number
    document: Prisma.InputJsonValue
  }> = []
  for (const node of nodes) {
    if (node.type !== 'studio_3d') continue
    const source = studioDocumentSourceFromData(node.data)
    const resolved = source
      ? await resolveSource(tx, { projectId, templateOwnerId, source })
      : {
          revision: 0,
          document: normalizeStudioDocumentSeed(record(node.data)?.studioScene),
        }
    rows.push({
      templateId,
      sourceNodeId: node.id,
      sourceRevision: resolved.revision,
      document: normalizeStudioDocumentSeed(resolved.document) as unknown as Prisma.InputJsonValue,
    })
  }
  if (rows.length > 0) {
    await tx.canvasWorkflowTemplateStudio3DDocument.createMany({ data: rows })
  }
}
