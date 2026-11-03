import { describe, expect, it } from 'vitest'
import { SampleCancelledError, VideoFrameSampler } from '@/features/canvas/video-frame-sampler'

class FakeVideo extends EventTarget {
  muted = false
  playsInline = false
  preload = ''
  readyState = 0
  duration = 10
  seeking = false
  seeks: number[] = []
  private time = 0
  set src(_value: string) {
    queueMicrotask(() => { this.readyState = 4; this.dispatchEvent(new Event('loadeddata')) })
  }
  get currentTime() { return this.time }
  set currentTime(value: number) {
    this.seeks.push(value)
    this.seeking = true
    setTimeout(() => { this.time = value; this.seeking = false; this.dispatchEvent(new Event('seeked')) }, 1)
  }
  removeAttribute() {}
  load() {}
}

function setup() {
  const video = new FakeVideo()
  const sampler = new VideoFrameSampler('blob:video', () => video as unknown as HTMLVideoElement, () => ({}) as HTMLCanvasElement)
  return { video, sampler }
}

describe('video frame sampler', () => {
  it('serialises seeks and runs higher priority work first', async () => {
    const { video, sampler } = setup()
    const order: string[] = []
    const first = sampler.run(1, (element) => { order.push(`film@${element.currentTime}`) }, { priority: 1 })
    const second = sampler.run(2, (element) => { order.push(`film@${element.currentTime}`) }, { priority: 1 })
    const urgent = sampler.run(3, (element) => { order.push(`hover@${element.currentTime}`) }, { priority: 3 })
    await Promise.all([first, second, urgent])
    expect(order).toEqual(['film@1', 'hover@3', 'film@2'])
    expect(video.seeks).toEqual([1, 3, 2])
  })

  it('keeps only the newest request for a latest-only channel', async () => {
    const { sampler } = setup()
    const busy = sampler.run(0.5, () => 'busy')
    const stale = sampler.run(1, () => 'stale', { tag: 'hover', latestOnly: true })
    const fresh = sampler.run(2, (element) => element.currentTime, { tag: 'hover', latestOnly: true })
    await expect(stale).rejects.toBeInstanceOf(SampleCancelledError)
    await expect(busy).resolves.toBe('busy')
    await expect(fresh).resolves.toBe(2)
  })

  it('clamps seeks inside the media and rejects queued work on dispose', async () => {
    const { video, sampler } = setup()
    await sampler.run(42, () => null)
    expect(video.seeks[0]).toBeCloseTo(9.999)
    const pending = sampler.run(3, () => null)
    const queued = sampler.run(4, () => null)
    sampler.dispose()
    await expect(queued).rejects.toBeInstanceOf(SampleCancelledError)
    await expect(pending).rejects.toBeInstanceOf(Error)
    await expect(sampler.run(1, () => null)).rejects.toBeInstanceOf(SampleCancelledError)
  })
})
