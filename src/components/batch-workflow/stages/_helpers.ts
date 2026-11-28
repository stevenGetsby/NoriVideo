import type {
  OriginalScriptArtifact,
  OriginalScriptBeat,
  RewrittenScriptArtifact,
  RewrittenScriptScene,
  WorkflowAssetItem,
  WorkflowSkillModelPreferences,
  WorkflowQcReport,
  VideoGenShotEntry,
  VideoShotTake,
} from '@/lib/batch-workflow/types'

/**
 * Result wrapper for save / approve callbacks. Resolves to true when the
 * underlying callback resolves, false when it rejects. The view is responsible
 * for clearing dirty state ONLY on success.
 */
export async function trySave<T>(
  callback: (payload: T) => Promise<unknown> | unknown,
  payload: T,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await callback(payload)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '保存失败，请重试' }
  }
}

/**
 * S1: preserve fullScriptText, rebuild editedScriptText from beats when
 * any user-visible text field has been edited. Empty beats edit => drop
 * editedScriptText so the server falls back to fullScriptText.
 */
export function buildEditedScriptText(beats: OriginalScriptBeat[]): string {
  return beats
    .map((beat) => {
      const tc = beat.timecode && beat.timecode.trim()
        ? beat.timecode.trim()
        : `节拍 ${String(beat.beatIndex).padStart(2, '0')}`
      const lines = [`[${tc}] ${beat.sceneHeading || `节拍 ${beat.beatIndex}`}`]
      if (beat.visualAction?.trim()) lines.push(`画面：${beat.visualAction.trim()}`)
      if (beat.dialogue?.trim()) lines.push(`对白：${beat.dialogue.trim()}`)
      if (beat.voiceover?.trim()) lines.push(`旁白：${beat.voiceover.trim()}`)
      if (beat.sfxOrMusic?.trim()) lines.push(`音效/配乐：${beat.sfxOrMusic.trim()}`)
      return lines.join('\n')
    })
    .join('\n\n')
    .trim()
}

export function buildStage1Payload(
  draft: OriginalScriptArtifact,
  baseline: OriginalScriptArtifact | null,
): OriginalScriptArtifact {
  const original = baseline?.fullScriptText ?? draft.fullScriptText
  // Compare each editable text field per-beat against baseline; if any
  // diverges we persist an editedScriptText, otherwise leave it undefined
  // so the backend uses the immutable fullScriptText as-is.
  const baselineBeats = baseline?.beats ?? []
  let anyDiff = baselineBeats.length !== draft.beats.length
  if (!anyDiff) {
    for (let i = 0; i < draft.beats.length; i += 1) {
      const a = draft.beats[i]
      const b = baselineBeats[i]
      if (!b) { anyDiff = true; break }
      if (
        a.sceneHeading !== b.sceneHeading
        || a.visualAction !== b.visualAction
        || a.dialogue !== b.dialogue
        || (a.voiceover || '') !== (b.voiceover || '')
        || (a.sfxOrMusic || '') !== (b.sfxOrMusic || '')
        || (a.hookNote || '') !== (b.hookNote || '')
        || (a.timecode || '') !== (b.timecode || '')
      ) { anyDiff = true; break }
    }
  }
  return {
    ...draft,
    fullScriptText: original,
    editedScriptText: anyDiff ? buildEditedScriptText(draft.beats) : undefined,
  }
}

/**
 * S2: align each rewritten scene against original beats via sourceBeatId.
 * Falls back to undefined when no ID exists - the UI surfaces "未对齐".
 */
export interface S2Alignment {
  origBeat: OriginalScriptBeat | null
  aligned: boolean
  added: boolean
}
export function alignSceneToBeat(
  scene: RewrittenScriptScene,
  originalBeats: OriginalScriptBeat[],
): S2Alignment {
  const id = scene.sourceBeatId?.trim()
  if (!id) return { origBeat: null, aligned: false, added: false }
  const found = originalBeats.find((b) => String(b.beatIndex) === id)
  if (found) return { origBeat: found, aligned: true, added: false }
  return { origBeat: null, aligned: false, added: false }
}

export function diffS2Scenes(
  scenes: RewrittenScriptScene[],
  originalBeats: OriginalScriptBeat[],
): { added: number; removed: number; unaligned: number; aligned: number } {
  const sourceIds = new Set(scenes.map((scene) => scene.sourceBeatId?.trim()).filter(Boolean))
  const originalIds = new Set(originalBeats.map((beat) => String(beat.beatIndex)))
  return {
    ...countS2Diffs(scenes, originalBeats),
    added: scenes.filter((scene) => {
      const id = scene.sourceBeatId?.trim()
      return Boolean(id && !originalIds.has(id!))
    }).length,
    removed: originalBeats.filter((beat) => !sourceIds.has(String(beat.beatIndex))).length,
  }
}

export function countS2Diffs(
  scenes: RewrittenScriptScene[],
  originalBeats: OriginalScriptBeat[],
): { aligned: number; unaligned: number; added: number } {
  let aligned = 0
  let unaligned = 0
  let added = 0
  scenes.forEach((scene) => {
    const result = alignSceneToBeat(scene, originalBeats)
    if (!result.aligned) unaligned += 1
    else aligned += 1
    if (scene.sourceBeatId?.trim() && !result.origBeat) added += 1
  })
  return { aligned, unaligned, added }
}

/** S3: only ready/reused versions are selectable. */
export function isVersionSelectable(status: WorkflowAssetItem['status']): boolean {
  return status === 'ready' || status === 'reused'
}

/** S3: pick the CSS class name for an asset's displayed aspect ratio. */
export function aspectRatioClassFromValue(ratio: string | null | undefined): string {
  if (!ratio) return ''
  const trimmed = ratio.trim()
  if (trimmed === '9:16' || trimmed === '3:4') return 'is-portrait'
  if (trimmed === '1:1') return 'is-square'
  if (trimmed === '16:9' || trimmed === '4:3') return 'is-landscape'
  return ''
}

/** S4: unified chip matching predicate - compare ID first, fall back to name. */
export function isAssetChipBound(
  shot: { referencedAssetIds: string[]; referencedAssetNames: string[] },
  asset: { id: string; name: string },
): boolean {
  return (shot.referencedAssetIds || []).includes(asset.id)
    || (shot.referencedAssetNames || []).includes(asset.name)
}

export function normalizeDurationBounds(
  modelRange?: { min?: number; max?: number } | null,
  artifactRange?: { min?: number; max?: number } | null,
): { min: number; max: number } {
  const requestedMin = modelRange?.min ?? artifactRange?.min ?? 4
  const requestedMax = modelRange?.max ?? artifactRange?.max ?? 15
  const min = Math.max(1, Number.isFinite(requestedMin) ? requestedMin : 4)
  const max = Math.max(min, Number.isFinite(requestedMax) ? requestedMax : min)
  return { min, max }
}

export function durationOptions(
  bounds: { min: number; max: number },
  current?: number,
): number[] {
  const presets = [4, 5, 6, 8, 10, 12, 15, 20, 30]
    .filter((value) => value >= bounds.min && value <= bounds.max)
  const normalizedCurrent = current == null ? null : clampDurationSec(current, bounds)
  return Array.from(new Set([
    ...(presets.length > 0 ? presets : [bounds.min, bounds.max]),
    ...(normalizedCurrent == null ? [] : [normalizedCurrent]),
  ])).sort((a, b) => a - b)
}

/** S4/S5: clamp an arbitrary duration to a model's allowed range. */
export function clampDurationSec(
  value: number,
  range: { min: number; max: number } | null | undefined,
): number {
  if (!Number.isFinite(value)) return range?.min ?? 5
  if (!range) return Math.max(1, value)
  return Math.min(range.max, Math.max(range.min, value))
}

/** S5: true when at least one ready take exists with a playable url. */
export function isShotPlayable(
  shot: VideoGenShotEntry,
  urlResolver: (take: VideoShotTake | null) => string | null,
): boolean {
  if (!Array.isArray(shot.takes) || shot.takes.length === 0) return false
  if (shot.selectedTakeIndex >= 0 && shot.selectedTakeIndex < shot.takes.length) {
    const take = shot.takes[shot.selectedTakeIndex]
    if (take?.status === 'ready' && urlResolver(take)) return true
  }
  return shot.takes.some((t) => t.status === 'ready' && urlResolver(t))
}

/**
 * S5 sequential playback helper: return the next shot index (>= from+1) that
 * has a ready take with a playable URL. Returns -1 when none.
 */
export function findNextPlayableShotIndex(
  shots: VideoGenShotEntry[],
  from: number,
  urlResolver: (take: VideoShotTake | null) => string | null,
): number {
  for (let i = from + 1; i < shots.length; i += 1) {
    if (isShotPlayable(shots[i], urlResolver)) return i
  }
  return -1
}

/** S5: manual navigation should skip shots that have no playable take. */
export function findNavigableShotIndex(
  shots: VideoGenShotEntry[],
  from: number,
  direction: -1 | 1,
  urlResolver: (take: VideoShotTake | null) => string | null,
): number {
  for (let idx = from + direction; idx >= 0 && idx < shots.length; idx += direction) {
    if (isShotPlayable(shots[idx], urlResolver)) return idx
  }
  return -1
}

export function createStage5ItemState(): {
  activeShotIndex: number
  editingShotId: string | null
  editPrompt: string
  editDuration: number
  isPlaying: boolean
} {
  return { activeShotIndex: 0, editingShotId: null, editPrompt: '', editDuration: 5, isPlaying: false }
}

export async function runSaveOperation(
  callback: () => Promise<unknown> | unknown,
): Promise<{ dirty: boolean; error: string | null }> {
  try {
    await callback()
    return { dirty: false, error: null }
  } catch (err) {
    return { dirty: true, error: err instanceof Error ? err.message : '保存失败，请重试' }
  }
}

/** Skill Dock: flatten modelPreferences diff into a list of human-readable lines. */
const MODEL_PREF_LABELS: Record<keyof WorkflowSkillModelPreferences, string> = {
  llmModelKey: 'LLM 模型',
  imageModelKey: '生图模型',
  videoModelKey: '视频模型',
  temperature: '温度',
  aspectRatio: '画幅',
  resolution: '分辨率',
  durationSeconds: '时长',
  generateAudio: '含音效',
  defaultStageParams: '阶段默认参数',
}

export function diffModelPreferences(
  prev: WorkflowSkillModelPreferences | null | undefined,
  next: WorkflowSkillModelPreferences | null | undefined,
): Array<{ key: keyof WorkflowSkillModelPreferences; label: string; before: string; after: string }> {
  const before = prev || {}
  const after = next || {}
  const keys = new Set<keyof WorkflowSkillModelPreferences>([
    ...(Object.keys(before) as Array<keyof WorkflowSkillModelPreferences>),
    ...(Object.keys(after) as Array<keyof WorkflowSkillModelPreferences>),
  ])
  const out: Array<{ key: keyof WorkflowSkillModelPreferences; label: string; before: string; after: string }> = []
  const fmt = (v: unknown): string => {
    if (v === undefined || v === null || v === '') return '（未设置）'
    if (typeof v === 'boolean') return v ? '开' : '关'
    if (typeof v === 'object') {
      try { return JSON.stringify(v) } catch { return String(v) }
    }
    return String(v)
  }
  keys.forEach((k) => {
    const b = before[k]
    const a = after[k]
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ key: k, label: MODEL_PREF_LABELS[k] || String(k), before: fmt(b), after: fmt(a) })
    }
  })
  return out
}

/** QC helper: a stable sort so violation rendering is deterministic. */
export function sortQcViolations(report: WorkflowQcReport | null | undefined) {
  if (!report || !Array.isArray(report.violations)) return []
  return [...report.violations].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    return a.rule.localeCompare(b.rule)
  })
}

/** S5 trial-cost banner copy. */
export function describeTrialCost(isDryRun: boolean): string {
  return isDryRun
    ? '当前为 dry-run：不会真实提交生视频任务，仅返回合并后的参数与模型/时长预估，用于校对。'
    : '真实试跑将实际提交一次视频生成任务并扣减视频生成额度，请确认后操作。'
}

/**
 * Skill Library / Dock: detect a summary-only WorkflowSkill (no prompt content)
 * so the UI can disable editing and surface the permission hint instead of
 * crashing on missing fields.
 */
export function isSkillSummaryOnly(skill: { systemPrompt?: string | null } | null | undefined): boolean {
  if (!skill) return false
  return typeof skill.systemPrompt !== 'string'
}

/**
 * Build the PATCH body for a metadata-only save (no saveAsNewVersion). The
 * payload MUST not include any content fields (systemPrompt / fewShotExamples
 * / qcRules / modelPreferences) or the backend will reject with INVALID_PARAMS
 * because published versions are immutable.
 */
export function buildSkillMetaPatch(input: {
  name: string
  description: string | null
  isDefault: boolean
  changeNote?: string | null
}): { name: string; description: string | null; isDefault: boolean; changeNote?: string } {
  const out: { name: string; description: string | null; isDefault: boolean; changeNote?: string } = {
    name: input.name.trim(),
    description: input.description,
    isDefault: input.isDefault,
  }
  if (input.changeNote && input.changeNote.trim()) out.changeNote = input.changeNote.trim()
  return out
}

/**
 * Skill Library / Dock: build a save-as-new-version PATCH body. Always sets
 * `saveAsNewVersion: true` and includes content fields.
 */
export function buildSkillPublishPatch(input: {
  name: string
  description: string | null
  isDefault: boolean
  systemPrompt: string
  fewShotExamples: Array<{ title: string; input: string; output: string }>
  qcRules: unknown
  modelPreferences?: unknown
  changeNote?: string | null
}): Record<string, unknown> {
  return {
    saveAsNewVersion: true,
    name: input.name.trim(),
    description: input.description,
    isDefault: input.isDefault,
    systemPrompt: input.systemPrompt.trim(),
    fewShotExamples: input.fewShotExamples,
    qcRules: input.qcRules ?? null,
    ...(input.modelPreferences !== undefined ? { modelPreferences: input.modelPreferences } : {}),
    ...(input.changeNote && input.changeNote.trim() ? { changeNote: input.changeNote.trim() } : {}),
  }
}

/**
 * Skill Dock S5 trial: decide whether a real (cost-incurring) trial can fire.
 * Requires explicit confirmCost=true and a non-empty shotId. Returns null if OK,
 * otherwise a short Chinese error string the UI should surface.
 */
export function validateRealTrialRequest(input: {
  confirmCost: boolean
  shotId: string | null | undefined
}): string | null {
  if (!input.confirmCost) return '请先勾选「确认消耗视频额度」后再发起真实试跑。'
  if (!input.shotId || !input.shotId.trim()) return '请先选择要试跑的单镜（shotId）后再发起真实试跑。'
  return null
}

/**
 * Skill Dock S5 dry-run: flatten an arbitrary dry-run parameters object into a
 * stable list of {key,value} rows for defensive rendering. Arrays/objects are
 * JSON-encoded so the table never crashes on unexpected field shapes.
 */
export function flattenDryRunParams(output: unknown): Array<{ key: string; value: string }> {
  if (!output || typeof output !== 'object') return []
  const root = output as Record<string, unknown>
  // Prefer a nested "params" bag if the backend shipped one; otherwise flatten
  // every top-level key on the dry-run response (excluding the dryRun marker).
  const source: Record<string, unknown> =
    root.params && typeof root.params === 'object' && !Array.isArray(root.params)
      ? (root.params as Record<string, unknown>)
      : root
  const fmt = (v: unknown): string => {
    if (v === undefined) return '（未设置）'
    if (v === null) return 'null'
    if (typeof v === 'boolean') return v ? '是' : '否'
    if (typeof v === 'number' || typeof v === 'string') return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return Object.keys(source)
    .filter((k) => k !== 'dryRun')
    .sort()
    .map((key) => ({ key, value: fmt(source[key]) }))
}
