import { describe, expect, it } from 'vitest'
import {
  analyzeStudioRigBoneNames,
  DEFAULT_STUDIO_SCENE,
  normalizeCanvasStudioScene,
  normalizeCanvasStudioSummary,
  studioCameraRotationFromTarget,
  studioCameraTargetFromRotation,
  summarizeCanvasStudioScene,
} from '@/features/canvas/studio-types'

describe('canvas 3D studio scene normalization', () => {
  it('migrates legacy scene data and supplies version 3 defaults', () => {
    const scene = normalizeCanvasStudioScene({
      version: 1,
      backgroundColor: '#020617',
      objects: [{
        id: 'legacy-model',
        name: '旧模型',
        kind: 'model',
        modelUrl: '/models/legacy.glb',
        position: [1, 2, 3],
      }],
      cameras: [{ id: 'legacy-camera', name: '旧机位', position: [0, 3, 8] }],
    })

    expect(scene.version).toBe(3)
    expect(scene).toMatchObject({
      backgroundColor: '#020617',
      groundOpacity: DEFAULT_STUDIO_SCENE.groundOpacity,
      groundHeight: 0,
      screenshotAspectRatio: 'auto',
      showLabels: true,
      snapToGrid: false,
      panoramaRadius: 80,
      scenePosition: [0, 0, 0],
      sceneRotation: [0, 0, 0],
      sceneScale: [1, 1, 1],
      directorCamera: DEFAULT_STUDIO_SCENE.directorCamera,
      captures: [],
    })
    expect(scene.objects[0]).toMatchObject({
      id: 'legacy-model',
      position: [1, 2, 3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      opacity: 1,
      visible: true,
      locked: false,
    })
    expect(scene.cameras[0]).toMatchObject({
      id: 'legacy-camera',
      target: [0, 1, 0],
      fov: 45,
      aspectRatio: 'auto',
      roll: 0,
      followObjectId: null,
      lookAtObjectId: null,
    })
  })

  it('persists safe scene transforms, panorama radius and staged captures', () => {
    const scene = normalizeCanvasStudioScene({
      panoramaRadius: 999,
      scenePosition: [2, -1, 4],
      sceneRotation: [0, Math.PI / 2, 0],
      sceneScale: [0, 2, 999],
      captures: [{
        id: 'capture-1',
        title: '正面机位',
        url: '/media/capture.jpg',
        materialId: 'material-1',
        cameraId: 'camera-1',
        cameraName: '正面中景',
        aspectRatio: '16:9',
        width: 99999,
        height: -1,
        createdAt: '2026-07-17T01:02:03.000Z',
        sentAt: '2026-07-17T01:03:00.000Z',
      }, {
        id: 'invalid-capture',
        url: '',
        materialId: '',
      }],
    })

    expect(scene).toMatchObject({
      panoramaRadius: 400,
      scenePosition: [2, -1, 4],
      sceneRotation: [0, Math.PI / 2, 0],
      sceneScale: [0.05, 2, 100],
    })
    expect(scene.captures).toEqual([expect.objectContaining({
      id: 'capture-1',
      materialId: 'material-1',
      cameraId: 'camera-1',
      aspectRatio: '16:9',
      width: 8192,
      height: 1,
      sentAt: '2026-07-17T01:03:00.000Z',
    })])
  })

  it('keeps mannequin pose, crowd and camera tracking fields within safe bounds', () => {
    const scene = normalizeCanvasStudioScene({
      objects: [{
        id: 'actor-1',
        name: '演员',
        kind: 'mannequin',
        mannequinVariant: 'chibi',
        posePreset: 'run',
        poseAdjustments: { head: [15, -8, 4] },
        crowdId: 'crowd-a',
        scale: [0, 500, 1],
        opacity: -2,
      }],
      cameras: [{
        id: 'camera-1',
        fov: 999,
        roll: -999,
        lookAtObjectId: 'actor-1',
        followObjectId: 'actor-1',
        followOffset: [2, 1, -4],
        aspectRatio: '9:16',
      }],
      groundOpacity: 4,
      groundHeight: -99,
      screenshotAspectRatio: '21:9',
    })

    expect(scene.objects[0]).toMatchObject({
      mannequinVariant: 'chibi',
      posePreset: 'run',
      poseAdjustments: { head: [15, -8, 4] },
      crowdId: 'crowd-a',
      scale: [0.01, 100, 1],
      opacity: 0.05,
    })
    expect(scene.cameras[0]).toMatchObject({
      fov: 120,
      roll: -180,
      lookAtObjectId: 'actor-1',
      followObjectId: 'actor-1',
      followOffset: [2, 1, -4],
      aspectRatio: '9:16',
      orientationMode: 'target',
    })
    expect(scene).toMatchObject({ groundOpacity: 1, groundHeight: -10, screenshotAspectRatio: '21:9' })
  })

  it('keeps pose edits for rigged GLTF models in the persisted scene', () => {
    const scene = normalizeCanvasStudioScene({
      objects: [{
        id: 'rigged-model',
        kind: 'model',
        modelUrl: '/models/actor.glb',
        posePreset: 'wave',
        poseAdjustments: { head: [4, -12, 2], leftArm: [20, 0, 5] },
        snapSurface: true,
      }],
    })

    expect(scene.objects[0]).toMatchObject({
      posePreset: 'wave',
      poseAdjustments: { head: [4, -12, 2], leftArm: [20, 0, 5] },
      snapSurface: true,
    })
  })

  it('projects oversized independent documents to a bounded node summary', () => {
    const largeScene = {
      ...DEFAULT_STUDIO_SCENE,
      panoramaUrl: '/panorama.jpg',
      objects: Array.from({ length: 200 }, (_, index) => ({
        id: `model-${index}`,
        name: `模型 ${index}`,
        kind: 'model',
        modelUrl: `/models/${'x'.repeat(8_000)}-${index}.glb`,
        position: [index, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#94a3b8',
        opacity: 1,
        visible: true,
        locked: false,
      })),
      cameras: Array.from({ length: 40 }, (_, index) => ({ id: `camera-${index}`, name: `机位 ${index}`, position: [0, 2, 6], target: [0, 1, 0], fov: 45 })),
      captures: Array.from({ length: 200 }, (_, index) => ({ id: `capture-${index}`, title: `截图 ${index}`, url: `/capture-${index}.jpg`, materialId: `material-${index}`, cameraId: null, cameraName: '导演视角', aspectRatio: '16:9', width: 1600, height: 900, createdAt: '2026-07-17T00:00:00.000Z', sentAt: null })),
    }

    expect(JSON.stringify(largeScene).length).toBeGreaterThan(512 * 1024)
    const summary = summarizeCanvasStudioScene(largeScene)
    expect(summary).toEqual({ version: 1, objectCount: 200, cameraCount: 40, captureCount: 200, hasPanorama: true })
    expect(JSON.stringify(summary).length).toBeLessThan(256)
    expect(JSON.stringify(summary)).not.toContain('modelUrl')
  })

  it('reads a lightweight summary and falls back to a legacy embedded scene', () => {
    expect(normalizeCanvasStudioSummary({ version: 1, objectCount: 3, cameraCount: 2, captureCount: 1, hasPanorama: true })).toEqual({
      version: 1,
      objectCount: 3,
      cameraCount: 2,
      captureCount: 1,
      hasPanorama: true,
    })
    expect(normalizeCanvasStudioSummary(null, { objects: [{ id: 'box-1', kind: 'box' }] })).toMatchObject({ objectCount: 1, cameraCount: 0, captureCount: 0 })
  })

  it('persists the director camera and links manual camera rotation to its target', () => {
    const rotation = studioCameraRotationFromTarget([0, 2, 6], [0, 1, 0], 12)
    const target = studioCameraTargetFromRotation([0, 2, 6], rotation, Math.hypot(0, -1, -6))
    const scene = normalizeCanvasStudioScene({
      directorCamera: { position: [9, 4, 7], target: [1, 1, 0], fov: 52, roll: 8 },
      cameras: [{ id: 'camera-1', position: [0, 2, 6], target, rotation, orientationMode: 'rotation', fov: 45, roll: 12 }],
    })

    expect(scene.directorCamera).toEqual({ position: [9, 4, 7], target: [1, 1, 0], fov: 52, roll: 8 })
    expect(scene.cameras[0]).toMatchObject({ orientationMode: 'rotation', rotation })
    expect(target[0]).toBeCloseTo(0, 5)
    expect(target[1]).toBeCloseTo(1, 5)
    expect(target[2]).toBeCloseTo(0, 5)
  })

  it('derives a missing manual-camera roll from its persisted rotation', () => {
    const scene = normalizeCanvasStudioScene({
      cameras: [{
        id: 'camera-roll',
        position: [0, 2, 6],
        target: [0, 1, 0],
        rotation: [0.1, -0.2, Math.PI / 6],
        orientationMode: 'rotation',
        fov: 45,
      }],
    })

    expect(scene.cameras[0].roll).toBeCloseTo(30, 5)
    expect(scene.cameras[0].rotation?.[2]).toBeCloseTo(Math.PI / 6, 5)
  })
})

describe('canvas 3D studio GLTF rig analysis', () => {
  const completeMixamoRig = [
    'mixamorigHips',
    'mixamorigSpine2',
    'mixamorigHead',
    'mixamorigLeftArm',
    'mixamorigRightArm',
    'mixamorigLeftForeArm',
    'mixamorigRightForeArm',
    'mixamorigLeftUpLeg',
    'mixamorigRightUpLeg',
    'mixamorigLeftLeg',
    'mixamorigRightLeg',
  ]

  it('recognizes a complete skinned humanoid and enables real pose controls', () => {
    const report = analyzeStudioRigBoneNames(completeMixamoRig, 1)

    expect(report.compatibility).toBe('complete')
    expect(report.poseCapable).toBe(true)
    expect(report.mappedJointCount).toBe(11)
    expect(report.joints).toMatchObject({
      body: 'mixamorigHips',
      head: 'mixamorigHead',
      leftArm: 'mixamorigLeftArm',
      rightKnee: 'mixamorigRightLeg',
    })
  })

  it('distinguishes usable partial rigs from models without a SkinnedMesh', () => {
    const partial = analyzeStudioRigBoneNames([
      'Pelvis',
      'Spine',
      'Head',
      'LeftUpperArm',
      'RightUpperArm',
      'LeftThigh',
      'RightThigh',
    ], 1)
    const noSkin = analyzeStudioRigBoneNames(completeMixamoRig, 0)

    expect(partial).toMatchObject({ compatibility: 'partial', poseCapable: true })
    expect(noSkin).toMatchObject({ compatibility: 'none', poseCapable: false, mappedJointCount: 0 })
  })

  it('keeps an incomplete bone list disabled when the central chain is missing', () => {
    const report = analyzeStudioRigBoneNames(['Head', 'LeftUpperArm', 'RightUpperArm', 'LeftThigh', 'RightThigh'], 1)

    expect(report).toMatchObject({ compatibility: 'partial', poseCapable: false })
  })
})
