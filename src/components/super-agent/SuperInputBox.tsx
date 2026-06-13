/**
 * Super Input Box - 智能视频制作输入框
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { AlertCircle, CheckCircle2, Loader2, Send } from '@/components/ui/icons'
import type {
  AgentExecutionMode,
  AgentExecutionPlan,
  AgentExecutionResult,
} from '@/lib/super-agent/types'
import {
  clearSuperAgentNavigationLock,
  setSuperAgentNavigationLock,
} from '@/lib/super-agent/navigation-lock'
import { normalizeAgentWorkspaceVideoUrl } from '@/lib/super-agent/workspace-url'

interface SuperInputBoxProps {
  locale: string
  placeholder?: string
  initialInput?: string
  targetProjectId?: string
  autoExecute?: boolean
  autoStart?: boolean
  resumeActiveRun?: boolean
  planOverrides?: {
    videoRatio?: '9:16' | '16:9' | '1:1'
    artStyle?: string
    artStylePrompt?: string | null
  }
}

type SuperInputStatus = 'idle' | 'planning' | 'executing'

type AgentRunListItem = {
  id?: string
  status?: string
  createdAt?: string
  errorMessage?: string | null
  input?: {
    userInput?: string
    selectedSkill?: string
    skillDescription?: string
    projectConfig?: {
      videoRatio?: string
      artStyle?: string
      artStylePrompt?: string
    }
  }
  output?: Partial<AgentExecutionResult> & {
    executionId?: string
    projectId?: string
    episodeId?: string
    workspaceUrl?: string
    summary?: string
    errors?: string[]
    stageResults?: AgentExecutionResult['stageResults']
  }
}

type AgentRunListPayload = {
  runs?: AgentRunListItem[]
}

type AgentExecutePayload =
  | { result: AgentExecutionResult }
  | { async: true; status: 'accepted'; targetProjectId?: string | null; runId?: string | null; taskId?: string | null }

type AgentRunStep = {
  stepKey: string
  stepTitle: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | string
  stepIndex: number
  stepTotal: number
  lastErrorMessage?: string | null
}

type AgentRunEvent = {
  seq: number
  eventType: string
  stepKey?: string | null
  payload?: Record<string, unknown> | null
}

type AgentRunArtifact = {
  stepKey?: string | null
  artifactType: string
  payload?: Record<string, unknown> | null
}

type AgentRunSnapshot = {
  run?: AgentRunListItem
  steps?: AgentRunStep[]
  events?: AgentRunEvent[]
  artifacts?: AgentRunArtifact[]
}

function toRecoveredAgentResult(run: AgentRunListItem): AgentExecutionResult | null {
  const output = run.output
  if (run.status !== 'completed' || !output) return null
  if (!output.projectId || !output.episodeId || !output.workspaceUrl) return null

  return {
    executionId: output.executionId || `recovered_${Date.now()}`,
    projectId: output.projectId,
    episodeId: output.episodeId,
    workspaceUrl: normalizeAgentWorkspaceVideoUrl(output.workspaceUrl, output.episodeId),
    status: output.status === 'partial' || output.status === 'failed' ? output.status : 'completed',
    stageResults: output.stageResults || {
      stage1: {
        projectId: output.projectId,
        episodeId: output.episodeId,
        hasStory: true,
      },
    },
    summary: output.summary || '后台 Agent 制作已完成。',
    errors: Array.isArray(output.errors) ? output.errors : [],
  }
}

function normalizeAgentResultWorkspaceUrl(result: AgentExecutionResult): AgentExecutionResult {
  return {
    ...result,
    workspaceUrl: normalizeAgentWorkspaceVideoUrl(result.workspaceUrl, result.episodeId),
  }
}

export function SuperInputBox({
  locale,
  placeholder,
  initialInput = '',
  targetProjectId,
  autoExecute = false,
  autoStart = false,
  resumeActiveRun = false,
  planOverrides,
}: SuperInputBoxProps) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoStartTriggered = useRef(false)
  const [input, setInput] = useState(initialInput)
  const executionMode: AgentExecutionMode = 'live'
  const [status, setStatus] = useState<SuperInputStatus>('idle')
  const [plan, setPlan] = useState<AgentExecutionPlan | null>(null)
  const [result, setResult] = useState<AgentExecutionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runSnapshot, setRunSnapshot] = useState<AgentRunSnapshot | null>(null)
  const [executionStartedAt, setExecutionStartedAt] = useState<string | null>(null)
  const [acceptedRunId, setAcceptedRunId] = useState<string | null>(null)
  const userEnteredWorkspaceRef = useRef(false)
  const agentTextStoryboardParameters = {
    storyboardOnly: true,
    narration: 'off' as const,
  }

  const scheduleFinalNavigation = (workspaceUrl: string, delayMs: number) => {
    window.setTimeout(() => {
      if (userEnteredWorkspaceRef.current) return
      clearSuperAgentNavigationLock(targetProjectId)
      router.push(workspaceUrl)
    }, delayMs)
  }

  const findLatestEpisodeIdFromSnapshot = (snapshot: AgentRunSnapshot | null): string | null => {
    if (!snapshot) return null
    const outputEpisodeId = snapshot.run?.output?.episodeId
    if (typeof outputEpisodeId === 'string' && outputEpisodeId.trim()) return outputEpisodeId.trim()

    const values: unknown[] = []
    for (const artifact of snapshot.artifacts || []) {
      values.push(artifact.payload?.episodeId)
      const details = readSnapshotRecord(artifact.payload?.details)
      if (details) values.push(details.episodeId)
    }
    for (const event of snapshot.events || []) {
      values.push(event.payload?.episodeId)
      const details = readSnapshotRecord(event.payload?.details)
      if (details) values.push(details.episodeId)
    }

    for (const value of values) {
      const episodeId = readSnapshotString(value)
      if (episodeId) return episodeId
    }
    return null
  }

  const inferWorkspacePreviewStage = (snapshot: AgentRunSnapshot | null): 'config' | 'assets' | 'storyboard' | 'videos' => {
    const latestRunningStep = snapshot?.steps?.find((step) => (
      step.status === 'running' || step.status === 'queued'
    ))
    const stepKey = latestRunningStep?.stepKey || ''
    if (/stage_7/.test(stepKey)) return 'videos'
    if (/stage_5|stage_6/.test(stepKey)) return 'storyboard'
    if (/stage_3|stage_4/.test(stepKey)) return 'assets'
    return 'config'
  }

  const buildWorkspacePreviewUrl = () => {
    const projectId = result?.projectId || targetProjectId
    if (!projectId) return null
    const episodeId = result?.episodeId || findLatestEpisodeIdFromSnapshot(runSnapshot)
    const searchParams = new URLSearchParams({
      stage: inferWorkspacePreviewStage(runSnapshot),
      agentPreview: '1',
    })
    if (episodeId) searchParams.set('episode', episodeId)
    return `/${locale}/workspace/${projectId}?${searchParams.toString()}`
  }

  const handleEnterWorkspacePreview = () => {
    const previewUrl = buildWorkspacePreviewUrl()
    if (!previewUrl) return
    userEnteredWorkspaceRef.current = true
    router.push(previewUrl)
  }

  useEffect(() => {
    if (status !== 'idle') return
    setInput(initialInput)
  }, [initialInput, status])

  useEffect(() => {
    if (!resumeActiveRun || !targetProjectId || status !== 'idle' || result || error) return
    setSuperAgentNavigationLock(targetProjectId)
    setError(null)
    setRunSnapshot(null)
    setAcceptedRunId(null)
    setExecutionStartedAt(null)
    setStatus('executing')
  }, [error, resumeActiveRun, result, status, targetProjectId])

  const readErrorMessage = async (response: Response, fallback: string) => {
    try {
      const errorData = await response.json()
      return errorData?.error?.message || fallback
    } catch {
      return fallback
    }
  }

  const waitForRecoveredResult = async (): Promise<AgentExecutionResult | null> => {
    if (acceptedRunId) {
      const detailResponse = await fetch(`/api/runs/${acceptedRunId}`, { cache: 'no-store' })
      if (detailResponse.ok) {
        const snapshot = await detailResponse.json() as AgentRunSnapshot
        if (snapshot.run) {
          const recovered = toRecoveredAgentResult(snapshot.run)
          if (recovered) return recovered
          if (snapshot.run.status === 'failed' || snapshot.run.status === 'canceled') {
            throw new Error(snapshot.run.errorMessage || '执行失败')
          }
        }
      }
    }
    if (!targetProjectId) return null

    const params = new URLSearchParams({
      projectId: targetProjectId,
      workflowType: 'super_agent_creation',
      targetType: 'project',
      targetId: targetProjectId,
      limit: '1',
    })

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000))
      }

      const response = await fetch(`/api/runs?${params.toString()}`)
      if (!response.ok) continue
      const payload = await response.json() as AgentRunListPayload
      const latestRun = payload.runs?.[0]
      if (!latestRun) continue

      const recovered = toRecoveredAgentResult(latestRun)
      if (recovered) return recovered

      if (latestRun.status === 'failed' || latestRun.status === 'canceled') {
        throw new Error(latestRun.errorMessage || '执行失败')
      }
    }

    return null
  }

  const fetchLatestAgentRunSnapshot = async (startedAfter?: string | null): Promise<AgentRunSnapshot | null> => {
    if (acceptedRunId) {
      const detailResponse = await fetch(`/api/runs/${acceptedRunId}`, { cache: 'no-store' })
      if (!detailResponse.ok) return null
      return await detailResponse.json() as AgentRunSnapshot
    }
    if (!targetProjectId) return null

    const params = new URLSearchParams({
      projectId: targetProjectId,
      workflowType: 'super_agent_creation',
      targetType: 'project',
      targetId: targetProjectId,
      limit: '1',
    })
    const listResponse = await fetch(`/api/runs?${params.toString()}`, { cache: 'no-store' })
    if (!listResponse.ok) return null
    const payload = await listResponse.json() as AgentRunListPayload
    const latestRun = payload.runs?.[0]
    if (!latestRun?.id) return null
    if (startedAfter && latestRun.createdAt && latestRun.createdAt < startedAfter) return null

    const detailResponse = await fetch(`/api/runs/${latestRun.id}`, { cache: 'no-store' })
    if (!detailResponse.ok) return { run: latestRun }
    return await detailResponse.json() as AgentRunSnapshot
  }

  const applyPlanOverrides = (nextPlan: AgentExecutionPlan): AgentExecutionPlan => {
    if (!planOverrides) return nextPlan

    return {
      ...nextPlan,
      projectConfig: {
        ...nextPlan.projectConfig,
        ...(planOverrides.videoRatio ? { videoRatio: planOverrides.videoRatio } : {}),
        ...(planOverrides.artStyle ? { artStyle: planOverrides.artStyle } : {}),
        ...(planOverrides.artStylePrompt ? { artStylePrompt: planOverrides.artStylePrompt } : {}),
      },
    }
  }

  const executePlan = async (planToExecute: AgentExecutionPlan) => {
    setSuperAgentNavigationLock(targetProjectId)
    setStatus('executing')
    setError(null)
    setRunSnapshot(null)
    setAcceptedRunId(null)
    userEnteredWorkspaceRef.current = false
    setExecutionStartedAt(new Date(Date.now() - 5000).toISOString())

    try {
      const response = await fetch('/api/super-agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planToExecute,
          userInput: input.trim(),
          locale,
          executionMode: planToExecute.executionMode,
          targetProjectId,
          responseMode: targetProjectId ? 'background' : 'sync',
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '执行失败'))
      }

      const data = await response.json() as AgentExecutePayload
      if ('async' in data && data.async) {
        if (data.runId) setAcceptedRunId(data.runId)
        return
      }
      if (!('result' in data)) {
        throw new Error('执行响应缺少结果')
      }
      const resultData = normalizeAgentResultWorkspaceUrl(data.result)
      setResult(resultData)
      setStatus('idle')

      scheduleFinalNavigation(resultData.workspaceUrl, autoExecute ? 500 : 2000)
    } catch (err) {
      try {
        const recovered = await waitForRecoveredResult()
        if (recovered) {
          setResult(recovered)
          setStatus('idle')
          scheduleFinalNavigation(recovered.workspaceUrl, autoExecute ? 500 : 1000)
          return
        }
      } catch (recoveryError) {
        setStatus('idle')
        setError(recoveryError instanceof Error ? recoveryError.message : '执行失败，请重试')
        return
      }

      setStatus('idle')
      setError(err instanceof Error ? err.message : '执行失败，请重试')
    }
  }

  const handleSubmit = async () => {
    if (!input.trim() || status !== 'idle') return

    setSuperAgentNavigationLock(targetProjectId)
    setStatus('planning')
    setError(null)
    setResult(null)
    userEnteredWorkspaceRef.current = false

    try {
      const response = await fetch('/api/super-agent/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: input.trim(),
          locale,
          executionMode,
          parameters: agentTextStoryboardParameters,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '规划失败'))
      }

      const data = await response.json() as { plan: AgentExecutionPlan }
      const nextPlan = applyPlanOverrides(data.plan)
      setPlan(nextPlan)
      await executePlan(nextPlan)
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : '规划失败，请重试')
    }
  }

  useEffect(() => {
    const initialAutoStartInput = initialInput.trim()
    if (
      !autoStart
      || autoStartTriggered.current
      || status !== 'idle'
      || !initialAutoStartInput
      || input.trim() !== initialAutoStartInput
    ) return
    autoStartTriggered.current = true
    const timer = window.setTimeout(() => {
      void handleSubmit()
    }, 0)
    return () => window.clearTimeout(timer)
    // handleSubmit intentionally reads the latest render state for this one-shot auto start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, initialInput, input, status])

  useEffect(() => {
    if (status !== 'executing' || !targetProjectId) return
    let stopped = false
    let timer: number | null = null

    const poll = async () => {
      try {
        const snapshot = await fetchLatestAgentRunSnapshot(executionStartedAt)
        if (!stopped && snapshot) {
          setRunSnapshot(snapshot)
        } else if (!stopped && executionStartedAt) {
          const startedMs = Date.parse(executionStartedAt)
          if (Number.isFinite(startedMs) && Date.now() - startedMs > 90_000) {
            setStatus('idle')
            setError('后台 Agent 任务没有创建运行记录，请重新启动 Agent 自动创作。')
            stopped = true
            return
          }
        }
      } catch {
        // The execution request is still authoritative; polling is only for UI progress.
      }

      if (!stopped) {
        timer = window.setTimeout(poll, 2500)
      }
    }

    void poll()

    return () => {
      stopped = true
      if (timer !== null) window.clearTimeout(timer)
    }
    // fetchLatestAgentRunSnapshot intentionally reads the latest target project, run id and start time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, targetProjectId, executionStartedAt, acceptedRunId])

  useEffect(() => {
    if (status !== 'executing' || !runSnapshot?.run) return
    const recovered = toRecoveredAgentResult(runSnapshot.run)
      if (!recovered) {
        if (runSnapshot.run.status === 'failed' || runSnapshot.run.status === 'canceled') {
          setStatus('idle')
          setError(runSnapshot.run.errorMessage || '执行失败，请重试')
        }
        return
    }

    setResult(recovered)
    setStatus('idle')
    scheduleFinalNavigation(recovered.workspaceUrl, autoExecute ? 500 : 1000)
  }, [autoExecute, runSnapshot, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  const isAgentRunning = status === 'planning' || status === 'executing'
  const workspacePreviewUrl = buildWorkspacePreviewUrl()

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div>
        <div className="relative rounded-[26px] border border-[rgba(14,14,44,.08)] bg-[#fafcfe]/90 p-4 shadow-[0_22px_54px_rgba(14,14,44,.095),0_4px_12px_rgba(14,14,44,.055)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(14,14,44,.08)] bg-white/84 px-3 py-2 shadow-[0_1px_2px_rgba(14,14,44,.035),0_1px_5px_rgba(14,14,44,.025)]">
              <Image
                src="/nori-view/nori-onion-logo.png"
                alt="Nori"
                width={24}
                height={24}
                className="h-6 w-6 rounded-lg object-contain"
              />
              <span className="text-sm font-bold text-[#0e0e2c]">Nori Agent</span>
            </div>
            <span className="rounded-full bg-[#EFEFFD] px-3 py-1 text-xs font-semibold text-[#4B4DED]">
              Workflow
            </span>
          </div>
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder || '描述你想要的视频...'}
              className="h-36 w-full resize-none p-5 pr-16 text-base leading-relaxed transition-all duration-200 placeholder:text-[#8c8ca1]"
              style={{
                background: '#ffffff',
                color: '#0e0e2c',
                border: '1px solid rgba(14,14,44,.10)',
                borderRadius: '22px',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.92), 0 12px 28px rgba(14,14,44,.055)',
                outline: 'none',
              }}
              disabled={status !== 'idle'}
            />
            <button
              onClick={() => void handleSubmit()}
              disabled={status !== 'idle' || !input.trim()}
              className="absolute bottom-4 right-4 rounded-full p-3 transition-all duration-200"
              style={{
                background: status === 'idle' && input.trim()
                  ? '#D6FF00'
                  : '#ECF1F4',
                color: '#0e0e2c',
                border: '1px solid rgba(14,14,44,.10)',
                boxShadow: status === 'idle' && input.trim() ? '0 7px 18px rgba(14,14,44,.08), inset 0 -1px 0 rgba(14,14,44,.10)' : 'none',
                opacity: status !== 'idle' || !input.trim() ? 0.5 : 1,
                cursor: status !== 'idle' || !input.trim() ? 'not-allowed' : 'pointer',
              }}
              title="提交"
            >
              {status === 'planning' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {error && <SuperErrorPanel message={error} />}

        {result && <SuperResultPanel result={result} />}
      </div>

      {isAgentRunning && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#f4f7fa]/78 px-4 py-6 backdrop-blur-md">
          <div className="h-[min(760px,calc(100vh-48px))] w-full max-w-5xl overflow-hidden rounded-[28px] border border-[rgba(214,255,0,.75)] bg-[#fafcfe] shadow-[0_28px_80px_rgba(14,14,44,.20),0_6px_18px_rgba(14,14,44,.08)]">
            <SuperExecutingPanel
              plan={plan}
              runSnapshot={runSnapshot}
              phase={status}
              layout="modal"
              workspacePreviewUrl={workspacePreviewUrl}
              onEnterWorkspace={handleEnterWorkspacePreview}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SuperErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="mt-4 p-4 flex items-start gap-3"
      style={{
        background: 'var(--glass-tone-danger-bg)',
        border: '1px solid var(--glass-stroke-danger)',
        borderRadius: 'var(--glass-radius-md)',
      }}
    >
      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--glass-tone-danger-fg)' }} />
      <div className="flex-1">
        <p className="text-sm" style={{ color: 'var(--glass-tone-danger-fg)' }}>{message}</p>
      </div>
    </div>
  )
}

function readSnapshotString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readSnapshotNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readSnapshotRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function clipStageText(value: string | null | undefined, max = 120): string | null {
  if (!value) return null
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return null
  return Array.from(compact).length > max
    ? `${Array.from(compact).slice(0, max).join('')}...`
    : compact
}

function buildStageMetricLabels(details: Record<string, unknown> | null): string[] {
  if (!details) return []
  const specs: Array<[string, string]> = [
    ['characterCount', '角色'],
    ['locationCount', '场景'],
    ['propCount', '道具'],
    ['clipCount', '片段'],
    ['storyboardCount', '分镜板'],
    ['panelCount', '分镜'],
    ['voiceLineCount', '台词'],
    ['characterAppearanceCount', '角色图槽'],
    ['locationImageCount', '场景图槽'],
    ['propImageCount', '道具图槽'],
    ['submittedTaskCount', '已提交任务'],
    ['completedTaskCount', '已完成任务'],
    ['failedTaskCount', '失败任务'],
    ['pendingTaskCount', '待结束任务'],
    ['processingTaskCount', '处理中任务'],
    ['queuedTaskCount', '排队任务'],
    ['averageProgress', '任务平均进度'],
    ['skippedExistingImageCount', '已有图片'],
    ['skippedExistingVideoCount', '已有视频'],
    ['skippedMissingImageCount', '缺图片分镜'],
  ]
  const labels: string[] = []
  for (const [key, label] of specs) {
    const value = readSnapshotNumber(details[key])
    if (value === null) continue
    labels.push(`${label} ${value}`)
  }
  return labels.slice(0, 6)
}

function readBooleanLabel(value: unknown, truthy: string, falsy: string): string | null {
  if (value === true) return truthy
  if (value === false) return falsy
  return null
}

function buildLiveArtifactSummary(params: {
  stageId?: string
  stageNumber?: number
  details: Record<string, unknown> | null
}): string[] {
  const { details } = params
  if (!details) return []
  const stageKey = params.stageId || `stage_${params.stageNumber || ''}`
  const line = (value: string | null | undefined) => value && value.trim() ? value.trim() : null
  const number = (key: string) => readSnapshotNumber(details[key])
  const bool = (key: string, truthy: string, falsy: string) => readBooleanLabel(details[key], truthy, falsy)
  const taskLine = () => {
    const submitted = number('submittedTaskCount')
    const completed = number('completedTaskCount')
    const failed = number('failedTaskCount')
    const processing = number('processingTaskCount')
    const queued = number('queuedTaskCount')
    const averageProgress = number('averageProgress')
    if (submitted === null && completed === null && failed === null) return null
    return `任务进度：提交 ${submitted ?? 0}，完成 ${completed ?? 0}，失败 ${failed ?? 0}，处理中 ${processing ?? 0}，排队 ${queued ?? 0}${averageProgress !== null ? `，平均 ${averageProgress}%` : ''}`
  }

  const summaries: Array<string | null> = []
  if (stageKey === 'stage_1') {
    summaries.push(
      line(details.projectId ? `项目已绑定：${String(details.projectId)}` : null),
      line(details.episodeId ? `剧集已准备：${String(details.episodeId)}` : null),
      bool('hasStory', '故事包已写入第一集', '故事包尚未写入'),
    )
  } else if (stageKey === 'stage_2') {
    summaries.push(
      line(`剧本拆分：${number('clipCount') ?? 0} 个剧情片段`),
      line(`资产候选：${number('characterCount') ?? 0} 个角色、${number('locationCount') ?? 0} 个场景、${number('propCount') ?? 0} 个道具`),
      bool('hasScript', 'screenplay 已生成', 'screenplay 尚未完成'),
    )
  } else if (stageKey === 'stage_3') {
    summaries.push(
      line(`资产锁定：${number('characterCount') ?? 0} 个角色、${number('locationCount') ?? 0} 个场景、${number('propCount') ?? 0} 个道具`),
      line(`参考图槽：角色 ${number('characterAppearanceCount') ?? 0}、场景 ${number('locationImageSlotCount') ?? 0}、道具 ${number('propImageSlotCount') ?? 0}`),
      bool('hasConsistencyBrief', '资产 critic 简报已写入', '资产 critic 简报未写入'),
    )
  } else if (stageKey === 'stage_4') {
    summaries.push(
      line(`资产图槽：角色 ${number('characterAppearanceCount') ?? 0}、场景 ${number('locationImageCount') ?? 0}、道具 ${number('propImageCount') ?? 0}`),
      taskLine(),
      bool('hasAssetImages', '全局资产参考图已齐备', '仍有资产参考图待生成'),
    )
  } else if (stageKey === 'stage_5') {
    summaries.push(
      line(`分镜产物：${number('storyboardCount') ?? 0} 个分镜板、${number('panelCount') ?? 0} 个 panel`),
      line(`台词/动作结构：${number('voiceLineCount') ?? 0} 条配音行或台词线索`),
      bool('hasStoryboard', '分镜和 video_prompt 已落库', '分镜尚未完全落库'),
    )
  } else if (stageKey === 'stage_6') {
    summaries.push(
      line(`视频资产引用：${number('panelCount') ?? 0} 个 panel`),
      taskLine(),
      details.skippedByAgentSeedanceDirectVideo === true
        ? '已跳过分镜图生成，Seedance 将用资产参考图直出视频'
        : bool('hasImages', '分镜图已齐备，可进入视频生成', '仍有分镜图待生成'),
    )
  } else if (stageKey === 'stage_7') {
    summaries.push(
      line(`视频覆盖：${number('panelCount') ?? 0} 个 panel，缺输入图跳过 ${number('skippedMissingImageCount') ?? 0}`),
      taskLine(),
      bool('hasVideos', '成片片段已齐备', '仍有视频片段待生成或失败'),
      details.skippedMissingVideoModel === true ? '视频模型未配置，视频生成被跳过' : null,
    )
  }

  return summaries.filter((item): item is string => Boolean(item)).slice(0, 4)
}

function normalizeStageStatus(status: string | undefined): AgentExecutionPlan['stages'][number]['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'canceled') return 'failed'
  if (status === 'running') return 'running'
  return 'pending'
}

type AgentStageInsight = {
  modelAction: string
  analyzing: string
  output: string
  qualityGate: string
}

const AGENT_STAGE_INSIGHTS: Record<string, AgentStageInsight> = {
  stage_1: {
    modelAction: '系统准备创作上下文',
    analyzing: '读取 prompt、画幅、风格、创作模式和项目配置，建立可编辑工作区。',
    output: '项目、第一集、Agent 故事包和后续任务上下文。',
    qualityGate: '保留原始 prompt，不丢失画幅、风格、语言、字幕和音乐约束。',
  },
  stage_2: {
    modelAction: '文本模型按手动智能创作标准扩写故事并拆剧本',
    analyzing: '先把短 prompt 扩写成可拍摄故事，再拆成剧情片段、screenplay、角色、场景和道具候选。',
    output: '扩写后的故事文本、剧情片段、角色资产候选、场景资产候选和台词/动作结构。',
    qualityGate: '普通故事不能生成卖点；商业需求才允许卖点；中文故事使用中国语境，英文/欧美故事使用国外语境。',
  },
  stage_3: {
    modelAction: '资产 critic 核对一致性',
    analyzing: '逐项检查角色、场景、道具是否真的来自剧情，是否影响连续性，是否符合地域和风格。',
    output: '全局资产一致性简报，锁定后续视频提示词和 Seedance 参考图必须复用的资产。',
    qualityGate: '删除无关背景物，补齐缺失核心资产，避免角色串脸、场景错区和道具漂移。',
  },
  stage_4: {
    modelAction: '图像模型生成全局资产参考',
    analyzing: '为角色形象、场景空间和关键道具生成参考图槽，先建立全片视觉一致性。',
    output: '角色参考图、场景参考图、道具/商品参考图任务。',
    qualityGate: '资产图只定义外观和空间规则，不提前生成具体分镜动作。',
  },
  stage_5: {
    modelAction: '文本模型生成分镜与视频提示词',
    analyzing: '按剧情片段生成分镜，每个分镜写清场景、人物站位、镜头语言、按秒动作/对白和负面要求。',
    output: '可编辑分镜板、分镜格、绑定资产、video_prompt 和推荐时长。',
    qualityGate: '每个 video_prompt 必须清楚说明哪个角色做了什么、说了什么台词，并引用已锁定资产。',
  },
  stage_6: {
    modelAction: '系统准备 Seedance 参考资产',
    analyzing: '检查每个 panel 的 video_prompt 是否绑定角色、场景、道具资产，并为视频任务收集 reference_image。',
    output: '每个 panel 的视频提示词、推荐时长和资产参考图列表。',
    qualityGate: '不生成中间分镜图；视频必须直接使用已锁定资产参考图，不替换角色和场景。',
  },
  stage_7: {
    modelAction: '视频模型生成成片片段',
    analyzing: '把 video_prompt 作为 text，并把角色、场景、道具资产作为 reference_image，提交 Seedance 视频生成。',
    output: '每个 panel 的视频任务、视频结果和可进入成片总览的项目状态。',
    qualityGate: '视频使用资产参考图，不漏台词，不改人物行为，不把时长固定成无脑 2 秒。',
  },
}

const FALLBACK_AGENT_WORKFLOW_STAGES: AgentExecutionPlan['stages'] = [
  {
    stageId: 'stage_1',
    stageNumber: 1,
    title: '项目初始化',
    description: '创建项目和剧集，保留 prompt、画幅、风格和语言约束。',
    estimatedDuration: 5,
    status: 'pending',
  },
  {
    stageId: 'stage_2',
    stageNumber: 2,
    title: '故事扩写与剧本锁定',
    description: '按手动智能创作标准扩写故事、拆剧情片段，并抽取角色、场景和道具资产。',
    estimatedDuration: 120,
    status: 'pending',
  },
  {
    stageId: 'stage_3',
    stageNumber: 3,
    title: '资产一致性核对',
    description: '用 critic 核对资产是否符合 prompt 意图、地域语境和故事连续性。',
    estimatedDuration: 20,
    status: 'pending',
  },
  {
    stageId: 'stage_4',
    stageNumber: 4,
    title: '资产图生成',
    description: '为全局角色、场景和道具生成一致性参考图。',
    estimatedDuration: 600,
    status: 'pending',
  },
  {
    stageId: 'stage_5',
    stageNumber: 5,
    title: '精细分镜生成',
    description: '按剧情片段生成多 panel 分镜、资产绑定、按秒动作/对白和视频提示词。',
    estimatedDuration: 180,
    status: 'pending',
  },
  {
    stageId: 'stage_6',
    stageNumber: 6,
    title: '视频资产引用准备',
    description: '检查每个 panel 的 video_prompt，并绑定角色、场景、道具参考图。',
    estimatedDuration: 30,
    status: 'pending',
  },
  {
    stageId: 'stage_7',
    stageNumber: 7,
    title: '视频生成',
    description: '用 video_prompt 作为 text，资产图作为 reference_image，按推荐时长生成成片片段。',
    estimatedDuration: 1200,
    status: 'pending',
  },
]

function getStageInsight(stageId: string, stageNumber: number): AgentStageInsight {
  return AGENT_STAGE_INSIGHTS[stageId] || AGENT_STAGE_INSIGHTS[`stage_${stageNumber}`] || {
    modelAction: 'Agent 正在处理该阶段',
    analyzing: '读取当前阶段输入和上游产物，生成下一步可编辑内容。',
    output: '阶段产物和运行记录。',
    qualityGate: '保持和 prompt、资产、分镜连续性一致。',
  }
}

function SuperExecutingPanel({
  plan,
  runSnapshot,
  phase,
  layout = 'full',
  workspacePreviewUrl,
  onEnterWorkspace,
}: {
  plan: AgentExecutionPlan | null
  runSnapshot: AgentRunSnapshot | null
  phase: SuperInputStatus
  layout?: 'full' | 'side' | 'modal'
  workspacePreviewUrl?: string | null
  onEnterWorkspace?: () => void
}) {
  const isModal = layout === 'modal'
  const stages = plan?.stages?.length
    ? plan.stages
    : FALLBACK_AGENT_WORKFLOW_STAGES
  const [activeIndex, setActiveIndex] = useState(0)
  const stageArtifacts = runSnapshot?.artifacts?.filter((artifact) => (
    artifact.artifactType === 'agent.stage.progress'
    || artifact.artifactType === 'agent.stage.error'
  )) || []
  const latestEventByStep = new Map<string, AgentRunEvent>()
  for (const event of runSnapshot?.events || []) {
    const key = event.stepKey || readSnapshotString(event.payload?.stepId)
    if (key) latestEventByStep.set(key, event)
  }
  const stepByKey = new Map((runSnapshot?.steps || []).map((step) => [step.stepKey, step]))
  const artifactByStep = new Map<string, AgentRunArtifact>()
  for (const artifact of stageArtifacts) {
    if (artifact.stepKey) artifactByStep.set(artifact.stepKey, artifact)
  }
  const liveStages = stages.map((stage, index) => {
    const step = stepByKey.get(stage.stageId)
    const artifact = artifactByStep.get(stage.stageId)
    const event = latestEventByStep.get(stage.stageId)
    const payload = artifact?.payload || event?.payload || {}
    const percent = readSnapshotNumber(payload.percent)
    const message = readSnapshotString(payload.message)
      || readSnapshotString(payload.errorMessage)
      || step?.lastErrorMessage
      || stage.description
    const details = readSnapshotRecord(payload.details)
    return {
      ...stage,
      stageNumber: stage.stageNumber || index + 1,
      title: step?.stepTitle || stage.title,
      status: normalizeStageStatus(readSnapshotString(payload.status) || step?.status || stage.status),
      percent,
      message,
      details,
    }
  })
  const hasLiveProgress = !!runSnapshot?.run || (runSnapshot?.steps?.length || 0) > 0 || stageArtifacts.length > 0

  useEffect(() => {
    if (hasLiveProgress) return
    const timer = window.setInterval(() => {
      setActiveIndex((current) => Math.min(stages.length - 1, current + 1))
    }, 4200)
    return () => window.clearInterval(timer)
  }, [hasLiveProgress, stages.length])

  const liveActiveIndex = liveStages.findIndex((stage) => stage.status === 'running')
  const firstPendingIndex = liveStages.findIndex((stage) => stage.status === 'pending')
  const resolvedActiveIndex = hasLiveProgress
    ? (liveActiveIndex >= 0 ? liveActiveIndex : (firstPendingIndex >= 0 ? firstPendingIndex : liveStages.length - 1))
    : activeIndex
  const activeStage = liveStages[resolvedActiveIndex] || liveStages[0]
  const totalStages = Math.max(1, liveStages.length)
  const completedStageCount = liveStages.filter((stage) => stage.status === 'completed').length
  const stageSpan = 100 / totalStages
  const activeStageStart = Math.max(0, (Math.max(1, activeStage?.stageNumber || resolvedActiveIndex + 1) - 1) * stageSpan)
  const activeStageLocalProgress = typeof activeStage?.percent === 'number'
    ? Math.max(0, Math.min(100, ((activeStage.percent - activeStageStart) / stageSpan) * 100))
    : (activeStage?.status === 'completed' ? 100 : 35)
  const weightedLiveProgress = completedStageCount >= totalStages
    ? 100
    : Math.round(activeStageStart + (activeStageLocalProgress / 100) * stageSpan)
  const fallbackProgress = phase === 'planning'
    ? Math.min(24, Math.max(10, 10 + activeIndex * 2))
    : Math.min(42, Math.max(18, 18 + activeIndex * 4))
  const progress = runSnapshot?.run?.status === 'completed'
    ? 100
    : hasLiveProgress
      ? Math.min(99, Math.max(8, weightedLiveProgress || fallbackProgress))
      : fallbackProgress
  const hasFailed = liveStages.some((stage) => stage.status === 'failed') || runSnapshot?.run?.status === 'failed'
  const activeStageMetrics = buildStageMetricLabels(activeStage?.details || null)
  const activeArtifactSummary = buildLiveArtifactSummary({
    stageId: activeStage?.stageId,
    stageNumber: activeStage?.stageNumber,
    details: activeStage?.details || null,
  })
  const activeInsight = getStageInsight(activeStage?.stageId || '', activeStage?.stageNumber || resolvedActiveIndex + 1)
  const runInput = clipStageText(runSnapshot?.run?.input?.userInput, 150)
  const runStyle = clipStageText(runSnapshot?.run?.input?.projectConfig?.artStylePrompt || runSnapshot?.run?.input?.projectConfig?.artStyle, 90)
  const title = phase === 'planning' ? 'Agent 正在规划创作流程' : 'Agent 自动创作中'
  const phaseMessage = phase === 'planning'
    ? '正在解析 prompt、画幅、风格、角色资产和工作流要求。规划完成后会自动进入执行。'
    : null

  return (
    <div
      className={isModal ? 'flex h-full flex-col' : `${layout === 'side' ? 'mt-0' : 'mt-6'} p-5`}
      style={{
        background: '#fafcfe',
        borderRadius: isModal ? '28px' : '22px',
        border: isModal ? 'none' : '1px solid rgba(214,255,0,.72)',
        boxShadow: isModal ? 'none' : '0 22px 54px rgba(14,14,44,.095), 0 4px 12px rgba(14,14,44,.055)',
      }}
    >
      <div
        className={isModal ? 'shrink-0 border-b border-[rgba(14,14,44,.08)] p-5 sm:p-6' : 'mb-4'}
        style={isModal ? { background: 'rgba(250,252,254,.96)' } : undefined}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-[rgba(14,14,44,.08)] bg-white shadow-sm">
              <Image
                src="/nori-view/nori-onion-logo.png"
                alt="Nori"
                width={28}
                height={28}
                className="h-7 w-7 object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-xl font-semibold" style={{ color: '#0e0e2c' }}>{title}</h3>
                {hasFailed ? (
                  <AlertCircle className="h-4 w-4 shrink-0" style={{ color: 'var(--glass-tone-danger-fg)' }} />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: '#4B4DED' }} />
                )}
              </div>
              <p className="truncate text-sm font-medium" style={{ color: '#7a8491' }}>
                Nori 会先锁定资产，再生成视频提示词，并用资产参考图直出单镜视频。
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onEnterWorkspace && (
              <button
                type="button"
                onClick={onEnterWorkspace}
                disabled={!workspacePreviewUrl}
                className="rounded-full border px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: '#ffffff',
                  borderColor: 'rgba(14,14,44,.10)',
                  color: '#0e0e2c',
                  boxShadow: '0 6px 16px rgba(14,14,44,.06)',
                }}
              >
                进入工作区查看
              </button>
            )}
            <span className="rounded-full bg-[#D6FF00] px-3 py-1 text-xs font-bold text-[#0e0e2c]">
              Live
            </span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm" style={{ color: '#8c8ca1' }}>
              {activeStage?.title || '执行中'}
            </span>
            <span className="text-sm font-medium" style={{ color: '#0e0e2c' }}>{progress}%</span>
          </div>
          <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: '#ECF1F4' }}>
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: hasFailed ? 'var(--glass-tone-danger-fg)' : '#D6FF00' }}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: hasFailed ? 'var(--glass-tone-danger-fg)' : '#6a7280' }}>
            {phaseMessage || activeStage?.message || '正在执行 Agent 工作流。'}
          </p>
          {activeStageMetrics.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeStageMetrics.map((metric) => (
                <span
                  key={metric}
                  className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                  style={{
                    background: '#ffffff',
                    borderColor: 'rgba(14,14,44,.08)',
                    color: '#4f5b68',
                  }}
                >
                  {metric}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={isModal ? 'min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-6' : 'space-y-4'}>
        {activeArtifactSummary.length > 0 && (
          <div className="rounded-[18px] border p-4" style={{ background: '#ffffff', borderColor: 'rgba(14,14,44,.08)' }}>
            <p className="mb-2 text-xs font-bold" style={{ color: '#7a8491' }}>实时产物</p>
            <div className="grid gap-1.5">
              {activeArtifactSummary.map((item) => (
                <p key={item} className="text-sm leading-relaxed" style={{ color: '#384253' }}>
                  {item}
                </p>
              ))}
            </div>
          </div>
        )}
        <div
          className={`grid gap-3 rounded-[18px] border p-4 ${layout === 'side' ? '' : 'md:grid-cols-[1.1fr_.9fr]'}`}
          style={{
            background: '#ffffff',
            borderColor: 'rgba(75,77,237,.16)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.86)',
          }}
        >
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: hasFailed ? 'var(--glass-tone-danger-fg)' : '#4B4DED' }}
              />
              <span className="text-xs font-bold uppercase" style={{ color: '#4B4DED' }}>
                {activeInsight.modelAction}
              </span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: '#243042' }}>
              {activeInsight.analyzing}
            </p>
            <div className={`mt-3 grid gap-2 ${layout === 'side' ? '' : 'sm:grid-cols-2'}`}>
              <div className="rounded-[14px] p-3" style={{ background: '#f4f7fa' }}>
                <p className="mb-1 text-[11px] font-bold" style={{ color: '#7a8491' }}>阶段产物</p>
                <p className="text-xs leading-relaxed" style={{ color: '#384253' }}>{activeInsight.output}</p>
              </div>
              <div className="rounded-[14px] p-3" style={{ background: '#f4f7fa' }}>
                <p className="mb-1 text-[11px] font-bold" style={{ color: '#7a8491' }}>质量检查</p>
                <p className="text-xs leading-relaxed" style={{ color: '#384253' }}>{activeInsight.qualityGate}</p>
              </div>
            </div>
          </div>
          <div className="rounded-[14px] p-3" style={{ background: '#f4f7fa' }}>
            <p className="mb-2 text-[11px] font-bold" style={{ color: '#7a8491' }}>当前创作意图</p>
            <p className="text-xs leading-relaxed" style={{ color: '#384253' }}>
              {runInput || '正在读取 prompt 和项目配置。'}
            </p>
            {runStyle && (
              <p className="mt-2 text-xs leading-relaxed" style={{ color: '#6a7280' }}>
                风格：{runStyle}
              </p>
            )}
          </div>
        </div>
        <div className={`grid gap-2 ${layout === 'side' ? '' : 'md:grid-cols-2'}`}>
          {liveStages.map((stage, index) => {
            const isDone = stage.status === 'completed' || (!hasLiveProgress && index < activeIndex)
            const isActive = stage.status === 'running' || (!hasLiveProgress && index === activeIndex)
            const isFailed = stage.status === 'failed'
            const insight = getStageInsight(stage.stageId, stage.stageNumber)
            return (
              <div
                key={stage.stageId}
                className="rounded-[16px] border p-3 transition-colors"
                style={{
                  background: isActive ? '#ffffff' : '#f4f7fa',
                  borderColor: isFailed
                    ? 'var(--glass-stroke-danger)'
                    : (isActive ? 'rgba(75,77,237,.28)' : 'rgba(14,14,44,.07)'),
                }}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: isFailed ? 'var(--glass-tone-danger-bg)' : (isDone ? '#e0faf4' : (isActive ? '#EFEFFD' : '#ECF1F4')),
                      color: isFailed ? 'var(--glass-tone-danger-fg)' : (isDone ? '#1a957c' : '#4B4DED'),
                    }}
                  >
                    {isFailed ? '!' : (isDone ? '✓' : stage.stageNumber)}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: '#0e0e2c' }}>{stage.title}</span>
                </div>
                <p className="pl-8 text-xs leading-relaxed" style={{ color: '#6a7280' }}>
                  {stage.message || stage.description}
                </p>
                <p className="mt-2 pl-8 text-[11px] leading-relaxed" style={{ color: '#8c8ca1' }}>
                  {insight.modelAction}，{insight.output}
                </p>
              </div>
            )
          })}
        </div>
        <p className="text-xs" style={{ color: '#8c8ca1' }}>
          未进入工作区时，Agent 全部完成后会直接打开成片总览；进入工作区后，后台仍会继续处理并刷新产物。
        </p>
      </div>
    </div>
  )
}

function SuperResultPanel({ result }: { result: AgentExecutionResult }) {
  const scriptItems = result.stageResults.stage2
    ? [
      `发现 ${result.stageResults.stage2.characterCount} 个角色`,
      `发现 ${result.stageResults.stage2.locationCount} 个场景`,
      `生成 ${result.stageResults.stage2.clipCount} 个片段`,
    ]
    : []
  const storyboardItems = result.stageResults.stage3
    ? [
      `生成 ${result.stageResults.stage3.storyboardCount} 个分镜板`,
      `生成 ${result.stageResults.stage3.panelCount} 个分镜格`,
      `生成 ${result.stageResults.stage3.voiceLineCount} 条配音行`,
    ]
    : []
  const assetItems = result.stageResults.assetConsistency
    ? [
      `资产简报 ${result.stageResults.assetConsistency.hasConsistencyBrief ? '已写入' : '未写入'}`,
      `确认 ${result.stageResults.assetConsistency.propCount} 个商品/道具要点`,
    ]
    : []

  return (
    <div
      className="mt-6 p-6"
      style={{
        background: '#fafcfe',
        borderRadius: '22px',
        border: '1px solid rgba(49,208,170,.28)',
        boxShadow: '0 22px 54px rgba(14,14,44,.08), 0 4px 12px rgba(14,14,44,.045)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl" style={{ background: '#e0faf4' }}>
          <CheckCircle2 className="w-5 h-5" style={{ color: '#31D0AA' }} />
        </div>
        <h3 className="text-lg font-semibold" style={{ color: '#0e0e2c' }}>执行完成</h3>
      </div>

      {[...scriptItems, ...assetItems, ...storyboardItems].map((text) => (
        <div key={text} className="flex items-center gap-2 text-sm mb-2" style={{ color: '#4a4a68' }}>
          <CheckCircle2 className="w-4 h-4" />
          <span>{text}</span>
        </div>
      ))}

      <div className="p-3 rounded-[16px] my-4" style={{ background: '#ffffff', border: '1px solid rgba(14,14,44,.08)' }}>
        <p className="text-sm whitespace-pre-wrap" style={{ color: '#4a4a68' }}>
          {result.summary}
        </p>
      </div>

      <div className="text-sm flex items-center gap-2" style={{ color: '#4B4DED' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>正在跳转到工作区...</span>
      </div>
    </div>
  )
}
