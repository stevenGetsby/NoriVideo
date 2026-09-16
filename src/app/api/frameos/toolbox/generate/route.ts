import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { resolveModelSelection } from '@/lib/api-config'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE, type TaskType } from '@/lib/task/types'
import { getCapabilityOptionFields, resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import {
  firstLastFrameInputSchema,
  readMediaDurationSeconds,
  resolveCanvasGenerationInputSchema,
  validateCanvasReferenceMedia,
  validateCanvasRequiredFields,
  validateVideoReferenceMediaCombination,
  type CanvasReferenceMediaSummary,
} from '@/lib/canvas/generation-input-schema'
import { normalizeCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { isSeedance25VideoModelKey } from '@/lib/canvas/generator-options'
import {
  bindCanvasToolboxTaskToNode,
  projectCanvasToolboxSubmissionFailure,
  projectCanvasToolboxTaskTerminal,
} from '@/lib/canvas/toolbox-node-binding'
import { cancelTask } from '@/lib/task/service'
import { normalizeAudioGenerationRequest } from '@/lib/audio/generation-contract'
import { resolveAudioGenerationAvailability } from '@/lib/audio/provider'
import {
  FRAMEOS_3D_MODEL_KEY,
  getFrameos3DModelAvailability,
  normalizeFrameos3DPose,
  normalizeFrameos3DTopology,
} from '@/lib/model3d/frameos-3d-provider'
import {
  CANVAS_IMAGE_EDIT_MODE,
  CANVAS_IMAGE_EDIT_PROCESS_TYPE,
  isCanvasImageEditProcessType,
  supportsCanvasImageInpaint,
} from '@/lib/canvas/image-edit-contract'
import {
  CANVAS_PANORAMA_PROCESS_TYPE,
  isCanvasPanoramaProcessType,
} from '@/lib/canvas/panorama-contract'
import { prepareCanvasToolboxImageOutputs } from '@/lib/canvas/toolbox-output-nodes'
import { isFrameosAssetCategory, normalizeFrameosAssetCategory } from '@/lib/frameos/material-category'

type GenerateType = 'image' | 'video' | 'audio' | 'model3d'

type GenerationOptionValue = string | number | boolean
type GenerationOptionPrimitive = 'string' | 'number' | 'boolean'

const GENERATION_OPTION_TYPES: Record<GenerateType, Readonly<Record<string, GenerationOptionPrimitive>>> = {
  image: {
    aspectRatio: 'string',
    resolution: 'string',
    quality: 'string',
  },
  video: {
    aspectRatio: 'string',
    resolution: 'string',
    duration: 'number',
    generateAudio: 'boolean',
    fps: 'number',
  },
  audio: {
    mode: 'string',
    voice: 'string',
    duration: 'number',
    rate: 'string',
    genre: 'string',
    sfxKind: 'string',
  },
  model3d: {
    topology: 'string',
    generateTexture: 'boolean',
    pose: 'string',
  },
}

// These are derived or authorization-sensitive fields. They must never be
// accepted through the open-ended `options` bag, even if a future capability
// catalog happens to expose a similarly named field.
const TRUSTED_GENERATION_FIELDS = new Set([
  'projectId',
  'canvasId',
  'nodeId',
  'type',
  'title',
  'prompt',
  'modelKey',
  'modelId',
  'imageModel',
  'videoModel',
  'audioModel',
  'model3dModel',
  'inputMode',
  'count',
  'processType',
  'editMode',
  'maskImage',
  'maskMaterialId',
  'referenceImages',
  'referenceVideos',
  'referenceAudios',
  'referenceNames',
  'referenceImageNames',
  'referenceVideoNames',
  'referenceAudioNames',
  'referenceMaterialIds',
  'referenceMaterials',
  'referenceSummary',
  'generationMode',
  'generationOptions',
  'idempotencyKey',
  'requestHash',
  'assetCategory',
])

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function cleanMaterialIds(value: unknown, limit = 9): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map(cleanText)
    .filter(Boolean)))
    .slice(0, limit)
}

function cleanOptions(
  type: GenerateType,
  value: unknown,
  capabilityFields: Record<string, readonly GenerationOptionValue[]> = {},
): Record<string, GenerationOptionValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, GenerationOptionValue> = {}
  const allowedTypes = GENERATION_OPTION_TYPES[type]
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (TRUSTED_GENERATION_FIELDS.has(key)) continue
    const declaredType = allowedTypes[key]
    const capabilityValues = capabilityFields[key]
    if (!declaredType && !capabilityValues) continue
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') continue
    if (declaredType && typeof item !== declaredType) continue
    if (!declaredType && capabilityValues && !capabilityValues.some((candidate) => typeof candidate === typeof item)) continue
    const normalized = typeof item === 'string' ? item.trim() : item
    if (normalized === '') continue
    if (capabilityValues && !capabilityValues.includes(normalized)) {
      throw new ApiError('INVALID_PARAMS', {
        message: `当前模型不支持 options.${key}=${String(normalized)}。`,
      })
    }
    result[key] = normalized
  }
  return result
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stableToolboxAssetId(params: {
  userId: string
  projectId: string
  canvasId?: string
  nodeId?: string
  type: GenerateType
  idempotencyKey: string
  index: number
}) {
  const hex = createHash('sha256')
    .update(JSON.stringify(params))
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function toolboxRequestHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function assertMatchingToolboxRequestHash(asset: { params?: unknown }, requestHash: string) {
  const storedHash = cleanText(record(asset.params).requestHash)
  if (storedHash && storedHash !== requestHash) {
    throw new ApiError('CONFLICT', {
      message: '该幂等键已用于另一组生成参数，请使用新的幂等键重新提交。',
    })
  }
}

function resolveIdempotencyKey(value: unknown): string {
  const key = cleanText(value)
  if (!key) return ''
  if (key.length > 300 || !/^[A-Za-z0-9][A-Za-z0-9._:~-]*$/.test(key)) {
    throw new ApiError('INVALID_PARAMS', {
      message: '幂等键格式无效，只能包含字母、数字、点、下划线、冒号、波浪号或连字符，且最长 300 个字符。',
    })
  }
  return key
}

async function compensateToolboxSubmissionFailure(assetId: string, error: unknown) {
  return await prisma.frameosToolboxAsset.updateMany({
    where: { id: assetId, status: { not: 'ready' } },
    data: {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    },
  }).then((result) => result.count > 0).catch(() => false)
}

async function reviveFailedToolboxAsset(asset: { id: string; status: string }) {
  if (asset.status !== 'failed') return
  await prisma.frameosToolboxAsset.updateMany({
    where: { id: asset.id, status: 'failed' },
    data: { status: 'pending', errorMessage: null },
  })
}

async function reusableReadyToolboxTaskId(asset: {
  id: string
  status: string
  resultUrl?: string | null
}, input: {
  userId: string
  projectId: string
  type: TaskType
}): Promise<string | null> {
  if (asset.status !== 'ready' || !cleanText(asset.resultUrl)) return null
  const task = await prisma.task.findFirst({
    where: {
      userId: input.userId,
      projectId: input.projectId,
      type: input.type,
      targetType: 'FrameosToolboxAsset',
      targetId: asset.id,
      status: TASK_STATUS.COMPLETED,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  // A legacy ready asset may predate the durable Task table. It is still the
  // authoritative idempotent result; a synthetic history id avoids paying for
  // the same request again and is never polled because the node is projected
  // directly to SUCCEEDED below.
  return task?.id || `ready-asset:${asset.id}`
}

async function projectLatestBoundToolboxAsset(input: {
  projectId: string
  canvasId: string
  nodeId: string
  assetId: string
  taskId: string
  type: GenerateType
  projectFailure?: boolean
}) {
  const latest = await prisma.frameosToolboxAsset.findUnique({ where: { id: input.assetId } })
  if (!latest) return null
  if (latest.status !== 'ready' && (latest.status !== 'failed' || input.projectFailure === false)) return latest
  const material = latest.materialId
    ? await prisma.frameosMaterial.findFirst({
      where: { id: latest.materialId, deletedAt: null },
      select: { id: true, metadata: true },
    })
    : null
  const assetParams = record(latest.params)
  const materialMetadata = {
    ...record(material?.metadata),
    ...(typeof assetParams.thumbnailUrl === 'string' ? { thumbnailUrl: assetParams.thumbnailUrl } : {}),
  }
  await projectCanvasToolboxTaskTerminal({
    projectId: input.projectId,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    assetId: input.assetId,
    taskId: input.taskId,
    type: input.type,
    status: latest.status === 'ready' ? 'ready' : 'failed',
    resultUrl: latest.resultUrl,
    materialId: latest.materialId,
    materialMetadata,
    errorMessage: latest.errorMessage,
  })
  return latest
}

async function bindModel3DTaskToCanvasNode(params: {
  projectId: string
  canvasId: string
  nodeId: string
  assetId: string
  taskId: string
  title: string
  prompt: string
  topology: 'standard' | 'low_poly'
  generateTexture: boolean
  pose: 'none' | 'a_pose' | 't_pose'
}) {
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: params.nodeId,
      canvasId: params.canvasId,
      type: 'model_3d',
      canvas: { projectId: params.projectId },
    },
    select: { id: true, data: true },
  })
  if (!node) throw new ApiError('NOT_FOUND', { message: '3D 模型节点不存在或不属于当前画布。' })

  const current = record(node.data)
  const generation = record(current.generation)
  const parameters = record(generation.parameters)
  const updated = await prisma.canvasNode.updateMany({
    where: { id: node.id, canvasId: params.canvasId },
    data: {
      status: 'RUNNING',
      taskId: params.taskId,
      data: {
        ...current,
        title: cleanText(current.title) || params.title,
        mediaType: 'model3d',
        origin: 'generate',
        processType: 'model_3d',
        prompt: params.prompt,
        generation: {
          ...generation,
          modelKey: FRAMEOS_3D_MODEL_KEY,
          modelLabel: '帧界 3D 1.0',
          assetId: params.assetId,
          taskId: params.taskId,
          parameters: {
            ...parameters,
            topology: params.topology,
            generateTexture: params.generateTexture,
            pose: params.pose,
          },
        },
        progress: 2,
        errorMessage: null,
      },
    },
  })
  if (updated.count !== 1) throw new ApiError('NOT_FOUND', { message: '3D 模型节点已被删除。' })
}

export const POST = apiHandler(async (
  request: NextRequest,
  context?: { params?: Promise<{ projectId?: string; canvasId?: string }> },
) => {
  const body = await request.json() as Record<string, unknown>
  const projectId = cleanText(body.projectId)
  const type = cleanText(body.type) as GenerateType
  const title = cleanText(body.title)
  const prompt = cleanText(body.prompt)
  const modelKey = cleanText(body.modelKey)
  if (body.assetCategory !== undefined && !isFrameosAssetCategory(body.assetCategory)) {
    throw new ApiError('INVALID_PARAMS', { message: '素材归类无效。' })
  }
  const assetCategory = normalizeFrameosAssetCategory(body.assetCategory)
  const processType = cleanText(body.processType)
  const requestedEditMode = cleanText(body.editMode)
  const requestedMaskImage = cleanText(body.maskImage)
  const maskMaterialId = cleanText(body.maskMaterialId)
  if (!projectId || (type !== 'image' && type !== 'video' && type !== 'audio' && type !== 'model3d') || !title || !prompt || !modelKey) {
    throw new ApiError('INVALID_PARAMS', { message: '项目、名称、模型和提示词均为必填项。' })
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const routeParams = context?.params ? await context.params : null
  const canvasId = cleanText(routeParams?.canvasId) || cleanText(body.canvasId)
  const nodeId = cleanText(body.nodeId)
  if (canvasId && !nodeId) throw new ApiError('INVALID_PARAMS', { message: '画布生成缺少目标节点。' })

  if (type === 'model3d') {
    if (modelKey !== FRAMEOS_3D_MODEL_KEY) {
      throw new ApiError('INVALID_PARAMS', { message: '当前仅支持帧界 3D 1.0 模型。' })
    }
    const availability = getFrameos3DModelAvailability()
    if (!availability.available) {
      throw new ApiError('INVALID_PARAMS', { message: availability.unavailableReason || '帧界 3D 服务未配置。' })
    }
    const materialIds = cleanMaterialIds(body.referenceMaterialIds)
    if (materialIds.length > 0) {
      throw new ApiError('INVALID_PARAMS', { message: '帧界 3D 1.0 当前仅支持文本生成，请移除参考素材。' })
    }
    const options = cleanOptions('model3d', body.options)
    const topology = normalizeFrameos3DTopology(options.topology)
    const generateTexture = options.generateTexture !== false
    const pose = normalizeFrameos3DPose(options.pose)
    const idempotencyKey = resolveIdempotencyKey(body.idempotencyKey)
    if (canvasId) {
      const exists = await prisma.canvasNode.findFirst({
        where: { id: nodeId, canvasId, type: 'model_3d', canvas: { projectId } },
        select: { id: true },
      })
      if (!exists) throw new ApiError('NOT_FOUND', { message: '3D 模型节点不存在或不属于当前画布。' })
    }

    const requestHash = toolboxRequestHash({
      projectId,
      canvasId: canvasId || null,
      nodeId: nodeId || null,
      type,
      title,
      prompt,
      modelKey,
      topology,
      generateTexture,
      pose,
    })
    const assetData = {
      userId: session.user.id,
      projectId,
      type: 'model3d',
      source: 'toolbox',
      bizType: 'model3d_generation',
      modelId: modelKey,
      status: 'pending',
      params: {
        title,
        prompt,
        topology,
        generateTexture,
        pose,
        canvasId: canvasId || null,
        nodeId: nodeId || null,
        idempotencyKey: idempotencyKey || null,
        requestHash,
      },
    }
    const stableAssetId = idempotencyKey
      ? stableToolboxAssetId({ userId: session.user.id, projectId, canvasId, nodeId, type, idempotencyKey, index: 0 })
      : null
    const asset = stableAssetId
      ? await prisma.frameosToolboxAsset.upsert({
        where: { id: stableAssetId },
        create: { id: stableAssetId, ...assetData },
        update: {},
      })
      : await prisma.frameosToolboxAsset.create({ data: assetData })
    if (stableAssetId) assertMatchingToolboxRequestHash(asset, requestHash)

    const readyTaskId = stableAssetId
      ? await reusableReadyToolboxTaskId(asset, {
          userId: session.user.id,
          projectId,
          type: TASK_TYPE.TOOLBOX_MODEL_3D,
        })
      : null
    if (readyTaskId) {
      if (canvasId) {
        await bindModel3DTaskToCanvasNode({
          projectId,
          canvasId,
          nodeId,
          assetId: asset.id,
          taskId: readyTaskId,
          title,
          prompt,
          topology,
          generateTexture,
          pose,
        })
        await projectLatestBoundToolboxAsset({
          projectId, canvasId, nodeId, assetId: asset.id, taskId: readyTaskId, type: 'model3d',
        })
      }
      return NextResponse.json({ success: true, reused: true, tasks: [{ taskId: readyTaskId, assetId: asset.id }] })
    }

    let taskId = ''
    try {
      await reviveFailedToolboxAsset(asset)
      const submitted = await submitTask({
        userId: session.user.id,
        locale: resolveRequiredTaskLocale(request, body),
        requestId: getRequestId(request),
        projectId,
        type: TASK_TYPE.TOOLBOX_MODEL_3D,
        targetType: 'FrameosToolboxAsset',
        targetId: asset.id,
        payload: {
          title,
          ownerName: session.user.name || null,
          prompt,
          model3dModel: modelKey,
          topology,
          generateTexture,
          pose,
        },
        dedupeKey: `${TASK_TYPE.TOOLBOX_MODEL_3D}:${asset.id}`,
        maxAttempts: 3,
      })
      taskId = submitted.taskId
    } catch (error) {
      await compensateToolboxSubmissionFailure(asset.id, error)
      throw error
    }
    if (canvasId) {
      await bindModel3DTaskToCanvasNode({
        projectId,
        canvasId,
        nodeId,
        assetId: asset.id,
        taskId,
        title,
        prompt,
        topology,
        generateTexture,
        pose,
      })
      // The worker can finish between queue submission and node binding. A
      // fresh read closes that race; failures remain governed by task retry
      // reconciliation because the 3D worker may still retry externally.
      await projectLatestBoundToolboxAsset({
        projectId, canvasId, nodeId, assetId: asset.id, taskId, type: 'model3d', projectFailure: false,
      })
    }
    return NextResponse.json({ success: true, tasks: [{ taskId, assetId: asset.id }] })
  }

  await resolveModelSelection(session.user.id, modelKey, type)
  const capabilities = resolveBuiltinCapabilitiesByModelKey(type, modelKey)
  const imageEdit = type === 'image' && isCanvasImageEditProcessType(processType)
  const panorama = type === 'image' && isCanvasPanoramaProcessType(processType)
  const canvasProcessType = imageEdit
    ? CANVAS_IMAGE_EDIT_PROCESS_TYPE
    : panorama
      ? CANVAS_PANORAMA_PROCESS_TYPE
      : null
  if (processType === CANVAS_IMAGE_EDIT_PROCESS_TYPE && type !== 'image') {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版重绘只支持图片节点。' })
  }
  if (processType === CANVAS_PANORAMA_PROCESS_TYPE && type !== 'image') {
    throw new ApiError('INVALID_PARAMS', { message: '720° 全景只支持图片节点。' })
  }
  if (!imageEdit && (maskMaterialId || requestedEditMode || requestedMaskImage)) {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版字段只能用于 processType=image_edit 的图片任务。' })
  }
  if (imageEdit && requestedEditMode && requestedEditMode !== CANVAS_IMAGE_EDIT_MODE) {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版重绘只支持 editMode=inpaint。' })
  }
  if (imageEdit && requestedMaskImage) {
    throw new ApiError('INVALID_PARAMS', { message: '请只提交 maskMaterialId；服务端会安全解析蒙版内容。' })
  }
  if (imageEdit && !maskMaterialId) {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版重绘缺少独立的 maskMaterialId。' })
  }
  if (imageEdit && !supportsCanvasImageInpaint(modelKey)) {
    throw new ApiError('INVALID_PARAMS', { message: '当前图片模型不支持蒙版重绘，请选择明确支持 Inpaint 的模型。' })
  }

  const inputMode = cleanText(body.inputMode) || 'text'
  const legacyMaterialIds = cleanMaterialIds(body.referenceMaterialIds, type === 'video' ? 15 : 9)
  const referenceContract = normalizeCanvasGenerationMaterialReferences({
    value: body.referenceMaterials,
    legacyMaterialIds,
    inputMode,
    limit: type === 'video' ? 15 : 9,
  })
  if (!referenceContract.success) {
    throw new ApiError('INVALID_PARAMS', { message: referenceContract.message })
  }
  const referenceMaterials = referenceContract.references
  const materialIds = referenceMaterials.map((item) => item.materialId)
  if (imageEdit && materialIds.includes(maskMaterialId)) {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版必须通过 maskMaterialId 单独提交，不能混入普通参考图片。' })
  }
  const materials = materialIds.length > 0
    ? await prisma.frameosMaterial.findMany({
      where: {
        id: { in: materialIds },
        userId: session.user.id,
        type: type === 'video' ? { in: ['image', 'video', 'audio'] } : type,
        status: 'ready',
        deletedAt: null,
        projectId: { in: [projectId, 'global', 'global-asset-hub'] },
      },
    })
    : []
  const byId = new Map(materials.map((material) => [material.id, material]))
  const orderedMaterials = materialIds.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (orderedMaterials.length !== materialIds.length) {
    throw new ApiError('INVALID_PARAMS', { message: '部分参考素材不存在或当前账号无权使用。' })
  }

  const maskMaterial = imageEdit
    ? await prisma.frameosMaterial.findFirst({
      where: {
        id: maskMaterialId,
        userId: session.user.id,
        type: 'image',
        status: 'ready',
        deletedAt: null,
        projectId: { in: [projectId, 'global', 'global-asset-hub'] },
      },
    })
    : null
  if (imageEdit && !maskMaterial) {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版素材不存在、未就绪或当前账号无权使用。' })
  }

  const referenceImages = orderedMaterials.filter((material) => material.type === 'image')
  const referenceVideos = orderedMaterials.filter((material) => material.type === 'video')
  const referenceAudios = orderedMaterials.filter((material) => material.type === 'audio')
  if (imageEdit && referenceImages.length !== 1) {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版重绘必须且只能使用 1 张原始图片。' })
  }

  const referenceRoleByMaterialId = new Map(referenceMaterials.map((item) => [item.materialId, item.role]))
  const capabilityFields = getCapabilityOptionFields(type, capabilities)
  const options = cleanOptions(type, body.options, capabilityFields)
  const idempotencyKey = resolveIdempotencyKey(body.idempotencyKey)
  if (type === 'video' && inputMode !== 'text' && inputMode !== 'image' && inputMode !== 'firstlastframe') {
    throw new ApiError('INVALID_PARAMS', { message: '视频模式仅支持全能参考或首尾帧。' })
  }
  if (type === 'video' && inputMode === 'firstlastframe' && referenceImages.length !== 2) {
    throw new ApiError('INVALID_PARAMS', { message: '首尾帧模式需要按顺序选择 2 张图片。' })
  }
  const referenceSummary: CanvasReferenceMediaSummary[] = orderedMaterials.flatMap((material) => {
    if (material.type !== 'image' && material.type !== 'video' && material.type !== 'audio') return []
    return [{
      id: material.id,
      title: material.title?.trim() || '未命名素材',
      type: material.type,
      role: referenceRoleByMaterialId.get(material.id) || 'REF',
      ...(material.type === 'video' || material.type === 'audio'
        ? { durationSeconds: readMediaDurationSeconds(material.metadata) }
        : {}),
    }]
  })
  const inputVideoSeconds = referenceVideos.reduce(
    (total, material) => total + (readMediaDurationSeconds(material.metadata) || 0),
    0,
  )
  const inputSchema = type === 'video' && inputMode === 'firstlastframe'
    ? firstLastFrameInputSchema()
    : resolveCanvasGenerationInputSchema(type, capabilities)
  const inputErrors = [
    ...validateCanvasRequiredFields(inputSchema, {
      prompt,
      inputMode,
      ...options,
      voice: type === 'audio' ? cleanText(options.voice) : options.voice,
    }),
    ...validateCanvasReferenceMedia(inputSchema, referenceSummary, {
      enforceMinimums: true,
      requireKnownAudioDuration: true,
    }),
    ...(type === 'video' ? validateVideoReferenceMediaCombination(referenceSummary, {
      allowAudioOnly: isSeedance25VideoModelKey(modelKey),
    }) : []),
  ]
  if (inputErrors.length > 0) throw new ApiError('INVALID_PARAMS', { message: inputErrors[0] })

  if (type === 'audio') {
    let audioRequest: ReturnType<typeof normalizeAudioGenerationRequest>
    try {
      audioRequest = normalizeAudioGenerationRequest({
        modelKey,
        prompt,
        capabilities: capabilities?.audio || null,
        options,
      })
      await resolveProjectModelCapabilityGenerationOptions({
        projectId,
        userId: session.user.id,
        modelType: 'audio',
        modelKey,
        runtimeSelections: { mode: audioRequest.mode },
      })
    } catch (error) {
      throw new ApiError('INVALID_PARAMS', {
        message: error instanceof Error ? error.message : '音频生成参数无效。',
      })
    }
    const availability = await resolveAudioGenerationAvailability({ userId: session.user.id, modelKey })
    if (!availability.available || !availability.modes.includes(audioRequest.mode)) {
      throw new ApiError('INVALID_PARAMS', {
        message: availability.unavailableReason || '当前音频模型没有可用的生成后端。',
      })
    }
    const requestHash = toolboxRequestHash({
      projectId,
      canvasId: canvasId || null,
      nodeId: nodeId || null,
      type,
      title,
      prompt: audioRequest.prompt,
      modelKey,
      mode: audioRequest.mode,
      voice: audioRequest.voice,
      duration: audioRequest.durationSeconds,
      genre: audioRequest.genre,
      sfxKind: audioRequest.sfxKind,
      referenceMaterialIds: materialIds,
      referenceMaterials,
    })
    const assetData = {
      userId: session.user.id,
      projectId,
      type: 'audio',
      source: 'toolbox',
      bizType: 'audio_generation',
      modelId: modelKey,
      status: 'pending',
      params: {
        title,
        prompt: audioRequest.prompt,
        mode: audioRequest.mode,
        voice: audioRequest.voice,
        duration: audioRequest.durationSeconds,
        genre: audioRequest.genre,
        sfxKind: audioRequest.sfxKind,
        referenceMaterialIds: materialIds,
        referenceMaterials,
        referenceSummary,
        canvasId: canvasId || null,
        nodeId: nodeId || null,
        idempotencyKey: idempotencyKey || null,
        requestHash,
      },
    }
    const stableAssetId = idempotencyKey
      ? stableToolboxAssetId({ userId: session.user.id, projectId, canvasId, nodeId, type, idempotencyKey, index: 0 })
      : null
    const asset = stableAssetId
      ? await prisma.frameosToolboxAsset.upsert({ where: { id: stableAssetId }, create: { id: stableAssetId, ...assetData }, update: {} })
      : await prisma.frameosToolboxAsset.create({ data: assetData })
    if (stableAssetId) assertMatchingToolboxRequestHash(asset, requestHash)
    const readyTaskId = stableAssetId
      ? await reusableReadyToolboxTaskId(asset, {
          userId: session.user.id,
          projectId,
          type: TASK_TYPE.TOOLBOX_AUDIO,
        })
      : null
    if (readyTaskId) {
      if (canvasId) {
        const bound = await bindCanvasToolboxTaskToNode({
          projectId,
          canvasId,
          nodeId,
          assetId: asset.id,
          taskId: readyTaskId,
          type: 'audio',
          title,
          prompt: audioRequest.prompt,
          modelKey,
          inputMode,
          options: {
            ...options,
            mode: audioRequest.mode,
            voice: audioRequest.voice || '',
            ...(audioRequest.durationSeconds !== null ? { duration: audioRequest.durationSeconds } : {}),
          },
          referenceSummary,
        })
        if (!bound) throw new ApiError('NOT_FOUND', { message: '画布音频节点不存在或已被删除。' })
        await projectLatestBoundToolboxAsset({
          projectId, canvasId, nodeId, assetId: asset.id, taskId: readyTaskId, type: 'audio',
        })
      }
      return NextResponse.json({ success: true, reused: true, tasks: [{ taskId: readyTaskId, assetId: asset.id }] })
    }
    await reviveFailedToolboxAsset(asset)
    let taskId = ''
    try {
      const submitted = await submitTask({
        userId: session.user.id,
        locale: resolveRequiredTaskLocale(request, body),
        requestId: getRequestId(request),
        projectId,
        type: TASK_TYPE.TOOLBOX_AUDIO,
        targetType: 'FrameosToolboxAsset',
        targetId: asset.id,
        payload: {
          title,
          ownerName: session.user.name || null,
          prompt: audioRequest.prompt,
          audioModel: modelKey,
          mode: audioRequest.mode,
          voice: audioRequest.voice,
          duration: audioRequest.durationSeconds,
          genre: audioRequest.genre,
          sfxKind: audioRequest.sfxKind,
          referenceMaterialIds: materialIds,
          referenceMaterials,
          referenceSummary,
          ...(canvasId ? { canvasId, nodeId } : {}),
        },
        dedupeKey: `${TASK_TYPE.TOOLBOX_AUDIO}:${asset.id}`,
        maxAttempts: 5,
      })
      taskId = submitted.taskId
    } catch (error) {
      await compensateToolboxSubmissionFailure(asset.id, error)
      throw error
    }
    if (canvasId) {
      const bound = await bindCanvasToolboxTaskToNode({
        projectId,
        canvasId,
        nodeId,
        assetId: asset.id,
        taskId,
        type: 'audio',
        title,
        prompt: audioRequest.prompt,
        modelKey,
        inputMode,
        options: {
          ...options,
          mode: audioRequest.mode,
          voice: audioRequest.voice || '',
          ...(audioRequest.durationSeconds !== null ? { duration: audioRequest.durationSeconds } : {}),
        },
        referenceSummary,
      })
      if (!bound) {
        await cancelTask(taskId, 'Canvas audio node disappeared before generation binding', { projectId }).catch(() => undefined)
        await compensateToolboxSubmissionFailure(asset.id, new Error('画布音频节点不存在或已被删除。'))
        throw new ApiError('NOT_FOUND', { message: '画布音频节点不存在或已被删除，生成任务已取消。' })
      }
      await projectLatestBoundToolboxAsset({
        projectId, canvasId, nodeId, assetId: asset.id, taskId, type: 'audio', projectFailure: true,
      })
    }
    return NextResponse.json({ success: true, tasks: [{ taskId, assetId: asset.id }] })
  }
  if (type === 'video' && inputMode !== 'text' && (referenceVideos.length > 0 || referenceAudios.length > 0)) {
    throw new ApiError('INVALID_PARAMS', { message: '图生视频和首尾帧模式只能使用参考图片；视频或音频素材请切换到全能参考。' })
  }
  if (type === 'video' && inputMode === 'image' && referenceImages.length < 1) {
    throw new ApiError('INVALID_PARAMS', { message: '图生视频至少需要 1 张参考图片。' })
  }
  const runtimeSelections: Record<string, string | number | boolean> = {}
  const declaresCapabilityField = (field: string) => capabilities !== undefined && Object.hasOwn(capabilityFields, field)
  if (type === 'image') {
    if (typeof options.resolution === 'string') runtimeSelections.resolution = options.resolution
  } else {
    if (typeof options.resolution === 'string') runtimeSelections.resolution = options.resolution
    if (typeof options.duration === 'number') runtimeSelections.duration = options.duration
    if (typeof options.fps === 'number') runtimeSelections.fps = options.fps
    if (typeof options.generateAudio === 'boolean' && (options.generateAudio || declaresCapabilityField('generateAudio'))) {
      runtimeSelections.generateAudio = options.generateAudio
    }
    const generationMode = inputMode === 'firstlastframe' ? 'firstlastframe' : 'normal'
    if (generationMode === 'firstlastframe' || declaresCapabilityField('generationMode')) {
      runtimeSelections.generationMode = generationMode
    }
  }
  try {
    await resolveProjectModelCapabilityGenerationOptions({
      projectId,
      userId: session.user.id,
      modelType: type,
      modelKey,
      runtimeSelections,
    })
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      message: error instanceof Error ? error.message : '当前模型不支持这组生成参数。',
    })
  }

  const count = imageEdit || panorama ? 1 : type === 'image' ? numberInRange(body.count, 1, 4, 1) : 1
  if (count > 1 && !idempotencyKey) {
    throw new ApiError('INVALID_PARAMS', { message: '多输出生成必须提供有效的 idempotencyKey。' })
  }
  const requestHash = toolboxRequestHash({
    projectId,
    canvasId: canvasId || null,
    nodeId: nodeId || null,
    type,
    title,
    prompt,
    modelKey,
    inputMode,
    count,
    processType: canvasProcessType,
    maskMaterialId: imageEdit ? maskMaterialId : null,
    referenceMaterialIds: materialIds,
    referenceMaterials,
    assetCategory,
    options,
  })
  if (idempotencyKey) {
    const firstStableAssetId = stableToolboxAssetId({
      userId: session.user.id,
      projectId,
      canvasId,
      nodeId,
      type,
      idempotencyKey,
      index: 0,
    })
    const existing = await prisma.frameosToolboxAsset.findUnique({ where: { id: firstStableAssetId } })
    if (existing) assertMatchingToolboxRequestHash(existing, requestHash)
  }
  const preparedCanvasOutputs = canvasId && type === 'image' && count > 1
    ? await prepareCanvasToolboxImageOutputs({
      userId: session.user.id,
      actorUserId: session.user.actorId || session.user.id,
      projectId,
      canvasId,
      sourceNodeId: nodeId,
      idempotencyKey,
      expectedRevision: Number(body.expectedRevision),
      clientId: cleanText(body.clientId),
      count,
      title,
      prompt,
    })
    : null
  const outputNodeIds = preparedCanvasOutputs?.nodeIds || Array.from({ length: count }, () => nodeId)
  if (idempotencyKey && count > 1) {
    for (let index = 1; index < count; index += 1) {
      const stableAssetId = stableToolboxAssetId({
        userId: session.user.id,
        projectId,
        canvasId,
        nodeId: canvasId ? outputNodeIds[index] : '',
        type,
        idempotencyKey,
        index,
      })
      const existing = await prisma.frameosToolboxAsset.findUnique({ where: { id: stableAssetId } })
      if (existing) assertMatchingToolboxRequestHash(existing, requestHash)
    }
  }
  const locale = resolveRequiredTaskLocale(request, body)
  const materialSource = (material: typeof orderedMaterials[number]) => material.storageKey || material.resultUrl || ''
  const imageReferences = referenceImages.map(materialSource).filter(Boolean)
  const videoReferences = referenceVideos.map(materialSource).filter(Boolean)
  const audioReferences = referenceAudios.map(materialSource).filter(Boolean)
  const referenceNames = orderedMaterials.map((material) => material.title?.trim() || '未命名素材')
  const referenceImageNames = referenceImages.map((material) => material.title?.trim() || '未命名素材')
  const referenceVideoNames = referenceVideos.map((material) => material.title?.trim() || '未命名素材')
  const referenceAudioNames = referenceAudios.map((material) => material.title?.trim() || '未命名素材')
  const referenceImageRoles = referenceImages.map((material) => referenceRoleByMaterialId.get(material.id) || 'REF')
  const maskImage = maskMaterial ? maskMaterial.storageKey || maskMaterial.resultUrl || '' : ''
  if (imageEdit && !maskImage) {
    throw new ApiError('INVALID_PARAMS', { message: '蒙版素材没有可用的图片内容。' })
  }
  const tasks: Array<{ taskId: string; assetId: string; nodeId?: string }> = []
  const failures: Array<{ index: number; nodeId?: string; assetId: string; message: string }> = []

  for (let index = 0; index < count; index += 1) {
    const assetTitle = count > 1 ? `${title} · ${index + 1}` : title
    const outputNodeId = canvasId ? outputNodeIds[index] : ''
    const stableAssetId = idempotencyKey
      ? stableToolboxAssetId({ userId: session.user.id, projectId, canvasId, nodeId: outputNodeId, type, idempotencyKey, index })
      : null
    let assetId = stableAssetId || ''
    let taskId = ''
    let submissionAttempted = false
    try {
      const assetData = {
        userId: session.user.id,
        projectId,
        type,
        source: 'toolbox',
        bizType: type === 'image' ? 'image_generation' : 'video_generation',
        modelId: modelKey,
        status: 'pending',
        params: {
          ...options,
          title: assetTitle,
          prompt,
          inputMode,
          ...(canvasProcessType ? { processType: canvasProcessType } : {}),
          ...(imageEdit ? { maskMaterialId } : {}),
          referenceMaterialIds: materialIds,
          referenceMaterials,
          referenceSummary,
          assetCategory,
          canvasId: canvasId || null,
          nodeId: outputNodeId || null,
          idempotencyKey: idempotencyKey || null,
          requestHash,
        },
      }
      const asset = stableAssetId
        ? await prisma.frameosToolboxAsset.upsert({
          where: { id: stableAssetId },
          create: {
            id: stableAssetId,
            ...assetData,
          },
          update: {},
        })
        : await prisma.frameosToolboxAsset.create({
          data: assetData,
        })
      assetId = asset.id
      if (stableAssetId) assertMatchingToolboxRequestHash(asset, requestHash)
      const taskType = type === 'image' ? TASK_TYPE.TOOLBOX_IMAGE : TASK_TYPE.TOOLBOX_VIDEO
      const readyTaskId = stableAssetId
        ? await reusableReadyToolboxTaskId(asset, {
            userId: session.user.id,
            projectId,
            type: taskType,
          })
        : null
      if (readyTaskId) {
        if (canvasId) {
          const bound = await bindCanvasToolboxTaskToNode({
            projectId,
            canvasId,
            nodeId: outputNodeId,
            assetId: asset.id,
            taskId: readyTaskId,
            type,
            title: assetTitle,
            prompt,
            modelKey,
            inputMode,
            options,
            referenceSummary,
            processType: canvasProcessType,
          })
          if (!bound) throw new ApiError('NOT_FOUND', { message: '目标画布节点不存在或已被删除。' })
          await projectLatestBoundToolboxAsset({
            projectId, canvasId, nodeId: outputNodeId, assetId: asset.id, taskId: readyTaskId, type,
          })
        }
        tasks.push({ taskId: readyTaskId, assetId: asset.id, ...(canvasId ? { nodeId: outputNodeId } : {}) })
        continue
      }
      await reviveFailedToolboxAsset(asset)
      const generationOptions = {
        ...options,
        ...(type === 'video' ? { generationMode: inputMode === 'firstlastframe' ? 'firstlastframe' : 'normal' } : {}),
      }
      const payload = {
        ...options,
        generationOptions,
        title: assetTitle,
        ownerName: session.user.name || null,
        prompt,
        inputMode,
        ...(canvasProcessType ? { processType: canvasProcessType } : {}),
        ...(imageEdit ? {
          editMode: CANVAS_IMAGE_EDIT_MODE,
          maskImage,
          maskMaterialId,
        } : {}),
        referenceImages: imageReferences,
        referenceVideos: videoReferences,
        ...(referenceVideos.length > 0 ? { inputVideoSeconds } : {}),
        referenceAudios: audioReferences,
        referenceNames,
        referenceImageNames,
        referenceVideoNames,
        referenceAudioNames,
        referenceMaterialIds: materialIds,
        referenceMaterials,
        referenceImageRoles,
        referenceSummary,
        assetCategory,
        canvasId: canvasId || null,
        nodeId: outputNodeId || null,
        ...(type === 'image' ? { imageModel: modelKey } : { videoModel: modelKey }),
        modelId: modelKey,
        count: 1,
      }
      submissionAttempted = true
      const submitted = await submitTask({
        userId: session.user.id,
        locale,
        requestId: getRequestId(request),
        projectId,
        type: taskType,
        targetType: 'FrameosToolboxAsset',
        targetId: asset.id,
        payload,
        dedupeKey: `${taskType}:${asset.id}`,
      })
      submissionAttempted = false
      taskId = submitted.taskId
      if (canvasId) {
        const bound = await bindCanvasToolboxTaskToNode({
          projectId,
          canvasId,
          nodeId: outputNodeId,
          assetId: asset.id,
          taskId,
          type,
          title: assetTitle,
          prompt,
          modelKey,
          inputMode,
          options,
          referenceSummary,
          processType: canvasProcessType,
        })
        if (!bound) {
          throw new ApiError('NOT_FOUND', { message: '目标画布节点不存在或已被删除，生成任务已取消。' })
        }
        // Binding is durable. This read only closes the rare completion-before-
        // binding race; a transient projection read must not discard a valid task.
        await projectLatestBoundToolboxAsset({
          projectId, canvasId, nodeId: outputNodeId, assetId: asset.id, taskId, type, projectFailure: true,
        }).catch(() => undefined)
      }
      tasks.push({ taskId, assetId: asset.id, ...(canvasId ? { nodeId: outputNodeId } : {}) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (taskId) {
        await cancelTask(taskId, 'Canvas node disappeared before generation binding', { projectId }).catch(() => undefined)
      }
      let compensated = false
      if ((submissionAttempted || taskId) && assetId) {
        compensated = await compensateToolboxSubmissionFailure(assetId, error)
      }
      if (canvasId && assetId && compensated) {
        await projectCanvasToolboxSubmissionFailure({
          projectId,
          canvasId,
          nodeId: outputNodeId,
          assetId,
          type,
          title: assetTitle,
          prompt,
          modelKey,
          inputMode,
          options,
          referenceSummary,
          errorMessage: message,
        }).catch(() => undefined)
      }
      if (count > 1) {
        failures.push({ index, ...(canvasId ? { nodeId: outputNodeId } : {}), assetId, message })
        continue
      }
      throw error
    }
  }

  return NextResponse.json({
    success: failures.length === 0,
    partial: failures.length > 0 && tasks.length > 0,
    tasks,
    ...(failures.length > 0 ? { failures } : {}),
    ...(preparedCanvasOutputs ? { canvasRevision: preparedCanvasOutputs.canvasRevision } : {}),
  })
})
