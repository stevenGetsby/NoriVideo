import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { CanvasGenerationReferenceRole } from './generation-reference-contract'

type ToolboxMediaType = 'image' | 'video' | 'audio' | 'model3d'
type ToolboxCanvasProcessType = 'image_edit' | 'panorama_720'

type ToolboxReferenceSummary = {
  id: string
  title: string
  type: ToolboxMediaType
  durationSeconds?: number | null
  role?: CanvasGenerationReferenceRole
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function history(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function expectedNodeType(type: ToolboxMediaType) {
  return type === 'model3d' ? 'model_3d' : type
}

export async function bindCanvasToolboxTaskToNode(input: {
  projectId: string
  canvasId: string
  nodeId: string
  assetId: string
  taskId: string
  type: ToolboxMediaType
  title: string
  prompt: string
  modelKey: string
  inputMode: string
  options: Record<string, string | number | boolean>
  referenceSummary: ToolboxReferenceSummary[]
  processType?: ToolboxCanvasProcessType | null
  /** Compare-and-swap guard used when a planning task reserved the node. */
  expectedTaskId?: string | null
  clearGenerationTask?: boolean
}) {
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: input.nodeId,
      canvasId: input.canvasId,
      type: expectedNodeType(input.type),
      canvas: { projectId: input.projectId },
    },
    select: { id: true, data: true, taskId: true },
  })
  if (!node) return false
  if (
    Object.prototype.hasOwnProperty.call(input, 'expectedTaskId')
    && node.taskId !== input.expectedTaskId
  ) return false

  const data = record(node.data)
  const generation = record(data.generation)
  const existingHistory = history(data.history)
  const historyId = `asset:${input.assetId}`
  const nextHistory = [
    {
      id: historyId,
      assetId: input.assetId,
      taskId: input.taskId,
      prompt: input.prompt,
      modelKey: input.modelKey,
      parameters: { inputMode: input.inputMode, ...input.options },
      references: input.referenceSummary,
      source: 'generation',
      status: 'processing',
      errorMessage: null,
      createdAt: new Date().toISOString(),
    },
    ...existingHistory.filter((item) => item.id !== historyId),
  ].slice(0, 40)

  const updated = await prisma.canvasNode.updateMany({
    where: {
      id: node.id,
      canvasId: input.canvasId,
      ...(Object.prototype.hasOwnProperty.call(input, 'expectedTaskId')
        ? { taskId: input.expectedTaskId }
        : {}),
    },
    data: {
      status: 'RUNNING',
      taskId: input.taskId,
      runId: null,
      data: inputJson({
        ...data,
        title: typeof data.title === 'string' && data.title.trim() ? data.title : input.title,
        mediaType: input.type,
        origin: 'generate',
        ...(input.processType ? { processType: input.processType } : {}),
        prompt: input.prompt,
        generation: {
          ...generation,
          modelKey: input.modelKey,
          assetId: input.assetId,
          taskId: input.taskId,
          inputMode: input.inputMode,
          referenceSummary: input.referenceSummary,
          ...input.options,
        },
        history: nextHistory,
        ...(input.clearGenerationTask ? { generationTask: null } : {}),
        progress: 2,
        errorMessage: null,
        pollErrorMessage: null,
      }),
    },
  })
  return updated.count === 1
}

export async function projectCanvasToolboxSubmissionFailure(input: {
  projectId: string
  canvasId?: string | null
  nodeId?: string | null
  assetId: string
  type: ToolboxMediaType
  title: string
  prompt: string
  modelKey: string
  inputMode: string
  options: Record<string, string | number | boolean>
  referenceSummary: ToolboxReferenceSummary[]
  errorMessage: string
}) {
  if (!input.canvasId || !input.nodeId) return false
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: input.nodeId,
      canvasId: input.canvasId,
      type: expectedNodeType(input.type),
      taskId: null,
      canvas: { projectId: input.projectId },
    },
    select: { id: true, data: true },
  })
  if (!node) return false
  const data = record(node.data)
  const generation = { ...record(data.generation) }
  delete generation.taskId
  const historyId = `asset:${input.assetId}`
  const nextHistory = [
    {
      id: historyId,
      assetId: input.assetId,
      prompt: input.prompt,
      modelKey: input.modelKey,
      parameters: { inputMode: input.inputMode, ...input.options },
      references: input.referenceSummary,
      source: 'generation',
      status: 'failed',
      errorMessage: input.errorMessage,
      createdAt: new Date().toISOString(),
    },
    ...history(data.history).filter((item) => item.id !== historyId),
  ].slice(0, 40)
  const updated = await prisma.canvasNode.updateMany({
    where: { id: node.id, canvasId: input.canvasId, taskId: null },
    data: {
      status: 'FAILED',
      data: inputJson({
        ...data,
        title: typeof data.title === 'string' && data.title.trim() ? data.title : input.title,
        mediaType: input.type,
        origin: 'generate',
        prompt: input.prompt,
        generation: {
          ...generation,
          modelKey: input.modelKey,
          assetId: input.assetId,
          inputMode: input.inputMode,
          referenceSummary: input.referenceSummary,
          ...input.options,
        },
        history: nextHistory,
        errorMessage: input.errorMessage,
        pollErrorMessage: null,
      }),
    },
  })
  return updated.count === 1
}

export async function projectCanvasToolboxTaskTerminal(input: {
  projectId: string
  canvasId?: string | null
  nodeId?: string | null
  assetId: string
  taskId: string
  type: ToolboxMediaType
  status: 'ready' | 'failed'
  resultUrl?: string | null
  materialId?: string | null
  materialMetadata?: unknown
  errorMessage?: string | null
}) {
  if (!input.canvasId || !input.nodeId) return false
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: input.nodeId,
      canvasId: input.canvasId,
      type: expectedNodeType(input.type),
      taskId: input.taskId,
      canvas: { projectId: input.projectId },
    },
    select: { id: true, data: true },
  })
  if (!node) return false
  const data = record(node.data)
  const generation = record(data.generation)
  if (generation.assetId !== input.assetId || generation.taskId !== input.taskId) return false

  const ready = input.status === 'ready' && Boolean(input.resultUrl)
  const nextHistory = history(data.history).map((item) => item.assetId === input.assetId
    ? {
        ...item,
        status: ready ? 'ready' : 'failed',
        url: ready ? input.resultUrl : item.url,
        materialId: ready ? input.materialId : item.materialId,
        errorMessage: ready ? null : input.errorMessage || '生成失败',
      }
    : item)
  const nextData = {
    ...data,
    ...(ready ? {
      contentUrl: input.resultUrl,
      imageUrl: input.type === 'image' ? input.resultUrl : data.imageUrl,
      videoUrl: input.type === 'video' ? input.resultUrl : data.videoUrl,
      audioUrl: input.type === 'audio' ? input.resultUrl : data.audioUrl,
      modelUrl: input.type === 'model3d' ? input.resultUrl : data.modelUrl,
      posterUrl: input.type === 'model3d' && typeof record(input.materialMetadata).thumbnailUrl === 'string'
        ? record(input.materialMetadata).thumbnailUrl
        : data.posterUrl,
      materialId: input.materialId || data.materialId,
      sourceMetadata: record(input.materialMetadata),
    } : {}),
    progress: ready ? 100 : typeof data.progress === 'number' ? data.progress : 0,
    errorMessage: ready ? null : input.errorMessage || '生成失败',
    pollErrorMessage: null,
    history: nextHistory,
  }
  const updated = await prisma.canvasNode.updateMany({
    where: { id: node.id, canvasId: input.canvasId, taskId: input.taskId },
    data: {
      status: ready ? 'SUCCEEDED' : 'FAILED',
      data: inputJson(nextData),
    },
  })
  return updated.count === 1
}
