import type {
  OriginalScriptArtifact,
  RewrittenScriptArtifact,
  StoryboardArtifact,
  WorkflowQcReport,
  WorkflowQcViolation,
  WorkflowSkillQcRules,
  WorkflowStage,
} from './types'

export const WORKFLOW_STAGE_TIMEOUT_MS = 10 * 60 * 1000
export const WORKFLOW_MAX_SHOTS = 100

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function add(violations: WorkflowQcViolation[], rule: string, message: string, path: string) {
  violations.push({ rule, message, path })
}

export function assertStrictWorkflowArtifact(stage: WorkflowStage, raw: unknown, availableAssetIds?: readonly string[]): void {
  const record = asRecord(raw)
  if (stage === 'script_rewrite') {
    const scenes = record.scenes
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('S2 输出缺少非空 scenes，可能已被截断。')
    }
    if (scenes.length > WORKFLOW_MAX_SHOTS) throw new Error(`S2 场景数超过上限 ${WORKFLOW_MAX_SHOTS}。`)
    const ids = new Set<number>()
    scenes.forEach((entry, index) => {
      const scene = asRecord(entry)
      for (const key of ['sceneIndex', 'location', 'beat', 'visualAction', 'durationSec'] as const) {
        if (scene[key] === undefined || scene[key] === null || scene[key] === '') {
          throw new Error(`S2 场景 ${index + 1} 缺少 ${key}，可能已被截断。`)
        }
      }
      if (!isPositiveFinite(scene.durationSec)) throw new Error(`S2 场景 ${index + 1} 的 durationSec 非法。`)
      const sceneIndex = Number(scene.sceneIndex)
      if (ids.has(sceneIndex)) throw new Error(`S2 sceneIndex 重复：${sceneIndex}。`)
      ids.add(sceneIndex)
    })
  }

  if (stage === 'asset_extraction') {
    const items = record.items
    if (!Array.isArray(items) || items.length === 0) throw new Error('S3 输出缺少非空 items。')
    const ids = new Set<string>()
    items.forEach((entry, index) => {
      const item = asRecord(entry)
      for (const key of ['id', 'kind', 'name', 'imagePrompt'] as const) {
        if (typeof item[key] !== 'string' || !String(item[key]).trim()) {
          throw new Error(`S3 资产 ${index + 1} 缺少 ${key}，可能已被截断。`)
        }
      }
      if (ids.has(item.id as string)) throw new Error(`S3 资产 ID 重复：${String(item.id)}。`)
      ids.add(item.id as string)
    })
  }

  if (stage === 'storyboard') {
    const shots = record.shots
    if (!Array.isArray(shots) || shots.length === 0) {
      throw new Error('S4 输出缺少非空 shots，可能已被截断。')
    }
    if (shots.length > WORKFLOW_MAX_SHOTS) throw new Error(`S4 镜头数超过上限 ${WORKFLOW_MAX_SHOTS}。`)
    const ids = new Set<string>()
    const assets = new Set(availableAssetIds || [])
    shots.forEach((entry, index) => {
      const shot = asRecord(entry)
      for (const key of ['shotId', 'videoPrompt', 'visualDescription'] as const) {
        if (typeof shot[key] !== 'string' || !String(shot[key]).trim()) {
          throw new Error(`S4 镜头 ${index + 1} 缺少 ${key}，可能已被截断。`)
        }
      }
      if (!isPositiveFinite(shot.durationSec)) throw new Error(`S4 镜头 ${index + 1} 的 durationSec 非法。`)
      if (!Array.isArray(shot.referencedAssetIds)) throw new Error(`S4 镜头 ${index + 1} 缺少 referencedAssetIds。`)
      if (shot.referencedAssetIds.some((id) => typeof id !== 'string' || !id.trim() || (assets.size > 0 && !assets.has(id)))) {
        throw new Error(`S4 镜头 ${index + 1} 引用了非法资产。`)
      }
      if (ids.has(shot.shotId as string)) throw new Error(`S4 shotId 重复：${String(shot.shotId)}。`)
      ids.add(shot.shotId as string)
    })
  }
}

export function assertNormalizedWorkflowArtifact(stage: WorkflowStage, artifact: unknown, knownAssetIds?: readonly string[]): void {
  const record = asRecord(artifact)
  if (stage === 'script_rewrite') {
    const scenes = record.scenes
    if (!Array.isArray(scenes) || scenes.length === 0) throw new Error('S2 规范化结果缺少非空 scenes。')
    const ids = new Set<number>()
    for (const entry of scenes) {
      const scene = asRecord(entry)
      if (!isPositiveFinite(scene.durationSec) || typeof scene.visualAction !== 'string') {
        throw new Error('S2 规范化结果含不完整场景。')
      }
      const id = Number(scene.sceneIndex)
      if (ids.has(id)) throw new Error(`S2 sceneIndex 重复：${id}。`)
      ids.add(id)
    }
  }
  if (stage === 'asset_extraction') {
    const items = record.items
    if (!Array.isArray(items) || items.length === 0) throw new Error('S3 规范化结果缺少非空 items。')
    const ids = new Set<string>()
    for (const entry of items) {
      const id = asRecord(entry).id
      if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('S3 资产 ID 缺失或重复。')
      ids.add(id)
    }
  }
  if (stage === 'storyboard') {
    const shots = record.shots
    if (!Array.isArray(shots) || shots.length === 0) throw new Error('S4 规范化结果缺少非空 shots。')
    if (shots.length > WORKFLOW_MAX_SHOTS) throw new Error(`S4 镜头数超过上限 ${WORKFLOW_MAX_SHOTS}。`)
    const known = new Set(knownAssetIds || [])
    const ids = new Set<string>()
    shots.forEach((entry, index) => {
      const shot = asRecord(entry)
      const id = shot.shotId
      if (typeof id !== 'string' || !id || ids.has(id)) throw new Error(`S4 镜头 ${index + 1} ID 缺失或重复。`)
      ids.add(id)
      if (!isPositiveFinite(shot.durationSec)) throw new Error(`S4 镜头 ${index + 1} 时长非法。`)
      const refs = shot.referencedAssetIds
      if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== 'string' || !known.has(ref))) {
        throw new Error(`S4 镜头 ${index + 1} 引用了不存在的资产。`)
      }
    })
  }
}

export function evaluateWorkflowQuality(params: {
  stage: WorkflowStage
  artifact: OriginalScriptArtifact | RewrittenScriptArtifact | StoryboardArtifact | Record<string, unknown>
  qcRules?: WorkflowSkillQcRules | null
  retryCount?: number
  checkedAt?: Date
}): WorkflowQcReport {
  const violations: WorkflowQcViolation[] = []
  const rules = params.qcRules || {}
  const stage = params.stage
  const artifact = params.artifact as Record<string, unknown>
  const collectionKey = stage === 'script_analysis'
    ? 'beats'
    : stage === 'script_rewrite'
      ? 'scenes'
      : stage === 'storyboard'
        ? 'shots'
        : 'items'
  const collection = Array.isArray(artifact[collectionKey]) ? artifact[collectionKey] as unknown[] : []
  const text = textOf(
    stage === 'script_analysis'
      ? (artifact.editedScriptText ?? artifact.fullScriptText ?? artifact)
      : stage === 'script_rewrite'
        ? (artifact.fullScriptText ?? artifact)
        : artifact,
  )

  if (isPositiveFinite(rules.maxChars) && text.length > rules.maxChars) {
    add(violations, 'maxChars', `内容长度 ${text.length} 超过上限 ${Math.floor(rules.maxChars)}。`, collectionKey)
  }
  if (isPositiveFinite(rules.minShots) && collection.length < rules.minShots) {
    add(violations, 'minShots', `数量 ${collection.length} 少于下限 ${Math.floor(rules.minShots)}。`, collectionKey)
  }
  if (isPositiveFinite(rules.maxShots) && collection.length > rules.maxShots) {
    add(violations, 'maxShots', `数量 ${collection.length} 超过上限 ${Math.floor(rules.maxShots)}。`, collectionKey)
  }
  for (const keyword of Array.isArray(rules.requiredKeywords) ? rules.requiredKeywords : []) {
    if (typeof keyword === 'string' && keyword.trim() && !text.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())) {
      add(violations, 'requiredKeywords', `缺少必需关键词「${keyword.trim()}」。`, collectionKey)
    }
  }
  for (const keyword of Array.isArray(rules.forbiddenKeywords) ? rules.forbiddenKeywords : []) {
    if (typeof keyword === 'string' && keyword.trim() && text.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())) {
      add(violations, 'forbiddenKeywords', `包含禁用关键词「${keyword.trim()}」。`, collectionKey)
    }
  }

  return {
    status: violations.length > 0 ? 'failed' : 'passed',
    violations,
    retryCount: Math.max(0, Math.floor(params.retryCount || 0)),
    checkedAt: (params.checkedAt || new Date()).toISOString(),
  }
}

export function buildQcCorrectionPrompt(report: WorkflowQcReport): string {
  return [
    '上一次输出未通过机器质量检查。请完整重输出符合原 Schema 的 JSON，不要解释，不要省略任何镜头或字段。',
    ...report.violations.map((violation) => `- ${violation.rule} @ ${violation.path}: ${violation.message}`),
  ].join('\n')
}
