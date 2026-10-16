export type ServiceUsageRecord = {
  accountId: string | null
  accountName: string
  accountRole: string
  projectId: string | null
  serviceType: string
  modelKey: string
  modelName: string
  status: 'success' | 'failed'
  inputTokens: number
  outputTokens: number
  units: number
  cost: number
  points: number
  createdAt: string
}

export type AccountModelUsageRow = {
  id: string
  accountId: string | null
  accountName: string
  accountRole: string
  modelKey: string
  modelName: string
  serviceType: string
  calls: number
  successCalls: number
  failureCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  units: number
  points: number
  cost: number
  projectCount: number
  lastUsedAt: string
}

const SERVICE_LABELS: Record<string, string> = {
  text: '文本生成',
  image: '图片生成',
  video: '视频生成',
  voice: '音频生成',
  'voice-design': '音色设计',
  'lip-sync': '口型同步',
  storage: '素材存储',
  other: '其他服务',
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0
}

function aggregateKey(record: ServiceUsageRecord) {
  const account = record.accountId || `name:${record.accountName}`
  const model = record.modelKey && record.modelKey !== 'unknown'
    ? record.modelKey
    : `unknown:${record.serviceType}`
  return JSON.stringify([account, model])
}

export function buildAccountModelUsageRows(records: ServiceUsageRecord[]): AccountModelUsageRow[] {
  const rows = new Map<string, AccountModelUsageRow & { projectIds: Set<string> }>()

  for (const record of records) {
    const key = aggregateKey(record)
    const current = rows.get(key) || {
      id: key,
      accountId: record.accountId,
      accountName: record.accountName,
      accountRole: record.accountRole,
      modelKey: record.modelKey,
      modelName: record.modelName,
      serviceType: record.serviceType,
      calls: 0,
      successCalls: 0,
      failureCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      units: 0,
      points: 0,
      cost: 0,
      projectCount: 0,
      lastUsedAt: '',
      projectIds: new Set<string>(),
    }

    current.calls += 1
    current.successCalls += record.status === 'success' ? 1 : 0
    current.failureCalls += record.status === 'failed' ? 1 : 0
    current.inputTokens += finite(record.inputTokens)
    current.outputTokens += finite(record.outputTokens)
    current.totalTokens = current.inputTokens + current.outputTokens
    current.units += finite(record.units)
    current.points += finite(record.points)
    current.cost += finite(record.cost)
    if (record.projectId) current.projectIds.add(record.projectId)
    if (!current.lastUsedAt || record.createdAt > current.lastUsedAt) current.lastUsedAt = record.createdAt
    rows.set(key, current)
  }

  return Array.from(rows.values(), ({ projectIds, ...row }) => ({
    ...row,
    projectCount: projectIds.size,
  })).sort((left, right) => (
    right.points - left.points
    || right.totalTokens - left.totalTokens
    || right.calls - left.calls
    || left.accountName.localeCompare(right.accountName, 'zh-CN')
    || left.modelName.localeCompare(right.modelName, 'zh-CN')
  ))
}

function safeCsvText(value: string) {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value
}

function csvCell(value: string | number) {
  const normalized = typeof value === 'number' ? String(finite(value)) : safeCsvText(value)
  return `"${normalized.replace(/"/g, '""')}"`
}

function serviceLabel(value: string) {
  return SERVICE_LABELS[value] || SERVICE_LABELS.other
}

function exportTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export function buildAccountModelUsageCsv(rows: AccountModelUsageRow[]) {
  const headers = [
    '账号', '岗位', '模型', '服务类型', '调用次数', '成功次数', '失败次数',
    'Input Token', 'Output Token', 'Total Token', '生成单位', '积分消耗',
    '人民币成本', '作品数', '最近使用时间',
  ]
  const body = rows.map((row) => [
    row.accountName,
    row.accountRole,
    row.modelName,
    serviceLabel(row.serviceType),
    row.calls,
    row.successCalls,
    row.failureCalls,
    row.inputTokens,
    row.outputTokens,
    row.totalTokens,
    row.units,
    row.points,
    row.cost,
    row.projectCount,
    exportTime(row.lastUsedAt),
  ].map(csvCell).join(','))

  return `\uFEFF${[headers.map(csvCell).join(','), ...body].join('\r\n')}`
}
