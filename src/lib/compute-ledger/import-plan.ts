/**
 * 历史 xlsx 导入的计划函数（纯逻辑 + 注入的只读数据快照，可脱离数据库单测）。
 * dry-run 与 commit 共用同一个计划，保证「看到的」就是「写入的」。
 * 导入一律用 46 / 0.1 单价（不读 LedgerSetting），金额走同一个 computeEntryAmountMicros。
 * 真实数据的 commit 必须等用户选 A/B/C（§16 Q1）；本模块只产出计划与报告。
 */
import { createHash } from 'node:crypto'
import {
  type Category,
  type EntryKind,
  actorKey,
  computeEntryAmountMicros,
  fromMicros,
  isValidDateKey,
  normalizeCategory,
  normalizeProjectName,
  toMicros,
  todayKey,
} from './calc'

export const CARRY_FORWARD_DATE_KEY = '2020-01-01'
const IMPORT_TOKEN_RATE = 46
const IMPORT_JIMENG_RATE = 0.1
const CARRY_THRESHOLD_CNY = 0.05

export type ImportRow = {
  rowNo: number
  dateKey: string
  projectName: string
  categoryRaw?: string | null
  actorName: string
  apiTokens: number
  jimengPoints: number
  remark?: string | null
  statedDayCny?: number | null
  projectMeta?: {
    startDate?: string | null
    budgetCny?: number | null
    targetDeliveryDate?: string | null
    totalEpisodes?: number | null
    doneEpisodes?: number | null
  } | null
}

export type ImportPayload = {
  source?: { file?: string; sheet?: string; sha256?: string; rowCount?: number }
  rows: ImportRow[]
  statedProjectTotals?: Record<string, number>
  errors?: Array<{ rowNo: number; reason: string }>
}

export type ImportOptions = {
  carryForward: 'none' | 'stated-total'
  acknowledgeOverlap?: boolean
}

export type ImportData = {
  existingProjects: Array<{
    id: string
    nameKey: string
    workId: string | null
    archivedAt: Date | null
    category: string | null
    budgetCny: number | null
    startDate: string | null
    targetDeliveryDate: string | null
    totalEpisodes: number | null
    doneEpisodes: number | null
  }>
  works: Array<{ id: string; name: string }>
  linkedWorkIds: string[]
  accounts: Array<{ id: string; name: string }>
  existingImportKeys: string[]
  platformFacts: Array<{ workId: string; dateKey: string; costMicros: number }>
}

export type PlannedProject = {
  nameKey: string
  name: string
  action: 'create' | 'reuse'
  existingId?: string
  workId?: string | null
  meta: {
    category: Category | null
    budgetCny: number | null
    startDate: string | null
    targetDeliveryDate: string | null
    totalEpisodes: number | null
    doneEpisodes: number | null
  }
}

export type PlannedEntry = {
  importKey: string
  projectNameKey: string
  dateKey: string
  actorUserId: string | null
  actorLabel: string
  kind: EntryKind
  quantity: number
  rate: number
  amountCny: number
  remark: string | null
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

export type ImportPlan = { report: ImportPlanReport; projects: PlannedProject[]; entries: PlannedEntry[] }
type ImportPlanReport = ImportReport

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function nfkcName(name: string): string {
  return name.normalize('NFKC').trim()
}

type ProjectState = PlannedProject & {
  rows: number
  importedMicros: number
  statedTotalCny: number | null
  carryMicros: number
  categories: Set<Category>
  metaSeen: Record<string, boolean>
  workMatchCount: number
}

export function buildImportPlan(
  ownerId: string,
  payload: ImportPayload,
  options: ImportOptions,
  data: ImportData,
): ImportPlan {
  const today = todayKey()
  const warnings: string[] = []
  const errors: Array<{ rowNo: number; reason: string }> = [...(payload.errors ?? [])]
  const rows = payload.rows ?? []

  const existingByKey = new Map<string, ImportData['existingProjects'][number]>()
  for (const project of data.existingProjects) {
    if (project.archivedAt == null && !existingByKey.has(project.nameKey)) existingByKey.set(project.nameKey, project)
  }
  const linkedWorkIds = new Set(data.linkedWorkIds)
  const worksByName = new Map<string, Array<{ id: string; name: string }>>()
  for (const work of data.works) {
    const key = normalizeProjectName(work.name)
    const list = worksByName.get(key) ?? []
    list.push(work)
    worksByName.set(key, list)
  }
  const accountsByName = new Map<string, string[]>()
  for (const account of data.accounts) {
    const key = nfkcName(account.name)
    const list = accountsByName.get(key) ?? []
    list.push(account.id)
    accountsByName.set(key, list)
  }
  const existingKeys = new Set(data.existingImportKeys)
  const statedByKey = new Map<string, number>()
  for (const [name, total] of Object.entries(payload.statedProjectTotals ?? {})) {
    const key = normalizeProjectName(name)
    statedByKey.set(key, Math.max(statedByKey.get(key) ?? 0, Number(total) || 0))
  }

  const projects = new Map<string, ProjectState>()
  const actorRows = new Map<string, { name: string; matchedUserId: string | null; rows: number }>()
  const entries: PlannedEntry[] = []
  const seenKeys = new Set<string>()
  let emptyRows = 0
  let alreadyImported = 0
  let importedMicros = 0

  const ensureProject = (rawName: string, row: ImportRow): ProjectState => {
    const nameKey = normalizeProjectName(rawName)
    let state = projects.get(nameKey)
    if (state) return state
    const existing = existingByKey.get(nameKey)
    const workMatches = worksByName.get(nameKey) ?? []
    let action: 'create' | 'reuse' = 'create'
    let existingId: string | undefined
    let workId: string | null = null
    if (existing) {
      action = 'reuse'
      existingId = existing.id
      workId = existing.workId
    } else if (workMatches.length === 1 && !linkedWorkIds.has(workMatches[0].id)) {
      workId = workMatches[0].id
      linkedWorkIds.add(workId)
    } else if (workMatches.length >= 2) {
      warnings.push(`项目「${rawName.trim()}」匹配到 ${workMatches.length} 个同名作品，已建为外部项目，请手动关联。`)
    }
    state = {
      nameKey,
      name: rawName.trim(),
      action,
      existingId,
      workId,
      meta: {
        category: (existing?.category as Category | null) ?? null,
        budgetCny: existing?.budgetCny ?? null,
        startDate: existing?.startDate ?? null,
        targetDeliveryDate: existing?.targetDeliveryDate ?? null,
        totalEpisodes: existing?.totalEpisodes ?? null,
        doneEpisodes: existing?.doneEpisodes ?? null,
      },
      rows: 0,
      importedMicros: 0,
      statedTotalCny: statedByKey.get(nameKey) ?? null,
      carryMicros: 0,
      categories: new Set(),
      metaSeen: {},
      workMatchCount: workMatches.length,
    }
    projects.set(nameKey, state)
    return state
  }

  const fillMeta = (state: ProjectState, row: ImportRow) => {
    const meta = row.projectMeta ?? {}
    const fields: Array<[keyof ProjectState['meta'], unknown]> = [
      ['budgetCny', meta.budgetCny],
      ['startDate', meta.startDate],
      ['targetDeliveryDate', meta.targetDeliveryDate],
      ['totalEpisodes', meta.totalEpisodes],
      ['doneEpisodes', meta.doneEpisodes],
    ]
    for (const [field, value] of fields) {
      if (value == null || value === '') continue
      if (state.meta[field] == null) {
        state.meta[field] = value as never
        state.metaSeen[field] = true
      } else if (state.metaSeen[field] && state.meta[field] !== value) {
        warnings.push(`项目「${state.name}」的 ${field} 在不同行取值不一致，已取第一个。`)
      }
    }
    if (row.categoryRaw) {
      const normalized = normalizeCategory(row.categoryRaw)
      if (normalized) {
        state.categories.add(normalized)
      } else {
        warnings.push(`项目「${state.name}」的类型「${row.categoryRaw}」无法识别，已置空。`)
      }
    }
  }

  for (const row of rows) {
    const projectName = (row.projectName ?? '').trim()
    const actorName = (row.actorName ?? '').trim()
    if (!isValidDateKey(row.dateKey)) {
      errors.push({ rowNo: row.rowNo, reason: `日期非法：${row.dateKey}` })
      continue
    }
    if (row.dateKey > today) {
      errors.push({ rowNo: row.rowNo, reason: `日期晚于今天：${row.dateKey}` })
      continue
    }
    if (!projectName) {
      errors.push({ rowNo: row.rowNo, reason: '项目名称为空。' })
      continue
    }
    if (!actorName) {
      errors.push({ rowNo: row.rowNo, reason: '提交人为空。' })
      continue
    }
    const apiTokens = Number(row.apiTokens)
    const jimengPoints = Number(row.jimengPoints)
    if (!Number.isFinite(apiTokens) || apiTokens < 0 || !Number.isInteger(apiTokens)) {
      errors.push({ rowNo: row.rowNo, reason: `API token 非法：${row.apiTokens}` })
      continue
    }
    if (!Number.isFinite(jimengPoints) || jimengPoints < 0) {
      errors.push({ rowNo: row.rowNo, reason: `即梦积分非法：${row.jimengPoints}` })
      continue
    }

    const state = ensureProject(row.projectName, row)
    state.rows += 1
    fillMeta(state, row)
    if (normalizeProjectName(row.projectName) !== row.projectName.trim()) {
      // 归一化改变了名字（如前导空格）：提示一次即可，按 nameKey 去重
    }

    const accountIds = accountsByName.get(nfkcName(actorName)) ?? []
    const matchedUserId = accountIds.length === 1 ? accountIds[0] : null
    const actorStat = actorRows.get(actorName) ?? { name: actorName, matchedUserId, rows: 0 }
    actorStat.rows += 1
    actorRows.set(actorName, actorStat)
    const actorKeyStr = actorKey(matchedUserId, actorName)
    const nameKey = state.nameKey

    if (apiTokens === 0 && jimengPoints === 0) {
      emptyRows += 1
      continue
    }

    const rowEntries: Array<{ kind: EntryKind; quantity: number; rate: number }> = []
    if (apiTokens > 0) rowEntries.push({ kind: 'api_token', quantity: apiTokens, rate: IMPORT_TOKEN_RATE })
    if (jimengPoints > 0) rowEntries.push({ kind: 'jimeng_points', quantity: jimengPoints, rate: IMPORT_JIMENG_RATE })

    rowEntries.forEach((spec, index) => {
      const importKey = `imp1:${sha1(`${ownerId}|${row.dateKey}|${nameKey}|${actorKeyStr}|${spec.kind}`)}`
      if (seenKeys.has(importKey)) {
        errors.push({ rowNo: row.rowNo, reason: `同一份文件内导入键重复（${row.dateKey} ${projectName} ${actorName} ${spec.kind}），请先合并。` })
        return
      }
      seenKeys.add(importKey)
      if (existingKeys.has(importKey)) {
        alreadyImported += 1
        return
      }
      const amountMicros = computeEntryAmountMicros(spec.kind, spec.quantity, spec.rate)
      importedMicros += amountMicros
      state.importedMicros += amountMicros
      entries.push({
        importKey,
        projectNameKey: nameKey,
        dateKey: row.dateKey,
        actorUserId: matchedUserId,
        actorLabel: actorName.slice(0, 64),
        kind: spec.kind,
        quantity: spec.quantity,
        rate: spec.rate,
        amountCny: fromMicros(amountMicros),
        remark: index === 0 && row.remark ? String(row.remark).trim().slice(0, 500) : null,
      })
    })
  }

  // 前导空格 / 全角等归一化提示（按项目去重）
  for (const row of rows) {
    const trimmed = (row.projectName ?? '').trim()
    if (trimmed && normalizeProjectName(trimmed) !== trimmed.toLowerCase()) {
      // normalizeProjectName 会小写化；仅当存在空白差异时提示
    }
  }
  const spacedNames = new Set<string>()
  for (const row of rows) {
    const raw = row.projectName ?? ''
    if (raw !== raw.trim() && raw.trim()) spacedNames.add(raw.trim())
  }
  for (const name of spacedNames) {
    warnings.push(`项目「${name}」在原表里带首尾空格，已归一化。`)
  }

  // 类型：多个不同值取第一个并提示
  for (const state of projects.values()) {
    if (state.categories.size > 0) {
      const list = [...state.categories]
      if (state.meta.category == null) state.meta.category = list[0]
      if (list.length > 1) warnings.push(`项目「${state.name}」有多个不同类型，已取「${list[0]}」。`)
    }
  }

  // 期初结转（方案 B）
  let carryMicros = 0
  if (options.carryForward === 'stated-total') {
    for (const state of projects.values()) {
      if (state.statedTotalCny == null) continue
      const carryCny = state.statedTotalCny - fromMicros(state.importedMicros)
      if (carryCny <= CARRY_THRESHOLD_CNY) continue
      const quantity = Math.round(carryCny * 100) / 100
      const amountMicros = computeEntryAmountMicros('other_cny', quantity, 1)
      const importKey = `imp1:carry:${sha1(`${ownerId}|${state.nameKey}`)}`
      if (existingKeys.has(importKey)) {
        alreadyImported += 1
        continue
      }
      state.carryMicros = amountMicros
      carryMicros += amountMicros
      entries.push({
        importKey,
        projectNameKey: state.nameKey,
        dateKey: CARRY_FORWARD_DATE_KEY,
        actorUserId: null,
        actorLabel: '期初结转',
        kind: 'other_cny',
        quantity,
        rate: 1,
        amountCny: fromMicros(amountMicros),
        remark: `[期初结转] 表格「项目算力总消耗」¥${state.statedTotalCny.toFixed(2)} − 导入日报行之和 ¥${fromMicros(state.importedMicros).toFixed(2)}`,
      })
    }
  }

  // 重叠检测：关联了 Work 的项目，导入日期与平台事实日期交集
  const platformByWork = new Map<string, Map<string, number>>()
  for (const fact of data.platformFacts) {
    let byDate = platformByWork.get(fact.workId)
    if (!byDate) {
      byDate = new Map()
      platformByWork.set(fact.workId, byDate)
    }
    byDate.set(fact.dateKey, (byDate.get(fact.dateKey) ?? 0) + fact.costMicros)
  }
  const importedByProjectDate = new Map<string, Map<string, number>>()
  for (const entry of entries) {
    if (entry.dateKey === CARRY_FORWARD_DATE_KEY) continue
    let byDate = importedByProjectDate.get(entry.projectNameKey)
    if (!byDate) {
      byDate = new Map()
      importedByProjectDate.set(entry.projectNameKey, byDate)
    }
    byDate.set(entry.dateKey, (byDate.get(entry.dateKey) ?? 0) + toMicros(entry.amountCny))
  }
  const overlaps: ImportReport['overlaps'] = []
  for (const state of projects.values()) {
    if (!state.workId) continue
    const platformDates = platformByWork.get(state.workId)
    const importedDates = importedByProjectDate.get(state.nameKey)
    if (!platformDates || !importedDates) continue
    const shared = [...importedDates.keys()].filter((date) => platformDates.has(date)).sort()
    if (shared.length === 0) continue
    let platformMicros = 0
    let importedMicrosSum = 0
    for (const date of shared) {
      platformMicros += platformDates.get(date) ?? 0
      importedMicrosSum += importedDates.get(date) ?? 0
    }
    overlaps.push({
      project: state.name,
      from: shared[0],
      to: shared[shared.length - 1],
      platformCny: fromMicros(platformMicros),
      importedCny: fromMicros(importedMicrosSum),
    })
  }

  const projectsReport: ImportReport['projects'] = [...projects.values()].map((state) => ({
    name: state.name,
    action: state.action,
    linkedWork: !!state.workId,
    rows: state.rows,
    importedCny: fromMicros(state.importedMicros),
    statedTotalCny: state.statedTotalCny,
    carryForwardCny: fromMicros(state.carryMicros),
    meta: { ...state.meta },
  }))
  const actorsReport: ImportReport['actors'] = [...actorRows.values()]
  const actorsMatched = actorsReport.filter((actor) => actor.matchedUserId != null).length
  const actorsUnmatched = actorsReport.length - actorsMatched

  const plannedProjects: PlannedProject[] = [...projects.values()].map((state) => ({
    nameKey: state.nameKey,
    name: state.name,
    action: state.action,
    existingId: state.existingId,
    workId: state.workId ?? null,
    meta: { ...state.meta },
  }))

  const hashInput = JSON.stringify({
    entries: entries.map((entry) => [entry.importKey, entry.amountCny]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    projects: plannedProjects.map((project) => [project.nameKey, project.action, project.workId ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    options: { carryForward: options.carryForward },
  })
  const reportHash = sha256(hashInput)

  const report: ImportReport = {
    mode: 'dry-run',
    reportHash,
    summary: {
      rows: rows.length,
      emptyRows,
      entriesToCreate: entries.length,
      alreadyImported,
      projectsNew: plannedProjects.filter((project) => project.action === 'create').length,
      projectsMatched: plannedProjects.filter((project) => project.action === 'reuse').length,
      projectsLinkedToWork: plannedProjects.filter((project) => !!project.workId).length,
      actorsMatched,
      actorsUnmatched,
      importedCny: fromMicros(importedMicros),
      carryForwardCny: fromMicros(carryMicros),
    },
    projects: projectsReport,
    actors: actorsReport,
    overlaps,
    warnings,
    errors,
  }

  return { report, projects: plannedProjects, entries }
}