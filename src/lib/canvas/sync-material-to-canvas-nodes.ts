import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { applyMaterialNodeSyncPatch, replacesMaterialId, type MaterialNodeSyncPatch } from './material-node-sync'

const MAX_LINEAGE_DEPTH = 6
const MAX_MATCHED_NODES = 2000
const MAX_SYNCED_CANVASES = 60

export type MaterialCanvasSyncResult = {
  nodes: number
  canvases: Array<{ projectId: string; canvasId: string; revision: number }>
}

class NothingToSync extends Error {}

async function materialLineageIds(workspaceOwnerId: string, material: { id: string; metadata: unknown }) {
  const ids = [material.id]
  const seen = new Set(ids)
  let previousId = replacesMaterialId(material.metadata)
  for (let depth = 0; previousId && !seen.has(previousId) && depth < MAX_LINEAGE_DEPTH; depth += 1) {
    ids.push(previousId)
    seen.add(previousId)
    const previous = await prisma.frameosMaterial.findFirst({
      where: { id: previousId, userId: workspaceOwnerId },
      select: { metadata: true },
    })
    previousId = previous ? replacesMaterialId(previous.metadata) : null
  }
  return ids
}

async function syncCanvasNodes(canvasId: string, nodeIds: string[], patch: MaterialNodeSyncPatch) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Claim the canvas first so the node reads below see every save that
      // committed before us, and a concurrent save is forced to re-merge.
      const canvas = await tx.canvas.update({
        where: { id: canvasId },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      })
      const rows = await tx.canvasNode.findMany({
        where: { canvasId, id: { in: nodeIds } },
        select: { id: true, data: true },
      })
      let changed = 0
      for (const row of rows) {
        const next = applyMaterialNodeSyncPatch(row.data, patch)
        if (!next) continue
        await tx.canvasNode.updateMany({
          where: { id: row.id, canvasId },
          data: { data: next as Prisma.InputJsonValue },
        })
        changed += 1
      }
      if (changed === 0) throw new NothingToSync()
      return { revision: canvas.revision, changed }
    }, { timeout: 15_000 })
  } catch (error) {
    if (!(error instanceof NothingToSync)) {
      console.warn('[material-canvas-sync] canvas update failed', { canvasId, error: error instanceof Error ? error.message : String(error) })
    }
    return null
  }
}

/**
 * Canvas nodes copy a library material's name and classification when they
 * are created. Push later library edits into those nodes (also the ones that
 * still point at an earlier picture of the same asset) and bump each canvas
 * revision so open editors reload. Best-effort: a failure never blocks the
 * library edit itself.
 */
export async function syncMaterialToCanvasNodes(input: {
  workspaceOwnerId: string
  material: { id: string; metadata: unknown }
  patch: MaterialNodeSyncPatch
}): Promise<MaterialCanvasSyncResult> {
  const result: MaterialCanvasSyncResult = { nodes: 0, canvases: [] }
  try {
    const ids = await materialLineageIds(input.workspaceOwnerId, input.material)
    const matched = await prisma.canvasNode.findMany({
      where: {
        canvas: { project: { userId: input.workspaceOwnerId, deletedAt: null } },
        OR: ids.map((id) => ({ data: { path: '$.materialId', equals: id } })),
      },
      select: { id: true, canvasId: true, data: true, canvas: { select: { projectId: true } } },
      take: MAX_MATCHED_NODES,
    })
    const byCanvas = new Map<string, { projectId: string; nodeIds: string[] }>()
    for (const node of matched) {
      if (!applyMaterialNodeSyncPatch(node.data, input.patch)) continue
      const entry = byCanvas.get(node.canvasId) || { projectId: node.canvas.projectId, nodeIds: [] }
      entry.nodeIds.push(node.id)
      byCanvas.set(node.canvasId, entry)
    }
    let remaining = MAX_SYNCED_CANVASES
    for (const [canvasId, entry] of byCanvas) {
      if (remaining-- <= 0) {
        console.warn('[material-canvas-sync] canvas limit reached', { materialId: input.material.id, canvases: byCanvas.size })
        break
      }
      const synced = await syncCanvasNodes(canvasId, entry.nodeIds, input.patch)
      if (!synced) continue
      result.nodes += synced.changed
      result.canvases.push({ projectId: entry.projectId, canvasId, revision: synced.revision })
    }
  } catch (error) {
    console.warn('[material-canvas-sync] failed', { materialId: input.material.id, error: error instanceof Error ? error.message : String(error) })
  }
  return result
}
