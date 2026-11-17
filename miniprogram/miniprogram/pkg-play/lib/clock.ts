export type Wall = () => number

/**
 * 互动计时钟：墙钟减去所有暂停时段，语义与 Web 的 player-clock.ts 一致，可嵌套暂停。
 * 基于注入的墙钟（默认 Date.now），不依赖 performance。
 */
export class PausableClock {
  private pauseDepth = 0
  private pausedAtMs = 0
  private pausedTotalMs = 0

  constructor(private wall: Wall = Date.now) {}

  now(): number {
    return (this.pauseDepth > 0 ? this.pausedAtMs : this.wall()) - this.pausedTotalMs
  }

  pause(): void {
    if (this.pauseDepth === 0) this.pausedAtMs = this.wall()
    this.pauseDepth += 1
  }

  resume(): void {
    if (this.pauseDepth === 0) return
    this.pauseDepth -= 1
    if (this.pauseDepth === 0) this.pausedTotalMs += this.wall() - this.pausedAtMs
  }

  isPaused(): boolean {
    return this.pauseDepth > 0
  }
}

export const VIDEO_TICK_MS = 50

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * 视频位置钟：bindtimeupdate 给锚点 (t, wallMs)，播放中按速率外推，钳到 [0, duration]。
 * 暂停、缓冲、seek 时停止外推；50ms 一次 tick 驱动 dueBeat 与倒计时。
 */
export class VideoClock {
  private anchorSec = 0
  private anchorWallMs: number
  private durationSec = 0
  private rate = 1
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private wall: Wall = Date.now, private onTick: () => void = () => {}) {
    this.anchorWallMs = wall()
  }

  start(): void {
    if (this.timer === null) this.timer = setInterval(() => this.onTick(), VIDEO_TICK_MS)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  get ticking(): boolean {
    return this.timer !== null
  }

  get duration(): number {
    return this.durationSec
  }

  reset(durationSec = 0): void {
    this.anchorSec = 0
    this.anchorWallMs = this.wall()
    this.durationSec = durationSec > 0 ? durationSec : 0
    this.running = false
  }

  setRate(rate: number): void {
    if (rate === this.rate) return
    this.anchorSec = this.position()
    this.anchorWallMs = this.wall()
    this.rate = rate
  }

  /** bindtimeupdate：新锚点，恢复外推。 */
  update(currentSec: number, durationSec: number): void {
    this.anchorSec = currentSec
    this.anchorWallMs = this.wall()
    if (durationSec > 0) this.durationSec = durationSec
    this.running = true
  }

  pause(): void {
    this.anchorSec = this.position()
    this.anchorWallMs = this.wall()
    this.running = false
  }

  resume(): void {
    this.anchorWallMs = this.wall()
    this.running = true
  }

  seek(sec: number): void {
    this.anchorSec = Math.max(0, sec)
    this.anchorWallMs = this.wall()
    this.running = false
  }

  ended(): void {
    this.anchorSec = this.durationSec
    this.running = false
  }

  position(): number {
    const estimate = this.running
      ? this.anchorSec + ((this.wall() - this.anchorWallMs) / 1000) * this.rate
      : this.anchorSec
    const max = this.durationSec > 0 ? this.durationSec : Number.POSITIVE_INFINITY
    return clamp(estimate, 0, max)
  }
}