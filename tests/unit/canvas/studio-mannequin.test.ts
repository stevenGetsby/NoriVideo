import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createStudioMannequin,
  STUDIO_MANNEQUIN_PROFILES,
  studioMannequinVisualHeight,
} from '@/features/canvas/studio-mannequin'
import type { CanvasStudioObject, StudioMannequinVariant, StudioPoseJointId } from '@/features/canvas/studio-types'

const variants = Object.keys(STUDIO_MANNEQUIN_PROFILES) as StudioMannequinVariant[]
const joints: StudioPoseJointId[] = [
  'body', 'torso', 'head', 'leftArm', 'rightArm', 'leftElbow',
  'rightElbow', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee',
]

function mannequin(variant: StudioMannequinVariant) {
  const object: CanvasStudioObject = {
    id: variant,
    name: variant,
    kind: 'mannequin',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#4f8ef7',
    opacity: 1,
    visible: true,
    locked: false,
    mannequinVariant: variant,
  }
  return createStudioMannequin(THREE, object)
}

function dispose(root: THREE.Object3D) {
  root.traverse((item) => {
    const mesh = item as THREE.Mesh
    mesh.geometry?.dispose()
    if (!mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => material.dispose())
  })
}

describe('studio mannequin assets', () => {
  it('gives every asset an independently articulated, ground-anchored body', () => {
    for (const variant of variants) {
      const root = mannequin(variant)
      root.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(root)

      expect(root.name).toBe('pose:body')
      for (const joint of joints) expect(root.getObjectByName(`pose:${joint}`)).toBeTruthy()
      expect(bounds.min.y).toBeCloseTo(0, 4)
      expect(bounds.max.y).toBeCloseTo(studioMannequinVisualHeight(variant), 2)
      expect(Number.isFinite(bounds.max.x - bounds.min.x)).toBe(true)
      dispose(root)
    }
  })

  it('preserves visibly different silhouettes and age proportions', () => {
    expect(STUDIO_MANNEQUIN_PROFILES.broad.shoulderWidth).toBeGreaterThan(STUDIO_MANNEQUIN_PROFILES.male.shoulderWidth)
    expect(STUDIO_MANNEQUIN_PROFILES.female.pelvis[0]).toBeGreaterThan(STUDIO_MANNEQUIN_PROFILES.male.pelvis[0])
    expect(STUDIO_MANNEQUIN_PROFILES.athletic.chestWidth / STUDIO_MANNEQUIN_PROFILES.athletic.waistWidth).toBeGreaterThan(1.45)
    expect(STUDIO_MANNEQUIN_PROFILES.slim.armRadius).toBeLessThan(STUDIO_MANNEQUIN_PROFILES.male.armRadius)
    expect(STUDIO_MANNEQUIN_PROFILES.teen.upperLegLength).toBeLessThan(STUDIO_MANNEQUIN_PROFILES.male.upperLegLength)
    expect(studioMannequinVisualHeight('child')).toBeLessThan(studioMannequinVisualHeight('teen'))
    expect(studioMannequinVisualHeight('chibi')).toBeLessThan(studioMannequinVisualHeight('child'))
    expect(STUDIO_MANNEQUIN_PROFILES.chibi.headRadius).toBeGreaterThan(STUDIO_MANNEQUIN_PROFILES.child.headRadius)
  })

  it('makes the broad and slim meshes measurably different in the rendered geometry', () => {
    const broad = mannequin('broad')
    const slim = mannequin('slim')
    broad.updateMatrixWorld(true)
    slim.updateMatrixWorld(true)
    const broadSize = new THREE.Box3().setFromObject(broad).getSize(new THREE.Vector3())
    const slimSize = new THREE.Box3().setFromObject(slim).getSize(new THREE.Vector3())

    expect(broadSize.x).toBeGreaterThan(slimSize.x * 1.35)
    expect(slimSize.y).toBeGreaterThan(2)
    dispose(broad)
    dispose(slim)
  })

  it('uses tapered limbs and restrained joints instead of capsule-like toy proportions', () => {
    const root = mannequin('male')
    const taperedCylinders: THREE.CylinderGeometry[] = []
    const capsules: THREE.BufferGeometry[] = []
    root.traverse((item) => {
      const geometry = (item as THREE.Mesh).geometry
      if (!geometry) return
      if (geometry.type === 'CapsuleGeometry') capsules.push(geometry)
      if (geometry.type === 'CylinderGeometry') {
        const cylinder = geometry as THREE.CylinderGeometry
        if (cylinder.parameters.radiusTop !== cylinder.parameters.radiusBottom) taperedCylinders.push(cylinder)
      }
    })

    expect(capsules).toHaveLength(0)
    expect(taperedCylinders.length).toBeGreaterThanOrEqual(8)
    dispose(root)
  })
})
