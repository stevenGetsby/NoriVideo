export type StudioVector3 = [number, number, number]

export type StudioObjectKind =
  | 'model'
  | 'mannequin'
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'torus'
  | 'cone'
  | 'pyramid'

export type StudioMannequinVariant =
  | 'male'
  | 'female'
  | 'broad'
  | 'athletic'
  | 'slim'
  | 'teen'
  | 'child'
  | 'chibi'

export type StudioPoseJointId =
  | 'body'
  | 'torso'
  | 'head'
  | 'leftArm'
  | 'rightArm'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftKnee'
  | 'rightKnee'

export type StudioPoseAdjustments = Partial<Record<StudioPoseJointId, StudioVector3>>

export type StudioRigCompatibility = 'complete' | 'partial' | 'none'

export type StudioRigReport = {
  compatibility: StudioRigCompatibility
  boneCount: number
  skinnedMeshCount: number
  joints: Partial<Record<StudioPoseJointId, string>>
  mappedJointCount: number
  poseCapable: boolean
}

export type CanvasStudioObject = {
  id: string
  name: string
  kind: StudioObjectKind
  modelUrl?: string | null
  materialId?: string | null
  position: StudioVector3
  rotation: StudioVector3
  scale: StudioVector3
  color: string
  opacity: number
  visible: boolean
  locked: boolean
  mannequinVariant?: StudioMannequinVariant
  posePreset?: string
  poseAdjustments?: StudioPoseAdjustments
  crowdId?: string | null
  snapSurface?: boolean
}

export type CanvasStudioCamera = {
  id: string
  name: string
  position: StudioVector3
  target: StudioVector3
  rotation?: StudioVector3
  orientationMode?: 'target' | 'rotation'
  fov: number
  aspectRatio?: string
  roll?: number
  lookAtObjectId?: string | null
  followObjectId?: string | null
  followOffset?: StudioVector3 | null
  visible?: boolean
  locked?: boolean
}

export type CanvasStudioDirectorCamera = {
  position: StudioVector3
  target: StudioVector3
  fov: number
  roll: number
}

export type CanvasStudioCapture = {
  id: string
  title: string
  url: string
  materialId: string
  cameraId: string | null
  cameraName: string
  aspectRatio: string
  width: number
  height: number
  createdAt: string
  sentAt: string | null
}

export type CanvasStudioCaptureDraft = {
  file: File
  cameraId: string | null
  cameraName: string
  aspectRatio: string
  width: number
  height: number
}

export type CanvasStudioCaptureStageResult = {
  captures: CanvasStudioCapture[]
  failed: number
}

export type CanvasStudioCaptureSendResult = {
  sentIds: string[]
  created: number
  failed: number
}

export type CanvasStudioScene = {
  version: 1 | 2 | 3
  backgroundColor: string
  panoramaUrl: string | null
  panoramaMaterialId: string | null
  panoramaRotation: number
  panoramaRadius: number
  scenePosition: StudioVector3
  sceneRotation: StudioVector3
  sceneScale: StudioVector3
  directorCamera: CanvasStudioDirectorCamera
  showGround: boolean
  showGrid: boolean
  snapToGrid: boolean
  showLabels: boolean
  groundOpacity: number
  groundHeight: number
  screenshotAspectRatio: string
  objects: CanvasStudioObject[]
  cameras: CanvasStudioCamera[]
  captures: CanvasStudioCapture[]
}

export type CanvasStudioSummary = {
  version: 1
  objectCount: number
  cameraCount: number
  captureCount: number
  hasPanorama: boolean
}

export const DEFAULT_STUDIO_SCENE: CanvasStudioScene = {
  version: 3,
  backgroundColor: '#111827',
  panoramaUrl: null,
  panoramaMaterialId: null,
  panoramaRotation: 0,
  panoramaRadius: 80,
  scenePosition: [0, 0, 0],
  sceneRotation: [0, 0, 0],
  sceneScale: [1, 1, 1],
  directorCamera: { position: [7, 5, 9], target: [0, 1, 0], fov: 48, roll: 0 },
  showGround: true,
  showGrid: true,
  snapToGrid: false,
  showLabels: true,
  groundOpacity: 0.4,
  groundHeight: 0,
  screenshotAspectRatio: 'auto',
  objects: [],
  cameras: [],
  captures: [],
}

function finite(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function vector(value: unknown, fallback: StudioVector3): StudioVector3 {
  if (!Array.isArray(value) || value.length < 3) return [...fallback]
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])]
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function studioCameraRotationFromTarget(position: StudioVector3, target: StudioVector3, roll = 0): StudioVector3 {
  const x = target[0] - position[0]
  const y = target[1] - position[1]
  const z = target[2] - position[2]
  const horizontal = Math.max(0.000_001, Math.hypot(x, z))
  return [Math.atan2(y, horizontal), Math.atan2(-x, -z), roll * Math.PI / 180]
}

export function studioCameraTargetFromRotation(position: StudioVector3, rotation: StudioVector3, distance = 5): StudioVector3 {
  const safeDistance = Math.max(0.1, Math.min(10_000, finite(distance, 5)))
  const horizontal = Math.cos(rotation[0]) * safeDistance
  return [
    position[0] - Math.sin(rotation[1]) * horizontal,
    position[1] + Math.sin(rotation[0]) * safeDistance,
    position[2] - Math.cos(rotation[1]) * horizontal,
  ]
}

export function normalizeCanvasStudioScene(value: unknown): CanvasStudioScene {
  const source = record(value)
  if (!source) return structuredClone(DEFAULT_STUDIO_SCENE)
  const objectSource = Array.isArray(source.objects) ? source.objects : []
  const cameraSource = Array.isArray(source.cameras) ? source.cameras : []
  const captureSource = Array.isArray(source.captures) ? source.captures : []
  const objects = objectSource.slice(0, 200).map((item, index): CanvasStudioObject | null => {
    const data = record(item)
    if (!data) return null
    const rawKind = text(data.kind, 'model')
    const kind: StudioObjectKind = rawKind === 'mannequin'
      || rawKind === 'box'
      || rawKind === 'sphere'
      || rawKind === 'cylinder'
      || rawKind === 'torus'
      || rawKind === 'cone'
      || rawKind === 'pyramid'
      ? rawKind
      : 'model'
    const modelUrl = text(data.modelUrl) || null
    if (kind === 'model' && !modelUrl) return null
    const rawVariant = text(data.mannequinVariant, 'male')
    const mannequinVariant: StudioMannequinVariant = rawVariant === 'female'
      || rawVariant === 'broad'
      || rawVariant === 'athletic'
      || rawVariant === 'slim'
      || rawVariant === 'teen'
      || rawVariant === 'child'
      || rawVariant === 'chibi'
      ? rawVariant
      : 'male'
    const poseSource = record(data.poseAdjustments)
    const poseAdjustments = poseSource
      ? Object.fromEntries(Object.entries(poseSource).map(([jointId, jointValue]) => [jointId, vector(jointValue, [0, 0, 0])])) as StudioPoseAdjustments
      : undefined
    return {
      id: text(data.id, `studio-object-${index + 1}`),
      name: text(data.name, kind === 'model' ? `3D 模型 ${index + 1}` : `几何体 ${index + 1}`),
      kind,
      modelUrl,
      materialId: text(data.materialId) || null,
      position: vector(data.position, [index * 0.8, 0, 0]),
      rotation: vector(data.rotation, [0, 0, 0]),
      scale: vector(data.scale, [1, 1, 1]).map((item) => Math.max(0.01, Math.min(100, item))) as StudioVector3,
      color: text(data.color, '#94a3b8'),
      opacity: Math.max(0.05, Math.min(1, finite(data.opacity, 1))),
      visible: data.visible !== false,
      locked: data.locked === true,
      ...(kind === 'mannequin' || kind === 'model' ? {
        posePreset: text(data.posePreset, 'stand'),
        poseAdjustments,
      } : {}),
      ...(kind === 'mannequin' ? {
        mannequinVariant,
        crowdId: text(data.crowdId) || null,
      } : {}),
      ...(kind === 'model' ? { snapSurface: data.snapSurface === true } : {}),
    }
  }).filter((item): item is CanvasStudioObject => Boolean(item))
  const cameras = cameraSource.slice(0, 40).map((item, index): CanvasStudioCamera | null => {
    const data = record(item)
    if (!data) return null
    const position = vector(data.position, [0, 2, 6])
    const target = vector(data.target, [0, 1, 0])
    const orientationMode = data.orientationMode === 'rotation' ? 'rotation' : 'target'
    const rotation = vector(data.rotation, studioCameraRotationFromTarget(position, target, 0))
    const hasExplicitRoll = data.roll != null && Number.isFinite(Number(data.roll))
    const roll = Math.max(-180, Math.min(180, hasExplicitRoll
      ? Number(data.roll)
      : orientationMode === 'rotation' ? rotation[2] * 180 / Math.PI : 0))
    if (orientationMode === 'rotation') rotation[2] = roll * Math.PI / 180
    return {
      id: text(data.id, `studio-camera-${index + 1}`),
      name: text(data.name, `机位 ${index + 1}`),
      position,
      target,
      rotation,
      orientationMode,
      fov: Math.max(12, Math.min(120, finite(data.fov, 45))),
      aspectRatio: text(data.aspectRatio, 'auto'),
      roll,
      lookAtObjectId: text(data.lookAtObjectId) || null,
      followObjectId: text(data.followObjectId) || null,
      followOffset: data.followOffset == null ? null : vector(data.followOffset, [0, 0, 0]),
      visible: data.visible !== false,
      locked: data.locked === true,
    }
  }).filter((item): item is CanvasStudioCamera => Boolean(item))
  const captures = captureSource.slice(0, 200).map((item, index): CanvasStudioCapture | null => {
    const data = record(item)
    if (!data) return null
    const url = text(data.url)
    const materialId = text(data.materialId)
    if (!url || !materialId) return null
    return {
      id: text(data.id, `studio-capture-${index + 1}`),
      title: text(data.title, `机位截图 ${index + 1}`),
      url,
      materialId,
      cameraId: text(data.cameraId) || null,
      cameraName: text(data.cameraName, '导演视角'),
      aspectRatio: text(data.aspectRatio, 'auto'),
      width: Math.max(1, Math.min(8_192, Math.round(finite(data.width, 1_600)))),
      height: Math.max(1, Math.min(8_192, Math.round(finite(data.height, 900)))),
      createdAt: text(data.createdAt, new Date(0).toISOString()),
      sentAt: text(data.sentAt) || null,
    }
  }).filter((item): item is CanvasStudioCapture => Boolean(item))
  const directorSource = record(source.directorCamera)
  return {
    version: 3,
    backgroundColor: text(source.backgroundColor, DEFAULT_STUDIO_SCENE.backgroundColor),
    panoramaUrl: text(source.panoramaUrl) || null,
    panoramaMaterialId: text(source.panoramaMaterialId) || null,
    panoramaRotation: finite(source.panoramaRotation, 0),
    panoramaRadius: Math.max(10, Math.min(400, finite(source.panoramaRadius, DEFAULT_STUDIO_SCENE.panoramaRadius))),
    scenePosition: vector(source.scenePosition, DEFAULT_STUDIO_SCENE.scenePosition),
    sceneRotation: vector(source.sceneRotation, DEFAULT_STUDIO_SCENE.sceneRotation),
    sceneScale: vector(source.sceneScale, DEFAULT_STUDIO_SCENE.sceneScale).map((item) => Math.max(0.05, Math.min(100, item))) as StudioVector3,
    directorCamera: {
      position: vector(directorSource?.position, DEFAULT_STUDIO_SCENE.directorCamera.position),
      target: vector(directorSource?.target, DEFAULT_STUDIO_SCENE.directorCamera.target),
      fov: Math.max(12, Math.min(120, finite(directorSource?.fov, DEFAULT_STUDIO_SCENE.directorCamera.fov))),
      roll: Math.max(-180, Math.min(180, finite(directorSource?.roll, DEFAULT_STUDIO_SCENE.directorCamera.roll))),
    },
    showGround: source.showGround !== false,
    showGrid: source.showGrid !== false,
    snapToGrid: source.snapToGrid === true,
    showLabels: source.showLabels !== false,
    groundOpacity: Math.max(0, Math.min(1, finite(source.groundOpacity, DEFAULT_STUDIO_SCENE.groundOpacity))),
    groundHeight: Math.max(-10, Math.min(10, finite(source.groundHeight, DEFAULT_STUDIO_SCENE.groundHeight))),
    screenshotAspectRatio: text(source.screenshotAspectRatio, 'auto'),
    objects,
    cameras,
    captures,
  }
}

export function summarizeCanvasStudioScene(value: unknown): CanvasStudioSummary {
  const scene = normalizeCanvasStudioScene(value)
  return {
    version: 1,
    objectCount: scene.objects.length,
    cameraCount: scene.cameras.length,
    captureCount: scene.captures.length,
    hasPanorama: Boolean(scene.panoramaUrl),
  }
}

export function normalizeCanvasStudioSummary(value: unknown, legacyScene?: unknown): CanvasStudioSummary {
  const source = record(value)
  if (!source || source.version !== 1) return summarizeCanvasStudioScene(legacyScene)
  const count = (input: unknown) => Math.max(0, Math.min(10_000, Math.round(finite(input, 0))))
  return {
    version: 1,
    objectCount: count(source.objectCount),
    cameraCount: count(source.cameraCount),
    captureCount: count(source.captureCount),
    hasPanorama: source.hasPanorama === true,
  }
}

const STUDIO_RIG_BONE_ALIASES: Record<StudioPoseJointId, string[]> = {
  body: ['hips', 'pelvis', 'rootbone', 'root'],
  torso: ['upperchest', 'chest', 'spine2', 'spine1', 'spine'],
  head: ['head'],
  leftArm: ['leftupperarm', 'upperarml', 'lupperarm', 'leftarm', 'armleft'],
  rightArm: ['rightupperarm', 'upperarmr', 'rupperarm', 'rightarm', 'armright'],
  leftElbow: ['leftforearm', 'leftlowerarm', 'forearml', 'lowerarml', 'lforearm', 'leftelbow'],
  rightElbow: ['rightforearm', 'rightlowerarm', 'forearmr', 'lowerarmr', 'rforearm', 'rightelbow'],
  leftLeg: ['leftupleg', 'leftupperleg', 'upperlegl', 'lupperleg', 'thighl', 'leftthigh'],
  rightLeg: ['rightupleg', 'rightupperleg', 'upperlegr', 'rupperleg', 'thighr', 'rightthigh'],
  leftKnee: ['leftleg', 'leftlowerleg', 'lowerlegl', 'llowerleg', 'shinl', 'calfl', 'leftcalf', 'leftknee'],
  rightKnee: ['rightleg', 'rightlowerleg', 'lowerlegr', 'rlowerleg', 'shinr', 'calfr', 'rightcalf', 'rightknee'],
}

const COMPLETE_STUDIO_RIG_JOINTS: StudioPoseJointId[] = [
  'body',
  'torso',
  'head',
  'leftArm',
  'rightArm',
  'leftElbow',
  'rightElbow',
  'leftLeg',
  'rightLeg',
  'leftKnee',
  'rightKnee',
]

function normalizeStudioBoneName(value: string) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '')
}

function studioBoneMatchScore(name: string, alias: string) {
  if (name === alias) return 4
  if (name.endsWith(alias)) return 3
  if (name.startsWith(alias)) return 2
  return name.includes(alias) ? 1 : 0
}

/**
 * Builds a conservative humanoid mapping from actual bones referenced by a
 * SkinnedMesh. `poseCapable` requires a centre, head, arm and leg chain so the
 * UI never presents a fake pose editor for an unusable model.
 */
export function analyzeStudioRigBoneNames(boneNames: string[], skinnedMeshCount: number): StudioRigReport {
  const normalized = boneNames.map((name) => ({ name, normalized: normalizeStudioBoneName(name) }))
  const joints: Partial<Record<StudioPoseJointId, string>> = {}
  const used = new Set<number>()
  if (skinnedMeshCount > 0) {
    for (const jointId of COMPLETE_STUDIO_RIG_JOINTS) {
      let bestIndex = -1
      let bestScore = 0
      for (let index = 0; index < normalized.length; index += 1) {
        if (used.has(index)) continue
        const score = Math.max(...STUDIO_RIG_BONE_ALIASES[jointId].map((alias) => studioBoneMatchScore(normalized[index].normalized, alias)))
        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      }
      if (bestIndex < 0 || bestScore === 0) continue
      used.add(bestIndex)
      joints[jointId] = normalized[bestIndex].name
    }
  }
  const mappedJointCount = Object.keys(joints).length
  const hasCentre = Boolean(joints.body || joints.torso)
  const hasArm = Boolean(joints.leftArm || joints.rightArm)
  const hasLeg = Boolean(joints.leftLeg || joints.rightLeg)
  const poseCapable = mappedJointCount >= 5 && hasCentre && Boolean(joints.head) && hasArm && hasLeg
  const compatibility: StudioRigCompatibility = skinnedMeshCount === 0 || boneNames.length === 0
    ? 'none'
    : COMPLETE_STUDIO_RIG_JOINTS.every((jointId) => Boolean(joints[jointId]))
      ? 'complete'
      : 'partial'
  return {
    compatibility,
    boneCount: boneNames.length,
    skinnedMeshCount: Math.max(0, Math.round(skinnedMeshCount)),
    joints,
    mappedJointCount,
    poseCapable,
  }
}

function sameStudioValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeStudioCollection<T extends { id: string }>(base: T[], local: T[], server: T[]): T[] {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const serverById = new Map(server.map((item) => [item.id, item]))
  const merged: T[] = []
  const added = new Set<string>()

  // Preserve the local ordering. Local additions/edits/deletions are replayed
  // over the latest server collection; unchanged entries adopt server edits.
  for (const localItem of local) {
    const baseItem = baseById.get(localItem.id)
    const serverItem = serverById.get(localItem.id)
    if (!baseItem) merged.push(structuredClone(localItem))
    else if (!sameStudioValue(localItem, baseItem)) merged.push(structuredClone(localItem))
    else if (serverItem) merged.push(structuredClone(serverItem))
    added.add(localItem.id)
  }

  // Keep concurrent server additions. A server item that existed in the base
  // but is missing locally was explicitly deleted by the local editor.
  for (const serverItem of server) {
    if (added.has(serverItem.id) || baseById.has(serverItem.id)) continue
    merged.push(structuredClone(serverItem))
  }
  return merged
}

/**
 * Three-way merge for optimistic-lock conflicts. Local changes since `base`
 * win, untouched fields adopt the latest server value, and concurrent server
 * additions are retained.
 */
export function mergeCanvasStudioScenes(
  baseValue: unknown,
  localValue: unknown,
  serverValue: unknown,
): CanvasStudioScene {
  const base = normalizeCanvasStudioScene(baseValue)
  const local = normalizeCanvasStudioScene(localValue)
  const server = normalizeCanvasStudioScene(serverValue)
  const merged = structuredClone(server)
  const scalarKeys: Array<Exclude<keyof CanvasStudioScene, 'version' | 'objects' | 'cameras' | 'captures'>> = [
    'backgroundColor',
    'panoramaUrl',
    'panoramaMaterialId',
    'panoramaRotation',
    'panoramaRadius',
    'scenePosition',
    'sceneRotation',
    'sceneScale',
    'directorCamera',
    'showGround',
    'showGrid',
    'snapToGrid',
    'showLabels',
    'groundOpacity',
    'groundHeight',
    'screenshotAspectRatio',
  ]
  for (const key of scalarKeys) {
    if (!sameStudioValue(local[key], base[key])) {
      // All values are normalized JSON data; the indexed assignment is safe.
      ;(merged as unknown as Record<string, unknown>)[key] = structuredClone(local[key])
    }
  }
  merged.objects = mergeStudioCollection(base.objects, local.objects, server.objects)
  merged.cameras = mergeStudioCollection(base.cameras, local.cameras, server.cameras)
  merged.captures = mergeStudioCollection(base.captures, local.captures, server.captures)
  return normalizeCanvasStudioScene(merged)
}
