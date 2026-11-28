'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import {
  WORKFLOW_STAGE_META,
  type SkillRefineProposal,
  type StageSkillDraftPatch,
  type WorkflowQcReport,
  type WorkflowSkillDTO,
  type WorkflowSkillFewShotExample,
  type WorkflowSkillQcRules,
  type WorkflowStage,
} from '@/lib/batch-workflow/types'
import { describeTrialCost, diffModelPreferences, flattenDryRunParams, isSkillSummaryOnly, validateRealTrialRequest } from './stages/_helpers'
import { buildQcPanelViewModel, hasSkillTrialScopeChanged } from './workflow-client-utils'

export interface SkillRefinementDockProps {
  open: boolean
  stage: WorkflowStage
  currentSkill: WorkflowSkillDTO | null
  allStageSkills: WorkflowSkillDTO[]
  runId: string
  itemId: string
  itemRevision?: number
  stageOutput: unknown
  /** Optional latest QC report for this stage's output (shown inline). */
  qcReport?: WorkflowQcReport | null
  /** Optional callback to locate a QC violation by its path field. */
  onLocateQcPath?: (path: string) => void
  /** Optional list of S5 shot ids eligible for real (cost-incurring) trial. */
  trialShotOptions?: Array<{ shotId: string; label: string }>
  /**
   * Optional callback for a real (cost-incurring) S5 trial. Only called after
   * the user has explicitly confirmed via checkbox + secondary click, and
   * always with both `confirmCost: true` and a non-empty `shotId`. If omitted,
   * the UI shows the entry disabled with an explanation (no real-gen trigger).
   */
  onRealTrial?: (input: { shotId: string }) => Promise<void> | void
  quotedSnippet?: { label: string; text: string } | null
  onClearQuotedSnippet?: () => void
  trialActive: boolean
  onClose: () => void
  onTrialResult: (result: {
    trialOutput: unknown
    proposal: SkillRefineProposal | null
    draftPatch: StageSkillDraftPatch
  }) => void
  onDiscardTrial: () => void
  onSkillSaved: (savedSkill: WorkflowSkillDTO, appliedOutput?: unknown) => Promise<void> | void
  onSwitchSkill: (skillId: string, rerunNow: boolean, skillDto?: WorkflowSkillDTO) => Promise<void> | void
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void
}

const STAGE_FEEDBACK_CHIPS: Record<WorkflowStage, readonly string[]> = {
  script_analysis: [
    '切镜更细',
    '突出前3秒钩子',
    '补全情绪转折点',
    '拆清声画与音效线索',
    '精简冗余铺垫',
  ],
  script_rewrite: [
    '节奏更快',
    '台词更口语',
    '反转更强',
    '前3秒直接抛冲突',
    '自然植入卖点不硬广',
    '加强结尾情绪留白',
  ],
  asset_extraction: [
    '电影写实光影',
    '去二次元感',
    '服装更统一',
    '人物辨识度更高',
    '场景氛围细节更丰富',
    '精简生图提示词防截断',
  ],
  storyboard: [
    '每镜4-5秒快切',
    '加强运镜描写',
    '突出特写',
    '强化 @资产 精准绑定',
    '加强正反打情绪张力',
    '避免多人同框畸变',
  ],
  video_gen: [
    '主体动作更稳定',
    '强化自然原声表现',
    '控制运镜幅度防崩坏',
    '提升画面光影连贯性',
  ],
}

interface DiffLine {
  kind: 'ctx' | 'add' | 'del'
  text: string
}

function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const before = beforeText.replace(/\r\n?/g, '\n').split('\n')
  const after = afterText.replace(/\r\n?/g, '\n').split('\n')
  const n = before.length
  const m = after.length
  // Guard LCS memory for very long prompts
  if (n * m > 120_000) {
    const fallback: DiffLine[] = []
    const maxLen = Math.max(n, m)
    for (let i = 0; i < maxLen; i += 1) {
      if (before[i] === after[i]) {
        if (before[i] !== undefined) fallback.push({ kind: 'ctx', text: before[i] })
      } else {
        if (before[i] !== undefined) fallback.push({ kind: 'del', text: before[i] })
        if (after[i] !== undefined) fallback.push({ kind: 'add', text: after[i] })
      }
    }
    return fallback
  }
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1]
      }
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      result.push({ kind: 'ctx', text: before[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ kind: 'del', text: before[i] })
      i += 1
    } else {
      result.push({ kind: 'add', text: after[j] })
      j += 1
    }
  }
  while (i < n) {
    result.push({ kind: 'del', text: before[i] })
    i += 1
  }
  while (j < m) {
    result.push({ kind: 'add', text: after[j] })
    j += 1
  }
  return result
}

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

interface QcDraftFields {
  minShots: string
  maxShots: string
  maxChars: string
  maxShotDur: string
  required: string
  forbidden: string
  checklist: string
}

const EMPTY_QC_FIELDS: QcDraftFields = {
  minShots: '',
  maxShots: '',
  maxChars: '',
  maxShotDur: '',
  required: '',
  forbidden: '',
  checklist: '',
}

function qcFieldsFromRules(rules: WorkflowSkillQcRules | null | undefined): QcDraftFields {
  if (!rules) return { ...EMPTY_QC_FIELDS }
  return {
    minShots: rules.minShots != null ? String(rules.minShots) : '',
    maxShots: rules.maxShots != null ? String(rules.maxShots) : '',
    maxChars: rules.maxChars != null ? String(rules.maxChars) : '',
    maxShotDur: rules.maxShotDurationSec != null ? String(rules.maxShotDurationSec) : '',
    required: (rules.requiredKeywords || []).join(', '),
    forbidden: (rules.forbiddenKeywords || []).join(', '),
    checklist: (rules.checklist || []).join('\n'),
  }
}

function normalizeFewShotList(list: WorkflowSkillFewShotExample[] | null | undefined): WorkflowSkillFewShotExample[] {
  if (!Array.isArray(list)) return []
  return list
    .map((ex) => ({
      title: (ex.title || '').trim(),
      input: (ex.input || '').trim(),
      output: (ex.output || '').trim(),
    }))
    .filter((ex) => ex.title || ex.input || ex.output)
}

function buildQcRulesFromFields(fields: QcDraftFields): WorkflowSkillQcRules | null {
  const rules: WorkflowSkillQcRules = {}
  const minShots = Number(fields.minShots)
  const maxShots = Number(fields.maxShots)
  const maxChars = Number(fields.maxChars)
  const maxShotDur = Number(fields.maxShotDur)
  if (fields.minShots.trim() && Number.isFinite(minShots)) rules.minShots = minShots
  if (fields.maxShots.trim() && Number.isFinite(maxShots)) rules.maxShots = maxShots
  if (fields.maxChars.trim() && Number.isFinite(maxChars)) rules.maxChars = maxChars
  if (fields.maxShotDur.trim() && Number.isFinite(maxShotDur)) rules.maxShotDurationSec = maxShotDur
  const req = parseListInput(fields.required)
  const forb = parseListInput(fields.forbidden)
  const chk = fields.checklist.split('\n').map((s) => s.trim()).filter(Boolean)
  if (req.length > 0) rules.requiredKeywords = req
  if (forb.length > 0) rules.forbiddenKeywords = forb
  if (chk.length > 0) rules.checklist = chk
  return Object.keys(rules).length > 0 ? rules : null
}

function normalizeQcRulesForCompare(rules: WorkflowSkillQcRules | null | undefined): WorkflowSkillQcRules | null {
  if (!rules) return null
  return buildQcRulesFromFields(qcFieldsFromRules(rules))
}

function synthesizeQuotedFeedback(quoted: { label: string; text: string }): string {
  const label = quoted.label.trim()
  const text = quoted.text.trim()
  if (label.includes('微调') || label.includes('调优意见')) {
    return `请将以下调优意见沉淀并固化到本环节 Skill 规则中：${text}`
  }
  return `请针对引用的「${label || '当前产出'}」片段进行诊断并优化本环节 Skill 规则，提升此类内容的输出质量与稳定性。`
}

function isDryRunTrialOutput(output: unknown): boolean {
  return Boolean(
    output
    && typeof output === 'object'
    && 'dryRun' in output
    && (output as { dryRun?: unknown }).dryRun === true,
  )
}

function formatVersionTime(iso?: string | null): string {
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

function serializeSampleOutput(
  quotedSnippet: { label: string; text: string } | null | undefined,
  stageOutput: unknown,
): string | undefined {
  if (quotedSnippet && quotedSnippet.text.trim()) {
    return `[引用片段 · ${quotedSnippet.label}]\n${quotedSnippet.text.trim()}`
  }
  if (!stageOutput) return undefined
  try {
    const text = typeof stageOutput === 'string' ? stageOutput : JSON.stringify(stageOutput, null, 2)
    return text.length > 3600 ? `${text.slice(0, 3600)}\n…(已截断)` : text
  } catch {
    return undefined
  }
}

export function SkillRefinementDock({
  open,
  stage,
  currentSkill,
  allStageSkills,
  runId,
  itemId,
  itemRevision,
  stageOutput,
  qcReport = null,
  onLocateQcPath,
  trialShotOptions = [],
  onRealTrial,
  quotedSnippet = null,
  onClearQuotedSnippet,
  trialActive,
  onClose,
  onTrialResult,
  onDiscardTrial,
  onSkillSaved,
  onSwitchSkill,
  onNotify,
}: SkillRefinementDockProps) {
  const [feedback, setFeedback] = useState('')
  const [selectedChips, setSelectedChips] = useState<string[]>([])
  const [refining, setRefining] = useState(false)
  const [trialRunning, setTrialRunning] = useState(false)
  const [savingSkill, setSavingSkill] = useState(false)
  const [proposal, setProposal] = useState<SkillRefineProposal | null>(null)
  const [activeDraftPatch, setActiveDraftPatch] = useState<StageSkillDraftPatch | null>(null)
  const [lastTrialOutput, setLastTrialOutput] = useState<unknown>(undefined)
  const [diffExpanded, setDiffExpanded] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Save / Fork controls
  const [saveAsName, setSaveAsName] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [showForkInput, setShowForkInput] = useState(false)

  // Manual Pro-Config Accordion state
  const [manualPrompt, setManualPrompt] = useState('')
  const [manualFewShots, setManualFewShots] = useState<WorkflowSkillFewShotExample[]>([])
  const [qcFields, setQcFields] = useState<QcDraftFields>(() => ({ ...EMPTY_QC_FIELDS }))
  const prevScopeRef = useRef<{ stage: WorkflowStage; itemId: string }>({ stage, itemId })

  // Version History Popover
  const historyBtnRef = useRef<HTMLButtonElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [versions, setVersions] = useState<WorkflowSkillDTO[]>([])
  const [switchingVersionId, setSwitchingVersionId] = useState<string | null>(null)

  // S5 real-trial confirm flow (only fires when onRealTrial callback is wired)
  const [realTrialShotId, setRealTrialShotId] = useState<string>('')
  const [realTrialConfirm, setRealTrialConfirm] = useState(false)
  const [realTrialArmed, setRealTrialArmed] = useState(false)
  const [realTrialRunning, setRealTrialRunning] = useState(false)
  const [realTrialError, setRealTrialError] = useState<string | null>(null)
  const prevRealTrialScopeRef = useRef<{ itemId: string; skillId: string | null }>({
    itemId,
    skillId: currentSkill?.id || null,
  })

  useEffect(() => {
    const nextScope = { itemId, skillId: currentSkill?.id || null }
    if (!hasSkillTrialScopeChanged(prevRealTrialScopeRef.current, nextScope)) return
    prevRealTrialScopeRef.current = nextScope
    setRealTrialShotId('')
    setRealTrialConfirm(false)
    setRealTrialArmed(false)
    setRealTrialError(null)
  }, [currentSkill?.id, itemId])

  const stageMeta = WORKFLOW_STAGE_META[stage]
  const stageChips = STAGE_FEEDBACK_CHIPS[stage] || []
  const hasQuotedSnippet = Boolean(quotedSnippet && quotedSnippet.text.trim())

  const selectableStageSkills = useMemo(() => {
    if (!currentSkill) return allStageSkills
    if (allStageSkills.some((sk) => sk.id === currentSkill.id)) return allStageSkills
    return [currentSkill, ...allStageSkills]
  }, [allStageSkills, currentSkill])

  // Sync manual editor & reset transient state cleanly when skill/stage/item changes
  useEffect(() => {
    const scopeChanged = prevScopeRef.current.stage !== stage || prevScopeRef.current.itemId !== itemId
    prevScopeRef.current = { stage, itemId }
    setProposal(null)
    setActiveDraftPatch(null)
    setLastTrialOutput(undefined)
    setDiffExpanded(false)
    setSelectedChips([])
    setShowForkInput(false)
    setHistoryOpen(false)
    setVersions([])
    setSwitchingVersionId(null)
    if (scopeChanged) {
      setFeedback('')
    }
    if (!currentSkill) {
      setManualPrompt('')
      setManualFewShots([])
      setQcFields({ ...EMPTY_QC_FIELDS })
      setSaveAsName('')
      setChangeNote('')
      return
    }
    const baseCleanName = currentSkill.name.replace(/\s*[·・]\s*调优版.*$/, '').trim()
    setSaveAsName(`${baseCleanName} · 调优版`)
    setChangeNote('')
    setManualPrompt(currentSkill.systemPrompt || '')
    setManualFewShots(Array.isArray(currentSkill.fewShotExamples) ? currentSkill.fewShotExamples : [])
    setQcFields(qcFieldsFromRules(currentSkill.qcRules))
  }, [currentSkill?.id, stage, itemId])

  // Keep local trial output aligned if parent discards trial from workbench A/B bar
  useEffect(() => {
    if (!trialActive) {
      setLastTrialOutput(undefined)
    }
  }, [trialActive])

  // Load version history when popover opens
  useEffect(() => {
    if (!historyOpen || !currentSkill) return
    let active = true
    setHistoryLoading(true)
    void apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(currentSkill.id)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取版本历史失败'))
        return await response.json() as { skill?: WorkflowSkillDTO; versions?: WorkflowSkillDTO[] }
      })
      .then((payload) => {
        if (!active) return
        const list = Array.isArray(payload.versions) && payload.versions.length > 0
          ? payload.versions
          : payload.skill
            ? [payload.skill]
            : [currentSkill]
        setVersions(list)
      })
      .catch((err) => {
        if (!active) return
        onNotify(err instanceof Error ? err.message : '读取版本历史失败', 'error')
        setVersions([currentSkill])
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })
    return () => { active = false }
  }, [historyOpen, currentSkill, onNotify])

  const promptDiffLines = useMemo(() => {
    if (!currentSkill || !proposal) return []
    return computeLineDiff(currentSkill.systemPrompt || '', manualPrompt || proposal.nextSystemPrompt || '')
  }, [currentSkill, manualPrompt, proposal])

  const diffStats = useMemo(() => {
    let added = 0
    let removed = 0
    for (const line of promptDiffLines) {
      if (line.kind === 'add') added += 1
      else if (line.kind === 'del') removed += 1
    }
    return { added, removed }
  }, [promptDiffLines])

  const toggleFeedbackChip = (chip: string) => {
    const active = selectedChips.includes(chip)
    const nextChips = active
      ? selectedChips.filter((item) => item !== chip)
      : [...selectedChips, chip]
    setSelectedChips(nextChips)
    setFeedback((prev) => {
      const trimmed = prev.trim()
      if (active) {
        const parts = trimmed.split(/[；;。\n]+/).map((s) => s.trim()).filter((s) => s && s !== chip)
        return parts.join('；')
      }
      if (!trimmed) return chip
      if (trimmed.includes(chip)) return trimmed
      return `${trimmed}；${chip}`
    })
  }

  const buildManualDraftPatch = (overrides?: {
    prompt?: string
    fewShots?: WorkflowSkillFewShotExample[]
    qc?: QcDraftFields
  }): StageSkillDraftPatch => {
    const promptVal = overrides?.prompt !== undefined ? overrides.prompt : manualPrompt
    const fewShotsVal = overrides?.fewShots !== undefined ? overrides.fewShots : manualFewShots
    const qcVal = overrides?.qc !== undefined ? overrides.qc : qcFields
    return {
      ...(proposal?.nextName ? { name: proposal.nextName } : activeDraftPatch?.name ? { name: activeDraftPatch.name } : {}),
      systemPrompt: promptVal.trim(),
      fewShotExamples: normalizeFewShotList(fewShotsVal),
      qcRules: buildQcRulesFromFields(qcVal),
      modelPreferences: proposal?.nextModelPreferences ?? activeDraftPatch?.modelPreferences ?? currentSkill?.modelPreferences ?? null,
    }
  }

  const updateManualProConfig = (next: {
    prompt?: string
    fewShots?: WorkflowSkillFewShotExample[]
    qcPatch?: Partial<QcDraftFields>
  }) => {
    const nextPrompt = next.prompt !== undefined ? next.prompt : manualPrompt
    const nextFewShots = next.fewShots !== undefined ? next.fewShots : manualFewShots
    const nextQc: QcDraftFields = next.qcPatch ? { ...qcFields, ...next.qcPatch } : qcFields
    if (next.prompt !== undefined) setManualPrompt(nextPrompt)
    if (next.fewShots !== undefined) setManualFewShots(nextFewShots)
    if (next.qcPatch) setQcFields(nextQc)

    const nextPatch = buildManualDraftPatch({
      prompt: nextPrompt,
      fewShots: nextFewShots,
      qc: nextQc,
    })
    if (currentSkill && !proposal && !trialActive) {
      const promptMatches = nextPrompt.trim() === (currentSkill.systemPrompt || '').trim()
      const fewShotsMatch = JSON.stringify(nextPatch.fewShotExamples || [])
        === JSON.stringify(normalizeFewShotList(currentSkill.fewShotExamples))
      const qcMatch = JSON.stringify(normalizeQcRulesForCompare(nextPatch.qcRules))
        === JSON.stringify(normalizeQcRulesForCompare(currentSkill.qcRules))
      if (promptMatches && fewShotsMatch && qcMatch) {
        setActiveDraftPatch(null)
        return
      }
    }
    setActiveDraftPatch(nextPatch)
  }

  const executeTrial = async (
    draftPatch: StageSkillDraftPatch,
    nextProposal: SkillRefineProposal | null,
  ) => {
    if (!currentSkill) return
    if (!runId || !itemId) {
      onNotify('请先在左侧选择一条视频条目再进行锁上游试跑对比。', 'info')
      return
    }
    setTrialRunning(true)
    try {
      const response = await apiFetch(
        `/api/batch-workflow/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/trial`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stage,
            skillIdOverride: currentSkill.id,
            skillPatch: draftPatch,
            ...(itemRevision !== undefined ? { expectedRevision: itemRevision } : {}),
          }),
        },
      )
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '锁上游试跑失败'))
      }
      const payload = await response.json() as {
        trial?: { trialOutput?: unknown; durationMs?: number }
        trialOutput?: unknown
      }
      const trialOutput = payload.trial !== undefined ? payload.trial.trialOutput : payload.trialOutput
      setActiveDraftPatch(draftPatch)
      setLastTrialOutput(trialOutput)
      // Parent BatchWorkflowClient displays the single trial-complete toast inside onTrialResult.
      onTrialResult({
        trialOutput,
        proposal: nextProposal,
        draftPatch,
      })
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '锁上游试跑失败', 'error')
    } finally {
      setTrialRunning(false)
    }
  }

  const handleRefineAndTrial = async (autoTrial: boolean) => {
    if (!currentSkill) {
      onNotify('当前环节尚未挂载 Skill，请先选择配方。', 'error')
      return
    }
    const cleanFeedback = feedback.trim()
      || (hasQuotedSnippet && quotedSnippet ? synthesizeQuotedFeedback(quotedSnippet) : '')
    if (!cleanFeedback) {
      onNotify('请先输入自然语言调优意见，或点选上方快捷反馈标签。', 'info')
      return
    }
    setRefining(true)
    try {
      const sampleOutput = serializeSampleOutput(quotedSnippet, stageOutput)
      const response = await apiFetch('/api/batch-workflow/skills/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: currentSkill.id,
          feedback: cleanFeedback,
          ...(sampleOutput ? { sampleOutput } : {}),
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'AI 优化 Skill 失败'))
      }
      const payload = await response.json() as { proposal?: SkillRefineProposal }
      if (!payload.proposal) {
        throw new Error('AI 未返回有效的优化方案，请重试。')
      }
      const nextProposal = payload.proposal
      setProposal(nextProposal)
      setChangeNote(nextProposal.changeNote || cleanFeedback.slice(0, 120))
      // Sync proposal into manual accordion so power admins can tweak further
      setManualPrompt(nextProposal.nextSystemPrompt)
      setManualFewShots(Array.isArray(nextProposal.nextFewShotExamples) ? nextProposal.nextFewShotExamples : [])
      setQcFields(qcFieldsFromRules(nextProposal.nextQcRules))

      const draftPatch: StageSkillDraftPatch = {
        name: nextProposal.nextName,
        systemPrompt: nextProposal.nextSystemPrompt,
        fewShotExamples: nextProposal.nextFewShotExamples,
        qcRules: nextProposal.nextQcRules,
        modelPreferences: nextProposal.nextModelPreferences,
      }
      setActiveDraftPatch(draftPatch)

      if (autoTrial && runId && itemId) {
        setRefining(false)
        await executeTrial(draftPatch, nextProposal)
      } else {
        onNotify('已生成 AI 优化方案，查看变更摘要后可点击「锁上游试跑对比」。', 'success')
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'AI 优化 Skill 失败', 'error')
    } finally {
      setRefining(false)
    }
  }

  const handleManualTrial = async () => {
    if (!currentSkill) return
    if (!manualPrompt.trim()) {
      onNotify('System Prompt 不能为空。', 'error')
      return
    }
    const patch = buildManualDraftPatch()
    await executeTrial(patch, proposal)
  }

  const resolveEffectivePatch = (): StageSkillDraftPatch => buildManualDraftPatch()

  const resolveApplicableTrialOutput = (): unknown => {
    if (stage === 'video_gen' || isDryRunTrialOutput(lastTrialOutput)) return undefined
    return lastTrialOutput
  }

  const handleCommitNewVersion = async () => {
    if (!currentSkill || savingSkill) return
    if (isSkillSummaryOnly(currentSkill)) {
      onNotify('无权限查看完整内容，无法基于此配方发布新版本。', 'error')
      return
    }
    const patch = resolveEffectivePatch()
    if (!patch.systemPrompt?.trim()) {
      onNotify('System Prompt 不能为空。', 'error')
      return
    }
    setSavingSkill(true)
    try {
      const response = await apiFetch(`/api/batch-workflow/skills/${encodeURIComponent(currentSkill.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saveAsNewVersion: true,
          changeNote: changeNote.trim()
            || proposal?.changeNote
            || feedback.trim().slice(0, 140)
            || (currentSkill.isBuiltin
              ? `基于官方 v${currentSkill.version} 派生团队配方`
              : `迭代优化 v${currentSkill.version + 1}`),
          description: proposal?.nextDescription ?? currentSkill.description,
          systemPrompt: patch.systemPrompt,
          fewShotExamples: patch.fewShotExamples ?? currentSkill.fewShotExamples,
          qcRules: patch.qcRules !== undefined ? patch.qcRules : currentSkill.qcRules,
          modelPreferences: patch.modelPreferences !== undefined ? patch.modelPreferences : currentSkill.modelPreferences,
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '发布新版本失败'))
      }
      const payload = await response.json() as { skill?: WorkflowSkillDTO }
      if (!payload.skill) throw new Error('发布成功但未返回 Skill 数据。')
      // Contract 5: only clear local dirty state AFTER onSkillSaved resolves.
      await onSkillSaved(payload.skill, resolveApplicableTrialOutput())
      setProposal(null)
      setActiveDraftPatch(null)
      setLastTrialOutput(undefined)
      setShowForkInput(false)
      setFeedback('')
      setSelectedChips([])
      onClearQuotedSnippet?.()
      onNotify(
        currentSkill.isBuiltin
          ? `已基于官方 v${currentSkill.version} 派生团队配方「${payload.skill.name}」v${payload.skill.version}，官方版本保持不变`
          : `已发布「${payload.skill.name}」v${payload.skill.version} 并自动应用到当前环节！`,
        'success',
      )
    } catch (err) {
      // 失败：保留 proposal/activeDraftPatch，仅提示错误（contract 5）
      onNotify(err instanceof Error ? err.message : '发布新版本失败', 'error')
    } finally {
      setSavingSkill(false)
    }
  }

  const handleSaveAsCustomSkill = async () => {
    if (!currentSkill || savingSkill) return
    const targetName = saveAsName.trim() || `${currentSkill.name} · 调优版`
    const patch = resolveEffectivePatch()
    if (!patch.systemPrompt?.trim()) {
      onNotify('System Prompt 不能为空。', 'error')
      return
    }
    setSavingSkill(true)
    try {
      const response = await apiFetch('/api/batch-workflow/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: targetName,
          track: currentSkill.track,
          stage: currentSkill.stage,
          description: proposal?.nextDescription ?? currentSkill.description,
          systemPrompt: patch.systemPrompt,
          fewShotExamples: patch.fewShotExamples ?? currentSkill.fewShotExamples,
          qcRules: patch.qcRules !== undefined ? patch.qcRules : currentSkill.qcRules,
          modelPreferences: patch.modelPreferences !== undefined ? patch.modelPreferences : currentSkill.modelPreferences,
          cloneFromSkillId: currentSkill.id,
          parentSkillId: currentSkill.id,
          changeNote: changeNote.trim() || proposal?.changeNote || feedback.trim().slice(0, 140) || `基于 ${currentSkill.name} v${currentSkill.version} 调优创建`,
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '另存自定义 Skill 失败'))
      }
      const payload = await response.json() as { skill?: WorkflowSkillDTO }
      if (!payload.skill) throw new Error('创建成功但未返回 Skill 数据。')
      await onSkillSaved(payload.skill, resolveApplicableTrialOutput())
      setProposal(null)
      setActiveDraftPatch(null)
      setLastTrialOutput(undefined)
      setShowForkInput(false)
      setFeedback('')
      setSelectedChips([])
      onClearQuotedSnippet?.()
      onNotify(`已另存为全新 Skill「${payload.skill.name}」并自动绑定到当前环节！`, 'success')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '另存自定义 Skill 失败', 'error')
    } finally {
      setSavingSkill(false)
    }
  }

  const handleRollbackVersion = async (targetVersion: WorkflowSkillDTO, rerunNow: boolean) => {
    if (switchingVersionId) return
    setSwitchingVersionId(targetVersion.id)
    try {
      // 回滚 = 切换绑定，不修改历史 Skill 内容。失败时保留历史 Popover 与当前编辑。
      await onSwitchSkill(targetVersion.id, rerunNow, targetVersion)
      setHistoryOpen(false)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '回滚绑定失败', 'error')
    } finally {
      setSwitchingVersionId(null)
    }
  }

  const hasManualEdits = useMemo(() => {
    if (!currentSkill) return false
    if (manualPrompt.trim() !== (currentSkill.systemPrompt || '').trim()) return true
    const currentFew = normalizeFewShotList(manualFewShots)
    const baseFew = normalizeFewShotList(currentSkill.fewShotExamples)
    if (JSON.stringify(currentFew) !== JSON.stringify(baseFew)) return true
    const currentQc = normalizeQcRulesForCompare(buildQcRulesFromFields(qcFields))
    const baseQc = normalizeQcRulesForCompare(currentSkill.qcRules)
    if (JSON.stringify(currentQc) !== JSON.stringify(baseQc)) return true
    return false
  }, [currentSkill, manualFewShots, manualPrompt, qcFields])

  const hasUnsavedChanges = Boolean(
    proposal
    || activeDraftPatch
    || trialActive
    || hasManualEdits,
  )
  const canRefine = Boolean(feedback.trim() || hasQuotedSnippet)
  const busy = refining || trialRunning || savingSkill

  return (
    <aside
      className={`wf-skill-dock${open ? '' : ' is-collapsed'}`}
      data-stage={stage}
      aria-label="管理员 Skill 调优面板"
      aria-hidden={!open}
    >
      {/* 1. Header with Skill Name, Version Badge & Version History Rollback Popover */}
      <div className="wf-dock-head">
        <div className="wf-dock-title-wrap">
          <div className="wf-dock-title">
            <span className="wf-badge is-stage">{stageMeta.code}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentSkill?.name || `${stageMeta.label} Skill`}
            </span>
            {currentSkill ? (
              <span className="wf-badge is-accent wf-num">v{currentSkill.version}</span>
            ) : null}
          </div>
          <div className="wf-dock-sub">
            {currentSkill
              ? (currentSkill.isBuiltin
                ? `官方内置配方 v${currentSkill.version}（只读）· 调优后将派生为团队配方 v${currentSkill.version + 1}`
                : '团队自定义配方 · 支持发布新版本与历史回滚')
              : '未绑定该环节 Skill'}
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {currentSkill ? (
            <button
              ref={historyBtnRef}
              type="button"
              className="wf-btn wf-btn-xs wf-btn-subtle"
              onClick={() => setHistoryOpen((prev) => !prev)}
              aria-expanded={historyOpen}
              title="查看历史版本并一键回滚"
            >
              <AppIcon name="history" className="h-3.5 w-3.5" />
              <span>版本</span>
            </button>
          ) : null}
          <button
            type="button"
            className="wf-btn wf-btn-icon wf-btn-sm wf-btn-ghost"
            onClick={onClose}
            aria-label="收起 Skill 调优面板"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Version History Rollback Popover */}
      {historyOpen && currentSkill ? (
        <ViewportPopover
          anchorRef={historyBtnRef}
          onClose={() => setHistoryOpen(false)}
          lockAnchorWhileOpen
          preferredSide="below"
          width={360}
          maxHeight={420}
          className="wf-popover"
          role="dialog"
          aria-label="Skill 版本历史"
        >
          <div className="wf-popover-head">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <AppIcon name="history" className="h-3.5 w-3.5" />
              <span>版本历史与一键回滚</span>
            </span>
            <span className="wf-badge is-muted wf-num">{versions.length} 个版本</span>
          </div>
          <div className="wf-popover-body" style={{ padding: 10 }}>
            {historyLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="wf-shimmer wf-skeleton-line" style={{ width: '75%' }} />
                <div className="wf-shimmer wf-skeleton-block" style={{ height: 56 }} />
              </div>
            ) : versions.length === 0 ? (
              <div className="wf-dock-readonly">暂无历史版本记录。</div>
            ) : (
              <div className="wf-version-timeline">
                {versions.map((ver) => {
                  const isCurrent = ver.id === currentSkill.id
                  const isSwitching = switchingVersionId === ver.id
                  return (
                    <div key={ver.id} className={`wf-version-row${isCurrent ? ' is-current' : ''}`}>
                      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="wf-badge is-accent wf-num">v{ver.version}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fos-text-1)' }}>
                            {ver.name}
                          </span>
                          {isCurrent ? <span className="wf-badge is-success">当前</span> : null}
                          {ver.isBuiltin ? <span className="wf-badge is-muted">官方</span> : null}
                        </div>
                        <div className="wf-field-hint" style={{ marginTop: 4 }}>
                          {ver.changeNote || (ver.isBuiltin ? '官方初始内置基线版本' : '手动编辑版本')}
                        </div>
                        <div className="wf-field-hint wf-num" style={{ marginTop: 2, fontSize: 10.5 }}>
                          {formatVersionTime(ver.updatedAt || ver.createdAt)}
                        </div>
                      </div>
                      {!isCurrent ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                          <button
                            type="button"
                            className="wf-btn wf-btn-xs wf-btn-subtle"
                            disabled={Boolean(switchingVersionId)}
                            onClick={() => void handleRollbackVersion(ver, false)}
                          >
                            {isSwitching ? <span className="wf-spinner" /> : null}
                            <span>切换</span>
                          </button>
                          <button
                            type="button"
                            className="wf-btn wf-btn-xs wf-btn-stage"
                            disabled={Boolean(switchingVersionId)}
                            onClick={() => void handleRollbackVersion(ver, true)}
                          >
                            回滚并重跑
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ViewportPopover>
      ) : null}

      {/* Main Dock Scroll Body */}
      <div className="wf-dock-body">
        {currentSkill && isSkillSummaryOnly(currentSkill) ? (
          <div className="wf-dock-readonly" role="note">
            当前账号无权限查看完整内容（仅返回摘要）。如需调优，请联系管理员开放 admin 权限后再试。
          </div>
        ) : null}

        {/* Stage Skill Quick Switcher */}
        {selectableStageSkills.length > 1 && currentSkill ? (
          <div className="wf-dock-section">
            <div className="wf-dock-section-title">
              <span>当前环节挂载 Skill</span>
              <span className="wf-badge is-muted wf-num">{selectableStageSkills.length} 个可用</span>
            </div>
            <select
              className="wf-select wf-select-sm"
              aria-label="切换当前环节 Skill"
              value={currentSkill.id}
              disabled={busy}
              onChange={(event) => {
                const nextId = event.target.value
                if (nextId && nextId !== currentSkill.id) {
                  const picked = selectableStageSkills.find((sk) => sk.id === nextId)
                  void onSwitchSkill(nextId, false, picked)
                }
              }}
            >
              {selectableStageSkills.map((sk) => (
                <option key={sk.id} value={sk.id}>
                  {sk.name} (v{sk.version}){sk.isBuiltin ? ' · 官方' : ' · 自定义'}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Optional Quoted Bad-Case Snippet */}
        {quotedSnippet ? (
          <div
            className="wf-card"
            style={{
              borderColor: 'var(--fos-primary-border)',
              background: 'var(--fos-primary-soft)',
            }}
          >
            <div style={{ padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="wf-badge is-accent">
                  <AppIcon name="sparkles" className="h-3 w-3" />
                  <span>已引用 · {quotedSnippet.label}</span>
                </span>
                {onClearQuotedSnippet ? (
                  <button
                    type="button"
                    className="wf-btn wf-btn-icon wf-btn-xs wf-btn-ghost"
                    onClick={onClearQuotedSnippet}
                    aria-label="移除引用片段"
                  >
                    <AppIcon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: 'var(--fos-text-2)',
                  maxHeight: 74,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {quotedSnippet.text}
              </div>
            </div>
          </div>
        ) : null}

        {/* 2. Stage-Aware Quick Feedback Chips */}
        <div className="wf-dock-section">
          <div className="wf-dock-section-title">
            <span>自然语言调优指令</span>
            <span className="wf-field-hint">点选标签或直接描述问题</span>
          </div>
          <div className="wf-feedback-chips" role="group" aria-label="快捷调优反馈标签">
            {stageChips.map((chip) => {
              const active = selectedChips.includes(chip)
              return (
                <button
                  key={chip}
                  type="button"
                  className={`wf-feedback-chip${active ? ' is-active' : ''}`}
                  disabled={busy}
                  onClick={() => toggleFeedbackChip(chip)}
                >
                  <AppIcon name={active ? 'check' : 'plus'} className="h-3 w-3" />
                  <span>{chip}</span>
                </button>
              )
            })}
          </div>
          <textarea
            className="wf-textarea"
            rows={4}
            disabled={busy || !currentSkill}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={hasQuotedSnippet && quotedSnippet
              ? `已引用「${quotedSnippet.label}」，可直接点击下方「✦ AI 优化 Skill 并试跑」，或在此补充更具体的调优要求…`
              : `告诉 AI 哪里不够理想，例如：「${stageChips.slice(0, 2).join('，')}，输出再克制一点不要出现口号感」`}
          />
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="wf-btn wf-btn-primary"
              style={{ flex: '1 1 auto' }}
              disabled={busy || !currentSkill || !canRefine}
              onClick={() => void handleRefineAndTrial(true)}
            >
              {refining || trialRunning ? <span className="wf-spinner" /> : <AppIcon name="sparkles" className="h-3.5 w-3.5" />}
              <span>
                {refining
                  ? 'AI 正在生成优化方案…'
                  : trialRunning
                    ? '正在锁上游试跑对比…'
                    : '✦ AI 优化 Skill 并试跑'}
              </span>
            </button>
            <button
              type="button"
              className="wf-btn wf-btn-subtle"
              disabled={busy || !currentSkill || !canRefine}
              title="仅生成优化方案和 Diff，稍后手动触发试跑"
              onClick={() => void handleRefineAndTrial(false)}
            >
              仅出方案
            </button>
          </div>
        </div>

        {/* 4. AI Proposal Card + Expandable Line-by-Line Diff */}
        {proposal ? (
          <div className="wf-proposal-card">
            <div className="wf-proposal-head">
              <div className="wf-proposal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" style={{ color: 'var(--fos-primary-text)' }} />
                <span>AI 调优方案</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="wf-badge is-success wf-num">+{diffStats.added}</span>
                <span className="wf-badge is-danger wf-num">-{diffStats.removed}</span>
                <button
                  type="button"
                  className="wf-btn wf-btn-icon wf-btn-xs wf-btn-ghost"
                  onClick={() => {
                    setProposal(null)
                    setActiveDraftPatch(null)
                    setLastTrialOutput(undefined)
                    if (currentSkill) {
                      setManualPrompt(currentSkill.systemPrompt || '')
                      setManualFewShots(Array.isArray(currentSkill.fewShotExamples) ? currentSkill.fewShotExamples : [])
                      setQcFields(qcFieldsFromRules(currentSkill.qcRules))
                    }
                    if (trialActive) onDiscardTrial()
                  }}
                  aria-label="放弃此优化方案"
                >
                  <AppIcon name="close" className="h-3 w-3" />
                </button>
              </div>
            </div>

            {proposal.changeSummary.length > 0 ? (
              <ul className="wf-proposal-bullets">
                {proposal.changeSummary.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="wf-field-hint">{proposal.changeNote || '已按您的意见优化提示词与质检规则。'}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <button
                type="button"
                className="wf-btn wf-btn-xs wf-btn-subtle"
                onClick={() => setDiffExpanded((prev) => !prev)}
              >
                <AppIcon name={diffExpanded ? 'chevronUp' : 'chevronDown'} className="h-3 w-3" />
                <span>{diffExpanded ? '收起 Prompt 逐行对比' : '查看 Prompt 逐行 Diff'}</span>
              </button>
              <button
                type="button"
                className="wf-btn wf-btn-xs wf-btn-stage"
                disabled={busy || !runId || !itemId}
                onClick={() => void executeTrial(resolveEffectivePatch(), proposal)}
              >
                {trialRunning ? <span className="wf-spinner" /> : <AppIcon name="play" className="h-3 w-3" />}
                <span>{trialActive ? '重新锁上游试跑' : '锁上游试跑对比'}</span>
              </button>
            </div>

            {diffExpanded ? (
              <div className="wf-diff-box" aria-label="System Prompt 逐行变更对比">
                {promptDiffLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`wf-diff-line${line.kind === 'add' ? ' is-add' : line.kind === 'del' ? ' is-del' : ' is-ctx'}`}
                  >
                    {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
                    {line.text || ' '}
                  </div>
                ))}
              </div>
            ) : null}

            {(() => {
              const prevPrefs = currentSkill?.modelPreferences ?? null
              const nextPrefs = proposal.nextModelPreferences ?? null
              const diffs = diffModelPreferences(prevPrefs, nextPrefs)
              if (diffs.length === 0) return null
              return (
                <div className="wf-modelpref-diff" aria-label="模型偏好变更">
                  <div className="wf-dock-section-title">
                    <span>模型偏好变更</span>
                    <span className="wf-badge is-muted wf-num">{diffs.length} 项</span>
                  </div>
                  <ul className="wf-modelpref-diff-list">
                    {diffs.map((d) => (
                      <li key={d.key} className="wf-modelpref-diff-item">
                        <span className="wf-modelpref-label">{d.label}</span>
                        <span className="wf-modelpref-before">{d.before}</span>
                        <span className="wf-modelpref-arrow">→</span>
                        <span className="wf-modelpref-after">{d.after}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })()}
          </div>
        ) : null}

        {/* QC Report Block */}
        {(() => {
          const qcPanel = buildQcPanelViewModel(qcReport)
          return qcPanel ? (
            <div className={`wf-qc-banner is-${qcPanel.level}`} role={qcPanel.level === 'failed' ? 'alert' : 'status'}>
              <div className="wf-dock-section-title">
                <span>
                  <AppIcon name="alert" className="h-3.5 w-3.5" />
                  <span> 质量检查：{qcPanel.level === 'failed' ? '未通过' : '警告'}（{qcPanel.visibleViolations.length + qcPanel.hiddenCount} 项违规）</span>
                </span>
                <span className="wf-field-hint wf-num">
                  已自动纠错 {qcReport?.retryCount || 0} 次
                </span>
              </div>
              <ul className="wf-qc-violation-list">
                {qcPanel.visibleViolations.map((v, idx) => (
                  <li key={idx} className="wf-qc-violation-item">
                    <span className="wf-qc-rule">{v.rule}</span>
                    {v.path ? (
                      onLocateQcPath ? (
                        <button
                          type="button"
                          className="wf-qc-path wf-qc-path-link"
                          onClick={() => onLocateQcPath(v.path)}
                          title="定位到字段"
                        >
                          {v.path}
                        </button>
                      ) : (
                        <span className="wf-qc-path">{v.path}</span>
                      )
                    ) : null}
                    <span className="wf-qc-msg">{v.message}</span>
                  </li>
                ))}
                {qcPanel.hiddenCount > 0 ? <li className="wf-qc-violation-item is-more">另有 {qcPanel.hiddenCount} 条</li> : null}
              </ul>
            </div>
          ) : null
        })()}

        {/* Active Trial Notice */}
        {trialActive ? (
          <div
            className="wf-dock-readonly"
            style={{
              borderColor: 'var(--fos-primary-border)',
              background: 'var(--fos-primary-soft)',
              color: 'var(--fos-text-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>
              A/B 试跑对比中：主工作台可随时切换原产出与试跑产出
            </span>
            <button
              type="button"
              className="wf-btn wf-btn-xs wf-btn-ghost"
              disabled={busy}
              onClick={() => {
                setLastTrialOutput(undefined)
                onDiscardTrial()
              }}
            >
              放弃试跑
            </button>
          </div>
        ) : null}

        {/* S5 dry-run vs real-trial cost notice + dry-run parameter preview */}
        {stage === 'video_gen' ? (
          <div className="wf-dock-section wf-trial-cost">
            <div className="wf-dock-section-title">
              <span>S5 试跑费用与参数</span>
              <span className={`wf-badge ${isDryRunTrialOutput(lastTrialOutput) ? 'is-info' : 'is-warning'}`}>
                {isDryRunTrialOutput(lastTrialOutput) ? 'dry-run' : '默认 dry-run'}
              </span>
            </div>
            <p className="wf-field-hint" style={{ margin: '4px 0' }}>
              {describeTrialCost(isDryRunTrialOutput(lastTrialOutput))}
            </p>
            {isDryRunTrialOutput(lastTrialOutput) && lastTrialOutput && typeof lastTrialOutput === 'object' ? (
              <details className="wf-trial-dryrun-details">
                <summary className="wf-field-hint" style={{ cursor: 'pointer' }}>查看 dry-run 合并后参数</summary>
                <ul className="wf-trial-dryrun-params">
                  {flattenDryRunParams(lastTrialOutput).map((row) => (
                    <li key={row.key} className="wf-trial-dryrun-row">
                      <span className="wf-trial-dryrun-key">{row.key}</span>
                      <span className="wf-trial-dryrun-val">{row.value}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {/* Real-trial: explicit confirm + shotId required, callback only when wired */}
            <div className="wf-real-trial">
              <div className="wf-dock-section-title" style={{ marginTop: 6 }}>
                <span>真实单镜试跑（消耗视频额度）</span>
                <span className="wf-badge is-warning">付费</span>
              </div>
              {!onRealTrial ? (
                <p className="wf-field-hint wf-real-trial-disabled">
                  真实试跑暂未接入，需要父级提供 <code>onRealTrial</code> 回调后才能发起；当前仅支持 dry-run。
                </p>
              ) : trialShotOptions.length === 0 ? (
                <p className="wf-field-hint wf-real-trial-disabled">
                  暂无可选镜头；请先在阶段产物中生成至少一个镜头，再选择进行真实单镜试跑。
                </p>
              ) : (
                <>
                  <label className="wf-field">
                    <span className="wf-label">选择镜头（仅单镜）</span>
                    <select
                      className="wf-select wf-select-sm"
                      value={realTrialShotId}
                      disabled={busy || realTrialRunning}
                      onChange={(event) => {
                        setRealTrialShotId(event.target.value)
                        setRealTrialArmed(false)
                        setRealTrialError(null)
                      }}
                    >
                      <option value="">请选择镜头…</option>
                      {trialShotOptions.map((opt) => (
                        <option key={opt.shotId} value={opt.shotId}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="wf-real-trial-confirm">
                    <input
                      type="checkbox"
                      checked={realTrialConfirm}
                      disabled={busy || realTrialRunning}
                      onChange={(event) => {
                        setRealTrialConfirm(event.target.checked)
                        setRealTrialArmed(false)
                      }}
                    />
                    <span>我了解：本次真实试跑将实际提交一次视频生成任务，扣减视频额度。</span>
                  </label>
                  {realTrialError ? (
                    <div className="wf-skill-error" role="alert">
                      <AppIcon name="alert" className="h-3.5 w-3.5" />
                      <span>{realTrialError}</span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={`wf-btn wf-btn-sm ${realTrialArmed ? 'wf-btn-danger' : 'wf-btn-subtle'}`}
                    disabled={busy || realTrialRunning}
                    onClick={() => {
                      void (async () => {
                        const validation = validateRealTrialRequest({
                          confirmCost: realTrialConfirm,
                          shotId: realTrialShotId,
                        })
                        if (validation) {
                          setRealTrialError(validation)
                          return
                        }
                        if (!realTrialArmed) {
                          setRealTrialError(null)
                          setRealTrialArmed(true)
                          return
                        }
                        setRealTrialError(null)
                        setRealTrialRunning(true)
                        try {
                          await onRealTrial({ shotId: realTrialShotId.trim() })
                          setRealTrialArmed(false)
                          setRealTrialConfirm(false)
                        } catch (err) {
                          setRealTrialError(err instanceof Error ? err.message : '真实试跑失败')
                        } finally {
                          setRealTrialRunning(false)
                        }
                      })()
                    }}
                  >
                    {realTrialRunning ? <span className="wf-spinner" /> : null}
                    <span>
                      {realTrialRunning
                        ? '试跑中…'
                        : realTrialArmed
                          ? '再次点击确认发起真实试跑'
                          : '真实试跑（二次确认）'}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* 5. One-Click Commit / Fork Section */}
        {currentSkill && hasUnsavedChanges ? (
          <div className="wf-card">
            <div className="wf-card-head" style={{ padding: '9px 12px' }}>
              <span className="wf-card-title" style={{ fontSize: 12 }}>
                <AppIcon name="badgeCheck" className="h-3.5 w-3.5" style={{ color: 'var(--fos-success)' }} />
                <span>保存并沉淀本次调优</span>
              </span>
              <span className="wf-badge is-muted">
                {currentSkill.isBuiltin ? `官方 v${currentSkill.version} · 可发 v${currentSkill.version + 1}` : `当前 v${currentSkill.version}`}
              </span>
            </div>
            <div className="wf-card-body" style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              {currentSkill.isBuiltin ? (
                <div className="wf-field-hint">
                  官方 v{currentSkill.version} 保持只读：调优结果将派生为团队配方 v{currentSkill.version + 1}，官方版本不变；如需保留独立分支也可「另存为全新 Skill」。
                </div>
              ) : null}
              <label className="wf-field">
                <span className="wf-label">版本变更说明（记入版本历史）</span>
                <input
                  className="wf-input wf-input-sm"
                  value={changeNote}
                  onChange={(event) => setChangeNote(event.target.value)}
                  placeholder="例如：强化前3秒冲突与口语节奏"
                />
              </label>
              {showForkInput ? (
                <label className="wf-field">
                  <span className="wf-label">全新 Skill 名称</span>
                  <input
                    className="wf-input wf-input-sm"
                    value={saveAsName}
                    onChange={(event) => setSaveAsName(event.target.value)}
                    placeholder={`${currentSkill.name} · 调优版`}
                  />
                </label>
              ) : null}
              <div className="wf-proposal-actions" style={{ flexDirection: currentSkill.isBuiltin ? 'column' : undefined, alignItems: 'stretch' }}>
                <button
                  type="button"
                  className="wf-btn wf-btn-success"
                  style={{ flex: '1 1 auto' }}
                  disabled={busy || isSkillSummaryOnly(currentSkill)}
                  onClick={() => void handleCommitNewVersion()}
                >
                  {savingSkill ? <span className="wf-spinner" /> : <AppIcon name="check" className="h-3.5 w-3.5" />}
                  <span>
                    {currentSkill.isBuiltin
                      ? `派生为团队配方 v${currentSkill.version + 1}`
                      : `发布为新版本 (v${currentSkill.version + 1})`}
                  </span>
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="wf-btn wf-btn-subtle"
                    style={{ flex: '1 1 auto' }}
                    disabled={busy}
                    onClick={() => {
                      if (!showForkInput) {
                        setShowForkInput(true)
                      } else {
                        void handleSaveAsCustomSkill()
                      }
                    }}
                  >
                    <AppIcon name="copy" className="h-3.5 w-3.5" />
                    <span>{showForkInput ? '确认另存为全新 Skill' : '另存为全新 Skill'}</span>
                  </button>
                  {showForkInput ? (
                    <button
                      type="button"
                      className="wf-btn wf-btn-ghost wf-btn-sm"
                      disabled={busy}
                      onClick={() => setShowForkInput(false)}
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* 6. Progressive-Disclosure Accordion: Pro Config */}
        {currentSkill ? (
          <div className="wf-accordion">
            <button
              type="button"
              className="wf-accordion-trigger"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((prev) => !prev)}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AppIcon name="settingsHex" className="h-3.5 w-3.5" />
                <span>展开专业配置（System Prompt / Few-Shot / QC Rules）</span>
              </span>
              <AppIcon name={advancedOpen ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
            </button>

            {advancedOpen ? (
              <div className="wf-accordion-body">
                {/* System Prompt */}
                <label className="wf-field">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="wf-label" style={{ marginBottom: 0 }}>System Prompt</span>
                    <span className="wf-field-hint wf-num">{manualPrompt.length} 字</span>
                  </div>
                  <textarea
                    className="wf-textarea wf-mono"
                    rows={8}
                    style={{ fontSize: 11.5 }}
                    value={manualPrompt}
                    onChange={(event) => updateManualProConfig({ prompt: event.target.value })}
                  />
                </label>

                {/* Few-Shot Examples */}
                <div className="wf-dock-section">
                  <div className="wf-dock-section-title">
                    <span>Few-Shot 范例（{manualFewShots.length}）</span>
                    <button
                      type="button"
                      className="wf-btn wf-btn-xs wf-btn-subtle"
                      onClick={() => {
                        const nextFewShots = [
                          ...manualFewShots,
                          { title: `范例 ${manualFewShots.length + 1}`, input: '', output: '' },
                        ]
                        updateManualProConfig({ fewShots: nextFewShots })
                      }}
                    >
                      <AppIcon name="plus" className="h-3 w-3" />
                      <span>添加范例</span>
                    </button>
                  </div>
                  {manualFewShots.length === 0 ? (
                    <div className="wf-field-hint">暂无 Few-Shot 范例，可点击右上角添加示范输入与理想输出。</div>
                  ) : (
                    manualFewShots.map((example, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: 9,
                          borderRadius: 8,
                          border: '1px solid var(--fos-border-soft)',
                          background: 'var(--fos-bg-2)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            className="wf-input wf-input-sm"
                            placeholder="范例标题"
                            value={example.title}
                            onChange={(event) => {
                              const value = event.target.value
                              const nextFewShots = manualFewShots.map((it, i) => (i === idx ? { ...it, title: value } : it))
                              updateManualProConfig({ fewShots: nextFewShots })
                            }}
                          />
                          <button
                            type="button"
                            className="wf-btn wf-btn-icon wf-btn-xs wf-btn-danger"
                            aria-label="删除范例"
                            onClick={() => {
                              const nextFewShots = manualFewShots.filter((_, i) => i !== idx)
                              updateManualProConfig({ fewShots: nextFewShots })
                            }}
                          >
                            <AppIcon name="trash" className="h-3 w-3" />
                          </button>
                        </div>
                        <textarea
                          className="wf-textarea"
                          rows={2}
                          style={{ fontSize: 11.5 }}
                          placeholder="示例输入…"
                          value={example.input}
                          onChange={(event) => {
                            const value = event.target.value
                            const nextFewShots = manualFewShots.map((it, i) => (i === idx ? { ...it, input: value } : it))
                            updateManualProConfig({ fewShots: nextFewShots })
                          }}
                        />
                        <textarea
                          className="wf-textarea"
                          rows={3}
                          style={{ fontSize: 11.5 }}
                          placeholder="期望输出…"
                          value={example.output}
                          onChange={(event) => {
                            const value = event.target.value
                            const nextFewShots = manualFewShots.map((it, i) => (i === idx ? { ...it, output: value } : it))
                            updateManualProConfig({ fewShots: nextFewShots })
                          }}
                        />
                      </div>
                    ))
                  )}
                </div>

                {/* QC Rules */}
                <div className="wf-dock-section">
                  <div className="wf-dock-section-title">
                    <span>质检规则（QC Rules）</span>
                  </div>
                  <div className="wf-field-row">
                    <label className="wf-field">
                      <span className="wf-label">最少镜头数</span>
                      <input
                        className="wf-input wf-input-sm wf-num"
                        type="number"
                        min={1}
                        max={60}
                        placeholder="如 4"
                        value={qcFields.minShots}
                        onChange={(event) => updateManualProConfig({ qcPatch: { minShots: event.target.value } })}
                      />
                    </label>
                    <label className="wf-field">
                      <span className="wf-label">最多镜头数</span>
                      <input
                        className="wf-input wf-input-sm wf-num"
                        type="number"
                        min={1}
                        max={60}
                        placeholder="如 10"
                        value={qcFields.maxShots}
                        onChange={(event) => updateManualProConfig({ qcPatch: { maxShots: event.target.value } })}
                      />
                    </label>
                    <label className="wf-field">
                      <span className="wf-label">最大字数</span>
                      <input
                        className="wf-input wf-input-sm wf-num"
                        type="number"
                        min={20}
                        max={10000}
                        placeholder="如 900"
                        value={qcFields.maxChars}
                        onChange={(event) => updateManualProConfig({ qcPatch: { maxChars: event.target.value } })}
                      />
                    </label>
                    <label className="wf-field">
                      <span className="wf-label">单镜最大秒数</span>
                      <input
                        className="wf-input wf-input-sm wf-num"
                        type="number"
                        min={2}
                        max={30}
                        placeholder="如 8"
                        value={qcFields.maxShotDur}
                        onChange={(event) => updateManualProConfig({ qcPatch: { maxShotDur: event.target.value } })}
                      />
                    </label>
                  </div>
                  <label className="wf-field">
                    <span className="wf-label">必含关键词（逗号分隔）</span>
                    <input
                      className="wf-input wf-input-sm"
                      value={qcFields.required}
                      onChange={(event) => updateManualProConfig({ qcPatch: { required: event.target.value } })}
                      placeholder="例如：特写, 景深"
                    />
                  </label>
                  <label className="wf-field">
                    <span className="wf-label">禁用词（逗号分隔）</span>
                    <input
                      className="wf-input wf-input-sm"
                      value={qcFields.forbidden}
                      onChange={(event) => updateManualProConfig({ qcPatch: { forbidden: event.target.value } })}
                      placeholder="例如：水印, 低画质"
                    />
                  </label>
                  <label className="wf-field">
                    <span className="wf-label">质检清单（每行一条）</span>
                    <textarea
                      className="wf-textarea"
                      rows={3}
                      style={{ fontSize: 11.5 }}
                      value={qcFields.checklist}
                      onChange={(event) => updateManualProConfig({ qcPatch: { checklist: event.target.value } })}
                      placeholder="每行一条硬性检查要点…"
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="wf-btn wf-btn-xs wf-btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      setManualPrompt(currentSkill.systemPrompt || '')
                      setManualFewShots(Array.isArray(currentSkill.fewShotExamples) ? currentSkill.fewShotExamples : [])
                      setQcFields(qcFieldsFromRules(currentSkill.qcRules))
                      setProposal(null)
                      setActiveDraftPatch(null)
                    }}
                  >
                    <AppIcon name="undo" className="h-3 w-3" />
                    <span>恢复当前版本</span>
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn-sm wf-btn-stage"
                    disabled={busy || !runId || !itemId || !manualPrompt.trim()}
                    onClick={() => void handleManualTrial()}
                  >
                    {trialRunning ? <span className="wf-spinner" /> : <AppIcon name="play" className="h-3.5 w-3.5" />}
                    <span>试跑手改配置</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Footer status */}
      <div className="wf-dock-foot">
        <span className="wf-field-hint">
          仅管理员可见 · 试跑锁定上游且不污染已存数据
        </span>
        {trialActive ? (
          <span className="wf-badge is-accent">A/B 对比中</span>
        ) : null}
      </div>
    </aside>
  )
}
