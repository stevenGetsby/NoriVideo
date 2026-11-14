/**
 * 工作监督统计的口径、类型与纯函数。不依赖 prisma，可被客户端安全引入。
 * 所有「天」都按上海自然日（固定 UTC+8）切分，与每日积分上限一致。
 */

export const ACTIVITY_TIME_ZONE = 'Asia/Shanghai'
export const ACTIVITY_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const ACTIVITY_RANGES = ['today', '7d', '30d'] as const
export type ActivityRange = (typeof ACTIVITY_RANGES)[number]

export const ACTIVITY_RANGE_LABELS: Record<ActivityRange, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
}

const RANGE_DAYS: Record<ActivityRange, number> = { today: 1, '7d': 7, '30d': 30 }

export const TREND_DAYS = 14

export function parseActivityRange(value: string | null | undefined): ActivityRange | null {
  if (value == null || value === '') return 'today'
  return (ACTIVITY_RANGES as readonly string[]).includes(value) ? (value as ActivityRange) : null
}

export type MediaKind = 'image' | 'video' | 'audio'
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio']
export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

/** 产出图片/视频/音频的任务类型；文本、分析类任务不计入「生成资产」。 */
export const GENERATION_TASK_TYPES: Record<MediaKind, readonly string[]> = {
  image: [
    'image_panel',
    'image_character',
    'image_location',
    'panel_variant',
    'modify_asset_image',
    'regenerate_group',
    'asset_hub_image',
    'asset_hub_modify',
    'toolbox_image',
    'canvas_image_operation',
  ],
  video: ['video_panel', 'lip_sync', 'toolbox_video', 'canvas_video_operation'],
  audio: ['voice_line', 'voice_design', 'asset_hub_voice_design', 'toolbox_audio'],
}

export const ALL_GENERATION_TASK_TYPES: readonly string[] = MEDIA_KINDS.flatMap(
  (kind) => GENERATION_TASK_TYPES[kind],
)

const TASK_KIND_BY_TYPE = new Map<string, MediaKind>(
  MEDIA_KINDS.flatMap((kind) =>
    GENERATION_TASK_TYPES[kind].map((type) => [type, kind] as const),
  ),
)

export function mediaKindForTaskType(type: string): MediaKind | null {
  return TASK_KIND_BY_TYPE.get(type) ?? null
}

export function mediaKindForMaterialType(type: string): MediaKind | null {
  return type === 'image' || type === 'video' || type === 'audio' ? type : null
}

export type MediaCounts = Record<MediaKind, number> & { total: number }

export function emptyMediaCounts(): MediaCounts {
  return { image: 0, video: 0, audio: 0, total: 0 }
}

export function addMediaCount(counts: MediaCounts, kind: MediaKind, n: number) {
  counts[kind] += n
  counts.total += n
}

export type ActivityWindow = {
  range: ActivityRange
  timeZone: typeof ACTIVITY_TIME_ZONE
  from: Date
  to: Date
  days: number
}

export function startOfShanghaiDay(now: Date): Date {
  const shifted = new Date(now.getTime() + ACTIVITY_OFFSET_MS)
  const startUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  )
  return new Date(startUtc - ACTIVITY_OFFSET_MS)
}

/** 窗口含今天，到次日 00:00（上海）为止。 */
export function resolveActivityWindow(range: ActivityRange, now: Date = new Date()): ActivityWindow {
  const todayStart = startOfShanghaiDay(now)
  const days = RANGE_DAYS[range]
  return {
    range,
    timeZone: ACTIVITY_TIME_ZONE,
    from: new Date(todayStart.getTime() - (days - 1) * DAY_MS),
    to: new Date(todayStart.getTime() + DAY_MS),
    days,
  }
}

export function resolveTrendWindow(now: Date = new Date()): { from: Date; to: Date; dates: string[] } {
  const todayStart = startOfShanghaiDay(now)
  const from = new Date(todayStart.getTime() - (TREND_DAYS - 1) * DAY_MS)
  const dates: string[] = []
  for (let i = 0; i < TREND_DAYS; i += 1) {
    dates.push(shanghaiDateKey(new Date(from.getTime() + i * DAY_MS)))
  }
  return { from, to: new Date(todayStart.getTime() + DAY_MS), dates }
}

export function shanghaiDateKey(date: Date): string {
  return new Date(date.getTime() + ACTIVITY_OFFSET_MS).toISOString().slice(0, 10)
}

export function shanghaiHour(date: Date): number {
  return new Date(date.getTime() + ACTIVITY_OFFSET_MS).getUTCHours()
}

export type ActivityAccountStatus = 'active' | 'disabled'

export type ActivityRow = {
  userId: string
  name: string
  roleLabel: string | null
  status: ActivityAccountStatus
  lastLoginAt: string | null
  /** 最近一次产出（生成完成或上传）的时间 */
  lastOutputAt: string | null
  /** 窗口内完成的生成任务，按产出类型拆分 */
  generated: MediaCounts
  /** 窗口内上传的资产，按类型拆分 */
  uploaded: MediaCounts
  /** 上传按「原文件名 + 大小」去重后的数量，仅供参考 */
  uploadedUnique: number
  failed: number
  retried: number
  points: number
  /** 窗口内生成并产出了素材的数量，及其中未被删除的数量 */
  producedAssets: number
  keptAssets: number
}

export type ActivitySummary = {
  accounts: number
  generated: MediaCounts
  uploaded: MediaCounts
  failed: number
  retried: number
  points: number
  producedAssets: number
  keptAssets: number
}

export type ActivityOverview = {
  range: ActivityRange
  timeZone: string
  from: string
  to: string
  generatedAt: string
  summary: ActivitySummary
  rows: ActivityRow[]
}

export type ActivityTrendPoint = {
  date: string
  generated: number
  video: number
  uploaded: number
  failed: number
}

export type ActivityEvent = {
  at: string
  kind: 'generate' | 'upload'
  media: MediaKind | null
  status: 'completed' | 'failed' | 'uploaded'
  title: string
}

export type ActivityRecentTask = {
  id: string
  type: string
  media: MediaKind | null
  status: 'completed' | 'failed'
  attempt: number
  at: string
  errorCode: string | null
}

export type ActivityDetail = {
  range: ActivityRange
  timeZone: string
  from: string
  to: string
  generatedAt: string
  row: ActivityRow
  trend: ActivityTrendPoint[]
  /** 选定时间范围内按小时（上海）统计的产出次数，长度 24 */
  hours: number[]
  /** 今天的产出时间线，新的在前 */
  timeline: ActivityEvent[]
  recent: ActivityRecentTask[]
}

export function summarizeRows(rows: readonly ActivityRow[]): ActivitySummary {
  const summary: ActivitySummary = {
    accounts: rows.length,
    generated: emptyMediaCounts(),
    uploaded: emptyMediaCounts(),
    failed: 0,
    retried: 0,
    points: 0,
    producedAssets: 0,
    keptAssets: 0,
  }
  for (const row of rows) {
    for (const kind of MEDIA_KINDS) {
      addMediaCount(summary.generated, kind, row.generated[kind])
      addMediaCount(summary.uploaded, kind, row.uploaded[kind])
    }
    summary.failed += row.failed
    summary.retried += row.retried
    summary.points += row.points
    summary.producedAssets += row.producedAssets
    summary.keptAssets += row.keptAssets
  }
  summary.points = roundPoints(summary.points)
  return summary
}

export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100
}

/** 未被删除占比，0~1；没有可统计素材时返回 null。 */
export function keepRate(row: Pick<ActivityRow, 'producedAssets' | 'keptAssets'>): number | null {
  if (row.producedAssets <= 0) return null
  return Math.min(1, Math.max(0, row.keptAssets / row.producedAssets))
}

export function formatKeepRate(rate: number | null): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`
}

const CSV_HEADERS = [
  '账号',
  '状态',
  '最近登录',
  '最近产出',
  '生成图片',
  '生成视频',
  '生成音频',
  '生成合计',
  '上传图片',
  '上传视频',
  '上传音频',
  '上传合计',
  '上传去重后',
  '积分消耗',
  '失败数',
  '重试数',
  '未删除占比',
] as const

function csvCell(value: string | number | null): string {
  if (value == null) return ''
  let text = String(value)
  // 防止 Excel 把以公式字符开头的账号名/文本当作公式执行
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function formatShanghaiDateTime(iso: string | null): string {
  if (!iso) return ''
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  return new Date(time + ACTIVITY_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

export function buildActivityCsv(overview: ActivityOverview): string {
  const lines: string[] = [
    `统计范围,${csvCell(ACTIVITY_RANGE_LABELS[overview.range])},${csvCell(
      `${formatShanghaiDateTime(overview.from)} ~ ${formatShanghaiDateTime(overview.to)}（上海时间）`,
    )}`,
    CSV_HEADERS.join(','),
  ]
  for (const row of overview.rows) {
    lines.push(
      [
        row.name,
        row.status === 'active' ? '正常' : '停用',
        formatShanghaiDateTime(row.lastLoginAt),
        formatShanghaiDateTime(row.lastOutputAt),
        row.generated.image,
        row.generated.video,
        row.generated.audio,
        row.generated.total,
        row.uploaded.image,
        row.uploaded.video,
        row.uploaded.audio,
        row.uploaded.total,
        row.uploadedUnique,
        row.points,
        row.failed,
        row.retried,
        formatKeepRate(keepRate(row)),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}
