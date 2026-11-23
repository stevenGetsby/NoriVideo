/**
 * 账本展示纯函数：金额 / 比例 / 数量格式化、类型与等级文案。不触碰数据库，可单测。
 * 金额只做「展示」格式化；任何求和都在服务端微元完成（R5），这里绝不把显示值再相加。
 */
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  type BudgetLevel,
  type Category,
  type EntryKind,
  type ProjectStatus,
} from '@/lib/compute-ledger/calc'

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 固定 2 位小数 + 千分位，负数照实。确定性输出，便于单测。 */
export function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const fixed = value.toFixed(2)
  const negative = fixed.startsWith('-')
  const [int, dec] = (negative ? fixed.slice(1) : fixed).split('.')
  return `${negative ? '-' : ''}${groupDigits(int)}.${dec}`
}

export function formatCny(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `¥${formatMoney(value)}`
}

/** token 数：千分位整数。 */
export function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value)
  const negative = rounded < 0
  return `${negative ? '-' : ''}${groupDigits(String(Math.abs(rounded)))}`
}

/** 积分：最多 2 位小数，去掉多余的 0。 */
export function formatPoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const fixed = value.toFixed(2)
  const trimmed = fixed.replace(/\.?0+$/, '')
  const negative = trimmed.startsWith('-')
  const [int, dec] = (negative ? trimmed.slice(1) : trimmed).split('.')
  return `${negative ? '-' : ''}${groupDigits(int)}${dec ? `.${dec}` : ''}`
}

/** 比例（0–1）→ 百分比，2 位小数。 */
export function formatRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

export function categoryLabel(category: Category | null | undefined): string {
  return category ? CATEGORY_LABELS[category] : '—'
}

export function statusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status]
}

export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  api_token: 'API token',
  jimeng_points: '即梦积分',
  other_cny: '直接填元',
}

export const ENTRY_KIND_UNITS: Record<EntryKind, string> = {
  api_token: 'token',
  jimeng_points: '积分',
  other_cny: '元',
}

export function levelText(level: BudgetLevel): string {
  switch (level) {
    case 'over': return '超支'
    case 'warn': return '预警'
    case 'ok': return '正常'
    default: return '未设预算'
  }
}

/** MM-DD；与参考年不同则显示完整 YYYY-MM-DD。 */
export function formatDateShort(dateKey: string | null | undefined, referenceYear?: number): string {
  if (!dateKey) return '—'
  const [year, month, day] = dateKey.split('-')
  if (referenceYear != null && Number(year) !== referenceYear) return dateKey
  return `${month}-${day}`
}

export function formatQuantity(kind: EntryKind, quantity: number): string {
  return kind === 'api_token' ? formatTokens(quantity) : kind === 'jimeng_points' ? formatPoints(quantity) : formatMoney(quantity)
}
