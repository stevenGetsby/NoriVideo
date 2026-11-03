type SampleJob<T> = {
  time: number
  priority: number
  tag?: string
  run: (video: HTMLVideoElement) => T | Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

export class SampleCancelledError extends Error {
  constructor() {
    super('frame sample cancelled')
  }
}

const SEEK_TIMEOUT_MS = 5000

export function drawVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, width: number, height: number) {
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || !video.videoWidth || !video.videoHeight) throw new Error('视频画面不可读取')
  const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
  const drawWidth = video.videoWidth * scale
  const drawHeight = video.videoHeight * scale
  context.drawImage(video, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight)
  return context
}

/** Serialises seeks on one hidden video so filmstrip, hover and keyframe thumbnails never fight over it. */
export class VideoFrameSampler {
  private readonly video: HTMLVideoElement
  private readonly ready: Promise<void>
  private readonly canvas: HTMLCanvasElement
  private queue: SampleJob<unknown>[] = []
  private busy = false
  private disposed = false

  constructor(src: string, createVideo: () => HTMLVideoElement = () => document.createElement('video'), createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')) {
    const video = createVideo()
    this.video = video
    this.canvas = createCanvas()
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    this.ready = new Promise<void>((resolve, reject) => {
      const loaded = () => resolve()
      video.addEventListener('loadeddata', loaded, { once: true })
      video.addEventListener('error', () => reject(new Error('视频无法读取')), { once: true })
    })
    this.ready.catch(() => {})
    video.src = src
  }

  run<T>(time: number, run: (video: HTMLVideoElement) => T | Promise<T>, options: { priority?: number; tag?: string; latestOnly?: boolean } = {}) {
    if (this.disposed) return Promise.reject<T>(new SampleCancelledError())
    if (options.latestOnly && options.tag) this.cancel(options.tag)
    return new Promise<T>((resolve, reject) => {
      const job = { time, priority: options.priority ?? 0, tag: options.tag, run, resolve, reject } as SampleJob<unknown>
      const index = this.queue.findIndex((queued) => queued.priority < job.priority)
      if (index < 0) this.queue.push(job)
      else this.queue.splice(index, 0, job)
      void this.pump()
    })
  }

  image(time: number, width: number, height: number, options?: { priority?: number; tag?: string; latestOnly?: boolean }) {
    return this.run(time, (video) => {
      drawVideoFrame(video, this.canvas, width, height)
      return this.canvas.toDataURL('image/jpeg', 0.72)
    }, options)
  }

  pixels(time: number, width: number, height: number, options?: { priority?: number; tag?: string }) {
    return this.run(time, (video) => drawVideoFrame(video, this.canvas, width, height).getImageData(0, 0, this.canvas.width, this.canvas.height).data, options)
  }

  cancel(tag: string) {
    const kept: SampleJob<unknown>[] = []
    for (const job of this.queue) {
      if (job.tag === tag) job.reject(new SampleCancelledError())
      else kept.push(job)
    }
    this.queue = kept
  }

  dispose() {
    this.disposed = true
    for (const job of this.queue) job.reject(new SampleCancelledError())
    this.queue = []
    this.video.removeAttribute('src')
    this.video.load()
  }

  private async pump() {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length && !this.disposed) {
        const job = this.queue.shift()!
        try {
          await this.ready
          await this.seek(job.time)
          if (this.disposed) throw new SampleCancelledError()
          job.resolve(await job.run(this.video))
        } catch (error) {
          job.reject(error instanceof Error ? error : new Error('视频画面读取失败'))
        }
      }
    } finally {
      this.busy = false
    }
  }

  private seek(time: number) {
    const video = this.video
    const target = Math.max(0, Math.min(Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : time, time))
    if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2 && !video.seeking) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve() }
      const timer = setTimeout(() => { video.removeEventListener('seeked', done); reject(new Error('视频定位超时')) }, SEEK_TIMEOUT_MS)
      video.addEventListener('seeked', done)
      video.currentTime = target
    })
  }
}
