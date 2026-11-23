import { describe, expect, it } from 'vitest'
import { MOUNT_RAMP_CHUNK, MOUNT_RAMP_FREE, planMountRamp } from '@/features/canvas/rendering/canvas-mount-ramp'

const ids = (count: number, prefix = 'n') => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(3, '0')}`)
const byIndex = (id: string) => Number(id.slice(1))

describe('planMountRamp', () => {
  it('passes small arrivals straight through so ordinary pans are unchanged', () => {
    const target = new Set(ids(MOUNT_RAMP_FREE))
    const plan = planMountRamp({ mounted: new Set(), target, immediate: new Set(), distanceOf: byIndex })
    expect(plan.complete).toBe(true)
    expect(plan.admitted).toBe(target)
  })

  it('admits a bounded, nearest-first chunk when many cards arrive at once', () => {
    const target = new Set(ids(80))
    const plan = planMountRamp({ mounted: new Set(), target, immediate: new Set(), distanceOf: (id) => 79 - byIndex(id) })
    expect(plan.complete).toBe(false)
    expect(plan.admitted.size).toBe(MOUNT_RAMP_CHUNK)
    expect([...plan.admitted].map(byIndex).sort((a, b) => a - b)).toEqual(
      Array.from({ length: MOUNT_RAMP_CHUNK }, (_, index) => 79 - index).sort((a, b) => a - b),
    )
  })

  it('always keeps mounted cards and interaction targets while the rest ramp in', () => {
    const target = new Set(ids(80))
    const mounted = new Set(['n010', 'n011'])
    const immediate = new Set(['n070'])
    const plan = planMountRamp({ mounted, target, immediate, distanceOf: byIndex })
    expect(plan.admitted.has('n010')).toBe(true)
    expect(plan.admitted.has('n011')).toBe(true)
    expect(plan.admitted.has('n070')).toBe(true)
    expect(plan.admitted.size).toBe(3 + MOUNT_RAMP_CHUNK)
  })

  it('converges to the whole target after repeated steps', () => {
    const target = new Set(ids(80))
    let mounted: ReadonlySet<string> = new Set()
    let steps = 0
    for (; steps < 40; steps += 1) {
      const plan = planMountRamp({ mounted, target, immediate: new Set(), distanceOf: byIndex })
      mounted = plan.admitted
      if (plan.complete) break
    }
    expect(mounted.size).toBe(80)
    expect(steps).toBeLessThanOrEqual(Math.ceil(80 / MOUNT_RAMP_CHUNK))
  })

  it('never admits cards that left the target, so unmounting is immediate', () => {
    const target = new Set(ids(30))
    const mounted = new Set([...ids(30), 'gone'])
    const plan = planMountRamp({ mounted, target, immediate: new Set(), distanceOf: byIndex })
    expect(plan.admitted.has('gone')).toBe(false)
    expect(plan.complete).toBe(true)
  })
})
