'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import Box from 'lucide-react/dist/esm/icons/box.js'
import Camera from 'lucide-react/dist/esm/icons/camera.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import CircleHelp from 'lucide-react/dist/esm/icons/circle-help.js'
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot.js'
import Sphere from 'lucide-react/dist/esm/icons/circle.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Cylinder from 'lucide-react/dist/esm/icons/cylinder.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import ImageIcon from 'lucide-react/dist/esm/icons/image.js'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.js'
import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2.js'
import Move3D from 'lucide-react/dist/esm/icons/move-3d.js'
import Rotate3D from 'lucide-react/dist/esm/icons/rotate-3d.js'
import Scale3D from 'lucide-react/dist/esm/icons/scale-3d.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Shapes from 'lucide-react/dist/esm/icons/shapes.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Triangle from 'lucide-react/dist/esm/icons/triangle.js'
import Unlock from 'lucide-react/dist/esm/icons/unlock.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import UserRound from 'lucide-react/dist/esm/icons/user-round.js'
import UsersRound from 'lucide-react/dist/esm/icons/users-round.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { CanvasFlowNode } from '../editor-types'
import { useStudioDocument } from '../state/useStudioDocument'
import { createStudioMannequin, studioMannequinVisualHeight } from '../studio-mannequin'
import { moveStudioDirectorView, moveStudioPositionRelativeToView, type StudioDirectorView, type StudioNavigationKey } from '../studio-navigation'
import {
  analyzeStudioRigBoneNames,
  DEFAULT_STUDIO_SCENE,
  normalizeCanvasStudioScene,
  studioCameraRotationFromTarget,
  studioCameraTargetFromRotation,
  summarizeCanvasStudioScene,
  type CanvasStudioCamera,
  type CanvasStudioCapture,
  type CanvasStudioCaptureDraft,
  type CanvasStudioCaptureSendResult,
  type CanvasStudioCaptureStageResult,
  type CanvasStudioObject,
  type CanvasStudioScene,
  type CanvasStudioSummary,
  type StudioMannequinVariant,
  type StudioObjectKind,
  type StudioPoseAdjustments,
  type StudioPoseJointId,
  type StudioRigReport,
  type StudioVector3,
} from '../studio-types'
import { CanvasStudioCapturePanel } from './CanvasStudioCapturePanel'

type TransformMode = 'translate' | 'rotate' | 'scale'
type PickerType = 'model3d' | 'image' | null
type StudioDockMenu = 'add' | 'panorama' | 'camera' | 'ratio' | null
type StudioAddFlyout = 'crowd' | 'geometry' | null

type StudioContextMenu = {
  kind: 'object' | 'crowd' | 'camera'
  id: string
  x: number
  y: number
}

type StudioRigState = StudioRigReport | 'loading' | 'error'

type StudioRuntimeRig = {
  report: StudioRigReport
  bones: Partial<Record<StudioPoseJointId, import('three').Bone>>
  baseRotations: Partial<Record<StudioPoseJointId, StudioVector3>>
}

type StudioPoseHelper = {
  root: import('three').Group
  line: import('three').LineSegments
  points: Map<StudioPoseJointId, import('three').Mesh>
}

type StudioRuntime = {
  THREE: typeof import('three')
  camera: import('three').PerspectiveCamera
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls
  transform: import('three/examples/jsm/controls/TransformControls.js').TransformControls
  renderer: import('three').WebGLRenderer
  scene: import('three').Scene
  world: import('three').Group
  container: HTMLDivElement
  loader: import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader
  groups: Map<string, import('three').Group>
  cameraGroups: Map<string, import('three').Group>
  rigs: Map<string, StudioRuntimeRig>
  poseHelper: StudioPoseHelper
  grid: import('three').GridHelper
  ground: import('three').Mesh
  panorama: import('three').Mesh | null
}

type StudioPreviewRuntime = {
  renderer: import('three').WebGLRenderer
  camera: import('three').PerspectiveCamera
  cameraId: string
  container: HTMLDivElement
}

const CAMERA_PRESETS: Array<Omit<CanvasStudioCamera, 'id'>> = [
  { name: '正面中景', position: [0, 1.8, 5.5], target: [0, 1.1, 0], fov: 45 },
  { name: '正面特写', position: [0, 1.7, 3.2], target: [0, 1.35, 0], fov: 35 },
  { name: '正面全景', position: [0, 3.2, 10], target: [0, 1, 0], fov: 54 },
  { name: '侧面跟拍', position: [6, 1.8, 1.5], target: [0, 1.1, 0], fov: 45 },
  { name: '侧面近景', position: [4.2, 1.65, 1.1], target: [0, 1.25, 0], fov: 36 },
  { name: '45° 俯拍', position: [5, 7, 6], target: [0, 0.7, 0], fov: 48 },
  { name: '低角度仰拍', position: [3.8, 0.45, 5], target: [0, 1.7, 0], fov: 42 },
  { name: '低角度广角', position: [4.8, 0.35, 6.4], target: [0, 1.45, 0], fov: 68 },
  { name: '过肩镜头', position: [-2.2, 1.75, 3.3], target: [0.7, 1.35, 0], fov: 42 },
  { name: '过肩镜头(右)', position: [2.2, 1.75, 3.3], target: [-0.7, 1.35, 0], fov: 42 },
  { name: '鸟瞰', position: [0.01, 11, 0.01], target: [0, 0, 0], fov: 50 },
  { name: '荷兰角', position: [4, 2.5, 5], target: [0, 1, 0], fov: 45, roll: -18 },
]

const MANNEQUIN_VARIANTS: Array<{ value: StudioMannequinVariant; label: string; color: string }> = [
  { value: 'male', label: '男性素体', color: '#4f8ef7' },
  { value: 'female', label: '女性素体', color: '#d56faf' },
  { value: 'broad', label: '宽厚素体', color: '#7c83d9' },
  { value: 'athletic', label: '健壮素体', color: '#31a88b' },
  { value: 'slim', label: '纤细素体', color: '#8e76d8' },
  { value: 'teen', label: '少年素体', color: '#48a5d9' },
  { value: 'child', label: '儿童素体', color: '#e69a4c' },
  { value: 'chibi', label: '二头身', color: '#e66d78' },
]

const POSE_PRESETS: Array<{ value: string; label: string; pose: StudioPoseAdjustments }> = [
  { value: 'stand', label: '站立', pose: {} },
  { value: 'tpose', label: 'T型', pose: { leftArm: [0, 0, 90], rightArm: [0, 0, -90] } },
  { value: 'walk', label: '行走', pose: { body: [5, 0, 0], leftArm: [-24, 0, 5], rightArm: [24, 0, -5], leftLeg: [24, 0, 0], rightLeg: [-18, 0, 0], rightKnee: [28, 0, 0] } },
  { value: 'run', label: '跑步', pose: { body: [18, 0, 0], leftArm: [-54, 0, 8], rightArm: [62, 0, -8], leftElbow: [62, 0, 0], rightElbow: [72, 0, 0], leftLeg: [48, 0, 0], rightLeg: [-42, 0, 0], leftKnee: [24, 0, 0], rightKnee: [74, 0, 0] } },
  { value: 'sit', label: '坐姿', pose: { body: [4, 0, 0], leftLeg: [86, 0, 0], rightLeg: [86, 0, 0], leftKnee: [88, 0, 0], rightKnee: [88, 0, 0] } },
  { value: 'squat', label: '蹲下', pose: { body: [22, 0, 0], leftLeg: [52, 0, 8], rightLeg: [52, 0, -8], leftKnee: [104, 0, 0], rightKnee: [104, 0, 0] } },
  { value: 'kneel-one', label: '单膝跪', pose: { body: [8, 0, 0], leftLeg: [42, 0, 0], rightLeg: [76, 0, 0], leftKnee: [72, 0, 0], rightKnee: [126, 0, 0] } },
  { value: 'kneel-both', label: '双膝跪', pose: { body: [10, 0, 0], leftLeg: [68, 0, 0], rightLeg: [68, 0, 0], leftKnee: [126, 0, 0], rightKnee: [126, 0, 0] } },
  { value: 'hands-waist', label: '叉腰', pose: { leftArm: [8, -20, 42], rightArm: [8, 20, -42], leftElbow: [92, 0, 0], rightElbow: [92, 0, 0] } },
  { value: 'lean', label: '倚靠', pose: { body: [0, 0, 13], torso: [0, -8, 7], leftLeg: [0, 0, 7], rightLeg: [-14, 0, -7] } },
  { value: 'bow', label: '鞠躬', pose: { body: [42, 0, 0], torso: [12, 0, 0], head: [-16, 0, 0] } },
  { value: 'think', label: '思考', pose: { head: [8, -15, 8], rightArm: [18, -8, -28], rightElbow: [108, 0, 0] } },
  { value: 'fight', label: '格斗', pose: { body: [8, -18, 0], leftArm: [38, -18, 22], rightArm: [22, 14, -28], leftElbow: [88, 0, 0], rightElbow: [104, 0, 0], leftLeg: [18, 12, 8], rightLeg: [-12, -8, -8] } },
  { value: 'kick', label: '踢球', pose: { body: [9, 0, -8], leftArm: [-24, 0, 24], rightArm: [28, 0, -24], leftLeg: [74, 0, 0], rightLeg: [-18, 0, 0], leftKnee: [18, 0, 0] } },
  { value: 'throw', label: '投掷', pose: { torso: [-12, -24, 0], leftArm: [22, 18, 26], rightArm: [-68, -20, -24], rightElbow: [74, 0, 0] } },
  { value: 'push', label: '推进', pose: { body: [16, 0, 0], leftArm: [72, 0, 8], rightArm: [72, 0, -8], leftElbow: [12, 0, 0], rightElbow: [12, 0, 0] } },
  { value: 'wave', label: '招手', pose: { rightArm: [-92, 0, -28], rightElbow: [72, 0, 0], head: [0, -12, 0] } },
  { value: 'reach', label: '伸手', pose: { rightArm: [72, 0, -8], rightElbow: [8, 0, 0], torso: [6, 8, 0] } },
  { value: 'arms-crossed', label: '抱臂', pose: { leftArm: [36, -32, 30], rightArm: [36, 32, -30], leftElbow: [104, 0, 0], rightElbow: [104, 0, 0] } },
  { value: 'phone', label: '看手机', pose: { head: [18, 0, 0], leftArm: [25, -12, 28], rightArm: [28, 12, -24], leftElbow: [92, 0, 0], rightElbow: [94, 0, 0] } },
]

type StudioPoseAxis = { label: string; index: 0 | 1 | 2; min: number; max: number }
type StudioPoseJointDefinition = { id: StudioPoseJointId; label: string; axes: StudioPoseAxis[] }

const BODY_POSE_AXES: StudioPoseAxis[] = [
  { label: '前倾', index: 0, min: -45, max: 45 },
  { label: '转身', index: 1, min: -45, max: 45 },
  { label: '侧倾', index: 2, min: -45, max: 45 },
]
const LIMB_POSE_AXES: StudioPoseAxis[] = [
  { label: '前举', index: 0, min: -90, max: 180 },
  { label: '外展', index: 2, min: -90, max: 90 },
  { label: '旋转', index: 1, min: -90, max: 100 },
]
const POSE_JOINTS: StudioPoseJointDefinition[] = [
  { id: 'body', label: '身体', axes: BODY_POSE_AXES },
  { id: 'torso', label: '躯干', axes: BODY_POSE_AXES },
  { id: 'head', label: '头部', axes: [
    { label: '点头', index: 0, min: -45, max: 45 },
    { label: '转头', index: 1, min: -45, max: 45 },
    { label: '歪头', index: 2, min: -45, max: 45 },
  ] },
  { id: 'leftArm', label: '左臂', axes: LIMB_POSE_AXES },
  { id: 'rightArm', label: '右臂', axes: LIMB_POSE_AXES },
  { id: 'leftElbow', label: '左肘', axes: [{ label: '弯曲', index: 0, min: 0, max: 150 }] },
  { id: 'rightElbow', label: '右肘', axes: [{ label: '弯曲', index: 0, min: 0, max: 150 }] },
  { id: 'leftLeg', label: '左腿', axes: LIMB_POSE_AXES },
  { id: 'rightLeg', label: '右腿', axes: LIMB_POSE_AXES },
  { id: 'leftKnee', label: '左膝', axes: [{ label: '弯曲', index: 0, min: 0, max: 150 }] },
  { id: 'rightKnee', label: '右膝', axes: [{ label: '弯曲', index: 0, min: 0, max: 150 }] },
]

const CAPTURE_RATIOS = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

function crowdDimensions(members: CanvasStudioObject[]) {
  const unique = (axis: 0 | 2) => new Set(members.map((object) => object.position[axis].toFixed(3))).size
  const columns = Math.max(1, unique(0))
  const rows = Math.max(1, unique(2))
  return rows * columns === members.length ? `${rows}x${columns}` : `${members.length}人`
}

function studioObjectSignature(object: CanvasStudioObject) {
  const variant = object.kind === 'mannequin' ? object.mannequinVariant || 'male' : ''
  return `${object.kind}:${object.modelUrl || ''}:${variant}`
}

const DEFAULT_DIRECTOR_VIEW: StudioDirectorView = {
  position: [...DEFAULT_STUDIO_SCENE.directorCamera.position],
  target: [...DEFAULT_STUDIO_SCENE.directorCamera.target],
  fov: DEFAULT_STUDIO_SCENE.directorCamera.fov,
  roll: DEFAULT_STUDIO_SCENE.directorCamera.roll,
}

function uid() {
  return crypto.randomUUID()
}

function cloneVector(value: StudioVector3): StudioVector3 {
  return [value[0], value[1], value[2]]
}

function fileFromCanvas(canvas: HTMLCanvasElement, name: string) {
  return new Promise<File>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob
        ? resolve(new File([blob], name, { type: 'image/jpeg' }))
        : reject(new Error('截图数据获取失败，请重试')), 'image/jpeg', 0.94)
    } catch {
      reject(new Error('截图失败：场景包含不可读取的跨域素材'))
    }
  })
}

function disposeTree(root: import('three').Object3D) {
  const disposedMaterials = new Set<import('three').Material>()
  const disposedTextures = new Set<import('three').Texture>()
  const disposedSkeletons = new Set<import('three').Skeleton>()
  root.traverse((item) => {
    const mesh = item as import('three').Mesh
    mesh.geometry?.dispose?.()
    const skinnedMesh = item as import('three').SkinnedMesh
    if (skinnedMesh.isSkinnedMesh && skinnedMesh.skeleton && !disposedSkeletons.has(skinnedMesh.skeleton)) {
      disposedSkeletons.add(skinnedMesh.skeleton)
      skinnedMesh.skeleton.dispose()
    }
    if (!mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (disposedMaterials.has(material)) return
      disposedMaterials.add(material)
      for (const value of Object.values(material)) {
        const texture = value as import('three').Texture | null
        if (!texture?.isTexture || disposedTextures.has(texture)) continue
        disposedTextures.add(texture)
        texture.dispose()
      }
      material.dispose()
    })
  })
}

const STUDIO_LABEL_TEXTURE_HEIGHT = 128
const STUDIO_LABEL_FONT_SIZE = 64
const STUDIO_LABEL_WORLD_HEIGHT = 0.2
const STUDIO_LABEL_HEAD_GAP = 0.012

function paintStudioLabel(canvas: HTMLCanvasElement, name: string) {
  let context = canvas.getContext('2d')
  if (!context) return 2
  const label = name.trim() || '未命名对象'
  const font = `600 ${STUDIO_LABEL_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`
  context.font = font
  const maxTextWidth = 520
  let text = label
  while (text.length > 1 && context.measureText(text).width > maxTextWidth) text = `${text.slice(0, -2)}…`
  const textureWidth = Math.ceil(Math.max(192, Math.min(640, context.measureText(text).width + 112)))
  if (canvas.width !== textureWidth || canvas.height !== STUDIO_LABEL_TEXTURE_HEIGHT) {
    canvas.width = textureWidth
    canvas.height = STUDIO_LABEL_TEXTURE_HEIGHT
    context = canvas.getContext('2d')
    if (!context) return textureWidth / STUDIO_LABEL_TEXTURE_HEIGHT
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'rgba(8, 10, 15, .88)'
  context.strokeStyle = 'rgba(255, 255, 255, .16)'
  context.lineWidth = 2
  context.beginPath()
  context.roundRect(3, 3, canvas.width - 6, canvas.height - 6, 28)
  context.fill()
  context.stroke()
  context.fillStyle = '#f8f9fc'
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1, canvas.width - 64)
  return canvas.width / canvas.height
}

function createStudioLabel(THREE: typeof import('three'), name: string) {
  const canvas = document.createElement('canvas')
  const aspectRatio = paintStudioLabel(canvas, name)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.name = 'studio:label'
  sprite.userData.studioLabel = true
  sprite.userData.studioLabelText = name
  sprite.position.set(0, 2.35, 0)
  sprite.scale.set(aspectRatio * STUDIO_LABEL_WORLD_HEIGHT, STUDIO_LABEL_WORLD_HEIGHT, 1)
  sprite.renderOrder = 1_000
  return sprite
}

function updateStudioLabel(sprite: import('three').Sprite, name: string) {
  if (sprite.userData.studioLabelText === name) return
  const material = sprite.material as import('three').SpriteMaterial
  const canvas = material.map?.image
  if (!(canvas instanceof HTMLCanvasElement) || !material.map) return
  const aspectRatio = paintStudioLabel(canvas, name)
  sprite.scale.set(aspectRatio * STUDIO_LABEL_WORLD_HEIGHT, STUDIO_LABEL_WORLD_HEIGHT, 1)
  material.map.needsUpdate = true
  sprite.userData.studioLabelText = name
}

function mannequinPose(object: CanvasStudioObject): StudioPoseAdjustments {
  const preset = POSE_PRESETS.find((item) => item.value === object.posePreset)?.pose || {}
  const custom = object.poseAdjustments || {}
  const result: StudioPoseAdjustments = {}
  for (const joint of POSE_JOINTS) {
    const base = preset[joint.id] || [0, 0, 0]
    const adjustment = custom[joint.id] || [0, 0, 0]
    result[joint.id] = [base[0] + adjustment[0], base[1] + adjustment[1], base[2] + adjustment[2]]
  }
  return result
}

function applyMannequinPose(group: import('three').Group, object: CanvasStudioObject) {
  const pose = mannequinPose(object)
  for (const [jointId, degrees] of Object.entries(pose)) {
    const joint = group.getObjectByName(`pose:${jointId}`)
    if (!joint || !degrees) continue
    joint.rotation.set(degrees[0] * Math.PI / 180, degrees[1] * Math.PI / 180, degrees[2] * Math.PI / 180)
  }
}

function inspectStudioModelRig(root: import('three').Object3D): StudioRuntimeRig {
  const bonesById = new Map<string, import('three').Bone>()
  let skinnedMeshCount = 0
  root.traverse((item) => {
    const mesh = item as import('three').SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return
    skinnedMeshCount += 1
    for (const bone of mesh.skeleton.bones) bonesById.set(bone.uuid, bone)
  })
  const bones = Array.from(bonesById.values())
  const report = analyzeStudioRigBoneNames(bones.map((bone) => bone.name), skinnedMeshCount)
  const mappedBones: StudioRuntimeRig['bones'] = {}
  const baseRotations: StudioRuntimeRig['baseRotations'] = {}
  for (const [jointId, boneName] of Object.entries(report.joints) as Array<[StudioPoseJointId, string]>) {
    const bone = bones.find((item) => item.name === boneName)
    if (!bone) continue
    mappedBones[jointId] = bone
    baseRotations[jointId] = [bone.rotation.x, bone.rotation.y, bone.rotation.z]
  }
  return { report, bones: mappedBones, baseRotations }
}

function applyStudioModelPose(rig: StudioRuntimeRig, object: CanvasStudioObject) {
  const pose = mannequinPose(object)
  for (const joint of POSE_JOINTS) {
    const bone = rig.bones[joint.id]
    const base = rig.baseRotations[joint.id]
    const degrees = pose[joint.id]
    if (!bone || !base || !degrees) continue
    bone.rotation.set(
      base[0] + degrees[0] * Math.PI / 180,
      base[1] + degrees[1] * Math.PI / 180,
      base[2] + degrees[2] * Math.PI / 180,
    )
  }
}

const POSE_CONNECTIONS: Array<[StudioPoseJointId, StudioPoseJointId]> = [
  ['body', 'torso'],
  ['torso', 'head'],
  ['torso', 'leftArm'],
  ['leftArm', 'leftElbow'],
  ['torso', 'rightArm'],
  ['rightArm', 'rightElbow'],
  ['body', 'leftLeg'],
  ['leftLeg', 'leftKnee'],
  ['body', 'rightLeg'],
  ['rightLeg', 'rightKnee'],
]

function createStudioPoseHelper(THREE: typeof import('three')): StudioPoseHelper {
  const root = new THREE.Group()
  root.name = 'studio:pose-helper'
  root.visible = false
  root.renderOrder = 1_200
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(POSE_CONNECTIONS.length * 2 * 3), 3))
  geometry.setDrawRange(0, 0)
  const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: 0x35d8f7,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
    depthWrite: false,
  }))
  line.renderOrder = 1_200
  root.add(line)
  const points = new Map<StudioPoseJointId, import('three').Mesh>()
  for (const joint of POSE_JOINTS) {
    const point = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x42ddff, depthTest: false, depthWrite: false }),
    )
    point.name = `studio:pose-point:${joint.id}`
    point.userData.studioPoseJointId = joint.id
    point.renderOrder = 1_201
    point.visible = false
    root.add(point)
    points.set(joint.id, point)
  }
  return { root, line, points }
}

function resolveStudioPoseJoint(
  runtime: StudioRuntime,
  object: CanvasStudioObject,
  jointId: StudioPoseJointId,
) {
  if (object.kind === 'model') return runtime.rigs.get(object.id)?.bones[jointId] || null
  return runtime.groups.get(object.id)?.getObjectByName(`pose:${jointId}`) || null
}

function updateStudioPoseHelper(runtime: StudioRuntime, selectedId: string | null, enabled: boolean) {
  const helper = runtime.poseHelper
  const object = enabled && selectedId
    ? studioObjectForRuntime(runtime, selectedId)
    : null
  if (!object || (object.kind !== 'mannequin' && object.kind !== 'model')) {
    helper.root.visible = false
    return
  }
  const positions = new Map<StudioPoseJointId, import('three').Vector3>()
  for (const joint of POSE_JOINTS) {
    const source = resolveStudioPoseJoint(runtime, object, joint.id)
    const point = helper.points.get(joint.id)
    if (!source || !point) {
      if (point) point.visible = false
      continue
    }
    const position = source.getWorldPosition(new runtime.THREE.Vector3())
    positions.set(joint.id, position)
    point.position.copy(position)
    point.userData.studioObjectId = object.id
    point.visible = true
  }
  const attribute = helper.line.geometry.getAttribute('position') as import('three').BufferAttribute
  let cursor = 0
  for (const [fromId, toId] of POSE_CONNECTIONS) {
    const from = positions.get(fromId)
    const to = positions.get(toId)
    if (!from || !to) continue
    attribute.setXYZ(cursor, from.x, from.y, from.z)
    attribute.setXYZ(cursor + 1, to.x, to.y, to.z)
    cursor += 2
  }
  attribute.needsUpdate = true
  helper.line.geometry.setDrawRange(0, cursor)
  helper.root.visible = positions.size > 0
}

function studioObjectForRuntime(runtime: StudioRuntime, id: string) {
  return runtime.groups.get(id)?.userData.studioDefinition as CanvasStudioObject | undefined
}

function createStudioCameraMarker(THREE: typeof import('three')) {
  const root = new THREE.Group()
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x91a7ff, transparent: true, opacity: 0.88, depthTest: false })
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.28), bodyMaterial)
  body.renderOrder = 900
  root.add(body)
  const lens = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.32, 16, 1, true), bodyMaterial.clone())
  lens.rotation.x = -Math.PI / 2
  lens.position.z = -0.28
  lens.renderOrder = 900
  root.add(lens)
  const points = [
    0, 0, -0.42, -0.46, -0.3, -1.1,
    0, 0, -0.42, 0.46, -0.3, -1.1,
    0, 0, -0.42, 0.46, 0.3, -1.1,
    0, 0, -0.42, -0.46, 0.3, -1.1,
    -0.46, -0.3, -1.1, 0.46, -0.3, -1.1,
    0.46, -0.3, -1.1, 0.46, 0.3, -1.1,
    0.46, 0.3, -1.1, -0.46, 0.3, -1.1,
    -0.46, 0.3, -1.1, -0.46, -0.3, -1.1,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const frustum = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x91a7ff, transparent: true, opacity: 0.68, depthTest: false }))
  frustum.renderOrder = 899
  root.add(frustum)
  return root
}

const STUDIO_SURFACE_SNAP_DISTANCE = 0.75

function snapStudioMannequinToSurface(
  runtime: StudioRuntime,
  movingId: string,
  worldPosition: import('three').Vector3,
  objects: CanvasStudioObject[],
): StudioVector3 | null {
  let bestPoint: import('three').Vector3 | null = null
  let bestDistance = STUDIO_SURFACE_SNAP_DISTANCE
  const raycaster = new runtime.THREE.Raycaster()
  raycaster.far = STUDIO_SURFACE_SNAP_DISTANCE
  const axisDirections = [
    new runtime.THREE.Vector3(1, 0, 0), new runtime.THREE.Vector3(-1, 0, 0),
    new runtime.THREE.Vector3(0, 1, 0), new runtime.THREE.Vector3(0, -1, 0),
    new runtime.THREE.Vector3(0, 0, 1), new runtime.THREE.Vector3(0, 0, -1),
  ]
  for (const target of objects) {
    if (target.id === movingId || target.kind !== 'model' || !target.snapSurface || !target.visible) continue
    const group = runtime.groups.get(target.id)
    if (!group?.userData.studioModelReady) continue
    group.updateWorldMatrix(true, true)
    const bounds = new runtime.THREE.Box3().setFromObject(group)
    const centreDirection = bounds.getCenter(new runtime.THREE.Vector3()).sub(worldPosition)
    const directions = centreDirection.lengthSq() > 0.000_001
      ? [centreDirection.normalize(), ...axisDirections]
      : axisDirections
    let hitTarget = false
    for (const direction of directions) {
      raycaster.set(worldPosition, direction)
      const hit = raycaster.intersectObject(group, true).find((entry) => {
        const mesh = entry.object as import('three').Mesh
        return mesh.isMesh && !mesh.userData.studioLabel
      })
      if (!hit) continue
      hitTarget = true
      if (hit.distance > bestDistance) continue
      bestDistance = hit.distance
      bestPoint = hit.point.clone()
    }
    // Only skip this target's bounding-box fallback when this target produced a
    // real mesh hit. A hit on an earlier model must not suppress closer later
    // models that can only be resolved through their bounds.
    if (hitTarget) continue
    const closest = bounds.clampPoint(worldPosition, new runtime.THREE.Vector3())
    const distance = closest.distanceTo(worldPosition)
    if (distance <= bestDistance) {
      bestDistance = distance
      bestPoint = closest
    }
  }
  if (!bestPoint) return null
  const local = runtime.world.worldToLocal(bestPoint.clone())
  return [local.x, local.y, local.z]
}

function cameraPosition(camera: CanvasStudioCamera, objects: CanvasStudioObject[]): StudioVector3 {
  const followed = camera.followObjectId ? objects.find((object) => object.id === camera.followObjectId) : null
  const offset = camera.followOffset || [0, 0, 0]
  return followed
    ? [followed.position[0] + offset[0], followed.position[1] + offset[1], followed.position[2] + offset[2]]
    : cloneVector(camera.position)
}

function cameraTarget(camera: CanvasStudioCamera, objects: CanvasStudioObject[]): StudioVector3 {
  const target = camera.lookAtObjectId ? objects.find((object) => object.id === camera.lookAtObjectId) : null
  if (target) return [target.position[0], target.position[1] + 1, target.position[2]]
  if (camera.orientationMode === 'rotation') {
    const position = cameraPosition(camera, objects)
    const distance = Math.max(0.1, Math.hypot(
      camera.target[0] - camera.position[0],
      camera.target[1] - camera.position[1],
      camera.target[2] - camera.position[2],
    ))
    return studioCameraTargetFromRotation(position, camera.rotation || studioCameraRotationFromTarget(camera.position, camera.target, camera.roll || 0), distance)
  }
  return cloneVector(camera.target)
}

function captureDimensions(value: string, viewportWidth: number, viewportHeight: number) {
  const ratio = value === 'auto'
    ? Math.max(0.2, viewportWidth / Math.max(1, viewportHeight))
    : (() => {
      const match = value.match(/^(\d+):(\d+)$/)
      return match ? Number(match[1]) / Number(match[2]) : 16 / 9
    })()
  return ratio >= 1
    ? { width: 1_600, height: Math.max(480, Math.round(1_600 / ratio)) }
    : { width: Math.max(480, Math.round(1_600 * ratio)), height: 1_600 }
}

function readDirectorView(runtime: StudioRuntime): StudioDirectorView {
  return {
    position: [runtime.camera.position.x, runtime.camera.position.y, runtime.camera.position.z],
    target: [runtime.controls.target.x, runtime.controls.target.y, runtime.controls.target.z],
    fov: runtime.camera.fov,
    roll: runtime.camera.rotation.z * 180 / Math.PI,
  }
}

function applyDirectorView(runtime: StudioRuntime, view: StudioDirectorView) {
  runtime.camera.position.set(...view.position)
  runtime.camera.fov = view.fov
  runtime.camera.updateProjectionMatrix()
  runtime.controls.target.set(...view.target)
  runtime.controls.update()
  runtime.camera.rotation.z = view.roll * Math.PI / 180
}

/** Render a camera deliverable without editor-only camera rigs or the Gizmo. */
function renderStudioCameraFrame(
  runtime: StudioRuntime,
  renderer: import('three').WebGLRenderer,
  camera: import('three').Camera,
) {
  const markerVisibility = new Map<import('three').Group, boolean>()
  runtime.cameraGroups.forEach((group) => {
    markerVisibility.set(group, group.visible)
    group.visible = false
  })
  const transformHelper = runtime.transform.getHelper()
  const transformVisible = transformHelper.visible
  const poseHelperVisible = runtime.poseHelper.root.visible
  transformHelper.visible = false
  runtime.poseHelper.root.visible = false
  try {
    renderer.render(runtime.scene, camera)
  } finally {
    markerVisibility.forEach((visible, group) => { group.visible = visible })
    transformHelper.visible = transformVisible
    runtime.poseHelper.root.visible = poseHelperVisible
  }
}

function withIncomingNodes(sceneValue: unknown, incomingNodes: CanvasFlowNode[]) {
  const scene = normalizeCanvasStudioScene(sceneValue)
  const objects = [...scene.objects]
  for (const source of incomingNodes) {
    const modelUrl = source.data.modelUrl
    if (source.type !== 'model_3d' || !modelUrl) continue
    if (objects.some((object) => object.materialId === source.data.materialId || object.modelUrl === modelUrl)) continue
    objects.push({
      id: uid(), name: source.data.title || `3D 模型 ${objects.length + 1}`, kind: 'model', modelUrl,
      materialId: source.data.materialId || null, position: [objects.length * 1.6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      color: '#94a3b8', opacity: 1, visible: true, locked: false,
    })
  }
  const panorama = incomingNodes.find((source) => (source.data.mediaType === 'image' || source.type === 'image') && (source.data.contentUrl || source.data.imageUrl))
  return {
    ...scene,
    objects,
    panoramaUrl: scene.panoramaUrl || panorama?.data.contentUrl || panorama?.data.imageUrl || null,
    panoramaMaterialId: scene.panoramaMaterialId || panorama?.data.materialId || null,
  } satisfies CanvasStudioScene
}

function initialScene(node: CanvasFlowNode, incomingNodes: CanvasFlowNode[]) {
  return withIncomingNodes(node.data.studioScene, incomingNodes)
}

function NumberField({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <label><span>{label}</span><input type="number" step="0.1" value={Number(value.toFixed(3))} disabled={disabled} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next) }} /></label>
}

function StudioColorField({ label, value, defaultValue, disabled = false, onChange }: { label: string; value: string; defaultValue: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : defaultValue.toUpperCase()
  const applyText = (raw: string) => {
    const next = raw.startsWith('#') ? raw : `#${raw}`
    if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toUpperCase())
  }
  return <div className="nori-canvas-studio-color-field">
    <span>{label}</span>
    <div>
      <button type="button" aria-label="选择颜色" disabled={disabled} onClick={() => setOpen((value) => !value)}><i style={{ backgroundColor: normalized }} /><ChevronDown /></button>
      <code>{normalized}</code>
    </div>
    {open && !disabled ? <div className="nori-canvas-studio-color-popover" onPointerDown={(event) => event.stopPropagation()}>
      <input type="color" aria-label={`${label}取色`} value={normalized} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      <input aria-label={`${label}十六进制`} defaultValue={normalized} maxLength={7} onBlur={(event) => applyText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyText(event.currentTarget.value) }} />
      <button type="button" disabled={normalized === defaultValue.toUpperCase()} onClick={() => onChange(defaultValue.toUpperCase())}>重置</button>
    </div> : null}
  </div>
}

function StudioRangeField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const update = (raw: string) => {
    const next = Number(raw)
    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
  }
  return <label className="nori-canvas-studio-range-field">
    <span>{label}{unit ? <small>{unit}</small> : null}</span>
    <span className="nori-canvas-studio-range-control">
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => update(event.target.value)} />
      <input type="number" aria-label={`${label}数值`} min={min} max={max} step={step} value={Number(value.toFixed(2))} disabled={disabled} onChange={(event) => update(event.target.value)} />
    </span>
  </label>
}

function PoseEditor({
  object,
  onPatch,
  onJointChange,
  availableJoints,
  activeJoint,
  onFocusJoint,
  disabled = false,
}: {
  object: CanvasStudioObject
  onPatch: (patch: Partial<CanvasStudioObject>) => void
  onJointChange: (jointId: StudioPoseJointId, axis: number, value: number) => void
  availableJoints?: ReadonlySet<StudioPoseJointId>
  activeJoint?: StudioPoseJointId | null
  onFocusJoint?: (jointId: StudioPoseJointId) => void
  disabled?: boolean
}) {
  return (
    <div className="nori-canvas-studio-pose">
      <div className="nori-canvas-studio-pose-presets">
        {POSE_PRESETS.map((preset) => <button type="button" key={preset.value} disabled={disabled} className={object.posePreset === preset.value ? 'is-active' : ''} onClick={() => onPatch({ posePreset: preset.value })}>{preset.label}</button>)}
      </div>
      <div className="nori-canvas-studio-pose-title"><span>关节微调</span><button type="button" disabled={disabled} onClick={() => onPatch({ poseAdjustments: {} })}>重置</button></div>
      {POSE_JOINTS.map((joint) => {
        const values = object.poseAdjustments?.[joint.id] || [0, 0, 0]
        const jointDisabled = disabled || Boolean(availableJoints && !availableJoints.has(joint.id))
        const classes = [jointDisabled && !disabled ? 'is-unmapped' : '', activeJoint === joint.id ? 'is-active' : ''].filter(Boolean).join(' ')
        return <section key={joint.id} className={classes} data-pose-joint={joint.id} onPointerDown={() => onFocusJoint?.(joint.id)}>
          <h4>{joint.label}{jointDisabled && !disabled ? <small>未映射</small> : null}</h4>
          {joint.axes.map((axis) => <StudioRangeField key={`${joint.id}-${axis.index}`} label={axis.label} value={values[axis.index]} min={axis.min} max={axis.max} disabled={jointDisabled} onChange={(value) => onJointChange(joint.id, axis.index, value)} />)}
        </section>
      })}
    </div>
  )
}

function StudioObjectTreeRow({
  object,
  selected,
  readOnly,
  onSelect,
  onContextMenu,
  onVisibility,
  onLock,
  onDelete,
}: {
  object: CanvasStudioObject
  selected: boolean
  readOnly: boolean
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
  onVisibility: () => void
  onLock: () => void
  onDelete: () => void
}) {
  const icon = object.kind === 'model' ? <Box />
    : object.kind === 'mannequin' ? <UserRound />
      : object.kind === 'sphere' ? <Sphere />
        : object.kind === 'cylinder' ? <Cylinder />
          : object.kind === 'cone' || object.kind === 'pyramid' ? <Triangle />
            : object.kind === 'torus' ? <CircleDot />
              : <Box />
  return <article className={`${selected ? 'is-active' : ''}${readOnly ? ' is-readonly' : ''}`} onClick={onSelect} onContextMenu={onContextMenu}>
    <i>{icon}</i><span><strong>{object.name}</strong></span>
    {!readOnly ? <><button type="button" title={object.visible ? '隐藏' : '显示'} onClick={(event) => { event.stopPropagation(); onVisibility() }}>{object.visible ? <Eye /> : <EyeOff />}</button><button type="button" title={object.locked ? '解锁' : '锁定'} onClick={(event) => { event.stopPropagation(); onLock() }}>{object.locked ? <Lock /> : <Unlock />}</button><button type="button" title="删除" onClick={(event) => { event.stopPropagation(); onDelete() }}><Trash2 /></button></> : null}
  </article>
}

export function CanvasStudio3DDialog({
  projectId,
  canvasId,
  node,
  incomingNodes,
  onSummaryChange,
  onStageCaptures,
  onSendCaptures,
  onClose,
  readOnly = false,
}: {
  projectId: string
  canvasId: string
  node: CanvasFlowNode
  incomingNodes: CanvasFlowNode[]
  onSummaryChange: (summary: CanvasStudioSummary) => void
  onStageCaptures: (drafts: CanvasStudioCaptureDraft[]) => Promise<CanvasStudioCaptureStageResult>
  onSendCaptures: (captures: CanvasStudioCapture[]) => Promise<CanvasStudioCaptureSendResult>
  onClose: () => void
  readOnly?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const addMenuRef = useRef<HTMLButtonElement>(null)
  const panoramaMenuRef = useRef<HTMLButtonElement>(null)
  const cameraMenuRef = useRef<HTMLButtonElement>(null)
  const ratioMenuRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const modelInputRef = useRef<HTMLInputElement>(null)
  const panoramaInputRef = useRef<HTMLInputElement>(null)
  const runtimeRef = useRef<StudioRuntime | null>(null)
  const cameraPreviewContainerRef = useRef<HTMLDivElement>(null)
  const cameraPreviewRuntimeRef = useRef<StudioPreviewRuntime | null>(null)
  const initialStudioSceneRef = useRef<CanvasStudioScene | null>(null)
  if (!initialStudioSceneRef.current) initialStudioSceneRef.current = initialScene(node, incomingNodes)
  const deriveLoadedScene = useCallback(
    (scene: CanvasStudioScene) => withIncomingNodes(scene, incomingNodes),
    [incomingNodes],
  )
  const {
    scene: studio,
    updateScene: updateStudioDocument,
    saveState: studioSaveState,
    revision: studioRevision,
    error: studioDocumentError,
    conflict: studioConflict,
    ready: studioDocumentReady,
    retry: retryStudioDocument,
    useServerVersion: adoptServerStudioDocument,
    mergeAndRetry: mergeStudioDocumentAndRetry,
    flush: flushStudioDocument,
  } = useStudioDocument({
    projectId,
    canvasId,
    nodeId: node.id,
    initialScene: initialStudioSceneRef.current,
    deriveLoadedScene,
    readOnly,
  })
  const studioRef = useRef(studio)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef(selectedId)
  const [sceneSelected, setSceneSelected] = useState(true)
  const sceneSelectedRef = useRef(sceneSelected)
  const setSceneSelection = useCallback((value: boolean) => {
    sceneSelectedRef.current = value
    setSceneSelected(value)
  }, [])
  const [mode, setMode] = useState<TransformMode>('translate')
  const [activePanel, setActivePanel] = useState<'objects' | 'cameras' | 'captures'>('objects')
  const activePanelRef = useRef(activePanel)
  const [activeCameraId, setActiveCameraId] = useState<string | null>(studio.cameras[0]?.id || null)
  const activeCameraIdRef = useRef(activeCameraId)
  const [viewMode, setViewMode] = useState<'director' | 'camera'>('director')
  const viewModeRef = useRef<'director' | 'camera'>('director')
  const directorViewRef = useRef<StudioDirectorView>({ ...studio.directorCamera, position: cloneVector(studio.directorCamera.position), target: cloneVector(studio.directorCamera.target) })
  const [sceneQuery, setSceneQuery] = useState('')
  const [propertyTab, setPropertyTab] = useState<'attributes' | 'pose'>('attributes')
  const propertyTabRef = useRef(propertyTab)
  const [activePoseJoint, setActivePoseJoint] = useState<StudioPoseJointId | null>(null)
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'captures'>('properties')
  const [dockMenu, setDockMenu] = useState<StudioDockMenu>(null)
  const [addFlyout, setAddFlyout] = useState<StudioAddFlyout>(null)
  const [crowdRows, setCrowdRows] = useState(3)
  const [crowdColumns, setCrowdColumns] = useState(3)
  const [crowdSpacing, setCrowdSpacing] = useState(1.15)
  const [pickerType, setPickerType] = useState<PickerType>(null)
  const [uploading, setUploading] = useState(false)
  const [ready, setReady] = useState(false)
  const [runtimeGeneration, setRuntimeGeneration] = useState(0)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [sendingCaptures, setSendingCaptures] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [compositionGrid] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpOpenRef = useRef(helpOpen)
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false)
  const [contextMenu, setContextMenu] = useState<StudioContextMenu | null>(null)
  const contextMenuRef = useRef<StudioContextMenu | null>(null)
  const [collapsedCrowdIds, setCollapsedCrowdIds] = useState<Set<string>>(() => new Set())
  const [rigReports, setRigReports] = useState<Record<string, StudioRigState>>({})

  useEffect(() => { studioRef.current = studio }, [studio])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { activeCameraIdRef.current = activeCameraId }, [activeCameraId])
  useEffect(() => { activePanelRef.current = activePanel }, [activePanel])
  useEffect(() => { sceneSelectedRef.current = sceneSelected }, [sceneSelected])
  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])
  useEffect(() => { propertyTabRef.current = propertyTab }, [propertyTab])
  useEffect(() => { contextMenuRef.current = contextMenu }, [contextMenu])
  useEffect(() => { helpOpenRef.current = helpOpen }, [helpOpen])
  useEffect(() => {
    const fullscreenTarget = dialogRef.current
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === dialogRef.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      if (document.fullscreenElement === fullscreenTarget) {
        void document.exitFullscreen().catch(() => undefined)
      }
    }
  }, [])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 2_000)
    return () => window.clearTimeout(timer)
  }, [message])

  const commit = useCallback((updater: (current: CanvasStudioScene) => CanvasStudioScene) => {
    if (readOnly || !studioDocumentReady || studioConflict) return
    updateStudioDocument((current) => {
      const next = updater(current)
      studioRef.current = next
      return next
    })
  }, [readOnly, studioConflict, studioDocumentReady, updateStudioDocument])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await dialogRef.current?.requestFullscreen()
    } catch {
      setFullscreen((value) => !value)
    }
  }, [])

  const closeStudio = useCallback(async () => {
    if (closing) return
    if (capturing || sendingCaptures || uploading) {
      setMessage(capturing ? '截图暂存完成后再退出' : sendingCaptures ? '截图发送完成后再退出' : '素材上传完成后再退出')
      return
    }
    if (studioConflict) {
      setMessage('请先处理场景保存冲突，再退出导演台')
      return
    }
    if (studioSaveState === 'loading' && !studioDocumentReady) {
      onClose()
      return
    }
    if (studioSaveState === 'error' && !studioDocumentReady) {
      onClose()
      return
    }
    setClosing(true)
    const flushed = await flushStudioDocument()
    if (flushed) {
      if (!readOnly) onSummaryChange(summarizeCanvasStudioScene(studioRef.current))
      onClose()
    }
    else {
      setClosing(false)
      setMessage(studioDocumentError || '场景尚未保存，请重试后退出')
    }
  }, [capturing, closing, flushStudioDocument, onClose, onSummaryChange, readOnly, sendingCaptures, studioConflict, studioDocumentError, studioDocumentReady, studioSaveState, uploading])

  const updateObject = useCallback((id: string, patch: Partial<CanvasStudioObject>) => {
    commit((current) => ({ ...current, objects: current.objects.map((object) => object.id === id ? { ...object, ...patch } : object) }))
  }, [commit])

  const updateSceneTransform = useCallback((object: import('three').Object3D) => {
    commit((current) => ({
      ...current,
      scenePosition: [object.position.x, object.position.y, object.position.z],
      sceneRotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      sceneScale: [Math.max(.05, object.scale.x), Math.max(.05, object.scale.y), Math.max(.05, object.scale.z)],
    }))
  }, [commit])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let frame = 0
    let observer: ResizeObserver | null = null
    void (async () => {
      try {
        const THREE = await import('three')
        const [{ OrbitControls }, { TransformControls }, { GLTFLoader }] = await Promise.all([
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three/examples/jsm/controls/TransformControls.js'),
          import('three/examples/jsm/loaders/GLTFLoader.js'),
        ])
        if (disposed) return
        const scene = new THREE.Scene()
        const world = new THREE.Group()
        world.name = 'studio:world'
        scene.add(world)
        const initialDirector = studioRef.current.directorCamera
        const camera = new THREE.PerspectiveCamera(initialDirector.fov, 16 / 9, 0.03, 500)
        camera.position.set(...initialDirector.position)
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.05
        renderer.shadowMap.enabled = true
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.domElement.className = 'nori-canvas-studio-webgl'
        renderer.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault()
          setReady(false)
          setRenderError('3D 渲染上下文暂时中断，正在恢复…')
        })
        renderer.domElement.addEventListener('webglcontextrestored', () => {
          setRenderError(null)
          setReady(true)
          setMessage('3D 场景已恢复')
        })
        container.appendChild(renderer.domElement)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.target.set(...initialDirector.target)
        controls.maxPolarAngle = Math.PI * 0.98
        controls.update()
        camera.rotation.z = initialDirector.roll * Math.PI / 180
        const transform = new TransformControls(camera, renderer.domElement)
        transform.setMode('translate')
        scene.add(transform.getHelper())
        transform.addEventListener('dragging-changed', (event) => { controls.enabled = !event.value })
        transform.addEventListener('objectChange', () => {
          if (readOnly) return
          const id = selectedIdRef.current
          const object = transform.object
          if (!object) return
          if (!id && sceneSelectedRef.current && object === world) {
            updateSceneTransform(object)
            return
          }
          const cameraId = object.userData.studioCameraId as string | undefined
          if (cameraId) {
            const currentCamera = studioRef.current.cameras.find((camera) => camera.id === cameraId)
            if (!currentCamera || currentCamera.locked) return
            const position: StudioVector3 = [object.position.x, object.position.y, object.position.z]
            const distance = Math.max(0.1, Math.hypot(
              currentCamera.target[0] - currentCamera.position[0],
              currentCamera.target[1] - currentCamera.position[1],
              currentCamera.target[2] - currentCamera.position[2],
            ))
            const rotation: StudioVector3 = transform.getMode() === 'rotate'
              ? [object.rotation.x, object.rotation.y, object.rotation.z]
              : currentCamera.orientationMode === 'rotation'
                ? cloneVector(currentCamera.rotation || studioCameraRotationFromTarget(currentCamera.position, currentCamera.target, currentCamera.roll || 0))
                : studioCameraRotationFromTarget(position, currentCamera.target, currentCamera.roll || 0)
            const target = currentCamera.orientationMode === 'rotation'
              ? studioCameraTargetFromRotation(position, rotation, distance)
              : cloneVector(currentCamera.target)
            commit((current) => ({
              ...current,
              cameras: current.cameras.map((camera) => camera.id === cameraId ? {
                ...camera,
                position,
                target,
                rotation,
                ...(transform.getMode() === 'rotate' ? { orientationMode: 'rotation' as const, roll: rotation[2] * 180 / Math.PI } : {}),
              } : camera),
            }))
            return
          }
          if (!id) return
          let position: StudioVector3 = [object.position.x, object.position.y, object.position.z]
          const studioObject = studioRef.current.objects.find((item) => item.id === id)
          if (transform.getMode() === 'translate' && studioObject?.kind === 'mannequin') {
            object.updateWorldMatrix(true, false)
            const worldPosition = object.getWorldPosition(new THREE.Vector3())
            const snapped = snapStudioMannequinToSurface(runtime, id, worldPosition, studioRef.current.objects)
            if (snapped) {
              position = snapped
              object.position.set(...snapped)
            }
          }
          updateObject(id, {
            position,
            rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
            scale: [object.scale.x, object.scale.y, object.scale.z],
          })
        })
        scene.add(new THREE.HemisphereLight(0xeaf0ff, 0x222838, 2.2))
        const key = new THREE.DirectionalLight(0xffffff, 3.4)
        key.position.set(5, 9, 6)
        key.castShadow = true
        scene.add(key)
        const rim = new THREE.DirectionalLight(0x8fa8ff, 1.5)
        rim.position.set(-6, 4, -4)
        scene.add(rim)
        const grid = new THREE.GridHelper(30, 30, 0x536183, 0x283044)
        world.add(grid)
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 1, transparent: true, opacity: 0.52 }))
        ground.rotation.x = -Math.PI / 2
        ground.receiveShadow = true
        world.add(ground)
        const poseHelper = createStudioPoseHelper(THREE)
        scene.add(poseHelper.root)
        const runtime: StudioRuntime = { THREE, camera, controls, transform, renderer, scene, world, container, loader: new GLTFLoader(), groups: new Map(), cameraGroups: new Map(), rigs: new Map(), poseHelper, grid, ground, panorama: null }
        runtimeRef.current = runtime
        setRuntimeGeneration((generation) => generation + 1)
        const rememberDirectorView = () => {
          if (viewModeRef.current === 'director') directorViewRef.current = readDirectorView(runtime)
        }
        const persistDirectorView = () => {
          if (viewModeRef.current !== 'director' || readOnly) return
          const directorCamera = readDirectorView(runtime)
          directorViewRef.current = directorCamera
          commit((current) => ({ ...current, directorCamera }))
        }
        const beginDirectorNavigation = () => {
          if (viewModeRef.current === 'camera') {
            viewModeRef.current = 'director'
            setViewMode('director')
          }
          directorViewRef.current = readDirectorView(runtime)
        }
        controls.addEventListener('start', beginDirectorNavigation)
        controls.addEventListener('change', rememberDirectorView)
        controls.addEventListener('end', persistDirectorView)
        let down = { x: 0, y: 0 }
        const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY } }
        const pointerUp = (event: PointerEvent) => {
          if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || transform.dragging) return
          const rect = renderer.domElement.getBoundingClientRect()
          const raycaster = new THREE.Raycaster()
          raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
          // Pose handles are intentionally rendered over the mannequin. Prefer a
          // handle hit before the body mesh so an exposed joint never loses the
          // click to the geometry directly behind it.
          const poseHit = runtime.poseHelper.root.visible
            ? raycaster.intersectObjects(Array.from(runtime.poseHelper.points.values()), false)[0]?.object
            : undefined
          const hit = poseHit || raycaster.intersectObjects([...runtime.groups.values(), ...runtime.cameraGroups.values()], true)[0]?.object
          let current: import('three').Object3D | null = hit || null
          const poseJointId = current?.userData.studioPoseJointId as StudioPoseJointId | undefined
          while (current && !current.userData.studioObjectId && !current.userData.studioCameraId) current = current.parent
          const cameraId = current?.userData.studioCameraId as string | undefined
          if (cameraId) {
            setActivePanel('cameras')
            setInspectorTab('properties')
            setPropertiesCollapsed(false)
            setMode((currentMode) => currentMode === 'scale' ? 'translate' : currentMode)
            setActiveCameraId(cameraId)
            setSelectedId(null)
            setSceneSelection(false)
            return
          }
          const nextId = current?.userData.studioObjectId || null
          if (nextId) {
            setActivePanel('objects')
            setInspectorTab('properties')
            setPropertiesCollapsed(false)
            setPropertyTab(poseJointId ? 'pose' : 'attributes')
            setActivePoseJoint(poseJointId || null)
            setSelectedId(nextId)
            setSceneSelection(false)
            return
          }
          setActivePanel('objects')
          setInspectorTab('properties')
          setPropertiesCollapsed(false)
          setSelectedId(null)
          setSceneSelection(true)
        }
        renderer.domElement.addEventListener('pointerdown', pointerDown)
        renderer.domElement.addEventListener('pointerup', pointerUp)
        const resize = () => {
          const width = Math.max(1, container.clientWidth)
          const height = Math.max(1, container.clientHeight)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
          renderer.setSize(width, height, false)
        }
        resize()
        observer = new ResizeObserver(resize)
        observer.observe(container)
        const animate = () => {
          if (disposed) return
          controls.update()
          updateStudioPoseHelper(runtime, selectedIdRef.current, propertyTabRef.current === 'pose' && activePanelRef.current === 'objects')
          renderer.render(scene, camera)
          const preview = cameraPreviewRuntimeRef.current
          if (preview) {
            const previewDefinition = studioRef.current.cameras.find((item) => item.id === preview.cameraId)
            if (previewDefinition) {
              const position = cameraPosition(previewDefinition, studioRef.current.objects)
              const target = cameraTarget(previewDefinition, studioRef.current.objects)
              const width = Math.max(1, preview.container.clientWidth)
              const height = Math.max(1, preview.container.clientHeight)
              preview.camera.position.set(...position)
              preview.camera.fov = previewDefinition.fov
              preview.camera.aspect = width / height
              preview.camera.lookAt(...target)
              preview.camera.rotation.z = (previewDefinition.roll || 0) * Math.PI / 180
              preview.camera.updateProjectionMatrix()
              renderStudioCameraFrame(runtime, preview.renderer, preview.camera)
            }
          }
          frame = requestAnimationFrame(animate)
        }
        animate()
        setReady(true)
        return () => {
          renderer.domElement.removeEventListener('pointerdown', pointerDown)
          renderer.domElement.removeEventListener('pointerup', pointerUp)
        }
      } catch (error) {
        if (!disposed) setRenderError(error instanceof Error ? error.message : 'WebGL 渲染器创建失败')
      }
    })()
    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      const runtime = runtimeRef.current
      if (runtime) {
        runtime.controls.dispose()
        runtime.transform.dispose()
        runtime.groups.forEach(disposeTree)
        runtime.cameraGroups.forEach(disposeTree)
        runtime.groups.clear()
        runtime.cameraGroups.clear()
        runtime.rigs.clear()
        disposeTree(runtime.poseHelper.root)
        if (runtime.panorama) disposeTree(runtime.panorama)
        disposeTree(runtime.ground)
        disposeTree(runtime.grid)
        runtime.renderer.dispose()
        runtime.renderer.domElement.remove()
      }
      runtimeRef.current = null
    }
  }, [commit, readOnly, setSceneSelection, updateObject, updateSceneTransform])

  const objectSignature = useMemo(() => studio.objects.map((object) => `${object.id}:${studioObjectSignature(object)}`).join('|'), [studio.objects])
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !ready) return
    const signatures = new Map(studioRef.current.objects.map((object) => [object.id, studioObjectSignature(object)]))
    runtime.groups.forEach((group, id) => {
      if (signatures.get(id) === group.userData.studioObjectSignature) return
      runtime.world.remove(group)
      disposeTree(group)
      runtime.groups.delete(id)
      runtime.rigs.delete(id)
    })
    for (const object of studioRef.current.objects) {
      if (runtime.groups.has(object.id)) continue
      const wrapper = new runtime.THREE.Group()
      wrapper.userData.studioObjectId = object.id
      wrapper.userData.studioDefinition = object
      wrapper.userData.studioObjectSignature = studioObjectSignature(object)
      const label = createStudioLabel(runtime.THREE, object.name)
      if (object.kind === 'mannequin') label.position.y = studioMannequinVisualHeight(object.mannequinVariant) + STUDIO_LABEL_WORLD_HEIGHT / 2 + STUDIO_LABEL_HEAD_GAP
      wrapper.add(label)
      runtime.groups.set(object.id, wrapper)
      runtime.world.add(wrapper)
      if (object.kind === 'mannequin') {
        wrapper.add(createStudioMannequin(runtime.THREE, object))
        continue
      }
      if (object.kind !== 'model') {
        const geometry = object.kind === 'sphere'
          ? new runtime.THREE.SphereGeometry(0.8, 36, 24)
          : object.kind === 'cylinder'
            ? new runtime.THREE.CylinderGeometry(0.65, 0.65, 1.6, 32)
            : object.kind === 'torus'
              ? new runtime.THREE.TorusGeometry(0.68, 0.22, 20, 48)
              : object.kind === 'cone'
                ? new runtime.THREE.ConeGeometry(0.75, 1.7, 32)
                : object.kind === 'pyramid'
                  ? new runtime.THREE.ConeGeometry(0.86, 1.7, 4)
                  : new runtime.THREE.BoxGeometry(1.4, 1.4, 1.4)
        const mesh = new runtime.THREE.Mesh(geometry, new runtime.THREE.MeshStandardMaterial({ color: object.color, transparent: true, opacity: object.opacity, roughness: 0.72 }))
        mesh.castShadow = true
        mesh.receiveShadow = true
        wrapper.add(mesh)
        continue
      }
      const url = toDisplayImageUrl(object.modelUrl || '') || object.modelUrl || ''
      setRigReports((current) => ({ ...current, [object.id]: 'loading' }))
      void runtime.loader.loadAsync(url).then((gltf) => {
        if (runtimeRef.current !== runtime || runtime.groups.get(object.id) !== wrapper) { disposeTree(gltf.scene); return }
        const rig = inspectStudioModelRig(gltf.scene)
        runtime.rigs.set(object.id, rig)
        const box = new runtime.THREE.Box3().setFromObject(gltf.scene)
        const size = box.getSize(new runtime.THREE.Vector3())
        const center = box.getCenter(new runtime.THREE.Vector3())
        const max = Math.max(size.x, size.y, size.z, 0.001)
        gltf.scene.scale.setScalar(2 / max)
        gltf.scene.position.set(-center.x * 2 / max, -box.min.y * 2 / max, -center.z * 2 / max)
        gltf.scene.traverse((item) => { const mesh = item as import('three').Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true } })
        wrapper.add(gltf.scene)
        wrapper.userData.studioModelReady = true
        const latest = studioRef.current.objects.find((item) => item.id === object.id)
        if (latest && rig.report.poseCapable) applyStudioModelPose(rig, latest)
        setRigReports((current) => ({ ...current, [object.id]: rig.report }))
      }).catch(() => {
        if (runtimeRef.current !== runtime || runtime.groups.get(object.id) !== wrapper) return
        runtime.rigs.delete(object.id)
        setRigReports((current) => ({ ...current, [object.id]: 'error' }))
        const fallback = new runtime.THREE.Mesh(new runtime.THREE.BoxGeometry(1.4, 1.8, 1.2), new runtime.THREE.MeshStandardMaterial({ color: 0x7c3aed, wireframe: true }))
        wrapper.add(fallback)
      })
    }
  }, [objectSignature, ready, runtimeGeneration])

  const cameraSignature = useMemo(() => studio.cameras.map((camera) => camera.id).join('|'), [studio.cameras])
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !ready) return
    const ids = new Set(studioRef.current.cameras.map((camera) => camera.id))
    runtime.cameraGroups.forEach((group, id) => {
      if (ids.has(id)) return
      runtime.world.remove(group)
      disposeTree(group)
      runtime.cameraGroups.delete(id)
    })
    for (const camera of studioRef.current.cameras) {
      if (runtime.cameraGroups.has(camera.id)) continue
      const marker = createStudioCameraMarker(runtime.THREE)
      marker.userData.studioCameraId = camera.id
      marker.traverse((item) => { item.userData.studioCameraId = camera.id })
      runtime.cameraGroups.set(camera.id, marker)
      runtime.world.add(marker)
    }
  }, [cameraSignature, ready, runtimeGeneration])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    for (const camera of studio.cameras) {
      const marker = runtime.cameraGroups.get(camera.id)
      if (!marker) continue
      const position = cameraPosition(camera, studio.objects)
      const target = cameraTarget(camera, studio.objects)
      marker.position.set(...position)
      if (camera.orientationMode === 'rotation' && !camera.lookAtObjectId) {
        const rotation = camera.rotation || studioCameraRotationFromTarget(position, target, camera.roll || 0)
        marker.rotation.set(...rotation)
      } else {
        const worldTarget = runtime.world.localToWorld(new runtime.THREE.Vector3(...target))
        marker.lookAt(worldTarget)
        marker.rotation.z = (camera.roll || 0) * Math.PI / 180
      }
      marker.visible = camera.visible !== false && !(viewMode === 'camera' && activeCameraId === camera.id)
      const selected = activePanel === 'cameras' && activeCameraId === camera.id
      marker.traverse((item) => {
        const material = (item as import('three').Mesh).material as import('three').Material & { color?: import('three').Color; opacity?: number }
        material?.color?.set(selected ? 0xffc46b : 0x91a7ff)
        if (typeof material?.opacity === 'number') material.opacity = selected ? 1 : 0.68
      })
    }
  }, [activeCameraId, activePanel, runtimeGeneration, studio.cameras, studio.objects, viewMode])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    for (const object of studio.objects) {
      const group = runtime.groups.get(object.id)
      if (!group) continue
      group.userData.studioDefinition = object
      group.visible = object.visible
      group.position.set(...object.position)
      group.rotation.set(...object.rotation)
      group.scale.set(...object.scale)
      const label = group.getObjectByName('studio:label') as import('three').Sprite | undefined
      if (label) {
        label.visible = studio.showLabels
        label.position.y = object.kind === 'mannequin'
          ? studioMannequinVisualHeight(object.mannequinVariant) + STUDIO_LABEL_WORLD_HEIGHT / 2 + STUDIO_LABEL_HEAD_GAP
          : 2.35
        updateStudioLabel(label, object.name)
      }
      if (object.kind === 'mannequin') {
        const mannequin = group.getObjectByName('pose:body') as import('three').Group | undefined
        if (mannequin) applyMannequinPose(mannequin, object)
      } else if (object.kind === 'model') {
        const rig = runtime.rigs.get(object.id)
        if (rig?.report.poseCapable) applyStudioModelPose(rig, object)
      }
      if (object.kind !== 'model') group.traverse((item) => {
        if (item.userData.studioLabel) return
        const mesh = item as import('three').Mesh
        const material = mesh.material as import('three').MeshStandardMaterial | undefined
        if (material?.color) {
          const tone = typeof mesh.userData.studioColorTone === 'number' ? mesh.userData.studioColorTone : 1
          material.color.set(object.color).multiplyScalar(tone)
          material.opacity = object.opacity
          material.transparent = object.opacity < 1
        }
      })
    }
  }, [runtimeGeneration, studio.objects, studio.showLabels])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.transform.setMode(mode)
    runtime.transform.setTranslationSnap(studio.snapToGrid ? 0.25 : null)
    runtime.transform.setRotationSnap(studio.snapToGrid ? Math.PI / 12 : null)
    const object = studio.objects.find((item) => item.id === selectedId)
    const group = object ? runtime.groups.get(object.id) : null
    const camera = activePanel === 'cameras' ? studio.cameras.find((item) => item.id === activeCameraId) : null
    const cameraGroup = camera ? runtime.cameraGroups.get(camera.id) : null
    if (!readOnly && sceneSelected) runtime.transform.attach(runtime.world)
    else if (!readOnly && group && !object?.locked) runtime.transform.attach(group)
    else if (!readOnly && cameraGroup && !camera?.locked && mode !== 'scale' && viewMode === 'director') runtime.transform.attach(cameraGroup)
    else runtime.transform.detach()
  }, [activeCameraId, activePanel, cameraSignature, mode, objectSignature, readOnly, runtimeGeneration, sceneSelected, selectedId, studio.cameras, studio.objects, studio.snapToGrid, viewMode])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.world.position.set(...studio.scenePosition)
    runtime.world.rotation.set(...studio.sceneRotation)
    runtime.world.scale.set(...studio.sceneScale)
  }, [runtimeGeneration, studio.scenePosition, studio.sceneRotation, studio.sceneScale])

  useEffect(() => {
    const view: StudioDirectorView = {
      position: cloneVector(studio.directorCamera.position),
      target: cloneVector(studio.directorCamera.target),
      fov: studio.directorCamera.fov,
      roll: studio.directorCamera.roll,
    }
    directorViewRef.current = view
    const runtime = runtimeRef.current
    if (runtime && viewModeRef.current === 'director') applyDirectorView(runtime, view)
  }, [runtimeGeneration, studio.directorCamera])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.scene.background = new runtime.THREE.Color(studio.backgroundColor)
    runtime.grid.visible = studio.showGrid
    runtime.ground.visible = studio.showGround
    runtime.ground.position.y = studio.groundHeight
    const groundMaterial = runtime.ground.material as import('three').MeshStandardMaterial
    groundMaterial.opacity = studio.groundOpacity
    groundMaterial.transparent = studio.groundOpacity < 1
  }, [runtimeGeneration, studio.backgroundColor, studio.groundHeight, studio.groundOpacity, studio.showGrid, studio.showGround])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    if (runtime.panorama) { runtime.scene.remove(runtime.panorama); disposeTree(runtime.panorama); runtime.panorama = null }
    if (!studio.panoramaUrl) return
    let active = true
    const url = toDisplayImageUrl(studio.panoramaUrl) || studio.panoramaUrl
    void new runtime.THREE.TextureLoader().loadAsync(url).then((texture) => {
      if (!active) { texture.dispose(); return }
      texture.colorSpace = runtime.THREE.SRGBColorSpace
      texture.wrapS = runtime.THREE.RepeatWrapping
      texture.repeat.x = -1
      const sphere = new runtime.THREE.Mesh(
        new runtime.THREE.SphereGeometry(studioRef.current.panoramaRadius, 80, 48),
        new runtime.THREE.MeshBasicMaterial({
          map: texture,
          side: runtime.THREE.BackSide,
          depthTest: false,
          depthWrite: false,
        }),
      )
      sphere.rotation.y = studioRef.current.panoramaRotation
      sphere.renderOrder = -1_000
      runtime.scene.add(sphere)
      runtime.panorama = sphere
    }).catch(() => {
      if (active && runtimeRef.current === runtime) setMessage('全景背景加载失败')
    })
    return () => { active = false }
  }, [runtimeGeneration, studio.panoramaUrl])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime?.panorama) return
    runtime.panorama.geometry.dispose()
    runtime.panorama.geometry = new runtime.THREE.SphereGeometry(studio.panoramaRadius, 80, 48)
  }, [runtimeGeneration, studio.panoramaRadius])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime?.panorama) runtime.panorama.rotation.y = studio.panoramaRotation
  }, [runtimeGeneration, studio.panoramaRotation])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      // Never turn browser/OS shortcuts such as Cmd+W, Cmd+S or Ctrl+R into
      // scene mutations.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') {
        if (contextMenuRef.current) setContextMenu(null)
        else if (helpOpenRef.current) setHelpOpen(false)
        else if (fullscreen) setFullscreen(false)
        else if (!pickerType && !capturing) void closeStudio()
        return
      }
      const selected = selectedIdRef.current
      const transformShortcut = key === 'v'
        || key === 'r'
        || (key === 's' && (Boolean(selected) || sceneSelectedRef.current))
      if (!readOnly && transformShortcut) {
        setMode(key === 'v' ? 'translate' : key === 'r' ? 'rotate' : 'scale')
        event.preventDefault()
        return
      }
      const navigationKey = ['w', 'a', 's', 'd', 'q', 'e'].includes(key) ? key as StudioNavigationKey : null
      if (!navigationKey) return
      const runtime = runtimeRef.current
      if (!runtime) return
      const currentView = readDirectorView(runtime)
      if (sceneSelectedRef.current) {
        if (readOnly) return
        event.preventDefault()
        commit((current) => ({
          ...current,
          scenePosition: moveStudioPositionRelativeToView(current.scenePosition, currentView, navigationKey),
        }))
        return
      }
      if (selected) {
        if (readOnly) return
        const object = studioRef.current.objects.find((item) => item.id === selected)
        if (!object || object.locked) return
        event.preventDefault()
        updateObject(selected, { position: moveStudioPositionRelativeToView(object.position, currentView, navigationKey) })
        return
      }
      const selectedCameraId = activePanelRef.current === 'cameras' ? activeCameraIdRef.current : null
      if (selectedCameraId) {
        if (readOnly) return
        const selectedCamera = studioRef.current.cameras.find((camera) => camera.id === selectedCameraId)
        if (!selectedCamera || selectedCamera.locked) return
        event.preventDefault()
        const position = moveStudioPositionRelativeToView(cameraPosition(selectedCamera, studioRef.current.objects), currentView, navigationKey)
        const distance = Math.max(0.1, Math.hypot(
          selectedCamera.target[0] - selectedCamera.position[0],
          selectedCamera.target[1] - selectedCamera.position[1],
          selectedCamera.target[2] - selectedCamera.position[2],
        ))
        const rotation = selectedCamera.rotation || studioCameraRotationFromTarget(selectedCamera.position, selectedCamera.target, selectedCamera.roll || 0)
        const target = selectedCamera.orientationMode === 'rotation'
          ? studioCameraTargetFromRotation(position, rotation, distance)
          : cloneVector(selectedCamera.target)
        commit((current) => ({
          ...current,
          cameras: current.cameras.map((camera) => camera.id === selectedCameraId ? {
            ...camera,
            position,
            target,
            rotation: selectedCamera.orientationMode === 'rotation'
              ? rotation
              : studioCameraRotationFromTarget(position, cameraTarget(selectedCamera, studioRef.current.objects), selectedCamera.roll || 0),
            followObjectId: null,
            followOffset: null,
          } : camera),
        }))
        return
      }
      event.preventDefault()
      if (viewModeRef.current === 'camera') {
        viewModeRef.current = 'director'
        setViewMode('director')
      }
      const next = moveStudioDirectorView(currentView, navigationKey)
      directorViewRef.current = next
      applyDirectorView(runtime, next)
      if (!readOnly) commit((current) => ({ ...current, directorCamera: next }))
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [capturing, closeStudio, commit, fullscreen, pickerType, readOnly, updateObject])

  const addObject = (kind: StudioObjectKind, input: Partial<CanvasStudioObject> = {}) => {
    if (readOnly) return
    const id = uid()
    const primitiveLabel = kind === 'box' ? '立方体'
      : kind === 'sphere' ? '球体'
        : kind === 'cylinder' ? '圆柱体'
          : kind === 'torus' ? '环状体'
            : kind === 'cone' ? '圆锥'
              : kind === 'pyramid' ? '棱锥'
                : '几何体'
    const object: CanvasStudioObject = {
      id, name: input.name || (kind === 'model' ? `3D 模型 ${studioRef.current.objects.length + 1}` : kind === 'mannequin' ? `角色 ${studioRef.current.objects.filter((item) => item.kind === 'mannequin').length + 1}` : `${primitiveLabel} ${studioRef.current.objects.length + 1}`),
      kind, modelUrl: input.modelUrl || null, materialId: input.materialId || null,
      position: input.position || [0, 0, 0], rotation: input.rotation || [0, 0, 0], scale: input.scale || [1, 1, 1],
      color: input.color || '#94a3b8', opacity: input.opacity ?? 1, visible: true, locked: false,
      ...(kind === 'mannequin' || kind === 'model' ? {
        posePreset: input.posePreset || 'stand',
        poseAdjustments: input.poseAdjustments || {},
      } : {}),
      ...(kind === 'mannequin' ? {
        mannequinVariant: input.mannequinVariant || 'male',
        crowdId: input.crowdId || null,
      } : {}),
      ...(kind === 'model' ? { snapSurface: input.snapSurface === true } : {}),
    }
    commit((current) => ({ ...current, objects: [...current.objects, object] }))
    setSelectedId(id)
    setSceneSelection(false)
  }

  const addCrowd = () => {
    if (readOnly) return
    const rows = Math.max(1, Math.min(10, Math.round(crowdRows)))
    const columns = Math.max(1, Math.min(10, Math.round(crowdColumns)))
    if (rows * columns > 100) { setMessage('群众总数不能超过 100'); return }
    const spacing = Math.max(0.3, Math.min(5, crowdSpacing))
    const crowdId = uid()
    const variants = MANNEQUIN_VARIANTS.filter((item) => item.value !== 'chibi')
    const startX = -((columns - 1) * spacing) / 2
    const startZ = -((rows - 1) * spacing) / 2
    const created = Array.from({ length: rows * columns }, (_, index): CanvasStudioObject => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const variant = variants[index % variants.length]
      return {
        id: uid(), name: `群众 ${index + 1}`, kind: 'mannequin', mannequinVariant: variant.value,
        posePreset: index % 4 === 0 ? 'walk' : 'stand', poseAdjustments: {}, crowdId,
        modelUrl: null, materialId: null, position: [startX + column * spacing, 0, startZ + row * spacing],
        rotation: [0, ((index % 3) - 1) * 0.08, 0], scale: [1, 1, 1], color: variant.color,
        opacity: 1, visible: true, locked: false,
      }
    })
    commit((current) => ({ ...current, objects: [...current.objects, ...created] }))
    setSelectedId(created[0]?.id || null)
    setSceneSelection(false)
    setDockMenu(null)
    setAddFlyout(null)
    setMessage(`已添加 ${created.length} 个群众素体`)
  }

  const updatePoseJoint = (object: CanvasStudioObject, jointId: StudioPoseJointId, axis: number, value: number) => {
    if (readOnly) return
    const poseAdjustments = structuredClone(object.poseAdjustments || {})
    const vector = poseAdjustments[jointId] || [0, 0, 0]
    vector[axis] = Math.max(-180, Math.min(180, value))
    poseAdjustments[jointId] = vector
    updateObject(object.id, { poseAdjustments })
  }

  const addMaterial = (material: FrameosMaterialItem) => {
    if (readOnly) return
    if (material.type === 'model3d' && material.url) addObject('model', { name: material.title || '3D 模型', modelUrl: material.url, materialId: material.id, position: [studioRef.current.objects.length * 1.4, 0, 0] })
    if (material.type === 'image' && material.url) commit((current) => ({ ...current, panoramaUrl: material.url, panoramaMaterialId: material.id }))
    setPickerType(null)
  }

  const upload = async (file: File, type: 'model3d' | 'image') => {
    if (readOnly) return
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('title', file.name.replace(/\.[^.]+$/, '') || (type === 'model3d' ? '3D 模型' : '720 全景'))
      form.set('projectId', projectId)
      const response = await apiFetch(`/api/projects/${projectId}/canvas/${canvasId}/materials`, { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, type === 'model3d' ? '3D 模型上传失败' : '全景图上传失败'))
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material) throw new Error('上传成功但未返回素材')
      addMaterial(payload.material)
      setMessage(type === 'model3d' ? '模型已上传并加入场景' : '已设置全景背景')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const duplicateObject = (object: CanvasStudioObject) => {
    if (readOnly) return
    addObject(object.kind, { ...structuredClone(object), id: undefined, name: `${object.name} 副本`, position: [object.position[0] + 0.8, object.position[1], object.position[2] + 0.8] })
  }
  const deleteObjects = (ids: ReadonlySet<string>) => {
    if (readOnly) return
    commit((current) => ({
      ...current,
      objects: current.objects.filter((object) => !ids.has(object.id)),
      cameras: current.cameras.map((camera) => ({
        ...camera,
        ...(camera.lookAtObjectId && ids.has(camera.lookAtObjectId) ? { lookAtObjectId: null } : {}),
        ...(camera.followObjectId && ids.has(camera.followObjectId) ? { followObjectId: null, followOffset: null } : {}),
      })),
    }))
    if (selectedId && ids.has(selectedId)) setSelectedId(null)
  }
  const deleteObject = (id: string) => {
    deleteObjects(new Set([id]))
  }
  const patchCrowd = (crowdId: string, patch: Partial<CanvasStudioObject>) => {
    if (readOnly) return
    commit((current) => ({
      ...current,
      objects: current.objects.map((object) => object.crowdId === crowdId ? { ...object, ...patch } : object),
    }))
  }
  const duplicateCrowd = (crowdId: string) => {
    if (readOnly) return
    const crowd = studioRef.current.objects.filter((object) => object.crowdId === crowdId)
    if (crowd.length === 0) return
    if (studioRef.current.objects.length + crowd.length > 200) {
      setMessage('场景对象最多 200 个，无法复制整组')
      return
    }
    const nextCrowdId = uid()
    const clones = crowd.map((object): CanvasStudioObject => ({
      ...structuredClone(object),
      id: uid(),
      crowdId: nextCrowdId,
      name: `${object.name} 副本`,
      position: [object.position[0] + 0.8, object.position[1], object.position[2] + 0.8],
    }))
    commit((current) => ({ ...current, objects: [...current.objects, ...clones] }))
    setSelectedId(clones[0].id)
    setCollapsedCrowdIds((current) => {
      const next = new Set(current)
      next.delete(nextCrowdId)
      return next
    })
    setMessage(`已复制群众组（${clones.length} 人）`)
  }
  const deleteCrowd = (crowdId: string) => {
    const ids = new Set(studioRef.current.objects.filter((object) => object.crowdId === crowdId).map((object) => object.id))
    if (ids.size === 0) return
    deleteObjects(ids)
    setMessage(`已删除群众组（${ids.size} 人）`)
  }
  const openContextMenu = (event: React.MouseEvent, kind: StudioContextMenu['kind'], id: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (readOnly) return
    setContextMenu({
      kind,
      id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 184)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 190)),
    })
  }
  const updateCamera = (id: string, patch: Partial<CanvasStudioCamera>) => {
    if (readOnly) return
    commit((current) => ({ ...current, cameras: current.cameras.map((camera) => camera.id === id ? { ...camera, ...patch } : camera) }))
  }
  const duplicateCamera = (camera: CanvasStudioCamera) => {
    if (readOnly) return
    const clone: CanvasStudioCamera = {
      ...structuredClone(camera),
      id: uid(),
      name: `${camera.name} 副本`,
      position: [camera.position[0] + 0.8, camera.position[1], camera.position[2] + 0.8],
      target: cloneVector(camera.target),
    }
    commit((current) => ({ ...current, cameras: [...current.cameras, clone] }))
    setActivePanel('cameras')
    setActiveCameraId(clone.id)
    setSelectedId(null)
    setSceneSelection(false)
  }
  const deleteCamera = (id: string) => {
    if (readOnly) return
    commit((current) => ({
      ...current,
      cameras: current.cameras.filter((camera) => camera.id !== id),
      captures: current.captures.map((capture) => capture.cameraId === id ? { ...capture, cameraId: null } : capture),
    }))
    if (activeCameraId === id) {
      setActiveCameraId(studioRef.current.cameras.find((camera) => camera.id !== id)?.id || null)
      activateDirectorView()
    }
  }
  const cameraAimDistance = (camera: CanvasStudioCamera) => Math.max(0.1, Math.hypot(
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ))
  const updateCameraPositionAxis = (camera: CanvasStudioCamera, axis: number, value: number) => {
    const position = cameraPosition(camera, studioRef.current.objects)
    position[axis] = value
    const rotation = camera.rotation || studioCameraRotationFromTarget(camera.position, camera.target, camera.roll || 0)
    updateCamera(camera.id, {
      position,
      followObjectId: null,
      followOffset: null,
      target: camera.orientationMode === 'rotation' ? studioCameraTargetFromRotation(position, rotation, cameraAimDistance(camera)) : camera.target,
      rotation: camera.orientationMode === 'rotation' ? rotation : studioCameraRotationFromTarget(position, camera.target, camera.roll || 0),
    })
  }
  const updateCameraRotationAxis = (camera: CanvasStudioCamera, axis: number, degrees: number) => {
    const rotation = cloneVector(camera.rotation || studioCameraRotationFromTarget(camera.position, camera.target, camera.roll || 0))
    rotation[axis] = degrees * Math.PI / 180
    updateCamera(camera.id, {
      rotation,
      orientationMode: 'rotation',
      lookAtObjectId: null,
      target: studioCameraTargetFromRotation(camera.position, rotation, cameraAimDistance(camera)),
      ...(axis === 2 ? { roll: degrees } : {}),
    })
  }
  const addCamera = (preset?: Omit<CanvasStudioCamera, 'id'>) => {
    if (readOnly) return
    const runtime = runtimeRef.current
    const camera: CanvasStudioCamera = preset
      ? { ...preset, id: uid(), position: cloneVector(preset.position), target: cloneVector(preset.target), rotation: studioCameraRotationFromTarget(preset.position, preset.target, preset.roll || 0), orientationMode: 'target', aspectRatio: studioRef.current.screenshotAspectRatio, roll: preset.roll || 0, visible: true, locked: false }
      : (() => {
        const position: StudioVector3 = runtime ? [runtime.camera.position.x, runtime.camera.position.y, runtime.camera.position.z] : [0, 2, 6]
        const target: StudioVector3 = runtime ? [runtime.controls.target.x, runtime.controls.target.y, runtime.controls.target.z] : [0, 1, 0]
        const roll = runtime ? runtime.camera.rotation.z * 180 / Math.PI : 0
        return { id: uid(), name: `机位 ${studioRef.current.cameras.length + 1}`, position, target, rotation: studioCameraRotationFromTarget(position, target, roll), orientationMode: 'target' as const, fov: runtime?.camera.fov || 45, aspectRatio: studioRef.current.screenshotAspectRatio, roll, visible: true, locked: false }
      })()
    commit((current) => ({ ...current, cameras: [...current.cameras, camera] }))
    setActivePanel('cameras')
    setInspectorTab('properties')
    setActiveCameraId(camera.id)
    setSelectedId(null)
    setSceneSelection(false)
  }
  const applyStudioCamera = useCallback((camera: CanvasStudioCamera) => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.camera.position.set(...cameraPosition(camera, studioRef.current.objects))
    runtime.camera.fov = camera.fov
    runtime.camera.updateProjectionMatrix()
    runtime.controls.target.set(...cameraTarget(camera, studioRef.current.objects))
    runtime.controls.update()
    runtime.camera.rotation.z = (camera.roll || 0) * Math.PI / 180
  }, [])
  const activateCamera = useCallback((camera: CanvasStudioCamera) => {
    const runtime = runtimeRef.current
    if (!runtime) return
    if (viewModeRef.current === 'director') directorViewRef.current = readDirectorView(runtime)
    viewModeRef.current = 'camera'
    applyStudioCamera(camera)
    setViewMode('camera')
    setActiveCameraId(camera.id)
    setSceneSelection(false)
  }, [applyStudioCamera, setSceneSelection])
  const activateDirectorView = useCallback(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    applyDirectorView(runtime, directorViewRef.current)
    viewModeRef.current = 'director'
    setViewMode('director')
  }, [])
  const resetDirectorView = useCallback(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const next: StudioDirectorView = {
      position: cloneVector(DEFAULT_DIRECTOR_VIEW.position),
      target: cloneVector(DEFAULT_DIRECTOR_VIEW.target),
      fov: DEFAULT_DIRECTOR_VIEW.fov,
      roll: DEFAULT_DIRECTOR_VIEW.roll,
    }
    applyDirectorView(runtime, next)
    directorViewRef.current = next
    viewModeRef.current = 'director'
    setViewMode('director')
    if (!readOnly) commit((current) => ({ ...current, directorCamera: next }))
    setMessage('导演视角已重置')
  }, [commit, readOnly])
  const selectCameraForEdit = useCallback((camera: CanvasStudioCamera) => {
    setActivePanel('cameras')
    setInspectorTab('properties')
    setMode((currentMode) => currentMode === 'scale' ? 'translate' : currentMode)
    setActiveCameraId(camera.id)
    setSelectedId(null)
    setSceneSelection(false)
  }, [setSceneSelection])

  useEffect(() => {
    if (!activeCameraId || viewMode !== 'camera') return
    const camera = studio.cameras.find((item) => item.id === activeCameraId)
    if (camera) applyStudioCamera(camera)
  }, [activeCameraId, applyStudioCamera, runtimeGeneration, studio.cameras, studio.objects, viewMode])

  const capture = async (all: boolean) => {
    if (readOnly) return
    const runtime = runtimeRef.current
    if (!runtime) return
    const targets = all ? studioRef.current.cameras.filter((camera) => camera.visible !== false) : []
    if (all && targets.length === 0) { setMessage('没有可截图的机位'); return }
    setCapturing(true)
    const originalPosition = runtime.camera.position.clone()
    const originalQuaternion = runtime.camera.quaternion.clone()
    const originalTarget = runtime.controls.target.clone()
    const originalFov = runtime.camera.fov
    let directorCaptureCamera: CanvasStudioCamera | null = null
    let shouldActivateDirectorCapture = false
    try {
      runtime.renderer.setPixelRatio(1)
      const activeCamera = viewModeRef.current === 'camera'
        ? studioRef.current.cameras.find((camera) => camera.id === activeCameraId) || null
        : null
      if (!all && !activeCamera) {
        if (studioRef.current.cameras.length >= 40) throw new Error('机位数量已达到上限，无法为导演视角创建机位')
        const director = readDirectorView(runtime)
        directorCaptureCamera = {
          id: uid(),
          name: `机位 ${studioRef.current.cameras.length + 1}`,
          position: cloneVector(director.position),
          target: cloneVector(director.target),
          rotation: studioCameraRotationFromTarget(director.position, director.target, director.roll),
          orientationMode: 'target',
          fov: director.fov,
          roll: director.roll,
          aspectRatio: studioRef.current.screenshotAspectRatio,
          visible: true,
          locked: false,
        }
      }
      const cameras = all ? targets : [activeCamera || directorCaptureCamera]
      const drafts: CanvasStudioCaptureDraft[] = []
      for (let index = 0; index < cameras.length; index += 1) {
        if (runtimeRef.current !== runtime) throw new Error('3D 场景已刷新，请重新暂存截图')
        const camera = cameras[index]
        const ratio = camera?.aspectRatio || studioRef.current.screenshotAspectRatio
        const { width, height } = captureDimensions(ratio, runtime.container.clientWidth, runtime.container.clientHeight)
        runtime.renderer.setSize(width, height, false)
        runtime.camera.aspect = width / height
        runtime.camera.updateProjectionMatrix()
        if (all && camera) applyStudioCamera(camera)
        renderStudioCameraFrame(runtime, runtime.renderer, runtime.camera)
        drafts.push({
          file: await fileFromCanvas(runtime.renderer.domElement, `${node.data.title || '3D导演台'}-${camera?.name || '导演视角'}-${index + 1}.jpg`),
          cameraId: camera?.id || null,
          cameraName: camera?.name || '导演视角',
          aspectRatio: ratio,
          width,
          height,
        })
      }
      const staged = await onStageCaptures(drafts)
      if (staged.captures.length === 0) {
        setMessage(`截图暂存失败：成功 0 张，失败 ${staged.failed} 张`)
        return
      }
      commit((current) => ({
        ...current,
        cameras: directorCaptureCamera && !current.cameras.some((camera) => camera.id === directorCaptureCamera?.id)
          ? [...current.cameras, directorCaptureCamera]
          : current.cameras,
        captures: [...staged.captures, ...current.captures].slice(0, 200),
      }))
      if (directorCaptureCamera) {
        shouldActivateDirectorCapture = true
        setActiveCameraId(directorCaptureCamera.id)
      }
      setActivePanel('cameras')
      setInspectorTab('captures')
      setSelectedId(null)
      setSceneSelection(false)
      setMessage(staged.failed > 0
        ? `截图暂存完成：成功 ${staged.captures.length} 张，失败 ${staged.failed} 张`
        : `已暂存 ${staged.captures.length} 张截图`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '截图失败')
    } finally {
      if (runtimeRef.current === runtime) {
        runtime.camera.position.copy(originalPosition)
        runtime.camera.fov = originalFov
        runtime.controls.target.copy(originalTarget)
        runtime.camera.aspect = Math.max(1, runtime.container.clientWidth) / Math.max(1, runtime.container.clientHeight)
        runtime.camera.updateProjectionMatrix()
        runtime.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        runtime.renderer.setSize(Math.max(1, runtime.container.clientWidth), Math.max(1, runtime.container.clientHeight), false)
        runtime.controls.update()
        runtime.camera.quaternion.copy(originalQuaternion)
        if (shouldActivateDirectorCapture && directorCaptureCamera) {
          viewModeRef.current = 'camera'
          setViewMode('camera')
          applyStudioCamera(directorCaptureCamera)
        }
      }
      setCapturing(false)
    }
  }

  const deleteCapture = (id: string) => {
    if (readOnly) return
    commit((current) => ({ ...current, captures: current.captures.filter((capture) => capture.id !== id) }))
  }
  const clearCaptures = () => {
    if (readOnly || studioRef.current.captures.length === 0) return
    commit((current) => ({ ...current, captures: [] }))
    setMessage('已清空全部截图')
  }
  const sendCaptureBatch = async (selected: CanvasStudioCapture[]) => {
    if (readOnly || sendingCaptures || selected.length === 0) return
    setSendingCaptures(true)
    try {
      const result = await onSendCaptures(selected)
      const sentAt = new Date().toISOString()
      const sentIds = new Set(result.sentIds)
      commit((current) => ({ ...current, captures: current.captures.map((capture) => sentIds.has(capture.id) ? { ...capture, sentAt } : capture) }))
      setMessage(result.failed > 0
        ? `发送完成：成功 ${result.created} 张，失败 ${result.failed} 张`
        : `已发送 ${result.created} 张截图到画布`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '截图发送失败')
    } finally {
      setSendingCaptures(false)
    }
  }
  const sendAllCaptures = async () => {
    await sendCaptureBatch(studioRef.current.captures)
  }

  const selected = studio.objects.find((object) => object.id === selectedId) || null
  const selectedCamera = studio.cameras.find((camera) => camera.id === activeCameraId) || null
  const selectedCameraPreviewId = selectedCamera?.id || null
  const selectedCameraAspectRatio = selectedCamera?.aspectRatio || 'auto'
  useEffect(() => {
    const container = cameraPreviewContainerRef.current
    const runtime = runtimeRef.current
    const previewDefinition = studioRef.current.cameras.find((camera) => camera.id === selectedCameraPreviewId)
    if (!container || !runtime || !ready || propertiesCollapsed || inspectorTab !== 'properties' || activePanel !== 'cameras' || !previewDefinition) return
    let renderer: import('three').WebGLRenderer
    try {
      renderer = new runtime.THREE.WebGLRenderer({ antialias: true })
    } catch {
      setMessage('实时机位预览初始化失败')
      return
    }
    renderer.outputColorSpace = runtime.THREE.SRGBColorSpace
    renderer.toneMapping = runtime.THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.domElement.className = 'nori-canvas-studio-camera-preview-webgl'
    const camera = new runtime.THREE.PerspectiveCamera(previewDefinition.fov, 16 / 9, 0.03, 500)
    const preview: StudioPreviewRuntime = { renderer, camera, cameraId: previewDefinition.id, container }
    cameraPreviewRuntimeRef.current = preview
    container.appendChild(renderer.domElement)
    const resize = () => renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (cameraPreviewRuntimeRef.current === preview) cameraPreviewRuntimeRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [activePanel, inspectorTab, propertiesCollapsed, ready, runtimeGeneration, selectedCameraPreviewId])
  const normalizedSceneQuery = sceneQuery.trim().toLocaleLowerCase('zh-CN')
  const sceneTreeEntries: Array<
    | { kind: 'object'; object: CanvasStudioObject }
    | { kind: 'crowd'; crowdId: string; label: string; members: CanvasStudioObject[]; displayedMembers: CanvasStudioObject[] }
  > = []
  const visitedCrowds = new Set<string>()
  let crowdNumber = 0
  const objectMatchesQuery = (object: CanvasStudioObject) => !normalizedSceneQuery
    || `${object.name} ${object.kind} ${object.crowdId ? '群众素体' : ''}`.toLocaleLowerCase('zh-CN').includes(normalizedSceneQuery)
  for (const object of studio.objects) {
    if (!object.crowdId) {
      if (objectMatchesQuery(object)) sceneTreeEntries.push({ kind: 'object', object })
      continue
    }
    if (visitedCrowds.has(object.crowdId)) continue
    visitedCrowds.add(object.crowdId)
    crowdNumber += 1
    const label = `群众阵列 ${crowdNumber}`
    const allMembers = studio.objects.filter((item) => item.crowdId === object.crowdId)
    const groupMatches = !normalizedSceneQuery || `${label} 群众 crowd`.toLocaleLowerCase('zh-CN').includes(normalizedSceneQuery)
    const displayedMembers = groupMatches ? allMembers : allMembers.filter(objectMatchesQuery)
    if (displayedMembers.length > 0) sceneTreeEntries.push({ kind: 'crowd', crowdId: object.crowdId, label, members: allMembers, displayedMembers })
  }
  const selectedRig = selected?.kind === 'model' ? rigReports[selected.id] : null
  const selectedRigReport = selectedRig && typeof selectedRig !== 'string' ? selectedRig : null
  const selectedRigJoints = selectedRigReport
    ? new Set(Object.keys(selectedRigReport.joints) as StudioPoseJointId[])
    : undefined
  const contextObject = contextMenu?.kind === 'object'
    ? studio.objects.find((object) => object.id === contextMenu.id) || null
    : null
  const contextCrowd = contextMenu?.kind === 'crowd'
    ? studio.objects.filter((object) => object.crowdId === contextMenu.id)
    : []
  const contextCamera = contextMenu?.kind === 'camera'
    ? studio.cameras.find((camera) => camera.id === contextMenu.id) || null
    : null
  const filteredCameras = studio.cameras.filter((camera) => !normalizedSceneQuery || `${camera.name} 摄像机 机位`.toLocaleLowerCase('zh-CN').includes(normalizedSceneQuery))
  const selectedIsCharacter = selected?.kind === 'mannequin' || selected?.kind === 'model'
  const inspectorTitle = activePanel === 'cameras' && selectedCamera
    ? '摄像机'
    : selectedIsCharacter
      ? '角色'
      : selected
        ? '场景元素'
        : '场景'
  const sceneScalePercent = Math.round(((studio.sceneScale[0] + studio.sceneScale[1] + studio.sceneScale[2]) / 3) * 100)
  const documentStatus = !studioDocumentReady && studioSaveState === 'loading'
    ? '正在读取场景文档…'
    : studioSaveState === 'saving'
      ? `正在保存 · 版本 ${studioRevision}`
      : studioSaveState === 'dirty'
        ? '有未保存的场景更改…'
        : studioSaveState === 'conflict'
          ? `保存冲突 · 服务端版本 ${studioConflict?.actualRevision ?? '?'}`
          : studioSaveState === 'error'
            ? '场景保存失败'
            : readOnly ? '只读查看 · WASD / QE 移动导演视角' : `已保存 · 版本 ${studioRevision}`
  return createPortal(
    <>
      <div
        ref={dialogRef}
        className={'nori-canvas-studio-dialog' + (fullscreen ? ' is-fullscreen' : '') + (!studioDocumentReady || studioConflict || closing ? ' is-document-blocked' : '')}
        role="dialog"
        aria-modal="true"
        aria-label="3D 导演台"
        onPointerDown={(event) => {
          event.stopPropagation()
          if (!(event.target instanceof Element) || !event.target.closest('.nori-canvas-studio-context-menu')) setContextMenu(null)
          if (!(event.target instanceof Element) || (!event.target.closest('.nori-canvas-studio-help') && !event.target.closest('.nori-canvas-studio-help-toggle'))) setHelpOpen(false)
          if (!(event.target instanceof Element) || !event.target.closest('.nori-canvas-studio-dock-shell')) {
            setDockMenu(null)
            setAddFlyout(null)
          }
        }}
      >
        <header>
          <div className="nori-canvas-studio-title">
            <strong>3D导演台</strong>
            <small className={'is-' + studioSaveState}>{ready ? documentStatus : '正在初始化 3D 场景…'}</small>
          </div>
          <div className="nori-canvas-studio-view-mode">
            <button type="button" className={viewMode === 'director' ? 'is-active' : ''} onClick={activateDirectorView}>导演视角</button>
            <button type="button" className={viewMode === 'camera' ? 'is-active' : ''} disabled={!selectedCamera} onClick={() => { if (selectedCamera) activateCamera(selectedCamera) }}>机位视角</button>
          </div>
          <div className="nori-canvas-studio-header-actions">
            <button type="button" className="nori-canvas-studio-help-toggle" title="快捷键帮助" onClick={() => setHelpOpen((value) => !value)}><CircleHelp /></button>
            <button type="button" title="退出 (Esc)" disabled={closing || capturing || sendingCaptures || uploading} onClick={() => void closeStudio()}>{closing ? <LoaderCircle className="animate-spin" /> : <X />}</button>
          </div>
        </header>

        {helpOpen ? <aside className="nori-canvas-studio-help" aria-label="3D 导演台快捷键帮助">
          <strong>快捷键与视口操作</strong>
          <dl>
            <div><dt>V / R / S</dt><dd>移动、旋转、缩放</dd></div>
            <div><dt>W / A / S / D</dt><dd>选中对象时相对视角移动物体；未选中时移动导演视角</dd></div>
            <div><dt>Q / E</dt><dd>选中对象时升降物体；未选中时升降导演视角</dd></div>
            <div><dt>选择机位</dt><dd>在左侧列表或视口点击机位，可用 Gizmo 拖动位置与旋转</dd></div>
            <div><dt>导演视角截图</dt><dd>自动创建新机位并切换到机位视角</dd></div>
            <div><dt>Esc</dt><dd>退出 3D 导演台</dd></div>
          </dl>
        </aside> : null}

        <div className={'nori-canvas-studio-layout' + (propertiesCollapsed ? ' is-properties-collapsed' : '')}>
          <aside className="nori-canvas-studio-left">
            <button type="button" className="nori-canvas-studio-panel-title" onClick={() => {
              setActivePanel('objects')
              setSelectedId(null)
              setSceneSelection(true)
              setInspectorTab('properties')
              setPropertiesCollapsed(false)
            }}>场景</button>
            <label className="nori-canvas-studio-search">
              <Search />
              <input type="search" value={sceneQuery} placeholder="请输入" aria-label="搜索场景元素" onChange={(event) => setSceneQuery(event.target.value)} />
              {sceneQuery ? <button type="button" title="清空搜索" onClick={() => setSceneQuery('')}><X /></button> : <span />}
            </label>
            <div className="nori-canvas-studio-items">
              {filteredCameras.map((camera) => <article
                key={camera.id}
                className={'is-camera' + (activePanel === 'cameras' && activeCameraId === camera.id ? ' is-active' : '')}
                onClick={() => { selectCameraForEdit(camera); setPropertiesCollapsed(false) }}
                onContextMenu={(event) => openContextMenu(event, 'camera', camera.id)}
              >
                <i><Camera /></i><span><strong>{camera.name}</strong></span>
                {!readOnly ? <>
                  <button type="button" title={camera.visible === false ? '显示' : '隐藏'} onClick={(event) => { event.stopPropagation(); updateCamera(camera.id, { visible: camera.visible === false }) }}>{camera.visible === false ? <EyeOff /> : <Eye />}</button>
                  <button type="button" title={camera.locked ? '解锁' : '锁定'} onClick={(event) => { event.stopPropagation(); updateCamera(camera.id, { locked: !camera.locked }) }}>{camera.locked ? <Lock /> : <Unlock />}</button>
                </> : null}
              </article>)}
              {sceneTreeEntries.map((entry) => {
                if (entry.kind === 'crowd') {
                  const collapsed = collapsedCrowdIds.has(entry.crowdId)
                  const allVisible = entry.members.every((object) => object.visible)
                  const allLocked = entry.members.every((object) => object.locked)
                  return <section className="nori-canvas-studio-crowd-group" key={entry.crowdId}>
                    <article
                      className={'is-crowd' + (readOnly ? ' is-readonly' : '')}
                      onContextMenu={(event) => openContextMenu(event, 'crowd', entry.crowdId)}
                      onClick={() => setCollapsedCrowdIds((current) => {
                        const next = new Set(current)
                        if (next.has(entry.crowdId)) next.delete(entry.crowdId)
                        else next.add(entry.crowdId)
                        return next
                      })}
                    >
                      <button type="button" className="is-crowd-toggle" aria-label={collapsed ? '展开群众组' : '收起群众组'}>{collapsed ? <ChevronRight /> : <ChevronDown />}</button>
                      <i><UsersRound /></i><span><strong>群众 ({crowdDimensions(entry.members)})</strong></span>
                      {!readOnly ? <>
                        <button type="button" title={allVisible ? '隐藏' : '显示'} onClick={(event) => { event.stopPropagation(); patchCrowd(entry.crowdId, { visible: !allVisible }) }}>{allVisible ? <Eye /> : <EyeOff />}</button>
                        <button type="button" title={allLocked ? '解锁' : '锁定'} onClick={(event) => { event.stopPropagation(); patchCrowd(entry.crowdId, { locked: !allLocked }) }}>{allLocked ? <Lock /> : <Unlock />}</button>
                      </> : null}
                    </article>
                    {!collapsed ? <div className="nori-canvas-studio-crowd-members">{entry.displayedMembers.map((object) => <StudioObjectTreeRow
                      key={object.id}
                      object={object}
                      selected={activePanel === 'objects' && selectedId === object.id}
                      readOnly={readOnly}
                      onSelect={() => {
                        setActivePanel('objects')
                        setInspectorTab('properties')
                        setSelectedId(object.id)
                        setSceneSelection(false)
                        setPropertyTab('attributes')
                        setActivePoseJoint(null)
                        setPropertiesCollapsed(false)
                      }}
                      onContextMenu={(event) => openContextMenu(event, 'object', object.id)}
                      onVisibility={() => updateObject(object.id, { visible: !object.visible })}
                      onLock={() => updateObject(object.id, { locked: !object.locked })}
                      onDelete={() => deleteObject(object.id)}
                    />)}</div> : null}
                  </section>
                }
                const object = entry.object
                return <StudioObjectTreeRow
                  key={object.id}
                  object={object}
                  selected={activePanel === 'objects' && selectedId === object.id}
                  readOnly={readOnly}
                  onSelect={() => {
                    setActivePanel('objects')
                    setInspectorTab('properties')
                    setSelectedId(object.id)
                    setSceneSelection(false)
                    setPropertyTab('attributes')
                    setActivePoseJoint(null)
                    setPropertiesCollapsed(false)
                  }}
                  onContextMenu={(event) => openContextMenu(event, 'object', object.id)}
                  onVisibility={() => updateObject(object.id, { visible: !object.visible })}
                  onLock={() => updateObject(object.id, { locked: !object.locked })}
                  onDelete={() => deleteObject(object.id)}
                />
              })}
              {filteredCameras.length === 0 && sceneTreeEntries.length === 0 ? <p>{sceneQuery ? '没有匹配的场景元素' : '场景中还没有对象或机位'}</p> : null}
            </div>
          </aside>

          <main className="nori-canvas-studio-stage" ref={containerRef}>
            {compositionGrid ? <div className="nori-canvas-studio-composition"><i /><i /><i /><i /></div> : null}
            <div className="nori-canvas-studio-orientation" aria-hidden="true"><i /><i /><i /><b /></div>
            <button type="button" className="nori-canvas-studio-reset-view" onClick={resetDirectorView}>重置视角</button>

            {!ready && !renderError ? <div className="nori-canvas-studio-state"><LoaderCircle className="animate-spin" />正在初始化 3D 场景…</div> : null}
            {renderError ? <div className="nori-canvas-studio-state is-error">{renderError}</div> : null}
            {!studioDocumentReady && studioSaveState === 'loading' ? <div className="nori-canvas-studio-state"><LoaderCircle className="animate-spin" />正在读取独立场景文档…</div> : null}
            {studioConflict ? <div className="nori-canvas-studio-document-alert is-conflict"><strong>检测到其他窗口保存了新版本</strong><span>{studioDocumentError || '请选择服务端版本，或将当前本地修改合并到最新版本后重试。'}</span><div><button type="button" onClick={() => void adoptServerStudioDocument()}>采用服务端</button><button type="button" className="is-primary" onClick={() => void mergeStudioDocumentAndRetry()}>合并本地并重试</button></div></div> : studioSaveState === 'error' ? <div className="nori-canvas-studio-document-alert is-error"><strong>场景文档未能保存</strong><span>{studioDocumentError || '请检查网络后重试。'}</span><button type="button" className="is-primary" onClick={retryStudioDocument}>重新尝试</button></div> : null}
            {message ? <div className="nori-canvas-studio-message">{message}</div> : null}

            <div className="nori-canvas-studio-dock-shell" onPointerDown={(event) => event.stopPropagation()}>
              {dockMenu === 'add' ? <ViewportPopover anchorRef={addMenuRef} onClose={() => setDockMenu(null)} preferredSide="above" width={260} maxHeight={440} className="nori-canvas-studio-dock-menu is-add" role="menu" aria-label="添加对象">
                <button type="button" onClick={() => modelInputRef.current?.click()}><Upload />本地上传</button>
                <button type="button" onClick={() => { setPickerType('model3d'); setDockMenu(null) }}><Box />素材库选择</button>
                {MANNEQUIN_VARIANTS.map((variant) => <button type="button" key={variant.value} onClick={() => {
                  addObject('mannequin', { mannequinVariant: variant.value, color: variant.color, name: variant.label.replace('素体', '') })
                  setDockMenu(null)
                }}><UserRound style={{ color: variant.color }} />{variant.label}</button>)}
                <div className="nori-canvas-studio-add-flyout-anchor" onMouseEnter={() => setAddFlyout('crowd')}>
                  <button type="button" onClick={() => setAddFlyout('crowd')}><UsersRound />群众<ChevronRight /></button>
                  {addFlyout === 'crowd' ? <div className="nori-canvas-studio-add-flyout is-crowd">
                    <header><strong>添加群众阵列</strong><span>共 {crowdRows * crowdColumns} 人</span></header>
                    <div className="is-crowd-grid">
                      <label><span>行数</span><input type="number" min={1} max={10} value={crowdRows} onChange={(event) => setCrowdRows(Number(event.target.value) || 1)} /></label>
                      <b>×</b>
                      <label><span>列数</span><input type="number" min={1} max={10} value={crowdColumns} onChange={(event) => setCrowdColumns(Number(event.target.value) || 1)} /></label>
                    </div>
                    <label><span>间距 (m)</span><input type="number" min={0.3} max={5} step={0.1} value={crowdSpacing} onChange={(event) => setCrowdSpacing(Number(event.target.value) || 1.15)} /></label>
                    <footer><button type="button" onClick={() => setAddFlyout(null)}>取消</button><button type="button" className="is-primary" onClick={addCrowd}>添加</button></footer>
                  </div> : null}
                </div>
                <div className="nori-canvas-studio-add-flyout-anchor" onMouseEnter={() => setAddFlyout('geometry')}>
                  <button type="button" onClick={() => setAddFlyout('geometry')}><Shapes />几何模型<ChevronRight /></button>
                  {addFlyout === 'geometry' ? <div className="nori-canvas-studio-add-flyout is-geometry">
                    {[
                      ['box', '立方体', Box],
                      ['sphere', '球体', Sphere],
                      ['cylinder', '圆柱体', Cylinder],
                      ['torus', '环状体', CircleDot],
                      ['cone', '圆锥', Triangle],
                      ['pyramid', '棱锥', Shapes],
                    ].map(([kind, label, Icon]) => <button type="button" key={String(kind)} onClick={() => { addObject(kind as StudioObjectKind); setDockMenu(null); setAddFlyout(null) }}><Icon />{String(label)}</button>)}
                  </div> : null}
                </div>
              </ViewportPopover> : null}

              {dockMenu === 'panorama' ? <ViewportPopover anchorRef={panoramaMenuRef} onClose={() => setDockMenu(null)} preferredSide="above" width={220} className="nori-canvas-studio-dock-menu is-panorama" role="menu" aria-label="720 全景">
                <button type="button" onClick={() => panoramaInputRef.current?.click()}><Upload />本地上传</button>
                <button type="button" onClick={() => { setPickerType('image'); setDockMenu(null) }}><ImageIcon />素材库选择</button>
              </ViewportPopover> : null}

              {dockMenu === 'camera' ? <ViewportPopover anchorRef={cameraMenuRef} onClose={() => setDockMenu(null)} preferredSide="above" width={330} className="nori-canvas-studio-dock-menu is-camera-presets" role="menu" aria-label="添加机位预设">
                <button type="button" className="is-current" onClick={() => { addCamera(); setDockMenu(null) }}><Camera />当前视角</button>
                {CAMERA_PRESETS.map((preset) => <button type="button" key={preset.name} onClick={() => { addCamera(preset); setDockMenu(null) }}>{preset.name}</button>)}
              </ViewportPopover> : null}

              {dockMenu === 'ratio' ? <ViewportPopover anchorRef={ratioMenuRef} onClose={() => setDockMenu(null)} preferredSide="above" width={180} className="nori-canvas-studio-dock-menu is-ratio" role="menu" aria-label="截图比例">
                {CAPTURE_RATIOS.map((ratio) => <button type="button" key={ratio} className={studio.screenshotAspectRatio === ratio ? 'is-active' : ''} onClick={() => {
                  commit((current) => ({ ...current, screenshotAspectRatio: ratio }))
                  setDockMenu(null)
                }}><span>{ratio === 'auto' ? 'Auto' : ratio}</span>{studio.screenshotAspectRatio === ratio ? <b>✓</b> : null}</button>)}
              </ViewportPopover> : null}

              <div className="nori-canvas-studio-dock">
                {!readOnly ? <>
                  <button ref={addMenuRef} type="button" title="添加对象" className={dockMenu === 'add' ? 'is-active' : ''} onClick={() => { setDockMenu((value) => value === 'add' ? null : 'add'); setAddFlyout(null) }}><UserRound /></button>
                  <button ref={panoramaMenuRef} type="button" title="720 全景" className={dockMenu === 'panorama' ? 'is-active' : ''} onClick={() => setDockMenu((value) => value === 'panorama' ? null : 'panorama')}><span className="is-720">720</span></button>
                  <button ref={cameraMenuRef} type="button" title="添加机位预设" className={dockMenu === 'camera' ? 'is-active' : ''} onClick={() => setDockMenu((value) => value === 'camera' ? null : 'camera')}><Camera /></button>
                  <button type="button" title="截图" disabled={capturing || !ready} onClick={() => void capture(false)}>{capturing ? <LoaderCircle className="animate-spin" /> : <ImageIcon />}</button>
                  <button ref={ratioMenuRef} type="button" title="截图比例" className={dockMenu === 'ratio' ? 'is-active' : ''} onClick={() => setDockMenu((value) => value === 'ratio' ? null : 'ratio')}><span className="is-aspect" /></button>
                </> : null}
                <button type="button" title={fullscreen ? '退出全屏' : '全屏'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
                {!readOnly ? <>
                  <i />
                  <button type="button" title="移动 V" className={mode === 'translate' ? 'is-active' : ''} onClick={() => setMode('translate')}><Move3D /></button>
                  <button type="button" title="旋转 R" className={mode === 'rotate' ? 'is-active' : ''} onClick={() => setMode('rotate')}><Rotate3D /></button>
                  <button type="button" title="缩放 S" className={mode === 'scale' ? 'is-active' : ''} onClick={() => setMode('scale')}><Scale3D /></button>
                </> : null}
              </div>
            </div>
          </main>

          {!propertiesCollapsed ? <aside className="nori-canvas-studio-properties">
            <div className="nori-canvas-studio-inspector-head">
              <div><strong>{inspectorTitle}</strong><button type="button" title="收起参数栏" onClick={() => setPropertiesCollapsed(true)}><X /></button></div>
              {activePanel === 'cameras' && selectedCamera ? <div className="nori-canvas-studio-inspector-tabs" role="tablist" aria-label="机位面板">
                <button type="button" role="tab" aria-selected={inspectorTab === 'properties'} className={inspectorTab === 'properties' ? 'is-active' : ''} onClick={() => setInspectorTab('properties')}>属性</button>
                <button type="button" role="tab" aria-selected={inspectorTab === 'captures'} className={inspectorTab === 'captures' ? 'is-active' : ''} onClick={() => setInspectorTab('captures')}>摄像机截图</button>
              </div> : selectedIsCharacter ? <div className="nori-canvas-studio-inspector-tabs" role="tablist" aria-label="角色面板">
                <button type="button" role="tab" aria-selected={propertyTab === 'attributes'} className={propertyTab === 'attributes' ? 'is-active' : ''} onClick={() => setPropertyTab('attributes')}>属性</button>
                <button type="button" role="tab" aria-selected={propertyTab === 'pose'} className={propertyTab === 'pose' ? 'is-active' : ''} disabled={selected?.kind === 'model' && !selectedRigReport?.poseCapable} onClick={() => setPropertyTab('pose')}>姿势</button>
              </div> : null}
            </div>

            <div className="nori-canvas-studio-inspector-scroll">
              {activePanel === 'cameras' && selectedCamera && inspectorTab === 'captures' ? <CanvasStudioCapturePanel
                captures={studio.captures}
                readOnly={readOnly}
                capturing={capturing}
                sending={sendingCaptures}
                activeCameraId={activeCameraId}
                compact
                onCaptureCurrent={() => void capture(false)}
                onCaptureAll={() => void capture(true)}
                onDelete={deleteCapture}
                onClear={clearCaptures}
                onSendAll={() => void sendAllCaptures()}
              /> : activePanel === 'cameras' && selectedCamera ? <>
                <button type="button" className="nori-canvas-studio-camera-preview" style={{ aspectRatio: selectedCameraAspectRatio === 'auto' ? '16 / 9' : selectedCameraAspectRatio.replace(':', ' / ') }} onClick={() => activateCamera(selectedCamera)}>
                  <div ref={cameraPreviewContainerRef} />
                  <span>FOV {selectedCamera.fov.toFixed(0)}°</span>
                </button>
                {!readOnly ? <button type="button" className="nori-canvas-studio-camera-action" disabled={capturing} onClick={() => void capture(false)}><Camera />当前机位截图</button> : null}
                <label><span>名称</span><input value={selectedCamera.name} disabled={readOnly} onChange={(event) => updateCamera(selectedCamera.id, { name: event.target.value })} /></label>
                <label><span>切换机位</span><select value={selectedCamera.id} onChange={(event) => {
                  const camera = studio.cameras.find((item) => item.id === event.target.value)
                  if (camera) selectCameraForEdit(camera)
                }}>{studio.cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select></label>
                <h4>位置</h4>
                <div className="is-vector">{cameraPosition(selectedCamera, studio.objects).map((value, index) => <NumberField key={index} label={['X', 'Y', 'Z'][index]} value={value} disabled={readOnly} onChange={(next) => updateCameraPositionAxis(selectedCamera, index, next)} />)}</div>
                <h4>旋转</h4>
                <div className="is-vector">{(selectedCamera.rotation || studioCameraRotationFromTarget(selectedCamera.position, selectedCamera.target, selectedCamera.roll || 0)).map((value, index) => <NumberField key={index} label={['X', 'Y', 'Z'][index]} value={value * 180 / Math.PI} disabled={readOnly} onChange={(next) => updateCameraRotationAxis(selectedCamera, index, next)} />)}</div>
                <label><span>目标模型</span><select value={selectedCamera.lookAtObjectId || ''} disabled={readOnly} onChange={(event) => {
                  const value = event.target.value
                  if (value) updateCamera(selectedCamera.id, { lookAtObjectId: value, orientationMode: 'target' })
                  else updateCamera(selectedCamera.id, {
                    lookAtObjectId: null,
                    orientationMode: 'rotation',
                    rotation: selectedCamera.rotation || studioCameraRotationFromTarget(selectedCamera.position, selectedCamera.target, selectedCamera.roll || 0),
                  })
                }}><option value="">手动（坐标/旋转）</option>{studio.objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}</select></label>
                <StudioRangeField label="视野角度 (FOV)" unit={selectedCamera.fov.toFixed(0) + '°'} value={selectedCamera.fov} min={10} max={120} disabled={readOnly} onChange={(value) => updateCamera(selectedCamera.id, { fov: value })} />
                <p>调整视野范围；数值越大画面越广，越小越聚焦。</p>
              </> : selected ? <>
                {selected.kind === 'model' ? <div className={'nori-canvas-studio-rig-status' + (selectedRigReport ? ' is-' + selectedRigReport.compatibility : selectedRig === 'error' ? ' is-error' : ' is-loading')}>
                  <strong>{selectedRig === 'loading' || !selectedRig ? '骨骼检测中' : selectedRig === 'error' ? '模型加载失败' : selectedRigReport?.compatibility === 'complete' ? '完整' : selectedRigReport?.compatibility === 'partial' ? '部分匹配' : '无骨骼'}</strong>
                  <span>{selectedRig === 'loading' || !selectedRig ? '正在检查 SkinnedMesh 与骨骼映射…' : selectedRig === 'error' ? '无法读取模型，关节微调已禁用' : selectedRigReport?.compatibility === 'complete' ? selectedRigReport.boneCount + ' 根骨骼，全部关节已映射' : selectedRigReport?.compatibility === 'partial' ? '已映射 ' + selectedRigReport.mappedJointCount + '/' + POSE_JOINTS.length + ' 个关节' : '没有发现可用的 SkinnedMesh 骨骼'}</span>
                </div> : null}
                {selectedIsCharacter && propertyTab === 'pose' ? <PoseEditor
                  object={selected}
                  availableJoints={selected.kind === 'model' ? selectedRigJoints : undefined}
                  activeJoint={activePoseJoint}
                  onFocusJoint={setActivePoseJoint}
                  disabled={readOnly}
                  onPatch={(patch) => updateObject(selected.id, patch)}
                  onJointChange={(jointId, axis, value) => updatePoseJoint(selected, jointId, axis, value)}
                /> : <>
                  <label><span>名称</span><input value={selected.name} disabled={readOnly} onChange={(event) => updateObject(selected.id, { name: event.target.value })} /></label>
                  <h4>位置</h4>
                  <div className="is-vector">{selected.position.map((value, index) => <NumberField key={index} label={['X', 'Y', 'Z'][index]} value={value} disabled={readOnly} onChange={(next) => {
                    const position = cloneVector(selected.position)
                    position[index] = next
                    updateObject(selected.id, { position })
                  }} />)}</div>
                  <h4>旋转</h4>
                  <div className="is-vector">{selected.rotation.map((value, index) => <NumberField key={index} label={['X', 'Y', 'Z'][index]} value={value * 180 / Math.PI} disabled={readOnly} onChange={(next) => {
                    const rotation = cloneVector(selected.rotation)
                    rotation[index] = next * Math.PI / 180
                    updateObject(selected.id, { rotation })
                  }} />)}</div>
                  <h4>缩放</h4>
                  <div className="is-vector">{selected.scale.map((value, index) => <NumberField key={index} label={['X', 'Y', 'Z'][index]} value={value} disabled={readOnly} onChange={(next) => {
                    const scale = cloneVector(selected.scale)
                    scale[index] = Math.max(.01, next)
                    updateObject(selected.id, { scale })
                  }} />)}</div>
                  {selectedIsCharacter ? <>
                    <StudioRangeField label="统一缩放" value={(selected.scale[0] + selected.scale[1] + selected.scale[2]) / 3} min={0.1} max={10} step={0.1} disabled={readOnly} onChange={(value) => updateObject(selected.id, { scale: [value, value, value] })} />
                    {selected.kind !== 'model' ? <>
                      <StudioRangeField label="透明度" unit={Math.round(selected.opacity * 100) + '%'} value={Math.round(selected.opacity * 100)} min={5} max={100} disabled={readOnly} onChange={(value) => updateObject(selected.id, { opacity: value / 100 })} />
                      <StudioColorField label="颜色" value={selected.color} defaultValue={MANNEQUIN_VARIANTS.find((variant) => variant.value === selected.mannequinVariant)?.color || '#4F8EF7'} disabled={readOnly} onChange={(color) => updateObject(selected.id, { color })} />
                    </> : <><label className="is-toggle"><input type="checkbox" checked={selected.snapSurface === true} disabled={readOnly} onChange={(event) => updateObject(selected.id, { snapSurface: event.target.checked })} /><span>可作为吸附目标</span></label><p>开启后可让附近素体吸附到此 GLTF 模型表面。</p></>}
                  </> : null}
                </>}
              </> : <>
                <h3>3D 场景</h3>
                <StudioRangeField label="场景缩放" unit={sceneScalePercent + '%'} value={sceneScalePercent} min={10} max={500} disabled={readOnly} onChange={(value) => commit((current) => ({ ...current, sceneScale: [value / 100, value / 100, value / 100] }))} />
                <h4>场景平移</h4>
                <div className="is-vector">{studio.scenePosition.map((value, index) => <NumberField key={index} label={['X', 'Y', 'Z'][index]} value={value} disabled={readOnly} onChange={(next) => {
                  const scenePosition = cloneVector(studio.scenePosition)
                  scenePosition[index] = next
                  commit((current) => ({ ...current, scenePosition }))
                }} />)}</div>
                <h4>场景旋转</h4>
                <div className="is-vector">{studio.sceneRotation.map((value, index) => <NumberField key={index} label={['X', 'Y', 'Z'][index]} value={value * 180 / Math.PI} disabled={readOnly} onChange={(next) => {
                  const sceneRotation = cloneVector(studio.sceneRotation)
                  sceneRotation[index] = next * Math.PI / 180
                  commit((current) => ({ ...current, sceneRotation }))
                }} />)}</div>
                <div className="nori-canvas-studio-switch">
                  <span>全景背景<small>{studio.panoramaUrl ? '已连接全景图' : '未连接全景图'}</small></span>
                  {!readOnly ? <><button type="button" onClick={() => setPickerType('image')}><ImageIcon />连接</button><button type="button" title="本地上传" onClick={() => panoramaInputRef.current?.click()}><Upload /></button></> : null}
                </div>
                {studio.panoramaUrl ? <>
                  <StudioRangeField label="水平旋转" unit={Math.round(studio.panoramaRotation * 180 / Math.PI) + '°'} value={studio.panoramaRotation} min={-Math.PI} max={Math.PI} step={0.05} disabled={readOnly} onChange={(value) => commit((current) => ({ ...current, panoramaRotation: value }))} />
                  {!readOnly ? <button type="button" className="nori-canvas-studio-remove-bg" onClick={() => commit((current) => ({ ...current, panoramaUrl: null, panoramaMaterialId: null }))}>移除全景背景</button> : null}
                </> : <p>请将图片节点连接到导演台左侧输入口，或从素材库选择 720 全景图。</p>}
                <StudioColorField label="天空颜色" value={studio.backgroundColor} defaultValue="#000000" disabled={readOnly} onChange={(backgroundColor) => commit((current) => ({ ...current, backgroundColor }))} />
                <label className="is-toggle"><input type="checkbox" checked={studio.showLabels} disabled={readOnly} onChange={(event) => commit((current) => ({ ...current, showLabels: event.target.checked }))} /><span>角色标签</span></label>
                <label className="is-toggle"><input type="checkbox" checked={studio.snapToGrid} disabled={readOnly} onChange={(event) => commit((current) => ({ ...current, snapToGrid: event.target.checked }))} /><span>网格吸附</span></label>
                <label className="is-toggle"><input type="checkbox" checked={studio.showGround} disabled={readOnly} onChange={(event) => commit((current) => ({ ...current, showGround: event.target.checked }))} /><span>地面</span></label>
                <StudioRangeField label="地面透明度" unit={Math.round(studio.groundOpacity * 100) + '%'} value={studio.groundOpacity} min={0} max={1} step={0.05} disabled={readOnly} onChange={(value) => commit((current) => ({ ...current, groundOpacity: value }))} />
                <StudioRangeField label="地面高度" unit={studio.groundHeight.toFixed(1)} value={studio.groundHeight} min={-2} max={2} step={0.1} disabled={readOnly} onChange={(value) => commit((current) => ({ ...current, groundHeight: value }))} />
              </>}
            </div>
          </aside> : null}
        </div>

        {!readOnly && contextMenu && (contextObject || contextCamera || contextCrowd.length > 0) ? <div className="nori-canvas-studio-context-menu" role="menu" aria-label="场景对象操作" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={() => setContextMenu(null)}>
          {contextCamera ? <>
            <button type="button" role="menuitem" onClick={() => updateCamera(contextCamera.id, { visible: contextCamera.visible === false })}>{contextCamera.visible === false ? <Eye /> : <EyeOff />}显示/隐藏</button>
            <button type="button" role="menuitem" onClick={() => updateCamera(contextCamera.id, { locked: !contextCamera.locked })}>{contextCamera.locked ? <Unlock /> : <Lock />}锁定/解锁</button>
            <button type="button" role="menuitem" onClick={() => duplicateCamera(contextCamera)}><Copy />创建副本</button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => deleteCamera(contextCamera.id)}><Trash2 />删除</button>
          </> : contextObject ? <>
            <button type="button" role="menuitem" onClick={() => updateObject(contextObject.id, { visible: !contextObject.visible })}>{contextObject.visible ? <EyeOff /> : <Eye />}显示/隐藏</button>
            <button type="button" role="menuitem" onClick={() => updateObject(contextObject.id, { locked: !contextObject.locked })}>{contextObject.locked ? <Unlock /> : <Lock />}锁定/解锁</button>
            <button type="button" role="menuitem" onClick={() => duplicateObject(contextObject)}><Copy />创建副本</button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => deleteObject(contextObject.id)}><Trash2 />删除</button>
          </> : <>
            <button type="button" role="menuitem" onClick={() => patchCrowd(contextMenu.id, { visible: !contextCrowd.every((object) => object.visible) })}><EyeOff />显示/隐藏</button>
            <button type="button" role="menuitem" onClick={() => patchCrowd(contextMenu.id, { locked: !contextCrowd.every((object) => object.locked) })}><Lock />锁定/解锁</button>
            <button type="button" role="menuitem" onClick={() => duplicateCrowd(contextMenu.id)}><Copy />创建副本</button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => deleteCrowd(contextMenu.id)}><Trash2 />删除</button>
          </>}
        </div> : null}

        {!readOnly ? <>
          <input ref={modelInputRef} type="file" accept=".glb,model/gltf-binary" title="仅支持自包含 GLB 2.0" hidden onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file, 'model3d')
          }} />
          <input ref={panoramaInputRef} type="file" accept="image/*" hidden onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file, 'image')
          }} />
        </> : null}
      </div>

      {!readOnly && pickerType ? <div className="nori-canvas-studio-picker-shell"><MaterialPickerDialog
        projectId={projectId}
        uploadEndpoint={'/api/projects/' + projectId + '/canvas/' + canvasId + '/materials'}
        type={pickerType}
        title={pickerType === 'model3d' ? '选择 3D 模型' : '选择 720 全景图'}
        maxSelected={1}
        onSelect={addMaterial}
        onClose={() => setPickerType(null)}
      /></div> : null}
    </>,
    document.body,
  )
}
