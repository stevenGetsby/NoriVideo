import type { Prisma } from '@prisma/client'

export type CanvasMaterialReferenceCounts = {
  currentCanvases: number
  workflowTemplates: number
  historySnapshots: number
}

export type CanvasMaterialReferenceSummary = {
  referenced: boolean
  counts: CanvasMaterialReferenceCounts
}

export type DeletableCanvasMaterialIdentity = {
  id: string
  resultUrl: string | null
  storageKey: string | null
}

type CanvasReferenceRow = {
  id: string
  nodes: Array<{
    data: unknown
    studioDocument: { document: unknown } | null
  }>
  snapshots: Array<{
    id: string
    document: unknown
    studioDocuments: Array<{ document: unknown }>
  }>
}

type WorkflowReferenceRow = {
  id: string
  nodes: unknown
  edges: unknown
  studioDocuments: Array<{ document: unknown }>
}

/**
 * Material ids can appear at several depths (the selected node value,
 * generation history, referenceMaterialIds, or a 3D studio scene). Keep the
 * detector shape-agnostic so adding another durable JSON field cannot silently
 * make deletion unsafe.
 */
export function jsonContainsExactString(value: unknown, target: string): boolean {
  if (value === target) return true
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => jsonContainsExactString(item, target))
  return Object.values(value as Record<string, unknown>)
    .some((item) => jsonContainsExactString(item, target))
}

function jsonContainsAnyExactString(value: unknown, targets: Set<string>): boolean {
  if (typeof value === 'string') return targets.has(value)
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => jsonContainsAnyExactString(item, targets))
  return Object.values(value as Record<string, unknown>)
    .some((item) => jsonContainsAnyExactString(item, targets))
}

export function summarizeCanvasMaterialReferences(
  materialIdentity: string | readonly string[],
  canvases: CanvasReferenceRow[],
  templates: WorkflowReferenceRow[],
): CanvasMaterialReferenceSummary {
  const targets = new Set((typeof materialIdentity === 'string' ? [materialIdentity] : materialIdentity)
    .map((value) => value.trim())
    .filter(Boolean))
  const currentCanvasIds = new Set<string>()
  const historySnapshotIds = new Set<string>()
  const workflowTemplateIds = new Set<string>()

  for (const canvas of canvases) {
    const currentReferenced = canvas.nodes.some((node) => (
      jsonContainsAnyExactString(node.data, targets)
      || jsonContainsAnyExactString(node.studioDocument?.document, targets)
    ))
    if (currentReferenced) currentCanvasIds.add(canvas.id)

    for (const snapshot of canvas.snapshots) {
      if (
        jsonContainsAnyExactString(snapshot.document, targets)
        || snapshot.studioDocuments.some((document) => jsonContainsAnyExactString(document.document, targets))
      ) {
        historySnapshotIds.add(snapshot.id)
      }
    }
  }

  for (const template of templates) {
    if (
      jsonContainsAnyExactString(template.nodes, targets)
      || jsonContainsAnyExactString(template.edges, targets)
      || template.studioDocuments.some((document) => jsonContainsAnyExactString(document.document, targets))
    ) {
      workflowTemplateIds.add(template.id)
    }
  }

  const counts = {
    currentCanvases: currentCanvasIds.size,
    workflowTemplates: workflowTemplateIds.size,
    historySnapshots: historySnapshotIds.size,
  }
  return {
    referenced: Object.values(counts).some((count) => count > 0),
    counts,
  }
}

/**
 * Read every durable canvas representation owned by this workspace. Account
 * uploads are usable in multiple projects, so limiting this lookup to the
 * material's original project could miss a valid cross-project reference.
 */
export async function findCanvasMaterialReferences(
  tx: Prisma.TransactionClient,
  workspaceOwnerId: string,
  material: DeletableCanvasMaterialIdentity,
): Promise<CanvasMaterialReferenceSummary> {
  const canvases = await tx.canvas.findMany({
    where: { userId: workspaceOwnerId },
    select: {
      id: true,
      nodes: {
        select: {
          data: true,
          studioDocument: { select: { document: true } },
        },
      },
      snapshots: {
        select: {
          id: true,
          document: true,
          studioDocuments: { select: { document: true } },
        },
      },
    },
  })
  const templates = await tx.canvasWorkflowTemplate.findMany({
    where: { userId: workspaceOwnerId },
    select: {
      id: true,
      nodes: true,
      edges: true,
      studioDocuments: { select: { document: true } },
    },
  })
  return summarizeCanvasMaterialReferences(
    [material.id, material.resultUrl || '', material.storageKey || ''],
    canvases,
    templates,
  )
}

export function canvasMaterialReferenceConflictMessage(counts: CanvasMaterialReferenceCounts): string {
  const locations = [
    counts.currentCanvases > 0 ? `${counts.currentCanvases} 个当前画布` : '',
    counts.workflowTemplates > 0 ? `${counts.workflowTemplates} 个工作流模板` : '',
    counts.historySnapshots > 0 ? `${counts.historySnapshots} 个历史版本` : '',
  ].filter(Boolean)
  return `无法删除：该素材仍被${locations.join('、')}引用。请先移除这些引用（历史版本需删除对应画布或历史记录），再重试。`
}
