'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { ProjectStyleReferenceDraftFile } from '@/lib/projects/style-reference-contract'
import type { ProjectStyleReferenceProgressUpdate } from '@/lib/projects/create-project-request'
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
import { fetchAllMemberCandidates } from './works/member-candidates'
import type { MemberCandidate } from './works/types'
import type { AccountPermission } from '@/lib/account/permissions'
import {
  focusCreateProjectDialogInitial,
  restoreCreateProjectDialogFocus,
  trapCreateProjectDialogTab,
} from './works/create-project-dialog-focus'

type ScriptSource = 'blank' | 'writer' | 'local' | 'range'

interface WriterScript {
  id: string
  title: string
  status: string
  episodes: Array<{ id: string; title: string; body: string }>
}

export interface CreateProjectDraft {
  name: string
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
  projectLevel: 'Nori1.0',
  collaborationMode: 'solo',
  projectType: 'story',
  projectStyle: 'live-action',
  materialType: 'script',
  targetEpisodeCount: 0,
  targetAudience: 'global-platform',
  videoRatio: '9:16',
  videoResolution: '480p',
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

function scriptExtension(file: File) {
  return file.name.split('.').pop()?.toLocaleLowerCase() || ''
}

function validateScriptFile(file: File): string | null {
  if (!ACCEPTED_SCRIPT_EXTENSIONS.includes(scriptExtension(file))) return '仅支持 txt、docx 或文本型 pdf 文件'
  if (file.size > MAX_SCRIPT_BYTES) return '素材文件不能超过 10MB'
  return null
}

export function CreateProjectDialog({
  workName,
  onClose,
  onCreate,
}: {
  workName?: string
  onClose: () => void
  onCreate: (
    draft: CreateProjectDraft,
    setStatus: (status: string) => void,
    onStyleReferenceProgress: (update: ProjectStyleReferenceProgressUpdate) => void,
  ) => Promise<boolean> | boolean
}) {
  const [draft, setDraft] = useState<CreateProjectFormDraft>(DEFAULT_DRAFT)
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

  useEffect(() => {
    let active = true
    setScriptsLoading(true)
    void apiFetch('/api/video-repaint/scripts')
      .then(async (response) => response.ok ? response.json() : { scripts: [] })
      .then((payload: { scripts?: WriterScript[] }) => {
        if (!active) return
        const available = Array.isArray(payload.scripts)
          ? payload.scripts.filter((script) => script.status === 'available')
          : []
        setScripts(available)
      })
      .catch(() => {
        if (active) {
          setScripts([])
        }
      })
      .finally(() => { if (active) setScriptsLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (draft.collaborationMode !== 'team') return
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
  }, [draft.collaborationMode])

  useEffect(() => {
    if (!analyzedReferenceSignatureRef.current) return
    if (analyzedReferenceSignatureRef.current === styleReferenceImageSignature) return
    analyzedReferenceSignatureRef.current = ''
    setDraft((previous) => previous.referenceArtStylePrompt
      ? { ...previous, referenceArtStylePrompt: '' }
      : previous)
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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (!draft.name.trim()) { setError('项目名称必填'); return }
    if (draft.materialType === 'script' && source === 'writer' && !draft.importedScriptText.trim()) { setError('请选择一个状态为“可用”的剧本'); return }
    if (source === 'local' && !draft.scriptFile) { setError(`请上传 txt、docx 或 pdf ${draft.materialType === 'script' ? '剧本' : '小说/大纲'}文件`); return }
    if (variant.showStyleReferences && styleReferenceItems.some((item) => item.validationStatus === 'validating')) { setError('画风参考视频仍在读取，请稍候。'); return }
    if (variant.showStyleReferences && styleReferenceItems.some((item) => item.validationStatus === 'failed')) { setError('请移除无法读取或超过 1 分钟的画风参考视频。'); return }
    if (styleAnalyzing) { setError('参考图画风仍在解析，请稍候。'); return }
    if (draft.collaborationMode === 'team' && !(
      draft.writerAssigneeUserId
      || draft.assetAssigneeUserId
      || draft.storyboardAssigneeUserId
    )) {
      setError('任务分工模式至少需要选择一名编剧、资产师或分镜师。')
      return
    }
    const durationValue = draft.episodeDurationValue
    if (durationValue === '') {
      setError('请输入单集时长')
      return
    }
    if (!Number.isInteger(durationValue) || durationValue < bounds.minimum || durationValue > bounds.maximum) {
      setError(`时长必须是 ${bounds.minimum}–${bounds.maximum} 的整数`)
      return
    }
    if (source === 'range' && (
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
    setSubmitStatus('创建项目…')
    setError(null)
    setStyleReferenceItems((current) => current.map((item) => ({
      ...item,
      uploadStatus: 'idle',
      progress: 0,
      error: null,
    })))
    try {
      const styleReferenceFiles = variant.showStyleReferences
        ? toProjectStyleReferenceDraftFiles(styleReferenceItems)
        : []
      const normalizedDraft: CreateProjectDraft = { ...draft, episodeDurationValue: durationValue }
      const nextDraft = source === 'blank'
        ? { ...normalizedDraft, scriptFile: null, importedScriptText: '', importedScriptTitle: '', initializeEpisodeRange: false, styleReferenceFiles }
        : variant.allowEpisodeRange && source === 'range'
          ? { ...normalizedDraft, scriptFile: null, importedScriptText: '', importedScriptTitle: '', initializeEpisodeRange: true, styleReferenceFiles }
          : { ...normalizedDraft, initializeEpisodeRange: false, styleReferenceFiles }
      const onStyleReferenceProgress = (update: ProjectStyleReferenceProgressUpdate) => {
        setStyleReferenceItems((current) => current.map((item) => item.id === update.id
          ? { ...item, uploadStatus: update.status, progress: update.progress, error: update.error ?? null }
          : item))
      }
      const ok = await onCreate(nextDraft, setSubmitStatus, onStyleReferenceProgress)
      if (ok) onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建项目失败')
      setStyleReferenceItems((current) => current.map((item) => item.uploadStatus === 'failed'
        ? item
        : { ...item, uploadStatus: 'idle', progress: 0 }))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const filteredScripts = scripts.filter((script) => script.title.toLocaleLowerCase().includes(scriptSearch.trim().toLocaleLowerCase()))
  const stopWhileSubmitting = (event: React.SyntheticEvent) => {
    if (!submittingRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="fos-overlay create-project-overlay" onMouseDown={(event) => { if (!submittingRef.current && event.target === event.currentTarget) onClose() }}>
      <form
        ref={dialogRef}
        className="fos-dialog create-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="创建项目"
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
          if (!submittingRef.current) onClose()
        }}
      >
        <header className="fos-dialog-head">
          <div><div className="fos-dialog-title">创建项目</div>{workName ? <div className="create-project-work-name">所属作品 · {workName}</div> : null}</div>
          <button type="button" className="fos-dialog-x" disabled={submitting} onClick={onClose} aria-label="关闭创建项目"><AppIcon name="close" className="h-4 w-4" /></button>
        </header>
        <div className="fos-dialog-body create-project-body" onClick={stopWhileSubmitting}>
          <fieldset className="create-project-payload-fields" disabled={submitting}>
          <label className="create-project-field">
            <span className="create-project-label">项目名称 <small>{draft.name.length} / 40</small></span>
            <input ref={initialFocusRef} className="fos-input" placeholder="请输入项目名称" required maxLength={40} value={draft.name} onChange={(event) => { set('name', event.target.value); setError(null) }} />
          </label>

          <section className="create-project-section">
            <div className="create-project-label">项目版本</div>
            <div className="create-project-level-grid is-single">
              <div className="create-project-level is-selected" data-testid="nori-project-level">
                <span className="create-project-radio is-on" />
                <strong>Nori1.0</strong>
                <span className="create-project-level-kicker">统一的短剧工业化生产工作流</span>
                <ul>
                  <li>剧本、资产、分镜与视频使用同一项目配置</li>
                  <li>支持自由协作或按角色分工、提交与审核</li>
                  <li>统一画风持续注入资产图、分镜图和视频生成</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="create-project-section" data-testid="nori-collaboration-mode">
            <div className="create-project-label">项目协作方式</div>
            <div className="create-project-mode-grid">
              <button type="button" className={draft.collaborationMode === 'solo' ? 'is-selected' : ''} onClick={() => set('collaborationMode', 'solo')}>
                <span><AppIcon name="link" />自由协作</span><small>所有协作者均可按账号权限操作，不分配任务（默认）</small>
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
                <small>按账号实际功能区筛选；同一账号可承担多个功能区</small>
              </div>
              <div className="create-project-assignment-grid">
                {ASSIGNMENT_ROLE_OPTIONS.map((option) => {
                  const candidates = memberCandidates.filter((candidate) => candidate.permissions?.includes(option.permission))
                  return (
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
                        {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.roleLabel ? ` · ${candidate.roleLabel}` : ''}</option>)}
                      </select>
                    </label>
                  )
                })}
              </div>
              {membersLoading ? <div className="create-project-assignment-state"><AppIcon name="loader" className="animate-spin" />正在读取管理账号下的子账号…</div> : null}
              {!membersLoading && membersError ? <div className="create-project-assignment-state is-error">{membersError}</div> : null}
              {!membersLoading && !membersError && memberCandidates.every((candidate) => !candidate.permissions?.some((permission) => ['scriptWrite', 'assetWrite', 'storyboardWrite'].includes(permission))) ? (
                <div className="create-project-assignment-state">暂无可分配子账号，请先在账号管理中为子账号开启剧本、资产或分镜功能区。</div>
              ) : null}
            </section>
          ) : null}

          <section className="create-project-config-grid">
            <ProjectPillGroup
              label="项目风格"
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
                ? '当前项目生成时不会使用上方所选画风。'
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
                <button type="button" role="tab" aria-selected={source === 'blank'} className={source === 'blank' ? 'is-active' : ''} onClick={() => setSource('blank')}>空白项目</button>
                <button type="button" role="tab" aria-selected={source === 'writer'} className={source === 'writer' ? 'is-active' : ''} onClick={() => setSource('writer')}>导入剧本</button>
                <button type="button" role="tab" aria-selected={source === 'local'} className={source === 'local' ? 'is-active' : ''} onClick={() => setSource('local')}>本地上传</button>
                {variant.allowEpisodeRange ? <button type="button" role="tab" aria-selected={source === 'range'} className={source === 'range' ? 'is-active' : ''} onClick={() => setSource('range')}>指定集数范围</button> : null}
              </div>
              {source === 'blank' ? (
                <div className="create-project-empty-range">
                  <p>仅创建空白项目，不导入剧本、不预建剧集。进入工作台后可自行创建剧集并编写内容。</p>
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
                  placeholder="填写后将完全覆盖上方项目风格，例如：90 年代港漫粗线条、高对比强阴影、主色冷调蓝灰。"
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
          </fieldset>

          {error ? <div className="create-project-error" role="alert"><AppIcon name="alert" />{error}</div> : null}
        </div>
        <footer className="fos-dialog-foot">
          <button type="button" className="fos-btn fos-btn-ghost" disabled={submitting} onClick={onClose}>取消</button>
          <button type="submit" className="fos-btn fos-btn-primary fos-btn-lg" disabled={submitting || !draft.name.trim()}>{submitting ? <><AppIcon name="loader" className="animate-spin" />{submitStatus}</> : '确认创建并进入工作台'}</button>
        </footer>
      </form>
    </div>
  )
}
