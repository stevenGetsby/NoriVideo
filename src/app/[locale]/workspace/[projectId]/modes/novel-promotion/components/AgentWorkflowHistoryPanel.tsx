'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { AppIcon } from '@/components/ui/icons'

interface AgentWorkflowHistoryPanelProps {
  projectId: string
  episodeId?: string
}

type WorkflowRun = {
  id: string
  status: string
  workflowType: string
  episodeId?: string | null
  targetType: string
  targetId: string
  createdAt?: string
  updatedAt?: string
  output?: Record<string, unknown> | null
}

type WorkflowArtifact = {
  id: string
  stepKey?: string | null
  artifactType: string
  refId: string
  versionHash?: string | null
  payload?: Record<string, unknown> | null
}

type WorkflowDetail = {
  run: WorkflowRun & {
    input?: Record<string, unknown> | null
    workflowVersion?: number
  }
  steps?: Array<{
    id: string
    stepKey: string
    stepTitle: string
    status: string
    stepIndex?: number
    stepTotal?: number
    lastErrorMessage?: string | null
  }>
  events?: Array<{
    id: string
    seq: number
    eventType: string
    stepKey?: string | null
    payload?: Record<string, unknown> | null
  }>
  artifacts?: WorkflowArtifact[]
  checkpoints?: Array<{
    id: string
    nodeKey: string
    version: number
  }>
}

type StageInsight = {
  title: string
  modelAction: string
  analyzing: string
  output: string
  qualityGate: string
  icon: 'brain' | 'film' | 'image' | 'video' | 'check' | 'sparkles'
}

type StageTimelineItem = {
  stageKey: string
  title: string
  status: string
  modelAction: string
  analyzing: string
  output: string
  qualityGate: string
  message: string
  metrics: string[]
  errorMessage: string | null
  icon: StageInsight['icon']
}

const AGENT_STAGE_ORDER = ['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5', 'stage_6', 'stage_7']

const STAGE_RESULT_KEY: Record<string, string> = {
  stage_1: 'stage1',
  stage_2: 'stage2',
  stage_3: 'assetConsistency',
  stage_4: 'assetImageGeneration',
  stage_5: 'stage3',
  stage_6: 'imageGeneration',
  stage_7: 'videoGeneration',
}

const STAGE_INSIGHTS: Record<string, StageInsight> = {
  stage_1: {
    title: '项目初始化',
    modelAction: '系统准备创作上下文',
    analyzing: '读取 prompt、画幅、风格、创作模式和项目配置，建立可编辑工作区。',
    output: '项目、第一集、Agent 故事包和后续任务上下文。',
    qualityGate: '必须创建可继续编辑的项目与剧集，不能停在临时草稿。',
    icon: 'sparkles',
  },
  stage_2: {
    title: '故事扩写与剧本锁定',
    modelAction: '文本模型按手动智能创作标准扩写故事并拆剧本',
    analyzing: '把短 prompt 扩写为完整故事，拆剧情片段，并抽取角色、场景、道具资产。',
    output: '故事正文、剧情片段、剧本结构、角色/场景/道具资产。',
    qualityGate: '中国故事必须是中国场景；英文/欧美故事必须保持海外语境。',
    icon: 'brain',
  },
  stage_3: {
    title: '资产一致性 Critic',
    modelAction: '资产 critic 核对一致性',
    analyzing: '检查角色、服装、场景、道具和地域语境是否匹配原始 prompt。',
    output: '全局资产一致性简报，供后续分镜图和视频复用。',
    qualityGate: '每个项目在制作分镜图前必须先锁定一套全局资产。',
    icon: 'check',
  },
  stage_4: {
    title: '全局资产图生成',
    modelAction: '图像模型生成全局资产参考',
    analyzing: '为角色、场景、道具建立参考图槽，维护全片视觉一致性。',
    output: '角色外观图、场景图、道具图任务和结果。',
    qualityGate: '后续 panel 必须引用这些资产，不能临时重造角色。',
    icon: 'image',
  },
  stage_5: {
    title: '分镜与视频提示词',
    modelAction: '文本模型生成分镜与视频提示词',
    analyzing: '先分片段，再在片段内生成多个分镜；每个 panel 绑定资产、站位、镜头语言、动作和台词。',
    output: '可编辑分镜板、panel、绑定资产、video_prompt 和推荐时长。',
    qualityGate: '每个 video_prompt 必须说明哪个角色做了什么、说了什么台词。',
    icon: 'film',
  },
  stage_6: {
    title: '分镜图生成',
    modelAction: '图像模型生成分镜图',
    analyzing: '按 panel 的资产绑定和画面描述生成分镜图，并保留失败任务。',
    output: '每个 panel 的图片任务、图片 URL 或错误信息。',
    qualityGate: '不能把没有图片的 panel 伪装成完成。',
    icon: 'image',
  },
  stage_7: {
    title: '视频生成',
    modelAction: '视频模型生成成片片段',
    analyzing: '把分镜图作为视觉输入，注入 video_prompt、推荐时长、台词和动作，提交视频生成任务。',
    output: 'Seedance/视频模型任务、任务状态、视频 URL 或失败原因。',
    qualityGate: '视频生成必须使用分镜图和该 panel 的 video_prompt，不得脱离资产。',
    icon: 'video',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readStageResult(detail: WorkflowDetail, stageKey: string): Record<string, unknown> | null {
  const output = isRecord(detail.run.output) ? detail.run.output : null
  const stageResults = isRecord(output?.stageResults) ? output.stageResults : null
  const resultKey = STAGE_RESULT_KEY[stageKey]
  const value = resultKey ? stageResults?.[resultKey] : null
  return isRecord(value) ? value : null
}

function metricLabels(details: Record<string, unknown> | null): string[] {
  if (!details) return []
  const specs: Array<[string, string]> = [
    ['characterCount', '角色'],
    ['locationCount', '场景'],
    ['propCount', '道具'],
    ['clipCount', '片段'],
    ['storyboardCount', '分镜板'],
    ['panelCount', 'Panel'],
    ['voiceLineCount', '台词'],
    ['characterAppearanceCount', '角色图槽'],
    ['locationImageCount', '场景图槽'],
    ['propImageCount', '道具图槽'],
    ['submittedTaskCount', '提交任务'],
    ['completedTaskCount', '完成任务'],
    ['failedTaskCount', '失败任务'],
    ['skippedMissingImageCount', '缺图跳过'],
    ['skippedExistingImageCount', '已有图片'],
    ['skippedExistingVideoCount', '已有视频'],
  ]
  return specs
    .map(([key, label]) => {
      const value = readNumber(details[key])
      return value === null ? null : `${label} ${value}`
    })
    .filter((value): value is string => !!value)
    .slice(0, 8)
}

function buildStageTimeline(detail: WorkflowDetail): StageTimelineItem[] {
  const stepByKey = new Map((detail.steps || []).map((step) => [step.stepKey, step]))
  const artifactByKey = new Map<string, WorkflowArtifact>()
  for (const artifact of detail.artifacts || []) {
    if (
      artifact.stepKey
      && (artifact.artifactType === 'agent.stage.progress' || artifact.artifactType === 'agent.stage.error')
    ) {
      artifactByKey.set(artifact.stepKey, artifact)
    }
  }

  const keys = Array.from(new Set([
    ...AGENT_STAGE_ORDER,
    ...(detail.steps || []).map((step) => step.stepKey),
    ...(detail.artifacts || []).map((artifact) => artifact.stepKey || '').filter(Boolean),
  ])).filter((key) => key.startsWith('stage_'))

  return keys.map((stageKey) => {
    const step = stepByKey.get(stageKey)
    const artifact = artifactByKey.get(stageKey)
    const payload = isRecord(artifact?.payload) ? artifact.payload : null
    const payloadDetails = isRecord(payload?.details) ? payload.details : null
    const resultDetails = readStageResult(detail, stageKey)
    const insight = STAGE_INSIGHTS[stageKey] || STAGE_INSIGHTS.stage_1
    const status = readString(payload?.status) || step?.status || 'pending'
    const message = readString(payload?.message) || readString(payload?.summary) || insight.analyzing
    const errorMessage = step?.lastErrorMessage || readString(payload?.errorMessage) || readString(payload?.error) || null

    return {
      stageKey,
      title: step?.stepTitle || insight.title,
      status,
      modelAction: insight.modelAction,
      analyzing: insight.analyzing,
      output: insight.output,
      qualityGate: insight.qualityGate,
      message,
      metrics: metricLabels(payloadDetails).length > 0 ? metricLabels(payloadDetails) : metricLabels(resultDetails),
      errorMessage,
      icon: insight.icon,
    }
  })
}

function statusClassName(status: string): string {
  if (/fail|error|cancel/i.test(status)) return 'border-red-200 bg-red-50 text-red-700'
  if (/running|processing|queued/i.test(status)) return 'border-blue-200 bg-blue-50 text-blue-700'
  if (/complete|success/i.test(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-[rgba(14,14,44,.08)] bg-[#f7fafc] text-[#697384]'
}

function readSummary(run: WorkflowRun): string {
  const summary = run.output?.summary
  if (typeof summary === 'string' && summary.trim()) return summary
  const instruction = run.output?.instruction
  if (typeof instruction === 'string' && instruction.trim()) return instruction
  return run.workflowType === 'super_agent_chat_edit' ? 'Agent 修改记录' : 'Agent 创作记录'
}

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-lg bg-[#0e0e2c] p-3 text-xs leading-relaxed text-white/86">
      {JSON.stringify(value || {}, null, 2)}
    </pre>
  )
}

export default function AgentWorkflowHistoryPanel({
  projectId,
  episodeId,
}: AgentWorkflowHistoryPanelProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<WorkflowDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filteredRuns = useMemo(() => {
    if (!episodeId) return runs
    return runs.filter((run) => !run.episodeId || run.episodeId === episodeId || run.workflowType === 'super_agent_creation')
  }, [episodeId, runs])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function loadRuns() {
      setLoading(true)
      setError(null)
      try {
        const [creationResponse, editResponse] = await Promise.all([
          apiFetch(`/api/runs?projectId=${projectId}&workflowType=super_agent_creation&limit=20`),
          apiFetch(`/api/runs?projectId=${projectId}&workflowType=super_agent_chat_edit&limit=20`),
        ])
        if (!creationResponse.ok || !editResponse.ok) {
          throw new Error('加载 workflow 失败')
        }
        const [creationData, editData] = await Promise.all([
          creationResponse.json() as Promise<{ runs?: WorkflowRun[] }>,
          editResponse.json() as Promise<{ runs?: WorkflowRun[] }>,
        ])
        if (!cancelled) {
          setRuns([...(creationData.runs || []), ...(editData.runs || [])].sort((a, b) => {
            const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime()
            const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime()
            return bTime - aTime
          }))
          setSelectedRunId((current) => current || creationData.runs?.[0]?.id || editData.runs?.[0]?.id || null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载 workflow 失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void loadRuns()
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  useEffect(() => {
    if (!open || !selectedRunId) {
      setDetail(null)
      return
    }
    let cancelled = false
    async function loadDetail() {
      setDetailLoading(true)
      try {
        const response = await apiFetch(`/api/runs/${selectedRunId}`)
        if (!response.ok) {
          throw new Error('加载 workflow 详情失败')
        }
        const data = await response.json() as WorkflowDetail
        if (!cancelled) {
          setDetail(data)
        }
      } catch {
        if (!cancelled) {
          setDetail(null)
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }
    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [open, selectedRunId])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-36 z-40 inline-flex h-11 items-center gap-2 rounded-lg border border-[rgba(14,14,44,.1)] bg-white px-4 text-sm font-bold text-[#0e0e2c] shadow-[0_12px_28px_rgba(14,14,44,.1)] transition-transform hover:-translate-y-0.5"
      >
        <AppIcon name="clock" className="h-4 w-4" />
        Workflow
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/20 p-4 sm:p-6" onClick={() => setOpen(false)}>
          <div
            className="max-h-[82vh] w-full max-w-5xl overflow-hidden rounded-xl border border-[rgba(14,14,44,.1)] bg-white shadow-[0_22px_54px_rgba(14,14,44,.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[rgba(14,14,44,.08)] px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-[#0e0e2c]">Agent Workflow</h2>
                <p className="text-xs text-[#697384]">创作与修改记录，可作为 automation 的可迭代快照</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-[#697384] hover:bg-[#ECF1F4] hover:text-[#0e0e2c]"
              >
                关闭
              </button>
            </div>

            <div className="grid max-h-[calc(82vh-64px)] grid-cols-1 overflow-hidden md:grid-cols-[360px_1fr]">
              <div className="max-h-[calc(82vh-64px)] overflow-y-auto border-r border-[rgba(14,14,44,.08)] p-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-[#697384]">
                  <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                  加载中...
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-500/20 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : filteredRuns.length === 0 ? (
                <div className="rounded-lg border border-[rgba(14,14,44,.08)] bg-[#f7fafc] px-3 py-6 text-center text-sm text-[#697384]">
                  暂无 Agent workflow 记录
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredRuns.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedRunId === run.id
                        ? 'border-[#0e0e2c] bg-white'
                        : 'border-[rgba(14,14,44,.08)] bg-[#f7fafc] hover:border-[rgba(14,14,44,.18)]'}`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-[#0e0e2c]">
                          {run.workflowType === 'super_agent_chat_edit' ? 'Chat Edit' : 'Creation'}
                        </span>
                        <span className="text-[11px] text-[#697384]">{formatTime(run.updatedAt || run.createdAt)}</span>
                      </div>
                      <p className="line-clamp-3 text-sm leading-relaxed text-[#0e0e2c]">{readSummary(run)}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#697384]">
                        <span>{run.status}</span>
                        <span>{run.id.slice(0, 8)}</span>
                        {run.episodeId && <span>episode {run.episodeId.slice(0, 8)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              </div>

              <div className="max-h-[calc(82vh-64px)] overflow-y-auto p-4">
                {detailLoading ? (
                  <div className="flex items-center gap-2 text-sm text-[#697384]">
                    <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                    加载详情...
                  </div>
                ) : !detail ? (
                  <div className="rounded-lg border border-[rgba(14,14,44,.08)] bg-[#f7fafc] px-3 py-6 text-center text-sm text-[#697384]">
                    选择一条 workflow 查看详情
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[#0e0e2c] px-2 py-1 text-xs font-semibold text-white">
                          {detail.run.workflowType}
                        </span>
                        <span className="rounded bg-[#ECF1F4] px-2 py-1 text-xs text-[#4d5665]">
                          v{detail.run.workflowVersion || 1}
                        </span>
                        <span className="rounded bg-[#ECF1F4] px-2 py-1 text-xs text-[#4d5665]">
                          {detail.run.status}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-[#0e0e2c]">{readSummary(detail.run)}</p>
                    </div>

                    <section>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xs font-bold uppercase text-[#697384]">Agent Pipeline</h3>
                          <p className="mt-1 text-xs text-[#697384]">从 prompt 到故事、剧本、资产、分镜、图片和视频任务的生产记录</p>
                        </div>
                        <span className="rounded-full bg-[#D6FF00] px-3 py-1 text-xs font-bold text-[#0e0e2c]">
                          videos stage
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {buildStageTimeline(detail).map((stage) => (
                          <div
                            key={stage.stageKey}
                            className="rounded-xl border border-[rgba(14,14,44,.08)] bg-[#fbfcfe] p-3 shadow-[0_8px_24px_rgba(14,14,44,.04)]"
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-start gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#0e0e2c] shadow-[0_2px_8px_rgba(14,14,44,.06)]">
                                  <AppIcon name={stage.icon} className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="text-sm font-bold text-[#0e0e2c]">{stage.title}</h4>
                                    <span className="text-[11px] font-semibold text-[#697384]">{stage.stageKey}</span>
                                  </div>
                                  <p className="mt-1 text-xs font-semibold text-[#4B4DED]">{stage.modelAction}</p>
                                </div>
                              </div>
                              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClassName(stage.status)}`}>
                                {stage.status}
                              </span>
                            </div>

                            <div className="grid gap-2 text-xs leading-relaxed text-[#4d5665] md:grid-cols-3">
                              <div className="rounded-lg bg-white p-2">
                                <div className="mb-1 font-bold text-[#0e0e2c]">模型在分析</div>
                                <p>{stage.analyzing}</p>
                              </div>
                              <div className="rounded-lg bg-white p-2">
                                <div className="mb-1 font-bold text-[#0e0e2c]">当前进度</div>
                                <p>{stage.message}</p>
                              </div>
                              <div className="rounded-lg bg-white p-2">
                                <div className="mb-1 font-bold text-[#0e0e2c]">质量门槛</div>
                                <p>{stage.qualityGate}</p>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              {stage.metrics.length > 0 ? stage.metrics.map((metric) => (
                                <span key={metric} className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-[#0e0e2c]">
                                  {metric}
                                </span>
                              )) : (
                                <span className="rounded-lg bg-white px-2 py-1 text-[11px] text-[#697384]">
                                  等待产物指标
                                </span>
                              )}
                            </div>

                            {stage.errorMessage && (
                              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-50 px-3 py-2 text-xs text-red-700">
                                {stage.errorMessage}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-2 text-xs font-bold uppercase text-[#697384]">Artifacts</h3>
                      {(detail.artifacts || []).length === 0 ? (
                        <p className="text-sm text-[#697384]">暂无 artifact</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(detail.artifacts || []).map((artifact) => (
                            <span key={artifact.id || `${artifact.artifactType}:${artifact.refId}`} className="rounded-lg border border-[rgba(14,14,44,.08)] bg-[#f7fafc] px-2 py-1 text-xs text-[#0e0e2c]">
                              {artifact.artifactType} / {artifact.refId.slice(0, 8)}
                            </span>
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <h3 className="mb-2 text-xs font-bold uppercase text-[#697384]">Input</h3>
                      <JsonPreview value={detail.run.input} />
                    </section>

                    <section>
                      <h3 className="mb-2 text-xs font-bold uppercase text-[#697384]">Output</h3>
                      <JsonPreview value={detail.run.output} />
                    </section>

                    <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-xs font-bold uppercase text-[#697384]">Events</h3>
                        <JsonPreview value={(detail.events || []).map((event) => ({
                          seq: event.seq,
                          eventType: event.eventType,
                          stepKey: event.stepKey || null,
                        }))} />
                      </div>
                      <div>
                        <h3 className="mb-2 text-xs font-bold uppercase text-[#697384]">Checkpoints</h3>
                        <JsonPreview value={detail.checkpoints || []} />
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
