/** 小程序 video.playbackRate 原生支持的档位。 */
export const WX_RATES = [0.5, 0.8, 1.0, 1.25, 1.5, 2.0] as const

/** r ≤ 0.5 取 0.5，其余取最接近的支持值（并列时取较低档）。 */
export function toWxRate(r: number): number {
  if (r <= 0.5) return 0.5
  let best: number = WX_RATES[0]
  for (const rate of WX_RATES) {
    if (Math.abs(rate - r) < Math.abs(best - r)) best = rate
  }
  return best
}