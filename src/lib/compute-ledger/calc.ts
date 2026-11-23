/**
 * 算力账本的口径只在这里定义一次：金额（整数微元）、上海自然日、周/三日段、
 * 预算等级与派生指标。UI、API、CSV、导入都调它，纯函数，可脱离数据库单测。
 */
import { shanghaiDateKey } from '@/lib/account/activity-stats-shared'

export const MICROS = 1_000_000
const DAY_MS = 24 * 60 * 60 * 1000

export const toMicros = (cny: number | string): number => Math.round(Number(cny) * MICROS)
export const fromMicros = (m: number): number => m / MICROS
/** 仅用于显示：微元 → 元（保留 2 位）。禁止把显示值再相加。 */
export const toCents = (micros: number): number => Math.round(micros / 10_000) / 100

export const ENTRY_KINDS = ['api_token', 'jimeng_points', 'other_cny'] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

export function computeEntryAmountMicros(kind: EntryKind, quantity: number, rate: number): number {
  switch (kind) {
    // 元/百万token：quantity×rate/1e6 元 = quantity×rate 微元
    case 'api_token': return Math.round(quantity * rate)
    // 元/积分
    case 'jimeng_points': return Math.round(quantity * rate * MICROS)
    // quantity 本身就是元，rate 恒为 1
    case 'other_cny': return Math.round(quantity * MICROS)
  }
}

function parseKey(dateKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateKey.split('-').map(Number)
  return { y, m, d }
}

function formatKey(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}`
}

export function addDaysKey(dateKey: string, n: number): string {
  const { y, m, d } = parseKey(dateKey)
  const shifted = new Date(Date.UTC(y, m - 1, d + n))
  return formatKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

export function daysBetweenKeys(a: string, b: string): number {
  const pa = parseKey(a)
  const pb = parseKey(b)
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY_MS)
}

export function isValidDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const { y, m, d } = parseKey(s)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() + 1 === m && probe.getUTCDate() === d
}

export function todayKey(now: Date = new Date()): string {
  return shanghaiDateKey(now)
}

/** 当周周一。 */
export function weekStartKey(dateKey: string): string {
  const { y, m, d } = parseKey(dateKey)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const back = (dow + 6) % 7
  return addDaysKey(dateKey, -back)
}

/** '5.18-5.24'（无前导零，同表格）。 */
export function weekLabel(weekStart: string): string {
  const a = parseKey(weekStart)
  const b = parseKey(addDaysKey(weekStart, 6))
  return `${a.m}.${a.d}-${b.m}.${b.d}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** 三日段按自然月内日号切：1–3 / 4–6 … 28–30 / 31 单独成段。 */
export function triBucket(dateKey: string): { start: string; end: string; label: string } {
  const { y, m, d } = parseKey(dateKey)
  const dim = daysInMonth(y, m)
  const startDay = 3 * Math.floor((d - 1) / 3) + 1
  const endDay = Math.min(startDay + 2, dim)
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = formatKey(y, m, startDay)
  const end = formatKey(y, m, endDay)
  return { start, end, label: `${start} 至 ${end}` }
}

export type BudgetLevel = 'none' | 'ok' | 'warn' | 'over'
export const BUDGET_WARN_RATIO = 0.8

export function budgetState(budgetCny: number | null, totalMicros: number): {
  level: BudgetLevel
  ratio: number | null
  remainingCny: number | null
} {
  if (budgetCny == null || budgetCny <= 0) return { level: 'none', ratio: null, remainingCny: null }
  const budgetMicros = toMicros(budgetCny)
  const ratio = totalMicros / budgetMicros
  const level: BudgetLevel = ratio >= 1 ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok'
  return { level, ratio, remainingCny: fromMicros(budgetMicros - totalMicros) }
}

export function elapsedDays(
  startDate: string | null,
  status: string,
  completedDate: string | null,
  today: string,
): number | null {
  if (!startDate) return null
  const endKey = status === 'completed' && completedDate ? completedDate : today
  return daysBetweenKeys(startDate, endKey) + 1
}

export function costPerMinute(totalMicros: number, durationMinutes: number | null): number | null {
  if (durationMinutes == null || durationMinutes <= 0) return null
  return fromMicros(totalMicros) / durationMinutes
}

export function completionRatio(totalEpisodes: number | null, doneEpisodes: number | null): number | null {
  if (totalEpisodes == null || totalEpisodes <= 0 || doneEpisodes == null) return null
  return Math.min(1, Math.max(0, doneEpisodes / totalEpisodes))
}

export function normalizeProjectName(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export const CATEGORIES = ['premium', 'client_demo', 'test', 'short', 'trial'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  premium: '精品',
  client_demo: '甲方Demo',
  test: '测试',
  short: '短片',
  trial: '试岗',
}

const CATEGORY_MAP: Record<string, Category> = {
  精品: 'premium',
  甲方Demo: 'client_demo',
  测试: 'test',
  短片: 'short',
  试岗: 'trial',
}

/** 多选脏数据：拆开、去重、取第一个；映射不到返回 null（调用方记警告）。 */
export function normalizeCategory(raw: string | null | undefined): Category | null {
  if (!raw) return null
  const tokens = [...new Set(raw.split(/[,，、]/).map((t) => t.trim()).filter(Boolean))]
  if (tokens.length === 0) return null
  return CATEGORY_MAP[tokens[0]] ?? null
}

export const PROJECT_STATUSES = ['in_progress', 'completed', 'paused'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  in_progress: '进行中',
  completed: '已完成',
  paused: '暂停',
}

/** facts 与 entries 共用：同一个人在两侧必须落到同一个 key 才能合并。 */
export function actorKey(actorUserId: string | null | undefined, actorLabel: string): string {
  return actorUserId ? `u:${actorUserId}` : `l:${actorLabel}`
}
