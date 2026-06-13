'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { AppIcon } from '@/components/ui/icons'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { DirectUploadSection } from '@/components/shared/assets/DirectUploadSection'
import { queryKeys } from '@/lib/query/keys'

interface AgentEditChatPanelProps {
  projectId: string
  episodeId?: string
  onApplied: () => void
}

type ChatEditResult = {
  summary: string
  targetType: 'asset' | 'storyboard' | 'mixed' | 'none'
  episodeUpdated: boolean
  assetChanges: Array<{
    kind: 'character' | 'location' | 'prop'
    id: string
    changedFields: string[]
    taskId?: string
    action?: 'updated' | 'created'
  }>
  panelChanges: Array<{
    id: string
    changedFields: string[]
    taskId?: string
    action?: 'updated' | 'inserted'
  }>
  submittedTaskIds: string[]
}

type TrackedTask = {
  id: string
  status: string
  progress?: number | null
  errorMessage?: string | null
  error?: {
    message?: string
  } | null
}

const TASK_TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'dismissed'])

export default function AgentEditChatPanel({
  projectId,
  episodeId,
  onApplied,
}: AgentEditChatPanelProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [referenceImageUrl, setReferenceImageUrl] = useState('')
  const [uploadedReferenceImageUrls, setUploadedReferenceImageUrls] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ChatEditResult | null>(null)
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([])
  const [trackedTasks, setTrackedTasks] = useState<TrackedTask[]>([])
  const [taskPollError, setTaskPollError] = useState<string | null>(null)
  const [taskTrackingDone, setTaskTrackingDone] = useState(false)
  const onAppliedRef = useRef(onApplied)

  useEffect(() => {
    onAppliedRef.current = onApplied
  }, [onApplied])

  const taskSummary = useMemo(() => {
    if (pendingTaskIds.length === 0) return null
    const taskById = new Map(trackedTasks.map((task) => [task.id, task]))
    const tasks = pendingTaskIds.map((id) => taskById.get(id)).filter((task): task is TrackedTask => Boolean(task))
    const completed = tasks.filter((task) => task.status === 'completed').length
    const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'canceled').length
    const running = tasks.filter((task) => task.status === 'queued' || task.status === 'processing').length
    const averageProgress = tasks.length > 0
      ? Math.round(tasks.reduce((sum, task) => sum + (typeof task.progress === 'number' ? task.progress : 0), 0) / tasks.length)
      : 0
    const firstFailure = tasks.find((task) => task.status === 'failed' || task.status === 'canceled')
    return {
      total: pendingTaskIds.length,
      seen: tasks.length,
      completed,
      failed,
      running,
      averageProgress,
      allTerminal: tasks.length === pendingTaskIds.length && tasks.every((task) => TASK_TERMINAL_STATUSES.has(task.status)),
      firstFailure,
    }
  }, [pendingTaskIds, trackedTasks])

  useEffect(() => {
    if (!projectId || pendingTaskIds.length === 0 || taskTrackingDone) return
    let stopped = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const refreshProjectViews = async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.characters(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.locations(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.assets.all('project', projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false }),
        ...(episodeId
          ? [
              queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) }),
              queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) }),
            ]
          : []),
      ])
      onAppliedRef.current()
    }

    const poll = async () => {
      try {
        const search = new URLSearchParams()
        search.set('projectId', projectId)
        search.set('limit', '200')
        for (const status of ['queued', 'processing', 'completed', 'failed', 'canceled', 'dismissed']) {
          search.append('status', status)
        }
        const response = await apiFetch(`/api/tasks?${search}`)
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, '任务状态刷新失败'))
        }
        const data = await response.json() as { tasks?: TrackedTask[] }
        if (stopped) return
        const idSet = new Set(pendingTaskIds)
        const nextTasks = (data.tasks || []).filter((task) => idSet.has(task.id))
        setTrackedTasks(nextTasks)
        setTaskPollError(null)

        const allTerminal = nextTasks.length === pendingTaskIds.length
          && nextTasks.every((task) => TASK_TERMINAL_STATUSES.has(task.status))
        if (allTerminal) {
          await refreshProjectViews()
          if (!stopped) setTaskTrackingDone(true)
          return
        }
      } catch (err) {
        if (!stopped) {
          setTaskPollError(err instanceof Error ? err.message : '任务状态刷新失败')
        }
      }
      if (!stopped) {
        timeoutId = setTimeout(() => void poll(), 2500)
      }
    }

    void poll()
    return () => {
      stopped = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [projectId, episodeId, pendingTaskIds, queryClient, taskTrackingDone])

  if (!episodeId) return null

  const handleSubmit = async () => {
    const trimmed = instruction.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const referenceImageUrls = [
        ...uploadedReferenceImageUrls,
        ...(referenceImageUrl.trim() ? [referenceImageUrl.trim()] : []),
      ]
      const response = await apiFetch('/api/super-agent/chat-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          episodeId,
          instruction: trimmed,
          executionMode: 'live',
          referenceImageUrls,
          allowVideoGeneration: false,
        }),
      })

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'Agent 修改失败'))
      }

      const data = await response.json() as { result: ChatEditResult }
      setResult(data.result)
      setPendingTaskIds(data.result.submittedTaskIds || [])
      setTrackedTasks([])
      setTaskPollError(null)
      setTaskTrackingDone(false)
      setInstruction('')
      setReferenceImageUrl('')
      setUploadedReferenceImageUrls([])
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent 修改失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-lg border border-[rgba(14,14,44,.1)] bg-[#D6FF00] px-4 text-sm font-bold text-[#0e0e2c] shadow-[0_12px_28px_rgba(14,14,44,.14)] transition-transform hover:-translate-y-0.5"
      >
        <AppIcon name="sparkles" className="h-4 w-4" />
        Agent 修改
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/20 p-4 sm:p-6" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-xl border border-[rgba(14,14,44,.1)] bg-white p-4 shadow-[0_22px_54px_rgba(14,14,44,.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0e0e2c] text-[#D6FF00]">
                  <AppIcon name="sparkles" className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#0e0e2c]">Agent 修改</h2>
                  <p className="text-xs text-[#697384]">输入一句话，直接改当前项目产物</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-[#697384] hover:bg-[#ECF1F4] hover:text-[#0e0e2c]"
              >
                关闭
              </button>
            </div>

            <textarea
              value={instruction}
              onChange={(event) => {
                setInstruction(event.target.value)
                setError(null)
              }}
              placeholder="例如：把结尾 CTA 改得更明确，第一镜头更像商品广告"
              className="h-28 w-full resize-none rounded-lg border border-[rgba(14,14,44,.12)] bg-[#f7fafc] p-3 text-sm leading-relaxed text-[#0e0e2c] outline-none placeholder:text-[#8a93a3] focus:border-[rgba(14,14,44,.28)] focus:bg-white"
              disabled={submitting}
            />

            <input
              value={referenceImageUrl}
              onChange={(event) => {
                setReferenceImageUrl(event.target.value)
                setError(null)
              }}
              placeholder="可选：商品图/参考图 URL，用于广告植入或新增资产"
              className="mt-2 h-10 w-full rounded-lg border border-[rgba(14,14,44,.12)] bg-[#f7fafc] px-3 text-sm text-[#0e0e2c] outline-none placeholder:text-[#8a93a3] focus:border-[rgba(14,14,44,.28)] focus:bg-white"
              disabled={submitting}
            />
            <div className="mt-2">
              <DirectUploadSection
                maxImages={1}
                label="上传商品图/参考图"
                hint="用于广告植入或新增资产，只作为 reference 图，不会触发生视频。"
                onImagesReady={setUploadedReferenceImageUrls}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#697384]">
              当前 Agent 修改只更新资产、分镜和引用绑定，不会自动调用生视频接口。
            </p>

            {error && (
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {result && (
              <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <p className="font-semibold">{result.summary}</p>
                <p className="mt-1 text-xs">
                  判断：{result.targetType === 'asset' ? '资产修改' : result.targetType === 'storyboard' ? '分镜修改' : result.targetType === 'mixed' ? '资产 + 分镜' : '未匹配'}，
                  资产 {result.assetChanges.length} 处，分镜 {result.panelChanges.length} 处，新增资产 {result.assetChanges.filter((item) => item.action === 'created').length} 个，新增分镜 {result.panelChanges.filter((item) => item.action === 'inserted').length} 个，生成任务 {result.submittedTaskIds.length} 个
                </p>
                {taskSummary && (
                  <div className="mt-2 rounded-md bg-white/70 px-2 py-2 text-xs text-emerald-900">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        资产图回填：完成 {taskSummary.completed}/{taskSummary.total}
                        {taskSummary.failed > 0 ? `，失败 ${taskSummary.failed}` : ''}
                        {taskSummary.running > 0 ? `，处理中 ${taskSummary.running}` : ''}
                      </span>
                      {!taskSummary.allTerminal && (
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" />
                          {taskSummary.averageProgress}%
                        </span>
                      )}
                      {taskSummary.allTerminal && taskSummary.failed === 0 && (
                        <span className="font-semibold">已刷新</span>
                      )}
                    </div>
                    {taskSummary.firstFailure && (
                      <p className="mt-1 text-red-700">
                        {taskSummary.firstFailure.errorMessage || taskSummary.firstFailure.error?.message || '资产图重生成失败'}
                      </p>
                    )}
                    {taskPollError && (
                      <p className="mt-1 text-red-700">{taskPollError}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg border border-[rgba(14,14,44,.1)] bg-white px-3 text-sm font-medium text-[#4d5665] hover:bg-[#ECF1F4]"
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!instruction.trim() || submitting}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0e0e2c] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <AppIcon name="loader" className="h-4 w-4 animate-spin" />}
                应用修改
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
