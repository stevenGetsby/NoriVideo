import { describe, expect, it } from 'vitest'
import { moveStudioDirectorView, moveStudioPositionRelativeToView, type StudioDirectorView } from '@/features/canvas/studio-navigation'

const view: StudioDirectorView = {
  position: [0, 2, 10],
  target: [0, 1, 0],
  fov: 48,
  roll: 0,
}

describe('3D studio director keyboard navigation', () => {
  it('moves camera and orbit target together without changing viewing direction', () => {
    const moved = moveStudioDirectorView(view, 'w', 2)

    expect(moved.position).toEqual([0, 2, 8])
    expect(moved.target).toEqual([0, 1, -2])
    expect([
      moved.target[0] - moved.position[0],
      moved.target[1] - moved.position[1],
      moved.target[2] - moved.position[2],
    ]).toEqual([
      view.target[0] - view.position[0],
      view.target[1] - view.position[1],
      view.target[2] - view.position[2],
    ])
  })

  it('supports backward, strafe and vertical movement relative to camera heading', () => {
    expect(moveStudioDirectorView(view, 's', 1).position).toEqual([0, 2, 11])
    expect(moveStudioDirectorView(view, 'a', 1).position).toEqual([-1, 2, 10])
    expect(moveStudioDirectorView(view, 'd', 1).position).toEqual([1, 2, 10])
    expect(moveStudioDirectorView(view, 'q', 1).position).toEqual([0, 1, 10])
    expect(moveStudioDirectorView(view, 'e', 1).position).toEqual([0, 3, 10])
  })

  it('moves a selected object relative to the current view, including backward and vertical keys', () => {
    const position: [number, number, number] = [4, 0, 3]

    expect(moveStudioPositionRelativeToView(position, view, 'w', 1)).toEqual([4, 0, 2])
    expect(moveStudioPositionRelativeToView(position, view, 's', 1)).toEqual([4, 0, 4])
    expect(moveStudioPositionRelativeToView(position, view, 'a', 1)).toEqual([3, 0, 3])
    expect(moveStudioPositionRelativeToView(position, view, 'd', 1)).toEqual([5, 0, 3])
    expect(moveStudioPositionRelativeToView(position, view, 'q', 1)).toEqual([4, -1, 3])
    expect(moveStudioPositionRelativeToView(position, view, 'e', 1)).toEqual([4, 1, 3])
  })
})
