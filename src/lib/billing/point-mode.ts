export type PointMode = 'unlimited' | 'allocated'

export const DEFAULT_POINT_MODE: PointMode = 'unlimited'

/** 读库里的值：只有 'allocated' 算分配积分，null 和未知值一律按无限积分。 */
export function normalizePointMode(value: unknown): PointMode {
  return value === 'allocated' ? 'allocated' : 'unlimited'
}

/** 读请求体：不合法返回 null，由调用方报 400。 */
export function parsePointMode(value: unknown): PointMode | null {
  return value === 'unlimited' || value === 'allocated' ? value : null
}
