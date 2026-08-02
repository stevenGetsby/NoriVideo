import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { resolveModelSelection } from '@/lib/api-config'
import type { Locale } from '@/i18n/routing'
import type { CanvasStoryboardPlanTaskPayload } from '@/lib/canvas/generation-task'
import { bindCanvasToolboxTaskToNode, projectCanvasToolboxTaskTerminal } from '@/lib/canvas/toolbox-node-binding'
import { MAX_CANVAS_EDGES, MAX_CANVAS_NODES } from '@/lib/canvas/document'
import { recordCanvasSnapshotInTransaction } from '@/lib/canvas/persistence'
import type { CanvasStoryboardShot } from '@/lib/canvas/storyboard-plan'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import { TaskTerminatedError } from '@/lib/task/errors'
import { cancelTask } from '@/lib/task/service'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

type JsonRecord = Record<string, unknown>

export type CanvasStoryboardFanoutShot = {
  index: number
  nodeId: string
  assetId: string | null
  taskId: string | null
  status: 'submitted' | 'ready' | 'failed'
  errorMessage: string | null
}

export type CanvasStoryboardFanoutResult = {
  planningTaskId: string
  groupId: string
  status: 'submitted' | 'partial' | 'failed'
  submittedCount: number
  failedCount: number
  shots: CanvasStoryboardFanoutShot[]
}

export class CanvasStoryboardFanoutSupersededError extends Error {
  constructor(planningTaskId: string) {
    super(`Canvas storyboard planning task ${planningTaskId} no longer owns its source node`)
    this.name = 'CanvasStoryboardFanoutSupersededError'
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function position(value: unknown): { x: number; y: number } {
  const source = record(value)
  return {
    x: typeof source.x === 'number' && Number.isFinite(source.x) ? source.x : 0,
    y: typeof source.y === 'number' && Number.isFinite(source.y) ? source.y : 0,
  }
}

function size(value: unknown): { width: number; height: number } {
  const source = record(value)
  return {
    width: typeof source.width === 'number' && Number.isFinite(source.width) && source.width > 0 ? source.width : 300,
    height: typeof source.height === 'number' && Number.isFinite(source.height) && source.height > 0 ? source.height : 200,
  }
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function canvasStoryboardFanoutIds(planningTaskId: string, sourceNodeId: string, shotIndex: number) {
  return {
    nodeId: shotIndex === 1 ? sourceNodeId : `canvas-storyboard-${planningTaskId}-${shotIndex}`,
    assetId: deterministicUuid(`canvas-storyboard:${planningTaskId}:shot:${shotIndex}:asset`),
  }
}

export function canvasStoryboardFanoutGroupId(planningTaskId: string) {
  return `canvas-storyboard-group-${planningTaskId}`
}

function clonedIncomingEdgeId(planningTaskId: string, shotIndex: number, sourceEdgeId: string) {
  return `canvas-storyboard-edge-${deterministicUuid(`${planningTaskId}:${shotIndex}:${sourceEdgeId}`)}`
}

function storyboardGeneration(
  sourceData: JsonRecord,
  payload: CanvasStoryboardPlanTaskPayload,
) {
  const current = record(sourceData.generation)
  return {
    ...current,
    modelKey: payload.imageRequest.modelKey,
    modelLabel: payload.imageRequest.modelLabel,
    referenceNodeIds: payload.imageRequest.referenceNodeIds,
    inputMode: payload.imageRequest.inputMode,
    aspectRatio: payload.imageRequest.aspectRatio,
    resolution: payload.imageRequest.resolution,
    quality: payload.imageRequest.quality,
    count: 1,
  }
}

function withoutExecution(value: JsonRecord) {
  const output = { ...value }
  delete output.assetId
  delete output.taskId
  return output
}

const ACTIVE_PLANNING_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]

function isPlanningSourceBinding(input: {
  planningTaskId: string
  sourceNodeId: string
  taskId: string | null
  data: unknown
}) {
  const data = record(input.data)
  const generationTask = record(data.generationTask)
  if (
    input.taskId === input.planningTaskId
    && generationTask.kind === 'storyboard_plan'
    && text(generationTask.taskId) === input.planningTaskId
  ) return true

  // A retry can run after shot 1 has already atomically replaced the planning
  // binding. That is still this fan-out's source, not a newer planning task.
  const generation = record(data.generation)
  const shotOneAssetId = canvasStoryboardFanoutIds(
    input.planningTaskId,
    input.sourceNodeId,
    1,
  ).assetId
  return text(data.storyboardPlanningTaskId) === input.planningTaskId
    && text(generation.assetId) === shotOneAssetId
}

function assertSourceStillOwned(input: {
  planningTaskId: string
  sourceNodeId: string
  taskId: string | null
  data: unknown
}) {
  if (!isPlanningSourceBinding(input)) {
    throw new CanvasStoryboardFanoutSupersededError(input.planningTaskId)
  }
}

async function assertPlanningCanFanout(input: {
  planningTaskId: string
  userId: string
  projectId: string
  payload: CanvasStoryboardPlanTaskPayload
}) {
  const [task, source] = await Promise.all([
    prisma.task.findFirst({
      where: {
        id: input.planningTaskId,
        userId: input.userId,
        projectId: input.projectId,
        type: TASK_TYPE.CANVAS_STORYBOARD_PLAN,
        targetType: 'CanvasNode',
        targetId: input.payload.nodeId,
        status: { in: ACTIVE_PLANNING_STATUSES },
      },
      select: { id: true },
    }),
    prisma.canvasNode.findFirst({
      where: {
        id: input.payload.nodeId,
        canvasId: input.payload.canvasId,
        type: 'image',
        canvas: { projectId: input.projectId },
      },
      select: { id: true, taskId: true, data: true },
    }),
  ])
  if (!task) {
    throw new TaskTerminatedError(
      input.planningTaskId,
      'Storyboard planning task stopped before image fan-out',
    )
  }
  if (!source) throw new CanvasStoryboardFanoutSupersededError(input.planningTaskId)
  assertSourceStillOwned({
    planningTaskId: input.planningTaskId,
    sourceNodeId: source.id,
    taskId: source.taskId,
    data: source.data,
  })
}

async function prepareStoryboardGraph(input: {
  planningTaskId: string
  userId: string
  projectId: string
  payload: CanvasStoryboardPlanTaskPayload
  shots: CanvasStoryboardShot[]
}) {
  const groupId = canvasStoryboardFanoutGroupId(input.planningTaskId)
  return await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; revision: number; viewport: Prisma.JsonValue | null }>>(Prisma.sql`
      SELECT id, revision, viewport
      FROM canvases
      WHERE id = ${input.payload.canvasId} AND projectId = ${input.projectId}
      LIMIT 1
      FOR UPDATE
    `)
    if (locked.length !== 1) throw new Error('故事版所属画布不存在或已被删除。')

    const planningTask = await tx.task.findFirst({
      where: {
        id: input.planningTaskId,
        userId: input.userId,
        projectId: input.projectId,
        type: TASK_TYPE.CANVAS_STORYBOARD_PLAN,
        targetType: 'CanvasNode',
        targetId: input.payload.nodeId,
        status: { in: ACTIVE_PLANNING_STATUSES },
      },
      select: { id: true },
    })
    if (!planningTask) {
      throw new TaskTerminatedError(
        input.planningTaskId,
        'Storyboard planning task stopped before graph fan-out',
      )
    }

    const source = await tx.canvasNode.findFirst({
      where: {
        id: input.payload.nodeId,
        canvasId: input.payload.canvasId,
        type: 'image',
      },
      select: {
        id: true,
        position: true,
        size: true,
        data: true,
        status: true,
        taskId: true,
        runId: true,
        mediaObjectId: true,
        parentNodeId: true,
      },
    })
    if (!source) throw new Error('故事版源节点不存在或已被删除。')
    assertSourceStillOwned({
      planningTaskId: input.planningTaskId,
      sourceNodeId: source.id,
      taskId: source.taskId,
      data: source.data,
    })

    const outputIds = input.shots.map((shot) => (
      canvasStoryboardFanoutIds(input.planningTaskId, source.id, shot.index).nodeId
    ))
    const existing = await tx.canvasNode.findMany({
      where: { canvasId: input.payload.canvasId, id: { in: [groupId, ...outputIds] } },
      select: { id: true, data: true },
    })
    const existingIds = new Set(existing.map((node) => node.id))
    const existingById = new Map(existing.map((node) => [node.id, record(node.data)]))
    // A BullMQ retry reruns the text-planning step and the model may return a
    // slightly different plan. Once this planning task has materialized its
    // graph, the node data is the durable plan: reuse it so a retry cannot send
    // a new prompt under an already-used child asset/task id.
    const effectiveShots = input.shots.map((shot, offset) => {
      const persisted = existingById.get(outputIds[offset])
      if (
        persisted
        && text(persisted.storyboardPlanningTaskId) === input.planningTaskId
        && Number(persisted.storyboardIndex) === shot.index
      ) {
        return {
          ...shot,
          title: text(persisted.storyboardTitle) || shot.title,
          prompt: text(persisted.prompt) || shot.prompt,
        }
      }
      return shot
    })
    const missingNodeCount = [groupId, ...outputIds].filter((id) => !existingIds.has(id)).length
    let structureChanged = missingNodeCount > 0
    const nodeCount = await tx.canvasNode.count({ where: { canvasId: input.payload.canvasId } })
    if (nodeCount + missingNodeCount > MAX_CANVAS_NODES) {
      throw new Error('画布节点数量已达到上限，无法创建连续故事版。')
    }

    const sourcePosition = position(source.position)
    const sourceSize = size(source.size)
    const sourceData = record(source.data)
    const preparedGeneration = withoutExecution(storyboardGeneration(sourceData, input.payload))
    const now = new Date().toISOString()

    for (const [offset, shot] of effectiveShots.entries()) {
      const nodeId = outputIds[offset]
      const nodeData = {
        ...sourceData,
        title: `${text(sourceData.title) || '故事版'} · ${shot.index} ${shot.title}`,
        prompt: shot.prompt,
        mediaType: 'image',
        origin: 'generate',
        processType: 'storyboard',
        generation: preparedGeneration,
        generationTask: offset === 0
          ? {
              kind: 'storyboard_plan',
              taskId: input.planningTaskId,
              submittedAt: text(record(sourceData.generationTask).submittedAt) || now,
            }
          : null,
        history: offset === 0 ? sourceData.history : undefined,
        progress: offset === 0 ? Math.max(75, Number(sourceData.progress) || 0) : 0,
        errorMessage: null,
        pollErrorMessage: null,
        storyboardIndex: shot.index,
        storyboardTitle: shot.title,
        storyboardPlanningTaskId: input.planningTaskId,
      }
      if (offset === 0) {
        // Do not reset a shot that a prior worker attempt already bound. The
        // source planning task is deliberately replaced last during fan-out.
        const alreadyBound = text(record(sourceData.generation).assetId)
          && text(sourceData.storyboardPlanningTaskId) === input.planningTaskId
        if (!alreadyBound) {
          const preparedSource = await tx.canvasNode.updateMany({
            where: {
              id: source.id,
              canvasId: input.payload.canvasId,
              taskId: input.planningTaskId,
            },
            data: {
              position: inputJson({ x: sourcePosition.x, y: sourcePosition.y }),
              data: inputJson(nodeData),
              status: 'RUNNING',
              parentNodeId: null,
            },
          })
          if (preparedSource.count !== 1) {
            throw new CanvasStoryboardFanoutSupersededError(input.planningTaskId)
          }
        }
        continue
      }
      if (existingIds.has(nodeId)) continue
      await tx.canvasNode.create({
        data: {
          id: nodeId,
          canvasId: input.payload.canvasId,
          type: 'image',
          position: inputJson({
            x: sourcePosition.x + offset * (sourceSize.width + 46),
            y: sourcePosition.y,
          }),
          size: source.size === null ? Prisma.JsonNull : inputJson(source.size),
          data: inputJson(nodeData),
          status: 'IDLE',
          taskId: null,
          runId: null,
          mediaObjectId: null,
          parentNodeId: source.id,
        },
      })
    }

    const left = sourcePosition.x - 36
    const top = sourcePosition.y - 60
    const right = sourcePosition.x + (effectiveShots.length - 1) * (sourceSize.width + 46) + sourceSize.width + 36
    const bottom = sourcePosition.y + sourceSize.height + 36
    const groupData = {
      title: `${text(sourceData.title) || '故事版'} · 连续 ${effectiveShots.length} 镜`,
      memberIds: outputIds,
      groupColor: '#765cff',
      storyboardPlanningTaskId: input.planningTaskId,
    }
    if (existingIds.has(groupId)) {
      const group = await tx.canvasNode.findFirst({
        where: { id: groupId, canvasId: input.payload.canvasId, type: 'group' },
        select: { data: true },
      })
      await tx.canvasNode.updateMany({
        where: { id: groupId, canvasId: input.payload.canvasId, type: 'group' },
        data: { data: inputJson({ ...record(group?.data), ...groupData }) },
      })
    } else {
      await tx.canvasNode.create({
        data: {
          id: groupId,
          canvasId: input.payload.canvasId,
          type: 'group',
          position: inputJson({ x: left, y: top }),
          size: inputJson({ width: right - left, height: bottom - top }),
          data: inputJson(groupData),
          status: 'IDLE',
          taskId: null,
          runId: null,
          mediaObjectId: null,
          parentNodeId: null,
        },
      })
    }

    const incoming = await tx.canvasEdge.findMany({
      where: { canvasId: input.payload.canvasId, targetNodeId: source.id },
      orderBy: { createdAt: 'asc' },
    })
    const desiredEdges = effectiveShots.slice(1).flatMap((shot) => incoming.map((edge) => ({
      id: clonedIncomingEdgeId(input.planningTaskId, shot.index, edge.id),
      canvasId: input.payload.canvasId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: canvasStoryboardFanoutIds(input.planningTaskId, source.id, shot.index).nodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      role: edge.role,
    })))
    const edgeCount = await tx.canvasEdge.count({ where: { canvasId: input.payload.canvasId } })
    const edgeIds = desiredEdges.map((edge) => edge.id)
    const presentEdges = edgeIds.length > 0
      ? await tx.canvasEdge.findMany({ where: { canvasId: input.payload.canvasId, id: { in: edgeIds } }, select: { id: true } })
      : []
    const presentEdgeIds = new Set(presentEdges.map((edge) => edge.id))
    const missingEdges = desiredEdges.filter((edge) => !presentEdgeIds.has(edge.id))
    if (edgeCount + missingEdges.length > MAX_CANVAS_EDGES) {
      throw new Error('画布连线数量已达到上限，无法创建连续故事版。')
    }
    if (missingEdges.length > 0) {
      await tx.canvasEdge.createMany({ data: missingEdges })
      structureChanged = true
    }

    let canvasRevision = Number(locked[0].revision)
    if (!Number.isSafeInteger(canvasRevision) || canvasRevision < 0) {
      throw new Error('故事版所属画布 revision 无效。')
    }
    if (structureChanged) {
      const claimed = await tx.canvas.updateMany({
        where: {
          id: input.payload.canvasId,
          projectId: input.projectId,
          revision: canvasRevision,
        },
        data: { revision: { increment: 1 } },
      })
      if (claimed.count !== 1) {
        throw new Error('画布 revision 已变化，连续故事版建图已安全中止。')
      }
      canvasRevision += 1
      const [snapshotNodes, snapshotEdges] = await Promise.all([
        tx.canvasNode.findMany({
          where: { canvasId: input.payload.canvasId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            position: true,
            size: true,
            data: true,
            status: true,
            taskId: true,
            runId: true,
            mediaObjectId: true,
            parentNodeId: true,
          },
        }),
        tx.canvasEdge.findMany({
          where: { canvasId: input.payload.canvasId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sourceNodeId: true,
            targetNodeId: true,
            sourceHandle: true,
            targetHandle: true,
            role: true,
          },
        }),
      ])
      await recordCanvasSnapshotInTransaction(tx, {
        canvasId: input.payload.canvasId,
        revision: canvasRevision,
        userId: input.userId,
        clientId: 'worker:storyboard-fanout',
        changeSummary: `连续故事版创建 ${effectiveShots.length} 个镜头节点`,
        document: inputJson({
          viewport: locked[0].viewport || { x: 0, y: 0, zoom: 1 },
          nodes: snapshotNodes,
          edges: snapshotEdges,
        }),
      })
    }

    return { groupId, outputIds, canvasRevision, structureChanged, shots: effectiveShots }
  })
}

async function loadImageReferences(input: {
  userId: string
  projectId: string
  materialIds: string[]
}) {
  if (input.materialIds.length === 0) return { images: [] as string[], summary: [] as Array<{ id: string; title: string; type: 'image' }> }
  const materials = await prisma.frameosMaterial.findMany({
    where: {
      id: { in: input.materialIds },
      userId: input.userId,
      type: 'image',
      status: 'ready',
      deletedAt: null,
      projectId: { in: [input.projectId, 'global', 'global-asset-hub'] },
    },
  })
  const byId = new Map(materials.map((material) => [material.id, material]))
  const ordered = input.materialIds.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (ordered.length !== input.materialIds.length) throw new Error('部分故事版参考素材不存在或当前账号无权使用。')
  const images = ordered.map((material) => material.storageKey || material.resultUrl || '').filter(Boolean)
  if (images.length !== ordered.length) throw new Error('部分故事版参考素材没有可用图片内容。')
  return {
    images,
    summary: ordered.map((material) => ({
      id: material.id,
      title: text(material.title) || '未命名素材',
      type: 'image' as const,
    })),
  }
}

async function markShotSubmissionFailed(input: {
  planningTaskId: string
  canvasId: string
  nodeId: string
  assetId: string | null
  message: string
}) {
  if (input.assetId) {
    await prisma.frameosToolboxAsset.updateMany({
      where: { id: input.assetId, status: { in: ['pending', 'processing', 'failed'] } },
      data: { status: 'failed', errorMessage: input.message },
    }).catch(() => undefined)
  }
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: input.nodeId,
      canvasId: input.canvasId,
      OR: [{ taskId: input.planningTaskId }, { taskId: null }],
    },
    select: { data: true },
  })
  if (!node) return
  const data = record(node.data)
  const generation = withoutExecution(record(data.generation))
  await prisma.canvasNode.updateMany({
    where: {
      id: input.nodeId,
      canvasId: input.canvasId,
      OR: [{ taskId: input.planningTaskId }, { taskId: null }],
    },
    data: {
      status: 'FAILED',
      taskId: null,
      runId: null,
      data: inputJson({
        ...data,
        generation,
        generationTask: null,
        errorMessage: input.message,
        pollErrorMessage: null,
      }),
    },
  })
}

async function projectLatestAsset(input: {
  userId: string
  projectId: string
  canvasId: string
  nodeId: string
  assetId: string
  taskId: string
}) {
  const asset = await prisma.frameosToolboxAsset.findUnique({ where: { id: input.assetId } })
  if (!asset || (asset.status !== 'ready' && asset.status !== 'failed')) return asset?.status || 'pending'
  // A task can be completed, or an asset can be marked ready, before usable
  // media is persisted. Neither state is a successful canvas result by itself.
  if (asset.status === 'ready' && !text(asset.resultUrl)) return 'pending'
  const material = asset.materialId
    ? await prisma.frameosMaterial.findFirst({
      where: {
        id: asset.materialId,
        userId: input.userId,
        projectId: { in: [input.projectId, 'global', 'global-asset-hub'] },
        deletedAt: null,
      },
      select: { metadata: true },
    })
    : null
  await projectCanvasToolboxTaskTerminal({
    projectId: input.projectId,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    assetId: input.assetId,
    taskId: input.taskId,
    type: 'image',
    status: asset.status,
    resultUrl: asset.resultUrl,
    materialId: asset.materialId,
    materialMetadata: material?.metadata,
    errorMessage: asset.errorMessage,
  })
  return asset.status
}

async function claimStoryboardShotNode(input: {
  planningTaskId: string
  userId: string
  projectId: string
  payload: CanvasStoryboardPlanTaskPayload
  canvasId: string
  nodeId: string
  shotIndex: number
}): Promise<{ expectedTaskId: string | null; alreadyBoundTaskId: string | null }> {
  await assertPlanningCanFanout(input)
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: input.nodeId,
      canvasId: input.canvasId,
      type: 'image',
      canvas: { projectId: input.projectId },
    },
    select: { id: true, data: true, taskId: true },
  })
  if (!node) throw new Error(`镜头 ${input.shotIndex} 的画布节点已被删除。`)
  const data = record(node.data)
  if (text(data.storyboardPlanningTaskId) !== input.planningTaskId) {
    throw new CanvasStoryboardFanoutSupersededError(input.planningTaskId)
  }
  const generation = record(data.generation)
  const expectedAssetId = canvasStoryboardFanoutIds(
    input.planningTaskId,
    input.payload.nodeId,
    input.shotIndex,
  ).assetId
  if (text(generation.assetId) === expectedAssetId && node.taskId) {
    return { expectedTaskId: node.taskId, alreadyBoundTaskId: node.taskId }
  }
  if (node.taskId !== null && node.taskId !== input.planningTaskId) {
    throw new CanvasStoryboardFanoutSupersededError(input.planningTaskId)
  }

  const claimed = await prisma.canvasNode.updateMany({
    where: {
      id: input.nodeId,
      canvasId: input.canvasId,
      taskId: node.taskId,
    },
    data: {
      status: 'RUNNING',
      taskId: input.planningTaskId,
    },
  })
  if (claimed.count !== 1) {
    throw new CanvasStoryboardFanoutSupersededError(input.planningTaskId)
  }
  // This is deliberately the final read before submitTask. A cancel or a new
  // planning task that won the source-node CAS must not create a billable job.
  await assertPlanningCanFanout(input)
  return { expectedTaskId: input.planningTaskId, alreadyBoundTaskId: null }
}

async function submitStoryboardShot(input: {
  planningTaskId: string
  userId: string
  projectId: string
  locale: Locale
  requestId?: string | null
  payload: CanvasStoryboardPlanTaskPayload
  shot: CanvasStoryboardShot
  nodeId: string
  referenceImages: string[]
  referenceSummary: Array<{ id: string; title: string; type: 'image' }>
}): Promise<CanvasStoryboardFanoutShot> {
  const { assetId } = canvasStoryboardFanoutIds(input.planningTaskId, input.payload.nodeId, input.shot.index)
  const title = `故事版 · ${input.shot.index} ${input.shot.title}`
  const options = {
    aspectRatio: input.payload.imageRequest.aspectRatio,
    resolution: input.payload.imageRequest.resolution,
    quality: input.payload.imageRequest.quality,
  }
  const claim = await claimStoryboardShotNode({
    planningTaskId: input.planningTaskId,
    userId: input.userId,
    projectId: input.projectId,
    payload: input.payload,
    canvasId: input.payload.canvasId,
    nodeId: input.nodeId,
    shotIndex: input.shot.index,
  })
  const asset = await prisma.frameosToolboxAsset.upsert({
    where: { id: assetId },
    create: {
      id: assetId,
      userId: input.userId,
      projectId: input.projectId,
      type: 'image',
      source: 'toolbox',
      bizType: 'image_generation',
      modelId: input.payload.imageRequest.modelKey,
      status: 'pending',
      params: inputJson({
        title,
        prompt: input.shot.prompt,
        inputMode: input.payload.imageRequest.inputMode,
        referenceMaterialIds: input.payload.imageRequest.referenceMaterialIds,
        referenceSummary: input.referenceSummary,
        canvasId: input.payload.canvasId,
        nodeId: input.nodeId,
        storyboardPlanningTaskId: input.planningTaskId,
        storyboardIndex: input.shot.index,
        ...options,
      }),
    },
    update: {},
  })

  if (asset.status === 'ready' && text(asset.resultUrl)) {
    // Recovery path for a worker retry after the child completed. No new paid
    // task is needed; use the durable binding (or the reservation if a crash
    // happened immediately before the original bind) to project the asset.
    const taskId = claim.alreadyBoundTaskId || input.planningTaskId
    const bound = await bindCanvasToolboxTaskToNode({
      projectId: input.projectId,
      canvasId: input.payload.canvasId,
      nodeId: input.nodeId,
      assetId: asset.id,
      taskId,
      type: 'image',
      title,
      prompt: input.shot.prompt,
      modelKey: input.payload.imageRequest.modelKey,
      inputMode: input.payload.imageRequest.inputMode,
      options,
      referenceSummary: input.referenceSummary,
      expectedTaskId: claim.expectedTaskId,
      clearGenerationTask: true,
    })
    if (!bound) throw new CanvasStoryboardFanoutSupersededError(input.planningTaskId)
    await projectLatestAsset({
      userId: input.userId,
      projectId: input.projectId,
      canvasId: input.payload.canvasId,
      nodeId: input.nodeId,
      assetId: asset.id,
      taskId,
    })
    return {
      index: input.shot.index,
      nodeId: input.nodeId,
      assetId: asset.id,
      taskId,
      status: 'ready',
      errorMessage: null,
    }
  }

  if (asset.status === 'failed' || (asset.status === 'ready' && !text(asset.resultUrl))) {
    await prisma.frameosToolboxAsset.updateMany({
      where: { id: asset.id, status: asset.status },
      data: { status: 'pending', errorMessage: null, resultUrl: null, materialId: null },
    })
  }

  // submitTask owns dedupe, queue-liveness reconciliation and billing. Do not
  // short-circuit it with a hand-written Task lookup: an active DB row can be
  // an orphan whose BullMQ job has disappeared.
  await assertPlanningCanFanout(input)
  const submitted = await submitTask({
    userId: input.userId,
    locale: input.locale,
    requestId: input.requestId,
    projectId: input.projectId,
    type: TASK_TYPE.TOOLBOX_IMAGE,
    targetType: 'FrameosToolboxAsset',
    targetId: asset.id,
    payload: {
      title,
      prompt: input.shot.prompt,
      inputMode: input.payload.imageRequest.inputMode,
      referenceImages: input.referenceImages,
      referenceVideos: [],
      referenceAudios: [],
      referenceNames: input.referenceSummary.map((item) => item.title),
      referenceImageNames: input.referenceSummary.map((item) => item.title),
      referenceVideoNames: [],
      referenceAudioNames: [],
      referenceMaterialIds: input.payload.imageRequest.referenceMaterialIds,
      referenceSummary: input.referenceSummary,
      canvasId: input.payload.canvasId,
      nodeId: input.nodeId,
      imageModel: input.payload.imageRequest.modelKey,
      modelId: input.payload.imageRequest.modelKey,
      count: 1,
      generationOptions: options,
      ...options,
      storyboardPlanningTaskId: input.planningTaskId,
      storyboardIndex: input.shot.index,
    },
    dedupeKey: `${TASK_TYPE.TOOLBOX_IMAGE}:${asset.id}`,
  })
  const taskId = submitted.taskId
  try {
    await assertPlanningCanFanout(input)
  } catch (error) {
    await cancelTask(taskId, 'Canvas storyboard planning stopped after child submission', {
      projectId: input.projectId,
    }).catch(() => undefined)
    throw error
  }
  const bound = await bindCanvasToolboxTaskToNode({
    projectId: input.projectId,
    canvasId: input.payload.canvasId,
    nodeId: input.nodeId,
    assetId: asset.id,
    taskId,
    type: 'image',
    title,
    prompt: input.shot.prompt,
    modelKey: input.payload.imageRequest.modelKey,
    inputMode: input.payload.imageRequest.inputMode,
    options,
    referenceSummary: input.referenceSummary,
    expectedTaskId: claim.expectedTaskId,
    clearGenerationTask: true,
  })
  if (!bound) {
    await cancelTask(taskId, 'Canvas storyboard shot disappeared before task binding', { projectId: input.projectId }).catch(() => undefined)
    throw new Error(`镜头 ${input.shot.index} 的画布节点已被删除，生成任务已取消。`)
  }
  const latestStatus = await projectLatestAsset({
    userId: input.userId,
    projectId: input.projectId,
    canvasId: input.payload.canvasId,
    nodeId: input.nodeId,
    assetId: asset.id,
    taskId,
  })
  return {
    index: input.shot.index,
    nodeId: input.nodeId,
    assetId: asset.id,
    taskId,
    status: latestStatus === 'ready' ? 'ready' : 'submitted',
    errorMessage: null,
  }
}

/**
 * Materialize a completed storyboard plan entirely on the server. Stable node,
 * group, edge and asset identifiers make worker retries safe; each shot is
 * isolated so a provider/config/billing failure cannot erase its siblings.
 */
export async function materializeCanvasStoryboardFanout(input: {
  planningTaskId: string
  userId: string
  projectId: string
  locale: Locale
  requestId?: string | null
  payload: CanvasStoryboardPlanTaskPayload
  shots: CanvasStoryboardShot[]
}): Promise<CanvasStoryboardFanoutResult> {
  const prepared = await prepareStoryboardGraph(input)
  const plannedShots = prepared.shots
  let validationError: string | null = null
  let references: Awaited<ReturnType<typeof loadImageReferences>> = { images: [], summary: [] }
  try {
    await resolveModelSelection(input.userId, input.payload.imageRequest.modelKey, 'image')
    await resolveProjectModelCapabilityGenerationOptions({
      projectId: input.projectId,
      userId: input.userId,
      modelType: 'image',
      modelKey: input.payload.imageRequest.modelKey,
      runtimeSelections: { resolution: input.payload.imageRequest.resolution },
    })
    references = await loadImageReferences({
      userId: input.userId,
      projectId: input.projectId,
      materialIds: input.payload.imageRequest.referenceMaterialIds,
    })
    if (input.payload.imageRequest.inputMode === 'image' && references.images.length === 0) {
      throw new Error('图生故事版至少需要 1 张可用参考图片。')
    }
  } catch (error) {
    validationError = error instanceof Error ? error.message : '故事版图片生成参数无效。'
  }

  const output: CanvasStoryboardFanoutShot[] = []
  // Submit the source shot last. Until every additional destination has been
  // handled, the source remains bound to the planning task, so a worker crash
  // can retry and reuse the already-created children.
  const ordered = [...plannedShots.slice(1), plannedShots[0]]
  for (const shot of ordered) {
    const nodeId = canvasStoryboardFanoutIds(input.planningTaskId, input.payload.nodeId, shot.index).nodeId
    if (validationError) {
      await markShotSubmissionFailed({
        planningTaskId: input.planningTaskId,
        canvasId: input.payload.canvasId,
        nodeId,
        assetId: null,
        message: validationError,
      })
      output.push({ index: shot.index, nodeId, assetId: null, taskId: null, status: 'failed', errorMessage: validationError })
      continue
    }
    try {
      output.push(await submitStoryboardShot({
        ...input,
        shot,
        nodeId,
        referenceImages: references.images,
        referenceSummary: references.summary,
      }))
    } catch (error) {
      if (
        error instanceof TaskTerminatedError
        || error instanceof CanvasStoryboardFanoutSupersededError
      ) throw error
      const message = error instanceof Error ? error.message : `镜头 ${shot.index} 提交失败。`
      const assetId = canvasStoryboardFanoutIds(input.planningTaskId, input.payload.nodeId, shot.index).assetId
      await markShotSubmissionFailed({
        planningTaskId: input.planningTaskId,
        canvasId: input.payload.canvasId,
        nodeId,
        assetId,
        message,
      })
      output.push({ index: shot.index, nodeId, assetId, taskId: null, status: 'failed', errorMessage: message })
    }
  }
  output.sort((left, right) => left.index - right.index)
  const failedCount = output.filter((shot) => shot.status === 'failed').length
  const submittedCount = output.length - failedCount
  return {
    planningTaskId: input.planningTaskId,
    groupId: prepared.groupId,
    status: failedCount === 0 ? 'submitted' : submittedCount === 0 ? 'failed' : 'partial',
    submittedCount,
    failedCount,
    shots: output,
  }
}
