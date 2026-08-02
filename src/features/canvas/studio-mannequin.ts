import type {
  CanvasStudioObject,
  StudioMannequinVariant,
  StudioPoseJointId,
  StudioVector3,
} from './studio-types'

export type StudioMannequinProfile = {
  pelvis: StudioVector3
  torsoHeight: number
  shoulderWidth: number
  chestWidth: number
  waistWidth: number
  torsoDepth: number
  shoulderDrop: number
  legSpacing: number
  upperArmLength: number
  lowerArmLength: number
  armRadius: number
  forearmRadius: number
  upperLegLength: number
  lowerLegLength: number
  thighRadius: number
  calfRadius: number
  neckLength: number
  neckRadius: number
  headRadius: number
  headScale: StudioVector3
  handRadius: number
  foot: StudioVector3
}

export const STUDIO_MANNEQUIN_PROFILES: Record<StudioMannequinVariant, StudioMannequinProfile> = {
  male: {
    pelvis: [0.50, 0.26, 0.31], torsoHeight: 0.60, shoulderWidth: 0.76,
    chestWidth: 0.68, waistWidth: 0.52, torsoDepth: 0.34, shoulderDrop: 0.08,
    legSpacing: 0.25, upperArmLength: 0.43, lowerArmLength: 0.39,
    armRadius: 0.10, forearmRadius: 0.085, upperLegLength: 0.47,
    lowerLegLength: 0.44, thighRadius: 0.135, calfRadius: 0.105,
    neckLength: 0.08, neckRadius: 0.09, headRadius: 0.20,
    headScale: [0.90, 1.10, 0.98], handRadius: 0.09, foot: [0.18, 0.09, 0.34],
  },
  female: {
    pelvis: [0.58, 0.25, 0.32], torsoHeight: 0.56, shoulderWidth: 0.68,
    chestWidth: 0.58, waistWidth: 0.42, torsoDepth: 0.30, shoulderDrop: 0.075,
    legSpacing: 0.26, upperArmLength: 0.41, lowerArmLength: 0.38,
    armRadius: 0.082, forearmRadius: 0.07, upperLegLength: 0.45,
    lowerLegLength: 0.43, thighRadius: 0.125, calfRadius: 0.095,
    neckLength: 0.09, neckRadius: 0.075, headRadius: 0.19,
    headScale: [0.88, 1.12, 0.96], handRadius: 0.082, foot: [0.16, 0.085, 0.30],
  },
  broad: {
    pelvis: [0.64, 0.30, 0.38], torsoHeight: 0.62, shoulderWidth: 0.94,
    chestWidth: 0.84, waistWidth: 0.68, torsoDepth: 0.42, shoulderDrop: 0.09,
    legSpacing: 0.31, upperArmLength: 0.45, lowerArmLength: 0.41,
    armRadius: 0.14, forearmRadius: 0.115, upperLegLength: 0.48,
    lowerLegLength: 0.45, thighRadius: 0.17, calfRadius: 0.13,
    neckLength: 0.075, neckRadius: 0.12, headRadius: 0.215,
    headScale: [1.0, 1.04, 1.04], handRadius: 0.105, foot: [0.22, 0.10, 0.37],
  },
  athletic: {
    pelvis: [0.52, 0.27, 0.34], torsoHeight: 0.64, shoulderWidth: 0.86,
    chestWidth: 0.76, waistWidth: 0.50, torsoDepth: 0.36, shoulderDrop: 0.075,
    legSpacing: 0.26, upperArmLength: 0.45, lowerArmLength: 0.42,
    armRadius: 0.12, forearmRadius: 0.095, upperLegLength: 0.50,
    lowerLegLength: 0.47, thighRadius: 0.15, calfRadius: 0.115,
    neckLength: 0.09, neckRadius: 0.10, headRadius: 0.20,
    headScale: [0.92, 1.08, 0.98], handRadius: 0.095, foot: [0.20, 0.09, 0.35],
  },
  slim: {
    pelvis: [0.42, 0.22, 0.27], torsoHeight: 0.63, shoulderWidth: 0.64,
    chestWidth: 0.54, waistWidth: 0.39, torsoDepth: 0.26, shoulderDrop: 0.07,
    legSpacing: 0.21, upperArmLength: 0.45, lowerArmLength: 0.42,
    armRadius: 0.075, forearmRadius: 0.06, upperLegLength: 0.51,
    lowerLegLength: 0.48, thighRadius: 0.105, calfRadius: 0.08,
    neckLength: 0.095, neckRadius: 0.07, headRadius: 0.185,
    headScale: [0.86, 1.13, 0.92], handRadius: 0.075, foot: [0.15, 0.08, 0.29],
  },
  teen: {
    pelvis: [0.44, 0.22, 0.28], torsoHeight: 0.51, shoulderWidth: 0.60,
    chestWidth: 0.52, waistWidth: 0.42, torsoDepth: 0.28, shoulderDrop: 0.065,
    legSpacing: 0.22, upperArmLength: 0.38, lowerArmLength: 0.35,
    armRadius: 0.078, forearmRadius: 0.064, upperLegLength: 0.40,
    lowerLegLength: 0.39, thighRadius: 0.105, calfRadius: 0.085,
    neckLength: 0.065, neckRadius: 0.07, headRadius: 0.19,
    headScale: [0.92, 1.08, 0.98], handRadius: 0.075, foot: [0.15, 0.075, 0.27],
  },
  child: {
    pelvis: [0.40, 0.22, 0.27], torsoHeight: 0.39, shoulderWidth: 0.48,
    chestWidth: 0.43, waistWidth: 0.36, torsoDepth: 0.25, shoulderDrop: 0.055,
    legSpacing: 0.20, upperArmLength: 0.29, lowerArmLength: 0.27,
    armRadius: 0.07, forearmRadius: 0.058, upperLegLength: 0.29,
    lowerLegLength: 0.28, thighRadius: 0.09, calfRadius: 0.07,
    neckLength: 0.055, neckRadius: 0.062, headRadius: 0.21,
    headScale: [0.96, 1.05, 1.0], handRadius: 0.07, foot: [0.14, 0.07, 0.24],
  },
  chibi: {
    pelvis: [0.42, 0.24, 0.30], torsoHeight: 0.26, shoulderWidth: 0.48,
    chestWidth: 0.44, waistWidth: 0.38, torsoDepth: 0.28, shoulderDrop: 0.045,
    legSpacing: 0.20, upperArmLength: 0.18, lowerArmLength: 0.16,
    armRadius: 0.07, forearmRadius: 0.058, upperLegLength: 0.15,
    lowerLegLength: 0.13, thighRadius: 0.085, calfRadius: 0.07,
    neckLength: 0.03, neckRadius: 0.07, headRadius: 0.30,
    headScale: [1.0, 1.0, 1.02], handRadius: 0.075, foot: [0.15, 0.07, 0.24],
  },
}

export function studioMannequinProfile(variant: StudioMannequinVariant | undefined) {
  return STUDIO_MANNEQUIN_PROFILES[variant || 'male']
}

function mannequinRootHeight(profile: StudioMannequinProfile) {
  const legJointDrop = profile.pelvis[1] * 0.10
  return legJointDrop + profile.upperLegLength + profile.lowerLegLength + profile.foot[1]
}

export function studioMannequinVisualHeight(variant: StudioMannequinVariant | undefined) {
  const profile = studioMannequinProfile(variant)
  const torsoOffset = profile.pelvis[1] * 0.18
  const headHalfHeight = profile.headRadius * profile.headScale[1]
  return mannequinRootHeight(profile) + torsoOffset + profile.torsoHeight
    + profile.neckLength + headHalfHeight * 1.92
}

export function createStudioMannequin(
  THREE: typeof import('three'),
  object: CanvasStudioObject,
) {
  const profile = studioMannequinProfile(object.mannequinVariant)
  const root = new THREE.Group()
  root.name = 'pose:body'
  root.position.y = mannequinRootHeight(profile)

  const material = new THREE.MeshStandardMaterial({
    color: object.color,
    transparent: object.opacity < 1,
    opacity: object.opacity,
    roughness: 0.62,
    metalness: 0.025,
  })
  const addMesh = (
    parent: import('three').Object3D,
    geometry: import('three').BufferGeometry,
    position: StudioVector3,
    scale: StudioVector3 = [1, 1, 1],
    tone = 1,
  ) => {
    const mesh = new THREE.Mesh(geometry, material.clone())
    mesh.position.set(...position)
    mesh.scale.set(...scale)
    mesh.userData.studioColorTone = tone
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const joint = (name: StudioPoseJointId, parent: import('three').Object3D, position: StudioVector3) => {
    const group = new THREE.Group()
    group.name = `pose:${name}`
    group.position.set(...position)
    parent.add(group)
    return group
  }
  const taperedLimb = (topRadius: number, bottomRadius: number, length: number) => (
    new THREE.CylinderGeometry(topRadius, bottomRadius, length, 18)
  )
  const jointBall = (radius: number) => new THREE.SphereGeometry(radius, 16, 10)

  addMesh(root, new THREE.SphereGeometry(0.5, 24, 16), [0, -profile.pelvis[1] * 0.03, 0], profile.pelvis, 0.94)
  const torsoOffset = profile.pelvis[1] * 0.18
  const torso = joint('torso', root, [0, torsoOffset, 0])
  const torsoDepthScale = profile.torsoDepth / Math.max(profile.chestWidth, profile.waistWidth)
  addMesh(
    torso,
    new THREE.CylinderGeometry(profile.chestWidth / 2, profile.waistWidth / 2, profile.torsoHeight, 24),
    [0, profile.torsoHeight / 2, 0],
    [1, 1, torsoDepthScale],
  )
  addMesh(
    torso,
    new THREE.SphereGeometry(0.5, 20, 12),
    [0, profile.torsoHeight - profile.shoulderDrop, 0],
    [profile.shoulderWidth, profile.armRadius * 1.82, profile.torsoDepth],
    0.97,
  )
  addMesh(
    torso,
    new THREE.CylinderGeometry(profile.neckRadius, profile.neckRadius * 1.04, profile.neckLength, 16),
    [0, profile.torsoHeight + profile.neckLength / 2, 0],
    [1, 1, 0.96],
    0.96,
  )

  const head = joint('head', torso, [0, profile.torsoHeight + profile.neckLength, 0])
  const headHalfHeight = profile.headRadius * profile.headScale[1]
  const headCenterY = headHalfHeight * 0.92
  addMesh(
    head,
    new THREE.SphereGeometry(profile.headRadius, 28, 20),
    [0, headCenterY, 0],
    profile.headScale,
  )
  const nose = addMesh(
    head,
    new THREE.ConeGeometry(profile.headRadius * 0.15, profile.headRadius * 0.28, 12),
    [0, headCenterY * 1.02, profile.headRadius * profile.headScale[2] * 0.98],
    [1, 1, 0.9],
    0.90,
  )
  nose.rotation.x = Math.PI / 2

  const makeArm = (side: 'left' | 'right') => {
    const direction = side === 'left' ? -1 : 1
    const shoulderY = profile.torsoHeight - profile.shoulderDrop
    const upper = joint(side === 'left' ? 'leftArm' : 'rightArm', torso, [direction * profile.shoulderWidth / 2, shoulderY, 0])
    addMesh(upper, jointBall(profile.armRadius * 1.04), [0, 0, 0], [1, 0.9, 1], 0.95)
    addMesh(
      upper,
      taperedLimb(profile.armRadius, profile.forearmRadius * 0.94, profile.upperArmLength),
      [0, -profile.upperArmLength / 2, 0],
    )
    const elbow = joint(side === 'left' ? 'leftElbow' : 'rightElbow', upper, [0, -profile.upperArmLength, 0])
    addMesh(upper, jointBall(profile.forearmRadius * 1.02), [0, -profile.upperArmLength, 0], [1, 0.86, 1], 0.94)
    addMesh(
      elbow,
      taperedLimb(profile.forearmRadius, profile.forearmRadius * 0.72, profile.lowerArmLength),
      [0, -profile.lowerArmLength / 2, 0],
      [1, 1, 0.96],
    )
    addMesh(
      elbow,
      new THREE.SphereGeometry(profile.handRadius, 16, 10),
      [0, -profile.lowerArmLength, profile.handRadius * 0.12],
      [0.86, 1.16, 0.72],
      0.92,
    )
  }
  makeArm('left')
  makeArm('right')

  const legJointY = -profile.pelvis[1] * 0.10
  const makeLeg = (side: 'left' | 'right') => {
    const direction = side === 'left' ? -1 : 1
    const upper = joint(side === 'left' ? 'leftLeg' : 'rightLeg', root, [direction * profile.legSpacing / 2, legJointY, 0])
    addMesh(upper, jointBall(profile.thighRadius * 1.02), [0, 0, 0], [1, 0.78, 1], 0.94)
    addMesh(
      upper,
      taperedLimb(profile.thighRadius, profile.calfRadius * 1.03, profile.upperLegLength),
      [0, -profile.upperLegLength / 2, 0],
    )
    const knee = joint(side === 'left' ? 'leftKnee' : 'rightKnee', upper, [0, -profile.upperLegLength, 0])
    addMesh(upper, jointBall(profile.calfRadius * 1.06), [0, -profile.upperLegLength, 0], [1, 0.82, 1], 0.93)
    addMesh(
      knee,
      taperedLimb(profile.calfRadius, profile.calfRadius * 0.70, profile.lowerLegLength),
      [0, -profile.lowerLegLength / 2, 0],
      [1, 1, 0.96],
    )
    addMesh(
      knee,
      new THREE.BoxGeometry(...profile.foot),
      [0, -profile.lowerLegLength - profile.foot[1] / 2, profile.foot[2] * 0.22],
      [1, 1, 1],
      0.88,
    )
  }
  makeLeg('left')
  makeLeg('right')

  material.dispose()
  return root
}
