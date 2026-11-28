/**
 * 5-Stage Skill-Pluggable Video Workflow — Shared Contracts & Pure Helpers.
 *
 * Pipeline:
 *   Video (or skipped pasted script)
 *   -> [1. script_analysis 剧本解析] -> OriginalScriptArtifact
 *   -> [2. script_rewrite 剧本洗稿] -> RewrittenScriptArtifact
 *   -> [3. asset_extraction 解析资产 & 批量出图] -> AssetsArtifact (character/location/prop)
 *   -> [4. storyboard 处理分镜] -> StoryboardArtifact (@asset mentions)
 *   -> [5. video_gen 批量生视频] -> VideoGenArtifact (multi-take shots + Materialize to Canvas)
 *
 * IMPORTANT: 100% browser/client-safe. Do NOT import Node built-ins, Prisma, or server modules here.
 */

export const WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE = 'short_drama_commerce' as const
export const WORKFLOW_TRACK_DRAMA_REMAKE = 'drama_remake' as const
export const WORKFLOW_TRACK_FILM_STYLE_REMAKE = 'film_style_remake' as const

export const WORKFLOW_TRACKS = [
  WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
  WORKFLOW_TRACK_DRAMA_REMAKE,
  WORKFLOW_TRACK_FILM_STYLE_REMAKE,
] as const

export type WorkflowTrack = (typeof WORKFLOW_TRACKS)[number]

// Backwards-friendly track constant alias
export const BATCH_WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE = WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE

export const WORKFLOW_TRACK_LABELS: Record<string, string> = {
  [WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE]: '漫剧 / 短剧带货',
  [WORKFLOW_TRACK_DRAMA_REMAKE]: '爆款短剧二创',
  [WORKFLOW_TRACK_FILM_STYLE_REMAKE]: '影视风格翻拍',
}

export const BATCH_WORKFLOW_TRACK_LABELS = WORKFLOW_TRACK_LABELS

export const WORKFLOW_STAGES = [
  'script_analysis',
  'script_rewrite',
  'asset_extraction',
  'storyboard',
  'video_gen',
] as const

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

// Backwards-friendly stage aliases
export const BATCH_WORKFLOW_STAGES = WORKFLOW_STAGES
export type BatchWorkflowStage = WorkflowStage

export type WorkflowGateMode = 'auto' | 'manual_review'
export type BatchRunMode = 'gated' | 'auto'
export type BatchRunStatus = 'draft' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'paused'
export type BatchItemStatus = 'queued' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'skipped'
export type BatchStageExecutionStatus =
  | 'pending'
  | 'running'
  | 'waiting_review'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'skipped'

export const BATCH_RUN_MODE_VALUES: readonly BatchRunMode[] = ['gated', 'auto']
export const BATCH_RUN_STATUS_VALUES: readonly BatchRunStatus[] = [
  'draft',
  'running',
  'waiting_review',
  'completed',
  'failed',
  'paused',
]
export const BATCH_ITEM_STATUS_VALUES: readonly BatchItemStatus[] = [
  'queued',
  'running',
  'waiting_review',
  'completed',
  'failed',
  'skipped',
]
export const WORKFLOW_GATE_MODE_VALUES: readonly WorkflowGateMode[] = ['auto', 'manual_review']

export interface WorkflowStageMeta {
  stage: WorkflowStage
  code: 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
  label: string
  shortLabel: string
  description: string
  accentToken: string
  defaultGateMode: WorkflowGateMode
  consumesImageCredits?: boolean
  consumesVideoCredits?: boolean
}

export type BatchStageMeta = WorkflowStageMeta

export const WORKFLOW_STAGE_META: Record<WorkflowStage, WorkflowStageMeta> = {
  script_analysis: {
    stage: 'script_analysis',
    code: 'S1',
    label: '剧本解析',
    shortLabel: 'S1 解析',
    description: '调用火山方舟多模态理解拆解参考视频（或直接粘贴已有剧本跳过视频解析），沉淀结构化原剧本与节奏钩子',
    accentToken: '--fos-hue-project',
    defaultGateMode: 'manual_review',
  },
  script_rewrite: {
    stage: 'script_rewrite',
    code: 'S2',
    label: '剧本洗稿',
    shortLabel: 'S2 洗稿',
    description: '基于风格 Skill 对原剧本进行爆款改编、冲突强化、带货植入或影视风格迁移，并对比展示改编要点',
    accentToken: '--fos-hue-script',
    defaultGateMode: 'manual_review',
  },
  asset_extraction: {
    stage: 'asset_extraction',
    code: 'S3',
    label: '解析资产 & 出图',
    shortLabel: 'S3 资产',
    description: '提取角色、场景、道具与视觉画风规范，优先复用工作区已有素材，并支持批量出图、单卡重抽与角色音色绑定',
    accentToken: '--fos-hue-asset',
    defaultGateMode: 'manual_review',
    consumesImageCredits: true,
  },
  storyboard: {
    stage: 'storyboard',
    code: 'S4',
    label: '处理分镜',
    shortLabel: 'S4 分镜',
    description: '结合目标视频模型能力自动约束时长与模式，生成含 @资产 提及语法的 Seedance 四层运镜分镜提示词',
    accentToken: '--fos-hue-canvas',
    defaultGateMode: 'manual_review',
  },
  video_gen: {
    stage: 'video_gen',
    code: 'S5',
    label: '批量生视频',
    shortLabel: 'S5 视频',
    description: '按分镜挂载参考图与角色音色提交真实视频任务，支持单镜抽卡多版本（Takes）对比选片与一键展开至无限画布',
    accentToken: '--fos-hue-video',
    defaultGateMode: 'auto',
    consumesVideoCredits: true,
  },
}

export const BATCH_STAGE_META = WORKFLOW_STAGE_META

// ============================================================
// Global Model Config & Per-Stage Parameters
// ============================================================

export type VideoAspectRatio = '9:16' | '16:9' | '3:4' | '4:3' | '1:1' | '21:9' | 'adaptive'
export type VideoInputMode = 'text' | 'image' | 'firstlastframe'
export type ImageQualityLevel = 'low' | 'medium' | 'high'

export interface WorkflowModelConfig {
  textModelKey: string
  imageModelKey: string
  videoModelKey: string
  textCreativity: number
  imageResolution: string
  imageQuality: ImageQualityLevel
  videoAspectRatio: VideoAspectRatio
  videoResolution: string
  videoDurationSeconds: number
  videoGenerateAudio: boolean
  videoInputMode: VideoInputMode
}

export const DEFAULT_WORKFLOW_MODEL_CONFIG: WorkflowModelConfig = {
  textModelKey: 'nori::nori-gpt',
  imageModelKey: 'nori::nori-image',
  videoModelKey: 'nori::norivideo2.5',
  textCreativity: 0.6,
  imageResolution: 'auto',
  imageQuality: 'high',
  videoAspectRatio: '9:16',
  videoResolution: '720p',
  videoDurationSeconds: 5,
  videoGenerateAudio: true,
  videoInputMode: 'text',
}

export interface ScriptAnalysisStageParams {
  samplingPreset?: 'standard' | 'detailed' | 'fast'
  detectSceneCuts?: boolean
  customInstruction?: string
  targetStage?: 'script_rewrite' | 'asset_extraction' | null
}

export interface ScriptRewriteStageParams {
  rewriteIntensity?: 'light' | 'medium' | 'heavy'
  targetDurationSec?: number
  tone?: string
  productBrief?: {
    productName?: string
    sellingPoints?: string[]
    hookAngle?: string
    ctaText?: string
  }
  customInstruction?: string
}

export interface AssetExtractionStageParams {
  artStyle?: string
  preferWorkspaceReuse?: boolean
  autoGenerateImages?: boolean
  maxAssetsPerKind?: number
  customInstruction?: string
}

export interface StoryboardStageParams {
  targetShotCount?: number
  pacingStyle?: string
  maxShotDurationSec?: number
  customInstruction?: string
}

export interface VideoGenStageParams {
  aspectRatio?: VideoAspectRatio
  resolution?: string
  durationSeconds?: number
  generateAudio?: boolean
  inputMode?: VideoInputMode
  customInstruction?: string
}

export interface WorkflowStageParamsMap {
  script_analysis?: ScriptAnalysisStageParams
  script_rewrite?: ScriptRewriteStageParams
  asset_extraction?: AssetExtractionStageParams
  storyboard?: StoryboardStageParams
  video_gen?: VideoGenStageParams
}

export type StageParams =
  | ScriptAnalysisStageParams
  | ScriptRewriteStageParams
  | AssetExtractionStageParams
  | StoryboardStageParams
  | VideoGenStageParams

// ============================================================
// Skill & Template Definitions (Immutable Versioned Skills)
// ============================================================

export interface WorkflowSkillFewShotExample {
  title: string
  input: string
  output: string
}

export interface WorkflowSkillModelPreferences {
  llmModelKey?: string
  imageModelKey?: string
  videoModelKey?: string
  temperature?: number
  aspectRatio?: VideoAspectRatio
  resolution?: string
  durationSeconds?: number
  generateAudio?: boolean
  defaultStageParams?: Record<string, unknown> | null
}

export interface WorkflowSkillQcRules {
  maxChars?: number
  minShots?: number
  maxShots?: number
  maxShotDurationSec?: number
  requiredKeywords?: string[]
  forbiddenKeywords?: string[]
  checklist?: string[]
}

export interface WorkflowSkillDTO {
  id: string
  userId: string | null
  isBuiltin: boolean
  slug: string
  name: string
  track: string
  stage: WorkflowStage
  version: number
  parentSkillId: string | null
  changeNote: string | null
  isDefault: boolean
  description: string | null
  systemPrompt: string
  fewShotExamples: WorkflowSkillFewShotExample[]
  outputSchema: Record<string, unknown> | null
  modelPreferences: WorkflowSkillModelPreferences | null
  qcRules: WorkflowSkillQcRules | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplateStageConfig {
  stage: WorkflowStage
  label: string
  skillSlug: string
  skillId?: string | null
  gateMode: WorkflowGateMode
  enabled: boolean
  modelKey?: string | null
  options?: Record<string, unknown> | null
}

export interface WorkflowTemplateDTO {
  id: string
  userId: string | null
  isBuiltin: boolean
  slug: string
  name: string
  track: string
  description: string | null
  stages: WorkflowTemplateStageConfig[]
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplateSnapshot extends WorkflowTemplateDTO {
  modelConfig: WorkflowModelConfig
  stageParams: WorkflowStageParamsMap
}

export interface SkillRefineProposal {
  skillId: string
  skillSlug: string
  baseVersion: number
  stage: WorkflowStage
  changeSummary: string[]
  nextName?: string
  nextDescription?: string | null
  nextSystemPrompt: string
  nextFewShotExamples: WorkflowSkillFewShotExample[]
  nextQcRules: WorkflowSkillQcRules | null
  nextModelPreferences: WorkflowSkillModelPreferences | null
  changeNote: string
  modelKey: string
}

// ============================================================
// Batch Item Inputs & 5-Stage Artifact Contracts
// ============================================================

export type BatchItemSourceType = 'video' | 'pasted_script'

export interface BatchItemInputPayload {
  sourceType?: BatchItemSourceType
  // Option A: Start from an uploaded or library video
  sourceVideoMaterialId?: string | null
  sourceVideoStorageKey?: string | null
  sourceVideoUrl?: string | null
  sourceVideoFileName?: string | null
  sourceVideoDurationSec?: number | null
  // Option B: Skip video analysis and paste/import an existing script directly
  skipVideoAnalysis?: boolean
  pastedScript?: string | null
  // Optional creative / commerce brief metadata
  aspectRatio?: VideoAspectRatio
  durationTargetSec?: number
  styleNotes?: string
  productName?: string
  sellingPoints?: string[]
  hookAngle?: string
  ctaText?: string
  extraNotes?: string
  // Pre-bound workspace material IDs (optional)
  referenceMaterialIds?: string[]
}

export interface WorkflowQcViolation {
  rule: string
  message: string
  path: string
}

export interface WorkflowQcReport {
  status: 'passed' | 'warning' | 'failed'
  violations: WorkflowQcViolation[]
  retryCount: number
  checkedAt: string
}

// Stage 1: script_analysis -> OriginalScriptArtifact
export interface OriginalScriptBeat {
  beatIndex: number
  startSec?: number | null
  endSec?: number | null
  timecode?: string
  sceneHeading: string
  visualAction: string
  dialogue: string
  voiceover?: string
  sfxOrMusic?: string
  hookNote?: string
}

export interface OriginalScriptArtifact {
  sourceMode: 'video_analysis' | 'pasted_script'
  title: string
  summary: string
  genre?: string
  estimatedDurationSec: number
  hookAnalysis?: string
  characters: Array<{
    name: string
    role: string
    traits: string
    visualNote?: string
  }>
  locations: Array<{
    name: string
    description: string
  }>
  props: Array<{
    name: string
    description: string
  }>
  beats: OriginalScriptBeat[]
  fullScriptText: string
  editedScriptText?: string
  qc?: WorkflowQcReport
  cutHints?: number[]
  arkFileId?: string | null
  arkModel?: string | null
  rawAnalysisText?: string | null
}

// Stage 2: script_rewrite -> RewrittenScriptArtifact
export interface RewrittenScriptScene {
  sceneIndex: number
  sourceBeatId?: string
  location: string
  beat: string
  visualAction: string
  dialogue: string
  voiceover?: string
  onscreenText?: string
  highlightNote?: string
  durationSec: number
}

export interface RewrittenScriptArtifact {
  title: string
  styleTag: string
  rewriteSummary: string
  changeHighlights: string[]
  hookLine3s: string
  estimatedDurationSec: number
  conflictArc: {
    hook: string
    escalation: string
    twistOrReveal: string
    climaxOrDemo: string
    ctaOrEnding: string
  }
  characters: Array<{
    name: string
    role: string
    persona: string
    voiceTone: string
  }>
  scenes: RewrittenScriptScene[]
  fullScriptText: string
  qc?: WorkflowQcReport
}

// Stage 3: asset_extraction -> AssetsArtifact (character | location | prop + versions[])
export type WorkflowAssetKind = 'character' | 'location' | 'prop'
export type WorkflowAssetImageStatus = 'pending' | 'reused' | 'queued' | 'processing' | 'ready' | 'failed'

export interface WorkflowAssetImageVersion {
  versionIndex: number
  materialId?: string | null
  toolboxAssetId?: string | null
  taskId?: string | null
  imageUrl?: string | null
  storageKey?: string | null
  prompt: string
  modelKey?: string | null
  aspectRatio: string
  resolution?: string | null
  source: 'generated' | 'workspace_reused' | 'manual_bound'
  status: WorkflowAssetImageStatus
  errorMessage?: string | null
  createdAt: string
}

export interface WorkflowAssetItem {
  id: string
  kind: WorkflowAssetKind
  name: string
  aliases: string[]
  roleOrUsage: string
  description: string
  voiceProfile?: string
  voiceMaterialId?: string | null
  voiceMaterialTitle?: string | null
  voiceMaterialUrl?: string | null
  imagePrompt: string
  aspectRatio: VideoAspectRatio
  status: WorkflowAssetImageStatus
  materialId?: string | null
  imageUrl?: string | null
  storageKey?: string | null
  toolboxAssetId?: string | null
  taskId?: string | null
  errorMessage?: string | null
  versions: WorkflowAssetImageVersion[]
  selectedVersionIndex: number
}

export interface AssetsArtifact {
  styleBible: string
  colorPalette: string
  lightingDirection: string
  items: WorkflowAssetItem[]
  readyCount: number
  totalCount: number
  pendingCount: number
  failedCount: number
  qc?: WorkflowQcReport
}

// Stage 4: storyboard -> StoryboardArtifact (shots[] + referencedAssetIds[] + @mention prompts)
export interface StoryboardShotItem {
  shotId: string
  shotIndex: number
  sceneIndex: number
  title: string
  durationSec: number
  shotType: string
  cameraMovement: string
  visualDescription: string
  firstFramePrompt?: string
  videoPrompt: string
  dialogue?: string
  onscreenText?: string
  referencedAssetIds: string[]
  referencedAssetNames: string[]
  inputMode: VideoInputMode
  negativeConstraints: string
}

export interface StoryboardArtifact {
  aspectRatio: VideoAspectRatio
  totalDurationSec: number
  pacingStyle: string
  videoModelKey: string
  supportsFirstLastFrame: boolean
  allowedDurationRange: { min: number; max: number }
  shots: StoryboardShotItem[]
  qc?: WorkflowQcReport
}

// Stage 5: video_gen -> VideoGenArtifact (shots[] + takes[] + selectedTakeIndex)
export type VideoTakeStatus = 'pending' | 'queued' | 'processing' | 'ready' | 'failed'

export interface VideoShotTake {
  takeIndex: number
  taskId?: string | null
  assetId?: string | null
  materialId?: string | null
  videoUrl?: string | null
  storageKey?: string | null
  posterUrl?: string | null
  prompt: string
  modelKey: string
  inputMode: VideoInputMode
  aspectRatio: VideoAspectRatio
  resolution: string
  durationSec: number
  generateAudio: boolean
  status: VideoTakeStatus
  errorMessage?: string | null
  submittedAt: string
  completedAt?: string | null
}

export interface VideoGenShotOverride {
  durationSeconds?: number
  prompt?: string
  inputMode?: VideoInputMode
}

export interface VideoGenShotEntry {
  shotId: string
  shotIndex: number
  title: string
  durationSec: number
  prompt: string
  referencedAssetIds: string[]
  takes: VideoShotTake[]
  selectedTakeIndex: number
}

export interface VideoGenArtifact {
  modelKey: string
  aspectRatio: VideoAspectRatio
  resolution: string
  generateAudio: boolean
  inputMode: VideoInputMode
  shots: VideoGenShotEntry[]
  readyCount: number
  totalCount: number
  pendingCount: number
  failedCount: number
  qc?: WorkflowQcReport
}

// ============================================================
// Batch Item & Run State Contracts
// ============================================================

export interface BatchStageState {
  status: BatchStageExecutionStatus
  skillSlug: string
  skillId?: string | null
  skillName?: string | null
  skillVersion?: number
  qcStatus?: WorkflowQcReport['status']
  attempt?: number
  modelKey?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  durationMs?: number | null
  error?: string | null
  reviewNote?: string | null
  taskIds?: string[]
  stale?: boolean
  staleReason?: string | null
  trialPending?: boolean
}

export type BatchItemStageState = BatchStageState

export interface BatchItemStageOutputs {
  script_analysis?: OriginalScriptArtifact
  script_rewrite?: RewrittenScriptArtifact
  asset_extraction?: AssetsArtifact
  storyboard?: StoryboardArtifact
  video_gen?: VideoGenArtifact
  canvasId?: string | null
}

export interface BatchItemDTO {
  id: string
  batchRunId: string
  revision?: number
  executionKey?: string | null
  index: number
  title: string
  inputPayload: BatchItemInputPayload
  currentStage: WorkflowStage
  status: BatchItemStatus
  stageStates: Record<WorkflowStage, BatchStageState>
  stageOutputs: BatchItemStageOutputs
  errorMessage: string | null
  hasPendingAsyncTasks: boolean
  createdAt: string
  updatedAt: string
}

export interface BatchRunDTO {
  id: string
  userId: string
  createdById: string
  workId: string | null
  projectId: string
  templateId: string
  templateSnapshot: WorkflowTemplateSnapshot
  modelConfig: WorkflowModelConfig
  title: string
  track: string
  runMode: BatchRunMode
  status: BatchRunStatus
  totalItems: number
  completedItems: number
  failedItems: number
  hasPendingAsyncTasks: boolean
  createdAt: string
  updatedAt: string
  items?: BatchItemDTO[]
}

// ============================================================
// API Input / Response Contracts
// ============================================================

export interface CreateWorkflowSkillInput {
  slug?: string
  name: string
  track?: string
  stage: WorkflowStage
  description?: string | null
  systemPrompt: string
  fewShotExamples?: WorkflowSkillFewShotExample[]
  outputSchema?: Record<string, unknown> | null
  modelPreferences?: WorkflowSkillModelPreferences | null
  qcRules?: WorkflowSkillQcRules | null
  isDefault?: boolean
  cloneFromSkillId?: string | null
  parentSkillId?: string | null
  changeNote?: string | null
}

export interface UpdateWorkflowSkillInput {
  name?: string
  description?: string | null
  systemPrompt?: string
  fewShotExamples?: WorkflowSkillFewShotExample[]
  outputSchema?: Record<string, unknown> | null
  modelPreferences?: WorkflowSkillModelPreferences | null
  qcRules?: WorkflowSkillQcRules | null
  isDefault?: boolean
  changeNote?: string | null
}

export interface PublishWorkflowSkillVersionInput {
  name?: string
  description?: string | null
  systemPrompt?: string
  fewShotExamples?: WorkflowSkillFewShotExample[]
  outputSchema?: Record<string, unknown> | null
  modelPreferences?: WorkflowSkillModelPreferences | null
  qcRules?: WorkflowSkillQcRules | null
  isDefault?: boolean
  changeNote?: string | null
}

export interface CreateWorkflowTemplateInput {
  slug?: string
  name: string
  track?: string
  description?: string | null
  stages: WorkflowTemplateStageConfig[]
  isDefault?: boolean
  cloneFromTemplateId?: string | null
}

export interface UpdateWorkflowTemplateInput {
  name?: string
  description?: string | null
  stages?: WorkflowTemplateStageConfig[]
  isDefault?: boolean
}

export interface BatchRunItemSeedInput {
  title?: string
  input: BatchItemInputPayload
}

export interface CreateBatchRunInput {
  projectId: string
  workId?: string | null
  templateId?: string | null
  track?: string | null
  title?: string
  runMode?: BatchRunMode
  modelConfig?: Partial<WorkflowModelConfig> | null
  stageSkillOverrides?: Record<string, string> | null
  stageParams?: WorkflowStageParamsMap | null
  items?: BatchRunItemSeedInput[]
}

export interface CreateInitialBatchRunForProjectInput {
  templateId?: string | null
  track?: string | null
  runMode?: BatchRunMode
  title?: string | null
  modelConfig?: Partial<WorkflowModelConfig> | null
  stageSkillOverrides?: Record<string, string> | null
  stageParams?: WorkflowStageParamsMap | null
  items?: BatchRunItemSeedInput[] | null
  // Backwards-friendly single-entry shortcut fields
  pastedScript?: string | null
  sourceVideoMaterialId?: string | null
  sourceVideoStorageKey?: string | null
  sourceVideoUrl?: string | null
  sourceVideoFileName?: string | null
  initialProduct?: Record<string, unknown> | null
  hookAngles?: string[] | null
}

export interface UpdateBatchRunInput {
  title?: string
  runMode?: BatchRunMode
  status?: 'paused' | 'running' | 'draft'
  modelConfig?: Partial<WorkflowModelConfig> | null
  stageSkillOverrides?: Record<string, string> | null
  stageGateOverrides?: Partial<Record<WorkflowStage, WorkflowGateMode>> | null
  stageParams?: WorkflowStageParamsMap | null
}

export interface RunBatchItemStageInput {
  stage: WorkflowStage
  expectedRevision?: number
  skillIdOverride?: string | null
  skillSlugOverride?: string | null
  stageParamsOverride?: StageParams | null
  forceRerun?: boolean
  /** Optional stage-5 subset of shotIds to re-roll (appends takes[]). */
  shotIds?: string[]
  /** Optional stage-1 inline pasted script override. */
  pastedScript?: string | null
  /** Optional target stage when skipping Stage 1 video analysis via pasted script (e.g. 'script_rewrite' or 'asset_extraction'). */
  targetStage?: WorkflowStage | null
  /** Optional stage-1 inline video source override. */
  sourceVideoMaterialId?: string | null
  sourceVideoStorageKey?: string | null
  sourceVideoUrl?: string | null
  sourceVideoFileName?: string | null
}

export interface ReviewBatchItemStageInput {
  stage: WorkflowStage
  expectedRevision?: number
  action: 'approve' | 'reject' | 'save_draft'
  editedOutput?: Record<string, unknown> | null
  reviewNote?: string | null
  clearStale?: boolean
}

export interface StageSkillDraftPatch {
  name?: string
  systemPrompt?: string
  fewShotExamples?: WorkflowSkillFewShotExample[]
  qcRules?: WorkflowSkillQcRules | null
  modelPreferences?: WorkflowSkillModelPreferences | null
}

export interface RunStageSkillTrialInput {
  stage: WorkflowStage
  expectedRevision?: number
  skillIdOverride?: string | null
  skillSlugOverride?: string | null
  skillPatch?: StageSkillDraftPatch | null
  stageParamsOverride?: StageParams | null
  confirmCost?: boolean
  shotId?: string | null
}

export interface RunStageSkillTrialResult {
  stage: WorkflowStage
  baseSkill: Pick<WorkflowSkillDTO, 'id' | 'slug' | 'name' | 'version'>
  trialOutput: unknown
  rawSkillPatch: StageSkillDraftPatch
  durationMs: number
}

export interface RefineWorkflowSkillInput {
  skillId: string
  feedback: string
  sampleOutput?: unknown
  projectId?: string
  modelKey?: string | null
}

export interface GenerateBatchItemAssetsInput {
  expectedRevision?: number
  assetItemIds?: string[]
  imageModelKeyOverride?: string | null
  resolutionOverride?: string | null
  qualityOverride?: ImageQualityLevel | null
}

export interface BindBatchItemAssetMaterialInput {
  expectedRevision?: number
  assetItemId: string
  materialId?: string | null
  voiceMaterialId?: string | null
  clearVoice?: boolean
  selectVersionIndex?: number | null
}

export interface SelectShotTakeInput {
  expectedRevision?: number
  shotId: string
  takeIndex: number
}

export interface AdvanceBatchRunInput {
  expectedRevision?: number
  maxSteps?: number
  itemIds?: string[]
  approveWaitingReview?: boolean
}

export interface AdvanceBatchRunResult {
  run: BatchRunDTO
  hasPendingAsyncTasks: boolean
  executedSteps: Array<{
    itemId: string
    itemTitle: string
    stage: WorkflowStage
    outcome: 'completed' | 'waiting_review' | 'failed' | 'running' | 'skipped'
    error?: string | null
  }>
}

export interface MaterializeCanvasResult {
  canvasId: string
  projectId: string
  href: string
  reused: boolean
  nodeCount: number
  edgeCount: number
}

// ============================================================
// Pure Client-Safe Helpers
// ============================================================

export function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && (WORKFLOW_STAGES as readonly string[]).includes(value)
}

export const isBatchWorkflowStage = isWorkflowStage

export function getStageIndex(stage: WorkflowStage): number {
  return WORKFLOW_STAGES.indexOf(stage)
}

export function getNextWorkflowStage(
  stage: WorkflowStage,
  stages?: readonly WorkflowTemplateStageConfig[] | null,
): WorkflowStage | null {
  const ordered = stages && stages.length > 0
    ? stages.filter((item) => item.enabled !== false).map((item) => item.stage)
    : [...WORKFLOW_STAGES]
  const currentIdx = ordered.indexOf(stage)
  if (currentIdx === -1 || currentIdx + 1 >= ordered.length) return null
  return ordered[currentIdx + 1] ?? null
}

export const getNextBatchStage = getNextWorkflowStage

export function getFirstEnabledStage(
  stages?: readonly WorkflowTemplateStageConfig[] | null,
): WorkflowStage {
  if (stages && stages.length > 0) {
    const first = stages.find((item) => item.enabled !== false)
    if (first && isWorkflowStage(first.stage)) return first.stage
  }
  return 'script_analysis'
}

export function createInitialStageStates(
  template: Pick<WorkflowTemplateDTO, 'stages'>,
): Record<WorkflowStage, BatchStageState> {
  const states = {} as Record<WorkflowStage, BatchStageState>
  for (const stage of WORKFLOW_STAGES) {
    const cfg = template.stages.find((item) => item.stage === stage)
    states[stage] = {
      status: cfg && cfg.enabled === false ? 'skipped' : 'pending',
      skillSlug: cfg?.skillSlug || '',
      skillId: cfg?.skillId ?? null,
      skillName: null,
      skillVersion: 1,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      error: null,
      reviewNote: null,
      taskIds: [],
      stale: false,
      staleReason: null,
      trialPending: false,
    }
  }
  return states
}

function cleanStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStrList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanStr).filter(Boolean)))
}

export function normalizeVideoAspectRatio(value: unknown, fallback: VideoAspectRatio = '9:16'): VideoAspectRatio {
  if (
    value === '9:16'
    || value === '16:9'
    || value === '3:4'
    || value === '4:3'
    || value === '1:1'
    || value === '21:9'
    || value === 'adaptive'
  ) {
    return value
  }
  return fallback
}

export function normalizeVideoInputMode(value: unknown, fallback: VideoInputMode = 'text'): VideoInputMode {
  if (value === 'text' || value === 'image' || value === 'firstlastframe') {
    return value
  }
  return fallback
}

export function normalizeWorkflowModelConfig(
  raw?: Partial<WorkflowModelConfig> | Record<string, unknown> | null,
  fallback: WorkflowModelConfig = DEFAULT_WORKFLOW_MODEL_CONFIG,
): WorkflowModelConfig {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const creativityNum = Number(obj.textCreativity)
  const durationNum = Number(obj.videoDurationSeconds)
  const qualityRaw = cleanStr(obj.imageQuality)
  const imageQuality: ImageQualityLevel =
    qualityRaw === 'low' || qualityRaw === 'medium' || qualityRaw === 'high'
      ? qualityRaw
      : fallback.imageQuality

  return {
    textModelKey: cleanStr(obj.textModelKey) || fallback.textModelKey,
    imageModelKey: cleanStr(obj.imageModelKey) || fallback.imageModelKey,
    videoModelKey: cleanStr(obj.videoModelKey) || fallback.videoModelKey,
    textCreativity: Number.isFinite(creativityNum)
      ? Math.max(0, Math.min(1.2, Math.round(creativityNum * 100) / 100))
      : fallback.textCreativity,
    imageResolution: cleanStr(obj.imageResolution) || fallback.imageResolution,
    imageQuality,
    videoAspectRatio: normalizeVideoAspectRatio(obj.videoAspectRatio, fallback.videoAspectRatio),
    videoResolution: cleanStr(obj.videoResolution) || fallback.videoResolution,
    videoDurationSeconds: Number.isFinite(durationNum)
      ? Math.max(2, Math.min(30, Math.round(durationNum)))
      : fallback.videoDurationSeconds,
    videoGenerateAudio: typeof obj.videoGenerateAudio === 'boolean'
      ? obj.videoGenerateAudio
      : fallback.videoGenerateAudio,
    videoInputMode: normalizeVideoInputMode(obj.videoInputMode, fallback.videoInputMode),
  }
}

export function normalizeBatchItemInputPayload(raw?: Partial<BatchItemInputPayload> | Record<string, unknown> | null): BatchItemInputPayload {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const sourceVideoMaterialId = cleanStr(obj.sourceVideoMaterialId) || null
  const sourceVideoStorageKey = cleanStr(obj.sourceVideoStorageKey) || null
  const sourceVideoUrl = cleanStr(obj.sourceVideoUrl) || null
  const sourceVideoFileName = cleanStr(obj.sourceVideoFileName) || null
  const durationRaw = Number(obj.sourceVideoDurationSec)
  const sourceVideoDurationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null
  const pastedScript = typeof obj.pastedScript === 'string' && obj.pastedScript.trim()
    ? obj.pastedScript.trim()
    : null
  const hasVideo = Boolean(sourceVideoMaterialId || sourceVideoStorageKey || sourceVideoUrl)
  const skipVideoAnalysis = obj.skipVideoAnalysis === true || (!hasVideo && Boolean(pastedScript))
  const sourceType: BatchItemSourceType = skipVideoAnalysis
    ? 'pasted_script'
    : (hasVideo || obj.sourceType === 'video' ? 'video' : 'pasted_script')

  const targetSecRaw = Number(obj.durationTargetSec)
  const durationTargetSec = Number.isFinite(targetSecRaw) && targetSecRaw > 0
    ? Math.max(8, Math.min(300, Math.round(targetSecRaw)))
    : undefined

  return {
    sourceType,
    sourceVideoMaterialId,
    sourceVideoStorageKey,
    sourceVideoUrl,
    sourceVideoFileName,
    sourceVideoDurationSec,
    skipVideoAnalysis,
    pastedScript,
    aspectRatio: normalizeVideoAspectRatio(obj.aspectRatio, '9:16'),
    ...(durationTargetSec ? { durationTargetSec } : {}),
    ...(cleanStr(obj.styleNotes) ? { styleNotes: cleanStr(obj.styleNotes) } : {}),
    ...(cleanStr(obj.productName) ? { productName: cleanStr(obj.productName) } : {}),
    ...(cleanStrList(obj.sellingPoints).length > 0 ? { sellingPoints: cleanStrList(obj.sellingPoints) } : {}),
    ...(cleanStr(obj.hookAngle) ? { hookAngle: cleanStr(obj.hookAngle) } : {}),
    ...(cleanStr(obj.ctaText) ? { ctaText: cleanStr(obj.ctaText) } : {}),
    ...(cleanStr(obj.extraNotes) ? { extraNotes: cleanStr(obj.extraNotes) } : {}),
    ...(cleanStrList(obj.referenceMaterialIds).length > 0 ? { referenceMaterialIds: cleanStrList(obj.referenceMaterialIds) } : {}),
  }
}

/**
 * Clamps an image generation prompt cleanly to <= 900 chars (well inside OpenLux's 1000-char hard limit).
 */
export function clampImagePrompt(prompt: string, maxChars = 900): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  const slice = normalized.slice(0, maxChars)
  const lastStop = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('，'),
    slice.lastIndexOf('.'),
    slice.lastIndexOf(','),
    slice.lastIndexOf('；'),
    slice.lastIndexOf(';'),
  )
  if (lastStop >= Math.floor(maxChars * 0.72)) {
    return slice.slice(0, lastStop + 1).trim()
  }
  return slice.trim()
}

/**
 * Deterministically converts a user-pasted script into a clean `OriginalScriptArtifact`
 * so users can skip Stage 1 video analysis completely and jump straight to Stage 2 or Stage 3.
 */
export function buildOriginalScriptFromPastedText(params: {
  title?: string
  pastedScript: string
  durationTargetSec?: number
}): OriginalScriptArtifact {
  const fullScriptText = params.pastedScript.replace(/\r\n?/g, '\n').trim()
  const blocks = fullScriptText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const characterNames = new Set<string>()
  const dialogueSpeakerPattern = /^([^\s:：，。！？、()（）「」"“]{1,10})\s*[:：]\s*(.+)$/

  const beats: OriginalScriptBeat[] = (blocks.length > 0 ? blocks : [fullScriptText]).slice(0, 30).map((block, idx) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const firstLine = lines[0] || ''
    const looksLikeHeading = /^(?:场次|场景|场\s*\d+|幕\s*\d+|镜\s*\d+|第\s*\d+\s*[场幕镜集]|Scene|Shot|S\d+|【|\[|#)/i.test(firstLine)
    const sceneHeading = looksLikeHeading ? firstLine.replace(/^#+\s*/, '') : `段落 ${idx + 1}`
    const bodyLines = looksLikeHeading ? lines.slice(1) : lines

    const dialogueLines: string[] = []
    const actionLines: string[] = []
    for (const line of bodyLines) {
      const m = line.match(dialogueSpeakerPattern)
      if (m && !/^(画面|动作|场景|场次|场\d+|镜\d+|地点|旁白|音效|字幕|镜头|时间|花字|亮点|备注)/.test(m[1])) {
        characterNames.add(m[1])
        dialogueLines.push(line)
      } else {
        actionLines.push(line)
      }
    }

    return {
      beatIndex: idx + 1,
      sceneHeading,
      visualAction: actionLines.join(' ').trim() || bodyLines.join(' ').trim() || block,
      dialogue: dialogueLines.join('\n').trim(),
      hookNote: idx === 0 ? '跳过视频解析，直接导入原剧本开场段落' : undefined,
    }
  })

  const charCount = fullScriptText.length
  const inferredDuration = params.durationTargetSec
    || Math.max(15, Math.min(180, Math.round(charCount / 7)))

  const firstMeaningfulLine = fullScriptText.split('\n').map((l) => l.trim()).find(Boolean) || ''
  const title = cleanStr(params.title) || firstMeaningfulLine.replace(/^#+\s*/, '').slice(0, 32) || '粘贴导入剧本'

  return {
    sourceMode: 'pasted_script',
    title,
    summary: fullScriptText.slice(0, 140) + (fullScriptText.length > 140 ? '…' : ''),
    estimatedDurationSec: inferredDuration,
    hookAnalysis: '直接导入的文字剧本（已跳过视频解析阶段，可直接进入 S2 洗稿或 S3 资产提取）',
    characters: Array.from(characterNames).slice(0, 12).map((name, idx) => ({
      name,
      role: idx === 0 ? '主角' : '角色',
      traits: '来自粘贴剧本对话角色',
    })),
    locations: [],
    props: [],
    beats,
    fullScriptText,
    cutHints: [],
    arkFileId: null,
    arkModel: null,
    rawAnalysisText: null,
  }
}

export function hasItemPendingAsyncTasks(
  item: Pick<BatchItemDTO, 'stageOutputs' | 'stageStates'>,
): boolean {
  const s3Items = item.stageOutputs?.asset_extraction?.items || []
  for (const asset of s3Items) {
    if (asset.status === 'queued' || asset.status === 'processing') return true
    if (asset.versions?.some((v) => v.status === 'queued' || v.status === 'processing')) return true
  }

  const s5Shots = item.stageOutputs?.video_gen?.shots || []
  for (const shot of s5Shots) {
    if (shot.takes?.some((t) => t.status === 'queued' || t.status === 'processing')) return true
  }

  return false
}

export function hasBatchRunPendingAsyncTasks(
  items?: readonly Pick<BatchItemDTO, 'stageOutputs' | 'stageStates'>[] | null,
): boolean {
  if (!items || items.length === 0) return false
  return items.some((item) => hasItemPendingAsyncTasks(item))
}

/**
 * Reconciles `@AssetName` and `@Alias` mentions inside a shot's `videoPrompt` against
 * S3 assets. Matches case-insensitively with longest-match-first precedence, preserving
 * first-appearance order in `videoPrompt` and deduplicating by asset ID.
 */
export function reconcileShotAssetMentions(
  videoPrompt: string,
  assets: readonly Pick<WorkflowAssetItem, 'id' | 'name' | 'aliases'>[],
): { referencedAssetIds: string[]; referencedAssetNames: string[] } {
  if (typeof videoPrompt !== 'string' || !videoPrompt || !Array.isArray(assets) || assets.length === 0) {
    return { referencedAssetIds: [], referencedAssetNames: [] }
  }

  interface MentionCandidate {
    lower: string
    length: number
    endsWithAsciiWord: boolean
    assetId: string
    assetName: string
    order: number
  }

  const candidates: MentionCandidate[] = []
  let order = 0
  for (const asset of assets) {
    const id = cleanStr(asset.id)
    const canonicalName = cleanStr(asset.name)
    if (!id || !canonicalName) continue

    const rawTokens = [canonicalName, ...(Array.isArray(asset.aliases) ? asset.aliases : [])]
    const seenForAsset = new Set<string>()
    for (const raw of rawTokens) {
      const token = cleanStr(raw).replace(/^@+/, '')
      if (!token) continue
      const lower = token.toLowerCase()
      if (seenForAsset.has(lower)) continue
      seenForAsset.add(lower)
      candidates.push({
        lower,
        length: lower.length,
        endsWithAsciiWord: /[a-z0-9_]$/i.test(lower),
        assetId: id,
        assetName: canonicalName,
        order,
      })
      order += 1
    }
  }

  if (candidates.length === 0) {
    return { referencedAssetIds: [], referencedAssetNames: [] }
  }

  // Longest match first so `@林晚妈妈` beats `@林晚`, tie-break by original asset/name order.
  candidates.sort((a, b) => b.length - a.length || a.order - b.order)

  const promptLower = videoPrompt.toLowerCase()
  const referencedAssetIds: string[] = []
  const referencedAssetNames: string[] = []
  const seenIds = new Set<string>()

  let cursor = 0
  while (cursor < promptLower.length) {
    const atIndex = promptLower.indexOf('@', cursor)
    if (atIndex === -1) break

    const afterAt = atIndex + 1
    let matched: MentionCandidate | null = null
    for (const cand of candidates) {
      if (!promptLower.startsWith(cand.lower, afterAt)) continue
      if (cand.endsWithAsciiWord) {
        const nextChar = promptLower[afterAt + cand.length]
        if (nextChar && /[a-z0-9_]/i.test(nextChar)) {
          continue
        }
      }
      matched = cand
      break
    }

    if (matched) {
      if (!seenIds.has(matched.assetId)) {
        seenIds.add(matched.assetId)
        referencedAssetIds.push(matched.assetId)
        referencedAssetNames.push(matched.assetName)
      }
      cursor = afterAt + matched.length
    } else {
      cursor = afterAt
    }
  }

  return { referencedAssetIds, referencedAssetNames }
}
