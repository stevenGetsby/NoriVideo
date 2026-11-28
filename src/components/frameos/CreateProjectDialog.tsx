'use client'

import '@/components/batch-workflow/batch-workflow.css'
import { confirmAction } from '@/lib/ui/feedback'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { ProjectStyleReferenceDraftFile } from '@/lib/projects/style-reference-contract'
import type { ProjectStyleReferenceProgressUpdate } from '@/lib/projects/create-project-request'
import {
  DEFAULT_WORKFLOW_MODEL_CONFIG,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_META,
  WORKFLOW_TRACK_DRAMA_REMAKE,
  WORKFLOW_TRACK_FILM_STYLE_REMAKE,
  WORKFLOW_TRACK_LABELS,
  WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
  type BatchRunItemSeedInput,
  type BatchRunMode,
  type VideoAspectRatio,
  type WorkflowModelConfig,
  type WorkflowSkillDTO,
  type WorkflowTemplateDTO,
} from '@/lib/batch-workflow/types'
import type { GenerationConfigOption } from '@/components/batch-workflow/ModelConfigPopover'
import { MaterialPickerDialog } from './materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from './materials/contracts'
import {
  ProjectStyleReferencePicker,
  toProjectStyleReferenceDraftFiles,
  type ProjectStyleReferenceItem,
} from './ProjectStyleReferencePicker'
import {
  CREATE_PROJECT_LEVEL_VARIANTS,
  durationBounds,
  type CreateProjectDurationMode,
  type CreateProjectLevel,
  type CreateProjectMaterialType,
  type CreateProjectStyle,
  type CreateProjectType,
} from './works/create-project-variants'
import { InheritAssetsSection } from './works/InheritAssetsSection'
import { isInheritIssueMessage, type InheritSourceOption } from './works/inherit-sources'
import { fetchAllMemberCandidates } from './works/member-candidates'
import type { MemberCandidate } from './works/types'
import { useInheritAssets } from './works/useInheritAssets'
import type { AccountPermission } from '@/lib/account/permissions'
import {
  focusCreateProjectDialogInitial,
  restoreCreateProjectDialogFocus,
  trapCreateProjectDialogTab,
} from './works/create-project-dialog-focus'

type ScriptSource = 'blank' | 'writer' | 'local' | 'range'
type WorkflowFirstInputMode = 'video' | 'pasted_script' | 'empty'

interface WriterScript {
  id: string
  title: string
  status: string
  episodes: Array<{ id: string; title: string; body: string }>
}

interface GenerationConfigResponse {
  textModels?: GenerationConfigOption[]
  imageModels?: GenerationConfigOption[]
  videoModels?: GenerationConfigOption[]
  defaults?: {
    textModel?: string | null
    imageModel?: string | null
    videoModel?: string | null
    aspectRatio?: string | null
    resolution?: string | null
  }
}

export interface CreateProjectBatchWorkflowInitialItem {
  sourceType: 'video' | 'pasted_script'
  title?: string
  sourceVideoMaterialId?: string | null
  sourceVideoStorageKey?: string | null
  sourceVideoUrl?: string | null
  sourceVideoFileName?: string | null
  sourceVideoDurationSec?: number | null
  skipVideoAnalysis?: boolean
  pastedScript?: string | null
}

export interface CreateProjectBatchWorkflowPayload {
  templateId?: string
  track: string
  runMode: BatchRunMode
  modelConfig?: Partial<WorkflowModelConfig>
  stageSkillOverrides?: Record<string, string>
  initialItem?: CreateProjectBatchWorkflowInitialItem | null
  items?: BatchRunItemSeedInput[]
  pastedScript?: string | null
  sourceVideoMaterialId?: string | null
  sourceVideoStorageKey?: string | null
  sourceVideoUrl?: string | null
  sourceVideoFileName?: string | null
  /** Optional legacy compat field for callers checking initialProduct?.productName */
  initialProduct?: {
    productName?: string
    pricePoint?: string
    sellingPoints?: string[]
    targetAudience?: string
    aspectRatio?: '9:16' | '16:9' | '3:4' | '1:1'
    productMaterialIds?: string[]
    characterMaterialIds?: string[]
  }
  hookAngles?: string[]
}

export interface CreateProjectDraft {
  name: string
  creationMode: 'batch_workflow' | 'canvas' | 'workflow'
  projectLevel: CreateProjectLevel
  collaborationMode: 'solo' | 'team'
  projectType: CreateProjectType
  projectStyle: CreateProjectStyle
  materialType: CreateProjectMaterialType
  targetEpisodeCount: number
  targetAudience: 'zh-platform' | 'global-platform'
  videoRatio: '9:16' | '16:9'
  videoResolution: '480p' | '720p' | '1080p' | '4K'
  episodeDurationMode: CreateProjectDurationMode
  episodeDurationValue: number
  artStylePrompt: string
  referenceArtStylePrompt: string
  writerAssigneeUserId: string
  assetAssigneeUserId: string
  storyboardAssigneeUserId: string
  scriptFile: File | null
  importedScriptText: string
  importedScriptTitle: string
  initializeEpisodeRange: boolean
  initialEpisodeStart: number
  initialEpisodeEnd: number
  styleReferenceFiles: ProjectStyleReferenceDraftFile[]
  inheritSourceProjectId?: string
  inheritMaterialIds?: string[]
  batchWorkflow?: CreateProjectBatchWorkflowPayload
}

type CreateProjectFormDraft = Omit<CreateProjectDraft, 'episodeDurationValue'> & {
  episodeDurationValue: number | ''
}

interface ProjectPillOption<T extends string> {
  value: T
  label: string
}

function ProjectPillGroup<T extends string>({
  label,
  value,
  options,
  className = '',
  onChange,
}: {
  label: string
  value: T
  options: readonly ProjectPillOption<T>[]
  className?: string
  onChange: (value: T) => void
}) {
  return (
    <div className={`create-project-pill-group${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      <div className="create-project-pill-row" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? 'is-selected' : ''}
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const DEFAULT_DRAFT: CreateProjectFormDraft = {
  name: '',
  creationMode: 'batch_workflow',
  projectLevel: 'Nori1.0',
  collaborationMode: 'solo',
  projectType: 'story',
  projectStyle: 'live-action',
  materialType: 'script',
  targetEpisodeCount: 0,
  targetAudience: 'zh-platform',
  videoRatio: '9:16',
  videoResolution: '720p',
  episodeDurationMode: 'per-episode',
  episodeDurationValue: 120,
  artStylePrompt: '',
  referenceArtStylePrompt: '',
  writerAssigneeUserId: '',
  assetAssigneeUserId: '',
  storyboardAssigneeUserId: '',
  scriptFile: null,
  importedScriptText: '',
  importedScriptTitle: '',
  initializeEpisodeRange: false,
  initialEpisodeStart: 1,
  initialEpisodeEnd: 3,
  styleReferenceFiles: [],
}

const ACCEPTED_SCRIPT_EXTENSIONS = ['txt', 'docx', 'pdf']
const MAX_SCRIPT_BYTES = 10 * 1024 * 1024

const PROJECT_STYLE_SUMMARIES: Readonly<Record<CreateProjectStyle, string>> = {
  'live-action': '真人实拍电影质感，自然肤色、真实材质、电影级光影与景深。',
  'anime-3d': '统一三维角色造型、材质、比例与影视级灯光渲染。',
  'anime-2.5d': '二维角色设计结合三维空间、分层光影、景深与电影运镜。',
  'anime-2d': '稳定角色设定、清晰线稿、精致赛璐璐上色与统一光影。',
  anime: '现代动漫短剧画风。',
}

const ASSIGNMENT_ROLE_OPTIONS: ReadonlyArray<{
  role: 'writer' | 'asset' | 'storyboard'
  permission: AccountPermission
  label: string
  description: string
  field: 'writerAssigneeUserId' | 'assetAssigneeUserId' | 'storyboardAssigneeUserId'
}> = [
  { role: 'writer', permission: 'scriptWrite', label: '剧本', description: '负责剧本内容与提交', field: 'writerAssigneeUserId' },
  { role: 'asset', permission: 'assetWrite', label: '资产', description: '负责人物、物品与环境资产', field: 'assetAssigneeUserId' },
  { role: 'storyboard', permission: 'storyboardWrite', label: '分镜 / 视频', description: '负责分镜与后续视频任务', field: 'storyboardAssigneeUserId' },
]

const FALLBACK_TEMPLATES: readonly WorkflowTemplateDTO[] = [
  {
    id: 'builtin-template:short-drama-commerce-v2',
    userId: null,
    isBuiltin: true,
    slug: 'short-drama-commerce-v2',
    name: '漫剧 / 短剧带货（5步全能产线）',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    description: '拆解爆款带货视频或剧本 → 爽文反转/闺蜜种草洗稿 → 角色/场景/商品定妆出图 → @资产快节奏分镜 → 批量多 Take 出片。',
    isDefault: true,
    stages: [
      { stage: 'script_analysis', label: 'S1 解析', skillSlug: 'sa-commerce-viral-deconstruct', gateMode: 'manual_review', enabled: true },
      { stage: 'script_rewrite', label: 'S2 洗稿', skillSlug: 'rw-commerce-twist-hook', gateMode: 'manual_review', enabled: true },
      { stage: 'asset_extraction', label: 'S3 资产', skillSlug: 'ae-commerce-product-cast', gateMode: 'manual_review', enabled: true },
      { stage: 'storyboard', label: 'S4 分镜', skillSlug: 'sb-seedance-fast-commerce', gateMode: 'manual_review', enabled: true },
      { stage: 'video_gen', label: 'S5 视频', skillSlug: 'vg-seedance-25-default', gateMode: 'auto', enabled: true },
    ],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'builtin-template:drama-remake-v1',
    userId: null,
    isBuiltin: true,
    slug: 'drama-remake-v1',
    name: '爆款短剧二创',
    track: WORKFLOW_TRACK_DRAMA_REMAKE,
    description: '拉片拆解爆款剧作节拍 → 高能二创人设换皮与反转加码 → 漫剧/国漫资产出图 → 高张力正反打分镜 → 批量出片选片。',
    isDefault: false,
    stages: [
      { stage: 'script_analysis', label: 'S1 解析', skillSlug: 'sa-drama-beat-extract', gateMode: 'manual_review', enabled: true },
      { stage: 'script_rewrite', label: 'S2 洗稿', skillSlug: 'rw-drama-plot-remake', gateMode: 'manual_review', enabled: true },
      { stage: 'asset_extraction', label: 'S3 资产', skillSlug: 'ae-anime-manhua-assets', gateMode: 'manual_review', enabled: true },
      { stage: 'storyboard', label: 'S4 分镜', skillSlug: 'sb-drama-cinematic-cuts', gateMode: 'manual_review', enabled: true },
      { stage: 'video_gen', label: 'S5 视频', skillSlug: 'vg-seedance-25-default', gateMode: 'auto', enabled: true },
    ],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'builtin-template:film-style-remake-v1',
    userId: null,
    isBuiltin: true,
    slug: 'film-style-remake-v1',
    name: '影视风格翻拍',
    track: WORKFLOW_TRACK_FILM_STYLE_REMAKE,
    description: '精细解析原片视听调度与影调 → 电影美学迁移重构 → 35mm 电影级定妆与置景出图 → 长镜头推轨分镜 → 高清出片。',
    isDefault: false,
    stages: [
      { stage: 'script_analysis', label: 'S1 解析', skillSlug: 'sa-film-cinematography-parse', gateMode: 'manual_review', enabled: true },
      { stage: 'script_rewrite', label: 'S2 洗稿', skillSlug: 'rw-film-style-transfer', gateMode: 'manual_review', enabled: true },
      { stage: 'asset_extraction', label: 'S3 资产', skillSlug: 'ae-cinematic-realism-assets', gateMode: 'manual_review', enabled: true },
      { stage: 'storyboard', label: 'S4 分镜', skillSlug: 'sb-film-longtake-grammar', gateMode: 'manual_review', enabled: true },
      { stage: 'video_gen', label: 'S5 视频', skillSlug: 'vg-seedance-25-default', gateMode: 'auto', enabled: true },
    ],
    createdAt: '',
    updatedAt: '',
  },
]

const FALLBACK_SKILL_NAMES: Readonly<Record<string, string>> = {
  'sa-commerce-viral-deconstruct': '爆款带货拉片拆解',
  'sa-drama-beat-extract': '短剧剧作节拍拆解',
  'sa-film-cinematography-parse': '影视视听影调拆解',
  'rw-commerce-twist-hook': '爽文反转带货洗稿',
  'rw-commerce-bestie-talk': '闺蜜种草对话洗稿',
  'rw-drama-plot-remake': '爆款短剧高能二创',
  'rw-film-style-transfer': '电影美学风格迁移',
  'ae-commerce-product-cast': '商业短剧人设与商品定妆',
  'ae-anime-manhua-assets': '国漫/漫剧角色场景资产',
  'ae-cinematic-realism-assets': '35mm 电影实拍资产',
  'sb-seedance-fast-commerce': '快节奏带货 @资产分镜',
  'sb-drama-cinematic-cuts': '强冲突正反打分镜',
  'sb-film-longtake-grammar': '电影感推轨长镜头分镜',
  'vg-seedance-25-default': '批量多 Take 视频生成',
}

const WORKFLOW_ASPECT_RATIOS: readonly VideoAspectRatio[] = ['9:16', '16:9', '3:4', '4:3', '1:1']
const WORKFLOW_VIDEO_RESOLUTIONS: readonly ('480p' | '720p' | '1080p')[] = ['480p', '720p', '1080p']

function scriptExtension(file: File) {
  return file.name.split('.').pop()?.toLocaleLowerCase() || ''
}

function validateScriptFile(file: File): string | null {
  if (!ACCEPTED_SCRIPT_EXTENSIONS.includes(scriptExtension(file))) return '仅支持 txt、docx 或文本型 pdf 文件'
  if (file.size > MAX_SCRIPT_BYTES) return '素材文件不能超过 10MB'
  return null
}

function formatDurationBadge(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`
}

function readMaterialDurationSec(material: FrameosMaterialItem): number | null {
  const meta = material.metadata
  if (!meta || typeof meta !== 'object') return null
  const raw = Number(meta.durationSec ?? meta.duration ?? meta.durationSeconds)
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

const NO_INHERIT_SOURCES: readonly InheritSourceOption[] = []

export function CreateProjectDialog({
  workName,
  currentWorkId = '',
  inheritSources = NO_INHERIT_SOURCES,
  onClose,
  onCreate,
}: {
  workName?: string
  currentWorkId?: string
  inheritSources?: readonly InheritSourceOption[]
  onClose: () => void
  onCreate: (
    draft: CreateProjectDraft,
    setStatus: (status: string) => void,
    onStyleReferenceProgress: (update: ProjectStyleReferenceProgressUpdate) => void,
  ) => Promise<boolean> | boolean
}) {
  const [draft, setDraft] = useState<CreateProjectFormDraft>(DEFAULT_DRAFT)
  const [batchStep, setBatchStep] = useState<1 | 2>(1)

  // Step 1: Templates, Skills & Work-level Model Defaults
  const [templates, setTemplates] = useState<WorkflowTemplateDTO[]>([])
  const [allSkills, setAllSkills] = useState<WorkflowSkillDTO[]>([])
  const [batchMetaLoading, setBatchMetaLoading] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [s2SkillOverrideSlug, setS2SkillOverrideSlug] = useState('')
  const [batchRunMode, setBatchRunMode] = useState<BatchRunMode>('gated')
  const [textModels, setTextModels] = useState<GenerationConfigOption[]>([])
  const [imageModels, setImageModels] = useState<GenerationConfigOption[]>([])
  const [videoModels, setVideoModels] = useState<GenerationConfigOption[]>([])
  const [workflowModelConfig, setWorkflowModelConfig] = useState<WorkflowModelConfig>(DEFAULT_WORKFLOW_MODEL_CONFIG)

  // Step 2: Optional First Input (Reference Video / Pasted Script / Empty)
  const [firstInputMode, setFirstInputMode] = useState<WorkflowFirstInputMode>('video')
  const [selectedVideoMaterial, setSelectedVideoMaterial] = useState<FrameosMaterialItem | null>(null)
  const [videoPickerOpen, setVideoPickerOpen] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [pastedScriptText, setPastedScriptText] = useState('')
  const [firstItemTitle, setFirstItemTitle] = useState('')
  const videoUploadInputRef = useRef<HTMLInputElement>(null)

  // Legacy Episodic Workbench states (preserved intact)
  const [source, setSource] = useState<ScriptSource>('writer')
  const [scripts, setScripts] = useState<WriterScript[]>([])
  const [scriptsLoading, setScriptsLoading] = useState(true)
  const [scriptSearch, setScriptSearch] = useState('')
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState('创建中…')
  const [error, setError] = useState<string | null>(null)
  const [styleReferenceItems, setStyleReferenceItems] = useState<ProjectStyleReferenceItem[]>([])
  const [memberCandidates, setMemberCandidates] = useState<MemberCandidate[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState<string | null>(null)
  const [styleAnalyzing, setStyleAnalyzing] = useState(false)
  const inherit = useInheritAssets({ sources: inheritSources, currentWorkId })
  useEffect(() => {
    if (isInheritIssueMessage(error) && error !== inherit.issue) setError(null)
  }, [error, inherit.issue])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLFormElement>(null)
  const initialFocusRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const submittingRef = useRef(false)
  const analyzedReferenceSignatureRef = useRef('')

  const set = <K extends keyof CreateProjectFormDraft>(key: K, value: CreateProjectFormDraft[K]) => {
    if (submittingRef.current) return
    setDraft((previous) => ({ ...previous, [key]: value }))
  }
  const variant = CREATE_PROJECT_LEVEL_VARIANTS[draft.projectLevel]
  const bounds = durationBounds(draft.projectLevel, draft.episodeDurationMode)
  const styleReferenceImageSignature = styleReferenceItems
    .filter((item) => item.kind === 'image' && item.validationStatus === 'ready')
    .map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`)
    .join('|')

  // Load templates, skills, and live viewer-scoped model options for 5-Stage Video Workflow
  useEffect(() => {
    if (draft.creationMode !== 'batch_workflow') return
    let active = true
    setBatchMetaLoading(true)
    void Promise.all([
      apiFetch('/api/batch-workflow/templates', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : { templates: [] }))
        .catch(() => ({ templates: [] })),
      apiFetch('/api/batch-workflow/skills', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : { skills: [] }))
        .catch(() => ({ skills: [] })),
      apiFetch('/api/frameos/generation-config', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({})),
    ])
      .then(([tplPayload, skillPayload, genConfig]: [
        { templates?: WorkflowTemplateDTO[] },
        { skills?: WorkflowSkillDTO[] },
        GenerationConfigResponse,
      ]) => {
        if (!active) return
        const nextTemplates = Array.isArray(tplPayload.templates) && tplPayload.templates.length > 0
          ? tplPayload.templates
          : [...FALLBACK_TEMPLATES]
        const nextSkills = Array.isArray(skillPayload.skills) ? skillPayload.skills : []
        setTemplates(nextTemplates)
        setAllSkills(nextSkills)
        setSelectedTemplateId((curr) => (
          nextTemplates.some((t) => t.id === curr)
            ? curr
            : nextTemplates.find((t) => t.isDefault)?.id || nextTemplates[0]?.id || ''
        ))

        const nextText = Array.isArray(genConfig.textModels) ? genConfig.textModels : []
        const nextImage = Array.isArray(genConfig.imageModels) ? genConfig.imageModels : []
        const nextVideo = Array.isArray(genConfig.videoModels) ? genConfig.videoModels : []
        setTextModels(nextText)
        setImageModels(nextImage)
        setVideoModels(nextVideo)

        const pickKey = (list: GenerationConfigOption[], preferred?: string | null, fallback?: string) => {
          if (preferred && list.some((m) => m.modelKey === preferred && m.available !== false)) return preferred
          const firstAvail = list.find((m) => m.available !== false)
          return firstAvail?.modelKey || list[0]?.modelKey || preferred || fallback || ''
        }

        const resolvedText = pickKey(nextText, genConfig.defaults?.textModel, DEFAULT_WORKFLOW_MODEL_CONFIG.textModelKey)
        const resolvedImage = pickKey(nextImage, genConfig.defaults?.imageModel, DEFAULT_WORKFLOW_MODEL_CONFIG.imageModelKey)
        const resolvedVideo = pickKey(nextVideo, genConfig.defaults?.videoModel, DEFAULT_WORKFLOW_MODEL_CONFIG.videoModelKey)
        const resolvedRes = genConfig.defaults?.resolution && WORKFLOW_VIDEO_RESOLUTIONS.includes(genConfig.defaults.resolution as '480p' | '720p' | '1080p')
          ? genConfig.defaults.resolution
          : DEFAULT_WORKFLOW_MODEL_CONFIG.videoResolution

        setWorkflowModelConfig((prev) => ({
          ...prev,
          textModelKey: resolvedText || prev.textModelKey,
          imageModelKey: resolvedImage || prev.imageModelKey,
          videoModelKey: resolvedVideo || prev.videoModelKey,
          videoResolution: resolvedRes,
        }))
      })
      .finally(() => {
        if (active) setBatchMetaLoading(false)
      })
    return () => { active = false }
  }, [draft.creationMode])

  useEffect(() => {
    if (draft.creationMode !== 'workflow') {
      setScriptsLoading(false)
      return
    }
    let active = true
    setScriptsLoading(true)
    void apiFetch('/api/video-repaint/scripts', { cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : { scripts: [] }))
      .then((payload: { scripts?: WriterScript[] }) => {
        if (!active) return
        const available = Array.isArray(payload.scripts)
          ? payload.scripts.filter((script) => script.status === 'available')
          : []
        setScripts(available)
      })
      .catch(() => {
        if (active) setScripts([])
      })
      .finally(() => {
        if (active) setScriptsLoading(false)
      })
    return () => { active = false }
  }, [draft.creationMode])

  useEffect(() => {
    if ((draft.creationMode !== 'workflow' && draft.creationMode !== 'batch_workflow') || draft.collaborationMode !== 'team') return
    const controller = new AbortController()
    setMembersLoading(true)
    setMembersError(null)
    void fetchAllMemberCandidates({
      path: '/api/works/member-candidates',
      signal: controller.signal,
    })
      .then((candidates) => {
        if (!controller.signal.aborted) setMemberCandidates(candidates)
      })
      .catch((candidateError) => {
        if (!controller.signal.aborted) {
          setMemberCandidates([])
          setMembersError(candidateError instanceof Error ? candidateError.message : '加载子账号失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setMembersLoading(false)
      })
    return () => controller.abort()
  }, [draft.collaborationMode, draft.creationMode])

  useEffect(() => {
    if (!analyzedReferenceSignatureRef.current) return
    if (analyzedReferenceSignatureRef.current === styleReferenceImageSignature) return
    analyzedReferenceSignatureRef.current = ''
    setDraft((previous) => (previous.referenceArtStylePrompt
      ? { ...previous, referenceArtStylePrompt: '' }
      : previous))
  }, [styleReferenceImageSignature])

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const dialog = dialogRef.current
    if (dialog) focusCreateProjectDialogInitial(initialFocusRef.current, dialog)
    return () => {
      restoreCreateProjectDialogFocus(restoreFocusRef.current)
      restoreFocusRef.current = null
    }
  }, [])

  const displayTemplates = templates.length > 0 ? templates : FALLBACK_TEMPLATES
  const selectedTemplate = useMemo(
    () => displayTemplates.find((item) => item.id === selectedTemplateId) || displayTemplates[0],
    [displayTemplates, selectedTemplateId],
  )

  const skillNameBySlugOrId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [slug, label] of Object.entries(FALLBACK_SKILL_NAMES)) {
      map.set(slug, label)
    }
    for (const sk of allSkills) {
      map.set(sk.id, sk.name)
      map.set(sk.slug, sk.name)
    }
    return map
  }, [allSkills])

  const s2Skills = useMemo(
    () => allSkills.filter((sk) => sk.stage === 'script_rewrite'),
    [allSkills],
  )

  // Keep S2 override synced cleanly when switching templates
  useEffect(() => {
    if (!selectedTemplate) return
    const defaultS2 = selectedTemplate.stages.find((st) => st.stage === 'script_rewrite')?.skillSlug || ''
    setS2SkillOverrideSlug(defaultS2)
    // Apply template's S5 default aspect ratio if specified (e.g. Film Style Remake -> 16:9)
    const s5Opts = selectedTemplate.stages.find((st) => st.stage === 'video_gen')?.options
    const tplRatio = typeof s5Opts?.aspectRatio === 'string' ? s5Opts.aspectRatio : null
    if (tplRatio && WORKFLOW_ASPECT_RATIOS.includes(tplRatio as VideoAspectRatio)) {
      setWorkflowModelConfig((prev) => ({ ...prev, videoAspectRatio: tplRatio as VideoAspectRatio }))
      if (tplRatio === '9:16' || tplRatio === '16:9') {
        setDraft((prev) => ({ ...prev, videoRatio: tplRatio }))
      }
    }
  }, [selectedTemplate?.id])

  const handleUploadLocalVideo = async (file: File | null) => {
    if (!file || uploadingVideo || submittingRef.current) return
    if (!file.type.startsWith('video/')) {
      setError('请选择视频文件（MP4 / MOV / WebM）。')
      return
    }
    setUploadingVideo(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('title', file.name.replace(/\.[^.]+$/, '').slice(0, 60) || '参考视频')
      form.set('projectId', 'personal')
      const response = await apiFetch('/api/frameos/materials', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传参考视频失败'))
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material) throw new Error('上传成功但未返回视频素材信息。')
      setSelectedVideoMaterial(payload.material)
      if (!firstItemTitle.trim()) {
        setFirstItemTitle(payload.material.title || file.name.replace(/\.[^.]+$/, ''))
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传参考视频失败')
    } finally {
      setUploadingVideo(false)
    }
  }

  const handleFile = useCallback((file: File | null) => {
    if (submittingRef.current || !file) return
    const issue = validateScriptFile(file)
    if (issue) {
      setError(issue)
      return
    }
    setDraft((previous) => ({ ...previous, scriptFile: file, importedScriptText: '', importedScriptTitle: '' }))
    setError(null)
  }, [])

  const selectWriterScript = (scriptId: string) => {
    if (submittingRef.current) return
    setSelectedScriptId(scriptId)
    const script = scripts.find((item) => item.id === scriptId)
    if (!script) {
      set('importedScriptText', '')
      set('importedScriptTitle', '')
      return
    }
    const content = script.episodes
      .map((episode, index) => `${episode.title || `第 ${index + 1} 集`}\n${episode.body}`.trim())
      .join('\n\n')
    setDraft((previous) => ({
      ...previous,
      scriptFile: null,
      importedScriptText: content,
      importedScriptTitle: script.title,
    }))
    setError(null)
  }

  const analyzeStyleReferences = async () => {
    if (styleAnalyzing || submittingRef.current) return
    const images = styleReferenceItems.filter((item) => (
      item.kind === 'image' && item.validationStatus === 'ready'
    ))
    if (images.length === 0) {
      setError('请先上传至少一张 JPG 或 PNG 画风参考图片。')
      return
    }
    setStyleAnalyzing(true)
    setError(null)
    try {
      const form = new FormData()
      for (const item of images) {
        form.append('styleReferenceFiles', item.file, item.file.name)
      }
      const response = await apiFetch('/api/projects/style-reference-analysis', {
        method: 'POST',
        body: form,
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '画风解析失败'))
      const payload = await response.json() as { prompt?: string }
      const prompt = payload.prompt?.trim() || ''
      if (!prompt) throw new Error('画风解析失败：服务未返回画风提示词')
      analyzedReferenceSignatureRef.current = styleReferenceImageSignature
      setDraft((previous) => ({ ...previous, referenceArtStylePrompt: prompt }))
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : '画风解析失败')
    } finally {
      setStyleAnalyzing(false)
    }
  }

  const hasInitialInput = (
    (firstInputMode === 'video' && Boolean(selectedVideoMaterial))
    || (firstInputMode === 'pasted_script' && Boolean(pastedScriptText.trim()))
  )

  const buildBatchWorkflowPayload = (skipInitialInput: boolean): CreateProjectBatchWorkflowPayload => {
    const defaultS2Slug = selectedTemplate?.stages.find((st) => st.stage === 'script_rewrite')?.skillSlug || ''
    const overrides: Record<string, string> = {}
    if (s2SkillOverrideSlug && s2SkillOverrideSlug !== defaultS2Slug) {
      overrides.script_rewrite = s2SkillOverrideSlug
    }

    const base: CreateProjectBatchWorkflowPayload = {
      ...(selectedTemplate?.id ? { templateId: selectedTemplate.id } : {}),
      track: selectedTemplate?.track || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
      runMode: batchRunMode,
      modelConfig: {
        ...workflowModelConfig,
      },
      ...(Object.keys(overrides).length > 0 ? { stageSkillOverrides: overrides } : {}),
    }

    if (!skipInitialInput && firstInputMode === 'video' && selectedVideoMaterial) {
      const durationSec = readMaterialDurationSec(selectedVideoMaterial)
      const videoTitle = firstItemTitle.trim() || selectedVideoMaterial.title || draft.name.trim() || '参考视频 1'
      const initialItem: CreateProjectBatchWorkflowInitialItem = {
        sourceType: 'video',
        title: videoTitle,
        sourceVideoMaterialId: selectedVideoMaterial.id,
        sourceVideoStorageKey: selectedVideoMaterial.storageKey,
        sourceVideoUrl: selectedVideoMaterial.url || selectedVideoMaterial.resultUrl,
        sourceVideoFileName: selectedVideoMaterial.title || videoTitle,
        sourceVideoDurationSec: durationSec,
        skipVideoAnalysis: false,
      }
      base.initialItem = initialItem
      base.sourceVideoMaterialId = selectedVideoMaterial.id
      base.sourceVideoStorageKey = selectedVideoMaterial.storageKey
      base.sourceVideoUrl = selectedVideoMaterial.url || selectedVideoMaterial.resultUrl
      base.sourceVideoFileName = selectedVideoMaterial.title || videoTitle
      base.items = [{
        title: videoTitle,
        input: {
          sourceType: 'video',
          sourceVideoMaterialId: selectedVideoMaterial.id,
          sourceVideoStorageKey: selectedVideoMaterial.storageKey,
          sourceVideoUrl: selectedVideoMaterial.url || selectedVideoMaterial.resultUrl,
          sourceVideoFileName: selectedVideoMaterial.title || videoTitle,
          sourceVideoDurationSec: durationSec,
          skipVideoAnalysis: false,
          aspectRatio: workflowModelConfig.videoAspectRatio,
        },
      }]
    } else if (!skipInitialInput && firstInputMode === 'pasted_script' && pastedScriptText.trim()) {
      const script = pastedScriptText.trim()
      const scriptTitle = firstItemTitle.trim() || draft.name.trim() || '粘贴剧本 1'
      const initialItem: CreateProjectBatchWorkflowInitialItem = {
        sourceType: 'pasted_script',
        title: scriptTitle,
        skipVideoAnalysis: true,
        pastedScript: script,
      }
      base.initialItem = initialItem
      base.pastedScript = script
      base.items = [{
        title: scriptTitle,
        input: {
          sourceType: 'pasted_script',
          skipVideoAnalysis: true,
          pastedScript: script,
          aspectRatio: workflowModelConfig.videoAspectRatio,
        },
      }]
    }

    return base
  }

  const runCreate = async (skipInitialInput = false) => {
    if (submittingRef.current) return
    if (!draft.name.trim()) { setError('作品名称必填'); return }
    if (uploadingVideo) { setError('参考视频仍在上传中，请稍候。'); return }
    if ((draft.creationMode === 'canvas' || draft.creationMode === 'batch_workflow') && inherit.issue) {
      setError(inherit.issue)
      return
    }
    if (draft.creationMode === 'workflow' && draft.materialType === 'script' && source === 'writer' && !draft.importedScriptText.trim()) { setError('请选择一个状态为“可用”的剧本'); return }
    if (draft.creationMode === 'workflow' && source === 'local' && !draft.scriptFile) { setError(`请上传 txt、docx 或 pdf ${draft.materialType === 'script' ? '剧本' : '小说/大纲'}文件`); return }
    if (draft.creationMode === 'workflow' && variant.showStyleReferences && styleReferenceItems.some((item) => item.validationStatus === 'validating')) { setError('画风参考视频仍在读取，请稍候。'); return }
    if (draft.creationMode === 'workflow' && variant.showStyleReferences && styleReferenceItems.some((item) => item.validationStatus === 'failed')) { setError('请移除无法读取或超过 1 分钟的画风参考视频。'); return }
    if (draft.creationMode === 'workflow' && styleAnalyzing) { setError('参考图画风仍在解析，请稍候。'); return }
    if ((draft.creationMode === 'workflow' || draft.creationMode === 'batch_workflow') && draft.collaborationMode === 'team' && !(
      draft.writerAssigneeUserId
      || draft.assetAssigneeUserId
      || draft.storyboardAssigneeUserId
    )) {
      setError('任务分工模式至少需要选择一名编剧、资产师或分镜师。')
      return
    }
    const durationValue = draft.creationMode !== 'workflow'
      ? 120
      : typeof draft.episodeDurationValue === 'number'
        ? draft.episodeDurationValue
        : Number.NaN
    if (draft.creationMode === 'workflow' && !Number.isInteger(durationValue)) {
      setError('请输入单集时长')
      return
    }
    if (draft.creationMode === 'workflow' && (!Number.isInteger(durationValue) || durationValue < bounds.minimum || durationValue > bounds.maximum)) {
      setError(`时长必须是 ${bounds.minimum}–${bounds.maximum} 的整数`)
      return
    }
    if (draft.creationMode === 'workflow' && source === 'range' && (
      !Number.isInteger(draft.initialEpisodeStart)
      || !Number.isInteger(draft.initialEpisodeEnd)
      || draft.initialEpisodeStart < 1
      || draft.initialEpisodeEnd > 100
      || draft.initialEpisodeStart > draft.initialEpisodeEnd
    )) {
      setError('起止集数必须是 1–100 的整数，且结束集数不能小于起始集数')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitStatus(draft.creationMode === 'batch_workflow' ? '创建视频工作流作品…' : '创建作品…')
    setError(null)
    setStyleReferenceItems((current) => current.map((item) => ({
      ...item,
      uploadStatus: 'idle',
      progress: 0,
      error: null,
    })))
    try {
      const styleReferenceFiles = draft.creationMode === 'workflow' && variant.showStyleReferences
        ? toProjectStyleReferenceDraftFiles(styleReferenceItems)
        : []
      const normalizedDraft: CreateProjectDraft = {
        ...draft,
        videoRatio: workflowModelConfig.videoAspectRatio === '16:9' ? '16:9' : draft.videoRatio,
        videoResolution: (workflowModelConfig.videoResolution === '480p'
          || workflowModelConfig.videoResolution === '720p'
          || workflowModelConfig.videoResolution === '1080p')
          ? workflowModelConfig.videoResolution
          : draft.videoResolution,
        episodeDurationValue: durationValue,
      }
      const inheritFields = inherit.request
        ? { inheritSourceProjectId: inherit.request.sourceProjectId, inheritMaterialIds: inherit.request.materialIds }
        : {}
      const nextDraft: CreateProjectDraft = draft.creationMode === 'canvas'
        ? {
            ...normalizedDraft,
            collaborationMode: 'solo',
            scriptFile: null,
            importedScriptText: '',
            importedScriptTitle: '',
            initializeEpisodeRange: false,
            styleReferenceFiles: [],
            ...inheritFields,
          }
        : draft.creationMode === 'batch_workflow'
          ? {
              ...normalizedDraft,
              scriptFile: null,
              importedScriptText: '',
              importedScriptTitle: '',
              initializeEpisodeRange: false,
              styleReferenceFiles: [],
              ...inheritFields,
              batchWorkflow: buildBatchWorkflowPayload(skipInitialInput),
            }
          : source === 'blank'
            ? { ...normalizedDraft, scriptFile: null, importedScriptText: '', importedScriptTitle: '', initializeEpisodeRange: false, styleReferenceFiles }
            : variant.allowEpisodeRange && source === 'range'
              ? { ...normalizedDraft, scriptFile: null, importedScriptText: '', importedScriptTitle: '', initializeEpisodeRange: true, styleReferenceFiles }
              : { ...normalizedDraft, initializeEpisodeRange: false, styleReferenceFiles }
      const onStyleReferenceProgress = (update: ProjectStyleReferenceProgressUpdate) => {
        setStyleReferenceItems((current) => current.map((item) => (item.id === update.id
          ? { ...item, uploadStatus: update.status, progress: update.progress, error: update.error ?? null }
          : item)))
      }
      const ok = await onCreate(nextDraft, setSubmitStatus, onStyleReferenceProgress)
      if (ok) onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建作品失败')
      setStyleReferenceItems((current) => current.map((item) => (item.uploadStatus === 'failed'
        ? item
        : { ...item, uploadStatus: 'idle', progress: 0 })))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await runCreate(false)
  }

  const filteredScripts = scripts.filter((script) => script.title.toLocaleLowerCase().includes(scriptSearch.trim().toLocaleLowerCase()))
  const hasUnsavedInput = Boolean(
    draft.name.trim()
    || selectedVideoMaterial
    || pastedScriptText.trim()
    || draft.scriptFile
    || draft.importedScriptText
    || draft.artStylePrompt.trim()
    || styleReferenceItems.length,
  )
  const requestClose = async () => {
    if (submittingRef.current) return
    if (hasUnsavedInput && !await confirmAction({
      title: '放弃创建作品？',
      message: '已填写的名称、工作流配置和初始素材不会保存。',
      confirmLabel: '放弃',
      cancelLabel: '继续编辑',
      danger: true,
    })) return
    onClose()
  }
  const stopWhileSubmitting = (event: React.SyntheticEvent) => {
    if (!submittingRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="fos-overlay create-project-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) void requestClose() }}>
      <form
        ref={dialogRef}
        className="fos-dialog create-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="创建作品"
        aria-busy={submitting}
        tabIndex={-1}
        noValidate
        onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            const dialog = dialogRef.current
            if (dialog && trapCreateProjectDialogTab(dialog, document.activeElement, event.shiftKey)) {
              event.preventDefault()
              event.stopPropagation()
            }
            return
          }
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          void requestClose()
        }}
      >
        <header className="fos-dialog-head">
          <div>
            <div className="fos-dialog-title">创建作品</div>
            {workName ? <div className="create-project-work-name">所属项目 · {workName}</div> : null}
          </div>
          <button type="button" className="fos-dialog-x" disabled={submitting} onClick={() => void requestClose()} aria-label="关闭创建作品">
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="fos-dialog-body create-project-body" onClick={stopWhileSubmitting}>
          <fieldset className="create-project-payload-fields" disabled={submitting}>
            {/* Visual 2-Mode Production Selector */}
            <section className="create-project-section">
              <div className="create-project-label">制作方式</div>
              <div className="bw-cp-mode-cards" role="radiogroup" aria-label="制作方式">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.creationMode === 'batch_workflow'}
                  data-testid="creation-mode-batch-workflow"
                  className={`bw-cp-mode-card${draft.creationMode === 'batch_workflow' ? ' is-selected' : ''}`}
                  onClick={() => {
                    set('creationMode', 'batch_workflow')
                    setBatchStep(1)
                    setError(null)
                  }}
                >
                  <div className="bw-cp-mode-head">
                    <span className="bw-cp-mode-title">
                      <AppIcon name="sparkles" className="h-4 w-4" />
                      视频工作流（推荐）
                    </span>
                    <span className="bw-cp-mode-badge">5 步全能</span>
                  </div>
                  <p className="bw-cp-mode-desc">
                    从参考视频或粘贴剧本出发，经由解析 → 洗稿 → 资产出图 → @资产分镜 → 批量生视频，并支持一键展开至无限画布精修。
                  </p>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.creationMode === 'canvas'}
                  data-testid="creation-mode-canvas"
                  className={`bw-cp-mode-card${draft.creationMode === 'canvas' ? ' is-selected' : ''}`}
                  onClick={() => {
                    set('creationMode', 'canvas')
                    setError(null)
                  }}
                >
                  <div className="bw-cp-mode-head">
                    <span className="bw-cp-mode-title">
                      <AppIcon name="monitor" className="h-4 w-4" />
                      无限画布
                    </span>
                  </div>
                  <p className="bw-cp-mode-desc">
                    自由连线文/图/视频/3D 节点，适合单条精细化创作与导演台布景。
                  </p>
                </button>
              </div>
              <div className="bw-cp-legacy-toggle">
                <button
                  type="button"
                  className="bw-cp-legacy-btn"
                  onClick={() => {
                    set('creationMode', draft.creationMode === 'workflow' ? 'batch_workflow' : 'workflow')
                    setError(null)
                  }}
                >
                  {draft.creationMode === 'workflow' ? '返回视频工作流 / 无限画布' : '需要使用传统剧集工作台？点此切换'}
                </button>
              </div>
            </section>

            {/* Shared Work Name */}
            <label className="create-project-field">
              <span className="create-project-label">作品名称 <small>{draft.name.length} / 40</small></span>
              <input
                ref={initialFocusRef}
                className="fos-input"
                placeholder={draft.creationMode === 'batch_workflow' ? '例如：春季漫剧带货爆款翻拍第 1 批' : '请输入作品名称'}
                required
                maxLength={40}
                value={draft.name}
                onChange={(event) => { set('name', event.target.value); setError(null) }}
              />
            </label>

            {/* Mode 1: Upgraded 5-Stage Video Workflow 2-Step Wizard */}
            {draft.creationMode === 'batch_workflow' ? (
              <section className="create-project-workflow-settings" data-testid="batch-workflow-wizard">
                <div className="bw-cp-stepper" role="tablist" aria-label="视频工作流创建步骤">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={batchStep === 1}
                    className={`bw-cp-step${batchStep === 1 ? ' is-active' : ''}`}
                    onClick={() => setBatchStep(1)}
                  >
                    <span className="bw-cp-step-num">1</span>
                    <span>赛道配方与默认模型</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={batchStep === 2}
                    className={`bw-cp-step${batchStep === 2 ? ' is-active' : ''}`}
                    onClick={() => setBatchStep(2)}
                  >
                    <span className="bw-cp-step-num">2</span>
                    <span>
                      首个参考输入（可选）
                      {hasInitialInput ? ' · 已就绪' : ''}
                    </span>
                  </button>
                </div>

                {batchStep === 1 ? (
                  <>
                    {/* Track Presets showing composing Skills */}
                    <section className="create-project-section">
                      <div className="create-project-label">
                        选择赛道预设模板
                        <small>{batchMetaLoading ? '加载最新配方中…' : '每套预设由 5 个可插拔 Skill 组合而成，进入工作流后仍可随时热切换'}</small>
                      </div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {displayTemplates.map((tpl) => {
                          const active = selectedTemplate?.id === tpl.id
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              className={`bw-cp-template-card${active ? ' is-selected' : ''}`}
                              onClick={() => setSelectedTemplateId(tpl.id)}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fos-text-1)' }}>{tpl.name}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span className="bw-track-pill">{WORKFLOW_TRACK_LABELS[tpl.track] || tpl.track}</span>
                                  <span className="wf-badge is-muted">{tpl.isBuiltin ? '官方' : '自定义'}</span>
                                </span>
                              </div>
                              {tpl.description ? (
                                <p style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.5, color: 'var(--fos-text-3)' }}>
                                  {tpl.description}
                                </p>
                              ) : null}
                              <div className="bw-cp-mini-flow">
                                {WORKFLOW_STAGES.map((stage, idx) => {
                                  const st = tpl.stages.find((item) => item.stage === stage)
                                  const meta = WORKFLOW_STAGE_META[stage]
                                  const skillLabel = (st?.skillId && skillNameBySlugOrId.get(st.skillId))
                                    || (st?.skillSlug && skillNameBySlugOrId.get(st.skillSlug))
                                    || meta.label
                                  return (
                                    <span key={stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      <span
                                        className={`bw-cp-mini-node${st?.gateMode === 'manual_review' ? ' is-gate' : ''}`}
                                        title={`${meta.label} · ${skillLabel}`}
                                      >
                                        <span>{meta.code}</span>
                                        <span>{skillLabel}</span>
                                      </span>
                                      {idx < WORKFLOW_STAGES.length - 1 ? (
                                        <span style={{ fontSize: 10, color: 'var(--fos-text-4)' }}>→</span>
                                      ) : null}
                                    </span>
                                  )
                                })}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </section>

                    {/* Optional S2 Style Skill Quick Pick */}
                    {s2Skills.length > 1 ? (
                      <section className="create-project-section">
                        <div className="create-project-label">
                          S2 洗稿风格快选
                          <small>快速覆盖本作品的默认剧本改写风格</small>
                        </div>
                        <div className="bw-cp-skill-pills" role="radiogroup" aria-label="S2 洗稿风格快选">
                          {s2Skills.map((skill) => {
                            const selected = s2SkillOverrideSlug === skill.slug
                            return (
                              <button
                                key={skill.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                className={`bw-cp-skill-pill${selected ? ' is-selected' : ''}`}
                                title={skill.description || skill.name}
                                onClick={() => setS2SkillOverrideSlug(skill.slug)}
                              >
                                <AppIcon name={selected ? 'check' : 'sparkles'} className="h-3.5 w-3.5" />
                                <span>{skill.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      </section>
                    ) : null}

                    {/* Execution Mode */}
                    <section className="create-project-section">
                      <div className="create-project-label">运行模式</div>
                      <div className="create-project-mode-grid">
                        <button
                          type="button"
                          className={batchRunMode === 'gated' ? 'is-selected' : ''}
                          onClick={() => setBatchRunMode('gated')}
                        >
                          <span><AppIcon name="clipboardCheck" />分阶段审阅（推荐）</span>
                          <small>每完成关键阶段自动停靠，可在线微调剧本/资产/分镜后再消耗下阶段算力</small>
                        </button>
                        <button
                          type="button"
                          className={batchRunMode === 'auto' ? 'is-selected' : ''}
                          onClick={() => setBatchRunMode('auto')}
                        >
                          <span><AppIcon name="bolt" />一键全流程</span>
                          <small>导入参考视频或剧本后自动贯通 S1–S5 全链路直出成片，适合成熟配方批量跑量</small>
                        </button>
                      </div>
                    </section>

                    {/* Work-Level Model Defaults fetched live from /api/frameos/generation-config */}
                    <section className="create-project-section">
                      <div className="create-project-label">
                        作品默认模型与规格
                        <small>自动加载当前账号可用模型，进入工作流后可随时在顶栏调整</small>
                      </div>
                      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                        <label>
                          <span className="bw-label">文本模型</span>
                          <select
                            className="bw-select"
                            aria-label="默认文本模型"
                            value={workflowModelConfig.textModelKey}
                            onChange={(event) => setWorkflowModelConfig((prev) => ({ ...prev, textModelKey: event.target.value }))}
                          >
                            {textModels.length === 0 ? (
                              <option value={workflowModelConfig.textModelKey}>系统默认文本模型</option>
                            ) : (
                              textModels.map((model) => (
                                <option key={model.modelKey} value={model.modelKey} disabled={model.available === false}>
                                  {model.name}{model.available === false ? '（不可用）' : ''}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <label>
                          <span className="bw-label">生图模型</span>
                          <select
                            className="bw-select"
                            aria-label="默认生图模型"
                            value={workflowModelConfig.imageModelKey}
                            onChange={(event) => setWorkflowModelConfig((prev) => ({ ...prev, imageModelKey: event.target.value }))}
                          >
                            {imageModels.length === 0 ? (
                              <option value={workflowModelConfig.imageModelKey}>系统默认生图模型</option>
                            ) : (
                              imageModels.map((model) => (
                                <option key={model.modelKey} value={model.modelKey} disabled={model.available === false}>
                                  {model.name}{model.available === false ? '（不可用）' : ''}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <label>
                          <span className="bw-label">视频模型</span>
                          <select
                            className="bw-select"
                            aria-label="默认视频模型"
                            value={workflowModelConfig.videoModelKey}
                            onChange={(event) => setWorkflowModelConfig((prev) => ({ ...prev, videoModelKey: event.target.value }))}
                          >
                            {videoModels.length === 0 ? (
                              <option value={workflowModelConfig.videoModelKey}>系统默认视频模型</option>
                            ) : (
                              videoModels.map((model) => (
                                <option key={model.modelKey} value={model.modelKey} disabled={model.available === false}>
                                  {model.name}{model.available === false ? '（不可用）' : ''}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                      </div>

                      <div className="create-project-config-grid" style={{ marginTop: 10 }}>
                        <ProjectPillGroup
                          label="画幅比例"
                          value={workflowModelConfig.videoAspectRatio}
                          options={WORKFLOW_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))}
                          onChange={(value) => {
                            setWorkflowModelConfig((prev) => ({ ...prev, videoAspectRatio: value }))
                            if (value === '9:16' || value === '16:9') set('videoRatio', value)
                          }}
                        />
                        <ProjectPillGroup
                          label="视频清晰度"
                          value={(WORKFLOW_VIDEO_RESOLUTIONS.includes(workflowModelConfig.videoResolution as '480p' | '720p' | '1080p')
                            ? workflowModelConfig.videoResolution
                            : '720p') as '480p' | '720p' | '1080p'}
                          options={WORKFLOW_VIDEO_RESOLUTIONS.map((res) => ({ value: res, label: res }))}
                          onChange={(value) => {
                            setWorkflowModelConfig((prev) => ({ ...prev, videoResolution: value }))
                            set('videoResolution', value)
                          }}
                        />
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                    {/* Step 2: Optional First Input */}
                    <section className="create-project-section">
                      <div className="create-project-label">
                        首个输入来源（可选）
                        <small>支持导入参考视频拆解、跳过视频直接粘贴剧本，或先建空工作流进入后再导入</small>
                      </div>
                      <div className="create-project-source-tabs" role="tablist" aria-label="首个输入方式">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={firstInputMode === 'video'}
                          className={firstInputMode === 'video' ? 'is-active' : ''}
                          onClick={() => setFirstInputMode('video')}
                        >
                          选择 / 上传参考视频
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={firstInputMode === 'pasted_script'}
                          className={firstInputMode === 'pasted_script' ? 'is-active' : ''}
                          onClick={() => setFirstInputMode('pasted_script')}
                        >
                          跳过视频，直接粘贴剧本
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={firstInputMode === 'empty'}
                          className={firstInputMode === 'empty' ? 'is-active' : ''}
                          onClick={() => setFirstInputMode('empty')}
                        >
                          先建空工作流再导入
                        </button>
                      </div>

                      {firstInputMode === 'video' ? (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <input
                            ref={videoUploadInputRef}
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm,video/*"
                            hidden
                            onChange={(event) => {
                              void handleUploadLocalVideo(event.currentTarget.files?.[0] || null)
                              event.currentTarget.value = ''
                            }}
                          />
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                            <button
                              type="button"
                              className="bw-btn"
                              disabled={uploadingVideo}
                              onClick={() => setVideoPickerOpen(true)}
                            >
                              <AppIcon name="video" className="h-3.5 w-3.5" />
                              <span>从资产库选择参考视频</span>
                            </button>
                            <button
                              type="button"
                              className="bw-btn"
                              disabled={uploadingVideo}
                              onClick={() => videoUploadInputRef.current?.click()}
                            >
                              <AppIcon name={uploadingVideo ? 'loader' : 'upload'} className={uploadingVideo ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                              <span>{uploadingVideo ? '正在上传视频…' : '上传本地视频'}</span>
                            </button>
                          </div>

                          {selectedVideoMaterial ? (
                            <div className="bw-cp-summary-bar">
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <AppIcon name="film" className="h-4 w-4 shrink-0" />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  已选参考视频：{selectedVideoMaterial.title || '未命名视频'}
                                  {formatDurationBadge(readMaterialDurationSec(selectedVideoMaterial))
                                    ? ` · ${formatDurationBadge(readMaterialDurationSec(selectedVideoMaterial))}`
                                    : ''}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="bw-btn bw-btn-sm"
                                onClick={() => setSelectedVideoMaterial(null)}
                              >
                                移除
                              </button>
                            </div>
                          ) : (
                            <div className="create-project-empty-range">
                              <p>未选择视频也可直接创建；创建后可在 S1 剧本解析工作台随时拖拽上传参考视频。</p>
                            </div>
                          )}

                          {selectedVideoMaterial ? (
                            <label>
                              <span className="bw-label">条目名称（选填）</span>
                              <input
                                className="bw-input"
                                value={firstItemTitle}
                                onChange={(event) => setFirstItemTitle(event.target.value)}
                                placeholder={selectedVideoMaterial.title || '例如：爆款参考视频 1'}
                              />
                            </label>
                          ) : null}
                        </div>
                      ) : firstInputMode === 'pasted_script' ? (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <label>
                            <span className="bw-label">条目名称（选填）</span>
                            <input
                              className="bw-input"
                              value={firstItemTitle}
                              onChange={(event) => setFirstItemTitle(event.target.value)}
                              placeholder="例如：第 1 集初稿剧本"
                            />
                          </label>
                          <label>
                            <span className="bw-label">
                              粘贴已有剧本 / 故事大纲（{pastedScriptText.length} 字 · 自动跳过 S1 视频解析）
                            </span>
                            <textarea
                              className="bw-textarea"
                              rows={6}
                              value={pastedScriptText}
                              onChange={(event) => setPastedScriptText(event.target.value)}
                              placeholder={'例如：\n场次 1：办公室深夜\n林晚盯着屏幕叹气，同事嘲讽她熬夜脸色差。\n林晚微笑反击，从包里拿出修护精华……'}
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="create-project-empty-range" style={{ marginTop: 10 }}>
                          <p>将直接创建已配置好赛道模板与默认模型的空工作流。进入后可随时批量导入参考视频或粘贴剧本。</p>
                        </div>
                      )}
                    </section>

                    <section className="create-project-section" data-testid="nori-collaboration-mode">
                      <div className="create-project-label">协作与资产继承（可选）</div>
                      <div className="create-project-mode-grid">
                        <button type="button" className={draft.collaborationMode === 'solo' ? 'is-selected' : ''} onClick={() => set('collaborationMode', 'solo')}>
                          <span><AppIcon name="link" />自由协作</span><small>所有协作者均可使用创作功能（默认）</small>
                        </button>
                        <button type="button" className={draft.collaborationMode === 'team' ? 'is-selected' : ''} onClick={() => set('collaborationMode', 'team')}>
                          <span><AppIcon name="usersRound" />任务分工</span><small>按剧本、资产、分镜分派负责人</small>
                        </button>
                      </div>
                    </section>

                    {draft.collaborationMode === 'team' ? (
                      <section className="create-project-section create-project-assignment-section" data-testid="project-role-assignees">
                        <div className="create-project-label">任务负责人</div>
                        <div className="create-project-assignment-grid">
                          {ASSIGNMENT_ROLE_OPTIONS.map((option) => (
                            <label key={option.role}>
                              <span className={`create-project-assignment-icon is-${option.role}`}><AppIcon name="user" /></span>
                              <span className="create-project-assignment-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
                              <select
                                className="fos-input"
                                aria-label={`${option.label}负责人`}
                                value={draft[option.field]}
                                onChange={(event) => { set(option.field, event.target.value); setError(null) }}
                              >
                                <option value="">暂不分配</option>
                                {memberCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.roleLabel ? ` · ${candidate.roleLabel}` : ''}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                        {membersLoading ? <div className="create-project-assignment-state"><AppIcon name="loader" className="animate-spin" />正在读取子账号…</div> : null}
                        {!membersLoading && membersError ? <div className="create-project-assignment-state is-error">{membersError}</div> : null}
                      </section>
                    ) : null}

                    <InheritAssetsSection inherit={inherit} sources={inheritSources} />
                  </>
                )}
              </section>
            ) : null}

            {/* Mode 2: Infinite Canvas */}
            {draft.creationMode === 'canvas' ? (
              <>
                <p className="works-dialog-intro">创建作品与空白无限画布，支持文/图/视频/3D 节点自由连线与精细化导演布景。</p>
                <InheritAssetsSection inherit={inherit} sources={inheritSources} />
              </>
            ) : null}

            {/* Legacy Mode 3: Structured Workbench */}
            {draft.creationMode === 'workflow' && <section className="create-project-workflow-settings">
              <section className="create-project-section">
                <div className="create-project-label">作品版本</div>
                <div className="create-project-level-grid is-single">
                  <div className="create-project-level is-selected" data-testid="nori-project-level">
                    <span className="create-project-radio is-on" />
                    <strong>LanmiaoTV 1.0</strong>
                    <span className="create-project-level-kicker">传统剧集工业化生产工作台</span>
                    <ul>
                      <li>剧本、资产、分镜与视频使用同一作品配置</li>
                      <li>支持自由协作或按角色分工、提交与审核</li>
                      <li>统一画风持续注入资产图、分镜图和视频生成</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section className="create-project-section" data-testid="nori-collaboration-mode">
                <div className="create-project-label">作品协作方式</div>
                <div className="create-project-mode-grid">
                  <button type="button" className={draft.collaborationMode === 'solo' ? 'is-selected' : ''} onClick={() => set('collaborationMode', 'solo')}>
                    <span><AppIcon name="link" />自由协作</span><small>所有协作者均可使用创作功能，不分配任务（默认）</small>
                  </button>
                  <button type="button" className={draft.collaborationMode === 'team' ? 'is-selected' : ''} onClick={() => set('collaborationMode', 'team')}>
                    <span><AppIcon name="usersRound" />任务分工</span><small>按剧本、资产、分镜、视频分派任务，支持提交与审核</small>
                  </button>
                </div>
              </section>

              {draft.collaborationMode === 'team' ? (
                <section className="create-project-section create-project-assignment-section" data-testid="project-role-assignees">
                  <div className="create-project-label">
                    任务负责人
                    <small>从当前工作区选择负责人；同一账号可承担多个任务</small>
                  </div>
                  <div className="create-project-assignment-grid">
                    {ASSIGNMENT_ROLE_OPTIONS.map((option) => (
                      <label key={option.role}>
                        <span className={`create-project-assignment-icon is-${option.role}`}><AppIcon name="user" /></span>
                        <span className="create-project-assignment-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
                        <select
                          className="fos-input"
                          aria-label={`${option.label}负责人`}
                          value={draft[option.field]}
                          onChange={(event) => { set(option.field, event.target.value); setError(null) }}
                        >
                          <option value="">暂不分配</option>
                          {memberCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.roleLabel ? ` · ${candidate.roleLabel}` : ''}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  {membersLoading ? <div className="create-project-assignment-state"><AppIcon name="loader" className="animate-spin" />正在读取管理账号下的子账号…</div> : null}
                  {!membersLoading && membersError ? <div className="create-project-assignment-state is-error">{membersError}</div> : null}
                  {!membersLoading && !membersError && memberCandidates.length === 0 ? (
                    <div className="create-project-assignment-state">暂无可分配子账号，请先在账号管理中创建并启用子账号。</div>
                  ) : null}
                </section>
              ) : null}

              <section className="create-project-config-grid">
                <ProjectPillGroup
                  label="作品风格"
                  className="is-style"
                  value={draft.projectStyle}
                  options={[
                    { value: 'live-action', label: '仿真人' },
                    { value: 'anime-3d', label: '3D 动漫' },
                    { value: 'anime-2.5d', label: '2.5D 动漫' },
                    { value: 'anime-2d', label: '2D 动漫' },
                  ]}
                  onChange={(value) => set('projectStyle', value)}
                />
                <ProjectPillGroup
                  label="目标受众"
                  value={draft.targetAudience}
                  options={[
                    { value: 'global-platform', label: '海外平台' },
                    { value: 'zh-platform', label: '中文平台' },
                  ]}
                  onChange={(value) => set('targetAudience', value)}
                />
                <ProjectPillGroup
                  label="比例"
                  value={draft.videoRatio}
                  options={[
                    { value: '9:16', label: '竖版 9:16' },
                    { value: '16:9', label: '横版 16:9' },
                  ]}
                  onChange={(value) => set('videoRatio', value)}
                />
                <ProjectPillGroup
                  label="分辨率"
                  value={draft.videoResolution}
                  options={[
                    { value: '480p', label: '480p' },
                    { value: '720p', label: '720p' },
                    { value: '1080p', label: '1080p' },
                    { value: '4K', label: '4K' },
                  ]}
                  onChange={(value) => set('videoResolution', value)}
                />
              </section>
              <div className="create-project-base-style">
                <AppIcon name="sparkles" />
                <span>
                  <strong>{draft.artStylePrompt.trim() ? '内置画风已被自定义画风覆盖' : '内置画风基线'}</strong>
                  {draft.artStylePrompt.trim()
                    ? '当前作品生成时不会使用上方所选画风。'
                    : PROJECT_STYLE_SUMMARIES[draft.projectStyle]}
                </span>
              </div>

              <section className="create-project-duration">
                <div className="create-project-label">单集时长</div>
                <div className="create-project-duration-row">
                  <div className="create-project-duration-tabs" role="radiogroup" aria-label="单集时长控制方式">
                    <button type="button" role="radio" aria-checked={draft.episodeDurationMode === 'per-1000-chars'} className={draft.episodeDurationMode === 'per-1000-chars' ? 'is-selected' : ''} onClick={() => set('episodeDurationMode', 'per-1000-chars')}>每千字</button>
                    <button type="button" role="radio" aria-checked={draft.episodeDurationMode === 'per-episode'} className={draft.episodeDurationMode === 'per-episode' ? 'is-selected' : ''} onClick={() => set('episodeDurationMode', 'per-episode')}>每集</button>
                  </div>
                  <label title={draft.episodeDurationMode === 'per-episode' ? '直接指定单集目标总时长' : '按每千字预计时长折算单集时长'}>
                    <input
                      className="fos-input"
                      type="number"
                      step={1}
                      min={bounds.minimum}
                      max={bounds.maximum}
                      required
                      value={draft.episodeDurationValue}
                      onChange={(event) => set('episodeDurationValue', event.target.value === '' ? '' : Number(event.target.value))}
                    />
                    <span>{draft.episodeDurationMode === 'per-episode' ? '秒/集' : '秒/千字'}</span>
                  </label>
                </div>
              </section>

              <section className="create-project-materials">
                <div className="create-project-script-column">
                  <div className="create-project-label">初始内容（可选）</div>
                  <div className="create-project-source-tabs" role="tablist" aria-label="初始内容来源">
                    <button type="button" role="tab" aria-selected={source === 'blank'} className={source === 'blank' ? 'is-active' : ''} onClick={() => setSource('blank')}>空白作品</button>
                    <button type="button" role="tab" aria-selected={source === 'writer'} className={source === 'writer' ? 'is-active' : ''} onClick={() => setSource('writer')}>导入剧本</button>
                    <button type="button" role="tab" aria-selected={source === 'local'} className={source === 'local' ? 'is-active' : ''} onClick={() => setSource('local')}>本地上传</button>
                    {variant.allowEpisodeRange ? <button type="button" role="tab" aria-selected={source === 'range'} className={source === 'range' ? 'is-active' : ''} onClick={() => setSource('range')}>指定集数范围</button> : null}
                  </div>
                  {source === 'blank' ? (
                    <div className="create-project-empty-range">
                      <p>仅创建空白作品，不导入剧本、不预建剧集。进入工作台后可自行创建剧集并编写内容。</p>
                    </div>
                  ) : source === 'writer' ? (
                    <div className="create-project-script-picker">
                      <div className="create-project-script-search">
                        <AppIcon name="search" aria-hidden="true" />
                        <input
                          className="fos-input"
                          type="search"
                          aria-label="搜索可用剧本"
                          value={scriptSearch}
                          onChange={(event) => setScriptSearch(event.target.value)}
                          placeholder="搜索编剧工作台中“可用”的剧本"
                        />
                      </div>
                      <div className="create-project-script-list">
                        {scriptsLoading ? <div className="create-project-script-empty"><AppIcon name="loader" className="animate-spin" />加载可用剧本…</div> : filteredScripts.length === 0 ? <div className="create-project-script-empty">暂无“可用”剧本，请先在编剧工作台标记为可用，或改用本地上传。</div> : filteredScripts.map((script) => <button type="button" key={script.id} className={selectedScriptId === script.id ? 'is-selected' : ''} onClick={() => selectWriterScript(script.id)}><span><strong>{script.title}</strong><small>{script.episodes.length} 集 · 已标记可用</small></span>{selectedScriptId === script.id ? <AppIcon name="check" /> : null}</button>)}
                      </div>
                    </div>
                  ) : source === 'local' ? (
                    <div
                      className={`create-project-dropzone${dragActive ? ' is-dragging' : ''}`}
                      role="button"
                      aria-disabled={submitting}
                      tabIndex={submitting ? -1 : 0}
                      onClick={() => { if (!submittingRef.current) fileInputRef.current?.click() }}
                      onKeyDown={(event) => { if (!submittingRef.current && (event.key === 'Enter' || event.key === ' ')) fileInputRef.current?.click() }}
                      onDragOver={(event: DragEvent) => { event.preventDefault(); if (!submittingRef.current) setDragActive(true) }}
                      onDragLeave={() => { if (!submittingRef.current) setDragActive(false) }}
                      onDrop={(event: DragEvent) => { event.preventDefault(); if (submittingRef.current) return; setDragActive(false); handleFile(event.dataTransfer.files?.[0] || null) }}
                      onPaste={(event) => handleFile(event.clipboardData.files?.[0] || null)}
                    >
                      <input ref={fileInputRef} type="file" accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(event) => { handleFile(event.currentTarget.files?.[0] || null); event.currentTarget.value = '' }} />
                      <AppIcon name={draft.scriptFile ? 'fileText' : 'cloudUpload'} />
                      <strong>{draft.scriptFile?.name || '选择、拖拽或粘贴剧本文件'}</strong>
                      <small>{draft.scriptFile ? `${(draft.scriptFile.size / 1024 / 1024).toFixed(2)} MB · 点击更换` : '支持 txt / docx / pdf，单个不超过 10MB'}</small>
                      {draft.scriptFile ? <button type="button" onClick={(event) => { event.stopPropagation(); set('scriptFile', null) }}><AppIcon name="trash" />移除</button> : null}
                    </div>
                  ) : (
                    <div className="create-project-empty-range">
                      <div className="create-project-range-inputs">
                        <label><span>起始集数</span><input className="fos-input" type="number" step={1} min={1} max={100} value={draft.initialEpisodeStart} onChange={(event) => set('initialEpisodeStart', Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></label>
                        <span>至</span>
                        <label><span>结束集数</span><input className="fos-input" type="number" step={1} min={1} max={100} value={draft.initialEpisodeEnd} onChange={(event) => set('initialEpisodeEnd', Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></label>
                      </div>
                      <p>将创建第 {draft.initialEpisodeStart} 集到第 {draft.initialEpisodeEnd} 集（共 {Math.max(0, draft.initialEpisodeEnd - draft.initialEpisodeStart + 1)} 集），可在剧本面板逐集编辑。</p>
                    </div>
                  )}
                </div>
                <div className="create-project-style-column">
                  <div className="create-project-label">画风参考与自定义（可选）</div>
                  <ProjectStyleReferencePicker
                    items={styleReferenceItems}
                    setItems={setStyleReferenceItems}
                    disabled={submitting || styleAnalyzing}
                    onError={setError}
                  />
                  <div className="create-project-style-analysis-row">
                    <button
                      type="button"
                      className="fos-btn fos-btn-ghost"
                      disabled={styleAnalyzing || !styleReferenceItems.some((item) => item.kind === 'image' && item.validationStatus === 'ready')}
                      onClick={() => void analyzeStyleReferences()}
                    >
                      <AppIcon name={styleAnalyzing ? 'loader' : 'sparkles'} className={styleAnalyzing ? 'animate-spin' : ''} />
                      {styleAnalyzing ? '正在解析参考图…' : draft.referenceArtStylePrompt ? '重新解析参考图' : '解析参考图画风'}
                    </button>
                    <small>JPG / PNG 会交给视觉模型提炼；视频仅作为参考素材保存</small>
                  </div>
                  {draft.referenceArtStylePrompt ? (
                    <label className="create-project-style-prompt-field is-analysis">
                      <span>参考图解析提示词 <small>{draft.referenceArtStylePrompt.length} / 5000</small></span>
                      <textarea
                        className="fos-textarea"
                        maxLength={5000}
                        value={draft.referenceArtStylePrompt}
                        onChange={(event) => set('referenceArtStylePrompt', event.target.value)}
                        aria-label="参考图解析提示词"
                      />
                    </label>
                  ) : null}
                  <label className="create-project-style-prompt-field">
                    <span>自定义画风提示词 <small>{draft.artStylePrompt.length} / 2000</small></span>
                    <textarea
                      className="fos-textarea"
                      maxLength={2000}
                      value={draft.artStylePrompt}
                      onChange={(event) => set('artStylePrompt', event.target.value)}
                      placeholder="填写后将完全覆盖上方作品风格，例如：90 年代港漫粗线条、高对比强阴影、主色冷调蓝灰。"
                    />
                  </label>
                  <div className="create-project-art-hint">
                    <AppIcon name="infoCircle" />
                    {draft.artStylePrompt.trim()
                      ? '已填写自定义画风：生成时完全忽略内置画风选项；参考图解析仅作补充，自定义要求优先。'
                      : '未填写自定义画风时，内置基础画风与参考图解析会合并，并统一注入资产、分镜与视频生成。'}
                  </div>
                </div>
              </section>
            </section>}
          </fieldset>

          {error ? <div className="create-project-error" role="alert"><AppIcon name="alert" />{error}</div> : null}
        </div>

        <footer className="fos-dialog-foot">
          {!submitting && !draft.name.trim() ? <span className="create-project-foot-hint"><AppIcon name="info" />填写作品名称后即可创建</span> : null}
          <button type="button" className="fos-btn fos-btn-ghost" disabled={submitting} onClick={() => void requestClose()}>取消</button>
          {draft.creationMode === 'batch_workflow' && batchStep === 1 ? (
            <>
              <button
                type="button"
                className="fos-btn fos-btn-ghost"
                disabled={submitting || !draft.name.trim()}
                onClick={() => void runCreate(true)}
              >
                跳过，先建空工作流
              </button>
              <button
                type="button"
                className="fos-btn fos-btn-primary fos-btn-lg"
                disabled={submitting || !draft.name.trim()}
                onClick={() => setBatchStep(2)}
              >
                下一步：导入参考视频或剧本
              </button>
            </>
          ) : draft.creationMode === 'batch_workflow' && batchStep === 2 ? (
            <>
              <button
                type="button"
                className="fos-btn fos-btn-ghost"
                disabled={submitting}
                onClick={() => setBatchStep(1)}
              >
                上一步
              </button>
              {hasInitialInput ? (
                <button
                  type="button"
                  className="fos-btn fos-btn-ghost"
                  disabled={submitting || !draft.name.trim()}
                  onClick={() => void runCreate(true)}
                >
                  跳过输入，先建空工作流
                </button>
              ) : null}
              <button
                type="submit"
                className="fos-btn fos-btn-primary fos-btn-lg"
                disabled={submitting || uploadingVideo || !draft.name.trim()}
              >
                {submitting
                  ? <><AppIcon name="loader" className="animate-spin" />{submitStatus}</>
                  : firstInputMode === 'video' && selectedVideoMaterial
                    ? '创建并导入参考视频'
                    : firstInputMode === 'pasted_script' && pastedScriptText.trim()
                      ? '创建并导入剧本'
                      : '创建并进入视频工作流'}
              </button>
            </>
          ) : (
            <button type="submit" className="fos-btn fos-btn-primary fos-btn-lg" disabled={submitting || !draft.name.trim()}>
              {submitting
                ? <><AppIcon name="loader" className="animate-spin" />{submitStatus}</>
                : draft.creationMode === 'canvas'
                  ? '创建并进入画布'
                  : '确认创建并进入工作台'}
            </button>
          )}
        </footer>
      </form>

      {videoPickerOpen ? (
        <MaterialPickerDialog
          type="video"
          multiple={false}
          selectedIds={selectedVideoMaterial ? [selectedVideoMaterial.id] : []}
          title="选择参考视频"
          confirmLabel="确认选用"
          onSelect={(picked) => {
            setSelectedVideoMaterial(picked)
            if (!firstItemTitle.trim() && picked.title) {
              setFirstItemTitle(picked.title)
            }
            setVideoPickerOpen(false)
          }}
          onConfirm={(picked) => {
            const first = picked[0] || null
            if (first) {
              setSelectedVideoMaterial(first)
              if (!firstItemTitle.trim() && first.title) {
                setFirstItemTitle(first.title)
              }
            }
            setVideoPickerOpen(false)
          }}
          onClose={() => setVideoPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}
