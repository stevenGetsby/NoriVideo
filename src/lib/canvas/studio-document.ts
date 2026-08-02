import { z } from 'zod'
import {
  DEFAULT_STUDIO_SCENE,
  normalizeCanvasStudioScene,
  type CanvasStudioScene,
} from '@/features/canvas/studio-types'

export const MAX_STUDIO_DOCUMENT_BYTES = 2 * 1024 * 1024
export const MAX_STUDIO_OBJECTS = 200
export const MAX_STUDIO_CAMERAS = 40
export const MAX_STUDIO_CAPTURES = 200

const id = z.string().trim().min(1).max(191)
const title = z.string().trim().min(1).max(240)
const nullableId = id.nullable()
const boundedUrl = z.string().trim().min(1).max(8_192)
const nullableUrl = boundedUrl.nullable()
const finiteNumber = z.number().finite()
const coordinate = finiteNumber.min(-10_000).max(10_000)
const rotation = finiteNumber.min(-Math.PI * 20).max(Math.PI * 20)
const vector = z.tuple([coordinate, coordinate, coordinate])
const rotationVector = z.tuple([rotation, rotation, rotation])
const scaleVector = z.tuple([
  finiteNumber.min(0.01).max(100),
  finiteNumber.min(0.01).max(100),
  finiteNumber.min(0.01).max(100),
])
const color = z.string().regex(/^#[0-9a-f]{6}$/i)
const aspectRatio = z.enum(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
const poseVector = z.tuple([
  finiteNumber.min(-360).max(360),
  finiteNumber.min(-360).max(360),
  finiteNumber.min(-360).max(360),
])
const poseAdjustments = z.object({
  body: poseVector.optional(),
  torso: poseVector.optional(),
  head: poseVector.optional(),
  leftArm: poseVector.optional(),
  rightArm: poseVector.optional(),
  leftElbow: poseVector.optional(),
  rightElbow: poseVector.optional(),
  leftLeg: poseVector.optional(),
  rightLeg: poseVector.optional(),
  leftKnee: poseVector.optional(),
  rightKnee: poseVector.optional(),
}).strict()

const studioObject = z.object({
  id,
  name: title,
  kind: z.enum(['model', 'mannequin', 'box', 'sphere', 'cylinder', 'torus', 'cone', 'pyramid']),
  modelUrl: nullableUrl.optional(),
  materialId: nullableId.optional(),
  position: vector,
  rotation: rotationVector,
  scale: scaleVector,
  color,
  opacity: finiteNumber.min(0.05).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  mannequinVariant: z.enum(['male', 'female', 'broad', 'athletic', 'slim', 'teen', 'child', 'chibi']).optional(),
  posePreset: z.string().trim().min(1).max(64).optional(),
  poseAdjustments: poseAdjustments.optional(),
  crowdId: nullableId.optional(),
  snapSurface: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'model' && !value.modelUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '3D 模型对象必须引用模型文件', path: ['modelUrl'] })
  }
})

const studioCamera = z.object({
  id,
  name: title,
  position: vector,
  target: vector,
  rotation: rotationVector.optional(),
  orientationMode: z.enum(['target', 'rotation']).optional(),
  fov: finiteNumber.min(12).max(120),
  aspectRatio: aspectRatio.optional(),
  roll: finiteNumber.min(-180).max(180).optional(),
  lookAtObjectId: nullableId.optional(),
  followObjectId: nullableId.optional(),
  followOffset: vector.nullable().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
}).strict()

const studioCapture = z.object({
  id,
  title,
  url: boundedUrl,
  materialId: id,
  cameraId: nullableId,
  cameraName: title,
  aspectRatio,
  width: z.number().int().min(1).max(8_192),
  height: z.number().int().min(1).max(8_192),
  createdAt: z.string().trim().min(1).max(64),
  sentAt: z.string().trim().min(1).max(64).nullable(),
}).strict()

const studioSceneSchema = z.object({
  version: z.literal(3),
  backgroundColor: color,
  panoramaUrl: nullableUrl,
  panoramaMaterialId: nullableId,
  panoramaRotation: rotation,
  panoramaRadius: finiteNumber.min(10).max(400),
  scenePosition: vector,
  sceneRotation: rotationVector,
  sceneScale: scaleVector,
  directorCamera: z.object({
    position: vector,
    target: vector,
    fov: finiteNumber.min(12).max(120),
    roll: finiteNumber.min(-180).max(180),
  }).strict(),
  showGround: z.boolean(),
  showGrid: z.boolean(),
  snapToGrid: z.boolean(),
  showLabels: z.boolean(),
  groundOpacity: finiteNumber.min(0).max(1),
  groundHeight: finiteNumber.min(-10).max(10),
  screenshotAspectRatio: aspectRatio,
  objects: z.array(studioObject).max(MAX_STUDIO_OBJECTS),
  cameras: z.array(studioCamera).max(MAX_STUDIO_CAMERAS),
  captures: z.array(studioCapture).max(MAX_STUDIO_CAPTURES),
}).strict().superRefine((scene, context) => {
  const ensureUnique = (values: Array<{ id: string }>, path: 'objects' | 'cameras' | 'captures') => {
    const seen = new Set<string>()
    values.forEach((value, index) => {
      if (seen.has(value.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: '文档内 ID 不可重复', path: [path, index, 'id'] })
      seen.add(value.id)
    })
  }
  ensureUnique(scene.objects, 'objects')
  ensureUnique(scene.cameras, 'cameras')
  ensureUnique(scene.captures, 'captures')

  const objectIds = new Set(scene.objects.map((object) => object.id))
  scene.cameras.forEach((camera, index) => {
    if (camera.lookAtObjectId && !objectIds.has(camera.lookAtObjectId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '机位注视对象不存在', path: ['cameras', index, 'lookAtObjectId'] })
    }
    if (camera.followObjectId && !objectIds.has(camera.followObjectId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '机位跟随对象不存在', path: ['cameras', index, 'followObjectId'] })
    }
  })
})

const studioSaveInputSchema = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  document: z.unknown(),
  clientId: z.string().trim().min(1).max(120).optional(),
}).strict()

export type StudioDocumentSaveInput = {
  expectedRevision: number
  document: CanvasStudioScene
  clientId: string | null
}

export type StudioDocumentValidationError = {
  code: 'STUDIO_DOCUMENT_INVALID' | 'STUDIO_DOCUMENT_TOO_LARGE'
  message: string
  actualBytes?: number
  maxBytes?: number
}

export type StudioDocumentValidationResult =
  | { success: true; data: StudioDocumentSaveInput }
  | { success: false; error: StudioDocumentValidationError }

function serializedByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : null
  } catch {
    return null
  }
}

export function validateStudioDocumentSaveInput(value: unknown): StudioDocumentValidationResult {
  const parsedInput = studioSaveInputSchema.safeParse(value)
  if (!parsedInput.success) {
    return { success: false, error: { code: 'STUDIO_DOCUMENT_INVALID', message: '3D 导演台保存参数格式无效。' } }
  }

  const actualBytes = serializedByteLength(parsedInput.data.document)
  if (actualBytes === null) {
    return { success: false, error: { code: 'STUDIO_DOCUMENT_INVALID', message: '3D 导演台文档无法序列化。' } }
  }
  if (actualBytes > MAX_STUDIO_DOCUMENT_BYTES) {
    return {
      success: false,
      error: {
        code: 'STUDIO_DOCUMENT_TOO_LARGE',
        message: `3D 导演台文档超过 ${MAX_STUDIO_DOCUMENT_BYTES / 1024 / 1024} MiB 限制，请移除不再使用的模型或截图记录。`,
        actualBytes,
        maxBytes: MAX_STUDIO_DOCUMENT_BYTES,
      },
    }
  }

  const parsedDocument = studioSceneSchema.safeParse(parsedInput.data.document)
  if (!parsedDocument.success) {
    const issue = parsedDocument.error.issues[0]
    const location = issue?.path.length ? `（${issue.path.join('.')}）` : ''
    return {
      success: false,
      error: {
        code: 'STUDIO_DOCUMENT_INVALID',
        message: `3D 导演台文档格式无效${location}${issue?.message ? `：${issue.message}` : '。'}`,
      },
    }
  }

  return {
    success: true,
    data: {
      expectedRevision: parsedInput.data.expectedRevision,
      document: parsedDocument.data as CanvasStudioScene,
      clientId: parsedInput.data.clientId || null,
    },
  }
}

/**
 * Existing node.data.studioScene documents pre-date the strict schema. They are
 * normalized once when used as a lazy migration seed, then all future writes
 * must pass the strict validator above.
 */
export function normalizeStudioDocumentSeed(value: unknown): CanvasStudioScene {
  const normalized = normalizeCanvasStudioScene(value)
  const parsed = studioSceneSchema.safeParse(normalized)
  if (parsed.success) return parsed.data as CanvasStudioScene
  return structuredClone(DEFAULT_STUDIO_SCENE)
}
