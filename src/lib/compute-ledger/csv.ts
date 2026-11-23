/**
 * 账本 CSV 导出：UTF-8 BOM + CRLF，中文表头，金额 2 位小数。
 * 防公式注入（R13）：字符串以 = + - @ \t \r 开头时前置 '；负数金额走 csvMoney（number），不被加前缀。
 */
import { CATEGORY_LABELS, STATUS_LABELS, type Category, type ProjectStatus } from './calc'
import type { DayReportRow, TriReportRow, WeekReportRow } from './aggregate'
import type { OverviewRow } from './overview'

export function csvCell(value: string | number | null): string {
  if (value == null) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 金额列专用：固定 2 位小数，负数照实输出，绝不前置 '（不是用户自由文本）。 */
export function csvMoney(value: number): string {
  return value.toFixed(2)
}

function categoryLabel(category: Category | null): string {
  return category ? CATEGORY_LABELS[category] : ''
}

function statusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status]
}

function finish(lines: string[]): string {
  return `﻿${lines.join('\r\n')}\r\n`
}

export function buildDayCsv(rows: readonly DayReportRow[]): string {
  const lines = [
    ['日报提交日期', '项目名称', '项目类型', '周区间', '提交人', '当天API消耗（token）', '当天即梦消耗（积分）', '平台自动消耗（元）', '当天算力总消耗（元）', '备注'].map(csvCell).join(','),
  ]
  for (const row of rows) {
    lines.push([
      csvCell(row.dateKey),
      csvCell(row.projectName),
      csvCell(categoryLabel(row.category)),
      csvCell(row.weekLabel),
      csvCell(row.actorName),
      csvCell(row.apiTokens),
      csvCell(row.jimengPoints),
      csvMoney(row.platformCny),
      csvMoney(row.totalCny),
      csvCell(row.remark),
    ].join(','))
  }
  return finish(lines)
}

export function buildWeekCsv(rows: readonly WeekReportRow[]): string {
  const lines = [
    ['周区间', '项目名称', '项目类型', '提交人', '个人周项目算力总和（元）', '周项目算力总和（元）'].map(csvCell).join(','),
  ]
  for (const row of rows) {
    for (const person of row.people) {
      lines.push([
        csvCell(row.weekLabel),
        csvCell(row.projectName),
        csvCell(categoryLabel(row.category)),
        csvCell(person.actorName),
        csvMoney(person.totalCny),
        csvMoney(row.totalCny),
      ].join(','))
    }
  }
  return finish(lines)
}

export function buildTriCsv(rows: readonly TriReportRow[]): string {
  const lines = [
    ['每三天分组', '项目名称', '三日算力总消耗（元）'].map(csvCell).join(','),
  ]
  for (const row of rows) {
    lines.push([
      csvCell(row.label),
      csvCell(row.projectName),
      csvMoney(row.totalCny),
    ].join(','))
  }
  return finish(lines)
}

export function buildOverviewCsv(rows: readonly OverviewRow[]): string {
  const lines = [
    ['项目名称', '项目类型', '开工日期', '总消耗（元）', '算力预算（元）', '预算余额（元）', '使用率', '成片时长（分钟）', '元/分钟', '总集数', '已完成集数', '完成情况', '个人明细'].map(csvCell).join(','),
  ]
  for (const row of rows) {
    const detail = row.byActor.map((actor) => `${actor.name} ${csvMoney(actor.totalCny)}`).join('；')
    lines.push([
      csvCell(row.name),
      csvCell(categoryLabel(row.category)),
      csvCell(row.startDate),
      csvMoney(row.totalCny),
      row.budgetCny == null ? '' : csvMoney(row.budgetCny),
      row.remainingCny == null ? '' : csvMoney(row.remainingCny),
      row.usageRatio == null ? '' : `${(row.usageRatio * 100).toFixed(2)}%`,
      row.durationMinutes == null ? '' : csvCell(row.durationMinutes),
      row.costPerMinute == null ? '' : csvMoney(row.costPerMinute),
      row.totalEpisodes == null ? '' : csvCell(row.totalEpisodes),
      row.doneEpisodes == null ? '' : csvCell(row.doneEpisodes),
      csvCell(statusLabel(row.status)),
      csvCell(detail),
    ].join(','))
  }
  return finish(lines)
}