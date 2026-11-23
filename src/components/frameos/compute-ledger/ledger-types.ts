/**
 * 账本前端响应类型（与服务端返回一一对应的纯类型，不 import 任何含 prisma 的模块）。
 * 金额一律是服务端算好的 number，前端只展示，不再相加（R5）。
 */
import type { BudgetLevel, Category, EntryKind, ProjectStatus } from '@/lib/compute-ledger/calc'

export type { BudgetLevel, Category, EntryKind, ProjectStatus }

export type OverviewByActor = { actorKey: string; name: string; totalCny: number; periodCny: number }

export type OverviewRow = {
  projectId: string
  name: string
  workId: string | null
  workState: 'active' | 'recycled' | 'purged' | 'external'
  duplicateName: boolean
  category: Category | null
  status: ProjectStatus
  startDate: string | null
  completedDate: string | null
  targetDeliveryDate: string | null
  elapsedDays: number | null
  durationMinutes: number | null
  costPerMinute: number | null
  totalEpisodes: number | null
  doneEpisodes: number | null
  completionRatio: number | null
  budgetCny: number | null
  remainingCny: number | null
  usageRatio: number | null
  level: BudgetLevel
  totalCny: number
  periodCny: number
  platformCny: number
  externalCny: number
  byActor: OverviewByActor[]
  archived: boolean
  note: string | null
}

export type OverviewResponse = {
  currency: 'CNY'
  asOf: string
  range: { from: string | null; to: string | null }
  sync: { complete: boolean; syncedThroughDate: string | null; billingMode: 'OFF' | 'SHADOW' | 'ENFORCE' }
  rates: { tokenRateCnyPerMillion: number; jimengCnyPerPoint: number }
  totals: {
    totalCny: number
    periodCny: number
    platformCny: number
    externalCny: number
    budgetCny: number
    overCount: number
    warnCount: number
  }
  rows: OverviewRow[]
}

export type DayReportRow = {
  dateKey: string
  weekLabel: string
  projectId: string
  projectName: string
  category: Category | null
  actorKey: string
  actorName: string
  platformCny: number
  apiTokens: number
  apiTokenCny: number
  jimengPoints: number
  jimengCny: number
  otherCny: number
  totalCny: number
  remark: string | null
}

export type WeekReportPerson = { actorKey: string; actorName: string; totalCny: number }

export type WeekReportRow = {
  weekStart: string
  weekLabel: string
  projectId: string
  projectName: string
  category: Category | null
  totalCny: number
  people: WeekReportPerson[]
}

export type TriReportRow = {
  bucketStart: string
  bucketEnd: string
  label: string
  projectId: string
  projectName: string
  category: Category | null
  totalCny: number
}

export type ReportView = 'day' | 'week' | 'tri'

export type ReportResponse = {
  view: ReportView
  range: { from: string; to: string }
  rows: DayReportRow[] | WeekReportRow[] | TriReportRow[]
  footer: { totalCny: number }
  totalRows: number
  page: number
  pageSize: number
}

export type EntryView = {
  id: string
  ledgerProjectId: string
  projectName: string
  dateKey: string
  actorUserId: string | null
  actorLabel: string
  kind: EntryKind
  quantity: number
  rate: number
  amountCny: number
  remark: string | null
  source: string
  importBatchId: string | null
  replacesEntryId: string | null
  createdById: string
  createdAt: string
  voidedAt: string | null
  editable: boolean
}

export type EntryListResponse = { rows: EntryView[]; total: number; page: number; pageSize: number }

export type ProjectOption = {
  id: string
  name: string
  category: Category | null
  status: ProjectStatus
  hasBudget: boolean
}

export type WorkCandidate = { id: string; name: string }

export type LedgerRates = { tokenRateCnyPerMillion: number; jimengCnyPerPoint: number }

export type ProjectOptionsResponse = { projects: ProjectOption[]; rates: LedgerRates }

export type LedgerSettingsView = {
  tokenRateCnyPerMillion: number
  jimengCnyPerPoint: number
  syncedThroughDate: string | null
  lastSyncAt: string | null
}

export type MeResponse = {
  range: { from: string; to: string }
  summary: { totalCny: number; platformCny: number; externalCny: number }
  rows: DayReportRow[]
  entries: EntryView[]
}

export type ImportReport = {
  mode: 'dry-run' | 'commit'
  reportHash: string
  batchId?: string
  summary: {
    rows: number
    emptyRows: number
    entriesToCreate: number
    alreadyImported: number
    projectsNew: number
    projectsMatched: number
    projectsLinkedToWork: number
    actorsMatched: number
    actorsUnmatched: number
    importedCny: number
    carryForwardCny: number
  }
  projects: Array<{
    name: string
    action: 'create' | 'reuse'
    linkedWork: boolean
    rows: number
    importedCny: number
    statedTotalCny: number | null
    carryForwardCny: number
    meta: Record<string, unknown>
  }>
  actors: Array<{ name: string; matchedUserId: string | null; rows: number }>
  overlaps: Array<{ project: string; from: string; to: string; platformCny: number; importedCny: number }>
  warnings: string[]
  errors: Array<{ rowNo: number; reason: string }>
}

/** 面板向外壳汇报的状态（外壳合并后驱动顶部横幅与自动重取）。 */
export type LedgerStatus = {
  billingMode?: 'OFF' | 'SHADOW' | 'ENFORCE'
  complete?: boolean
  syncedThroughDate?: string | null
  error?: string
}

export type LedgerPanelProps = {
  refreshToken: number
  onStatus: (status: LedgerStatus) => void
  onRefresh: () => void
}
