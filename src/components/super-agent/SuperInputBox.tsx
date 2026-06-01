/**
 * Super Input Box - 智能视频制作输入框
 */

'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Loader2, Send } from '@/components/ui/icons'
import type {
  AgentCreativeParameters,
  AgentExecutionMode,
  AgentExecutionPlan,
  AgentExecutionResult,
} from '@/lib/super-agent/types'
import { SuperPlanEditor } from './SuperPlanEditor'
import { SuperQuickParameters } from './SuperQuickParameters'
import { DEFAULT_PARAMETERS } from './super-agent-ui'

interface SuperInputBoxProps {
  locale: string
  placeholder?: string
}

type SuperInputStatus = 'idle' | 'planning' | 'confirming' | 'executing'

export function SuperInputBox({ locale, placeholder }: SuperInputBoxProps) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [input, setInput] = useState('')
  const [executionMode, setExecutionMode] = useState<AgentExecutionMode>('mock')
  const [parameters, setParameters] = useState<AgentCreativeParameters>(DEFAULT_PARAMETERS)
  const [status, setStatus] = useState<SuperInputStatus>('idle')
  const [plan, setPlan] = useState<AgentExecutionPlan | null>(null)
  const [result, setResult] = useState<AgentExecutionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updateParameter = <K extends keyof AgentCreativeParameters>(
    key: K,
    value: AgentCreativeParameters[K],
  ) => {
    setParameters((current) => ({ ...current, [key]: value }))
  }

  const updatePlan = (updater: (current: AgentExecutionPlan) => AgentExecutionPlan) => {
    setPlan((current) => current ? updater(current) : current)
  }

  const readErrorMessage = async (response: Response, fallback: string) => {
    try {
      const errorData = await response.json()
      return errorData?.error?.message || fallback
    } catch {
      return fallback
    }
  }

  const handleSubmit = async () => {
    if (!input.trim() || status !== 'idle') return

    setStatus('planning')
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/super-agent/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: input.trim(),
          locale,
          executionMode,
          parameters,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '规划失败'))
      }

      const data = await response.json() as { plan: AgentExecutionPlan }
      setPlan(data.plan)
      setExecutionMode(data.plan.executionMode || executionMode)
      setStatus('confirming')
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : '规划失败，请重试')
    }
  }

  const handleConfirm = async () => {
    if (!plan) return

    setStatus('executing')
    setError(null)

    try {
      const response = await fetch('/api/super-agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          userInput: input.trim(),
          locale,
          executionMode: plan.executionMode,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '执行失败'))
      }

      const data = await response.json() as { result: AgentExecutionResult }
      setResult(data.result)
      setStatus('idle')

      window.setTimeout(() => {
        router.push(data.result.workspaceUrl)
      }, 2000)
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : '执行失败，请重试')
    }
  }

  const handleCancel = () => {
    setStatus('idle')
    setPlan(null)
    setError(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || '描述你想要的视频...'}
          className="w-full h-32 p-4 pr-14 resize-none transition-all duration-200 text-base"
          style={{
            background: 'var(--glass-bg-surface)',
            color: 'var(--glass-text-primary)',
            border: '2px solid var(--glass-stroke-base)',
            borderRadius: 'var(--glass-radius-md)',
            boxShadow: 'var(--glass-shadow-sm)',
          }}
          disabled={status !== 'idle'}
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={status !== 'idle' || !input.trim()}
          className="absolute bottom-4 right-4 p-3 rounded-lg transition-all duration-200"
          style={{
            background: status === 'idle' && input.trim()
              ? 'linear-gradient(135deg, var(--glass-accent-from), var(--glass-accent-to))'
              : 'var(--glass-tone-neutral-bg)',
            color: 'var(--glass-text-on-accent)',
            boxShadow: status === 'idle' && input.trim() ? 'var(--glass-shadow-md)' : 'none',
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

      <SuperQuickParameters
        executionMode={executionMode}
        parameters={parameters}
        disabled={status !== 'idle'}
        onExecutionModeChange={setExecutionMode}
        onParameterChange={updateParameter}
      />

      {error && <SuperErrorPanel message={error} />}

      {status === 'confirming' && plan && (
        <SuperPlanEditor
          plan={plan}
          onPlanChange={updatePlan}
          onConfirm={() => void handleConfirm()}
          onCancel={handleCancel}
        />
      )}

      {status === 'executing' && <SuperExecutingPanel />}

      {result && <SuperResultPanel result={result} />}
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

function SuperExecutingPanel() {
  return (
    <div
      className="mt-6 p-6"
      style={{
        background: 'var(--glass-bg-surface-strong)',
        borderRadius: 'var(--glass-radius-md)',
        border: '2px solid var(--glass-stroke-focus)',
        boxShadow: 'var(--glass-shadow-lg)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--glass-tone-info-fg)' }} />
        <h3 className="text-lg font-semibold" style={{ color: 'var(--glass-text-primary)' }}>正在执行</h3>
      </div>
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm" style={{ color: 'var(--glass-text-tertiary)' }}>准备中...</span>
            <span className="text-sm font-medium" style={{ color: 'var(--glass-text-primary)' }}>0%</span>
          </div>
          <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: 'var(--glass-bg-muted)' }}>
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: '0%', background: 'linear-gradient(90deg, var(--glass-accent-from), var(--glass-accent-to))' }}
            />
          </div>
        </div>
        <p className="text-xs" style={{ color: 'var(--glass-text-tertiary)' }}>
          这可能需要几分钟时间，请耐心等待...
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

  return (
    <div
      className="mt-6 p-6"
      style={{
        background: 'var(--glass-tone-success-bg)',
        borderRadius: 'var(--glass-radius-md)',
        border: '2px solid var(--glass-stroke-success)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg" style={{ background: 'var(--glass-tone-success-bg)' }}>
          <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--glass-tone-success-fg)' }} />
        </div>
        <h3 className="text-lg font-semibold" style={{ color: 'var(--glass-tone-success-fg)' }}>执行完成</h3>
      </div>

      {[...scriptItems, ...storyboardItems].map((text) => (
        <div key={text} className="flex items-center gap-2 text-sm mb-2" style={{ color: 'var(--glass-tone-success-fg)' }}>
          <CheckCircle2 className="w-4 h-4" />
          <span>{text}</span>
        </div>
      ))}

      <div className="p-3 rounded-lg my-4" style={{ background: 'rgba(255, 255, 255, 0.3)' }}>
        <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--glass-tone-success-fg)' }}>
          {result.summary}
        </p>
      </div>

      <div className="text-sm flex items-center gap-2" style={{ color: 'var(--glass-tone-success-fg)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>正在跳转到工作区...</span>
      </div>
    </div>
  )
}
