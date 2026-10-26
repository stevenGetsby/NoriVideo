import {
  FRAMEOS_ASSET_CATEGORY_LABELS,
  isFrameosAssetCategory,
} from '@/lib/frameos/material-category'

export interface ToolboxWorkTraceSource {
  type: string
  status: string
  modelId?: string | null
  errorMessage?: string | null
  params?: Record<string, unknown> | null
  createdAt?: string | null
  task?: {
    id?: string | null
    status?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    costPoints?: number | null
  } | null
}

export interface ToolboxWorkTraceReference {
  title: string
  type: string
  typeLabel: string
  roleLabel: string
  durationLabel: string | null
}

export interface ToolboxWorkTraceOption {
  label: string
  value: string
}

export interface ToolboxWorkTrace {
  title: string
  prompt: string
  status: string
  statusLabel: string
  statusTone: 'success' | 'failure' | 'active' | 'idle'
  model: string
  mode: string
  options: ToolboxWorkTraceOption[]
  references: ToolboxWorkTraceReference[]
  assetCategoryLabel: string | null
  costPoints: number | null
  costLabel: string
  errorCode: string | null
  errorMessage: string | null
  taskId: string | null
  createdAtLabel: string
}

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  queued: '排队中',
  processing: '生成中',
  running: '生成中',
  completed: '已完成',
  ready: '已完成',
  failed: '失败',
  cancelled: '已取消',
  canceled: '已取消',
}

const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  model3d: '3D',
}

const ROLE_LABELS: Record<string, string> = {
  REF: '参考',
  FIRST_FRAME: '首帧',
  LAST_FRAME: '尾帧',
}

const OPTION_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'aspectRatio', label: '画面比例' },
  { key: 'resolution', label: '分辨率' },
  { key: 'quality', label: '画质' },
  { key: 'duration', label: '视频时长' },
  { key: 'fps', label: '帧率' },
  { key: 'generateAudio', label: '同步生成声音' },
  { key: 'mode', label: '音频模式' },
  { key: 'voice', label: '音色' },
  { key: 'genre', label: '风格' },
  { key: 'sfxKind', label: '音效类型' },
  { key: 'topology', label: '拓扑' },
  { key: 'generateTexture', label: '生成贴图' },
  { key: 'pose', label: '姿态' },
]

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function toolboxModelLabel(modelId: string | null | undefined): string {
  const raw = text(modelId)
  if (!raw) return ''
  const body = raw.includes('::') ? raw.split('::').pop() || raw : raw
  const words = body
    .replace(/[-_]+/g, ' ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!words) return raw
  return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

function formatOption(key: string, value: unknown): string | null {
  if (typeof value === 'boolean') {
    if (key === 'generateTexture') return value ? '生成' : '不生成'
    return value ? '开启' : '关闭'
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (key === 'duration') return `${value} 秒`
    if (key === 'fps') return `${value} FPS`
    return String(value)
  }
  const raw = text(value)
  if (!raw) return null
  if (key === 'quality') {
    if (raw === 'low') return '低'
    if (raw === 'medium') return '中'
    if (raw === 'high') return '高'
  }
  if (key === 'resolution' && raw.toLowerCase() === '4k') return '4K'
  return raw
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10_000) / 10_000)
}

function formatDateTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function statusTone(status: string): ToolboxWorkTrace['statusTone'] {
  if (status === 'completed' || status === 'ready') return 'success'
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') return 'failure'
  if (status === 'processing' || status === 'running' || status === 'queued' || status === 'pending') return 'active'
  return 'idle'
}

function parseReferences(params: Record<string, unknown>): ToolboxWorkTraceReference[] {
  const summary = Array.isArray(params.referenceSummary) ? params.referenceSummary : []
  if (summary.length > 0) {
    return summary.flatMap((item, index) => {
      const source = record(item)
      const type = text(source.type)
      const title = text(source.title) || `参考素材 ${index + 1}`
      const duration = finiteNumber(source.durationSeconds)
      const role = text(source.role).toUpperCase()
      return [{
        title,
        type,
        typeLabel: TYPE_LABELS[type] || '素材',
        roleLabel: ROLE_LABELS[role] || (role ? role : '参考'),
        durationLabel: duration !== null && duration > 0
          ? `${Math.round(duration * 10) / 10} 秒`
          : null,
      }]
    })
  }
  const legacy = Array.isArray(params.referenceMaterials) ? params.referenceMaterials : []
  return legacy.flatMap((item, index) => {
    const source = record(item)
    const materialId = text(source.materialId)
    if (!materialId) return []
    const role = text(source.role).toUpperCase()
    return [{
      title: `参考素材 ${index + 1}`,
      type: '',
      typeLabel: '素材',
      roleLabel: ROLE_LABELS[role] || '参考',
      durationLabel: null,
    }]
  })
}

function resolveMode(type: string, inputMode: string, referenceCount: number): string {
  if (type === 'image') return '图片生成'
  if (type === 'audio') return '音频生成'
  if (type === 'model3d') return '3D 生成'
  if (inputMode === 'firstlastframe') return '首尾帧'
  if (inputMode === 'image') return '图生视频'
  return referenceCount > 0 ? '全能参考（图片 / 视频 / 音色）' : '文生视频（仅提示词）'
}

export function buildToolboxWorkTrace(
  source: ToolboxWorkTraceSource,
  options: { modelName?: string | null } = {},
): ToolboxWorkTrace {
  const params = record(source.params)
  const task = source.task || null
  const status = text(task?.status) || text(source.status) || 'pending'
  const references = parseReferences(params)
  const traceOptions = OPTION_FIELDS.flatMap(({ key, label }) => {
    const value = formatOption(key, params[key])
    return value ? [{ label, value }] : []
  })
  const category = text(params.assetCategory)
  const costValue = finiteNumber(task?.costPoints)
  const costPoints = costValue !== null && costValue >= 0 ? costValue : null
  const completed = status === 'completed' || status === 'ready'
  const failed = status === 'failed' || status === 'cancelled' || status === 'canceled'
  return {
    title: text(params.title) || '未命名生成',
    prompt: text(params.prompt),
    status,
    statusLabel: STATUS_LABELS[status] || status,
    statusTone: statusTone(status),
    model: text(options.modelName) || toolboxModelLabel(source.modelId) || '未记录',
    mode: resolveMode(source.type, text(params.inputMode), references.length),
    options: traceOptions,
    references,
    assetCategoryLabel: isFrameosAssetCategory(category) ? FRAMEOS_ASSET_CATEGORY_LABELS[category] : null,
    costPoints,
    costLabel: costPoints !== null
      ? `${formatPoints(costPoints)} 积分`
      : completed ? '未计费' : failed ? '无扣费记录' : '结算中',
    errorCode: text(task?.errorCode) || null,
    errorMessage: text(task?.errorMessage) || text(source.errorMessage) || null,
    taskId: text(task?.id) || null,
    createdAtLabel: formatDateTime(text(source.createdAt)),
  }
}

export function formatToolboxWorkTrace(trace: ToolboxWorkTrace): string {
  const lines: string[] = [
    `【工作留痕】${trace.title}`,
    `状态：${trace.statusLabel}`,
    `模型：${trace.model}`,
    `模式：${trace.mode}`,
    ...trace.options.map((option) => `${option.label}：${option.value}`),
  ]
  if (trace.assetCategoryLabel) lines.push(`资产归类：${trace.assetCategoryLabel}`)
  if (trace.references.length === 0) {
    lines.push('参考素材：无')
  } else {
    lines.push(`参考素材：${trace.references.length} 个`)
    for (const [index, item] of trace.references.entries()) {
      const detail = [item.typeLabel, item.roleLabel, item.durationLabel].filter(Boolean).join(' · ')
      lines.push(`  ${index + 1}. ${item.title}（${detail}）`)
    }
  }
  lines.push('提示词：', trace.prompt || '未记录')
  lines.push(`任务 ID：${trace.taskId || '未记录'}`)
  lines.push(`提交时间：${trace.createdAtLabel}`)
  lines.push(`消耗积分：${trace.costLabel}`)
  if (trace.errorCode || trace.errorMessage) {
    lines.push(`失败原因：${trace.errorCode ? `[${trace.errorCode}] ` : ''}${trace.errorMessage || '生成服务未返回错误详情'}`)
  }
  return lines.join('\n')
}
