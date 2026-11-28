'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { confirmAction } from '@/lib/ui/feedback'
import {
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_META,
  WORKFLOW_TRACKS,
  WORKFLOW_TRACK_LABELS,
  WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
  type WorkflowGateMode,
  type WorkflowSkillDTO,
  type WorkflowSkillFewShotExample,
  type WorkflowSkillQcRules,
  type WorkflowStage,
  type WorkflowTemplateDTO,
  type WorkflowTemplateStageConfig,
} from '@/lib/batch-workflow/types'

export interface SkillLibraryModalProps {
  open: boolean
  initialStage?: WorkflowStage
  skills: WorkflowSkillDTO[]
  templates: WorkflowTemplateDTO[]
  onClose: () => void
  onChanged: () => Promise<void> | void
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void
}

type LibraryTab = 'skills' | 'templates'

function parseListInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,，、;；]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildDefaultTemplateStages(skills: WorkflowSkillDTO[], track: string): WorkflowTemplateStageConfig[] {
  return WORKFLOW_STAGES.map((stage) => {
    const stageSkills = skills.filter((s) => s.stage === stage)
    const matched = stageSkills.find((s) => s.track === track && s.isDefault)
      || stageSkills.find((s) => s.track === track)
      || stageSkills.find((s) => s.isDefault)
      || stageSkills[0]
    return {
      stage,
      label: WORKFLOW_STAGE_META[stage].shortLabel,
      skillSlug: matched?.slug || '',
      skillId: matched?.id ?? null,
      gateMode: WORKFLOW_STAGE_META[stage].defaultGateMode,
      enabled: true,
      modelKey: null,
      options: null,
    }
  })
}

export function SkillLibraryModal({
  open,
  initialStage,
  skills,
  templates,
  onClose,
  onChanged,
  onNotify,
}: SkillLibraryModalProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>('skills')

  // -------- Tab 1: Skill Library state --------
  const [stageFilter, setStageFilter] = useState<WorkflowStage | 'all'>(initialStage || 'all')
  const [skillSearch, setSkillSearch] = useState('')
  const [selectedSkillId, setSelectedSkillId] = useState<string>('')
  const [creatingSkill, setCreatingSkill] = useState(false)

  // Skill editor fields
  const [skName, setSkName] = useState('')
  const [skTrack, setSkTrack] = useState<string>(WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE)
  const [skStage, setSkStage] = useState<WorkflowStage>('script_rewrite')
  const [skDescription, setSkDescription] = useState('')
  const [skIsDefault, setSkIsDefault] = useState(false)
  const [skSystemPrompt, setSkSystemPrompt] = useState('')
  const [skFewShots, setSkFewShots] = useState<WorkflowSkillFewShotExample[]>([])
  const [skQcMinShots, setSkQcMinShots] = useState('')
  const [skQcMaxShots, setSkQcMaxShots] = useState('')
  const [skQcMaxChars, setSkQcMaxChars] = useState('')
  const [skQcMaxShotDur, setSkQcMaxShotDur] = useState('')
  const [skQcRequired, setSkQcRequired] = useState('')
  const [skQcForbidden, setSkQcForbidden] = useState('')
  const [skQcChecklist, setSkQcChecklist] = useState('')
  const [skChangeNote, setSkChangeNote] = useState('')

  // Version history for selected skill
  const [showVersions, setShowVersions] = useState(false)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [skillVersions, setSkillVersions] = useState<WorkflowSkillDTO[]>([])

  // -------- Tab 2: Track Templates state --------
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [tplName, setTplName] = useState('')
  const [tplTrack, setTplTrack] = useState<string>(WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE)
  const [tplDescription, setTplDescription] = useState('')
  const [tplIsDefault, setTplIsDefault] = useState(false)
  const [tplStages, setTplStages] = useState<WorkflowTemplateStageConfig[]>([])

  const [busyAction, setBusyAction] = useState<string | null>(null)
  // Inline error surface keeps dirty state visible when save rejects.
  const [skillSaveError, setSkillSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (initialStage) setStageFilter(initialStage)
  }, [open, initialStage])

  // Deduplicated / filtered skills
  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase()
    return skills.filter((sk) => {
      if (stageFilter !== 'all' && sk.stage !== stageFilter) return false
      if (!q) return true
      return (
        sk.name.toLowerCase().includes(q)
        || (sk.description || '').toLowerCase().includes(q)
        || (WORKFLOW_TRACK_LABELS[sk.track] || '').toLowerCase().includes(q)
      )
    })
  }, [skills, stageFilter, skillSearch])

  const selectedSkill = useMemo(() => {
    if (creatingSkill) return null
    return skills.find((s) => s.id === selectedSkillId) || filteredSkills[0] || skills[0] || null
  }, [creatingSkill, skills, selectedSkillId, filteredSkills])

  const selectedTemplate = useMemo(() => {
    if (creatingTemplate) return null
    return templates.find((t) => t.id === selectedTemplateId) || templates[0] || null
  }, [creatingTemplate, templates, selectedTemplateId])

  // Track whether the editor diverges from the selected snapshot so we can
  // confirm before switching selection / closing.
  const isSkillDirty = useMemo(() => {
    if (creatingSkill) {
      return Boolean(skName.trim() && skSystemPrompt.trim())
    }
    if (!selectedSkill) return false
    if (skName !== selectedSkill.name) return true
    if ((skDescription || '') !== (selectedSkill.description || '')) return true
    if (skIsDefault !== selectedSkill.isDefault) return true
    if (skSystemPrompt !== (selectedSkill.systemPrompt || '')) return true
    const currentFew = JSON.stringify(skFewShots)
    const baseFew = JSON.stringify(Array.isArray(selectedSkill.fewShotExamples) ? selectedSkill.fewShotExamples : [])
    if (currentFew !== baseFew) return true
    const qcFieldsNow = [
      skQcMinShots, skQcMaxShots, skQcMaxChars, skQcMaxShotDur,
      skQcRequired, skQcForbidden, skQcChecklist,
    ]
    const qcFieldsBase = [
      selectedSkill.qcRules?.minShots != null ? String(selectedSkill.qcRules.minShots) : '',
      selectedSkill.qcRules?.maxShots != null ? String(selectedSkill.qcRules.maxShots) : '',
      selectedSkill.qcRules?.maxChars != null ? String(selectedSkill.qcRules.maxChars) : '',
      selectedSkill.qcRules?.maxShotDurationSec != null ? String(selectedSkill.qcRules.maxShotDurationSec) : '',
      (selectedSkill.qcRules?.requiredKeywords || []).join(', '),
      (selectedSkill.qcRules?.forbiddenKeywords || []).join(', '),
      (selectedSkill.qcRules?.checklist || []).join('\n'),
    ]
    if (qcFieldsNow.some((v, i) => v !== qcFieldsBase[i])) return true
    return false
  }, [
    creatingSkill, selectedSkill, skName, skDescription, skIsDefault, skSystemPrompt, skFewShots,
    skQcMinShots, skQcMaxShots, skQcMaxChars, skQcMaxShotDur, skQcRequired, skQcForbidden, skQcChecklist,
  ])

  const confirmDiscardIfDirty = useCallback(async (): Promise<boolean> => {
    if (activeTab !== 'skills' || !isSkillDirty) return true
    const ok = await confirmAction({
      title: '放弃未发布的修改？',
      message: '当前 Skill 编辑器有未发布的修改，切换或关闭后将丢失。确认继续？',
      confirmLabel: '放弃修改',
      cancelLabel: '继续编辑',
      danger: true,
    })
    return ok
  }, [activeTab, isSkillDirty])

  const requestClose = useCallback(async () => {
    if (busyAction) return
    const ok = await confirmDiscardIfDirty()
    if (ok) onClose()
  }, [busyAction, confirmDiscardIfDirty, onClose])

  // Escape key closes modal
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      void requestClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, requestClose])

  // Populate Skill Editor when selection changes
  useEffect(() => {
    if (!open || creatingSkill) return
    if (!selectedSkill) return
    setSkName(selectedSkill.name)
    setSkTrack(selectedSkill.track || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE)
    setSkStage(selectedSkill.stage)
    setSkDescription(selectedSkill.description || '')
    setSkIsDefault(selectedSkill.isDefault)
    setSkSystemPrompt(selectedSkill.systemPrompt || '')
    setSkFewShots(Array.isArray(selectedSkill.fewShotExamples) ? selectedSkill.fewShotExamples : [])
    setSkQcMinShots(selectedSkill.qcRules?.minShots != null ? String(selectedSkill.qcRules.minShots) : '')
    setSkQcMaxShots(selectedSkill.qcRules?.maxShots != null ? String(selectedSkill.qcRules.maxShots) : '')
    setSkQcMaxChars(selectedSkill.qcRules?.maxChars != null ? String(selectedSkill.qcRules.maxChars) : '')
    setSkQcMaxShotDur(selectedSkill.qcRules?.maxShotDurationSec != null ? String(selectedSkill.qcRules.maxShotDurationSec) : '')
    setSkQcRequired((selectedSkill.qcRules?.requiredKeywords || []).join(', '))
    setSkQcForbidden((selectedSkill.qcRules?.forbiddenKeywords || []).join(', '))
    setSkQcChecklist((selectedSkill.qcRules?.checklist || []).join('\n'))
    setSkChangeNote('')
    setShowVersions(false)
    setSkillVersions([])
  }, [open, creatingSkill, selectedSkill])

  // Load version history on demand
  useEffect(() => {
    if (!open || !showVersions || !selectedSkill) return
    let active = true
    setVersionsLoading(true)
    void apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(selectedSkill.id)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readApiErrorMessage(res, '读取版本历史失败'))
        return await res.json() as { versions?: WorkflowSkillDTO[]; skill?: WorkflowSkillDTO }
      })
      .then((payload) => {
        if (!active) return
        const list = Array.isArray(payload.versions) && payload.versions.length > 0
          ? payload.versions
          : payload.skill
            ? [payload.skill]
            : [selectedSkill]
        setSkillVersions(list)
      })
      .catch((err) => {
        if (!active) return
        onNotify(err instanceof Error ? err.message : '读取版本历史失败', 'error')
      })
      .finally(() => {
        if (active) setVersionsLoading(false)
      })
    return () => { active = false }
  }, [open, showVersions, selectedSkill, onNotify])

  // Populate Template Editor when selection changes
  useEffect(() => {
    if (!open || creatingTemplate) return
    if (!selectedTemplate) return
    setTplName(selectedTemplate.name)
    setTplTrack(selectedTemplate.track || WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE)
    setTplDescription(selectedTemplate.description || '')
    setTplIsDefault(selectedTemplate.isDefault)
    const normalizedStages: WorkflowTemplateStageConfig[] = WORKFLOW_STAGES.map((stage) => {
      const existing = selectedTemplate.stages.find((s) => s.stage === stage)
      if (existing) return { ...existing }
      const fallbackSkill = skills.find((s) => s.stage === stage && s.isDefault) || skills.find((s) => s.stage === stage)
      return {
        stage,
        label: WORKFLOW_STAGE_META[stage].shortLabel,
        skillSlug: fallbackSkill?.slug || '',
        skillId: fallbackSkill?.id ?? null,
        gateMode: WORKFLOW_STAGE_META[stage].defaultGateMode,
        enabled: true,
        modelKey: null,
        options: null,
      }
    })
    setTplStages(normalizedStages)
  }, [open, creatingTemplate, selectedTemplate, skills])

  const skillsByStage = useMemo(() => {
    const map: Record<WorkflowStage, WorkflowSkillDTO[]> = {
      script_analysis: [],
      script_rewrite: [],
      asset_extraction: [],
      storyboard: [],
      video_gen: [],
    }
    for (const sk of skills) {
      if (map[sk.stage]) map[sk.stage].push(sk)
    }
    return map
  }, [skills])

  const buildSkillQcRules = (): WorkflowSkillQcRules | null => {
    const rules: WorkflowSkillQcRules = {}
    const minShots = Number(skQcMinShots)
    const maxShots = Number(skQcMaxShots)
    const maxChars = Number(skQcMaxChars)
    const maxShotDur = Number(skQcMaxShotDur)
    if (skQcMinShots.trim() && Number.isFinite(minShots)) rules.minShots = minShots
    if (skQcMaxShots.trim() && Number.isFinite(maxShots)) rules.maxShots = maxShots
    if (skQcMaxChars.trim() && Number.isFinite(maxChars)) rules.maxChars = maxChars
    if (skQcMaxShotDur.trim() && Number.isFinite(maxShotDur)) rules.maxShotDurationSec = maxShotDur
    const req = parseListInput(skQcRequired)
    const forb = parseListInput(skQcForbidden)
    const chk = skQcChecklist.split('\n').map((s) => s.trim()).filter(Boolean)
    if (req.length > 0) rules.requiredKeywords = req
    if (forb.length > 0) rules.forbiddenKeywords = forb
    if (chk.length > 0) rules.checklist = chk
    return Object.keys(rules).length > 0 ? rules : null
  }

  // -------- Skill Mutations --------
  const startCreateNewSkill = () => {
    const defaultStage: WorkflowStage = stageFilter === 'all' ? 'script_rewrite' : stageFilter
    setCreatingSkill(true)
    setSelectedSkillId('')
    setSkName(`自定义 ${WORKFLOW_STAGE_META[defaultStage].label} 配方`)
    setSkTrack(WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE)
    setSkStage(defaultStage)
    setSkDescription('')
    setSkIsDefault(false)
    setSkSystemPrompt(`你是资深视频导演与${WORKFLOW_STAGE_META[defaultStage].label}专家。请严格遵循本环节输出规范，确保节奏紧凑、画面具象。`)
    setSkFewShots([])
    setSkQcMinShots('')
    setSkQcMaxShots('')
    setSkQcMaxChars('')
    setSkQcMaxShotDur('')
    setSkQcRequired('')
    setSkQcForbidden('')
    setSkQcChecklist('')
    setSkChangeNote('初始创建')
    setShowVersions(false)
  }

  const handleSaveSkill = async () => {
    if (busyAction) return
    if (!skName.trim()) {
      onNotify('请填写 Skill 名称。', 'error')
      return
    }
    if (!skSystemPrompt.trim()) {
      onNotify('System Prompt 不能为空。', 'error')
      return
    }
    const isCreating = creatingSkill || !selectedSkill
    setSkillSaveError(null)
    setBusyAction(isCreating ? 'create-skill' : 'publish-skill')
    try {
      const cleanedFewShots = skFewShots
        .map((ex) => ({ title: ex.title.trim(), input: ex.input.trim(), output: ex.output.trim() }))
        .filter((ex) => ex.title || ex.input || ex.output)
      const qcRules = buildSkillQcRules()

      if (isCreating) {
        const res = await apiFetch('/api/batch-workflow/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: skName.trim(),
            track: skTrack,
            stage: skStage,
            description: skDescription.trim() || null,
            systemPrompt: skSystemPrompt.trim(),
            fewShotExamples: cleanedFewShots,
            qcRules,
            isDefault: skIsDefault,
            changeNote: skChangeNote.trim() || '新建自定义 Skill',
          }),
        })
        if (!res.ok) throw new Error(await readApiErrorMessage(res, '创建 Skill 失败'))
        const payload = await res.json() as { skill?: WorkflowSkillDTO }
        setCreatingSkill(false)
        if (payload.skill?.id) setSelectedSkillId(payload.skill.id)
        await onChanged()
        onNotify(`已创建 Skill「${skName.trim()}」`, 'success')
      } else if (selectedSkill) {
        // 统一不可变发布流：永远 saveAsNewVersion: true（内置派生为团队配方，已有版本升级）
        const res = await apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(selectedSkill.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            saveAsNewVersion: true,
            name: skName.trim(),
            description: skDescription.trim() || null,
            systemPrompt: skSystemPrompt.trim(),
            fewShotExamples: cleanedFewShots,
            qcRules,
            isDefault: skIsDefault,
            changeNote: skChangeNote.trim() || `发布 v${selectedSkill.version + 1}`,
          }),
        })
        if (!res.ok) throw new Error(await readApiErrorMessage(res, '发布新版本失败'))
        const payload = await res.json() as { skill?: WorkflowSkillDTO }
        if (payload.skill?.id) setSelectedSkillId(payload.skill.id)
        await onChanged()
        onNotify(
          selectedSkill.isBuiltin
            ? `已基于官方 v${selectedSkill.version} 派生团队配方「${payload.skill?.name || skName.trim()}」v${payload.skill?.version ?? selectedSkill.version + 1}`
            : `已发布「${payload.skill?.name || skName.trim()}」v${payload.skill?.version ?? selectedSkill.version + 1}`,
          'success',
        )
      }
    } catch (err) {
      // 失败：保留 dirty 状态并显示错误（contract 5）
      const message = err instanceof Error ? err.message : '保存 Skill 失败'
      setSkillSaveError(message)
      onNotify(message, 'error')
    } finally {
      setBusyAction(null)
    }
  }

  // 元信息单独保存：不带 saveAsNewVersion，且不发送内容字段（systemPrompt/fewShotExamples/qcRules/modelPreferences）
  const handleSaveMetaOnly = async () => {
    if (busyAction || !selectedSkill || creatingSkill) return
    if (!skName.trim()) {
      onNotify('请填写 Skill 名称。', 'error')
      return
    }
    setSkillSaveError(null)
    setBusyAction('save-meta')
    try {
      const res = await apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(selectedSkill.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skName.trim(),
          description: skDescription.trim() || null,
          isDefault: skIsDefault,
          changeNote: skChangeNote.trim() || '更新元信息',
        }),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '保存元信息失败'))
      await onChanged()
      onNotify(`已更新「${skName.trim()}」的名称/描述/默认标记（内容未变更）`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存元信息失败'
      setSkillSaveError(message)
      onNotify(message, 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleCloneSkill = async (source: WorkflowSkillDTO) => {
    if (busyAction) return
    setBusyAction('clone-skill')
    try {
      const res = await apiFetch('/api/batch-workflow/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${source.name} · 副本`,
          track: source.track,
          stage: source.stage,
          description: source.description,
          systemPrompt: source.systemPrompt,
          fewShotExamples: source.fewShotExamples,
          modelPreferences: source.modelPreferences,
          qcRules: source.qcRules,
          cloneFromSkillId: source.id,
          parentSkillId: source.id,
          changeNote: `克隆自 ${source.name} v${source.version}`,
        }),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '克隆 Skill 失败'))
      const payload = await res.json() as { skill?: WorkflowSkillDTO }
      setCreatingSkill(false)
      if (payload.skill?.id) setSelectedSkillId(payload.skill.id)
      await onChanged()
      onNotify(`已克隆为自定义配方「${payload.skill?.name || `${source.name} · 副本`}」`, 'success')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '克隆 Skill 失败', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleDeleteSkill = async (target: WorkflowSkillDTO) => {
    if (target.isBuiltin || busyAction) return
    const confirmed = await confirmAction({
      title: `删除 Skill「${target.name}」？`,
      message: '删除后不可恢复；已在运行中的工作流快照仍会保留历史配置。',
      confirmLabel: '确认删除',
      cancelLabel: '取消',
      danger: true,
    })
    if (!confirmed) return
    setBusyAction('delete-skill')
    try {
      const res = await apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '删除 Skill 失败'))
      setSelectedSkillId('')
      await onChanged()
      onNotify(`已删除 Skill「${target.name}」`, 'success')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '删除 Skill 失败', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  // -------- Template Mutations --------
  const startCreateNewTemplate = () => {
    setCreatingTemplate(true)
    setSelectedTemplateId('')
    setTplName('自定义 5 步组合模板')
    setTplTrack(WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE)
    setTplDescription('按环节自由搭配已调优的 Skill 配方。')
    setTplIsDefault(false)
    setTplStages(buildDefaultTemplateStages(skills, WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE))
  }

  const updateTemplateStage = (stage: WorkflowStage, patch: Partial<WorkflowTemplateStageConfig>) => {
    setTplStages((prev) => prev.map((item) => (item.stage === stage ? { ...item, ...patch } : item)))
  }

  const handleSaveTemplate = async () => {
    if (busyAction) return
    if (!tplName.trim()) {
      onNotify('请填写赛道组合模板名称。', 'error')
      return
    }
    setBusyAction('save-template')
    try {
      if (creatingTemplate || !selectedTemplate) {
        const res = await apiFetch('/api/batch-workflow/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: tplName.trim(),
            track: tplTrack,
            description: tplDescription.trim() || null,
            stages: tplStages,
            isDefault: tplIsDefault,
          }),
        })
        if (!res.ok) throw new Error(await readApiErrorMessage(res, '创建赛道模板失败'))
        const payload = await res.json() as { template?: WorkflowTemplateDTO }
        setCreatingTemplate(false)
        if (payload.template?.id) setSelectedTemplateId(payload.template.id)
        await onChanged()
        onNotify(`已创建赛道组合模板「${tplName.trim()}」`, 'success')
      } else {
        const res = await apiFetch(`/api/batch-workflow/templates/${encodeURIComponent(selectedTemplate.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: tplName.trim(),
            description: tplDescription.trim() || null,
            stages: tplStages,
            isDefault: tplIsDefault,
          }),
        })
        if (!res.ok) throw new Error(await readApiErrorMessage(res, '保存赛道模板失败'))
        await onChanged()
        onNotify(`已更新赛道组合模板「${tplName.trim()}」`, 'success')
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '保存赛道模板失败', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleCloneTemplate = async (source: WorkflowTemplateDTO) => {
    if (busyAction) return
    setBusyAction('clone-template')
    try {
      const res = await apiFetch('/api/batch-workflow/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${source.name} · 自定义版`,
          track: source.track,
          description: source.description,
          stages: source.stages,
          cloneFromTemplateId: source.id,
        }),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '克隆模板失败'))
      const payload = await res.json() as { template?: WorkflowTemplateDTO }
      setCreatingTemplate(false)
      if (payload.template?.id) setSelectedTemplateId(payload.template.id)
      await onChanged()
      onNotify(`已克隆赛道组合模板「${payload.template?.name || source.name}」`, 'success')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '克隆模板失败', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleDeleteTemplate = async (target: WorkflowTemplateDTO) => {
    if (target.isBuiltin || busyAction) return
    const confirmed = await confirmAction({
      title: `删除赛道组合模板「${target.name}」？`,
      message: '删除后不可恢复，新建作品时将不再显示此模板。',
      confirmLabel: '确认删除',
      cancelLabel: '取消',
      danger: true,
    })
    if (!confirmed) return
    setBusyAction('delete-template')
    try {
      const res = await apiFetch(`/api/batch-workflow/templates/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '删除模板失败'))
      setSelectedTemplateId('')
      await onChanged()
      onNotify(`已删除模板「${target.name}」`, 'success')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '删除模板失败', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  if (!open) return null

  const skillReadonly = !creatingSkill && Boolean(selectedSkill?.isBuiltin)
  const skillSummaryOnly = !creatingSkill && Boolean(selectedSkill) && typeof selectedSkill?.systemPrompt !== 'string'
  const templateReadonly = !creatingTemplate && Boolean(selectedTemplate?.isBuiltin)

  return (
    <ViewportDialogLayer>
      <div
        className="wf-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) void requestClose()
        }}
      >
        <div
          className="wf-modal is-lg"
          role="dialog"
          aria-modal="true"
          aria-label="Skill 配方库与赛道组合模板"
        >
          {/* Header */}
          <div className="wf-modal-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="wf-modal-title">
                <AppIcon name="sparkles" className="h-4 w-4" style={{ color: 'var(--fos-primary-text)' }} />
                <span>管理员配方中心</span>
              </div>
              <div className="wf-mode-pill" role="tablist" aria-label="配方中心视图切换">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'skills'}
                  className={`wf-mode-pill-btn${activeTab === 'skills' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('skills')}
                >
                  <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
                  <span>Skill 配方库</span>
                  <span className="wf-num" style={{ opacity: 0.78 }}>{skills.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'templates'}
                  className={`wf-mode-pill-btn${activeTab === 'templates' ? ' is-active' : ''}`}
                  onClick={() => {
                    void (async () => {
                      const ok = await confirmDiscardIfDirty()
                      if (!ok) return
                      setActiveTab('templates')
                    })()
                  }}
                >
                  <AppIcon name="clapperboard" className="h-3.5 w-3.5" />
                  <span>赛道组合模板</span>
                  <span className="wf-num" style={{ opacity: 0.78 }}>{templates.length}</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              className="wf-btn wf-btn-icon wf-btn-sm wf-btn-ghost"
              disabled={Boolean(busyAction)}
              onClick={() => void requestClose()}
              aria-label="关闭配方中心"
            >
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>

          {/* Tab 1: Skill Library */}
          {activeTab === 'skills' ? (
            <div className="wf-modal-split">
              <div className="wf-modal-sidebar">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="wf-input wf-input-sm"
                    type="search"
                    value={skillSearch}
                    onChange={(event) => setSkillSearch(event.target.value)}
                    placeholder="搜索 Skill 名称或描述…"
                    aria-label="搜索 Skill"
                  />
                  <button
                    type="button"
                    className="wf-btn wf-btn-sm wf-btn-primary"
                    disabled={Boolean(busyAction)}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirmDiscardIfDirty()
                        if (!ok) return
                        startCreateNewSkill()
                      })()
                    }}
                    title="新建自定义 Skill"
                  >
                    <AppIcon name="plus" className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 5-Stage Filter Chips */}
                <div className="wf-feedback-chips">
                  <button
                    type="button"
                    className={`wf-feedback-chip${stageFilter === 'all' ? ' is-active' : ''}`}
                    onClick={() => setStageFilter('all')}
                  >
                    全部
                  </button>
                  {WORKFLOW_STAGES.map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      data-stage={stage}
                      className={`wf-feedback-chip${stageFilter === stage ? ' is-active' : ''}`}
                      onClick={() => setStageFilter(stage)}
                    >
                      {WORKFLOW_STAGE_META[stage].shortLabel}
                    </button>
                  ))}
                </div>

                {/* Skill List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                  {filteredSkills.length === 0 ? (
                    <div className="wf-dock-readonly">当前筛选下暂无 Skill。</div>
                  ) : (
                    filteredSkills.map((sk) => {
                      const active = !creatingSkill && selectedSkill?.id === sk.id
                      return (
                        <button
                          key={sk.id}
                          type="button"
                          data-stage={sk.stage}
                          className={`wf-popover-item${active ? ' is-active' : ''}`}
                          style={{
                            borderColor: active ? 'var(--fos-primary-border)' : 'var(--fos-border-soft)',
                            background: active ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)',
                          }}
                          onClick={() => {
                            if (selectedSkill?.id === sk.id) return
                            void (async () => {
                              const ok = await confirmDiscardIfDirty()
                              if (!ok) return
                              setCreatingSkill(false)
                              setSelectedSkillId(sk.id)
                            })()
                          }}
                        >
                          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              <span className="wf-badge is-stage">{WORKFLOW_STAGE_META[sk.stage].code}</span>
                              <span className="wf-popover-item-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sk.name}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                              <span className="wf-badge is-muted wf-num">v{sk.version}</span>
                              <span className={`wf-badge ${sk.isBuiltin ? 'is-info' : 'is-accent'}`}>
                                {sk.isBuiltin ? '官方内置' : '自定义'}
                              </span>
                              {sk.isDefault ? <span className="wf-badge is-success">默认</span> : null}
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="wf-modal-main" data-stage={skStage}>
                {!creatingSkill && !selectedSkill ? (
                  <div className="wf-empty">
                    <div className="wf-empty-icon"><AppIcon name="sparkles" className="h-5 w-5" /></div>
                    <div className="wf-empty-title">选择一个 Skill 开始查看或调优</div>
                    <div className="wf-empty-desc">支持按 5 个环节管理官方内置配方与团队自定义版本。</div>
                  </div>
                ) : (
                  <>
                    {/* Skill Detail Topbar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="wf-badge is-stage">{WORKFLOW_STAGE_META[skStage].label}</span>
                        {creatingSkill ? (
                          <span className="wf-badge is-accent">新建自定义 Skill</span>
                        ) : selectedSkill ? (
                          <>
                            <span className="wf-badge is-accent wf-num">v{selectedSkill.version}</span>
                            <span className={`wf-badge ${selectedSkill.isBuiltin ? 'is-info' : 'is-success'}`}>
                              {selectedSkill.isBuiltin ? '官方内置（只读）' : '团队自定义'}
                            </span>
                          </>
                        ) : null}
                      </div>

                      {!creatingSkill && selectedSkill ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className={`wf-btn wf-btn-xs ${showVersions ? 'wf-btn-stage' : 'wf-btn-subtle'}`}
                            onClick={() => setShowVersions((prev) => !prev)}
                          >
                            <AppIcon name="history" className="h-3.5 w-3.5" />
                            <span>版本历史</span>
                          </button>
                          <button
                            type="button"
                            className="wf-btn wf-btn-xs wf-btn-subtle"
                            disabled={Boolean(busyAction)}
                            onClick={() => void handleCloneSkill(selectedSkill)}
                          >
                            <AppIcon name="copy" className="h-3.5 w-3.5" />
                            <span>克隆副本</span>
                          </button>
                          {!selectedSkill.isBuiltin ? (
                            <button
                              type="button"
                              className="wf-btn wf-btn-xs wf-btn-danger"
                              disabled={Boolean(busyAction)}
                              onClick={() => void handleDeleteSkill(selectedSkill)}
                            >
                              <AppIcon name="trash" className="h-3.5 w-3.5" />
                              <span>删除</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {/* Version History Drawer inside Skill Pane */}
                    {showVersions && selectedSkill ? (
                      <div className="wf-card">
                        <div className="wf-card-head" style={{ padding: '9px 14px' }}>
                          <span className="wf-card-title" style={{ fontSize: 12 }}>
                            <AppIcon name="history" className="h-3.5 w-3.5" />
                            <span>历史版本记录</span>
                          </span>
                          <span className="wf-badge is-muted wf-num">{skillVersions.length} 条</span>
                        </div>
                        <div className="wf-card-body" style={{ padding: '10px 14px' }}>
                          {versionsLoading ? (
                            <div className="wf-shimmer wf-skeleton-block" style={{ height: 52 }} />
                          ) : (
                            <div className="wf-version-timeline">
                              {skillVersions.map((ver) => (
                                <div key={ver.id} className={`wf-version-row${ver.id === selectedSkill.id ? ' is-current' : ''}`}>
                                  <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span className="wf-badge is-accent wf-num">v{ver.version}</span>
                                      <strong style={{ fontSize: 12 }}>{ver.name}</strong>
                                      <span className="wf-field-hint wf-num">{formatDateTime(ver.updatedAt || ver.createdAt)}</span>
                                    </div>
                                    <div className="wf-field-hint" style={{ marginTop: 3 }}>
                                      {ver.changeNote || (ver.isBuiltin ? '官方内置基线版本' : '配方保存记录')}
                                    </div>
                                  </div>
                                  {ver.id !== selectedSkill.id ? (
                                    <button
                                      type="button"
                                      className="wf-btn wf-btn-xs wf-btn-subtle"
                                      title="切换当前查看的版本（不会修改历史记录，历史版本保持只读）"
                                      onClick={() => {
                                        void (async () => {
                                          const ok = await confirmDiscardIfDirty()
                                          if (!ok) return
                                          setSelectedSkillId(ver.id)
                                          setShowVersions(false)
                                        })()
                                      }}
                                    >
                                      查看该版本
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {skillReadonly ? (
                      <div className="wf-dock-readonly">
                        当前为官方内置配方（只读保护）。如需定制提示词或质检规则，可点击「克隆副本」派生为团队自定义 Skill；「发布为新版本」同样会派生为团队配方 v{selectedSkill ? selectedSkill.version + 1 : ''}。
                      </div>
                    ) : null}

                    {skillSummaryOnly ? (
                      <div className="wf-dock-readonly" role="note">
                        当前账号无权限查看完整内容（仅返回摘要），编辑与发布已禁用。如需调优，请联系管理员。
                      </div>
                    ) : null}

                    {activeTab === 'skills' && skillSaveError ? (
                      <div className="wf-skill-error" role="alert">
                        <AppIcon name="alert" className="h-3.5 w-3.5" />
                        <span>{skillSaveError}</span>
                        <button
                          type="button"
                          className="wf-btn wf-btn-xs wf-btn-ghost"
                          onClick={() => setSkillSaveError(null)}
                          aria-label="清除错误提示"
                        >
                          <AppIcon name="close" className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null}

                    <div className="wf-field-row">
                      <label className="wf-field">
                        <span className="wf-label">Skill 名称</span>
                        <input
                          className="wf-input"
                          disabled={skillReadonly}
                          value={skName}
                          onChange={(event) => setSkName(event.target.value)}
                          placeholder="例如：强反转带货洗稿 · 精简版"
                        />
                      </label>
                      <label className="wf-field">
                        <span className="wf-label">适用赛道</span>
                        <select
                          className="wf-select"
                          disabled={skillReadonly || !creatingSkill}
                          value={skTrack}
                          onChange={(event) => setSkTrack(event.target.value)}
                        >
                          {WORKFLOW_TRACKS.map((track) => (
                            <option key={track} value={track}>
                              {WORKFLOW_TRACK_LABELS[track] || track}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="wf-field-row">
                      <label className="wf-field">
                        <span className="wf-label">所属环节</span>
                        <select
                          className="wf-select"
                          disabled={!creatingSkill}
                          value={skStage}
                          onChange={(event) => setSkStage(event.target.value as WorkflowStage)}
                        >
                          {WORKFLOW_STAGES.map((stage) => (
                            <option key={stage} value={stage}>
                              {WORKFLOW_STAGE_META[stage].shortLabel} · {WORKFLOW_STAGE_META[stage].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="wf-field" style={{ justifyContent: 'center' }}>
                        <span className="wf-label">环节默认开关</span>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 9, height: 34, cursor: skillReadonly ? 'not-allowed' : 'pointer' }}>
                          <input
                            type="checkbox"
                            role="switch"
                            className="wf-switch"
                            disabled={skillReadonly}
                            checked={skIsDefault}
                            onChange={(event) => setSkIsDefault(event.target.checked)}
                          />
                          <span style={{ fontSize: 12, color: 'var(--fos-text-2)' }}>设为本环节推荐默认 Skill</span>
                        </label>
                      </div>
                    </div>

                    <label className="wf-field">
                      <span className="wf-label">配方定位说明</span>
                      <input
                        className="wf-input"
                        disabled={skillReadonly}
                        value={skDescription}
                        onChange={(event) => setSkDescription(event.target.value)}
                        placeholder="简明描述该配方的风格特点与适用场景"
                      />
                    </label>

                    <label className="wf-field">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="wf-label" style={{ marginBottom: 0 }}>System Prompt</span>
                        <span className="wf-field-hint wf-num">{skSystemPrompt.length} 字</span>
                      </div>
                      <textarea
                        className="wf-textarea wf-mono"
                        rows={10}
                        disabled={skillReadonly}
                        style={{ fontSize: 12 }}
                        value={skSystemPrompt}
                        onChange={(event) => setSkSystemPrompt(event.target.value)}
                      />
                    </label>

                    {/* Few-Shot Examples */}
                    <div className="wf-dock-section">
                      <div className="wf-dock-section-title">
                        <span>Few-Shot 范例（{skFewShots.length}）</span>
                        {!skillReadonly ? (
                          <button
                            type="button"
                            className="wf-btn wf-btn-xs wf-btn-subtle"
                            onClick={() => setSkFewShots((prev) => [...prev, { title: `范例 ${prev.length + 1}`, input: '', output: '' }])}
                          >
                            <AppIcon name="plus" className="h-3 w-3" />
                            <span>添加范例</span>
                          </button>
                        ) : null}
                      </div>
                      {skFewShots.length === 0 ? (
                        <div className="wf-field-hint">暂无 Few-Shot 范例。</div>
                      ) : (
                        skFewShots.map((ex, idx) => (
                          <div key={idx} className="wf-card" style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                className="wf-input wf-input-sm"
                                disabled={skillReadonly}
                                placeholder="范例标题"
                                value={ex.title}
                                onChange={(event) => {
                                  const v = event.target.value
                                  setSkFewShots((prev) => prev.map((it, i) => (i === idx ? { ...it, title: v } : it)))
                                }}
                              />
                              {!skillReadonly ? (
                                <button
                                  type="button"
                                  className="wf-btn wf-btn-icon wf-btn-xs wf-btn-danger"
                                  onClick={() => setSkFewShots((prev) => prev.filter((_, i) => i !== idx))}
                                  aria-label="移除范例"
                                >
                                  <AppIcon name="trash" className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                            <div className="wf-field-row">
                              <textarea
                                className="wf-textarea"
                                rows={3}
                                disabled={skillReadonly}
                                placeholder="示例输入…"
                                value={ex.input}
                                onChange={(event) => {
                                  const v = event.target.value
                                  setSkFewShots((prev) => prev.map((it, i) => (i === idx ? { ...it, input: v } : it)))
                                }}
                              />
                              <textarea
                                className="wf-textarea"
                                rows={3}
                                disabled={skillReadonly}
                                placeholder="理想输出…"
                                value={ex.output}
                                onChange={(event) => {
                                  const v = event.target.value
                                  setSkFewShots((prev) => prev.map((it, i) => (i === idx ? { ...it, output: v } : it)))
                                }}
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Structured QC Rules */}
                    <div className="wf-dock-section">
                      <div className="wf-dock-section-title">
                        <span>质检约束规则（QC Rules）</span>
                      </div>
                      <div className="wf-field-row" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                        <label className="wf-field">
                          <span className="wf-label">最少镜头</span>
                          <input className="wf-input wf-input-sm wf-num" type="number" disabled={skillReadonly} value={skQcMinShots} onChange={(e) => setSkQcMinShots(e.target.value)} />
                        </label>
                        <label className="wf-field">
                          <span className="wf-label">最多镜头</span>
                          <input className="wf-input wf-input-sm wf-num" type="number" disabled={skillReadonly} value={skQcMaxShots} onChange={(e) => setSkQcMaxShots(e.target.value)} />
                        </label>
                        <label className="wf-field">
                          <span className="wf-label">最大字数</span>
                          <input className="wf-input wf-input-sm wf-num" type="number" disabled={skillReadonly} value={skQcMaxChars} onChange={(e) => setSkQcMaxChars(e.target.value)} />
                        </label>
                        <label className="wf-field">
                          <span className="wf-label">单镜上限(秒)</span>
                          <input className="wf-input wf-input-sm wf-num" type="number" disabled={skillReadonly} value={skQcMaxShotDur} onChange={(e) => setSkQcMaxShotDur(e.target.value)} />
                        </label>
                      </div>
                      <div className="wf-field-row">
                        <label className="wf-field">
                          <span className="wf-label">必含关键词</span>
                          <input className="wf-input wf-input-sm" disabled={skillReadonly} value={skQcRequired} onChange={(e) => setSkQcRequired(e.target.value)} placeholder="逗号分隔" />
                        </label>
                        <label className="wf-field">
                          <span className="wf-label">禁用词</span>
                          <input className="wf-input wf-input-sm" disabled={skillReadonly} value={skQcForbidden} onChange={(e) => setSkQcForbidden(e.target.value)} placeholder="逗号分隔" />
                        </label>
                      </div>
                      <label className="wf-field">
                        <span className="wf-label">质检清单（每行一条）</span>
                        <textarea className="wf-textarea" rows={3} disabled={skillReadonly} value={skQcChecklist} onChange={(e) => setSkQcChecklist(e.target.value)} />
                      </label>
                    </div>

                    {!skillReadonly ? (
                      <label className="wf-field">
                        <span className="wf-label">版本变更说明（发布新版本时记录）</span>
                        <input
                          className="wf-input wf-input-sm"
                          value={skChangeNote}
                          onChange={(event) => setSkChangeNote(event.target.value)}
                          placeholder="简述本次修改重点，方便后续对比回滚"
                        />
                      </label>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Tab 2: Track Templates */
            <div className="wf-modal-split">
              <div className="wf-modal-sidebar">
                <button
                  type="button"
                  className="wf-btn wf-btn-sm wf-btn-primary"
                  disabled={Boolean(busyAction)}
                  onClick={startCreateNewTemplate}
                >
                  <AppIcon name="plus" className="h-3.5 w-3.5" />
                  <span>新建赛道组合模板</span>
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {templates.map((tpl) => {
                    const active = !creatingTemplate && selectedTemplate?.id === tpl.id
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        className={`wf-popover-item${active ? ' is-active' : ''}`}
                        style={{
                          borderColor: active ? 'var(--fos-primary-border)' : 'var(--fos-border-soft)',
                          background: active ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)',
                        }}
                        onClick={() => {
                          setCreatingTemplate(false)
                          setSelectedTemplateId(tpl.id)
                        }}
                      >
                        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                          <div className="wf-popover-item-title">{tpl.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                            <span className="wf-badge is-warning">{WORKFLOW_TRACK_LABELS[tpl.track] || tpl.track}</span>
                            <span className={`wf-badge ${tpl.isBuiltin ? 'is-info' : 'is-accent'}`}>
                              {tpl.isBuiltin ? '官方内置' : '自定义'}
                            </span>
                            {tpl.isDefault ? <span className="wf-badge is-success">默认</span> : null}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="wf-modal-main">
                {!creatingTemplate && !selectedTemplate ? (
                  <div className="wf-empty">
                    <div className="wf-empty-icon"><AppIcon name="clapperboard" className="h-5 w-5" /></div>
                    <div className="wf-empty-title">选择一个赛道组合模板</div>
                    <div className="wf-empty-desc">通过为 S1–S5 搭配不同 Skill，快速组装面向不同业务的专属工作流。</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="wf-badge is-warning">{WORKFLOW_TRACK_LABELS[tplTrack] || tplTrack}</span>
                        {creatingTemplate ? (
                          <span className="wf-badge is-accent">新建组合模板</span>
                        ) : selectedTemplate ? (
                          <span className={`wf-badge ${selectedTemplate.isBuiltin ? 'is-info' : 'is-success'}`}>
                            {selectedTemplate.isBuiltin ? '官方内置（只读）' : '团队自定义'}
                          </span>
                        ) : null}
                      </div>
                      {!creatingTemplate && selectedTemplate ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            className="wf-btn wf-btn-xs wf-btn-subtle"
                            disabled={Boolean(busyAction)}
                            onClick={() => void handleCloneTemplate(selectedTemplate)}
                          >
                            <AppIcon name="copy" className="h-3.5 w-3.5" />
                            <span>克隆为自定义模板</span>
                          </button>
                          {!selectedTemplate.isBuiltin ? (
                            <button
                              type="button"
                              className="wf-btn wf-btn-xs wf-btn-danger"
                              disabled={Boolean(busyAction)}
                              onClick={() => void handleDeleteTemplate(selectedTemplate)}
                            >
                              <AppIcon name="trash" className="h-3.5 w-3.5" />
                              <span>删除模板</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {templateReadonly ? (
                      <div className="wf-dock-readonly">
                        官方赛道模板保持只读。点击「克隆为自定义模板」即可自由替换任意环节的 Skill 与审阅卡点。
                      </div>
                    ) : null}

                    <div className="wf-field-row">
                      <label className="wf-field">
                        <span className="wf-label">模板名称</span>
                        <input
                          className="wf-input"
                          disabled={templateReadonly}
                          value={tplName}
                          onChange={(event) => setTplName(event.target.value)}
                          placeholder="例如：漫剧带货 · 极速转化组合"
                        />
                      </label>
                      <label className="wf-field">
                        <span className="wf-label">归属赛道</span>
                        <select
                          className="wf-select"
                          disabled={templateReadonly || !creatingTemplate}
                          value={tplTrack}
                          onChange={(event) => setTplTrack(event.target.value)}
                        >
                          {WORKFLOW_TRACKS.map((track) => (
                            <option key={track} value={track}>
                              {WORKFLOW_TRACK_LABELS[track] || track}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="wf-field-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'end' }}>
                      <label className="wf-field">
                        <span className="wf-label">模板简介</span>
                        <input
                          className="wf-input"
                          disabled={templateReadonly}
                          value={tplDescription}
                          onChange={(event) => setTplDescription(event.target.value)}
                          placeholder="说明该赛道模板的产出风格与工作流特点"
                        />
                      </label>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, cursor: templateReadonly ? 'not-allowed' : 'pointer' }}>
                        <input
                          type="checkbox"
                          role="switch"
                          className="wf-switch"
                          disabled={templateReadonly}
                          checked={tplIsDefault}
                          onChange={(event) => setTplIsDefault(event.target.checked)}
                        />
                        <span style={{ fontSize: 12, color: 'var(--fos-text-2)', whiteSpace: 'nowrap' }}>新建作品默认</span>
                      </label>
                    </div>

                    {/* 5-Stage Skill Composer */}
                    <div className="wf-dock-section">
                      <div className="wf-dock-section-title">
                        <span>5 步环节 Skill 组合编排</span>
                        <span className="wf-field-hint">直接选择每个环节绑定的 Skill 与审阅门禁</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {tplStages.map((stageCfg) => {
                          const meta = WORKFLOW_STAGE_META[stageCfg.stage]
                          const stageSkillOptions = skillsByStage[stageCfg.stage] || []
                          const matchedSkill = stageSkillOptions.find(
                            (sk) => (stageCfg.skillId && sk.id === stageCfg.skillId) || sk.slug === stageCfg.skillSlug,
                          ) || stageSkillOptions[0] || null
                          return (
                            <div
                              key={stageCfg.stage}
                              data-stage={stageCfg.stage}
                              className="wf-card"
                              style={{ opacity: stageCfg.enabled ? 1 : 0.6 }}
                            >
                              <div className="wf-card-head" style={{ padding: '10px 14px' }}>
                                <div className="wf-card-title" style={{ fontSize: 12.5 }}>
                                  <span className="wf-badge is-stage">{meta.code}</span>
                                  <span>{meta.label}</span>
                                </div>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                                  <div className="wf-mode-pill" role="radiogroup" aria-label={`${meta.label}审阅模式`}>
                                    {([
                                      { value: 'manual_review' as WorkflowGateMode, label: '人工审阅' },
                                      { value: 'auto' as WorkflowGateMode, label: '自动流转' },
                                    ]).map((gate) => (
                                      <button
                                        key={gate.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={stageCfg.gateMode === gate.value}
                                        disabled={templateReadonly || !stageCfg.enabled}
                                        className={`wf-mode-pill-btn${stageCfg.gateMode === gate.value ? ' is-active' : ''}`}
                                        onClick={() => updateTemplateStage(stageCfg.stage, { gateMode: gate.value })}
                                      >
                                        {gate.label}
                                      </button>
                                    ))}
                                  </div>
                                  <input
                                    type="checkbox"
                                    role="switch"
                                    className="wf-switch"
                                    disabled={templateReadonly}
                                    checked={stageCfg.enabled}
                                    aria-label={`启用 ${meta.label}`}
                                    onChange={(event) => updateTemplateStage(stageCfg.stage, { enabled: event.target.checked })}
                                  />
                                </div>
                              </div>
                              <div className="wf-card-body" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <label className="wf-field">
                                  <span className="wf-label">绑定 Skill 配方</span>
                                  <select
                                    className="wf-select"
                                    disabled={templateReadonly || !stageCfg.enabled}
                                    value={matchedSkill?.id || ''}
                                    onChange={(event) => {
                                      const chosen = stageSkillOptions.find((sk) => sk.id === event.target.value)
                                      if (chosen) {
                                        updateTemplateStage(stageCfg.stage, {
                                          skillId: chosen.id,
                                          skillSlug: chosen.slug,
                                        })
                                      }
                                    }}
                                  >
                                    {stageSkillOptions.length === 0 ? (
                                      <option value="">该环节暂无可选 Skill</option>
                                    ) : (
                                      stageSkillOptions.map((sk) => (
                                        <option key={sk.id} value={sk.id}>
                                          {sk.name} (v{sk.version}){sk.isBuiltin ? ' · 官方内置' : ' · 自定义'}
                                        </option>
                                      ))
                                    )}
                                  </select>
                                </label>
                                {matchedSkill?.description ? (
                                  <div className="wf-field-hint">{matchedSkill.description}</div>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Modal Footer */}
          <div className="wf-modal-foot">
            <span className="wf-field-hint">
              {activeTab === 'skills'
                ? (isSkillDirty
                  ? '有未发布的修改（离开将提示）· 历史版本不可变，编辑将发布为新版本'
                  : '每次发布新版本均为不可变快照，回滚仅切换绑定，不会修改历史版本')
                : '模板决定了新建视频工作流时 S1–S5 的默认 Skill 组合与审阅卡点'}
            </span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="wf-btn wf-btn-ghost"
                disabled={Boolean(busyAction)}
                onClick={() => void requestClose()}
              >
                关闭
              </button>
              {activeTab === 'skills' ? (
                skillReadonly && selectedSkill ? (
                  <button
                    type="button"
                    className="wf-btn wf-btn-primary"
                    disabled={Boolean(busyAction)}
                    onClick={() => void handleCloneSkill(selectedSkill)}
                  >
                    <AppIcon name="copy" className="h-3.5 w-3.5" />
                    <span>克隆为可编辑配方</span>
                  </button>
                ) : creatingSkill ? (
                  <button
                    type="button"
                    className="wf-btn wf-btn-primary"
                    disabled={Boolean(busyAction)}
                    onClick={() => void handleSaveSkill()}
                  >
                    <AppIcon name="check" className="h-3.5 w-3.5" />
                    <span>创建 Skill</span>
                  </button>
                ) : selectedSkill ? (
                  <>
                    <button
                      type="button"
                      className="wf-btn wf-btn-subtle"
                      disabled={Boolean(busyAction) || skillSummaryOnly}
                      title="仅保存名称 / 描述 / 默认标记，不发布新版本"
                      onClick={() => void handleSaveMetaOnly()}
                    >
                      <AppIcon name="check" className="h-3.5 w-3.5" />
                      <span>仅保存元信息</span>
                    </button>
                    <button
                      type="button"
                      className="wf-btn wf-btn-primary"
                      disabled={Boolean(busyAction) || skillSummaryOnly}
                      onClick={() => void handleSaveSkill()}
                    >
                      <AppIcon name="sparkles" className="h-3.5 w-3.5" />
                      <span>发布为新版本 (v{selectedSkill.version + 1})</span>
                    </button>
                  </>
                ) : null
              ) : templateReadonly && selectedTemplate ? (
                <button
                  type="button"
                  className="wf-btn wf-btn-primary"
                  disabled={Boolean(busyAction)}
                  onClick={() => void handleCloneTemplate(selectedTemplate)}
                >
                  <AppIcon name="copy" className="h-3.5 w-3.5" />
                  <span>克隆为自定义模板</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="wf-btn wf-btn-primary"
                  disabled={Boolean(busyAction) || (!creatingTemplate && !selectedTemplate)}
                  onClick={() => void handleSaveTemplate()}
                >
                  <AppIcon name="check" className="h-3.5 w-3.5" />
                  <span>{creatingTemplate ? '创建赛道模板' : '保存模板配置'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </ViewportDialogLayer>
  )
}
