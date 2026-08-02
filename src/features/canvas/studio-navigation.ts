import type { StudioVector3 } from './studio-types'

export type StudioDirectorView = {
  position: StudioVector3
  target: StudioVector3
  fov: number
  roll: number
}

export type StudioNavigationKey = 'w' | 'a' | 's' | 'd' | 'q' | 'e'

function normalizeHorizontal(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z)
  return length > 0.0001 ? [x / length, z / length] : [0, -1]
}

function navigationDelta(view: StudioDirectorView, key: StudioNavigationKey, distance: number): StudioVector3 {
  const [forwardX, forwardZ] = normalizeHorizontal(
    view.target[0] - view.position[0],
    view.target[2] - view.position[2],
  )
  const rightX = -forwardZ
  const rightZ = forwardX
  return key === 'w'
    ? [forwardX * distance, 0, forwardZ * distance]
    : key === 's'
      ? [-forwardX * distance, 0, -forwardZ * distance]
      : key === 'a'
        ? [-rightX * distance, 0, -rightZ * distance]
        : key === 'd'
          ? [rightX * distance, 0, rightZ * distance]
          : key === 'q'
            ? [0, -distance, 0]
            : [0, distance, 0]
}

/** Move a selected scene element in the horizontal plane of the current view. */
export function moveStudioPositionRelativeToView(
  position: StudioVector3,
  view: StudioDirectorView,
  key: StudioNavigationKey,
  distance = 0.2,
): StudioVector3 {
  const delta = navigationDelta(view, key, distance)
  return [position[0] + delta[0], position[1] + delta[1], position[2] + delta[2]]
}

/**
 * Move the director camera and its orbit target together, so keyboard navigation
 * never changes the current viewing direction. W/S follow the camera heading,
 * A/D strafe, while Q/E move vertically.
 */
export function moveStudioDirectorView(
  view: StudioDirectorView,
  key: StudioNavigationKey,
  distance = 0.35,
): StudioDirectorView {
  const delta = navigationDelta(view, key, distance)

  const move = (vector: StudioVector3): StudioVector3 => [
    vector[0] + delta[0],
    vector[1] + delta[1],
    vector[2] + delta[2],
  ]
  return { ...view, position: move(view.position), target: move(view.target) }
}
