import { MP_RATING_PRIOR_M } from './constants'

export const HOT_NEWNESS_DAYS = 14
export const RATING_FALLBACK_AVG = 4.0

/** H.6：(players7d + 2×完成7d + 3×分享7d + 2×收藏7d) × (1 + 0.5 × max(0, 1 − 上线天数/14)) */
export function hotScore(players7d: number, completions7d: number, shares7d: number, favorites7d: number, daysSinceLive: number): number {
  const base = players7d + 2 * completions7d + 3 * shares7d + 2 * favorites7d
  const newness = 1 + 0.5 * Math.max(0, 1 - daysSinceLive / HOT_NEWNESS_DAYS)
  return base * newness
}

/** H.6 贝叶斯平均：(v/(v+m))×R + (m/(v+m))×C，m = 20。无评分时返回全站均分。 */
export function bayesianRating(ratingCount: number, ratingSum: number, globalAvg: number): number {
  if (ratingCount <= 0) return globalAvg
  const v = ratingCount
  const m = MP_RATING_PRIOR_M
  return (v / (v + m)) * (ratingSum / v) + (m / (v + m)) * globalAvg
}

export function globalRatingAvg(rows: Array<{ ratingCount: number; ratingSum: number }>): number {
  let count = 0
  let sum = 0
  for (const row of rows) {
    count += row.ratingCount
    sum += row.ratingSum
  }
  return count > 0 ? sum / count : RATING_FALLBACK_AVG
}
